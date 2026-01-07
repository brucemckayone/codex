import { packageVitestConfig } from '../../config/vitest/package.config';

export default packageVitestConfig({
  packageName: 'notifications',
  setupFiles: ['../../vitest.setup.ts'],
});
