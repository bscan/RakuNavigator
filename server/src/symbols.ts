import {
    SymbolInformation,
    Range,
    SymbolKind,
    Location,
    WorkspaceSymbolParams
} from 'vscode-languageserver/node';
import { RakuDocument, RakuElem, RakuSymbolKind } from "./types";
import Uri from 'vscode-uri';
import { realpathSync, existsSync } from 'fs';
import { Console } from 'console';


function waitForDoc (navSymbols: any, uri: string): Promise<RakuDocument> {
    let retries = 0;
    
    return new Promise((resolve, reject) => {
        const interval = setInterval(() => {

            if (++retries > 100) { // Wait for 10 seconds looking for the document. 
                reject(`Could not find ${uri}. If your raku file has any parsing errors, workspace symbols do not work.`);
                clearInterval(interval);
            }
            const RakuDoc = navSymbols.get(uri);

            if (RakuDoc) {
                resolve(RakuDoc);
                clearInterval(interval);
            };
        }, 100);
    });
}

export function getSymbols (navSymbols: any, uri: string ): Promise<SymbolInformation[]> {
    
    return waitForDoc(navSymbols, uri).then((RakuDoc) => {
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
                } else {
                    return;
                }
                const location: Location = {
                    range: {
                        start: { line: element.line, character: 0 },
                        end: { line: element.lineEnd, character: 100 }  
                    },
                    uri: uri
                };
                let displayName = elemName + element.details;
                const newSymbol: SymbolInformation = {
                    kind: kind,
                    location: location,
                    name: displayName
                }

                symbols.push(newSymbol);
            }); 
        });

        return symbols;
    }).catch((reason)=>{
        console.log("Failed in getSymbols");
        console.log(reason);
        return [];
    });
}

