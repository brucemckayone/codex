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
  const RATE_LIMITED_PATHS = new Set([
    '/api/auth/email/login',
    '/api/auth/email/register',
    '/api/auth/email/send-reset-password-email',
    '/api/auth/email/reset-password',
  ]);

  return async (c: Context<AuthEnv>, next: Next) => {
    // Apply rate limiting to all auth mutation endpoints
    if (RATE_LIMITED_PATHS.has(c.req.path) && c.req.method === 'POST') {
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
