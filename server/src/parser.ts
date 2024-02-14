import { RakuDocument, RakuElem, RakuSymbolKind, ParseType, TagKind, ElemSource } from "./types";
import { TextDocument } from "vscode-languageserver-textdocument";
import Uri from "vscode-uri";
import fs = require("fs");
import path = require("path");
import vsctm = require("vscode-textmate");
import oniguruma = require("vscode-oniguruma");

function init_doc(textDocument: TextDocument): RakuDocument {
    // We probably dont need this
    const filePath = Uri.parse(textDocument.uri).fsPath;

    let rakuDoc: RakuDocument = {
        elems: new Map(),
        canonicalElems: new Map(),
        imported: new Map(),
        parents: new Map(),
        uri: textDocument.uri,
    };

    return rakuDoc;
}

type ParserState = {
    stmt: string;
    line_number: number;
    var_continues: boolean;
    package_name: string;
    uri: string;
    rakuDoc: RakuDocument;
    parseType: ParseType;
    codeArray: string[];
};

type ParseFunc = (state: ParserState) => boolean;

export async function parseFromUri(uri: string, parseType: ParseType): Promise<RakuDocument | undefined> {
    // File may not exists. Return nothing if it doesn't
    const absolutePath = Uri.parse(uri).fsPath;
    try {
        var content = await fs.promises.readFile(absolutePath, "utf8");
    } catch {
        return;
    }

    const document = TextDocument.create(uri, "raku", 1, content);

    return await parseDocument(document, parseType);
}

export async function parseDocument(textDocument: TextDocument, parseType: ParseType): Promise<RakuDocument> {
    let parseFunctions: ParseFunc[] = [];
    switch (parseType) {
        case ParseType.outline:
            parseFunctions = [subs, fields, phasers, tokens, imports];
            break;
        case ParseType.selfNavigation:
            parseFunctions = [knownObj, localVars, subs, tokens, fields, imports];
            break;
        case ParseType.refinement:
            parseFunctions = [subs, tokens, fields];
            break;
    }

    parseFunctions.unshift(packages); // Packages always need to be found to be able to categorize the elements.

    let rakuDoc = init_doc(textDocument);

    let state: ParserState = {
        stmt: "",
        line_number: 0,
        package_name: "",
        rakuDoc: rakuDoc,
        uri: textDocument.uri,
        var_continues: false,
        codeArray: await cleanCode(textDocument, rakuDoc, parseType),
        parseType: parseType,
    };

    for (state.line_number = 0; state.line_number < state.codeArray.length; state.line_number++) {
        state.stmt = state.codeArray[state.line_number];
        // Nothing left? Never mind.
        if (!state.stmt) continue;

        parseFunctions.some((fn) => fn(state));
    }
    return rakuDoc;
}

function knownObj(state: ParserState): boolean {
    let match;

    // TODO, allow specifying list of constructor names as config
    // Declaring an object. Let's store the type
    // my $constructors = qr/(?:new|connect)/;
    if (
        (match = state.stmt.match(/^(?:my|our|let|state)\s+(\$\w+)\s*\=\s*([\w\:]+)\-\>new\s*(?:\((?!.*\)\->)|;)/)) ||
        (match = state.stmt.match(/^(?:my|our|let|state)\s+(\$\w+)\s*\=\s*new (\w[\w\:]+)\s*(?:\((?!.*\)\->)|;)/))
    ) {
        let varName = match[1];
        let objName = match[2];
        MakeElem(varName, RakuSymbolKind.LocalVar, objName, state);

        state.var_continues = false; // We skipped ahead of the line here. Why though?
        return true;
    } else {
        return false;
    }
}

function localVars(state: ParserState): boolean {
    // This is a variable declaration if one was started on the previous
    // line, or if this line starts with my or local
    let match;
    if (state.var_continues || (match = state.stmt.match(/^(?:my|our|let|state)\b/))) {
        // The declaration continues unless there's a semicolon, signature end, or sub start. 
        // This can get tripped up with comments, but it's not a huge deal. subroutines are more important
        state.var_continues = !state.stmt.match(/[\)\=\}\{;]/);
        
        let mod_stmt = state.stmt;
        // Remove my or local from statement, if present
        mod_stmt = mod_stmt.replace(/^(my|our|let|state)\s+/, "");

        // Remove any assignment piece. Breaks with signature defaults
        mod_stmt = mod_stmt.replace(/\s*=.*/, "");

        // Remove part where sub starts (for signatures), while exempting default {} args
        mod_stmt = mod_stmt.replace(/\s*(\{[^\}]|\)).*/, "");

        // Now find all variable names, i.e. "words" preceded by $, @ or %
        let vars = mod_stmt.matchAll(/([\$\@\%](?:[\w\-]|::)+)/g);

        for (let match of vars) MakeElem(match[1], RakuSymbolKind.LocalVar, "", state);
        return true;
        // Lexical loop variables, potentially with labels in front. foreach my $foo
    } else if ((match = state.stmt.match(/^(?:\}\s*elsif|if|unless|while|until|for)?\s*\(\s*my\b(.*)$/))) {
        // Remove any assignment piece
        const mod_stmt = state.stmt.replace(/\s*=.*/, "");
        let vars = mod_stmt.matchAll(/([\$\@\%][\w]+)\b/g);
        for (let match of vars) MakeElem(match[1], RakuSymbolKind.LocalVar, "", state);
        // Try-catch exception variables
    } else if ((match = state.stmt.match(/^\}?\s*catch\s*\(\s*(\$\w+)\s*\)\s*\{?$/))) {
        MakeElem(match[1], RakuSymbolKind.LocalVar, "", state);
    } else {
        return false;
    }

    return true;
}

function packages(state: ParserState): boolean {
    // This is a package declaration if the line starts with package
    let match;

    if ((match = state.stmt.match(/^package\s+([\w:]+)/))) {
        // Get name of the package
        state.package_name = match[1];
        const endLine = PackageEndLine(state);
        MakeElem(state.package_name, RakuSymbolKind.Package, "", state, endLine);

	} else if ((match = state.stmt.match(/^(?:(?:my|our|unit) )?class\s+((?:[\w\-]|::)+)/))) {
        let class_name = match[1];
        state.package_name = class_name;
        const endLine = PackageEndLine(state);
        MakeElem(class_name, RakuSymbolKind.Class, "", state, endLine);
    } else if ((match = state.stmt.match(/^(?:(?:my|our|unit) )?(?:proto )?role\s+([\w\-:<>]+)/))) {
        const roleName = match[1];
        // state.package_name = roleName; # Being cautious against changing the package name
        const endLine = SubEndLine(state);
        MakeElem(roleName, RakuSymbolKind.Role, "", state, endLine);
    } else if ((match = state.stmt.match(/^(?:my )?grammar\s+((?:[\w\-]|::)+)/))) {
        const roleName = match[1];
        // state.package_name = roleName; # Being cautious against changing the package name
        const endLine = SubEndLine(state);
        MakeElem(roleName, RakuSymbolKind.Grammar, "", state, endLine);
    } else if ((match = state.stmt.match(/^(?:unit )?module\s+((?:[\w\-]|::)+)/))) {
        const roleName = match[1];
        console.log(`Matching module: ${roleName}`);
        state.package_name = roleName; // Being cautious against changing the package name
        const endLine = PackageEndLine(state);
        MakeElem(roleName, RakuSymbolKind.LocalModule, "", state, endLine);
    } else {
        return false;
    }

    return true;
}

function tokens(state: ParserState): boolean {
	let match;

	if ((match = state.stmt.match(/^(?:my )?token\s+([\w\-]+)(:[\w\-<>]+)?/))) {
        // Get name of the package
        state.package_name = match[1];
        const endLine = PackageEndLine(state);
        MakeElem(state.package_name, RakuSymbolKind.Token, "", state, endLine);
	} else if ((match = state.stmt.match(/^(?:my )?rule\s+([\w\-]+)(:[\w\-<>]+)?/))) {
        const roleName = match[1];
        // state.package_name = roleName; # Being cautious against changing the package name
        const endLine = SubEndLine(state);
        MakeElem(roleName, RakuSymbolKind.Rule, "", state, endLine);
    } else {
		return false;
	}
	return true;
}

function subs(state: ParserState): boolean {
    let match;
    // This is a sub declaration if the line starts with sub
    if (
        (match = state.stmt.match(/^multi\s+(?:(sub|method|submethod)\s+)?!?([\w\-]+)((?::[\w\-<>]+)?\s?\([^()]+\))/)) // Grab signature for Multi-sub.
		|| (match = state.stmt.match(/^(?:(?:my|our) )?(sub|method|submethod)\s+!?([\w\-]+)((?::[\w\-<>]+)?[^{]*)/))
    ) {
		// TODO: Captures multi-dispatch details and signature for display in the outline, different from the symbol name itself

        const subName = match[2];
        const signature = match[3] || '';
        const kind = match[1] === "method" || match[1] === "submethod" ? RakuSymbolKind.LocalMethod : RakuSymbolKind.LocalSub;
        const endLine = SubEndLine(state);

        // Match the after the sub declaration and before the start of the actual sub for signatures (if any).
        // TODO: Change this to multi-line signatures
        const vars = signature.matchAll(/([\$\@\%](?:[\w\-]|::)+)/g);
        let signature_params = [];

        // Define subrountine signatures, but exclude prototypes
        // The declaration continues if the line does not end with ;
        state.var_continues = !(state.stmt.endsWith(';') || state.stmt.match(/[\)\=\}\{]/));

        for (const matchvar of vars) {
            signature_params.push(matchvar[1]);
            MakeElem(matchvar[1], RakuSymbolKind.LocalVar, "", state);
        }

        const extras = look_ahead_signatures(state);
        for (const extra of extras) {
            signature_params.push(extra);
        }

        MakeElem(subName, kind, "", state, endLine, signature_params);
    } else {
        return false;
    }
    return true;
}

function look_ahead_signatures(state: ParserState): string[] {
    let sig_vars: string[] = [];
    let sig_continues = true;

    for (let i = state.line_number; i < state.codeArray.length; i++) {
        // Limit depth for speed and accuracy.
        let depth = i - state.line_number;
        let stmt = state.codeArray[i];

        if (sig_continues) {
            // The signature continues if the line does not end with ;
            sig_continues = !stmt.endsWith(";") && !stmt.match(/[\)\}\{]/);

            if (depth > 0) {
                // First line is already parsed
                // Remove part where sub starts (for signatures). Consider other options here.
                let mod_stmt = stmt.replace(/\s*(\{[^\}]|\)).*/, "");
                // Now find all variable names, i.e. "words" preceded by $, @ or %
                let vars = mod_stmt.matchAll(/([\$\@\%][\w:]+)\b/g);
                for (const matchvar of vars) {
                    sig_vars.push(matchvar[0]);
                }
            }
        }
        let match;
        if ((match = stmt.match(/(?:^|{)\s*my\s*(\(\s*[\$@%]\w+\s*(?:,\s*[\$@%]\w+\s*)*\))\s*=\s*\@_/)) || // my ($foo, $bar) = @_
            (match = stmt.match(/(?:^|{)\s*my\s+(\s*[\$@%]\w+\s*)=\s*shift\b/)) ||                         // my $foo = shift
            (match = stmt.match(/(?:^|{)\s*my\s*(\(\s*[\$@%]\w+\s*\))\s*=\s*shift\b/))                     // my ($foo) = shift
            ) {
            let vars = match[1].matchAll(/([\$\@\%][\w:]+)\b/g);
            for (const matchvar of vars) {
                sig_vars.push(matchvar[0]);
            }
        }

        if (depth > 4 || stmt.match(/(?:^|[^{])\}/)) {
            // Sub has ended, we don't want to find the signature from the next sub.
            return sig_vars;
        }
    }

    return sig_vars;
}

function fields(state: ParserState): boolean {
    let match;

	if ((match = state.stmt.match(/^has\s+(?:\w+\s+)?([$@%][\.\!][\w-]+)(?:\s|;|)/))) {
        const attr = match[1];
        let type;
		type = RakuSymbolKind.Field;
		// Restore this
        // if (attr.match(/^\w/)) {
        //     // If you have a locally defined package/class Foo want to reference the attributes as Foo::attr or foo->attr, you need the full path.
        //     MakeElem(state.package_name + "::" + attr, RakuSymbolKind.PathedField, "", state);
        // } else {
        //     type = RakuSymbolKind.Field;
        // }
        // TODO: Define new type. Class variables should probably be shown in the Outline view even though lexical variables are not
        MakeElem(attr, type, "", state);
    }
    else {
        return false;
    }
    return true;
}

function phasers(state: ParserState): boolean {
    let match;
    // Phaser block
    if ((match = state.stmt.match(/^(BEGIN|CHECK|INIT|END)\s*\{/))) {
        const phaser = match[1];
        const endLine = SubEndLine(state);

        MakeElem(phaser, RakuSymbolKind.Phaser, "", state, endLine);
    } else {
		return false;
	}
	return true;
}

function imports(state: ParserState): boolean {
    let match;
    if ((match = state.stmt.match(/^use\s+([\w:]+)\b/))) {
        // Keep track of explicit imports for filtering
        const importPkg = match[1];
        MakeElem(importPkg, TagKind.UseStatement, "", state);
        return true;
    } else {
        return false;
    }
}

async function cleanCode(textDocument: TextDocument, rakuDoc: RakuDocument, parseType: ParseType): Promise<string[]> {
    let code = textDocument.getText();

    const codeArray = code.split("\n");
    // const offset = textDocument.offsetAt(textDocument.positionAt(0));
    let codeClean = [];

    let commentState: ParserState = {
        stmt: "",
        line_number: 0,
        package_name: "",
        rakuDoc: rakuDoc,
        uri: textDocument.uri,
        var_continues: false,
        codeArray: codeArray,
        parseType: parseType,
    };

    for (commentState.line_number = 0; commentState.line_number < codeArray.length; commentState.line_number++) {
        commentState.stmt = codeArray[commentState.line_number];

        let mod_stmt = commentState.stmt;
        mod_stmt = mod_stmt.replace(/^\s*/, "");
        mod_stmt = mod_stmt.replace(/\s*$/, "");

        codeClean.push(mod_stmt);
    }

    if (parseType == ParseType.outline) {
        // If only doing shallow parsing, we don't need to strip {} or find start-end points of subs
        codeClean = await stripCommentsAndQuotes(codeClean);
    }

    return codeClean;
}

function MakeElem(name: string, type: RakuSymbolKind | TagKind, typeDetail: string, state: ParserState, lineEnd: number = 0, signature: string[] = []): void {
    if (!name) return; // Don't store empty names (shouldn't happen)

    if (lineEnd == 0) {
        lineEnd = state.line_number;
    }

    if (type == TagKind.UseStatement) {
        // Explictly loaded module. Helpful for focusing autocomplete results
        state.rakuDoc.imported.set(name, state.line_number);
        // if(/\bDBI$/.exec(name)) rakuDoc.imported.set(name + "::db", true); // TODO: Build mapping of common constructors to types
        return; // Don't store it as an element
    }

    const newElem: RakuElem = {
        name: name,
        type: type,
        uri: state.uri,
        package: state.package_name,
        line: state.line_number,
        lineEnd: lineEnd,
        source: ElemSource.parser,
    };

    // if (signature?.length > 0) {
    //     newElem.signature = signature;
    // }

    let array = state.rakuDoc.elems.get(name) || [];
    array.push(newElem);
    state.rakuDoc.elems.set(name, array);

    return;
}

function SubEndLine(state: ParserState, rFilter: RegExp | null = null): number {
    let pos = 0;
    let found = false;
    if (state.parseType != ParseType.outline) {
        return state.line_number;
    }

    for (let i = state.line_number; i < state.codeArray.length; i++) {
        // Perhaps limit the max depth?
        let stmt = state.codeArray[i];

        if (i == state.line_number) {
            if (rFilter) stmt.replace(rFilter, "");
            // Default argument of empty hash. Other types of hashes may still trip this up
            stmt.replace(/\$\w+\s*=\s*\{\s*\}/, "");
            if(stmt.match(/;\s*$/)){
                // "Forward" declaration, such as `sub foo;`
                return i;
            }
        }

        stmt.split("").forEach((char: string) => {
            if (char == "{") {
                // You may just be finding default function args = {}
                found = true;
                pos++;
            } else if (char == "}") {
                pos--;
            }
        });
        //  Checking outside the statement is faster, but less accurate
        if (found && pos == 0) {
            return i;
        }
    }
    return state.line_number;
}

function PackageEndLine(state: ParserState) {
    if (state.parseType != ParseType.outline) {
        return state.line_number;
    }

    let start_line = state.line_number;
    if (state.codeArray[start_line].match(/(class|package)[^#]+;/)) {
        // Single line package definition.
        if (state.codeArray[start_line].match(/{.*(class|package)/)) {
            // Will need to hunt for the end
        } else if (start_line > 0 && state.codeArray[start_line - 1].match(/\{[^}]*$/)) {
            start_line -= 1;
        }
    }

    let pos = 0;
    let found = false;

    for (let i = start_line; i < state.codeArray.length; i++) {
        // Perhaps limit the max depth?
        let stmt = state.codeArray[i];
        stmt.split("").forEach((char: string) => {
            if (char == "{") {
                found = true;
                pos++;
            } else if (char == "}") {
                pos--;
            }
        });

        if (found == false) {
            // If we haven't found the start of the package block, there probably isn't one.
            if (stmt.indexOf(';') != -1 || i - start_line > 1) {
                break;
            }
        }

        //  Checking outside the forEach statement is faster, but less accurate
        if (found && pos == 0) {
            return i;
        }
    }

    for (let i = start_line + 1; i < state.codeArray.length; i++) {
        // TODO: update with class inheritance / version numbers, etc
        // Although should we do with nested packages/classes? (e.g. Pack A -> Pack B {} -> A)
        if (state.codeArray[i].match(/^\s*(class|package)\s+([\w:]+)/)) {
            return i - 1;
        }
    }

    // If we didn't find an end, run until end of file
    return state.codeArray.length;
}

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

async function stripCommentsAndQuotes(code: string[]): Promise<string[]> {
    const grammar = await registry.loadGrammar("source.raku");
    if (!grammar) {
        throw new Error("Couldn't load Textmate grammar");
    }

    let ruleStack: vsctm.StateStack | null = vsctm.INITIAL;
    let codeStripped = [];

    for (const line of code) {
        const result = grammar.tokenizeLine(line, ruleStack);
        ruleStack = result.ruleStack;
        let strippedCode = "";

        let lastEndIndex = 0;
        for (const token of result.tokens) {
            const content = line.substring(lastEndIndex, token.endIndex);
            lastEndIndex = token.endIndex;

            // This includes regexes and pod too
            const isComment = token.scopes.some((scope) => scope.startsWith("comment"));

            if (isComment) {
                // Remove all comments
                continue;
            }

            const isString = token.scopes.some((scope) => scope.startsWith("string"));
            const isPunc = token.scopes.some((scope) => scope.startsWith("punctuation"));

            if (isString && !isPunc) {
                if (strippedCode == "") {
                    // The 2nd-Nth lines of multi-line strings should be stripped
                    strippedCode += "___";
                    continue;
                } else if (content.match(/[\{\}]/)) {
                    // In-line strings that contains {} need to be stripped regardless of position
                    continue;
                }
            }
            strippedCode += content;
        }
        codeStripped.push(strippedCode);
    }

    return codeStripped;
}
