import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

// One config for the whole monorepo: the browser app, the API and the tests.
// Formatting is Prettier's job (eslint-config-prettier turns off clashing rules).
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.vite/**',
      'storage/**',
      'test-results/**',
      'playwright-report/**',
      'services/**',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['apps/web/src/**/*.{js,jsx}'],
    languageOptions: { globals: { ...globals.browser, __MEDIAPIPE_VERSION__: 'readonly' } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react/jsx-uses-vars': 'error', // a component used only in JSX counts as used
      'react/jsx-key': 'error',
      'react/jsx-no-undef': 'error',
    },
  },
  {
    files: ['apps/web/src/cad/cadWorker.js'],
    languageOptions: { globals: globals.worker },
  },
  {
    files: [
      'apps/api/**/*.js',
      'apps/web/test/**/*.js',
      'apps/web/vite.config.js',
      'scripts/**/*.{js,mjs}',
      '*.config.js',
      'e2e/**/*.{js,mjs}',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // Playwright's page.evaluate bodies run in the browser.
    files: ['e2e/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  prettier,
];
