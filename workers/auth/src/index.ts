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
import { createEnvValidationMiddleware } from './utils/validate-env';

const app = new Hono<AuthEnv>();

/**
 * Environment validation
 * Validates required environment variables on first request
 * Runs once per worker instance (not per request)
 */
app.use('*', createEnvValidationMiddleware());

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
 * Test-only endpoint to retrieve verification tokens
 * ONLY available in development/test environments
 * Returns 404 in staging/production
 */
app.get('/api/test/verification-token/:email', async (c) => {
  const environment = c.env.ENVIRONMENT || 'development';

  // Strict guard: only allow in development/test
  if (environment !== 'development' && environment !== 'test') {
    return c.notFound();
  }
  const email = c.req.param('email');

  try {
    const token = await c.env.AUTH_SESSION_KV.get(`verification:${email}`);

    if (!token) {
      return c.json({ error: 'Verification token not found or expired' }, 404);
    }

    return c.json({ token, email });
  } catch (error) {
    console.error('[TEST] Failed to retrieve verification token:', error);
    return c.json({ error: 'Failed to retrieve token' }, 500);
  }
});

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
