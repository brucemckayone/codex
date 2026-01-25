/**
 * Auth Rate Limiter Middleware
 *
 * Applies rate limiting specifically to authentication endpoints.
 * Protects against brute force attacks on login endpoints.
 */

import { IP_ADDRESSES } from '@codex/constants';
import { RATE_LIMIT_PRESETS, rateLimit } from '@codex/security';
import type { Context, Next } from 'hono';
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
          kv,
          keyGenerator: (c: Context) =>
            c.req.header('cf-connecting-ip') || IP_ADDRESSES.LOOPBACK,
          ...RATE_LIMIT_PRESETS.auth,
        })(c, next);

        if (!success) {
          return c.json({ error: 'Too many requests' }, 429);
        }

        await next();
        return undefined;
      }
    }
    await next();
    return undefined;
  };
}
