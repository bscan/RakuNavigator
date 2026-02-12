import { TextDocument } from 'vscode-languageserver-textdocument';
import { TextEdit, Range, FormattingOptions } from 'vscode-languageserver/node';
import { NavigatorSettings } from './types';
import { async_execFile, getIncPaths, nLog } from './utils';
import { WorkspaceFolder } from 'vscode-languageserver/node';
import { join, dirname } from 'path';

/**
 * Format a Raku document using basic formatting rules
 *
 * This uses a simple Raku script to format the code with basic indentation
 * and whitespace rules. In the future, this could integrate with Raku-Parser
 * for more sophisticated formatting.
 */
export async function formatDocument(
    document: TextDocument,
    options: FormattingOptions,
    workspaceFolders: WorkspaceFolder[],
    settings: NavigatorSettings
): Promise<TextEdit[]> {

    const formatterPath = join(dirname(__dirname), 'src', 'raku', 'formatter.raku');

    let rakuParams: string[] = [];
    rakuParams = rakuParams.concat(getIncPaths(workspaceFolders, settings));
    rakuParams.push(formatterPath);

    // Pass formatting options as command line arguments
    rakuParams.push('--indent-size', options.tabSize.toString());
    rakuParams.push('--use-tabs', options.insertSpaces ? '0' : '1');

    nLog("Starting Raku formatter with " + rakuParams.join(" "), settings);

    const text = document.getText();

    try {
        // Run the formatter, passing the code via stdin
        const result = await async_execFile(
            settings.rakuPath,
            rakuParams,
            {
                timeout: 30000,
                maxBuffer: 10 * 1024 * 1024,
                input: text
            }
        );

        const formattedText = result.stdout;

        if (!formattedText || formattedText === text) {
            nLog("Formatter returned no changes", settings);
            return [];
        }

        // Return a single edit that replaces the entire document
        const lastLine = document.lineCount - 1;
        const lastChar = document.getText({
            start: { line: lastLine, character: 0 },
            end: { line: lastLine + 1, character: 0 }
        }).length;

        const fullRange: Range = {
            start: { line: 0, character: 0 },
            end: { line: lastLine, character: lastChar }
        };

        nLog("Formatter succeeded", settings);
        return [TextEdit.replace(fullRange, formattedText)];

    } catch (error: any) {
        nLog("Formatter failed: " + (error?.message || error), settings);
        return [];
    }
}
