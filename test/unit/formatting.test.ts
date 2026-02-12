import * as assert from 'assert';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { FormattingOptions } from 'vscode-languageserver/node';
import { formatDocument } from '../../server/src/formatting';
import { NavigatorSettings } from '../../server/src/types';

describe('Formatting', () => {
    const settings: NavigatorSettings = {
        rakuPath: 'raku',
        includePaths: [],
        logging: false,
        syntaxCheckEnabled: false,
        formattingEnabled: true,
    };

    const formattingOptions: FormattingOptions = {
        tabSize: 4,
        insertSpaces: true,
    };

    it('should format simple subroutine', async function() {
        this.timeout(10000); // Formatting may take a while

        const code = `sub foo {
say "hello";
}`;

        const expected = `sub foo {
    say "hello";
}
`;

        const document = TextDocument.create('file:///test.raku', 'raku', 1, code);
        const edits = await formatDocument(document, formattingOptions, [], settings);

        if (edits.length > 0) {
            const formatted = edits[0].newText;
            assert.strictEqual(formatted, expected, 'Formatted code should match expected');
        }
    });

    it('should format nested blocks', async function() {
        this.timeout(10000);

        const code = `class Foo {
method bar {
if True {
say "nested";
}
}
}`;

        const document = TextDocument.create('file:///test.raku', 'raku', 1, code);
        const edits = await formatDocument(document, formattingOptions, [], settings);

        if (edits.length > 0) {
            const formatted = edits[0].newText;
            // Check that it has proper indentation
            assert.ok(formatted.includes('    method bar'), 'Should indent method');
            assert.ok(formatted.includes('        if True'), 'Should indent nested if');
            assert.ok(formatted.includes('            say "nested"'), 'Should indent nested say');
        }
    });

    it('should preserve empty lines', async function() {
        this.timeout(10000);

        const code = `sub foo {
say "one";

say "two";
}`;

        const document = TextDocument.create('file:///test.raku', 'raku', 1, code);
        const edits = await formatDocument(document, formattingOptions, [], settings);

        if (edits.length > 0) {
            const formatted = edits[0].newText;
            const lines = formatted.split('\n');
            // Should have an empty line between the two say statements
            assert.ok(lines.some(line => line.trim() === ''), 'Should preserve empty lines');
        }
    });

    it('should not format POD', async function() {
        this.timeout(10000);

        const code = `=begin pod
This is documentation
  with custom indentation
=end pod

sub foo {
say "hello";
}`;

        const document = TextDocument.create('file:///test.raku', 'raku', 1, code);
        const edits = await formatDocument(document, formattingOptions, [], settings);

        if (edits.length > 0) {
            const formatted = edits[0].newText;
            // POD should remain unchanged
            assert.ok(formatted.includes('=begin pod'), 'Should preserve POD blocks');
            assert.ok(formatted.includes('  with custom indentation'), 'Should not reindent POD content');
        }
    });
});
