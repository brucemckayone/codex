import { createPackageConfig } from '../../config/vite/package.config';

export default createPackageConfig({
  packageName: 'purchase',
  additionalExternals: ['stripe', 'drizzle-orm'],
});
