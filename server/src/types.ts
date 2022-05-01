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
}
