/**
 * Internal constants for the database package
 */

export const NEON_CONFIG = {
  LOCAL_HOST: 'db.localtest.me',
  PROXY_PORT: 4444,
  HTTPS_PORT: 443,
} as const;

export const DRIZZLE_CONFIG = {
  OUT: './src/migrations',
  SCHEMA: './src/schema/index.ts',
} as const;

export const ROOT_ENV_PATH = '../../../../env.dev';
