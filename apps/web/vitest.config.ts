import path from 'node:path';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineProject } from 'vitest/config';

// Web app testing strategy:
// - Component tests: Use happy-dom environment (default)
// - Database integration tests: Use node environment (via @vitest-environment comment)
// - E2E tests: Use Playwright with real environment
//
// Database branches are created at workflow level in CI (not per-test-file)

export default defineProject({
  plugins: [sveltekit()],
  test: {
    name: 'web',
    globals: true,
    environment: 'happy-dom', // Using happy-dom instead of jsdom (faster, better ESM support)
    include: ['src/**/*.test.{js,ts}'], // Only .test.ts files, not .spec.ts (Playwright uses .spec.ts)
    server: {
      deps: {
        inline: [/@sveltejs/, /svelte/],
      },
    },
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**', // E2E tests run with Playwright
      '**/*.spec.ts', // Playwright tests
      '**/test-results/**', // Playwright test results
    ],
    setupFiles: ['../../vitest.setup.ts', './src/tests/setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    // Note: coverage is configured at root level
  },
  resolve: {
    conditions: process.env.VITEST ? ['browser'] : undefined,
    alias: {
      $lib: path.resolve(__dirname, './src/lib'),
      '@codex/database': path.resolve(__dirname, '../../packages/database/src'),
      '@codex/validation': path.resolve(
        __dirname,
        '../../packages/validation/src'
      ),
      '@codex/cloudflare-clients': path.resolve(
        __dirname,
        '../../packages/cloudflare-clients/src'
      ),
      '@codex/test-utils': path.resolve(
        __dirname,
        '../../packages/test-utils/src'
      ),
    },
  },
});
