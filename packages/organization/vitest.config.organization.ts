import { packageVitestConfig } from '../../config/vitest/package.config';

// Environment variables are loaded by root vitest.setup.ts
// Neon Testing plugin will provision ephemeral branches for each test file

export default packageVitestConfig({
  packageName: 'organization',
  setupFiles: ['../../vitest.setup.ts'],
  testTimeout: 60000,
  hookTimeout: 60000,
  enableNeonTesting: true, // Enable ephemeral Neon branches for test isolation
  sequentialTests: true, // Required: tests share same DB and create orgs with similar timestamps
});
