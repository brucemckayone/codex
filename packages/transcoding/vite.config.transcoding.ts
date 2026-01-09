import { createPackageConfig } from '../../config/vite/package.config';

export default createPackageConfig({
  packageName: 'transcoding',
  additionalExternals: ['drizzle-orm'],
});
