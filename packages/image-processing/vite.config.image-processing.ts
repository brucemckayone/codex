import { createPackageConfig } from '../../config/vite/package.config';

export default createPackageConfig({
  packageName: 'image-processing',
  additionalExternals: ['drizzle-orm'],
});
