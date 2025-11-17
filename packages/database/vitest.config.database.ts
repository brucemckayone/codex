import { packageVitestConfig } from '../../config/vitest/package.config';

// Environment variables are loaded by root vitest.setup.ts
export default packageVitestConfig({
  packageName: 'database',
  setupFiles: ['../../vitest.setup.ts'],
  testTimeout: 60000,
  hookTimeout: 60000,
  enableNeonTesting: true, // Enable ephemeral Neon branches in CI
  sequentialTests: true, // Run tests sequentially to avoid database conflicts
});
