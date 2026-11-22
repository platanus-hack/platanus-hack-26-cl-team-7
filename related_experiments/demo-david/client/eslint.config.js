import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    settings: { react: { version: 'detect' } },
    rules: {
      'no-unused-expressions': 'error',
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      // Classic hooks rules. The React Compiler rules bundled in the plugin's
      // recommended preset are not enabled.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // Components are plain JavaScript without PropTypes or TypeScript, so this
      // rule has nothing to check.
      'react/prop-types': 'off',
    },
  },
  {
    files: ['src/**/*.test.{js,jsx}', 'src/__tests__/**/*.{js,jsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.vitest } },
  },
  {
    files: ['*.config.js'],
    languageOptions: { globals: globals.node },
  },
];
