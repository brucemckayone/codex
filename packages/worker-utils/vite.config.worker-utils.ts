import { createPackageConfig } from '../../config/vite/package.config';

export default createPackageConfig({
  packageName: 'worker-utils',
  additionalExternals: ['hono', 'drizzle-orm', 'crypto', 'node:crypto'],
});
