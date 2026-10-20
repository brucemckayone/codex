import { packageVitestConfig } from '../../config/vitest/package.config';

// Environment variables are loaded by root vitest.setup.ts.
//
// Sequential, as @codex/purchase was before these tests moved here: they
// share one local DB, and payout rows written by one file must not be swept
// by another's cleanup.

export default packageVitestConfig({
  packageName: 'payments',
  setupFiles: ['../../vitest.setup.ts'],
  testTimeout: 60000,
  hookTimeout: 60000,
  enableNeonTesting: true,
  sequentialTests: true,
});
