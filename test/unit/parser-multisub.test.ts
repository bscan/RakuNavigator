import { strict as assert } from 'assert';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseDocument } from '../../server/src/parser';
import { ParseType, RakuSymbolKind } from '../../server/src/types';

describe('parser: multi sub with hyphen and multiline signature', () => {
  it('detects "multi sub openai-request" as a LocalSub', async () => {
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
      ''
    ].join('\n');

    const uri = 'file:///test/WWW/OpenAI/Request.rakumod';
    const doc = TextDocument.create(uri, 'raku', 1, code);
    const rakuDoc = await parseDocument(doc, ParseType.workspaceIndex);

    const elems = rakuDoc.elems.get('openai-request');
    assert.ok(elems, 'expected to find element for openai-request');
    assert.ok(elems!.some(e => e.type === RakuSymbolKind.LocalSub), 'expected a LocalSub entry');
  });
});
