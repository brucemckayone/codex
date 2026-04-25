import { packageVitestConfig } from '../../config/vitest/package.config';

// Environment variables are loaded by root vitest.setup.ts
// Neon Testing plugin will provision ephemeral branches for each test file
export default packageVitestConfig({
  packageName: 'purchase',
  setupFiles: ['../../vitest.setup.ts'],
  testTimeout: 60000,
  hookTimeout: 60000,
  enableNeonTesting: true, // Enable ephemeral Neon branches for test isolation
  // Multiple integration test files share a single Neon DB locally and
  // pre-existing fixture-cleanup helpers (e.g. cleanupDatabase in
  // resolve-customer afterAll) race with content/media writes in
  // purchase-service.test.ts when files run in parallel. Forcing serial
  // execution serialises the cleanup boundaries; in-isolation each file
  // still passes 100%, this only affects cross-file ordering. Removing
  // this flag should be paired with proper per-file branch isolation
  // (the deprecated enableNeonTesting plugin path).
  sequentialTests: true,
});
