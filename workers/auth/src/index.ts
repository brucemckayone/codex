/**
 * Auth Worker
 *
 * Authentication service using BetterAuth.
 * Handles user authentication, session management, and email verification.
 *
 * Note: This worker uses custom middleware setup because BetterAuth
 * requires direct handler delegation. Request tracking is integrated.
 */

import { AUTH_ROLES, ENV_NAMES } from '@codex/constants';
import { createDbClient, eq, schema } from '@codex/database';
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
import type { AuthBindings, AuthEnv } from './types';

/**
 * Create worker with standard middleware
 *
 * Configuration:
 * - enableGlobalAuth: false (BetterAuth handles its own authentication)
 * - enableSecurityHeaders: false (custom security headers applied below)
 * - enableRequestTracking: true (default - needed for request correlation)
 */
const app = createWorker({
  serviceName: 'auth-worker',
  version: '1.0.0',
  enableGlobalAuth: false,
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
 * Test-only endpoint for fast user registration
 * Combines register + verify + session creation in a single call.
 * Bypasses BetterAuth's multi-step flow for E2E test performance.
 * ONLY available in development/test environments.
 */
app.post('/api/test/fast-register', async (c) => {
  const env = c.env as unknown as AuthBindings;
  const environment = env.ENVIRONMENT || ENV_NAMES.DEVELOPMENT;

  if (environment !== ENV_NAMES.DEVELOPMENT && environment !== ENV_NAMES.TEST) {
    return c.notFound();
  }

  const { email, password, name, role } = await c.req.json<{
    email: string;
    password: string;
    name?: string;
    role?: string;
  }>();

  if (!email || !password) {
    return c.json({ error: 'email and password are required' }, 400);
  }

  try {
    const db = createDbClient(env);
    const auth = createAuthInstance({ env });

    // Use BetterAuth's internal API to create user + session in one go.
    // This calls signUpEmail which handles password hashing and user creation.
    const userName = name ?? email.split('@')[0] ?? 'Test User';
    const userRole = role ?? AUTH_ROLES.USER;

    // Use BetterAuth as an HTTP handler to get proper Set-Cookie headers.
    // Build a synthetic request to the sign-up endpoint.
    const signUpRequest = new Request(
      `${env.WEB_APP_URL || 'http://localhost:42069'}/api/auth/sign-up/email`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin:
            env.WEB_APP_URL ||
            c.req.header('Origin') ||
            'http://localhost:42069',
        },
        body: JSON.stringify({
          email,
          password,
          name: userName,
          role: userRole,
        }),
      }
    );

    const signUpResponse = await auth.handler(signUpRequest);

    if (!signUpResponse || signUpResponse.status >= 400) {
      const body = signUpResponse ? await signUpResponse.text() : 'null';
      return c.json({ error: 'Sign-up failed', details: body }, 500);
    }

    // Mark email as verified directly in the database
    await db
      .update(schema.users)
      .set({ emailVerified: true })
      .where(eq(schema.users.email, email));

    // Return the sign-up response which includes Set-Cookie headers
    return signUpResponse;
  } catch (error) {
    console.error('[TEST] fast-register failed:', error);
    return c.json(
      {
        error: 'Fast registration failed',
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
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
