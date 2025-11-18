import { packageVitestConfig } from '../../config/vitest/package.config';

// Service errors don't require database connections
// These are pure unit tests of error classes

export default packageVitestConfig({
  packageName: 'service-errors',
  setupFiles: [],
  testTimeout: 10000,
  hookTimeout: 10000,
  enableNeonTesting: false, // No database needed for error class tests
});
