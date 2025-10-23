import { defineProject } from 'vitest/config';
import path from 'path';

export default defineProject({
  test: {
    name: 'queue-consumer',
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{js,ts}', 'src/**/*.{test,spec}.{js,ts}'],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@codex/database': path.resolve(__dirname, '../../packages/database/src'),
      '@codex/validation': path.resolve(__dirname, '../../packages/validation/src'),
    },
  },
});
