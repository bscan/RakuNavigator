import {
    SymbolInformation,
    SymbolKind,
    Location
} from 'vscode-languageserver/node';
import {ParseType,  RakuDocument, RakuElem, RakuSymbolKind } from "./types";

import { parseDocument } from "./parser";

import { TextDocument } from "vscode-languageserver-textdocument";

export function mapRakuSymbolKind(kind: RakuSymbolKind): SymbolKind | null {
    if (kind == RakuSymbolKind.LocalSub) {
        return SymbolKind.Function;
    } else if (kind == RakuSymbolKind.LocalMethod) {
        return SymbolKind.Method;
    } else if (kind == RakuSymbolKind.Class) {
        return SymbolKind.Class;
    } else if (kind == RakuSymbolKind.Role) {
        return SymbolKind.Interface;
    } else if (kind == RakuSymbolKind.Field) {
        return SymbolKind.Field;
    } else if (kind == RakuSymbolKind.Grammar) {
        return SymbolKind.Class;
    } else if (kind == RakuSymbolKind.Token) {
        return SymbolKind.TypeParameter;
    } else if (kind == RakuSymbolKind.Rule) {
        return SymbolKind.Operator;
    } else if (kind == RakuSymbolKind.LocalModule) {
        return SymbolKind.Class;
    }
    return null;
}


export async function getSymbols (textDocument: TextDocument, uri: string): Promise<SymbolInformation[]> {
    
    let RakuDoc = await parseDocument(textDocument, ParseType.outline);

    let symbols: SymbolInformation[] = [];
    RakuDoc.elems?.forEach((elements: RakuElem[], elemName: string) => {
        
        elements.forEach(element => {
            const kind = mapRakuSymbolKind(element.type as RakuSymbolKind);
            if (kind === null) return;
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

