import { resolve } from 'node:path';
import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { DbEnvConfig } from './env.config';

/**
 * Drizzle Kit Configuration
 *
 * This config is used for CLI commands (drizzle-kit generate, push, studio).
 * Environment variables are loaded conditionally:
 *
 * - If DB_METHOD is already set (CI/CD, shell): Use existing env vars
 * - If DB_METHOD is not set (local dev): Load from .env.dev
 */
if (!DbEnvConfig.method) {
  config({ path: resolve(__dirname, '../../../../.env.dev') });
}

export default defineConfig({
  out: DbEnvConfig.out,
  schema: DbEnvConfig.schema,
  dialect: DbEnvConfig.dialect,
  dbCredentials: {
    url: DbEnvConfig.getDbUrl(),
  },
  verbose: true,
  strict: true,
});
