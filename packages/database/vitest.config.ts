import { defineProject } from 'vitest/config';

// Environment variables are loaded by root vitest.setup.ts
export default defineProject({
  test: {
    name: '@codex/database',
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    setupFiles: ['../../vitest.setup.ts'], // Reference root setup file
    testTimeout: 60000,
    hookTimeout: 60000,
    // Note: coverage is configured at root level
  },
});
