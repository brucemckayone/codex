import { packageVitestConfig } from '../../config/vitest/package.config';

// Environment variables are loaded by root vitest.setup.ts
export default packageVitestConfig({
  packageName: 'content',
  setupFiles: ['../../vitest.setup.ts'],
  sequentialTests: true, // Run tests sequentially to avoid database conflicts
});
