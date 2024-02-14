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
    error: boolean
}

export interface RakuDocument {
    elems: Map<string, RakuElem[]>;
    canonicalElems: Map<string, RakuElem>;
    imported: Map<string, number>;
    parents: Map<string, string>;
    uri: string;
}


export interface RakuElem {
    name: string,
    type: RakuSymbolKind;
    line: number;
    lineEnd: number;
    signature?: string[];
    source: ElemSource;
    uri: string;
    package: string;
};

export enum RakuSymbolKind {
    Class        = "a",
    Module       = 'm',
    Package      = 'p',
    Role         = "b",
    Grammar      = "g",
    Token        = "t",
    Rule         = "r",
    Field        = "f",
    LocalSub     = "s", 
    LocalMethod  = "o", 
    LocalVar     = "v",
    PathedField  = "d",
    Phaser       = "e",
    LocalModule  = "l"
}

// Ensure TagKind and RakuSymbolKind have no overlap
// These are things needing tagging, that aren't really symbols in the code
export enum TagKind {
    UseStatement  = 'u', 
}

export interface CompletionPrefix {
    symbol: string,
    charStart: number,
    charEnd: number,
    stripPackage: boolean,
}

export interface completionElem { 
    rakuElem: RakuElem;
    docUri: string
}

export enum ElemSource {
    symbolTable,
    modHunter,
    parser,
    packageInference,
}

export enum ParseType {
    outline,
    selfNavigation,
    refinement,
}