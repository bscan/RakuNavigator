'use strict';
const path = require('path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '..');
  const extensionTestsPath = path.resolve(__dirname, '../out/test/suite/index.js');

    await runTests({
      version: '1.52.0',
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [path.resolve(__dirname, '../testWorkspace'), '--disable-extensions'],
    });
  } catch (err) {
    console.error('Failed to run tests');
    if (err) {
      console.error(err);
    }
    process.exit(1);
  }
}

main();
