import { defineProject } from 'vitest/config';
import path from 'path';

export default defineProject({
  test: {
    name: '@codex/validation',
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@codex/validation': path.resolve(__dirname, './src'),
    },
  },
});
