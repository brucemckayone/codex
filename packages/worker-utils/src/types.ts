/**
 * Shared types for Cloudflare Workers
 *
 * Common response types and interfaces used across all workers.
 */

/**
 * Standard health check response format
 * Used by all workers to report their health status
 */
export interface HealthCheckResponse {
  status: 'ok' | 'healthy' | 'degraded' | 'unhealthy';
  service: string;
  version: string;
  timestamp: number;
  uptime?: number;
  checks?: Record<string, boolean>;
}

/**
 * Standard error response format — re-exported from @codex/shared-types (canonical source)
 */
export type { ErrorResponse } from '@codex/shared-types';
