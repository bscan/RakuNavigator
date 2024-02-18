import {
    DefinitionParams,
    Location,
    WorkspaceFolder
} from 'vscode-languageserver/node';
import {
    TextDocument
} from 'vscode-languageserver-textdocument';
import { RakuDocument, RakuElem, NavigatorSettings } from "./types";
import Uri from 'vscode-uri';
import { realpathSync, existsSync, realpath  } from 'fs';
import { getSymbol, lookupSymbol, nLog, getIncPaths, async_execFile } from "./utils";
import { dirname, join } from "path";
import { promisify } from 'util';
import { readdir, stat } from 'fs';
import { relative } from 'path';

export function getDefinition(params: DefinitionParams, rakuDoc: RakuDocument, txtDoc: TextDocument, modMap: Map<string, string>): Location[] | undefined {
    
    let position = params.position
    const symbol = getSymbol(position, txtDoc);

    if(!symbol) return;

    const foundElems = lookupSymbol(rakuDoc, modMap, symbol, position.line);

    if(foundElems.length == 0){
        return;
    }

    let locationsFound: Location[] = [];
    
    foundElems.forEach(elem => {
        const elemResolved: RakuElem | undefined = resolveElemForNav(rakuDoc, elem, symbol);
        if(!elemResolved) return;

        const file = Uri.parse(elemResolved.uri).fsPath;
        // TODO: make this whole thing async
        if(!existsSync(file)) return; // Make sure the file exists and hasn't been deleted.
        let uri =  Uri.file(realpathSync(file)).toString(); // Resolve symlinks
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
    
    if(elem.uri){
        // Have file and is good.
        return elem;
    } 
    return;
}



export async function getAvailableMods(workspaceFolders: WorkspaceFolder[] | null, settings: NavigatorSettings): Promise<Map<string, string>> {
    
    let rakuParams: string[] = [];
    rakuParams = rakuParams.concat(getIncPaths(workspaceFolders, settings));

    const modHunterPath = join(dirname(__dirname), 'src', 'raku', 'getMods.raku');
    rakuParams.push(modHunterPath);
    nLog("Starting to dump Raku paths with " + rakuParams.join(" "), settings);

    const mods: Map<string, string> = new Map();

    let output: string;
    try {
        // This can be slow, especially if reading modules over a network or on windows.
        const out = await async_execFile(settings.rakuPath, rakuParams, { timeout: 90000, maxBuffer: 20 * 1024 * 1024 });
        output = out.stdout;
        nLog("Success running getPaths", settings);
    } catch (error: any) {
        nLog("getPaths failed. You will lose autocomplete on importing modules.", settings);
        nLog(error, settings);
        return mods;
    }
   
    output.split("\n").forEach((mod) => {
        var items = mod.split("\t");

        if (items.length != 5 || items[1] != "M" || !items[2] || !items[3]) {
            return;
        }
        // Load file

        realpath(items[3], function (err, path) {
            if (err) {
                // Skip if error
            } else {
                if (!path) return; // Could file be empty, but no error?
                let uri = Uri.file(path).toString(); // Resolve symlinks
                mods.set(items[2], uri);
            }
        });
    });
    return mods;
}