import {
    TextDocumentPositionParams,
    CompletionItem,
    CompletionItemKind,
    Range,
    MarkupContent
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { RakuDocument, CompletionPrefix, RakuSymbolKind, completionElem, ElemSource, RakuElem} from "./types";
import Uri from "vscode-uri";
import { getDoc } from "./docs";


export function getCompletions(params: TextDocumentPositionParams, rakuDoc: RakuDocument, txtDoc: TextDocument, modMap: Map<string, string>): CompletionItem[] {

    let position = params.position
    const start = { line: position.line, character: 0 };
    const end = { line: position.line + 1, character: 0 };
    const text = txtDoc.getText({ start, end });

    const index = txtDoc.offsetAt(position) - txtDoc.offsetAt(start);

    const imPrefix = getImportPrefix(text, index);
    if (imPrefix) {
        const replace: Range = {
            start: { line: position.line, character: imPrefix.charStart },
            end: { line: position.line, character: imPrefix.charEnd },
        };

        const matches = getImportMatches(modMap, imPrefix.symbol, replace, rakuDoc);
        return matches;
    } else {

        const prefix = getPrefix(text, index);

        if(!prefix.symbol) return [];

        const replace: Range = {
                start: { line: position.line, character: prefix.charStart },
                end: { line: position.line, character: prefix.charEnd }  
        };

        const matches = getMatches(rakuDoc, prefix.symbol, replace);
        return matches;
    }

}

export async function getCompletionDoc(elem: RakuElem, perlDoc: RakuDocument, modMap: Map<string, string>): Promise<string | undefined> {
    let docs = await getDoc(elem, perlDoc, modMap);
    return docs;
}

// Similar to getSymbol for navigation, but don't "move right". 
function getPrefix(text: string, position: number): CompletionPrefix {

    const leftAllow  = (c: string) => /[\.\w\:\>\-]/.exec(c);

    let left = position - 1;

    while (left >= 0 && leftAllow(text[left])) {
        left -= 1;
    }
    left = Math.max(0, left + 1);

    let symbol = text.substring(left, position);
    const lChar  = left > 0 ? text[left-1] : "";
    const llChar  = left > 1 ? text[left-2] : "";


    if(lChar === '$' || lChar === '@' || lChar === '%'){
        symbol = lChar + symbol;
        left -= 1;
    } else if(lChar === '.' && ( llChar === '$' || llChar === '@' || llChar === '%')) {
        symbol = llChar + lChar + symbol;
        left -= 2;
    }
    console.log("Symbol: " + symbol + " Left: " + left + " Position: " + position);
    return {symbol: symbol, charStart: left, charEnd: position, stripPackage: false};
}


// First we check if it's an import statement, which is a special type of autocomplete with far more options
function getImportPrefix(text: string, position: number): CompletionPrefix | undefined {
    text = text.substring(0, position);

    let partialImport = /^\s*(?:use|require)\s+([\w:]+)$/.exec(text);
    if (!partialImport) return;
    const symbol = partialImport[1];

    return { symbol: symbol, charStart: position - symbol.length, charEnd: position, stripPackage: false };
}

function getImportMatches(modMap: Map<string, string>, symbol: string, replace: Range, rakuDoc: RakuDocument): CompletionItem[] {
    const matches: CompletionItem[] = [];
    const mods = Array.from(modMap.keys());

    const lcSymbol = symbol.toLowerCase();
    modMap.forEach((modFile, mod) => {
        if (mod.toLowerCase().startsWith(lcSymbol)) {

            const modUri = Uri.parse(modFile).toString();
            const modElem: RakuElem = {
                name: symbol,
                type: RakuSymbolKind.Module,
                uri: modUri,
                package: symbol,
                line: 0,
                lineEnd: 0,
                source: ElemSource.modHunter,
            };
            const newElem: completionElem = {rakuElem: modElem, docUri: rakuDoc.uri}

            matches.push({
                label: mod,
                textEdit: { newText: mod, range: replace },
                kind: CompletionItemKind.Module,
                data: newElem
            });
        }
    });
    return matches;
}


function getMatches(rakuDoc: RakuDocument, symbol: string,  replace: Range): CompletionItem[] {

    let matches: CompletionItem[] = [];

    rakuDoc.elems.forEach((elements: RakuElem[], elemName: string) => {
        if(/^[\$\@\%].$/.test(elemName)) return; // Remove single character magic raku variables. Mostly clutter the list

        let element = elements[0]; // Get the canonical (typed) element, otherwise just grab the first one.

        if ( elemName.startsWith(symbol) ){
            matches = matches.concat(buildMatches(elemName, element, replace, false, rakuDoc));
        }
    });

    return matches;

}


function buildMatches(lookupName: string, elem: RakuElem, range: Range, stripPackage: boolean, rakuDoc: RakuDocument): CompletionItem[] {

    let kind: CompletionItemKind;
    let detail: string | undefined = undefined;
    let documentation: MarkupContent | undefined = undefined;

    if(elem.type == RakuSymbolKind.LocalVar){ 
        kind = CompletionItemKind.Variable;
    } else if (elem.type == RakuSymbolKind.Class){
        kind = CompletionItemKind.Class;
    } else if (elem.type == RakuSymbolKind.Role){
        kind = CompletionItemKind.Interface;
    } else if (elem.type == RakuSymbolKind.Field ){
        kind = CompletionItemKind.Field;
    } else if (elem.type == RakuSymbolKind.Grammar ){
        kind = CompletionItemKind.Class;
    } else if (elem.type == RakuSymbolKind.LocalMethod ){
        kind = CompletionItemKind.Method;
    } else if (elem.type == RakuSymbolKind.LocalSub ){
        kind = CompletionItemKind.Function;
    } else if (elem.type == RakuSymbolKind.Token ){
        kind = CompletionItemKind.TypeParameter;
    } else if (elem.type == RakuSymbolKind.Rule ){
        kind = CompletionItemKind.Operator;
    } else {        // A sign that something needs fixing. Everything should've been enumerated. 
        kind = CompletionItemKind.Property;
    }

    let labelsToBuild = [lookupName];

    let matches: CompletionItem[] = [];

    const newElem: completionElem = {rakuElem: elem, docUri: rakuDoc.uri}

    labelsToBuild.forEach(label => {
        matches.push({
            label: label,
            textEdit: {newText: label, range},
            kind: kind,
            detail: detail,
            documentation: documentation,
            data: newElem,
        });
    });

    return matches
}

