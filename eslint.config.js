import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'data/**',
      'prisma/migrations/**',
      '.claude/**',
      'eslint.config.js',
      'vitest.config.ts',
      // web/ has its own toolchain (Vite + Tailwind + tsx); root eslint
      // doesn't have the right parser config for .tsx and chokes on built
      // assets in web/dist. Lint there separately if needed.
      'web/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['commitlint.config.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.es2023,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      // TypeScript already verifies undefined identifiers; the lint rule
      // mis-fires on ambient namespace types like NodeJS.ErrnoException.
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
];
