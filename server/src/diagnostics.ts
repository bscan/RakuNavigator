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
    let rakuParams: string[] = ["-c"];
    const filePath = Uri.parse(textDocument.uri).fsPath;

    rakuParams = rakuParams.concat(getIncPaths(workspaceFolders, settings));
    nLog("Starting raku compilation check with the equivalent of: " + settings.rakuPath + " " + rakuParams.join(" ") + " " + filePath, settings);

    let output: string;
    let stdout: string;
    let severity: DiagnosticSeverity;
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
        severity = DiagnosticSeverity.Warning;
    } catch(error: any) {
        // TODO: Check if we overflowed the buffer.
        if("stderr" in error && "stdout" in error){
            output = error.stderr;
            stdout = error.stdout;
            severity = DiagnosticSeverity.Error;
        } else {
            nLog("rakucompile failed with unknown error", settings);
            nLog(error, settings);
            return;
        }
    }

    nLog("Raku compilation results", settings);
    nLog(output, settings);

    if(output){
        nLog("Calling maybeAddCompDiag", settings);

        maybeAddCompDiag(output, severity, diagnostics, filePath);
    }
    return {diags: diagnostics};
}


function maybeAddCompDiag(violation: string, severity: DiagnosticSeverity , diagnostics: Diagnostic[], filePath: string): void {

    violation = violation.replace(/\r/g, ""); // Clean up for Windows
    violation = violation.replace(/, <STDIN> line 1\.$/g, ""); // Remove our stdin nonsense
    violation = violation.replace("===SORRY!=== Error while compiling -\n", "");   
    violation = violation.replace("===SORRY!===\n", "");

    const lineNum = localizeErrors(violation, filePath);
    if (typeof lineNum == 'undefined') return;

    diagnostics.push({
        severity: severity,
        range: {
            start: { line: lineNum, character: 0 },
            end: { line: lineNum, character: 500 }
        },
        message: "Syntax: " + violation,
        source: 'raku navigator'
    });
}


function localizeErrors (violation: string, filePath: string): number | void {



    console.log("Trying to match ");
    console.log(violation)
    let match: RegExpExecArray | null;

    if(match = /\nat (.*?):(\d+)\n------>/i.exec(violation)){
        if(match[1] == '-'){
            return +match[2] - 1;
        } else {
            console.log("Did not match filename");
            console.log(match[1]);
            // The error/warnings must be in an imported library (possibly indirectly imported)
            return 0; 
        }
    }

    if(match = /Could not find \S+ at line (\d+) in:/i.exec(violation)){
        return +match[1] - 1;
    }
    
    if(match = /Undeclared (?:routine|name)s?:\n\s*\S+ used at line (\d+)/i.exec(violation)){
        return +match[1] - 1;
    }
    
    return 0;
}