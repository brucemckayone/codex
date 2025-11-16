import { createPackageConfig } from '../../config/vite/package.config';

export default createPackageConfig({
  packageName: 'test-utils',
  additionalExternals: [
    // Node.js built-ins used in test utilities
    'crypto',
    'node:crypto',
    'timers',
    'node:timers',
  ],
});
