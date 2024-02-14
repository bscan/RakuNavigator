import {
    SymbolInformation,
    Range,
    SymbolKind,
    Location,
    WorkspaceSymbolParams
} from 'vscode-languageserver/node';
import {ParseType,  RakuDocument, RakuElem, RakuSymbolKind } from "./types";

import { parseDocument } from "./parser";

import { TextDocument } from "vscode-languageserver-textdocument";


export async function getSymbols (textDocument: TextDocument, uri: string): Promise<SymbolInformation[]> {
    
    let RakuDoc = await parseDocument(textDocument, ParseType.outline);

    let symbols: SymbolInformation[] = [];
    RakuDoc.elems?.forEach((elements: RakuElem[], elemName: string) => {
        
        elements.forEach(element => {
            let kind: SymbolKind;
            if (element.type == RakuSymbolKind.LocalSub){
                kind = SymbolKind.Function;
            } else if (element.type == RakuSymbolKind.LocalMethod){
                kind = SymbolKind.Method;
            } else if (element.type == RakuSymbolKind.Class){
                kind = SymbolKind.Class;
            } else if (element.type == RakuSymbolKind.Role){
                kind = SymbolKind.Interface;
            } else if (element.type == RakuSymbolKind.Field){
                kind = SymbolKind.Field;
            } else if (element.type == RakuSymbolKind.Grammar){
                kind = SymbolKind.Class;
            } else if (element.type == RakuSymbolKind.Token){
                kind = SymbolKind.TypeParameter;
            } else if (element.type == RakuSymbolKind.Rule){
                kind = SymbolKind.Operator;
            } else if (element.type == RakuSymbolKind.LocalModule){
                kind = SymbolKind.Class;
            }else {
                return;
            }
            const location: Location = {
                range: {
                    start: { line: element.line, character: 0 },
                    end: { line: element.lineEnd, character: 100 }  
                },
                uri: uri
            };
            let displayName = elemName;
            const newSymbol: SymbolInformation = {
                kind: kind,
                location: location,
                name: displayName
            }

            symbols.push(newSymbol);
        });
    });

    return symbols;
}

