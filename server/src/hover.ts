import { TextDocumentPositionParams, Hover, MarkupContent, MarkupKind } from "vscode-languageserver/node";
import { TextDocument } from 'vscode-languageserver-textdocument';
import { RakuDocument, RakuElem, RakuSymbolKind } from "./types";
import { getSymbol, lookupSymbol } from "./utils";
import { getDoc } from './docs';

export async function getHover(params: TextDocumentPositionParams, rakuDoc: RakuDocument, txtDoc: TextDocument, modMap: Map<string, string>): Promise<Hover | undefined> {

    let position = params.position
    const symbol = getSymbol(position, txtDoc);

    let elem = rakuDoc.canonicalElems.get(symbol);

    if(!elem){
        const elems = lookupSymbol(rakuDoc, modMap, symbol, position.line);
        if(elems.length != 1) return; // Nothing or too many things.
        elem = elems[0];
    }

    let title = buildHoverDoc(symbol, elem);
    if(!title) return; // Sometimes, there's nothing worth showing.

    let merged = title;


    let docs = await getDoc(elem, rakuDoc, modMap);

    if(docs){
        if(!docs.startsWith("\n"))
            docs = "\n" + docs; // Markdown requires two newlines to make one
        merged += `\n${docs}`;
    }
    
    const hoverContent: MarkupContent = {
        kind: MarkupKind.Markdown,
        value: merged
    };
    
    const documentation: Hover = { contents: hoverContent };

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
    } else if (elem.type == RakuSymbolKind.Module || elem.type == RakuSymbolKind.LocalModule){
        desc = `(module) ${symbol}`;
    }  else if (elem.type == RakuSymbolKind.Package){
        desc = `(package) ${symbol}`;
    } 
    else {
        // We should never get here
        desc = `Unknown: ${symbol}`;
    }


    return desc;
}
