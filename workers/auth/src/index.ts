/**
 * Auth Worker
 *
 * Authentication service using BetterAuth.
 * Handles user authentication, session management, and email verification.
 */

import { Hono, Context, Next } from 'hono';
import { securityHeaders } from '@codex/security';
import { sequence } from '@codex/worker-utils';
import { createAuthInstance } from './auth-config';
import {
  createSessionCacheMiddleware,
  createAuthRateLimiter,
} from './middleware';
import type { AuthEnv } from './types';

const app = new Hono<AuthEnv>();

/**
 * BetterAuth handler
 * Delegates all auth operations to BetterAuth
 */
const authHandler = async (c: Context<AuthEnv>, _next: Next) => {
  const auth = createAuthInstance({ env: c.env });
  return auth.handler(c.req.raw);
};

/**
 * Health check endpoint
 * Must be registered before the catch-all auth handler
 */
app.get('/health', (c) => {
  return c.json(
    {
      status: 'ok',
      service: 'auth-worker',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    },
    200
  );
});

/**
 * Security headers middleware wrapper
 * Applies appropriate security headers based on environment
 */
const securityHeadersMiddleware = async (c: Context<AuthEnv>, next: Next) => {
  const environment =
    (c.env.ENVIRONMENT as 'development' | 'staging' | 'production') ||
    'development';
  return securityHeaders({ environment })(c, next);
};

/**
 * Middleware chain
 * Applies security headers, rate limiting, session caching, and auth handling
 */
app.use(
  '*',
  sequence(
    securityHeadersMiddleware,
    createAuthRateLimiter(),
    createSessionCacheMiddleware(),
    authHandler
  )
);

export default app;
