import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    globals: true,
    // Use Workers pool to run tests in workerd runtime (not Node.js)
    poolOptions: {
      workers: {
        // Run all test files in a single workerd instance to keep localhost
        // ephemeral-port pressure low on local runs (the pool otherwise spawns
        // one workerd per file, and a full worker suite blows past the macOS
        // 49152-65535 range when several workers run sequentially in the same
        // session).
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
