import { createPackageConfig } from '../../config/vite/package.config';

export default createPackageConfig({
  packageName: 'content',
  additionalExternals: ['drizzle-orm'],
});
