import js from '@eslint/js';

import prettier from 'eslint-config-prettier';

import {
  baseEsLintConfig,
  cloudFlareWorkerConfig,
  nodeEsLintConfig,
  svelteKitEsLintConfig,
  vitestEsLintConfig,
} from './config/eslint/index.js';

export default [
  js.configs.recommended,
  // 1. A BASE config for all TypeScript/JavaScript files
  baseEsLintConfig,
  // 2. A specific config for NODE.JS environment files
  nodeEsLintConfig,
  // 3. A specific config for CLOUDFLARE WORKER files
  cloudFlareWorkerConfig,
  // 4. SVELTE config (from original)
  svelteKitEsLintConfig,
  // 5. VITEST config (from original, with additions)
  vitestEsLintConfig,
  // 6. Prettier and ignores (from original)
  prettier,
  {
    ignores: [
      'node_modules',
      '**/node_modules',
      'dist',
      '**/dist',
      '.svelte-kit',
      '**/.svelte-kit',
      'build',
      '**/build',
      'coverage',
      '**/coverage',
      'playwright-report',
      'test-results',
      '.wrangler',
      '**/.wrangler',
      '**/*.d.ts',
    ],
  },
];
