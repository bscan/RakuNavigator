/* Raku Navigator server. See licenses.txt file for licensing and copyright information */

import {
    createConnection,
    TextDocuments,
    Diagnostic,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    TextDocumentSyncKind,
    Location,
    InitializeResult,
    WorkspaceFolder,
    CompletionItem,
    CompletionList,
    TextDocumentPositionParams,
    SymbolInformation,
    WorkspaceSymbolParams,
} from 'vscode-languageserver/node';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';
import {
    PublishDiagnosticsParams
} from 'vscode-languageserver-protocol';

import Uri from 'vscode-uri';
import { getDefinition, getAvailableMods } from "./navigation";
import { NavigatorSettings, RakuDocument, ParseType, RakuElem, RakuSymbolKind } from "./types";
import { rakucompile } from "./diagnostics";
import { nLog, getSymbol } from './utils';
import { getSymbols, mapRakuSymbolKind } from "./symbols";
import { getHover } from "./hover";
import { getCompletions, getCompletionDoc } from './completion';
import { getSignature } from './signature';
import { parseDocument } from "./parser";
import { workspaceIndex, resetWorkspaceIndex } from './workspaceIndex';
import { formatDocument, formatRange } from './formatting';

var LRU = require("lru-cache");

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

const navSymbols = new LRU({max: 350000, length: function (value:RakuDocument , key:string) { return value.elems.size }});

// Workspace-wide token index singleton is imported

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

connection.onInitialize((params: InitializeParams) => {
    const capabilities = params.capabilities;

    // Does the client support the `workspace/configuration` request?
    // If not, we fall back using global settings.
    hasConfigurationCapability = !!(
        capabilities.workspace && !!capabilities.workspace.configuration
    );
    hasWorkspaceFolderCapability = !!(
        capabilities.workspace && !!capabilities.workspace.workspaceFolders
    );

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: true,
                triggerCharacters: ['$','@','%','-', '>',':','.']
            },
            signatureHelpProvider: {
                triggerCharacters: ['(', ','],
                retriggerCharacters: [',']
            },
            documentSymbolProvider: true, // Outline view and breadcrumbs
            workspaceSymbolProvider: true, // Workspace symbol search
            definitionProvider: true, // goto definition
            hoverProvider: true,
            documentFormattingProvider: true, // Format Document
            documentRangeFormattingProvider: true, // Format Selection
        }
    };
    if (hasWorkspaceFolderCapability) {
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true
            }
        };
    }
    return result;
});

connection.onInitialized(() => {
    if (hasConfigurationCapability) {
        // Register for all configuration changes.
        connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders(_event => {
        // Rebuild workspace token index on folder change
        resetWorkspaceIndex();
    getWorkspaceFoldersSafe().then(async (folders) => {
            const anyDoc = documents.all()[0];
            const settings = anyDoc ? await getDocumentSettings(anyDoc.uri) : globalSettings;
            nLog('Workspace folders changed; rebuilding token index', settings);
            await workspaceIndex.build(folders, settings);
        });
        });
    }

    // Build initial workspace index and register to file change notifications
    getWorkspaceFoldersSafe().then(async (folders) => {
        const anyDoc = documents.all()[0];
        const settings = anyDoc ? await getDocumentSettings(anyDoc.uri) : globalSettings;
        nLog('Initial workspace token index build starting', settings);
        await workspaceIndex.build(folders, settings);
    });
});


// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Does not happen with the vscode client could happen with other clients.
// The "real" default settings are in the top-level package.json
const defaultSettings: NavigatorSettings = {
    rakuPath: "raku",
    includePaths: [],
    logging: false, // Get logging from vscode, but turn it off elsewhere. Sublime Text seems to struggle with it on Windows
    syntaxCheckEnabled: true,
    formatting: {
        enable: true,
        indentSize: 4,
    },
};

let globalSettings: NavigatorSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, NavigatorSettings> = new Map();

// Store recent critic diags to prevent blinking of diagnostics
const documentDiags: Map<string, Diagnostic[]> = new Map();

const timers: Map<string, NodeJS.Timeout> = new Map();

// Keep track of modules available for import. Building this is a slow operations and varies based on workspace settings, not documents
const availableMods: Map<string, Map<string, string>> = new Map();
let modCacheBuilt: boolean = false;

async function rebuildModCache() {
    const allDocs = documents.all();
    if (allDocs.length > 0) {
        modCacheBuilt = true;
        dispatchForMods(allDocs[allDocs.length - 1]); // Rebuild with recent file
    }
    return;
}

async function buildModCache(textDocument: TextDocument) {
    if (!modCacheBuilt) {
        modCacheBuilt = true; // Set true first to prevent other files from building concurrently.
        dispatchForMods(textDocument);
    }
    return;
}

async function dispatchForMods(textDocument: TextDocument) {
    // BIG TODO: Resolution of workspace settings? How to do? Maybe build a hash of all include paths.
    const settings = await getDocumentSettings(textDocument.uri);
    const workspaceFolders = await getWorkspaceFoldersSafe();
    const newMods = await getAvailableMods(workspaceFolders, settings);
    availableMods.set("default", newMods);
    return;
}


async function getWorkspaceFoldersSafe (): Promise<WorkspaceFolder[]> {
    try {
        const workspaceFolders = await connection.workspace.getWorkspaceFolders(); 
        if (!workspaceFolders){
            return [];
        } else {
            return workspaceFolders;
        }
    } catch (error) {
        return [];
    }
}

async function getDocumentSettings(resource: string): Promise<NavigatorSettings> {
    if (!hasConfigurationCapability) {
        return globalSettings;
    }
    let result = documentSettings.get(resource);
    if (!result) {
        result = await connection.workspace.getConfiguration({
            scopeUri: resource,
            section: 'raku'
        });
        if(!result) return globalSettings;
        const resolvedSettings = { ...globalSettings, ...result };
        documentSettings.set(resource, resolvedSettings);
        return resolvedSettings;
    }
    return result;
}


// Only keep settings for open documents
documents.onDidClose(e => {
    documentSettings.delete(e.document.uri);
    navSymbols.del(e.document.uri);
    documentDiags.delete(e.document.uri);
    connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});


documents.onDidOpen(change => {
    validateRakuDocument(change.document);
    buildModCache(change.document);
});


documents.onDidSave(async change => {
    validateRakuDocument(change.document);
    // Also update index for saved file if it's a Raku file
    const settings = await getDocumentSettings(change.document.uri);
    nLog(`onDidSave: reindexing ${change.document.uri}`, settings);
    await workspaceIndex.reindexFile(change.document.uri, settings);
});


documents.onDidChangeContent(change => {
    // VSCode sends a firehose of change events. Only check after it's been quiet for 1 second.
    const timer = timers.get(change.document.uri)
    if(timer) clearTimeout(timer);
    const newTimer = setTimeout(function(){ validateRakuDocument(change.document)}, 1000);
    timers.set(change.document.uri, newTimer);
});

// LSP file watch notifications (requires client fileEvents watchers)
connection.onDidChangeWatchedFiles(async (change) => {
    for (const c of change.changes) {
        const uri = c.uri;
        // We don't need to distinguish create/change/delete here strictly; reindexFile removes old entries first
        if (c.type === 3 /* Deleted */) {
            nLog(`onDidChangeWatchedFiles: remove ${uri}`, globalSettings);
            workspaceIndex.removeFile(uri, globalSettings);
        } else {
            nLog(`onDidChangeWatchedFiles: reindex ${uri}`, globalSettings);
            await workspaceIndex.reindexFile(uri, globalSettings);
        }
    }
});


async function validateRakuDocument(textDocument: TextDocument): Promise<void> {
    const settings = await getDocumentSettings(textDocument.uri);
    
    const start = Date.now();

    const workspaceFolders = await getWorkspaceFoldersSafe(); 

    const rakuDoc = await parseDocument(textDocument, ParseType.selfNavigation);
    navSymbols.set(textDocument.uri, rakuDoc);

    if(!settings.syntaxCheckEnabled){
        nLog("Syntax checking disabled", settings);
        // Clear any potential existing ones
        sendDiags({ uri: textDocument.uri, diagnostics: [] });
        return;
    }

    let rakuOut = await rakucompile(textDocument, workspaceFolders, settings); // Start compilation

    nLog("Compilation Time: " + (Date.now() - start)/1000 + " seconds", settings);
    if(!rakuOut) return;
    sendDiags({ uri: textDocument.uri, diagnostics: rakuOut.diags });

    return;
}

function sendDiags(params: PublishDiagnosticsParams): void{
    // Before sending new diagnostics, check if the file is still open. 
    if(documents.get(params.uri)){
        connection.sendDiagnostics(params);
    } else {
        connection.sendDiagnostics({ uri: params.uri, diagnostics: [] });
    }
}


connection.onDidChangeConfiguration(async (change) => {
    if (hasConfigurationCapability) {
        // Reset all cached document settings
        documentSettings.clear();
    } else {
        globalSettings = { ...defaultSettings, ...change?.settings?.raku };
    }

    if (change?.settings?.raku) {
        await rebuildModCache();
        for (const doc of documents.all()) {
            // sequential changes
            await validateRakuDocument(doc);
        }
    }

});

// This handler provides the initial list of the completion items.
connection.onCompletion((params: TextDocumentPositionParams): CompletionList | undefined => {
    let document = documents.get(params.textDocument.uri);
    let rakuDoc = navSymbols.get(params.textDocument.uri);
    let mods = availableMods.get("default");

    if(!document) return;
    if(!rakuDoc) return; // navSymbols is an LRU cache, so the navigation elements will be missing if you open lots of files
    if (!mods) mods = new Map();

    const completions: CompletionItem[] = getCompletions(params, rakuDoc, document, mods);
    return {
        items: completions,
        isIncomplete: false,
    };
});


connection.onCompletionResolve(async (item: CompletionItem): Promise<CompletionItem> => {

    const rakuElem: RakuElem = item.data.rakuElem;

    let rakuDoc = navSymbols.get(item.data?.docUri);
    if (!rakuDoc) return item;

    let mods = availableMods.get("default");
    if (!mods) mods = new Map();
    
    const docs = await getCompletionDoc(rakuElem, rakuDoc, mods);
    if (docs?.match(/\w/)) {
        item.documentation = { kind: "markdown", value: docs };;
    }
    return item;
});


connection.onHover(async (params) => {
    let document = documents.get(params.textDocument.uri);
    let rakuDoc = navSymbols.get(params.textDocument.uri);
    let mods = availableMods.get("default");
    if (!mods) mods = new Map();

    if(!document || !rakuDoc) return;

    return await getHover(params, rakuDoc, document, mods);
});

connection.onDefinition(params => {
    let document = documents.get(params.textDocument.uri);
    let rakuDoc = navSymbols.get(params.textDocument.uri);
    let mods = availableMods.get("default");
    if (!mods) mods = new Map();
    if(!document) return;
    if(!rakuDoc) return; // navSymbols is an LRU cache, so the navigation elements will be missing if you open lots of files
    let locOut: Location | Location[] | undefined = getDefinition(params, rakuDoc, document, mods);

    // Fallback: if nothing found, try workspace token index
    if (!locOut || (Array.isArray(locOut) && locOut.length === 0)) {
        const symbol = getSymbol(params.position, document);
        if (symbol) {
            const tokenLocs = workspaceIndex.getLocations(symbol);
            if (tokenLocs.length === 0) {
                nLog(`Definition fallback: no workspace symbol for ${symbol}`, globalSettings);
            } else {
                nLog(`Definition fallback: ${symbol} -> ${tokenLocs.length} locations`, globalSettings);
            }
            if (tokenLocs.length > 0) return tokenLocs;
        }
    }
    return locOut;
});


connection.onDocumentSymbol(async (params) => {
    let document = documents.get(params.textDocument.uri);
    // We might  need to async wait for the document to be processed, but I suspect the order is fine
    if (!document) return;
    return getSymbols(document, params.textDocument.uri);
});

connection.onWorkspaceSymbol(async (params: WorkspaceSymbolParams): Promise<SymbolInformation[]> => {
    const query = (params.query || '').trim();
    const matches = workspaceIndex.findByQuery(query, 1000);
    const results: SymbolInformation[] = [];
    const seen = new Set<string>();

    for (const match of matches) {
        const kind = mapRakuSymbolKind(match.elem.type as RakuSymbolKind);
        if (kind === null) continue;
        const lineEnd = typeof match.elem.lineEnd === 'number' ? match.elem.lineEnd : match.elem.line;
        const key = `${match.name}:${match.elem.uri}:${match.elem.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
            name: match.name,
            kind: kind,
            location: {
                uri: match.elem.uri,
                range: {
                    start: { line: match.elem.line, character: 0 },
                    end: { line: lineEnd, character: 100 }
                }
            },
            containerName: match.elem.package || undefined
        });
    }

    return results;
});

connection.onSignatureHelp(async (params) => {
    let document = documents.get(params.textDocument.uri);
    let rakuDoc = navSymbols.get(params.textDocument.uri);
    if (!document || !rakuDoc) return;
    const signature = await getSignature(params, rakuDoc, document);
    return signature;
});

connection.onDocumentFormatting(async (params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    const settings = await getDocumentSettings(document.uri);
    if (settings.formatting?.enable === false) return [];
    return await formatDocument(document, params.options, settings);
});

connection.onDocumentRangeFormatting(async (params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    const settings = await getDocumentSettings(document.uri);
    if (settings.formatting?.enable === false) return [];
    return await formatRange(document, params.range, params.options, settings);
});


process.on('unhandledRejection', function(reason, p){
    console.error("Caught an unhandled Rejection at: Promise ", p, " reason: ", reason);
});


// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
