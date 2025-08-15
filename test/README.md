# Tests

This folder contains VS Code integration tests for the Raku Navigator extension using Mocha and @vscode/test-electron.

- `runTest.ts` boots VS Code with the extension and runs tests from `suite/`.
- `suite/extension.test.ts` contains basic LSP feature checks.

Run:

```
npm test
```
