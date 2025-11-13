/**
 * Shared Middleware Factories
 *
 * Creates standard middleware for Cloudflare Workers using Hono.
 */

import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import {
  securityHeaders,
  requireAuth,
  rateLimit,
  RATE_LIMIT_PRESETS,
  CSP_PRESETS,
} from '@codex/security';
import { ObservabilityClient, createRequestTimer } from '@codex/observability';
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
 *
 * In test environments, this middleware will set a mock user and session
 * instead of enforcing real authentication, allowing tests to focus on
 * business logic validation without needing to set up real sessions.
 */
export function createAuthMiddleware(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const environment = c.env.ENVIRONMENT;
    const isDevelopment = environment === 'development';
    const isTest = environment === 'test';

    // In test mode, mock authentication for any request with a cookie
    if (isTest) {
      const cookieHeader = c.req.header('cookie');
      if (cookieHeader) {
        // Set mock user and session for tests
        c.set('user', {
          id: 'test-user-id',
          email: 'test@example.com',
          name: 'Test User',
          emailVerified: true,
          image: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        c.set('session', {
          id: 'test-session-id',
          userId: 'test-user-id',
          token: 'test-token',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          ipAddress: '127.0.0.1',
          userAgent: 'test-agent',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        return next();
      }
      // No cookie in test mode - still require auth (for testing 401 responses)
      return c.json(
        {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        },
        401
      );
    }

    // Production/development: use real auth
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
      status: 'healthy',
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
      c.env.ENVIRONMENT || 'development'
    );

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
    const obs =
      (c.get('obs') as ObservabilityClient | undefined) ||
      new ObservabilityClient(serviceName, environment || 'development');

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
  ...handlers: ((
    c: Context,
    next: Next
  ) => Promise<globalThis.Response | void>)[]
): (c: Context, next: Next) => Promise<globalThis.Response | void> {
  return async (c: Context, next: Next) => {
    let index = -1;

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
      await handler(c, () => dispatch(i + 1));
    };

    await dispatch(0);
  };
}
