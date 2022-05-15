import {
    TextDocumentPositionParams,
    Hover,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { RakuDocument, RakuElem } from "./types";
import { getSymbol, lookupSymbol } from "./utils";

export function getHover(params: TextDocumentPositionParams, rakuDoc: RakuDocument, txtDoc: TextDocument): Hover | undefined {

    let position = params.position
    const symbol = getSymbol(position, txtDoc);

    let elem = rakuDoc.canonicalElems.get(symbol);

    if(!elem){
        const elems = lookupSymbol(rakuDoc, symbol, position.line);
        if(elems.length != 1) return; // Nothing or too many things.
        elem = elems[0];
    }

    let hoverStr = buildHoverDoc(symbol, elem);
    if(!hoverStr) return; // Sometimes, there's nothing worth showing.

    const documentation = {contents: hoverStr};

    return documentation;
}

function buildHoverDoc(symbol: string, elem: RakuElem){

    let desc = "";
     if(elem.type == 'v'){
        // desc = `(variable) ${symbol}`; //  Not very interesting info
    } else if (elem.type == 's'){
        desc = `(subroutine) ${symbol}`;
    } else if (elem.type == 'o'){
        desc = `(method) ${symbol}`;
    } else if (elem.type == 'g'){ 
        desc = `(grammar) ${symbol}`;
    } else if (elem.type == 'a'){
        desc = `(class) ${symbol}`;
    } else if (elem.type == 'b'){
        desc = `(role) ${symbol}`;
    } else if (elem.type == 'f'){
        desc = `(attribute) ${symbol}`;
    } else if (elem.type == 't'){
        desc = `(token) ${symbol}`;
    } else if (elem.type == 'r'){
        desc = `(rule) ${symbol}`;
    } else {
        // We should never get here
        desc = `Unknown: ${symbol}`;
    }


    return desc;
}
