// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env.dev') });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '*.config.ts'],
    },
    resolve: {
      alias: {
        '@codex/security': resolve(
          __dirname,
          '../../packages/security/src/index.ts'
        ),
        '@codex/security/*': resolve(
          __dirname,
          '../../packages/security/src/*'
        ),
        '@codex/database': resolve(
          __dirname,
          '../../packages/database/src/index.ts'
        ),
        '@codex/database/*': resolve(
          __dirname,
          '../../packages/database/src/*'
        ),
        '@codex/observability': resolve(
          __dirname,
          '../../packages/observability/src/index.ts'
        ),
        '@codex/observability/*': resolve(
          __dirname,
          '../../packages/observability/src/*'
        ),
        '@codex/validation': resolve(
          __dirname,
          '../../packages/validation/src/index.ts'
        ),
        '@codex/validation/*': resolve(
          __dirname,
          '../../packages/validation/src/*'
        ),
      },
    },
  },
});
