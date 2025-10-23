import { defineProject } from 'vitest/config';
import path from 'path';

export default defineProject({
  test: {
    name: '@codex/database',
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    testTimeout: 10000,
    hookTimeout: 10000,
    // Note: coverage is configured at root level
  },
  resolve: {
    alias: {
      '@codex/database': path.resolve(__dirname, './src'),
    },
  },
});
