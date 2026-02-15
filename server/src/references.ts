/* Raku Navigator references and rename support. See licenses.txt file for licensing and copyright information */

import {
    Location,
    Position,
    Range,
    WorkspaceEdit,
    TextEdit
} from 'vscode-languageserver/node';
import {
    TextDocument
} from 'vscode-languageserver-textdocument';
import Uri from 'vscode-uri';
import { RakuDocument, RakuElem, RakuSymbolKind, NavigatorSettings } from './types';
import { getSymbol, lookupSymbol, nLog, findRecent } from './utils';
import { workspaceIndex } from './workspaceIndex';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';
import * as vsctm from 'vscode-textmate';
import * as oniguruma from 'vscode-oniguruma';

// TextMate grammar setup for tokenization
const wasmBin = readFileSync(path.join(__dirname, '../node_modules/vscode-oniguruma/release/onig.wasm')).buffer;
const vscodeOnigurumaLib = oniguruma.loadWASM(wasmBin).then(() => {
    return {
        createOnigScanner(patterns: string[]) { return new oniguruma.OnigScanner(patterns); },
        createOnigString(s: string) { return new oniguruma.OnigString(s); }
    };
});

const registry = new vsctm.Registry({
    onigLib: vscodeOnigurumaLib,
    loadGrammar: async (scopeName) => {
        const grammarpath = path.join(__dirname, './../raku.tmLanguage.json');
        const grammar = await readFileSync(grammarpath, 'utf8');
        return vsctm.parseRawGrammar(grammar, grammarpath);
    },
});

// Built-in keywords, types, and pragmas that cannot be renamed
const UNRENAMEABLE_SYMBOLS = new Set([
    // Keywords
    'if', 'else', 'elsif', 'unless', 'given', 'when', 'default',
    'for', 'while', 'until', 'loop', 'repeat',
    'sub', 'method', 'multi', 'proto', 'only',
    'class', 'role', 'grammar', 'module', 'package',
    'has', 'is', 'does', 'but', 'trusts',
    'my', 'our', 'state', 'temp', 'let',
    'use', 'require', 'need', 'import',
    'return', 'last', 'next', 'redo', 'proceed', 'succeed',
    'die', 'fail', 'warn',
    'try', 'CATCH', 'CONTROL', 'QUIT',
    'constant', 'enum',
    'BEGIN', 'CHECK', 'INIT', 'START', 'FIRST', 'ENTER',
    'LEAVE', 'KEEP', 'UNDO', 'NEXT', 'LAST', 'PRE', 'POST',
    'END', 'CLOSE',
    // Built-in types
    'Str', 'Int', 'Num', 'Rat', 'Bool', 'Complex',
    'Array', 'Hash', 'List', 'Map', 'Set', 'Bag', 'Mix',
    'Any', 'Mu', 'Junction', 'Whatever', 'Nil',
    'Code', 'Block', 'Routine', 'Sub', 'Method',
    'Scalar', 'Positional', 'Associative', 'Callable',
    'Range', 'Seq', 'Slip', 'Capture',
    'Pair', 'Match', 'Regex', 'Grammar',
    'IO', 'DateTime', 'Instant', 'Duration',
    'Exception', 'Failure', 'Promise', 'Supply', 'Channel',
]);

/**
 * Find all references to a symbol in the workspace
 */
export function findAllReferences(
    position: Position,
    rakuDoc: RakuDocument,
    txtDoc: TextDocument,
    includeDeclaration: boolean,
    settings?: NavigatorSettings
): Location[] | undefined {
    const symbol = getSymbol(position, txtDoc);
    if (!symbol) return;

    const locations: Location[] = [];

    // Determine if this is a local variable or workspace symbol
    if (isLocalVariable(symbol)) {
        // Local variable - search only within file
        const localRefs = findLocalReferences(symbol, rakuDoc, txtDoc, position.line);
        locations.push(...localRefs);
    } else {
        // Workspace symbol - search across all relevant files
        const workspaceRefs = findWorkspaceReferences(symbol, rakuDoc, txtDoc);
        locations.push(...workspaceRefs);
    }

    if (settings) {
        nLog(`[RENAME] Before deduplication: ${locations.length} locations`, settings);
    }

    // Deduplicate overlapping locations
    const dedupedLocations = deduplicateLocations(locations);

    if (settings) {
        nLog(`[RENAME] After deduplication: ${dedupedLocations.length} locations`, settings);
    }

    // Filter out the declaration if not requested
    if (!includeDeclaration && dedupedLocations.length > 0) {
        // The declaration is typically the first occurrence or matches the definition location
        const found = lookupSymbol(rakuDoc, new Map(), symbol, position.line);
        if (found.length > 0) {
            const declLine = found[0].line;
            const declUri = found[0].uri;
            return dedupedLocations.filter(loc =>
                loc.uri !== declUri || loc.range.start.line !== declLine
            );
        }
    }

    return dedupedLocations.length > 0 ? dedupedLocations : undefined;
}

/**
 * Prepare rename - validate that the symbol can be renamed
 */
export function prepareRename(
    position: Position,
    rakuDoc: RakuDocument,
    txtDoc: TextDocument
): Range | { range: Range; placeholder: string } | null {
    const symbol = getSymbol(position, txtDoc);
    if (!symbol) return null;

    // Check if symbol is renameable
    if (!isRenameable(symbol)) {
        return null;
    }

    // Check that we can find at least one definition or reference
    const found = lookupSymbol(rakuDoc, new Map(), symbol, position.line);
    if (found.length === 0 && !isLocalVariable(symbol)) {
        // Can't find the symbol in workspace
        return null;
    }

    // Calculate the range of the symbol at cursor
    const start = { line: position.line, character: 0 };
    const end = { line: position.line + 1, character: 0 };
    const text = txtDoc.getText({ start, end });
    const index = txtDoc.offsetAt(position) - txtDoc.offsetAt(start);

    // Find the exact symbol boundaries (reuse logic from getSymbol)
    const leftRg = /[\p{L}\p{N}_:>-]/u;
    const rightRg = /[\p{L}\p{N}_-]/u;

    let left = index - 1;
    let right = index;

    while (left >= 0 && leftRg.exec(text[left])) {
        left -= 1;
    }
    left = Math.max(0, left + 1);
    while (right < text.length && rightRg.exec(text[right])) {
        right += 1;
    }
    right = Math.max(left, right);

    // Check for sigil prefix
    const lChar = left > 0 ? text[left - 1] : '';
    if (['@', '%', '$'].includes(lChar)) {
        left -= 1;
    }

    const range: Range = {
        start: { line: position.line, character: left },
        end: { line: position.line, character: right }
    };

    return { range, placeholder: symbol };
}

/**
 * Execute rename - create workspace edits to rename the symbol
 */
export async function executeRename(
    position: Position,
    newName: string,
    rakuDoc: RakuDocument,
    txtDoc: TextDocument,
    settings?: NavigatorSettings
): Promise<WorkspaceEdit | null> {
    const symbol = getSymbol(position, txtDoc);

    if (settings) {
        nLog(`[RENAME] executeRename called with symbol: "${symbol}", newName: "${newName}"`, settings);
    }

    if (!symbol || !isRenameable(symbol)) {
        if (settings) {
            nLog(`[RENAME] Symbol is not renameable: "${symbol}"`, settings);
        }
        return null;
    }

    // Validate and normalize the new name
    if (!validateNewName(symbol, newName)) {
        if (settings) {
            nLog(`[RENAME] New name validation failed for "${newName}"`, settings);
        }
        return null;
    }
    const normalizedNewName = normalizeNewName(symbol, newName);
    if (settings) {
        nLog(`[RENAME] Normalized name: "${normalizedNewName}"`, settings);
    }

    // Find all references
    const locations = findAllReferences(position, rakuDoc, txtDoc, true, settings);
    if (!locations || locations.length === 0) {
        if (settings) {
            nLog(`[RENAME] No references found`, settings);
        }
        return null;
    }

    // Filter out locations in strings, comments, and regexes
    const filteredLocations = await filterNonCodeLocations(locations, txtDoc, settings);

    if (settings) {
        nLog(`[RENAME] Found ${filteredLocations.length} unique references (after filtering and deduplication)`, settings);
    }

    // Create text edits for each location
    const workspaceEdit: WorkspaceEdit = {
        changes: {}
    };

    for (const location of filteredLocations) {
        const uri = location.uri;
        if (!workspaceEdit.changes![uri]) {
            workspaceEdit.changes![uri] = [];
        }

        // Create the text edit for this location
        const edit: TextEdit = {
            range: location.range,
            newText: normalizedNewName
        };

        workspaceEdit.changes![uri].push(edit);

        if (settings) {
            nLog(`[RENAME] Adding edit for ${uri} at ${location.range.start.line}:${location.range.start.character}-${location.range.end.line}:${location.range.end.character}`, settings);
        }
    }

    if (settings) {
        const fileCount = Object.keys(workspaceEdit.changes || {}).length;
        const totalEdits = Object.values(workspaceEdit.changes || {}).reduce((sum, edits) => sum + edits.length, 0);
        nLog(`[RENAME] Created WorkspaceEdit with ${fileCount} files and ${totalEdits} total edits`, settings);

        // Log each file with edit count
        for (const [uri, edits] of Object.entries(workspaceEdit.changes || {})) {
            nLog(`[RENAME]   ${uri}: ${edits.length} edits`, settings);
        }
    }

    return workspaceEdit;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Remove duplicate and overlapping locations
 */
function deduplicateLocations(locations: Location[]): Location[] {
    if (locations.length === 0) return locations;

    // Sort by URI, then line, then character
    const sorted = [...locations].sort((a, b) => {
        if (a.uri !== b.uri) return a.uri.localeCompare(b.uri);
        if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
        if (a.range.start.character !== b.range.start.character) return a.range.start.character - b.range.start.character;
        return a.range.end.character - b.range.end.character;
    });

    const deduped: Location[] = [];
    let lastAdded: Location | null = null;

    for (const loc of sorted) {
        if (!lastAdded) {
            deduped.push(loc);
            lastAdded = loc;
            continue;
        }

        // Skip if same URI and overlapping range
        if (lastAdded.uri === loc.uri) {
            const lastStart = lastAdded.range.start;
            const lastEnd = lastAdded.range.end;
            const currStart = loc.range.start;
            const currEnd = loc.range.end;

            // Check if locations overlap or are identical
            const overlaps =
                (lastStart.line === currStart.line && lastStart.character === currStart.character) ||
                (lastStart.line === currStart.line &&
                 lastEnd.line === currEnd.line &&
                 lastStart.character <= currStart.character &&
                 lastEnd.character >= currStart.character);

            if (overlaps) {
                // Keep the longer one (more complete match)
                const lastLen = (lastEnd.line - lastStart.line) * 1000 + (lastEnd.character - lastStart.character);
                const currLen = (currEnd.line - currStart.line) * 1000 + (currEnd.character - currStart.character);

                if (currLen > lastLen) {
                    deduped[deduped.length - 1] = loc;
                    lastAdded = loc;
                }
                continue;
            }
        }

        deduped.push(loc);
        lastAdded = loc;
    }

    return deduped;
}

/**
 * Check if a symbol is a local variable (has sigil)
 */
function isLocalVariable(symbol: string): boolean {
    return /^[\$@%]/.test(symbol);
}

/**
 * Check if a symbol can be renamed
 */
function isRenameable(symbol: string): boolean {
    // Remove sigils for checking
    const baseName = symbol.replace(/^[\$@%!.]/, '');

    // Check if it's a built-in
    if (UNRENAMEABLE_SYMBOLS.has(baseName)) {
        return false;
    }

    // Can't rename empty symbols
    if (!baseName) {
        return false;
    }

    return true;
}

/**
 * Validate that the new name is syntactically valid
 */
function validateNewName(oldName: string, newName: string): boolean {
    // Check if new name is valid Raku identifier
    // Allow: word chars, hyphens, colons for package names
    // Sigils are allowed at the start, then must start with letter or underscore
    const validPattern = /^[$@%]?[a-zA-Z_][\w-]*(?:::[a-zA-Z_][\w-]*)*$/;

    if (!validPattern.test(newName)) {
        return false;
    }

    return true;
}

/**
 * Normalize the new name to match the old name's format
 * (preserve sigils, etc.)
 */
function normalizeNewName(oldName: string, newName: string): string {
    // If old name has sigil but new name doesn't, add it
    const sigilMatch = oldName.match(/^([$@%])/);
    if (sigilMatch && !newName.match(/^[$@%]/)) {
        return sigilMatch[1] + newName;
    }

    return newName;
}

/**
 * Find references to a local variable within a file
 */
function findLocalReferences(
    symbol: string,
    rakuDoc: RakuDocument,
    txtDoc: TextDocument,
    currentLine: number
): Location[] {
    const locations: Location[] = [];

    // Find the declaration of this variable
    const found = rakuDoc.elems.get(symbol);
    if (!found || found.length === 0) {
        return locations;
    }

    // For local variables, find the most recent declaration before current line
    const declaration = findRecent(found, currentLine);
    const scopeStart = declaration.line;

    // For simplicity, search from declaration to end of file (TODO: better scope detection)
    const scopeEnd = txtDoc.lineCount;

    // Search for all occurrences of the symbol
    const uri = txtDoc.uri;
    const baseName = symbol.replace(/^[\$@%]/, '');

    for (let line = scopeStart; line < scopeEnd; line++) {
        const lineStart = { line, character: 0 };
        const lineEnd = { line: line + 1, character: 0 };
        const text = txtDoc.getText({ start: lineStart, end: lineEnd });

        // Search for various forms of the variable
        const patterns = buildVariablePatterns(symbol, baseName);

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                // Use the first capturing group for the symbol position
                const symbolMatch = match[1];
                const symbolIndex = match.index + match[0].indexOf(symbolMatch);

                const start = { line, character: symbolIndex };
                const end = { line, character: symbolIndex + symbolMatch.length };

                locations.push({
                    uri,
                    range: { start, end }
                });
            }
        }
    }

    return locations;
}

/**
 * Find references to a workspace symbol across all files
 */
function findWorkspaceReferences(
    symbol: string,
    rakuDoc: RakuDocument,
    txtDoc: TextDocument
): Location[] {
    const locations: Location[] = [];

    // Use workspace index to find potential files containing the symbol
    const symbolElems = workspaceIndex.findByName(symbol);

    if (symbolElems.length === 0) {
        // Symbol not found in index, search current file only
        return searchTextForSymbol(txtDoc.getText(), symbol, txtDoc.uri, RakuSymbolKind.LocalSub);
    }

    // Get unique file URIs that might contain references
    const fileUris = new Set<string>();
    symbolElems.forEach(elem => fileUris.add(elem.uri));

    // Also search all files in the workspace (broader search)
    // For now, we'll search files that import or use the symbol
    // TODO: Optimize this by only searching relevant files

    // Search each file for the symbol
    for (const fileUri of fileUris) {
        try {
            const filePath = Uri.parse(fileUri).fsPath;
            if (!existsSync(filePath)) continue;

            const fileContent = readFileSync(filePath, 'utf-8');
            const fileLocations = searchTextForSymbol(
                fileContent,
                symbol,
                fileUri,
                symbolElems[0].type
            );
            locations.push(...fileLocations);
        } catch (error) {
            // Skip files that can't be read
            continue;
        }
    }

    return locations;
}

/**
 * Search text for all occurrences of a symbol
 */
function searchTextForSymbol(
    text: string,
    symbol: string,
    uri: string,
    symbolKind: RakuSymbolKind
): Location[] {
    const locations: Location[] = [];
    const lines = text.split('\n');

    // Remove sigils from symbol for some searches
    const baseName = symbol.replace(/^[\$@%!.]/, '');

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];

        // Build search patterns based on symbol kind
        let patterns: RegExp[] = [];

        if (isLocalVariable(symbol)) {
            // Variable patterns
            patterns = buildVariablePatterns(symbol, baseName);
        } else if (symbolKind === RakuSymbolKind.Token || symbolKind === RakuSymbolKind.Rule) {
            // Grammar token/rule patterns
            patterns.push(new RegExp(`<(${baseName})>`, 'g'));
            patterns.push(new RegExp(`\\b(${baseName})\\b`, 'g'));
        } else if (symbolKind === RakuSymbolKind.Class ||
                   symbolKind === RakuSymbolKind.Role ||
                   symbolKind === RakuSymbolKind.Module) {
            // Class/Role/Module patterns
            patterns.push(new RegExp(`\\b(${baseName})\\b`, 'g'));
            patterns.push(new RegExp(`\\b(?:use|require|need|is|does|but)\\s+(${baseName})\\b`, 'g'));
        } else {
            // Method/Sub patterns - use capturing groups to exclude punctuation
            patterns.push(new RegExp(`\\b(${baseName})\\s*\\(`, 'g'));
            patterns.push(new RegExp(`(?:->|\\.)\\s*(${baseName})\\b`, 'g'));
            patterns.push(new RegExp(`::(${baseName})\\b`, 'g'));
            patterns.push(new RegExp(`\\b(${baseName})\\b`, 'g'));
        }

        // Search for each pattern
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(line)) !== null) {
                // Use the first capturing group for the symbol position
                const symbolMatch = match[1];
                const symbolIndex = match.index + match[0].indexOf(symbolMatch);

                const start = { line: lineNum, character: symbolIndex };
                const end = { line: lineNum, character: symbolIndex + symbolMatch.length };

                locations.push({
                    uri,
                    range: { start, end }
                });
            }
        }
    }

    return locations;
}

/**
 * Build regex patterns for finding variable references
 */
function buildVariablePatterns(symbol: string, baseName: string): RegExp[] {
    const patterns: RegExp[] = [];
    const sigil = symbol.match(/^([$@%])/)?.[1] || '$';

    // Bare sigil + name: $foo - capture the whole variable
    patterns.push(new RegExp(`(\\${sigil}${baseName}\\b)`, 'g'));

    // Braced form: ${foo} - capture the whole variable
    patterns.push(new RegExp(`(\\${sigil}\\{${baseName}\\})`, 'g'));

    // Object attributes: $.foo or $!foo - capture the whole attribute
    if (sigil === '$') {
        patterns.push(new RegExp(`(\\$\\.${baseName}\\b)`, 'g'));
        patterns.push(new RegExp(`(\\$!${baseName}\\b)`, 'g'));
    }

    return patterns;
}

/**
 * Filter out locations that are inside strings, comments, or regexes
 */
async function filterNonCodeLocations(
    locations: Location[],
    txtDoc: TextDocument,
    settings?: NavigatorSettings
): Promise<Location[]> {
    try {
        const grammar = await registry.loadGrammar('source.raku');
        if (!grammar) {
            if (settings) {
                nLog('[RENAME] Could not load TextMate grammar for filtering', settings);
            }
            return locations; // Return all locations if grammar fails to load
        }

        const filtered: Location[] = [];
        const text = txtDoc.getText();
        const lines = text.split('\n');

        // Tokenize all lines and build a map of excluded ranges
        let ruleStack: vsctm.StateStack | null = vsctm.INITIAL;
        const excludedRanges: Array<{ line: number; startChar: number; endChar: number }> = [];

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            const result = grammar.tokenizeLine(line, ruleStack);
            ruleStack = result.ruleStack;

            let lastEndIndex = 0;
            for (const token of result.tokens) {
                const startChar = lastEndIndex;
                const endChar = token.endIndex;
                lastEndIndex = token.endIndex;

                // Check if this token is a comment, string, or regex
                const isComment = token.scopes.some((scope) =>
                    scope.startsWith('comment') || scope.startsWith('meta.comment')
                );
                const isString = token.scopes.some((scope) =>
                    scope.startsWith('string')
                );
                const isRegex = token.scopes.some((scope) =>
                    scope.includes('regex') || scope.includes('regexp')
                );

                if (isComment || isString || isRegex) {
                    excludedRanges.push({ line: lineNum, startChar, endChar });
                }
            }
        }

        // Filter locations that overlap with excluded ranges
        for (const location of locations) {
            const locLine = location.range.start.line;
            const locStartChar = location.range.start.character;
            const locEndChar = location.range.end.character;

            const isExcluded = excludedRanges.some(excluded =>
                excluded.line === locLine &&
                // Check if location overlaps with excluded range
                !(locEndChar <= excluded.startChar || locStartChar >= excluded.endChar)
            );

            if (!isExcluded) {
                filtered.push(location);
            }
        }

        if (settings && filtered.length !== locations.length) {
            nLog(`[RENAME] Filtered out ${locations.length - filtered.length} locations in strings/comments/regexes`, settings);
        }

        return filtered;
    } catch (error) {
        if (settings) {
            nLog(`[RENAME] Error filtering locations: ${error}`, settings);
        }
        return locations; // Return all locations on error
    }
}
