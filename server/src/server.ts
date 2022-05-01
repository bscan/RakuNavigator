/* Raku Navigator server. See licenses.txt file for licensing and copyright information */

import {
    createConnection,
    TextDocuments,
    Diagnostic,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    TextDocumentSyncKind,
    InitializeResult,
    WorkspaceFolder,
} from 'vscode-languageserver/node';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';
import {
    PublishDiagnosticsParams
} from 'vscode-languageserver-protocol';

import Uri from 'vscode-uri';
import { NavigatorSettings } from "./types";
import { rakucompile } from "./diagnostics";
import { nLog } from './utils';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

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
            // connection.console.log('Workspace folder change event received.');
        });
    }
});


// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Does not happen with the vscode client could happen with other clients.
// The "real" default settings are in the top-level package.json
const defaultSettings: NavigatorSettings = {
    rakuPath: "raku",
    includePaths: [],
    logging: false, // Get logging from vscode, but turn it off elsewhere. Sublime Text seems to struggle with it on Windows
};

let globalSettings: NavigatorSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, NavigatorSettings> = new Map();

// Store recent critic diags to prevent blinking of diagnostics
const documentDiags: Map<string, Diagnostic[]> = new Map();

const timers: Map<string, NodeJS.Timeout> = new Map();


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
    documentDiags.delete(e.document.uri);
    connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});


documents.onDidOpen(change => {
    validateRakuDocument(change.document);
});


documents.onDidSave(change => {
    validateRakuDocument(change.document);
});


documents.onDidChangeContent(change => {
    // VSCode sends a firehose of change events. Only check after it's been quiet for 1 second.
    const timer = timers.get(change.document.uri)
    if(timer) clearTimeout(timer);
    const newTimer = setTimeout(function(){ validateRakuDocument(change.document)}, 1000);
    timers.set(change.document.uri, newTimer);
});


async function validateRakuDocument(textDocument: TextDocument): Promise<void> {
    const settings = await getDocumentSettings(textDocument.uri);
    nLog("Found settings", settings);
    const filePath = Uri.parse(textDocument.uri).fsPath;
    
    const start = Date.now();

    const workspaceFolders = await getWorkspaceFoldersSafe(); 
    const pCompile = rakucompile(textDocument, workspaceFolders, settings); // Start compilation

    let rakuOut = await pCompile;
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


connection.onDidChangeConfiguration(change => {
    if (hasConfigurationCapability) {
        // Reset all cached document settings
        documentSettings.clear();
    } else {
        globalSettings = { ...defaultSettings, ...change?.settings?.raku };
    }
    // Pretty rare occurence, and can slow things down. Revalidate all open text documents
    // documents.all().forEach(validateRakuDocument);
});


process.on('unhandledRejection', function(reason, p){
    console.log("Caught an unhandled Rejection at: Promise ", p, " reason: ", reason);
});


// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
