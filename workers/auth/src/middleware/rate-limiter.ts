/**
 * Auth Rate Limiter Middleware
 *
 * Applies rate limiting specifically to authentication endpoints.
 * Protects against brute force attacks on login endpoints.
 */

import { Context, Next } from 'hono';
import { rateLimit, RATE_LIMIT_PRESETS } from '@codex/security';
import type { AuthEnv } from '../types';

/**
 * Rate limiter middleware for auth endpoints
 *
 * Applies strict rate limiting to login endpoints to prevent brute force attacks.
 * Uses IP-based rate limiting with preset thresholds from @codex/security.
 *
 * @returns Hono middleware handler
 */
export function createAuthRateLimiter() {
  return async (c: Context<AuthEnv>, next: Next) => {
    // Only apply rate limiting to login endpoint
    if (c.req.path === '/api/auth/email/login' && c.req.method === 'POST') {
      const kv = c.env.RATE_LIMIT_KV;
      if (kv) {
        const success = await rateLimit({
          kv: kv as any, // Type assertion due to @cloudflare/workers-types version mismatch
          keyGenerator: (c: Context) =>
            c.req.header('cf-connecting-ip') || '127.0.0.1',
          ...RATE_LIMIT_PRESETS.auth,
        })(c, next);

        if (!success) {
          return c.json({ error: 'Too many requests' }, 429);
        }
        return next();
      }
    }
    return next();
  };
}
