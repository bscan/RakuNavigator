import {
    Diagnostic,
    DiagnosticSeverity,
} from 'vscode-languageserver/node';
import { NavigatorSettings, CompilationResults } from "./types";
import {
	WorkspaceFolder
} from 'vscode-languageserver-protocol';
import { dirname, join } from 'path';
import Uri from 'vscode-uri';
import { getIncPaths, async_execFile, nLog } from './utils';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';

export async function rakucompile(textDocument: TextDocument, workspaceFolders: WorkspaceFolder[] | null, settings: NavigatorSettings): Promise<CompilationResults | void> {
    
    const navigatorPath = join(dirname(__dirname), 'src', 'raku', 'navigator.raku');

    let rakuParams: string[] = [navigatorPath];
    const filePath = Uri.parse(textDocument.uri).fsPath;

    rakuParams = rakuParams.concat(getIncPaths(workspaceFolders, settings));
    nLog("Starting raku compilation check with " + settings.rakuPath + " " + rakuParams.join(" ") + " " + filePath, settings);

    let output: string;
    let stdout: string;
    const diagnostics: Diagnostic[] = [];
    const code = textDocument.getText();
    let myenv = process.env;
	myenv.RAKUDO_ERROR_COLOR = '0';

    try {
        const process = async_execFile(settings.rakuPath, rakuParams, {timeout: 10000, maxBuffer: 20 * 1024 * 1024});
        process?.child?.stdin?.on('error', (error: any) => { 
            nLog("Raku Compilation Error Caught: ", settings);
            nLog(error, settings);
        });
        process?.child?.stdin?.write(code);
        process?.child?.stdin?.end();
        const out = await process;

        output = out.stderr;
        stdout = out.stdout;
    } catch(error: any) {
        // TODO: Check if we overflowed the buffer.
        if("stderr" in error && "stdout" in error){
            output = error.stderr;
            stdout = error.stdout;
        } else {
            nLog("rakucompile failed with unknown error", settings);
            nLog(error, settings);
            return;
        }
    }

    // nLog("Raku compilation results", settings);
    // nLog(output, settings);
    // nLog("Raku stdout results", settings);
    // nLog(stdout, settings);

    if(stdout){
        parseFromRaku(stdout, diagnostics); // Errors are dropped into stdout
    }
    if(output){
        parseUnhandled(output, diagnostics);
    }
    return {diags: diagnostics};
}


// Most errors and warnings are caught in navigator.raku and piped back here for parsing. 
function parseFromRaku(stdout: string, diagnostics: Diagnostic[]): void {

    stdout = stdout.replace(/\r/g, ""); // Clean up for Windows

    let match: RegExpExecArray | null;
    const violations = stdout.split("~||~");
    
    violations.forEach(violation => {

        if(match = /^(\d+)~\|~(\d+)~\|~(.+)/s.exec(violation)){
            let lineNum = +match[1] - 1;
            let message = match[3];
            let bError = +match[2];
            let severity: DiagnosticSeverity;
            if(lineNum < 0) lineNum = 0;
            if(bError){
                severity = DiagnosticSeverity.Error;
            } else {
                severity = DiagnosticSeverity.Warning;
            }
            diagnostics.push({
                severity: severity,
                range: {
                    start: { line: lineNum, character: 0 },
                    end: { line: lineNum, character: 500 }
                },
                message: "Syntax: " + message,
                source: 'raku navigator'
            });
        }
    });
}


// Some warnings are not currently caught within Raku and leak into STDERR. Let's catch them here and categorize them
function parseUnhandled(violations: string, diagnostics: Diagnostic[]): void {
    violations = violations.replace(/\r/g, ""); // Clean up for Windows

    let match: RegExpExecArray | null;
    let lineNum: number;
    var re =  /^\s+(.+?)\n\s+at.+\:(\d+)$/gm;
    while(match = re.exec(violations)){
        lineNum = +match[2] - 1;
        let message = match[1];
        if(lineNum < 0) lineNum = 0;

        diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
                start: { line: lineNum, character: 0 },
                end: { line: lineNum, character: 500 }
            },
            message: "Warning: " + message,
            source: 'raku navigator'
        });
    }
}