import ts from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import vitest from 'eslint-plugin-vitest';
import globals from 'globals';

export const baseEsLintConfig = {
  files: ['**/*.{js,ts}'],
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    globals: {
      console: 'readonly',
    },
  },
  plugins: {
    '@typescript-eslint': ts,
  },
  rules: {
    ...ts.configs.recommended.rules,
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-empty-object-type': 'off',
  },
};

export const nodeEsLintConfig = {
  files: [
    '*.js',
    '*.ts',
    'packages/database/**/*.ts',
    '**/*.config.ts',
    '**/*.config.js',
    '**/build.js',
  ],
  languageOptions: {
    globals: {
      ...globals.node,
      process: 'readonly',
      __dirname: 'readonly',
      setTimeout: 'readonly',
    },
  },
};

export const cloudFlareWorkerConfig = {
  files: [
    'workers/**/*.ts',
    'packages/security/**/*.ts',
    'packages/cloudflare-clients/**/*.ts',
    'packages/observability/**/*.ts',
    'packages/test-utils/**/*.ts',
    'packages/validation/**/*.ts',
    'packages/content/**/*.ts',
  ],
  languageOptions: {
    globals: {
      ...globals.browser,
      ...globals['shared-node-browser'],
      fetch: 'readonly',
      Headers: 'readonly',
      Request: 'readonly',
      Response: 'readonly',
      RequestInfo: 'readonly',
      RequestInit: 'readonly',
      crypto: 'readonly',
      TextEncoder: 'readonly',
      btoa: 'readonly',
      URL: 'readonly',
      KVNamespace: 'readonly',
      setTimeout: 'readonly', // Node global but also in Workers
    },
  },
};

export const svelteKitEsLintConfig = {
  files: ['**/*.svelte'],
  languageOptions: {
    parser: svelteParser,
    parserOptions: {
      parser: tsParser,
    },
    globals: {
      // svelte check adds some globals but we add our own
      console: 'readonly',
      process: 'readonly',
    },
  },
  plugins: {
    svelte,
  },
  rules: {
    ...svelte.configs.recommended.rules,
  },
};

export const vitestEsLintConfig = {
  files: ['**/*.{test,spec}.{js,ts}'],
  plugins: {
    vitest,
  },
  rules: {
    ...vitest.configs.recommended.rules,
  },
  languageOptions: {
    globals: {
      expect: 'readonly',
    },
  },
};
