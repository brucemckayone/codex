import { createPackageConfig } from '../../config/vite/package.config';

export default createPackageConfig({
  packageName: 'organization',
  additionalExternals: ['drizzle-orm'],
});
