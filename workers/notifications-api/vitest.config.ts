import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        // Run all test files in a single workerd instance to keep localhost
        // ephemeral-port pressure low on local runs (the pool otherwise spawns
        // one workerd per file).
        singleWorker: true,
        wrangler: { configPath: './wrangler.jsonc', environment: 'test' },
        miniflare: {
          compatibilityDate: '2025-01-01',
          compatibilityFlags: ['nodejs_compat'],
        },
      },
    },
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    },
  },
});
