import { strict as assert } from 'assert';
import { TextDocument } from 'vscode-languageserver-textdocument';
import URI from 'vscode-uri';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const diagnostics = require('../../server/out/diagnostics');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const utils = require('../../server/out/utils');

type Settings = {
  rakuPath: string;
  includePaths: string[];
  logging: boolean;
  syntaxCheckEnabled: boolean;
};

function mkSettings(overrides: Partial<Settings> = {}): Settings {
  return Object.assign(
    { rakuPath: 'raku', includePaths: [], logging: false, syntaxCheckEnabled: true },
    overrides
  );
}

function mkDoc(text: string) {
  const uri = URI.file('/tmp/test.raku').toString();
  return TextDocument.create(uri, 'raku', 1, text);
}

describe('diagnostics.parseJSON nested payload', () => {
  let originalExec: any;
  beforeEach(() => {
    originalExec = utils.async_execFile;
  });
  afterEach(() => {
    utils.async_execFile = originalExec;
  });

  it('unwraps nested message/payload JSON and reports import failed with inner details', async () => {
    const doc = mkDoc('use TestLib;\nsub MAIN {}\n');
    const settings = mkSettings();

    const inner = {
      'X::Syntax::Confused': {
        pre: '        my $result = $a + $b',
        pos: 257,
        'is-compile-time': 1,
        highexpect: [
          'infix',
          'infix stopper',
          'postfix',
          'statement end',
          'statement modifier',
          'statement modifier loop',
        ],
        'directive-filename': null,
        message: 'Two terms in a row across lines (missing semicolon or comma?)',
        post: '<EOL>',
        line: 12,
        reason: 'Two terms in a row across lines (missing semicolon or comma?)',
        modules: [],
        filename: '/home/brian/repos/RakuNavigator/testWorkspace/lib/TestLib.rakumod (TestLib)',
        column: null,
      },
    };

    const outer = {
      'X::AdHoc+{X::Comp}': {
        'directive-filename': null,
        highexpect: [],
        modules: [],
        'is-compile-time': true,
        column: null,
        message: JSON.stringify(inner),
        pos: null,
        post: null,
        payload: JSON.stringify(inner),
        pre: null,
        filename: '/home/brian/repos/RakuNavigator/testWorkspace/raku-app.raku',
        line: 4,
      },
    };

    utils.async_execFile = async () => ({ stdout: '', stderr: JSON.stringify(outer) });

    const res = await diagnostics.rakucompile(doc, null, settings);
    assert.ok(res, 'should get compilation results');
    assert.equal(res.error, true);
    assert.ok(res.diags.length >= 1, 'at least one diagnostic');

    const msg = res.diags[0].message as string;
    assert.ok(/Import failed:/i.test(msg), 'should prefix with Import failed');
    assert.ok(/Two terms in a row/i.test(msg), 'should include inner message');
  });
});
