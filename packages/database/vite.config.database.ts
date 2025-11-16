import { createPackageConfig } from '../../config/vite/package.config';

export default createPackageConfig({
  packageName: 'database',
  entry: {
    index: 'src/index.ts',
    'schema/index': 'src/schema/index.ts',
  },
  additionalExternals: [
    'drizzle-orm',
    'drizzle-kit',
    'better-auth',
    'better-auth/adapters/drizzle',
  ],
});
