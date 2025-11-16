import { packageVitestConfig } from '../../config/vitest/package.config';

export default packageVitestConfig({
  packageName: 'test-utils',
  aliases: {
    '@codex/database': '../database/src',
  },
});
