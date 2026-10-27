import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import { configDefaults } from 'vitest/config';
import { assertWorkerTestDatabase } from '../../config/vitest/worker-test-database';
import { SOCKET_TEST_FILES } from './vitest.sockets.config';

assertWorkerTestDatabase(import.meta.dirname);

export default defineWorkersConfig({
  // Cache buster: 1
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
    // Run by vitest.sockets.config.ts, on shared storage.
    exclude: [...configDefaults.exclude, ...SOCKET_TEST_FILES],
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
