import { defineProject } from 'vitest/config';
import path from 'path';

export default defineProject({
  test: {
    name: '@codex/worker-utils',
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@codex/worker-utils': path.resolve(__dirname, './src'),
      '@codex/database': path.resolve(__dirname, '../database/src'),
      '@codex/security': path.resolve(__dirname, '../security/src'),
      '@codex/service-errors': path.resolve(__dirname, '../service-errors/src'),
      '@codex/shared-types': path.resolve(__dirname, '../shared-types/src'),
      '@codex/observability': path.resolve(__dirname, '../observability/src'),
    },
  },
});
