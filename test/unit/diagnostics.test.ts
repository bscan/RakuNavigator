import { strict as assert } from 'assert';
import { TextDocument } from 'vscode-languageserver-textdocument';
import URI from 'vscode-uri';

// Import compiled JS from server/out; use require for runtime path while keeping TS types loose
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

describe('diagnostics.rakucompile', () => {
  let originalExec: any;
  beforeEach(() => {
    originalExec = utils.async_execFile;
  });
  afterEach(() => {
    utils.async_execFile = originalExec;
  });

  it('parses JSON stderr into error diagnostics with pos mapping', async () => {
    // Doc text where pos=5 (1-based) -> line 1, char 0
    const doc = mkDoc('abc\ndef\n');
    const settings = mkSettings();

    const jsonLine = JSON.stringify({ MAIN: { message: 'Unexpected token', pos: 5 } });
    utils.async_execFile = async () => ({ stdout: '', stderr: jsonLine });

    const res = await diagnostics.rakucompile(doc, null, settings);
    assert.ok(res, 'should get compilation results');
    assert.equal(res.error, true, 'error flag should be true when JSON stderr present');
    assert.ok(res.diags.length === 1, 'one diagnostic');

    const d = res.diags[0];
    assert.equal(d.message, 'Unexpected token');
    assert.equal(d.range.start.line, 1);
    assert.equal(d.range.start.character, 0);
  });

  it('parses unhandled warnings from stdout', async () => {
    const doc = mkDoc('line1\nline2\nline3\n');
    const settings = mkSettings();

    const out = '  Possible issue here\n  at /some/file:2\n';
    utils.async_execFile = async () => ({ stdout: out, stderr: '' });

    const res = await diagnostics.rakucompile(doc, null, settings);
    assert.ok(res, 'should get compilation results');
    assert.equal(res.error, false, 'warnings alone should not set error flag');

    assert.ok(res.diags.length === 1, 'one warning diagnostic');

    const d = res.diags[0];
    // Warning is 1-based line 2 -> 0-based line 1
    assert.equal(d.range.start.line, 1);
    assert.ok(/Warning: /i.test(d.message));
  });
});
