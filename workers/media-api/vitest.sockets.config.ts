/**
 * MediaStatusObject's socket tests (Codex-l2c48.9), on SHARED storage.
 *
 * vitest-pool-workers cannot unwind isolated storage past a Durable Object
 * that holds WebSockets ("Failed to pop isolated storage stack frame"). The
 * known-issues page's workaround is shared storage, and the other suites rely
 * on per-test isolation, so this file runs on its own config. Its tests use
 * fresh ids, so sharing one object between them changes nothing they assert.
 */
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import { assertWorkerTestDatabase } from '../../config/vitest/worker-test-database';

assertWorkerTestDatabase(import.meta.dirname);

export const SOCKET_TEST_FILES = [
  'src/__tests__/media-status-object.test.ts',
  'src/__tests__/media-status-routes.test.ts',
];

export default defineWorkersConfig({
  test: {
    globals: true,
    poolOptions: {
      workers: {
        singleWorker: true,
        isolatedStorage: false,
        wrangler: { configPath: './wrangler.jsonc', environment: 'test' },
      },
    },
    include: SOCKET_TEST_FILES,
  },
});
