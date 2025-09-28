import {
    TextDocumentPositionParams,
    SignatureHelp,
    SignatureInformation,
    ParameterInformation,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { RakuDocument, RakuElem, RakuSymbolKind } from './types';

// Lightweight SignatureHelp provider for Raku subs/methods.
// Strategy:
// 1) Parse backward from cursor to detect a callable and the current argument index
// 2) Lookup candidate subs/methods from rakuDoc (multi subs produce multiple signatures)
// 3) Render signature label from name + collected signature params (if available)

type Callsite = {
    callee: string | undefined;
    activeParameter: number;
};

export async function getSignature(
    params: TextDocumentPositionParams,
    rakuDoc: RakuDocument,
    txtDoc: TextDocument,
): Promise<SignatureHelp | undefined> {
    const call = findCallsite(txtDoc, params);
    if (!call || !call.callee) return;

    // Collect matching elements: allow both plain name and module-qualified Foo::bar
    const candidates: RakuElem[] = [];
    const pushMatches = (key: string) => {
        const arr = rakuDoc.elems.get(key);
        if (arr) candidates.push(...arr);
    };
    pushMatches(call.callee);
    if (call.callee.includes('::')) {
        // Also try the rightmost part for method calls like Foo::bar
        const short = call.callee.split('::').pop();
        if (short) pushMatches(short);
    }

    const sigInfos: SignatureInformation[] = [];
    for (const elem of candidates) {
        if (elem.type !== RakuSymbolKind.LocalSub && elem.type !== RakuSymbolKind.LocalMethod) continue;

        const label = buildSignatureLabel(elem);
        const parameters: ParameterInformation[] = (elem.signature || []).map((p) => ({ label: p }));
        sigInfos.push({ label, parameters });
    }

    if (sigInfos.length === 0) return;

    const help: SignatureHelp = {
        signatures: sigInfos,
        activeSignature: 0,
        activeParameter: Math.max(0, call.activeParameter),
    };
    return help;
}

function buildSignatureLabel(elem: RakuElem): string {
    const params = elem.signature && elem.signature.length > 0 ? `(${elem.signature.join(', ')})` : '()';
    const kind = elem.type === RakuSymbolKind.LocalMethod ? 'method' : 'sub';
    return `${kind} ${elem.name} ${params}`.trim();
}

function findCallsite(doc: TextDocument, params: TextDocumentPositionParams): Callsite | undefined {
    const pos = params.position;
    const lineStart = { line: pos.line, character: 0 };
    const lineEnd = { line: pos.line + 1, character: 0 };
    const lineText = doc.getText({ start: lineStart, end: lineEnd });

    // Cursor index within the line
    const idx = doc.offsetAt(pos) - doc.offsetAt(lineStart);
    const left = lineText.substring(0, idx);

    // Track parentheses depth to know current arg index
    let depth = 0;
    let commaCount = 0;
    let callee: string | undefined;
    for (let i = left.length - 1; i >= 0; i--) {
        const ch = left[i];
        if (ch === ')') depth++;
        else if (ch === '(') {
            if (depth === 0) {
                // Found the opening paren of the current call; extract callee before it
                const name = extractCallee(left.substring(0, i));
                callee = name;
                break;
            } else {
                depth--;
            }
        } else if (ch === ',' && depth === 0) {
            commaCount++;
        }
    }

    if (!callee) return;
    return { callee, activeParameter: commaCount };
}

function extractCallee(textLeft: string): string | undefined {
    // Allow identifiers, ::, ->, hyphen in names (Raku allows hyphens in multi subs), and sigils for methods like $.foo
    const re = /([\$@%]?\.?[\w:-]+)(?:\s*(?:->|\.))?\s*$/;
    const m = textLeft.match(re);
    if (!m) return undefined;
    // Strip any trailing method accessor, keep name portion
    return m[1];
}
