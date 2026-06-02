// Merges raku.regex.tmLanguage.json and raku.quoting.tmLanguage.json
// into raku.tmLanguage.json so vscode-textmate can resolve all includes
// without needing cross-grammar support.
//
// To generate raku.merged.tmLanguage.json: node ./scripts/merge-grammars.js

const fs = require('fs');
const path = require('path');

const serverDir  = path.join(__dirname, '../server');
const mainPath   = path.join(serverDir, 'raku.tmLanguage.json');
const regexPath  = path.join(serverDir, 'raku.regex.tmLanguage.json');
const quotingPath = path.join(serverDir, 'raku.quoting.tmLanguage.json');
const outputPath = path.join(serverDir, 'raku.merged.tmLanguage.json');

const main   = JSON.parse(fs.readFileSync(mainPath,   'utf8'));
const regex  = JSON.parse(fs.readFileSync(regexPath,  'utf8'));
const quoting = JSON.parse(fs.readFileSync(quotingPath, 'utf8'));

// 1. Merge repository entries from both external grammars into main
//    Skip keys that already exist in main to avoid overwriting.
function mergeRepository(source) {
    for (const [key, value] of Object.entries(source.repository || {})) {
        if (main.repository[key] !== undefined) {
            console.log(`  Skipping duplicate key: ${key}`);
        } else {
            main.repository[key] = value;
        }
    }
}

console.log('Merging source.regexp.raku ...');
mergeRepository(regex);

console.log('Merging source.quoting.raku ...');
mergeRepository(quoting);

// 2a. Add a wrapper rule for bare "source.quoting.raku" (no fragment),
//     which means "include all top-level patterns of the quoting grammar".
if (!main.repository['__quoting__']) {
    main.repository['__quoting__'] = { patterns: quoting.patterns };
}

// 2. Rewrite cross-grammar include references in the whole JSON.
//    "source.regexp.raku"          -> "#regexp"  (top-level of regex grammar is #regexp)
//    "source.quoting.raku#foo"     -> "#foo"
//    "source.quoting.raku"         -> "#__quoting__"
let text = JSON.stringify(main, null, '\t');

const before = (text.match(/"source\.(regexp|quoting)\.raku/g) || []).length;

text = text.replace(/"source\.regexp\.raku"/g, '"#regexp"');
text = text.replace(/"source\.quoting\.raku#([\w-]+)"/g, '"#$1"');
text = text.replace(/"source\.quoting\.raku"/g, '"#__quoting__"');

const after = (text.match(/"source\.(regexp|quoting)\.raku/g) || []).length;
console.log(`Replaced cross-grammar includes: ${before} found, ${after} remaining`);

if (after > 0) {
    console.warn('WARNING: Some cross-grammar includes were not rewritten. Check the output file.');
}

fs.writeFileSync(outputPath, text, 'utf8');
console.log(`Done. Written to ${outputPath}`);
