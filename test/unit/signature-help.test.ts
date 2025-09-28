import { strict as assert } from 'assert';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseDocument } from '../../server/src/parser';
import { ParseType } from '../../server/src/types';
import { getSignature } from '../../server/src/signature';

function makeDoc(text: string) {
  return TextDocument.create('file:///test/app.raku', 'raku', 1, text);
}

describe('signature help', () => {
  it('provides signature for sub with multiline named params, activeParameter 0', async () => {
    const code = [
      'unit module WWW::OpenAI::Request;',
      '',
      'multi sub openai-request',
      '(',
      '  :$model!,',
      '  :$json = False,',
      ') is export {',
      '  # body',
      '}',
      '',
      'sub main() {',
      '  openai-request(',
      '}',
      ''
    ].join('\n');

    const doc = makeDoc(code);
    const rakuDoc = await parseDocument(doc, ParseType.selfNavigation);

    const openIdx = code.indexOf('openai-request(') + 'openai-request'.length + 1; // position after the (
    const pos = doc.positionAt(openIdx);

    const sig = await getSignature({ textDocument: { uri: doc.uri }, position: pos }, rakuDoc, doc);
    assert.ok(sig, 'expected signature help');
    assert.ok(sig!.signatures.length > 0, 'expected at least one signature');
    assert.equal(sig!.activeParameter, 0, 'expected active param 0 at call start');
  });

  it('increments activeParameter after comma', async () => {
    const code = [
      'sub foo($a, $b) { }',
      'foo($a, ',
      ''
    ].join('\n');

    const doc = makeDoc(code);
    const rakuDoc = await parseDocument(doc, ParseType.selfNavigation);

    const idx = code.indexOf('foo($a, ') + 'foo($a, '.length;
    const pos = doc.positionAt(idx);

    const sig = await getSignature({ textDocument: { uri: doc.uri }, position: pos }, rakuDoc, doc);
    assert.ok(sig, 'expected signature help');
    assert.equal(sig!.activeParameter, 1, 'expected active param 1 after first comma');
  });
});
