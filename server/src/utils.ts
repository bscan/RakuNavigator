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
import { NavigatorSettings, RakuDocument, RakuElem, RakuSymbolKind } from "./types";

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
    return includePaths;
}


export function nLog(message: string, settings: NavigatorSettings){
    // TODO: Remove resource level settings and just use a global logging setting?
    if(settings.logging){
        console.log(message);
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
    }

    return symbol;
}



export function lookupSymbol(rakuDoc: RakuDocument, symbol: string, line: number): RakuElem[] {

    let found = rakuDoc.elems.get(symbol);
    if(found?.length){
        // Simple lookup worked. If we have multiple (e.g. 2 lexical variables), find the nearest earlier declaration. 
        const best = findRecent(found, line);
        return [best];
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