// Settings for rakunavigator,
// defaults for configurable editors stored in package.json
// defaults for non-configurable editors in server.ts

import {
    Diagnostic,
} from 'vscode-languageserver/node';


export interface NavigatorSettings {
    rakuPath: string;
    includePaths: string[];
    logging: boolean;
}

export interface CompilationResults {
    diags: Diagnostic[],
    rakuDoc: RakuDocument,
    error: boolean
}

export interface RakuDocument {
    elems: Map<string, RakuElem[]>;
    canonicalElems: Map<string, RakuElem>;
    imported: Map<string, number>;
    parents: Map<string, string>;
}


export interface RakuElem {
    name: string,
    type: RakuSymbolKind;
    details: string,
    file: string;
    line: number;
    lineEnd: number;
};

export enum RakuSymbolKind {
    Class        = "a",
    Role         = "b",
    Grammar      = "g",
    Token        = "t",
    Rule         = "r",
    Field        = "f",
    LocalSub     = "s", 
    LocalMethod  = "o", 
    LocalVar     = "v",
    // Phaser       = "e",
}

export interface CompletionPrefix {
    symbol: string,
    charStart: number,
    charEnd: number,
}
