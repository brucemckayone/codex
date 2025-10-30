import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { resolve } from 'path';
import { DbEnvConfig } from './env.config';

// Load env.dev from project root (2 levels up from packages/database)

// check against a random env variable, which is defined in CI only load env.dev if no env vars defined
if (!DbEnvConfig.method)
  config({ path: resolve(__dirname, '../../../../.env.dev') });

export default defineConfig({
  out: DbEnvConfig.out,
  schema: DbEnvConfig.schema,
  dialect: DbEnvConfig.dialetc!,
  dbCredentials: {
    url: DbEnvConfig.getDbUrl()!,
  },
  verbose: true,
  strict: true,
});
