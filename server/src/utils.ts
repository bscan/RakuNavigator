import {
	WorkspaceFolder
} from 'vscode-languageserver-protocol';
import Uri from 'vscode-uri';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
    TextDocument,
    Position
} from 'vscode-languageserver-textdocument';
import { NavigatorSettings, RakuDocument, RakuElem, RakuSymbolKind, ElemSource } from "./types";
import { workspaceIndex } from "./workspaceIndex";
import { promises } from "fs";
import { existsSync } from 'fs';
import { join } from 'path';

export const async_execFile = promisify(execFile);

// TODO: This behaviour should be temporary. Review and update treatment of multi-root workspaces
export function getIncPaths(workspaceFolders: WorkspaceFolder[] | null, settings: NavigatorSettings): string[] {
    let includePaths: string[] = [];

    settings.includePaths.forEach(path => {
        if (/\$workspaceFolder/.test(path)) {
            if (workspaceFolders) {
                workspaceFolders.forEach(workspaceFolder => {
                    const incPath = Uri.parse(workspaceFolder.uri).fsPath;
                    includePaths = includePaths.concat(["-I", path.replace(/\$workspaceFolder/g, incPath)]);
                });
            } else {
                nLog("You used $workspaceFolder in your config, but didn't add any workspace folders. Skipping " + path, settings);
            }
        } else {
            includePaths = includePaths.concat(["-I", path]);
        }
    });

    // Automatically include ./lib from each workspace folder
    if (workspaceFolders) {
        workspaceFolders.forEach(workspaceFolder => {
            const wsPath = Uri.parse(workspaceFolder.uri).fsPath;
            const libPath = join(wsPath, 'lib');
            if (existsSync(libPath)) {
                includePaths = includePaths.concat(["-I", libPath]);
            }
        });
    }
    return includePaths;
}


export function nLog(message: string, settings: NavigatorSettings){
    // TODO: Remove resource level settings and just use a global logging setting?
    if(settings.logging){
        console.error(message);
    }
}



export function getSymbol(position: Position, txtDoc: TextDocument) {
    // Gets symbol from text at position. 
    // Ignore :: going left, but stop at :: when going to the right. (e.g Foo::bar::baz should be clickable on each spot)
    // Todo: Only allow -> once.
    // Used for navigation and hover.

    const start = { line: position.line, character: 0 };
    const end = { line: position.line + 1, character: 0 };
    const text = txtDoc.getText({ start, end });

    const index = txtDoc.offsetAt(position) - txtDoc.offsetAt(start);


    const leftRg = /[\p{L}\p{N}_:>-]/u;
    const rightRg = /[\p{L}\p{N}_-]/u;

    const leftAllow  = (c: string) => leftRg.exec(c);
    const rightAllow = (c: string) => rightRg.exec(c);

    let left = index - 1;
    let right = index;

    while (left >= 0 && leftAllow(text[left])) {
        left -= 1;
    }
    left = Math.max(0, left + 1);
    while (right < text.length && rightAllow(text[right])) {
        right += 1;
    }
    right = Math.max(left, right);

    let symbol = text.substring(left, right);
    const lChar  = left > 0 ? text[left-1] : "";
    const llChar = left > 1 ? text[left-2] : "";
    const rChar  = right < text.length  ? text[right] : "";

    if(['@', '%', '$'].includes(lChar)){ 
        symbol = lChar + symbol;   // @foo, %foo -> @foo, %foo
    }else if(lChar === '{' && rChar === '}' && ["$", "%", "@"].includes(llChar)){
        symbol = llChar + symbol;  // ${foo} -> $foo
    }else if(lChar === '.' && ["$", "%", "@"].includes(llChar)){
        symbol = llChar + lChar + symbol;  // $.documents
    }

    return symbol;
}



export function lookupSymbol(rakuDoc: RakuDocument, modMap: Map<string, string>, symbol: string, line: number): RakuElem[] {

    let found = rakuDoc.elems.get(symbol);
    if(found?.length){
        // Variables: choose the most recent earlier declaration
        if (/^[\$@%]/.test(symbol)) {
            const best = findRecent(found, line);
            // Debug: local match found
            // Note: No settings at this call site, so rely on global logging default
            nLog(`lookupSymbol: local match for ${symbol} at line ${best.line}`, { rakuPath: '', includePaths: [], logging: true, syntaxCheckEnabled: true });
            return [best];
        }
        // Subroutines/methods and other non-sigil symbols: return all matches (e.g., multi subs)
        nLog(`lookupSymbol: local multi matches for ${symbol} -> ${found.length} symbol(s)`, { rakuPath: '', includePaths: [], logging: true, syntaxCheckEnabled: true });
        return found;
    }

    let foundMod = modMap.get(symbol);
    if (foundMod) {
        // Ideally we would've found the module in the rakuDoc, but perhaps it was "required" instead of "use'd"
        const modUri = Uri.parse(foundMod).toString();
        const modElem: RakuElem = {
            name: symbol,
            type: RakuSymbolKind.Module,
            uri: modUri,
            package: symbol,
            line: 0,
            lineEnd: 0,
            source: ElemSource.modHunter,
        };
    nLog(`lookupSymbol: module map match for ${symbol}`, { rakuPath: '', includePaths: [], logging: true, syntaxCheckEnabled: true });
    return [modElem];
    }


    // let qSymbol = symbol;
    // // qSymbol = qSymbol.replaceAll("->", "::"); // Module->method() can be found via Module::method

    // if (qSymbol.includes("::") && symbol.includes("->")) {
    //     // Launching to the wrong explicitly stated module is a bad experience, and common with "require'd" modules
    //     const method = qSymbol.split("::").pop();
    //     if (method) {
    //         // Perhaps the method is within our current scope, explictly imported, or an inherited method (dumper by Inquisitor)
    //         found = rakuDoc.elems.get(method);
    //         if (found?.length) return [found[0]];

    //         // Haven't found the method yet, let's check if anything could be a possible match since you don't know the object type
    //         let foundElems: RakuElem[] = [];
    //         rakuDoc.elems.forEach((elements: RakuElem[], elemName: string) => {
    //             const element = elements[0]; // All Elements are with same name are normally the same.
    //             const elemMethod = elemName.split("::").pop();
    //             if (elemMethod == method) {
    //                 foundElems.push(element);
    //             }
    //         });
    //         if (foundElems.length > 0) return foundElems;
    //     }
    // }

    // Fall back to workspace token/rule index if nothing found locally
    const ws = workspaceIndex.findByName(symbol);
    if (ws.length > 0) {
        nLog(`lookupSymbol: workspace index match for ${symbol} -> ${ws.length} symbol(s)`, { rakuPath: '', includePaths: [], logging: true, syntaxCheckEnabled: true });
        return ws;
    }

    return [];
}


function findRecent (found: RakuElem[], line: number){
    let best = found[0];
    for (var i = 0; i < found.length; i++){
        // Find the most recently declared variable.
        if( found[i].line > best.line && found[i].line <= line ){
            best = found[i];
        }
    };
    return best;
}

export async function isFile(file: string): Promise<boolean> {
    try {
        const stats = await promises.stat(file);
        return stats.isFile();
    } catch (err) {
        // File or directory doesn't exist
        return false;
    }
}
