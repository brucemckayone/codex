import { defineProject } from 'vitest/config';
import path from 'path';

export default defineProject({
  test: {
    name: '@codex/core-services',
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@codex/core-services': path.resolve(__dirname, './src'),
      '@codex/database': path.resolve(__dirname, '../database/src'),
      '@codex/cloudflare-clients': path.resolve(__dirname, '../cloudflare-clients/src'),
      '@codex/validation': path.resolve(__dirname, '../validation/src'),
    },
  },
});
