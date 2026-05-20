import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    globals: true,
    // Use Workers pool to run tests in workerd runtime (not Node.js)
    poolOptions: {
      workers: {
        // Run all test files in a single workerd instance to keep localhost
        // ephemeral-port pressure low on local runs (the pool otherwise spawns
        // one workerd per file).
        singleWorker: true,
        wrangler: { configPath: './wrangler.jsonc', environment: 'test' },
      },
    },
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '*.config.ts',
        '**/*.d.ts',
        '**/types/**',
      ],
    },
  },
});
