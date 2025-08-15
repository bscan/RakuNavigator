import {
    Diagnostic,
    DiagnosticSeverity,
} from 'vscode-languageserver/node';
import { NavigatorSettings, CompilationResults, ParseType} from "./types";
import {
        WorkspaceFolder
} from 'vscode-languageserver-protocol';
import { join } from 'path';
import { tmpdir } from 'os';
import { promises as fs } from 'fs';
import { getIncPaths, async_execFile, nLog } from './utils';


import {
    TextDocument
} from 'vscode-languageserver-textdocument';

export async function rakucompile(textDocument: TextDocument, workspaceFolders: WorkspaceFolder[] | null, settings: NavigatorSettings): Promise<CompilationResults | void> {

    let rakuParams: string[] = [];

    rakuParams = rakuParams.concat(getIncPaths(workspaceFolders, settings));

    const code = textDocument.getText();
    const tmpFile = join(tmpdir(), `raku-navigator-${process.pid}-${Date.now()}.raku`);
    try {
        await fs.writeFile(tmpFile, code, 'utf8');
    } catch (error) {
        nLog("Failed to write temporary file for compilation", settings);
        nLog(String(error), settings);
        return;
    }

    rakuParams = rakuParams.concat(['-c', tmpFile]);

    nLog(`Starting raku compilation check with "${settings.rakuPath} ${rakuParams.join(" ")}"`, settings);

    let stderr: string = '';
    let stdout: string = '';
    const diagnostics: Diagnostic[] = [];

    let myenv = { ...process.env };
    myenv.RAKUDO_ERROR_COLOR = '0';
    myenv.RAKU_EXCEPTIONS_HANDLER = 'JSON';

    let bErrors = false;
    try {
        const out = await async_execFile(settings.rakuPath, rakuParams, {timeout: 10000, maxBuffer: 20 * 1024 * 1024, env: myenv});
        stderr = out.stderr;
        stdout = out.stdout;
    } catch(error: any) {
        // TODO: Check if we overflowed the buffer.
        if("stderr" in error && "stdout" in error){
            stderr = error.stderr;
            stdout = error.stdout;
            bErrors = true; // Indicates compilation errors
        } else {
            nLog("rakucompile failed with unknown error", settings);
            nLog(String(error), settings);
            try { await fs.unlink(tmpFile); } catch (_) {}
            return;
        }
    }

    if(stderr){
        if(!parseJSON(stderr, diagnostics, textDocument)){
            parseUnhandled(stderr, diagnostics);
        } else {
            bErrors = true;
        }
    }

    if(stdout && stdout.trim() && stdout.trim() !== 'Syntax OK'){
        parseUnhandled(stdout, diagnostics);
    }

    try { await fs.unlink(tmpFile); } catch (_) {}

    return {diags: diagnostics, error: bErrors};
}


// Try to parse a value as JSON if it looks like JSON; otherwise return undefined
function tryParseJSON<T = any>(val: unknown): T | undefined {
    if (typeof val !== 'string') return undefined;
    const s = val.trim();
    if (!s) return undefined;
    if (!(s.startsWith('{') || s.startsWith('['))) return undefined;
    try {
        return JSON.parse(s) as T;
    } catch {
        return undefined;
    }
}

function parseJSON(stderr: string, diagnostics: Diagnostic[], document?: TextDocument): boolean {
    stderr = stderr.replace(/\r/g, "").trim();
    if(!stderr) return false;

    let parsed = false;
    const lines = stderr.split(/\n+/);
    lines.forEach(line => {
        line = line.trim();
        if(!line) return;
        try {
            const obj = JSON.parse(line);
            Object.keys(obj).forEach(key => {
                const err = (obj as any)[key];
                // Unwrap nested JSON-encoded message/payload when present (e.g., X::AdHoc+{X::Comp} wrapping inner exception)
                let inner: any | undefined;
                const msgObj = tryParseJSON(err?.message);
                const payloadObj = tryParseJSON(err?.payload);
                if (msgObj && typeof msgObj === 'object') {
                    const innerKey = Object.keys(msgObj)[0];
                    inner = (msgObj as any)[innerKey];
                } else if (payloadObj && typeof payloadObj === 'object') {
                    const innerKey = Object.keys(payloadObj)[0];
                    inner = (payloadObj as any)[innerKey];
                }

                // Location: prefer outer error location (points to the 'use' or callsite) so the user sees the failing import line.
                let lineNum = (err['line-real'] ?? err['line'] ?? 1) - 1;
                let charNum = (err['column'] ?? 1) - 1;

                // If we have a document and position info, compute a better location
                if(document && typeof err['pos'] === 'number'){
                    const pos = err['pos'] - 1; // Raku uses 1-based offsets
                    const loc = document.positionAt(pos);
                    lineNum = loc.line;
                    charNum = loc.character;
                }

                if(lineNum < 0) lineNum = 0;
                if(charNum < 0) charNum = 0;

                // Compose a clearer message, surfacing inner details when available
                let message = err?.reason ?? err?.message ?? key;
                if (inner) {
                    const innerMsg = inner?.reason ?? inner?.message ?? '(unknown error)';
                    const innerFile = inner?.filename ?? inner?.file;
                    const innerLine = inner?.['line-real'] ?? inner?.line;
                    const where = innerFile ? `${innerFile}${innerLine ? `:${innerLine}` : ''}` : '';
                    // Highlight this as an import/compile-time failure with context
                    if (where) {
                        message = `Import failed: ${innerMsg} (${where})`;
                    } else {
                        message = `Import failed: ${innerMsg}`;
                    }
                }

                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: { line: lineNum, character: charNum },
                        end: { line: lineNum, character: charNum + 1 }
                    },
                    message,
                    source: 'raku navigator'
                });
                parsed = true;
            });
        } catch (_) {
            // Not JSON, ignore here
        }
    });
    return parsed;
}


// Some warnings are not currently caught within Raku and leak into STDERR. Let's catch them here and categorize them
function parseUnhandled(violations: string, diagnostics: Diagnostic[]): void {
    violations = violations.replace(/\r/g, ""); // Clean up for Windows

    let match: RegExpExecArray | null;
    let lineNum: number;
    // Currently we compile twice and get double warnings. This hack cuts it down.
    // TODO: Any actual examples of this now that we compile differently?
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