import { packageVitestConfig } from '../../config/vitest/package.config';

export default packageVitestConfig({
  packageName: 'security',
  include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  aliases: {
    '@': './src',
  },
});
