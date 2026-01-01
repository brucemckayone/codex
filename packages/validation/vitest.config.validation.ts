import { packageVitestConfig } from '../../config/vitest/package.config';

export default packageVitestConfig({
  packageName: 'validation',
  test: {
    setupFiles: ['./vitest.setup.ts'],
  },
});
