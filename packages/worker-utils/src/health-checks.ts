/**
 * Health Check Utilities
 *
 * Reusable health check functions for Cloudflare Workers.
 * Eliminates code duplication across workers by providing standard health check implementations.
 */

import { testDbConnection } from '@codex/database';
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
 * @param _c - Hono context (unused but matches health check signature)
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
  _c: Context
): Promise<HealthCheckResult> {
  const isConnected = await testDbConnection();
  return {
    status: isConnected ? 'ok' : 'error',
    message: isConnected
      ? 'Database connection is healthy.'
      : 'Database connection failed.',
  };
}
