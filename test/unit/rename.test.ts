import { strict as assert } from 'assert';
import URI from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';

// Import from built server output
// eslint-disable-next-line @typescript-eslint/no-var-requires
const references = require('../../server/out/references');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const types = require('../../server/out/types');

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

describe('rename.ts', () => {
	describe('prepareRename', () => {
		it('returns range and placeholder for renameable symbol', async () => {
			const content = 'sub foo() { }\nfoo();';
			const doc = mkDoc(content);
			const rakuDoc = mkRakuDoc(doc.uri);

			// Add foo to the symbol table
			const elem = {
				name: 'foo',
				type: types.RakuSymbolKind.LocalSub,
				line: 0,
				lineEnd: 0,
				source: types.ElemSource.symbolTable,
				uri: doc.uri,
				package: 'MAIN'
			};
			rakuDoc.elems.set('foo', [elem]);

			const result = references.prepareRename({ line: 0, character: 5 }, rakuDoc, doc);

			assert.ok(result, 'Should return a result');
			assert.ok(result.range, 'Should have a range');
			assert.equal(result.placeholder, 'foo', 'Placeholder should be the symbol name');
		});

		it('returns null for unrenameable built-in type', async () => {
			const content = 'my Str $x;';
			const doc = mkDoc(content);
			const rakuDoc = mkRakuDoc(doc.uri);

			const result = references.prepareRename({ line: 0, character: 4 }, rakuDoc, doc);

			assert.equal(result, null, 'Should not allow renaming built-in type');
		});

		it('returns null for unrenameable keyword', async () => {
			const content = 'if $x { }';
			const doc = mkDoc(content);
			const rakuDoc = mkRakuDoc(doc.uri);

			const result = references.prepareRename({ line: 0, character: 1 }, rakuDoc, doc);

			assert.equal(result, null, 'Should not allow renaming keyword');
		});
	});

	describe('executeRename', () => {
		it('renames simple function calls', async () => {
			const content = 'sub foo() { }\nfoo();\nmy $x = foo();';
			const doc = mkDoc(content);
			const rakuDoc = mkRakuDoc(doc.uri);

			// Add foo to the symbol table
			const elem = {
				name: 'foo',
				type: types.RakuSymbolKind.LocalSub,
				line: 0,
				lineEnd: 0,
				source: types.ElemSource.symbolTable,
				uri: doc.uri,
				package: 'MAIN'
			};
			rakuDoc.elems.set('foo', [elem]);

			const result = await references.executeRename(
				{ line: 0, character: 5 },
				'bar',
				rakuDoc,
				doc
			);

			assert.ok(result, 'Should return workspace edit');
			assert.ok(result.changes, 'Should have changes');
			assert.ok(result.changes[doc.uri], 'Should have changes for this document');
			assert.equal(result.changes[doc.uri].length, 3, 'Should have 3 edits (declaration + 2 calls)');

			// Verify all edits have the correct new text
			result.changes[doc.uri].forEach((edit: any) => {
				assert.equal(edit.newText, 'bar', 'New text should be "bar"');
			});
		});

		it('preserves parentheses when renaming function with parens', async () => {
			const content = 'sub evaluate-tokens() { }\nevaluate-tokens();';
			const doc = mkDoc(content);
			const rakuDoc = mkRakuDoc(doc.uri);

			const elem = {
				name: 'evaluate-tokens',
				type: types.RakuSymbolKind.LocalSub,
				line: 0,
				lineEnd: 0,
				source: types.ElemSource.symbolTable,
				uri: doc.uri,
				package: 'MAIN'
			};
			rakuDoc.elems.set('evaluate-tokens', [elem]);

			const result = await references.executeRename(
				{ line: 0, character: 8 },
				'process-tokens',
				rakuDoc,
				doc
			);

			assert.ok(result, 'Should return workspace edit');
			const edits = result.changes![doc.uri];

			// Check that the range doesn't include the parentheses
			edits.forEach((edit: any) => {
				const startChar = edit.range.start.character;
				const endChar = edit.range.end.character;
				const originalText = doc.getText(edit.range);

				assert.equal(originalText, 'evaluate-tokens', 'Should only select the function name');
				assert.ok(!originalText.includes('('), 'Should not include opening paren');
			});
		});

		it('preserves dot when renaming method call', async () => {
			const content = 'class Foo {\n  method bar() { }\n}\nmy $obj = Foo.new();\n$obj.bar();';
			const doc = mkDoc(content);
			const rakuDoc = mkRakuDoc(doc.uri);

			const elem = {
				name: 'bar',
				type: types.RakuSymbolKind.Method,
				line: 1,
				lineEnd: 1,
				source: types.ElemSource.symbolTable,
				uri: doc.uri,
				package: 'Foo'
			};
			rakuDoc.elems.set('bar', [elem]);

			const result = await references.executeRename(
				{ line: 1, character: 11 },
				'baz',
				rakuDoc,
				doc
			);

			assert.ok(result, 'Should return workspace edit');
			const edits = result.changes![doc.uri];

			// Verify the dot is not included in any edit range
			edits.forEach((edit: any) => {
				const originalText = doc.getText(edit.range);
				assert.ok(!originalText.includes('.'), 'Should not include dot in range');
				assert.equal(edit.newText, 'baz', 'New text should be "baz"');
			});
		});

		it('preserves dot and parens when renaming method call', async () => {
			const content = 'class Obj { method bar() { } }\nmy $obj = Obj.new();\n$obj.bar();';
			const doc = mkDoc(content);
			const rakuDoc = mkRakuDoc(doc.uri);

			const elem = {
				name: 'bar',
				type: types.RakuSymbolKind.Method,
				line: 0,
				lineEnd: 0,
				source: types.ElemSource.symbolTable,
				uri: doc.uri,
				package: 'Obj'
			};
			rakuDoc.elems.set('bar', [elem]);

			const result = await references.executeRename(
				{ line: 0, character: 20 },
				'renamed',
				rakuDoc,
				doc
			);

			assert.ok(result, 'Should return workspace edit');
			const edits = result.changes![doc.uri];
			assert.ok(edits.length > 0, 'Should find at least one reference');

			// Verify dot and parens are not included in any edit
			edits.forEach((edit: any) => {
				const originalText = doc.getText(edit.range);
				assert.ok(!originalText.includes('.'), 'Should not include dot in range');
				assert.ok(!originalText.includes('('), 'Should not include parens in range');
				assert.equal(edit.newText, 'renamed', 'New text should be "renamed"');
			});
		});

		it('preserves :: when renaming qualified call', async () => {
			const content = 'module Foo {\n  sub bar() { }\n}\nFoo::bar();';
			const doc = mkDoc(content);
			const rakuDoc = mkRakuDoc(doc.uri);

			const elem = {
				name: 'bar',
				type: types.RakuSymbolKind.PackageSub,
				line: 1,
				lineEnd: 1,
				source: types.ElemSource.symbolTable,
				uri: doc.uri,
				package: 'Foo'
			};
			rakuDoc.elems.set('bar', [elem]);

			const result = await references.executeRename(
				{ line: 1, character: 7 },
				'baz',
				rakuDoc,
				doc
			);

			assert.ok(result, 'Should return workspace edit');
			const edits = result.changes![doc.uri];

			// Verify :: is not included
			edits.forEach((edit: any) => {
				const originalText = doc.getText(edit.range);
				assert.ok(!originalText.includes('::'), 'Should not include :: in range');
				assert.equal(edit.newText, 'baz', 'New text should be "baz"');
			});
		});

		it('renames variables with sigils', async () => {
			const content = 'my $foo = 1;\nmy $bar = $foo + 2;\nsay $foo;';
			const doc = mkDoc(content);
			const rakuDoc = mkRakuDoc(doc.uri);

			const elem = {
				name: '$foo',
				type: types.RakuSymbolKind.LocalVar,
				line: 0,
				lineEnd: 0,
				source: types.ElemSource.symbolTable,
				uri: doc.uri,
				package: 'MAIN'
			};
			rakuDoc.elems.set('$foo', [elem]);

			const result = await references.executeRename(
				{ line: 0, character: 4 },
				'baz',
				rakuDoc,
				doc
			);

			assert.ok(result, 'Should return workspace edit');
			const edits = result.changes![doc.uri];
			assert.ok(edits.length >= 2, 'Should find multiple references');

			// Verify sigil is preserved
			edits.forEach((edit: any) => {
				assert.equal(edit.newText, '$baz', 'New text should preserve sigil: $baz');
			});
		});

		it('handles hyphenated names correctly', async () => {
			const content = 'sub my-cool-function() { }\nmy-cool-function();';
			const doc = mkDoc(content);
			const rakuDoc = mkRakuDoc(doc.uri);

			const elem = {
				name: 'my-cool-function',
				type: types.RakuSymbolKind.LocalSub,
				line: 0,
				lineEnd: 0,
				source: types.ElemSource.symbolTable,
				uri: doc.uri,
				package: 'MAIN'
			};
			rakuDoc.elems.set('my-cool-function', [elem]);

			const result = await references.executeRename(
				{ line: 0, character: 8 },
				'my-renamed-function',
				rakuDoc,
				doc
			);

			assert.ok(result, 'Should return workspace edit');
			const edits = result.changes![doc.uri];
			assert.equal(edits.length, 2, 'Should find 2 occurrences');

			edits.forEach((edit: any) => {
				assert.equal(edit.newText, 'my-renamed-function', 'New name should be preserved');
			});
		});

		it('deduplicates overlapping matches', async () => {
			const content = 'sub test() { }\ntest();\ntest;';
			const doc = mkDoc(content);
			const rakuDoc = mkRakuDoc(doc.uri);

			const elem = {
				name: 'test',
				type: types.RakuSymbolKind.LocalSub,
				line: 0,
				lineEnd: 0,
				source: types.ElemSource.symbolTable,
				uri: doc.uri,
				package: 'MAIN'
			};
			rakuDoc.elems.set('test', [elem]);

			const result = await references.executeRename(
				{ line: 0, character: 5 },
				'renamed',
				rakuDoc,
				doc
			);

			assert.ok(result, 'Should return workspace edit');
			const edits = result.changes![doc.uri];

			// All edits should be unique (no overlapping ranges)
			const ranges = edits.map((edit: any) =>
				`${edit.range.start.line}:${edit.range.start.character}-${edit.range.end.line}:${edit.range.end.character}`
			);
			const uniqueRanges = new Set(ranges);

			assert.equal(ranges.length, uniqueRanges.size, 'All edit ranges should be unique (no overlaps)');
		});

		it('returns null for invalid new name', async () => {
			const content = 'sub foo() { }';
			const doc = mkDoc(content);
			const rakuDoc = mkRakuDoc(doc.uri);

			const elem = {
				name: 'foo',
				type: types.RakuSymbolKind.LocalSub,
				line: 0,
				lineEnd: 0,
				source: types.ElemSource.symbolTable,
				uri: doc.uri,
				package: 'MAIN'
			};
			rakuDoc.elems.set('foo', [elem]);

			// Try to rename to something with invalid characters
			const result = await references.executeRename(
				{ line: 0, character: 5 },
				'123-invalid',  // Can't start with number
				rakuDoc,
				doc
			);

			assert.equal(result, null, 'Should reject invalid identifier');
		});

		it('handles array variables with @ sigil', async () => {
			const content = 'my @items = (1, 2, 3);\nfor @items -> $item { }';
			const doc = mkDoc(content);
			const rakuDoc = mkRakuDoc(doc.uri);

			const elem = {
				name: '@items',
				type: types.RakuSymbolKind.LocalVar,
				line: 0,
				lineEnd: 0,
				source: types.ElemSource.symbolTable,
				uri: doc.uri,
				package: 'MAIN'
			};
			rakuDoc.elems.set('@items', [elem]);

			const result = await references.executeRename(
				{ line: 0, character: 4 },
				'values',
				rakuDoc,
				doc
			);

			assert.ok(result, 'Should return workspace edit');
			const edits = result.changes![doc.uri];

			edits.forEach((edit: any) => {
				assert.equal(edit.newText, '@values', 'Should preserve @ sigil');
			});
		});

		it('handles hash variables with % sigil', async () => {
			const content = 'my %config = (a => 1);\nmy $x = %config<a>;';
			const doc = mkDoc(content);
			const rakuDoc = mkRakuDoc(doc.uri);

			const elem = {
				name: '%config',
				type: types.RakuSymbolKind.LocalVar,
				line: 0,
				lineEnd: 0,
				source: types.ElemSource.symbolTable,
				uri: doc.uri,
				package: 'MAIN'
			};
			rakuDoc.elems.set('%config', [elem]);

			const result = await references.executeRename(
				{ line: 0, character: 4 },
				'settings',
				rakuDoc,
				doc
			);

			assert.ok(result, 'Should return workspace edit');
			const edits = result.changes![doc.uri];

			edits.forEach((edit: any) => {
				assert.equal(edit.newText, '%settings', 'Should preserve % sigil');
			});
		});

		it('skips renaming in string literals', async () => {
			const content = 'sub foo() { }\nmy $msg = "call foo here";\nfoo();';
			const doc = mkDoc(content);
			const rakuDoc = mkRakuDoc(doc.uri);

			const elem = {
				name: 'foo',
				type: types.RakuSymbolKind.LocalSub,
				line: 0,
				lineEnd: 0,
				source: types.ElemSource.symbolTable,
				uri: doc.uri,
				package: 'MAIN'
			};
			rakuDoc.elems.set('foo', [elem]);

			const result = await references.executeRename(
				{ line: 0, character: 5 },
				'bar',
				rakuDoc,
				doc
			);

			assert.ok(result, 'Should return workspace edit');
			const edits = result.changes![doc.uri];

			// Should only rename the declaration and the call, NOT the one in the string
			assert.equal(edits.length, 2, 'Should find 2 references (not the one in string)');

			// Verify none of the edits are on line 1 (the string line)
			edits.forEach((edit: any) => {
				assert.notEqual(edit.range.start.line, 1, 'Should not edit inside string on line 1');
			});
		});

		it('skips renaming in comments', async () => {
			const content = 'sub foo() { }\n# TODO: refactor foo later\nfoo();';
			const doc = mkDoc(content);
			const rakuDoc = mkRakuDoc(doc.uri);

			const elem = {
				name: 'foo',
				type: types.RakuSymbolKind.LocalSub,
				line: 0,
				lineEnd: 0,
				source: types.ElemSource.symbolTable,
				uri: doc.uri,
				package: 'MAIN'
			};
			rakuDoc.elems.set('foo', [elem]);

			const result = await references.executeRename(
				{ line: 0, character: 5 },
				'bar',
				rakuDoc,
				doc
			);

			assert.ok(result, 'Should return workspace edit');
			const edits = result.changes![doc.uri];

			// Should only rename the declaration and the call, NOT the one in the comment
			assert.equal(edits.length, 2, 'Should find 2 references (not the one in comment)');

			// Verify comment line is not edited
			edits.forEach((edit: any) => {
				assert.notEqual(edit.range.start.line, 1, 'Should not edit inside comment on line 1');
			});
		});

		it('skips renaming in regex patterns', async () => {
			const content = 'sub foo() { }\nmy $regex = /foo/;\nfoo();';
			const doc = mkDoc(content);
			const rakuDoc = mkRakuDoc(doc.uri);

			const elem = {
				name: 'foo',
				type: types.RakuSymbolKind.LocalSub,
				line: 0,
				lineEnd: 0,
				source: types.ElemSource.symbolTable,
				uri: doc.uri,
				package: 'MAIN'
			};
			rakuDoc.elems.set('foo', [elem]);

			const result = await references.executeRename(
				{ line: 0, character: 5 },
				'bar',
				rakuDoc,
				doc
			);

			assert.ok(result, 'Should return workspace edit');
			const edits = result.changes![doc.uri];

			// Should only rename the declaration and the call, NOT the one in the regex
			assert.equal(edits.length, 2, 'Should find 2 references (not the one in regex)');

			// Verify regex line is not edited (except for the actual foo() call)
			const regexLineEdits = edits.filter((edit: any) => edit.range.start.line === 1);
			assert.equal(regexLineEdits.length, 0, 'Should not edit inside regex on line 1');
		});
	});
});
