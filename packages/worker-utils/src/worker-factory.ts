/**
 * Worker Factory
 *
 * Creates a fully configured Hono app with standard middleware.
 */

import { Hono } from 'hono';
import type { HonoEnv } from '@codex/shared-types';
import {
  createLoggerMiddleware,
  createCorsMiddleware,
  createSecurityHeadersMiddleware,
  createAuthMiddleware,
  createHealthCheckHandler,
  createNotFoundHandler,
  createErrorHandler,
  type MiddlewareConfig,
} from './middleware';

/**
 * Configuration for creating a worker
 */
export interface WorkerConfig extends MiddlewareConfig {
  /**
   * Version string for health check
   * @default '1.0.0'
   */
  version?: string;
}

/**
 * Creates a fully configured Hono app with standard middleware
 *
 * Includes:
 * - Request logging
 * - CORS configuration
 * - Security headers
 * - Health check endpoint
 * - Authentication middleware for /api/* routes
 * - Standard error handlers (404, 500)
 *
 * @param config - Worker configuration
 * @returns Configured Hono app ready for route mounting
 *
 * @example
 * ```typescript
 * const app = createWorker({
 *   serviceName: 'content-api',
 *   version: '1.0.0',
 * });
 *
 * // Mount your routes
 * app.route('/api/content', contentRoutes);
 * app.route('/api/media', mediaRoutes);
 *
 * export default app;
 * ```
 */
export function createWorker(config: WorkerConfig): Hono<HonoEnv> {
  const {
    serviceName,
    version = '1.0.0',
    environment,
    enableLogging = true,
    enableCors = true,
    enableSecurityHeaders = true,
  } = config;

  const app = new Hono<HonoEnv>();

  // ============================================================================
  // Global Middleware
  // ============================================================================

  if (enableLogging) {
    app.use('*', createLoggerMiddleware());
  }

  if (enableCors) {
    app.use('*', createCorsMiddleware());
  }

  if (enableSecurityHeaders) {
    app.use('*', createSecurityHeadersMiddleware());
  }

  // ============================================================================
  // Public Routes
  // ============================================================================

  app.get('/health', createHealthCheckHandler(serviceName, version));

  // ============================================================================
  // Protected Routes (Authentication Required)
  // ============================================================================

  app.use('/api/*', createAuthMiddleware());

  // ============================================================================
  // Error Handlers
  // ============================================================================

  app.notFound(createNotFoundHandler());
  app.onError(createErrorHandler(environment));

  return app;
}
