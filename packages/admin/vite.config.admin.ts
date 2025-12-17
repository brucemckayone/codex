import { createPackageConfig } from '../../config/vite/package.config';

export default createPackageConfig({
  packageName: 'admin',
  additionalExternals: ['drizzle-orm'],
});
