/**
 * Shared Middleware Factories
 *
 * Creates standard middleware for Cloudflare Workers using Hono.
 */

import type { KVNamespace, R2Bucket } from '@cloudflare/workers-types';
import { COOKIES } from '@codex/constants';
import { createRequestTimer, ObservabilityClient } from '@codex/observability';
import {
  type CSP_PRESETS,
  RATE_LIMIT_PRESETS,
  rateLimit,
  requireAuth,
  securityHeaders,
} from '@codex/security';
import type { HonoEnv } from '@codex/shared-types';
import type { Context, MiddlewareHandler, Next } from 'hono';
import { cors } from 'hono/cors';

/**
 * Configuration for worker middleware
 */
export interface MiddlewareConfig {
  /**
   * Service name for identification
   */
  serviceName: string;

  /**
   * Environment (development, staging, production)
   */
  environment?: 'development' | 'staging' | 'production';

  /**
   * Enable CORS
   * @default true
   */
  enableCors?: boolean;

  /**
   * Enable security headers
   * @default true
   */
  enableSecurityHeaders?: boolean;
}

/**
 * Creates CORS middleware with standard configuration
 *
 * Supports:
 * - Production URLs (from WEB_APP_URL, API_URL env vars)
 * - Preview deployments (e.g., codex-preview-123.revelations.studio)
 * - Staging deployments (e.g., codex-staging.revelations.studio)
 * - Local development (localhost on various ports)
 */
export function createCorsMiddleware(): MiddlewareHandler<HonoEnv> {
  return cors({
    origin: (origin, c) => {
      // Exact match origins from environment
      const exactMatchOrigins = [
        c.env?.WEB_APP_URL,
        c.env?.API_URL,
        'http://localhost:3000', ///TODO: lets verify these are the real ports we are supposed to be authorizing against
        'http://localhost:5173',
        'http://localhost:8787',
        'http://localhost:8788',
        'http://localhost:8789',
        'http://localhost:4001',
        'http://localhost:4002',
      ].filter(Boolean) as string[];

      // Check exact matches
      if (exactMatchOrigins.includes(origin)) {
        return origin;
      }

      // Pattern-based matching for preview and staging deployments
      const allowedPatterns = [
        // Preview deployments: *-preview-{PR}.revelations.studio
        /^https:\/\/[\w-]+-preview-\d+\.revelations\.studio$/,
        // Staging deployments: *-staging.revelations.studio
        /^https:\/\/[\w-]+-staging\.revelations\.studio$/,
        // Production deployments: *.revelations.studio (any subdomain)
        /^https:\/\/[\w-]+\.revelations\.studio$/,
      ];

      for (const pattern of allowedPatterns) {
        if (pattern.test(origin)) {
          return origin;
        }
      }

      // Default fallback for development/testing
      return exactMatchOrigins[0] || 'http://localhost:3000';
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    exposeHeaders: ['Content-Length', 'X-Request-Id'],
    maxAge: 86400, // 24 hours
  });
}

/**
 * Creates security headers middleware
 */
export function createSecurityHeadersMiddleware(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const environment = (c.env?.ENVIRONMENT || 'development') as
      | 'development'
      | 'staging'
      | 'production';

    const middleware = securityHeaders({ environment });
    return middleware(c, next);
  };
}

/**
 * Creates authentication middleware
 *
 * Enforces session-based authentication for all requests.
 * Uses the requireAuth middleware from @codex/security package.
 *
 * SECURITY: Always uses real authentication - no test mode bypass.
 * Tests should use real sessions or test at the service layer.
 */
export function createAuthMiddleware(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const environment = c.env?.ENVIRONMENT;

    // Always use real authentication
    const authMiddleware = requireAuth({
      cookieName: COOKIES.SESSION_NAME,
      enableLogging: environment === 'development',
    });

    return authMiddleware(c, next);
  };
}

/**
 * Creates health check handler
 *
 * @param serviceName - Name of the service
 * @param version - Version string (default: '1.0.0')
 * @param options - Optional health check configuration
 * @returns Hono handler for /health endpoint
 *
 * @example Basic health check
 * ```typescript
 * app.get('/health', createHealthCheckHandler('content-api', '1.0.0'));
 * ```
 *
 * @example With database check
 * ```typescript
 * app.get('/health', createHealthCheckHandler('content-api', '1.0.0', {
 *   checkDatabase: async (c) => {
 *     try {
 *       await c.env.DB.prepare('SELECT 1').run();
 *       return { status: 'ok' };
 *     } catch (error) {
 *       return { status: 'error', message: error.message };
 *     }
 *   }
 * }));
 * ```
 */
export function createHealthCheckHandler(
  serviceName: string,
  version: string = '1.0.0',
  options?: {
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
    checkKV?: (c: Context) => Promise<{
      status: 'ok' | 'error';
      message?: string;
      details?: unknown;
    }>;
    /**
     * Optional R2 bucket connectivity check
     */
    checkR2?: (c: Context) => Promise<{
      status: 'ok' | 'error';
      message?: string;
      details?: unknown;
    }>;
  }
) {
  return async (c: Context) => {
    const checks: Record<
      string,
      { status: 'ok' | 'error'; message?: string; details?: unknown }
    > = {};
    let isHealthy = true;

    // Run database check if provided
    if (options?.checkDatabase) {
      try {
        const result = await options.checkDatabase(c);
        checks.database = { status: result.status };
        if (result.status === 'error') {
          isHealthy = false;
          checks.database.message = result.message;
        }
      } catch (error) {
        const e = error as Error;
        checks.database = { status: 'error', message: e.message };
        isHealthy = false;
      }
    }

    // Run KV check if provided
    if (options?.checkKV) {
      try {
        const result = await options.checkKV(c);
        checks.kv = { status: result.status, details: result.details };
        if (result.status === 'error') {
          isHealthy = false;
          checks.kv.message = result.message;
        }
      } catch (error) {
        const e = error as Error;
        checks.kv = { status: 'error', message: e.message };
        isHealthy = false;
      }
    }

    // Run R2 check if provided
    if (options?.checkR2) {
      try {
        const result = await options.checkR2(c);
        checks.r2 = { status: result.status, details: result.details };
        if (result.status === 'error') {
          isHealthy = false;
          checks.r2.message = result.message;
        }
      } catch (error) {
        const e = error as Error;
        checks.r2 = { status: 'error', message: e.message };
        isHealthy = false;
      }
    }

    const response = {
      status: isHealthy ? 'healthy' : 'unhealthy',
      service: serviceName,
      version,
      timestamp: new Date().toISOString(),
      checks,
    };

    return c.json(response, isHealthy ? 200 : 503);
  };
}

/**
 * Creates a reusable KV health check handler.
 *
 * @param bindings - An array of objects with the name and binding of the KV namespaces to check.
 * @returns An async function that performs the health check for the specified KV namespaces.
 *
 * @example
 * ```typescript
 * createKvCheck([
 *   { name: 'SESSIONS_KV', kv: c.env.SESSIONS_KV },
 *   { name: 'RATE_LIMIT_KV', kv: c.env.RATE_LIMIT_KV },
 * ])
 * ```
 */
export function createKvCheck(bindingNames: string[]): (
  c: Context<HonoEnv>
) => Promise<{
  status: 'ok' | 'error';
  message: string;
  details?: unknown;
}> {
  return async (c: Context<HonoEnv>) => {
    const obs = c.get('obs');
    const bindings = bindingNames.map((name) => ({
      name,
      kv: (c.env as Record<string, KVNamespace | undefined>)[name],
    }));

    const results = await Promise.all(
      bindings.map(async ({ name, kv }) => {
        if (!kv) {
          return {
            name,
            status: 'error',
            message: `KV namespace '${name}' is not bound.`,
          };
        }
        try {
          await kv.list({ limit: 1 });
          return { name, status: 'ok', message: `'${name}' is accessible.` };
        } catch (e) {
          const error = e instanceof Error ? e.message : 'Unknown error';
          obs?.error(`Health check for KV '${name}' failed`, {
            error,
            name,
          });
          return {
            name,
            status: 'error',
            message: `Failed to access KV namespace '${name}'.`,
          };
        }
      })
    );

    const failed = results.filter((res) => res.status === 'error');

    if (failed.length > 0) {
      return {
        status: 'error' as const,
        message: 'One or more KV namespaces are unhealthy.',
        details: failed,
      };
    }

    return {
      status: 'ok' as const,
      message: 'All KV namespaces are healthy.',
    };
  };
}

/**
 * Creates R2 bucket health check function
 *
 * @param bindingNames - Array of R2 bucket binding names to check
 * @returns Health check function for use with createHealthCheckHandler
 *
 * @example
 * ```typescript
 * createR2Check(['MEDIA_BUCKET'])
 * ```
 */
export function createR2Check(bindingNames: string[]): (
  c: Context<HonoEnv>
) => Promise<{
  status: 'ok' | 'error';
  message: string;
  details?: unknown;
}> {
  return async (c: Context<HonoEnv>) => {
    const obs = c.get('obs');
    const bindings = bindingNames.map((name) => ({
      name,
      bucket: (c.env as Record<string, R2Bucket | undefined>)[name],
    }));

    const results = await Promise.all(
      bindings.map(async ({ name, bucket }) => {
        if (!bucket) {
          return {
            name,
            status: 'error',
            message: `R2 bucket '${name}' is not bound.`,
          };
        }
        try {
          // Simple health check - list with limit 1
          await bucket.list({ limit: 1 });
          return { name, status: 'ok', message: `'${name}' is accessible.` };
        } catch (e) {
          const error = e instanceof Error ? e.message : 'Unknown error';
          obs?.error(`Health check for R2 bucket '${name}' failed`, {
            error,
            name,
          });
          return {
            name,
            status: 'error',
            message: `Failed to access R2 bucket '${name}'.`,
          };
        }
      })
    );

    const failed = results.filter((res) => res.status === 'error');

    if (failed.length > 0) {
      return {
        status: 'error' as const,
        message: 'One or more R2 buckets are unhealthy.',
        details: failed,
      };
    }

    return {
      status: 'ok' as const,
      message: 'All R2 buckets are healthy.',
    };
  };
}

/**
 * Creates standard 404 handler
 */
export function createNotFoundHandler() {
  return (c: Context) => {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'The requested resource was not found',
        },
      },
      404
    );
  };
}

/**
 * Creates standard error handler
 */
export function createErrorHandler(environment?: string) {
  return (err: Error, c: Context) => {
    const obs = c.get('obs');
    const requestId = c.get('requestId');
    obs?.error('Unhandled error', {
      error: err.message,
      stack: err.stack,
      path: c.req.path,
      method: c.req.method,
      ...(requestId && { requestId }),
    });

    // Don't expose internal error details in production
    if (environment === 'production') {
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          },
        },
        500
      );
    }

    // Development: include error details
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: err.message,
          stack: err.stack?.split('\n').slice(0, 5),
        },
      },
      500
    );
  };
}

/**
 * Standard error response codes
 */
export const ERROR_CODES = {
  INVALID_JSON: 'INVALID_JSON',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
} as const;

/**
 * Creates a standardized error response
 *
 * @param c - Hono context
 * @param code - Error code (use ERROR_CODES constants)
 * @param message - Human-readable error message
 * @param status - HTTP status code
 * @returns JSON error response
 *
 * @example
 * ```typescript
 * return createErrorResponse(c, ERROR_CODES.INVALID_JSON, 'Request body contains invalid JSON', 400);
 * ```
 */
export function createErrorResponse(
  c: Context,
  code: string,
  message: string,
  status: number
) {
  return c.json(
    {
      error: {
        code,
        message,
      },
    },
    status as 400 | 401 | 403 | 404 | 500
  );
}

/**
 * Creates observability middleware with request timing and error tracking
 *
 * Provides ObservabilityClient in context as 'obs' for use in all handlers.
 * Automatically tracks request timing.
 *
 * @param serviceName - Name of the service for logging
 * @returns Middleware handler
 *
 * @example
 * ```typescript
 * app.use('*', createObservabilityMiddleware('my-api'));
 *
 * // In handlers:
 * app.get('/foo', (c) => {
 *   const obs = c.get('obs');
 *   obs.info('Processing request');
 *   return c.json({ ok: true });
 * });
 * ```
 */
export function createObservabilityMiddleware<T extends HonoEnv = HonoEnv>(
  serviceName: string
) {
  return async (c: Context<T>, next: Next) => {
    const obs = new ObservabilityClient(
      serviceName,
      c.env?.ENVIRONMENT || 'development'
    );

    // Correlate logs with the request ID from tracking middleware
    const requestId = c.get('requestId');
    if (requestId) {
      obs.setRequestId(requestId);
    }

    // Make observability client available in context
    c.set('obs', obs);

    // Track request timing
    const timer = createRequestTimer(obs, c.req);
    await next();
    timer.end(c.res.status);
  };
}

/**
 * Creates error handler with observability tracking
 *
 * @param serviceName - Name of the service for logging
 * @param environment - Optional environment override
 * @returns Error handler function
 */
export function createObservabilityErrorHandler(
  serviceName: string,
  environment?: string
) {
  return (err: Error, c: Context) => {
    let obs = c.get('obs') as ObservabilityClient | undefined;
    if (!obs) {
      obs = new ObservabilityClient(serviceName, environment || 'development');
      const requestId = c.get('requestId');
      if (requestId) {
        obs.setRequestId(requestId);
      }
    }

    obs.trackError(err, {
      url: c.req.url,
      method: c.req.method,
    });

    return c.text('Internal Server Error', 500);
  };
}

/**
 * Creates a standardized security headers middleware wrapper
 *
 * @param options - Security headers options
 * @returns Middleware handler
 */
export function createSecurityHeadersWrapper(options?: {
  csp?: (typeof CSP_PRESETS)[keyof typeof CSP_PRESETS];
}) {
  return (c: Context<HonoEnv>, next: Next) => {
    const environment = (c.env?.ENVIRONMENT || 'development') as
      | 'development'
      | 'staging'
      | 'production';

    return securityHeaders({
      environment,
      ...options,
    })(c, next);
  };
}

/**
 * Creates a standardized rate limiting middleware wrapper
 *
 * @param preset - Rate limit preset name
 * @returns Middleware handler
 */
export function createRateLimitWrapper(
  preset: keyof typeof RATE_LIMIT_PRESETS = 'api'
) {
  return (c: Context<HonoEnv>, next: Next) => {
    return rateLimit({
      kv: c.env?.RATE_LIMIT_KV,
      ...RATE_LIMIT_PRESETS[preset],
    })(c, next);
  };
}

/**
 * Generate a unique request ID (UUID v4)
 */
function generateRequestId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Extract client IP from Cloudflare headers
 */
function getClientIP(c: Context<HonoEnv>): string {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Real-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * Request tracking middleware
 *
 * Automatically injects request metadata into context:
 * - requestId: Unique identifier for correlation across logs
 * - clientIP: Client IP address from Cloudflare headers
 * - userAgent: User agent string for analytics/security
 *
 * This middleware should be applied early in the chain so all
 * subsequent middleware and handlers can access this metadata.
 *
 * @example
 * ```typescript
 * app.use('*', createRequestTrackingMiddleware());
 *
 * // In handlers:
 * app.get('/foo', (c) => {
 *   const requestId = c.get('requestId');
 *   const clientIP = c.get('clientIP');
 *   console.log(`Request ${requestId} from ${clientIP}`);
 * });
 * ```
 */
export function createRequestTrackingMiddleware(): MiddlewareHandler<HonoEnv> {
  return async (c: Context<HonoEnv>, next: Next) => {
    // Generate or use existing request ID
    const requestId =
      c.req.header('X-Request-ID') || c.get('requestId') || generateRequestId();

    // Extract client IP
    const clientIP = getClientIP(c);

    // Get user agent
    const userAgent = c.req.header('User-Agent') || 'unknown';

    // Set in context for downstream handlers
    c.set('requestId', requestId);
    c.set('clientIP', clientIP);
    c.set('userAgent', userAgent);

    // Also set as response header for debugging/correlation
    c.header('X-Request-ID', requestId);

    await next();
  };
}

/**
 * Chains multiple middleware handlers in sequence
 *
 * Executes handlers one after another. Each handler calls the next one in the chain.
 * Useful for composing multiple middleware functions into a single handler.
 *
 * @param handlers - Middleware handlers to execute in sequence
 * @returns Combined middleware handler
 *
 * @example
 * ```typescript
 * app.use('*',
 *   sequence(
 *     securityHeaders({ environment: 'production' }),
 *     rateLimiter,
 *     sessionCache,
 *     authHandler
 *   )
 * );
 * ```
 */
export function sequence(
  ...handlers: ((c: Context, next: Next) => Promise<Response | undefined>)[]
): (c: Context, next: Next) => Promise<Response | undefined> {
  return async (c: Context, next: Next) => {
    let index = -1;
    let response: Response | undefined;

    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) {
        throw new Error('next() called multiple times');
      }
      index = i;

      if (i >= handlers.length) {
        // All handlers completed, call the final next()
        await next();
        return;
      }

      const handler = handlers[i];
      if (!handler) {
        throw new Error(`Handler at index ${i} is undefined`);
      }
      const result = await handler(c, () => dispatch(i + 1));

      // Capture the response from any handler that returns one
      if (result && !response) {
        response = result;
      }
    };

    await dispatch(0);
    return response;
  };
}
