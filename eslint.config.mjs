import nodePlugin from 'eslint-plugin-n';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/', 'data/', 'eslint.config.mjs'],
  },
  {
    files: ['**/*.mjs', 'public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { n: nodePlugin },
    rules: {
      'n/no-unsupported-features/node-builtins': 'off',
      'no-unused-vars': ['error', { caughtErrors: 'all' }],
      'no-throw-literal': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
];
