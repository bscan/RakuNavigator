import {
    DefinitionParams,
    Location,
    WorkspaceFolder
} from 'vscode-languageserver/node';
import {
    TextDocument
} from 'vscode-languageserver-textdocument';
import { RakuDocument, RakuElem } from "./types";
import Uri from 'vscode-uri';
import { realpathSync, existsSync  } from 'fs';
import { getSymbol, lookupSymbol, nLog } from "./utils";


export function getDefinition(params: DefinitionParams, rakuDoc: RakuDocument, txtDoc: TextDocument): Location[] | undefined {
    
    let position = params.position
    const symbol = getSymbol(position, txtDoc);

    if(!symbol) return;

    const foundElems = lookupSymbol(rakuDoc, symbol, position.line);

    if(foundElems.length == 0){
        return;
    }

    let locationsFound: Location[] = [];
    
    foundElems.forEach(elem => {
        const elemResolved: RakuElem | undefined = resolveElemForNav(rakuDoc, elem, symbol);
        if(!elemResolved) return;

        // TODO: make this whole thing async
        if(!existsSync(elemResolved.file)) return; // Make sure the file exists and hasn't been deleted.
        let uri =  Uri.file(realpathSync(elemResolved.file)).toString(); // Resolve symlinks
        const newLoc: Location = {
            uri: uri,
            range: { 
                start: { line: elemResolved.line, character: 0 },
                end: { line: elemResolved.line, character: 500}
                }
        }
        locationsFound.push(newLoc);
    });    
    return locationsFound;
}


function resolveElemForNav (rakuDoc: RakuDocument, elem: RakuElem, symbol: string): RakuElem | undefined {
    
    if(elem.file){
        // Have file and is good.
        return elem;
    } 
    return;
}
