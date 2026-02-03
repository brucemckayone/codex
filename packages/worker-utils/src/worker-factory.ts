/**
 * Worker Factory
 *
 * Creates a fully configured Hono app with standard middleware.
 * Enhanced with request tracking, network security, and declarative configuration.
 */

import { workerAuth } from '@codex/security';
import type { HonoEnv } from '@codex/shared-types';
import { type Context, Hono } from 'hono';
import { createSessionMiddleware } from './auth-middleware';
import {
  createCorsMiddleware,
  createErrorHandler,
  createHealthCheckHandler,
  createNotFoundHandler,
  createObservabilityMiddleware,
  createRequestTrackingMiddleware,
  createSecurityHeadersMiddleware,
  type MiddlewareConfig,
} from './middleware';

/**
 * CORS configuration
 */
export interface CORSConfig {
  /**
   * Allowed origins for CORS
   * Can be specific URLs or extracted from environment variables
   */
  allowedOrigins?: string[];

  /**
   * Allow credentials (cookies, auth headers)
   * @default true
   */
  allowCredentials?: boolean;

  /**
   * Allowed HTTP methods
   * @default ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
   */
  allowMethods?: string[];

  /**
   * Allowed headers
   * @default ['Content-Type', 'Authorization', 'Cookie']
   */
  allowHeaders?: string[];

  /**
   * Exposed headers
   * @default ['Content-Length', 'X-Request-ID']
   */
  exposeHeaders?: string[];

  /**
   * Max age for preflight cache (seconds)
   * @default 86400 (24 hours)
   */
  maxAge?: number;
}

/**
 * Health check options
 */
export interface HealthCheckOptions {
  /**
   * Optional database connectivity check
   * Should return { status: 'ok' } on success or { status: 'error', message: string } on failure
   */
  checkDatabase?: (
    c: Context
  ) => Promise<{ status: 'ok' | 'error'; message?: string }>;

  /**
   * Optional KV connectivity check
   */
  checkKV?: (
    c: Context
  ) => Promise<{ status: 'ok' | 'error'; message?: string }>;

  /**
   * Optional R2 bucket connectivity check
   */
  checkR2?: (
    c: Context
  ) => Promise<{ status: 'ok' | 'error'; message?: string; details?: unknown }>;
}

/**
 * Configuration for creating a worker
 */
export interface WorkerConfig extends MiddlewareConfig {
  /**
   * Version string for health check
   * @default '1.0.0'
   */
  version?: string;

  /**
   * Enable request tracking (request ID, IP, user agent)
   * @default true
   */
  enableRequestTracking?: boolean;

  /**
   * Enable global authentication middleware on /api/* routes
   * Set to false if using route-level withPolicy() instead
   * @default true
   */
  enableGlobalAuth?: boolean;

  /**
   * Public routes that bypass authentication
   * @default ['/health']
   */
  publicRoutes?: string[];

  /**
   * Internal route prefix for worker-to-worker communication
   * These routes require HMAC authentication
   * @default '/internal'
   */
  internalRoutePrefix?: string;

  /**
   * Worker shared secret for HMAC authentication
   * Required if using internal routes
   */
  workerSharedSecret?: string;

  /**
   * Allowed worker origins for internal routes
   * Optional IP/origin whitelist for additional security
   */
  allowedWorkerOrigins?: string[];

  /**
   * CORS configuration
   * If not provided, uses default config with env variables
   */
  cors?: CORSConfig;

  /**
   * Health check options
   * Configure optional health checks for database, KV, etc.
   */
  healthCheck?: HealthCheckOptions;
}

/**
 * Creates a fully configured Hono app with standard middleware
 *
 * Enhanced features:
 * - Request tracking (request ID, client IP, user agent)
 * - Configurable CORS (declarative instead of runtime)
 * - Security headers with CSP
 * - Health check endpoint
 * - User authentication middleware for /api/* routes
 * - Worker-to-worker authentication for internal routes
 * - Standard error handlers (404, 500)
 *
 * @param config - Worker configuration
 * @returns Configured Hono app ready for route mounting
 *
 * @example Basic usage
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
 *
 * @example With internal routes
 * ```typescript
 * const app = createWorker({
 *   serviceName: 'ecom-api',
 *   version: '1.0.0',
 *   internalRoutePrefix: '/internal',
 *   workerSharedSecret: c.env.WORKER_SHARED_SECRET,
 *   allowedWorkerOrigins: ['https://auth.revelations.studio'],
 * });
 *
 * // Mount internal routes (worker-to-worker only)
 * app.route('/internal/webhook', internalRoutes);
 * ```
 *
 * @example Custom CORS
 * ```typescript
 * const app = createWorker({
 *   serviceName: 'public-api',
 *   cors: {
 *     allowedOrigins: ['https://example.com', 'https://partner.com'],
 *     allowCredentials: false,
 *     maxAge: 3600,
 *   },
 * });
 * ```
 */
export function createWorker<TEnv extends HonoEnv = HonoEnv>(
  config: WorkerConfig
): Hono<TEnv> {
  const {
    serviceName,
    version = '1.0.0',
    environment,
    enableCors = true,
    enableSecurityHeaders = true,
    enableRequestTracking = true,
    enableGlobalAuth = true,
    publicRoutes: _publicRoutes = ['/health'], // Reserved for future use
    internalRoutePrefix = '/internal',
    workerSharedSecret,
    allowedWorkerOrigins,
    healthCheck,
  } = config;

  const app = new Hono<TEnv>();

  // ============================================================================
  // Global Middleware (Applied to ALL routes)
  // ============================================================================

  // Request tracking should run first to generate IDs for logging
  if (enableRequestTracking) {
    app.use('*', createRequestTrackingMiddleware());
  }

  // Observability (after tracking so requestId is available for log correlation)
  app.use('*', createObservabilityMiddleware(serviceName));

  if (enableCors) {
    app.use('*', createCorsMiddleware());
  }

  if (enableSecurityHeaders) {
    app.use('*', createSecurityHeadersMiddleware());
  }

  // ============================================================================
  // Public Routes (No Authentication)
  // ============================================================================

  // Health check - full check with dependency validation
  app.get(
    '/health',
    createHealthCheckHandler(serviceName, version, healthCheck)
  );

  // Additional public routes if specified
  // (Currently just health, but could be extended)

  // ============================================================================
  // Internal Routes (Worker-to-Worker HMAC Authentication)
  // ============================================================================

  if (workerSharedSecret) {
    app.use(`${internalRoutePrefix}/*`, (c, next) => {
      return workerAuth({
        secret: workerSharedSecret,
        allowedOrigins: allowedWorkerOrigins,
      })(c, next);
    });

    // Set flag in context for policy middleware
    app.use(`${internalRoutePrefix}/*`, async (c, next) => {
      c.set('workerAuth', true);
      await next();
    });
  }

  // ============================================================================
  // Protected API Routes (User Authentication Required)
  // ============================================================================

  if (enableGlobalAuth) {
    // Apply session middleware to all API routes
    // Requires authentication by default - use withPolicy(POLICY_PRESETS.public()) for public routes
    app.use('/api/*', createSessionMiddleware({ required: true }));
  }

  // ============================================================================
  // Error Handlers
  // ============================================================================

  app.notFound(createNotFoundHandler());
  app.onError(createErrorHandler(environment));

  return app;
}
