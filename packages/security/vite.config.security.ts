import { createPackageConfig } from '../../config/vite/package.config';

export default createPackageConfig({
  packageName: 'security',
  additionalExternals: ['hono', 'drizzle-orm'],
});
