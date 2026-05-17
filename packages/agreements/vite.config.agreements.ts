import { createPackageConfig } from '../../config/vite/package.config';

export default createPackageConfig({
  packageName: 'agreements',
  additionalExternals: ['drizzle-orm'],
});
