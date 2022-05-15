import {
    TextDocumentPositionParams,
    CompletionItem,
    CompletionItemKind,
    Range,
    MarkupContent
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { RakuDocument, RakuElem, CompletionPrefix, RakuSymbolKind } from "./types";


export function getCompletions(params: TextDocumentPositionParams, rakuDoc: RakuDocument, txtDoc: TextDocument): CompletionItem[] {

    let position = params.position
    const start = { line: position.line, character: 0 };
    const end = { line: position.line + 1, character: 0 };
    const text = txtDoc.getText({ start, end });

    const index = txtDoc.offsetAt(position) - txtDoc.offsetAt(start);

    const prefix = getPrefix(text, index);

    if(!prefix.symbol) return [];

    const replace: Range = {
            start: { line: position.line, character: prefix.charStart },
            end: { line: position.line, character: prefix.charEnd }  
    };

    const matches = getMatches(rakuDoc, prefix.symbol, replace);
    return matches;

}


// Similar to getSymbol for navigation, but don't "move right". 
function getPrefix(text: string, position: number): CompletionPrefix {

    const leftAllow  = (c: string) => /[\w\:\>\-]/.exec(c);

    let left = position - 1;

    while (left >= 0 && leftAllow(text[left])) {
        left -= 1;
    }
    left = Math.max(0, left + 1);

    let symbol = text.substring(left, position);
    const lChar  = left > 0 ? text[left-1] : "";

    if(lChar === '$' || lChar === '@' || lChar === '%'){
        symbol = lChar + symbol;
        left -= 1;
    }

    return {symbol: symbol, charStart: left, charEnd: position};
}


function getMatches(rakuDoc: RakuDocument, symbol: string,  replace: Range): CompletionItem[] {

    let matches: CompletionItem[] = [];

    rakuDoc.elems.forEach((elements: RakuElem[], elemName: string) => {
        if(/^[\$\@\%].$/.test(elemName)) return; // Remove single character magic raku variables. Mostly clutter the list

        let element = elements[0]; // Get the canonical (typed) element, otherwise just grab the first one.

        if ( elemName.startsWith(symbol) ){
            matches = matches.concat(buildMatches(elemName, element, replace));
        }
    });

    return matches;

}


function buildMatches(lookupName: string, elem: RakuElem, range: Range): CompletionItem[] {

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

    labelsToBuild.forEach(label => {
        matches.push({
            label: label,
            textEdit: {newText: label, range},
            kind: kind,
            detail: detail,
            documentation: documentation,
        });
    });

    return matches
}

