import { strict as assert } from 'assert';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseDocument } from '../../server/src/parser';
import { ParseType, RakuSymbolKind } from '../../server/src/types';

describe('parser: package scope boundaries', () => {
  it('does not leak class package scope to top-level sub (no-space brace)', async () => {
    const code = [
      'class FooNoSpace{',
      '    has $.x;',
      '}',
      '',
      'sub bar-no-space{',
      '    return 1;',
      '}',
      ''
    ].join('\n');

    const uri = 'file:///test/FooNoSpace.raku';
    const doc = TextDocument.create(uri, 'raku', 1, code);
    const rakuDoc = await parseDocument(doc, ParseType.workspaceIndex);

    const classElems = rakuDoc.elems.get('FooNoSpace') || [];
    assert.ok(classElems.some(e => e.type === RakuSymbolKind.Class), 'expected class element');
    const classElem = classElems.find(e => e.type === RakuSymbolKind.Class);
    assert.ok(classElem, 'expected Class element for FooNoSpace');
    assert.equal(classElem!.package, '', 'expected class to be top-level');

    const subElems = rakuDoc.elems.get('bar-no-space') || [];
    assert.ok(subElems.some(e => e.type === RakuSymbolKind.LocalSub), 'expected sub element');

    const topLevelSub = subElems.find(e => e.type === RakuSymbolKind.LocalSub);
    assert.ok(topLevelSub, 'expected LocalSub element for bar-no-space');
    assert.equal(topLevelSub!.package, '', 'expected top-level sub to have no package scope');
  });
});
