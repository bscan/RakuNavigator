import { strict as assert } from 'assert';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { formatDocument, formatRange } from '../../server/src/formatting';
import { NavigatorSettings } from '../../server/src/types';

// Import types from server's node_modules via relative path
type Range = import('../../server/node_modules/vscode-languageserver-types').Range;
type FormattingOptions = import('../../server/node_modules/vscode-languageserver-types').FormattingOptions;

function makeDoc(text: string) {
  return TextDocument.create('file:///test/app.raku', 'raku', 1, text);
}

const defaultOptions: FormattingOptions = {
  tabSize: 4,
  insertSpaces: true,
};

const defaultSettings: NavigatorSettings = {
  rakuPath: '/usr/bin/raku',
  includePaths: [],
  logging: false,
  syntaxCheckEnabled: false,
  formatting: {
    enable: true,
    indentSize: 4,
    trimTrailingWhitespace: true,
    insertFinalNewline: true,
    spaceAfterComma: true,
    noSpaceBeforeSemicolon: true,
    spaceAfterKeywords: true,
    spaceBeforeBrace: true,
    braceOnSameLine: true,
    cuddledElse: true,
  },
};

describe('formatting', () => {
  describe('range formatting - brace on same line', () => {
    it('moves brace up when both declaration and brace are in range', async () => {
      const code = [
        'sub test()',
        '{',
        '    say "hello";',
        '}',
      ].join('\n');
      
      const doc = makeDoc(code);
      // Select lines 0-1 (declaration and opening brace)
      const range: Range = {
        start: { line: 0, character: 0 },
        end: { line: 1, character: 1 }
      };
      
      const edits = await formatRange(doc, range, defaultOptions, defaultSettings);
      
      // Should merge the brace onto line 0
      const hasEdit = edits.some(edit => 
        edit.range.start.line === 0 && 
        edit.newText.includes('sub test() {')
      );
      
      assert.ok(hasEdit, 'expected brace to move up to same line');
    });

    it('does NOT move brace when declaration is outside range', async () => {
      const code = [
        'sub test()',
        '{',
        '    say "hello";',
        '}',
      ].join('\n');
      
      const doc = makeDoc(code);
      // Select only line 1 (the opening brace line)
      const range: Range = {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 1 }
      };
      
      const edits = await formatRange(doc, range, defaultOptions, defaultSettings);
      
      // Should NOT delete line 1 (brace stays on its own line)
      const hasLineDelete = edits.some(edit => 
        edit.range.start.line === 1 &&
        edit.range.end.line === 2
      );
      
      assert.ok(!hasLineDelete, 'expected brace to stay on separate line when declaration outside range');
    });

    it('does NOT move brace when brace line is outside range', async () => {
      const code = [
        'sub test()',
        '{',
        '    say "hello";',
        '}',
      ].join('\n');
      
      const doc = makeDoc(code);
      // Select only line 0 (the declaration)
      const range: Range = {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 11 }
      };
      
      const edits = await formatRange(doc, range, defaultOptions, defaultSettings);
      
      // Should NOT modify line 0 to include brace
      const hasMerge = edits.some(edit => 
        edit.range.start.line === 0 && 
        edit.newText.includes('{')
      );
      
      assert.ok(!hasMerge, 'expected brace to stay on separate line when brace outside range');
    });
  });

  describe('range formatting - cuddled else', () => {
    it('cuddles else when both closing brace and else are in range', async () => {
      const code = [
        'if $x > 0 {',
        '    say "yes";',
        '}',
        'else {',
        '    say "no";',
        '}',
      ].join('\n');
      
      const doc = makeDoc(code);
      // Select lines 2-3 (closing brace and else)
      const range: Range = {
        start: { line: 2, character: 0 },
        end: { line: 3, character: 7 }
      };
      
      const edits = await formatRange(doc, range, defaultOptions, defaultSettings);
      
      // Should merge else onto line 2
      const hasEdit = edits.some(edit => 
        edit.range.start.line === 2 && 
        edit.newText.includes('} else {')
      );
      
      assert.ok(hasEdit, 'expected else to cuddle onto closing brace line');
    });

    it('does NOT cuddle else when closing brace is outside range', async () => {
      const code = [
        'if $x > 0 {',
        '    say "yes";',
        '}',
        'else {',
        '    say "no";',
        '}',
      ].join('\n');
      
      const doc = makeDoc(code);
      // Select only line 3 (the else line)
      const range: Range = {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 7 }
      };
      
      const edits = await formatRange(doc, range, defaultOptions, defaultSettings);
      
      // Should NOT delete line 3
      const hasLineDelete = edits.some(edit => 
        edit.range.start.line === 3 &&
        edit.range.end.line === 4
      );
      
      assert.ok(!hasLineDelete, 'expected else to stay on separate line when closing brace outside range');
    });

    it('does NOT cuddle else when else line is outside range', async () => {
      const code = [
        'if $x > 0 {',
        '    say "yes";',
        '}',
        'else {',
        '    say "no";',
        '}',
      ].join('\n');
      
      const doc = makeDoc(code);
      // Select only line 2 (the closing brace)
      const range: Range = {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 1 }
      };
      
      const edits = await formatRange(doc, range, defaultOptions, defaultSettings);
      
      // Should NOT modify line 2 to include else
      const hasMerge = edits.some(edit => 
        edit.range.start.line === 2 && 
        edit.newText.includes('else')
      );
      
      assert.ok(!hasMerge, 'expected else to stay on separate line when else outside range');
    });
  });

  describe('document formatting - applies all rules', () => {
    it('moves brace up for full document formatting', async () => {
      const code = [
        'sub test()',
        '{',
        '    say "hello";',
        '}',
      ].join('\n');
      
      const doc = makeDoc(code);
      const edits = await formatDocument(doc, defaultOptions, defaultSettings);
      
      // Should merge the brace onto line 0
      const hasEdit = edits.some(edit => 
        edit.range.start.line === 0 && 
        edit.newText.includes('sub test() {')
      );
      
      assert.ok(hasEdit, 'expected brace to move up for document formatting');
    });

    it('cuddles else for full document formatting', async () => {
      const code = [
        'if $x > 0 {',
        '    say "yes";',
        '}',
        'else {',
        '    say "no";',
        '}',
      ].join('\n');
      
      const doc = makeDoc(code);
      const edits = await formatDocument(doc, defaultOptions, defaultSettings);
      
      // Should merge else onto line 2
      const hasEdit = edits.some(edit => 
        edit.range.start.line === 2 && 
        edit.newText.includes('} else {')
      );
      
      assert.ok(hasEdit, 'expected else to cuddle for document formatting');
    });

    it('fixes indentation', async () => {
      const code = [
        'sub test {',
        'my $x = 1;',
        'if $x > 0 {',
        'say "yes";',
        '}',
        '}',
      ].join('\n');
      
      const doc = makeDoc(code);
      const edits = await formatDocument(doc, defaultOptions, defaultSettings);
      
      // Should indent lines properly
      const hasIndentFix = edits.some(edit => 
        edit.range.start.line === 1 &&
        edit.newText.startsWith('    my $x')
      );
      
      assert.ok(hasIndentFix, 'expected indentation to be fixed');
    });

    it('adds space after comma', async () => {
      const code = ['my ($a,$b,$c) = (1,2,3);'].join('\n');
      
      const doc = makeDoc(code);
      const edits = await formatDocument(doc, defaultOptions, defaultSettings);
      
      // Should add spaces after commas
      const hasSpaceFix = edits.some(edit => 
        edit.newText.includes('$a, $b') || edit.newText.includes('1, 2')
      );
      
      assert.ok(hasSpaceFix, 'expected spaces after commas');
    });

    it('removes space before semicolon', async () => {
      const code = ['my $x = 5 ;'].join('\n');
      
      const doc = makeDoc(code);
      const edits = await formatDocument(doc, defaultOptions, defaultSettings);
      
      // Should remove space before semicolon
      const hasSpaceFix = edits.some(edit => 
        edit.newText.includes('5;')
      );
      
      assert.ok(hasSpaceFix, 'expected space removed before semicolon');
    });

    it('preserves method chain indentation', async () => {
      const code = [
        'sub test {',
        '    my @result = (1, 2, 3)',
        '        .grep(* > 2)',
        '        .map(* * 2);',
        '}',
      ].join('\n');
      
      const doc = makeDoc(code);
      const edits = await formatDocument(doc, defaultOptions, defaultSettings);
      
      // Should NOT change indentation of lines starting with .
      const hasIndentChange = edits.some(edit => 
        (edit.range.start.line === 2 || edit.range.start.line === 3) &&
        edit.newText.trim().startsWith('.')
      );
      
      assert.ok(!hasIndentChange, 'expected method continuation lines to preserve indentation');
    });
  });
});
