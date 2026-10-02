/**
 * Legacy (.eslintrc) config is used intentionally: it keeps ESLint pinned to the v8
 * line, whose TypeScript integration is stable and well understood. When the project
 * later moves to ESLint v9 flat config, this file becomes eslint.config.js.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    // Keep this last so Prettier's formatting rules win over any stylistic ESLint rules.
    'prettier',
  ],
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: ['dist/', 'node_modules/', 'prisma/'],
  rules: {
    // Allow intentionally-unused args when prefixed with _ (e.g. Express `next`).
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
};
