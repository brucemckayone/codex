import { packageVitestConfig } from '../../config/vitest/package.config';

export default packageVitestConfig({
  packageName: 'worker-utils',
  setupFiles: ['../../vitest.setup.ts'],
  aliases: {
    '@codex/database': '../database/src',
    '@codex/security': '../security/src',
    '@codex/service-errors': '../service-errors/src',
    '@codex/shared-types': '../shared-types/src',
    '@codex/observability': '../observability/src',
  },
});
