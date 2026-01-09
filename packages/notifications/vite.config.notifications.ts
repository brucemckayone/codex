import { createPackageConfig } from '../../config/vite/package.config';

export default createPackageConfig({
  packageName: 'notifications',
  additionalExternals: ['drizzle-orm', 'resend'],
});
