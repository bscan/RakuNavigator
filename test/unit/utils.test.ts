import { strict as assert } from 'assert';
import URI from 'vscode-uri';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';

// Import from built server output
// eslint-disable-next-line @typescript-eslint/no-var-requires
const utils = require('../../server/out/utils');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const types = require('../../server/out/types');

function mkWorkspaceFolder(fsPath: string) {
	return { name: path.basename(fsPath), uri: URI.file(fsPath).toString() };
}

function mkSettings(includePaths: string[] = []) {
	return { rakuPath: 'raku', includePaths, logging: false, syntaxCheckEnabled: false };
}

function mkDoc(content: string, fsPath = '/tmp/sample.raku') {
	const uri = URI.file(fsPath).toString();
	return TextDocument.create(uri, 'raku', 1, content);
}

function mkRakuDoc(uri: string) {
	return {
		elems: new Map(),
		canonicalElems: new Map(),
		imported: new Map(),
		parents: new Map(),
		uri,
	};
}

describe('utils.ts', () => {
	it('getIncPaths expands $workspaceFolder and adds lib', () => {
		const ws = mkWorkspaceFolder('/work/ws1');
		const settings = mkSettings(['$workspaceFolder/foo', '/abs/bar']);
		const incs: string[] = utils.getIncPaths([ws], settings);

		const pairs: string[] = [];
		for (let i = 0; i < incs.length; i += 2) pairs.push(`${incs[i]} ${incs[i + 1]}`);

		assert.ok(pairs.some(p => p.includes('/work/ws1/foo')), 'workspaceFolder substitution');
		// auto lib include only if exists; we can at least assert the array shape (-I tokens)
		assert.ok(incs.filter(x => x === '-I').length >= 2, 'contains -I tokens');
		assert.ok(pairs.some(p => p.includes('/abs/bar')), 'absolute include');
	});

	it('getSymbol extracts variable and method-ish tokens', () => {
		const doc = mkDoc('my $x = 1; $x.say();\nmy $obj = Foo.new(); $obj.method();');

		// On $x
		// Place cursor on the 'x' to allow getSymbol to include the leading sigil
		let sym = utils.getSymbol({ line: 0, character: 12 }, doc);
		assert.equal(sym, '$x');

		// On $.documents-like (synthetic)
		const doc2 = mkDoc('$.documents');
		sym = utils.getSymbol({ line: 0, character: 2 }, doc2);
		assert.equal(sym, '$.documents');
	});

	it('lookupSymbol finds local declarations and module from map', () => {
		const uri = URI.file('/tmp/a.raku').toString();
		const rdoc = mkRakuDoc(uri);
		const elem = { name: '$x', type: types.RakuSymbolKind.LocalVar, line: 1, lineEnd: 1, source: types.ElemSource.symbolTable, uri, package: 'MAIN' };
		rdoc.elems.set('$x', [elem]);

		// Simple
		let res = utils.lookupSymbol(rdoc, new Map(), '$x', 10);
		assert.equal(res.length, 1);
		assert.equal(res[0].name, '$x');

		// Module fallback
		const modMap = new Map();
		modMap.set('Foo', URI.file('/mods/Foo.rakumod').toString());
		res = utils.lookupSymbol(rdoc, modMap, 'Foo', 0);
		assert.equal(res.length, 1);
		assert.equal(res[0].type, types.RakuSymbolKind.Module);
	});

	it('isFile returns false for non-existent path', async () => {
		const ok = await utils.isFile('/this/should/not/exist/abcdef');
		assert.equal(ok, false);
	});
});

