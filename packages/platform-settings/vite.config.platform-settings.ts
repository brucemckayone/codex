import { createPackageConfig } from '../../config/vite/package.config';

export default createPackageConfig({
  packageName: 'platform-settings',
  additionalExternals: ['drizzle-orm'],
});
