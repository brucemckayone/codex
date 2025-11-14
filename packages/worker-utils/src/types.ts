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
 * Standard error response format
 * Consistent error structure across all workers
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    stack?: string;
    internalMessage?: string;
  };
}

/**
 * Success response with data
 */
export interface SuccessResponse<T = unknown> {
  data: T;
  meta?: {
    timestamp?: number;
    requestId?: string;
  };
}
