import { packageVitestConfig } from '../../config/vitest/package.config';

// Environment variables are loaded by root vitest.setup.ts
// No need to load dotenv here

export default packageVitestConfig({
  packageName: 'identity',
  setupFiles: ['../../vitest.setup.ts'],
  testTimeout: 60000,
  hookTimeout: 60000,
  sequentialTests: true, // Run tests sequentially to avoid database conflicts
});
