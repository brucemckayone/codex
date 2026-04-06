import { createPackageConfig } from '../../config/vite/package.config';

export default createPackageConfig({
  packageName: 'subscription',
  additionalExternals: ['stripe', 'drizzle-orm'],
});
