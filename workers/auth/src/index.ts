/**
 * Auth Worker
 *
 * Authentication service using BetterAuth.
 * Handles user authentication, session management, and email verification.
 *
 * Note: This worker uses custom middleware setup because BetterAuth
 * requires direct handler delegation. Request tracking is integrated.
 */

import { securityHeaders } from '@codex/security';
import {
  createErrorHandler,
  createErrorResponse,
  createHealthCheckHandler,
  createKvCheck,
  createNotFoundHandler,
  createStandardMiddlewareChain,
  ERROR_CODES,
  sequence,
  standardDatabaseCheck,
} from '@codex/worker-utils';
import { type Context, Hono, type Next } from 'hono';
import { createAuthInstance } from './auth-config';
import {
  createAuthRateLimiter,
  createSessionCacheMiddleware,
} from './middleware';
import type { AuthEnv } from './types';

const app = new Hono<AuthEnv>();

/**
 * Global middleware chain
 * Applies request tracking to all routes
 */
const globalMiddleware = createStandardMiddlewareChain({
  serviceName: 'auth-worker',
  skipLogging: true,
  skipSecurityHeaders: true,
});

for (const middleware of globalMiddleware) {
  app.use('*', middleware);
}

/**
 * BetterAuth handler
 * Delegates all auth operations to BetterAuth
 * Wrapped with error handling to gracefully handle malformed requests
 */
const authHandler = async (c: Context<AuthEnv>, _next: Next) => {
  //  Validate JSON body if present
  if (
    c.req.method !== 'GET' &&
    c.req.header('content-type')?.includes('application/json')
  ) {
    const rawBody = await c.req.raw.clone().text();
    if (rawBody?.trim()) {
      try {
        JSON.parse(rawBody);
      } catch {
        return createErrorResponse(
          c,
          ERROR_CODES.INVALID_JSON,
          'Request body contains invalid JSON',
          400
        );
      }
    }
  }

  try {
    const auth = createAuthInstance({ env: c.env });
    const response = await auth.handler(c.req.raw);

    // BetterAuth might return null/undefined for unrecognized routes
    if (!response) {
      return createErrorResponse(
        c,
        ERROR_CODES.NOT_FOUND,
        'Auth endpoint not found',
        404
      );
    }

    return response;
  } catch (error) {
    // BetterAuth threw an error - let error handler deal with it
    console.error('BetterAuth handler error:', error);
    throw error;
  }
};

/**
 * Health check endpoint
 * Must be registered before the catch-all auth handler
 */
app.get(
  '/health',
  createHealthCheckHandler('auth-worker', '1.0.0', {
    checkKV: createKvCheck(['AUTH_SESSION_KV', 'RATE_LIMIT_KV']),
    checkDatabase: standardDatabaseCheck,
  })
);

/**
 * Security headers middleware wrapper
 * Applies appropriate security headers based on environment
 */
const securityHeadersMiddleware = async (
  c: Context<AuthEnv>,
  next: Next
): Promise<Response | undefined> => {
  const environment =
    (c.env.ENVIRONMENT as 'development' | 'staging' | 'production') ||
    'development';
  return securityHeaders({ environment })(c, next);
};

/**
 * Middleware chain for auth routes
 * Applies security headers, rate limiting, session caching, and auth handling
 * Excludes /health endpoint
 */
app.use(
  '/api/*',
  sequence(
    securityHeadersMiddleware,
    createAuthRateLimiter(),
    createSessionCacheMiddleware(),
    authHandler
  )
);

/**
 * 404 handler for unknown routes
 */
app.notFound(createNotFoundHandler());

/**
 * Global error handler
 */
app.onError((err, c) => {
  const environment = c.env?.ENVIRONMENT || 'development';
  return createErrorHandler(environment)(err, c);
});

export default app;
