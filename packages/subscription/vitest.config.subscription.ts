import { packageVitestConfig } from '../../config/vitest/package.config';

// Environment variables are loaded by root vitest.setup.ts
// Neon branches are provisioned at workflow level for test isolation

export default packageVitestConfig({
  packageName: 'subscription',
  setupFiles: ['../../vitest.setup.ts'],
  testTimeout: 60000,
  hookTimeout: 60000,
  sequentialTests: true, // Subscription tests share DB; tier sortOrder has unique constraints
});
