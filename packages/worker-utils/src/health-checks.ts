/**
 * Health Check Utilities
 *
 * Reusable health check functions for Cloudflare Workers.
 * Eliminates code duplication across workers by providing standard health check implementations.
 */

import { type DbEnvVars, testDbConnection } from '@codex/database';
import type { Context } from 'hono';

/**
 * Health check result returned by check functions
 */
export interface HealthCheckResult {
  status: 'ok' | 'error';
  message?: string;
}

/**
 * Standard database health check
 *
 * Tests database connectivity using @codex/database testDbConnection utility.
 * Returns consistent success/error messages used across all workers.
 *
 * Now properly passes environment variables from Cloudflare Worker context (c.env)
 * to the database connection test, enabling DB_METHOD configuration in Workers.
 *
 * @param c - Hono context (provides c.env with DB_METHOD, DATABASE_URL, etc.)
 * @returns Health check result with status and descriptive message
 *
 * @example
 * ```typescript
 * const app = createWorker({
 *   serviceName: 'content-api',
 *   healthCheck: {
 *     checkDatabase: standardDatabaseCheck,
 *     checkKV: createKvCheck(['RATE_LIMIT_KV']),
 *   },
 * });
 * ```
 */
export async function standardDatabaseCheck(
  c: Context
): Promise<HealthCheckResult> {
  // Extract DB environment variables from Cloudflare Worker context
  // This allows the database package to read DB_METHOD from c.env instead of process.env
  const dbEnv: DbEnvVars = {
    DB_METHOD: c.env.DB_METHOD,
    DATABASE_URL: c.env.DATABASE_URL,
    DATABASE_URL_LOCAL_PROXY: c.env.DATABASE_URL_LOCAL_PROXY,
    NODE_ENV: c.env.NODE_ENV || c.env.ENVIRONMENT,
  };

  const isConnected = await testDbConnection(dbEnv);
  return {
    status: isConnected ? 'ok' : 'error',
    message: isConnected
      ? 'Database connection is healthy.'
      : 'Database connection failed.',
  };
}
