import {
    Diagnostic,
    DiagnosticSeverity,
} from 'vscode-languageserver/node';
import { NavigatorSettings, CompilationResults, ParseType} from "./types";
import {
        WorkspaceFolder
} from 'vscode-languageserver-protocol';
import { getIncPaths, nLog, async_execFile } from './utils';


import {
    TextDocument
} from 'vscode-languageserver-textdocument';

export async function rakucompile(textDocument: TextDocument, workspaceFolders: WorkspaceFolder[] | null, settings: NavigatorSettings): Promise<CompilationResults | void> {

    let rakuParams: string[] = [];

    rakuParams = rakuParams.concat(getIncPaths(workspaceFolders, settings));

    const code = textDocument.getText();
    // Compile from STDIN: "-c -" checks syntax only and reads program from stdin
    rakuParams = rakuParams.concat(['-c', '-']);

    nLog(`Starting raku compilation check with "${settings.rakuPath} ${rakuParams.join(" ")}"`, settings);

    let stderr: string = '';
    let stdout: string = '';
    const diagnostics: Diagnostic[] = [];

    let myenv = { ...process.env };
    myenv.RAKUDO_ERROR_COLOR = '0';
    myenv.RAKU_EXCEPTIONS_HANDLER = 'JSON';

    let bErrors = false;
    // Spawn raku and pipe the document on stdin to avoid temp files
    const maxBuffer = 20 * 1024 * 1024; // 20MB
    try {
        const out = await runWithStdin(settings.rakuPath, rakuParams, { env: myenv, timeout: 10000, maxBuffer }, code);
        stderr = out.stderr;
        stdout = out.stdout;
        bErrors = out.code !== 0; // non-zero exit indicates compilation errors
    } catch (error: any) {
        // Surface any captured output
        if (error && ("stderr" in error || "stdout" in error)) {
            stderr = String(error.stderr || '');
            stdout = String(error.stdout || '');
            bErrors = true;
        } else {
            nLog("rakucompile failed with unknown error", settings);
            nLog(String(error), settings);
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

    return {diags: diagnostics, error: bErrors};
}

// Execute a command, writing `input` to stdin; resolves with stdout/stderr on exit.
// Implements a timeout and basic maxBuffer enforcement similar to execFile.
export function execWithStdin(cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv, timeout?: number, maxBuffer?: number }, input: string): Promise<{ stdout: string, stderr: string, code: number | null, signal: NodeJS.Signals | null }> {
    // Use promisified execFile so we get built-in timeout/maxBuffer handling,
    // but feed stdin by accessing the underlying child via the Promise's .child property.
    return new Promise((resolve) => {
        const procPromise: any = async_execFile(cmd, args, { env: opts.env, timeout: opts.timeout, maxBuffer: opts.maxBuffer });
        // Best-effort stdin write
        try {
            procPromise?.child?.stdin?.write(input);
            procPromise?.child?.stdin?.end();
        } catch (_) {
            // Ignore stdin errors; exec will still surface process results below
        }
        procPromise
            .then((out: { stdout: string; stderr: string }) => {
                resolve({ stdout: out.stdout, stderr: out.stderr, code: 0, signal: null });
            })
            .catch((err: any) => {
                // execFile rejects on non-zero exit; convert to a resolved result with code/signal
                resolve({
                    stdout: String(err?.stdout ?? ''),
                    stderr: String(err?.stderr ?? ''),
                    code: typeof err?.code === 'number' ? err.code : 1,
                    signal: (err?.signal ?? null) as NodeJS.Signals | null,
                });
            });
    });
}

// Stub-able runner used by rakucompile; tests can overwrite this export.
export let runWithStdin = execWithStdin;


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
                        start: { line: lineNum, character: 0 },
                        end: { line: lineNum, character: 500 }
                    },
                    message: "Syntax: " + message,
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
    // Support both indented and non-indented warning/location forms
    // 1. Indented:   <msg>\n   at ...:N
    // 2. Non-indented: <msg>\nin ... at ... line N
    const reIndented = /^\s+(.+?)\n\s+at.+\:(\d+)$/gm;
    const reBlock = /^(.+?)\n\s*in .+ at .+ line (\d+)$/gm;

    // Indented form
    while ((match = reIndented.exec(violations))) {
        lineNum = +match[2] - 1;
        let message = match[1];
        if (lineNum < 0) lineNum = 0;
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

    // Non-indented 'in ... at ... line N' form
    while ((match = reBlock.exec(violations))) {
        lineNum = +match[2] - 1;
        let message = match[1];
        if (lineNum < 0) lineNum = 0;
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