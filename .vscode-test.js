const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig([
	{
		label: 'unitTests',
		files: 'out/test/**/*.test.js',
		version: 'stable',
		workspaceFolder: '.',
		mocha: {
			ui: 'tdd',
			timeout: 20000
		}
	}
]);
