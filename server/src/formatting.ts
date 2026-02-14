/* Raku code formatting using TextMate grammar tokenization */

import { TextDocument } from "vscode-languageserver-textdocument";
import { TextEdit, Range, FormattingOptions } from "vscode-languageserver/node";
import { NavigatorSettings } from "./types";
import fs = require("fs");
import path = require("path");
import vsctm = require("vscode-textmate");
import oniguruma = require("vscode-oniguruma");

// Initialize TextMate grammar for tokenization
const wasmBin = fs.readFileSync(path.join(__dirname, "./../node_modules/vscode-oniguruma/release/onig.wasm")).buffer;
const vscodeOnigurumaLib = oniguruma.loadWASM(wasmBin).then(() => {
    return {
        createOnigScanner(patterns: any) {
            return new oniguruma.OnigScanner(patterns);
        },
        createOnigString(s: any) {
            return new oniguruma.OnigString(s);
        },
    };
});

const registry = new vsctm.Registry({
    onigLib: vscodeOnigurumaLib,
    loadGrammar: async (scopeName) => {
        const grammarpath = path.join(__dirname, "./../raku.tmLanguage.json");
        const grammar = await fs.promises.readFile(grammarpath, "utf8");
        return vsctm.parseRawGrammar(grammar, grammarpath);
    },
});

interface LineInfo {
    lineNumber: number;
    text: string;
    leadingWhitespace: string;
    contentStart: number;
    isEmpty: boolean;
    isComment: boolean;
    isString: boolean;
    isPod: boolean;
    indentDelta: { before: number; after: number }; // Change in indent level
    tokens: vsctm.IToken[]; // Store tokens for additional formatting rules
}

interface FormattingConfig {
    trimTrailingWhitespace: boolean;
    insertFinalNewline: boolean;
    spaceAfterComma: boolean;
    noSpaceBeforeSemicolon: boolean;
    spaceAfterKeywords: boolean;
    spaceBeforeBrace: boolean;
    braceOnSameLine: boolean;
    cuddledElse: boolean;
    indentSize: number;
}

/**
 * Analyze tokens to determine if this line opens or closes blocks
 */
function analyzeIndentChange(tokens: vsctm.IToken[], lineText: string): { before: number; after: number } {
    let netChange = 0;
    let closingBracesAtStart = 0;
    let hasContentBeforeClosing = false;

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const startIndex = i === 0 ? 0 : tokens[i - 1].endIndex;
        const content = lineText.substring(startIndex, token.endIndex);
        
        // Check if this is a string or comment - ignore brackets inside them
        const isString = token.scopes.some(scope => scope.startsWith("string"));
        const isComment = token.scopes.some(scope => scope.startsWith("comment"));
        
        if (isString || isComment) {
            continue;
        }

        // Count brackets in this token's content
        for (const char of content) {
            if (char === '{' || char === '[' || char === '(') {
                netChange++;
                hasContentBeforeClosing = true;
            } else if (char === '}' || char === ']' || char === ')') {
                if (!hasContentBeforeClosing) {
                    closingBracesAtStart++;
                }
                netChange--;
            } else if (char.trim() !== '') {
                hasContentBeforeClosing = true;
            }
        }
    }

    // If line starts with closing bracket, dedent before, then adjust after
    // Examples:
    // }  -> dedent before: -1, after: 0 (closing already counted in before)
    // } else {  -> dedent before: -1, after: +1 (closing in before, opening in after)
    // method() {  -> dedent before: 0, after: +1 (opening in after)
    // method gist { } -> dedent before: 0, after: 0 (balanced inline)
    const before = -closingBracesAtStart;
    // Adjust netChange to exclude closing braces already counted in 'before'
    const after = netChange + closingBracesAtStart;

    return { before, after };
}

/**
 * Tokenize and analyze a single line
 */
async function analyzeLine(
    lineNumber: number,
    lineText: string,
    grammar: vsctm.IGrammar,
    ruleStack: vsctm.StateStack | null
): Promise<{ lineInfo: LineInfo; ruleStack: vsctm.StateStack }> {
    
    const result = grammar.tokenizeLine(lineText, ruleStack);
    
    // Detect leading whitespace
    const leadingMatch = lineText.match(/^(\s*)/);
    const leadingWhitespace = leadingMatch ? leadingMatch[1] : "";
    const contentStart = leadingWhitespace.length;
    const isEmpty = lineText.trim().length === 0;
    
    // Check if this entire line is a comment or string
    let isComment = false;
    let isString = false;
    let isPod = false;
    
    if (result.tokens.length > 0) {
        // Check if the first non-whitespace token is a comment
        const firstContentToken = result.tokens.find((token, idx) => {
            const startIdx = idx === 0 ? 0 : result.tokens[idx - 1].endIndex;
            const content = lineText.substring(startIdx, token.endIndex);
            return content.trim().length > 0;
        });
        
        if (firstContentToken) {
            isComment = firstContentToken.scopes.some(scope => scope.startsWith("comment"));
            isPod = firstContentToken.scopes.some(scope => scope.includes("pod") || scope.includes("comment.block.documentation"));
            isString = firstContentToken.scopes.some(scope => scope.startsWith("string"));
        }
    }
    
    // Analyze indent changes based on brackets
    const indentDelta = isEmpty || isComment ? { before: 0, after: 0 } : analyzeIndentChange(result.tokens, lineText);
    
    const lineInfo: LineInfo = {
        lineNumber,
        text: lineText,
        leadingWhitespace,
        contentStart,
        isEmpty,
        isComment,
        isString,
        isPod,
        indentDelta,
        tokens: result.tokens,
    };
    
    return { lineInfo, ruleStack: result.ruleStack };
}

/**
 * Calculate expected indentation for each line
 */
function calculateIndents(lines: LineInfo[], baseIndent: number = 0): number[] {
    const indents: number[] = [];
    let currentIndent = baseIndent;
    
    for (const line of lines) {
        // For empty lines or comments, keep current indent level
        if (line.isEmpty) {
            indents.push(0); // Empty lines have no indentation
            continue;
        }
        
        // For POD blocks, preserve their indentation
        if (line.isPod) {
            indents.push(currentIndent); // Preserve, but this will be skipped in edit generation
            continue;
        }
        
        // Apply "before" adjustment (for closing brackets at start of line)
        currentIndent = Math.max(0, currentIndent + line.indentDelta.before);
        
        // This line should be at the current indent level
        indents.push(currentIndent);
        
        // Apply "after" adjustment (for opening brackets at end of line)
        currentIndent = Math.max(0, currentIndent + line.indentDelta.after);
    }
    
    return indents;
}

/**
 * Generate whitespace string based on formatting options
 */
function generateIndent(level: number, options: FormattingOptions, config: FormattingConfig): string {
    const indentSize = options.tabSize || config.indentSize || 4;
    const totalSpaces = level * indentSize;
    
    if (options.insertSpaces !== false) {
        // Use spaces
        return ' '.repeat(totalSpaces);
    } else {
        // Use tabs
        const tabs = Math.floor(totalSpaces / indentSize);
        const spaces = totalSpaces % indentSize;
        return '\t'.repeat(tabs) + ' '.repeat(spaces);
    }
}

/**
 * Check if a position is inside a string, comment, or regex based on token scopes
 */
function isInsideSpecialContext(tokens: vsctm.IToken[], lineText: string, position: number): boolean {
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const startIdx = i === 0 ? 0 : tokens[i - 1].endIndex;
        
        if (position >= startIdx && position < token.endIndex) {
            return token.scopes.some(scope => 
                scope.startsWith("string") || 
                scope.startsWith("comment") ||
                scope.includes("regexp")
            );
        }
    }
    return false;
}

function isBlockBraceAtPosition(tokens: vsctm.IToken[], position: number): boolean {
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const startIdx = i === 0 ? 0 : tokens[i - 1].endIndex;
        if (position >= startIdx && position < token.endIndex) {
            return token.scopes.some(scope =>
                scope.includes("punctuation.definition.block.raku") ||
                scope.includes("meta.block.raku")
            );
        }
    }
    return false;
}

/**
 * Check if line contains a declaration keyword (class, role, method, sub, etc.)
 */
function hasDeclarationKeyword(line: LineInfo): boolean {
    return line.tokens.some(token => 
        token.scopes.some(scope => 
            scope.includes('storage.type.class.raku') ||
            scope.includes('storage.type.declarator.type.raku') ||
            scope.includes('storage.type.declare.regexp.named.raku')
        )
    );
}

/**
 * Check if line is an else/elsif/orwith keyword
 */
function isElseKeyword(line: LineInfo): boolean {
    if (line.isEmpty || line.isComment || line.isPod) return false;
    
    const trimmed = line.text.trim();
    // Check if line starts with else/elsif/orwith keyword
    if (/^(else|elsif|orwith)\b/.test(trimmed)) {
        // Verify via token scopes
        return line.tokens.some(token =>
            token.scopes.some(scope => scope.includes('keyword.control.conditional'))
        );
    }
    return false;
}

/**
 * Check if a line ends with an opening parenthesis (multi-line signature)
 */
function endsWithOpenParen(line: LineInfo): boolean {
    const trimmed = line.text.trim();
    return trimmed.endsWith('(');
}

/**
 * Apply additional formatting rules to a line (beyond indentation)
 */
function applyLineFormatting(line: LineInfo, config: FormattingConfig): string {
    const originalText = line.text;
    let newText = originalText;
    const edits: { start: number; end: number; replacement: string }[] = [];
    
    // Skip entirely if line is comment, string, or POD
    if (line.isComment || line.isPod || line.isEmpty || line.isString) {
        return newText;
    }
    
    // Rule 1: Remove trailing whitespace
    if (config.trimTrailingWhitespace) {
        const trailingMatch = originalText.match(/\s+$/);
        if (trailingMatch) {
            edits.push({
                start: originalText.length - trailingMatch[0].length,
                end: originalText.length,
                replacement: "",
            });
        }
    }
    
    // Rule 2: Remove space before semicolon
    if (config.noSpaceBeforeSemicolon) {
        for (let i = 0; i < originalText.length; i++) {
            if (originalText[i] === ';' && i > 0 && /\s/.test(originalText[i - 1])) {
                if (!isInsideSpecialContext(line.tokens, originalText, i)) {
                    let startIdx = i - 1;
                    while (startIdx >= 0 && /\s/.test(originalText[startIdx])) {
                        startIdx--;
                    }
                    edits.push({ start: startIdx + 1, end: i, replacement: "" });
                }
            }
        }
    }
    
    // Rule 3: Add space after comma (if not followed by space/newline/closing bracket)
    if (config.spaceAfterComma) {
        for (let i = 0; i < originalText.length; i++) {
            if (originalText[i] === ',' && i < originalText.length - 1) {
                const nextChar = originalText[i + 1];
                if (nextChar !== ' ' && nextChar !== '\t' && nextChar !== '\n' &&
                    nextChar !== ')' && nextChar !== ']' && nextChar !== '}') {
                    if (!isInsideSpecialContext(line.tokens, originalText, i)) {
                        edits.push({ start: i + 1, end: i + 1, replacement: " " });
                    }
                }
            }
        }
    }
    
    // Rule 4: Add space after control keywords (if, for, while, etc.)
    if (config.spaceAfterKeywords) {
        const controlKeywords = ['if', 'unless', 'for', 'while', 'until', 'loop', 'given', 'when', 'with', 'without', 'orwith'];
        for (let i = 0; i < line.tokens.length; i++) {
            const token = line.tokens[i];
            const isControlKeyword = token.scopes.some(scope =>
                scope.includes('keyword.control.conditional') ||
                scope.includes('keyword.control.repeat')
            );
            if (!isControlKeyword) continue;
            
            const startIdx = i === 0 ? 0 : line.tokens[i - 1].endIndex;
            const tokenText = originalText.substring(startIdx, token.endIndex);
            
            for (const keyword of controlKeywords) {
                const match = tokenText.match(new RegExp(`\\b${keyword}\\b`));
                if (!match || match.index === undefined) continue;
                const keywordPos = startIdx + match.index;
                const afterKeyword = keywordPos + keyword.length;
                if (afterKeyword < originalText.length && !/\s/.test(originalText[afterKeyword])) {
                    edits.push({ start: afterKeyword, end: afterKeyword, replacement: " " });
                }
            }
        }
    }
    
    // Rule 5: Add space before opening brace in declarations
    if (config.spaceBeforeBrace && hasDeclarationKeyword(line)) {
        for (let i = 0; i < originalText.length; i++) {
            if (originalText[i] === '{' && i > 0 && !isInsideSpecialContext(line.tokens, originalText, i)) {
                if (!isBlockBraceAtPosition(line.tokens, i)) continue;
                if (originalText[i - 1] !== ' ' && originalText[i - 1] !== '\t') {
                    edits.push({ start: i, end: i, replacement: " " });
                }
            }
        }
    }
    
    // Apply edits from end to start to keep offsets stable
    edits.sort((a, b) => b.start - a.start);
    for (const edit of edits) {
        newText = newText.substring(0, edit.start) + edit.replacement + newText.substring(edit.end);
    }
    
    return newText;
}

/**
 * Apply multi-line formatting rules (uncuddled elses, brace on same line)
 * Returns map of line numbers to their new text
 */
function applyMultiLineFormatting(lineInfos: LineInfo[], allLines: string[], config: FormattingConfig, rangeStart: number = 0, rangeEnd: number = lineInfos.length - 1): Map<number, string> {
    const modifications = new Map<number, string>();
    
    for (let i = 0; i < lineInfos.length - 1; i++) {
        const currentLine = lineInfos[i];
        const nextLine = lineInfos[i + 1];
        
        // Skip if current line is comment, string, or POD
        if (currentLine.isComment || currentLine.isPod || currentLine.isEmpty || currentLine.isString) {
            continue;
        }
        
        // Rule 1: Uncuddled elses - move else/elsif/orwith to same line as closing brace
        if (config.cuddledElse && (currentLine.text.trim() === '}' || currentLine.text.trim() === '};')) {
            // Check if next non-blank line is an else keyword
            let nextContentLine = i + 1;
            while (nextContentLine < lineInfos.length && lineInfos[nextContentLine].isEmpty) {
                nextContentLine++;
            }
            
            if (nextContentLine < lineInfos.length && isElseKeyword(lineInfos[nextContentLine])) {
                // Skip if any involved line is outside the formatting range
                if (i < rangeStart || nextContentLine > rangeEnd) continue;

                const elseLineInfo = lineInfos[nextContentLine];
                const elseLinesqueezed = elseLineInfo.text.trim();
                
                // Cuddle the else: add it to the current line
                const newCurrentLine = currentLine.text.trimEnd() + ' ' + elseLinesqueezed;
                modifications.set(i, newCurrentLine);
                
                // Mark the else line for removal (empty it)
                modifications.set(nextContentLine, '');
                
                // Remove intermediate blank lines
                for (let j = i + 1; j < nextContentLine; j++) {
                    if (lineInfos[j].isEmpty) {
                        modifications.set(j, '');
                    }
                }
            }
        }
        
        // Rule 2: Opening brace on same line for declarations
        if (config.braceOnSameLine && hasDeclarationKeyword(currentLine) && !endsWithOpenParen(currentLine) && !currentLine.text.trim().includes('{')) {
            // Check if next non-blank line is just an opening brace
            let nextContentLine = i + 1;
            while (nextContentLine < lineInfos.length && lineInfos[nextContentLine].isEmpty) {
                nextContentLine++;
            }
            
            if (nextContentLine < lineInfos.length) {
                const nextLineText = lineInfos[nextContentLine].text.trim();
                const nextLineRaw = lineInfos[nextContentLine].text;
                
                // Check if next line starts with { (and might have other content like comments)
                if (nextLineText.startsWith('{')) {
                    // Skip if any involved line is outside the formatting range
                    if (i < rangeStart || nextContentLine > rangeEnd) continue;

                    const bracePos = nextLineRaw.indexOf('{');
                    if (bracePos === -1 || !isBlockBraceAtPosition(lineInfos[nextContentLine].tokens, bracePos)) {
                        continue;
                    }
                    // Move the brace to the current line
                    const newCurrentLine = currentLine.text.trimEnd() + ' ' + nextLineText;
                    modifications.set(i, newCurrentLine);
                    
                    // Remove the brace line
                    modifications.set(nextContentLine, '');
                    
                    // Remove intermediate blank lines
                    for (let j = i + 1; j < nextContentLine; j++) {
                        if (lineInfos[j].isEmpty) {
                            modifications.set(j, '');
                        }
                    }
                }
            }
        }
    }
    
    return modifications;
}

/**
 * Format entire document
 */
export async function formatDocument(
    document: TextDocument,
    options: FormattingOptions,
    settings: NavigatorSettings
): Promise<TextEdit[]> {
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    
    return formatLines(document, lines, 0, lines.length - 1, options, settings);
}

/**
 * Format a specific range
 */
export async function formatRange(
    document: TextDocument,
    range: Range,
    options: FormattingOptions,
    settings: NavigatorSettings
): Promise<TextEdit[]> {
    const text = document.getText();
    const lines = text.split(/\r?\n/);
    
    // We need to analyze from the beginning to track bracket state correctly,
    // but only generate edits for the requested range
    return formatLines(document, lines, range.start.line, range.end.line, options, settings);
}

/**
 * Core formatting logic - tokenize and fix indentation
 */
async function formatLines(
    document: TextDocument,
    allLines: string[],
    startLine: number,
    endLine: number,
    options: FormattingOptions,
    settings: NavigatorSettings
): Promise<TextEdit[]> {
    
    const grammar = await registry.loadGrammar("source.raku");
    if (!grammar) {
        throw new Error("Couldn't load Textmate grammar");
    }
    
    // Tokenize all lines to track bracket state correctly
    let ruleStack: vsctm.StateStack | null = vsctm.INITIAL;
    const lineInfos: LineInfo[] = [];
    
    for (let i = 0; i < allLines.length; i++) {
        const analysis: { lineInfo: LineInfo; ruleStack: vsctm.StateStack } = await analyzeLine(i, allLines[i], grammar, ruleStack);
        lineInfos.push(analysis.lineInfo);
        ruleStack = analysis.ruleStack;
    }
    
    // Calculate expected indentation for all lines
    const expectedIndents = calculateIndents(lineInfos);
    const formatting: NonNullable<NavigatorSettings["formatting"]> = settings.formatting ?? { enable: true, indentSize: 4 };
    const config: FormattingConfig = {
        trimTrailingWhitespace: formatting.trimTrailingWhitespace !== false,
        insertFinalNewline: formatting.insertFinalNewline !== false,
        spaceAfterComma: formatting.spaceAfterComma !== false,
        noSpaceBeforeSemicolon: formatting.noSpaceBeforeSemicolon !== false,
        spaceAfterKeywords: formatting.spaceAfterKeywords !== false,
        spaceBeforeBrace: formatting.spaceBeforeBrace !== false,
        braceOnSameLine: formatting.braceOnSameLine !== false,
        cuddledElse: formatting.cuddledElse !== false,
        indentSize: formatting.indentSize || 4,
    };
    
    // Apply multi-line formatting rules (uncuddled elses, brace on same line)
    // Pass the range so merges straddling the boundary are skipped
    const multiLineChanges = applyMultiLineFormatting(lineInfos, allLines, config, startLine, endLine);
    
    // Track lines to delete (they'll be merged into other lines)
    const linesToDelete = new Set<number>();
    for (const [lineNum, newText] of multiLineChanges.entries()) {
        if (newText === '') {
            linesToDelete.add(lineNum);
        }
    }
    
    // Generate TextEdit array only for the requested range
    const edits: TextEdit[] = [];
    
    for (let i = startLine; i <= Math.min(endLine, lineInfos.length - 1); i++) {
        const line = lineInfos[i];
        const originalText = allLines[i];
        
        // Check if this line should be deleted (merged into previous line)
        if (linesToDelete.has(i)) {
            if (i + 1 <= allLines.length - 1) {
                // Delete the entire line including newline
                const range: Range = {
                    start: { line: i, character: 0 },
                    end: { line: i + 1, character: 0 }
                };
                edits.push(TextEdit.del(range));
            } else {
                // Last line: delete content only
                const range: Range = {
                    start: { line: i, character: 0 },
                    end: { line: i, character: originalText.length }
                };
                edits.push(TextEdit.replace(range, ""));
            }
            continue;
        }
        
        // Check if this line was modified by multi-line rules
        let newText = multiLineChanges.has(i) ? multiLineChanges.get(i)! : originalText;
        const isNowEmpty = newText.trim().length === 0;
        
        // Apply additional formatting rules (skip if multi-line modified to avoid token drift)
        const formattedText = multiLineChanges.has(i) ? newText : applyLineFormatting({
            ...line,
            text: newText
        }, config);
        
        // Apply indentation fix after other line edits
        let finalText = formattedText;
        const trimmedText = finalText.trim();
        const isMethodContinuation = trimmedText.startsWith('.');
        
        // Skip indentation for method continuation lines (preserve user formatting)
        if (!isNowEmpty && !line.isPod && !isMethodContinuation) {
            const expectedIndent = expectedIndents[i];
            const expectedWhitespace = generateIndent(expectedIndent, options, config);
            const leadingMatch = finalText.match(/^(\s*)/);
            const currentLeading = leadingMatch ? leadingMatch[1] : "";
            if (currentLeading !== expectedWhitespace) {
                finalText = expectedWhitespace + finalText.substring(currentLeading.length);
            }
        }
        
        // Only create an edit if the line changed
        if (originalText !== finalText) {
            const range: Range = {
                start: { line: i, character: 0 },
                end: { line: i, character: originalText.length }
            };
            edits.push(TextEdit.replace(range, finalText));
        }
    }
    
    // Handle final newline (only for full document formatting)
    if (config.insertFinalNewline && startLine === 0 && endLine === allLines.length - 1) {
        const documentText = document.getText();
        const endsWithNewline = documentText.endsWith('\n') || documentText.endsWith('\r\n');
        
        if (!endsWithNewline && documentText.length > 0) {
            // Add final newline
            const lastLine = allLines.length - 1;
            const lastLineLength = allLines[lastLine].length;
            edits.push(TextEdit.insert(
                { line: lastLine, character: lastLineLength },
                '\n'
            ));
        }
    }
    
    return edits;
}
