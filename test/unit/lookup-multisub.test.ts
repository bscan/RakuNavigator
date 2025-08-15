import { strict as assert } from 'assert';
import { TextDocument } from 'vscode-languageserver-textdocument';
import URI from 'vscode-uri';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const utils = require('../../server/out/utils');
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

describe('lookupSymbol returns all subs for multi', () => {
  it('returns multiple elements for same sub name', () => {
    const uri = URI.file('/tmp/a.raku').toString();
    const rdoc = mkRakuDoc(uri);
    const a = { name: 'openai-request', type: types.RakuSymbolKind.LocalSub, line: 5, lineEnd: 10, source: types.ElemSource.parser, uri, package: 'MAIN' };
    const b = { name: 'openai-request', type: types.RakuSymbolKind.LocalSub, line: 20, lineEnd: 25, source: types.ElemSource.parser, uri, package: 'MAIN' };
    rdoc.elems.set('openai-request', [a, b]);

    const res = utils.lookupSymbol(rdoc, new Map(), 'openai-request', 30);
    assert.equal(res.length, 2);
    assert.ok(res.some((e: any) => e.line === 5));
    assert.ok(res.some((e: any) => e.line === 20));
  });
});
