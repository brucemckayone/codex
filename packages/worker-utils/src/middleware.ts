/**
 * Shared Middleware Factories
 *
 * Creates standard middleware for Cloudflare Workers using Hono.
 */

import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { securityHeaders, requireAuth } from '@codex/security';
import type { HonoEnv } from '@codex/shared-types';
import type { Context, MiddlewareHandler, Next } from 'hono';

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
   * Enable request logging
   * @default true
   */
  enableLogging?: boolean;

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
 * Creates standard logging middleware
 */
export function createLoggerMiddleware(): MiddlewareHandler {
  return logger();
}

/**
 * Creates CORS middleware with standard configuration
 */
export function createCorsMiddleware(): MiddlewareHandler<HonoEnv> {
  return cors({
    origin: (origin, c) => {
      const allowedOrigins = [
        c.env.WEB_APP_URL,
        c.env.API_URL,
        'http://localhost:3000',
        'http://localhost:5173',
      ].filter(Boolean) as string[];

      if (allowedOrigins.includes(origin)) {
        return origin;
      }

      // Block unknown origins
      return allowedOrigins[0] || '*';
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
    const environment = (c.env.ENVIRONMENT || 'development') as
      | 'development'
      | 'staging'
      | 'production';

    const middleware = securityHeaders({ environment });
    return middleware(c, next);
  };
}

/**
 * Creates authentication middleware
 */
export function createAuthMiddleware(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const isDevelopment = c.env.ENVIRONMENT === 'development';

    const authMiddleware = requireAuth({
      cookieName: 'codex-session',
      enableLogging: isDevelopment,
    });

    return authMiddleware(c, next);
  };
}

/**
 * Creates health check handler
 */
export function createHealthCheckHandler(
  serviceName: string,
  version: string = '1.0.0'
) {
  return (c: Context) => {
    return c.json({
      status: 'ok',
      service: serviceName,
      version,
      timestamp: new Date().toISOString(),
    });
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
    console.error('Unhandled error:', {
      error: err.message,
      stack: err.stack,
      path: c.req.path,
      method: c.req.method,
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
 * Chains multiple middleware handlers in sequence
 *
 * Executes handlers one after another. If any handler returns a Response,
 * the sequence stops and that response is returned. Useful for composing
 * multiple middleware functions into a single handler.
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
  ...handlers: ((c: Context, next: Next) => Promise<Response | void>)[]
): (c: Context, next: Next) => Promise<Response | void> {
  return async (c: Context, next: Next) => {
    for (const handler of handlers) {
      const response = await handler(c, next);
      if (response) {
        return response;
      }
    }
  };
}
