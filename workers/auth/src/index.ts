/**
 * Auth Worker
 *
 * Authentication service using BetterAuth.
 * Handles user authentication, session management, and email verification.
 *
 * Note: This worker uses custom middleware setup because BetterAuth
 * requires direct handler delegation. Request tracking is integrated.
 */

import { ENV_NAMES } from '@codex/constants';
import { securityHeaders } from '@codex/security';
import {
  createEnvValidationMiddleware,
  createErrorResponse,
  createKvCheck,
  createWorker,
  ERROR_CODES,
  sequence,
  standardDatabaseCheck,
} from '@codex/worker-utils';
import type { Context, Next } from 'hono';
import { createAuthInstance } from './auth-config';
import { createAuthRateLimiter } from './middleware';
import type { AuthEnv } from './types';

/**
 * Create worker with standard middleware
 *
 * Configuration:
 * - enableGlobalAuth: false (BetterAuth handles its own authentication)
 * - enableLogging: false (BetterAuth has custom logging)
 * - enableSecurityHeaders: false (custom security headers applied below)
 * - enableRequestTracking: true (default - needed for request correlation)
 */
const app = createWorker({
  serviceName: 'auth-worker',
  version: '1.0.0',
  enableGlobalAuth: false,
  enableLogging: false,
  enableSecurityHeaders: false,
  healthCheck: {
    checkDatabase: standardDatabaseCheck,
    checkKV: createKvCheck(['AUTH_SESSION_KV', 'RATE_LIMIT_KV']),
  },
});

/**
 * Environment validation
 * Validates required environment variables on first request
 * Runs once per worker instance (not per request)
 */
app.use(
  '*',
  createEnvValidationMiddleware({
    required: ['DATABASE_URL', 'BETTER_AUTH_SECRET'],
    optional: ['ENVIRONMENT', 'WEB_APP_URL', 'API_URL'],
  })
);

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
    const obs = c.get('obs');
    obs?.error('BetterAuth handler error', {
      error: error instanceof Error ? error.message : String(error),
      path: c.req.path,
    });
    throw error;
  }
};

/**
 * Test-only endpoint to retrieve verification tokens
 * ONLY available in development/test environments
 * Returns 404 in staging/production
 */
app.get('/api/test/verification-token/:email', async (c) => {
  const environment = c.env.ENVIRONMENT || ENV_NAMES.DEVELOPMENT;

  // Strict guard: only allow in development/test
  if (environment !== ENV_NAMES.DEVELOPMENT && environment !== ENV_NAMES.TEST) {
    return c.notFound();
  }
  const email = c.req.param('email');

  try {
    const kv = c.env.AUTH_SESSION_KV;
    if (!kv) {
      return c.json({ error: 'AUTH_SESSION_KV not configured' }, 500);
    }

    const token = await kv.get(`verification:${email}`);

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
    (c.env.ENVIRONMENT as
      | typeof ENV_NAMES.DEVELOPMENT
      | typeof ENV_NAMES.STAGING
      | typeof ENV_NAMES.PRODUCTION) || ENV_NAMES.DEVELOPMENT;
  return securityHeaders({ environment })(c, next);
};

/**
 * Middleware chain for auth routes
 * Applies security headers, rate limiting, and auth handling
 * Note: Session caching is now handled by Better Auth's secondaryStorage
 * Excludes /health endpoint
 */
app.use(
  '/api/*',
  sequence(securityHeadersMiddleware, createAuthRateLimiter(), authHandler)
);

export default app;
