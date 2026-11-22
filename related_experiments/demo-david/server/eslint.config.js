const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: { 'no-unused-expressions': 'error' },
  },
  {
    files: ['__tests__/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
];
