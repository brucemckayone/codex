/**
 * Auth Rate Limiter Middleware
 *
 * Applies rate limiting specifically to the four user-facing
 * authentication surfaces (sign-up, sign-in, forget-password,
 * reset-password) to prevent brute-force / credential-stuffing.
 *
 * The path Set is sourced from `@codex/constants`
 * (BETTERAUTH_RATE_LIMITED_PATHS_SET) so it never drifts from
 * BetterAuth's actual routing — see Codex-ttavz.7 / denoise iter-002 F1
 * for the bug that motivated this single-source-of-truth pattern.
 */

import { BETTERAUTH_RATE_LIMITED_PATHS_SET } from '@codex/constants';
import { RATE_LIMIT_PRESETS, rateLimit } from '@codex/security';
import type { Context, Next } from 'hono';
import type { AuthEnv } from '../types';

/**
 * Rate limiter middleware for auth endpoints.
 *
 * Applies the `auth` preset (5 req / 15 min) to the four canonical
 * BetterAuth user-facing POST endpoints. Keyed per IP via
 * `cf-connecting-ip` (loopback fallback for non-Cloudflare contexts
 * such as local tests).
 *
 * Other BetterAuth paths (session, sign-out, verify-email, etc.) are
 * intentionally NOT rate-limited here — they are not brute-force
 * surfaces and limiting them could break the SDK's polling behaviour.
 *
 * @returns Hono middleware handler
 */
export function createAuthRateLimiter() {
  return async (
    c: Context<AuthEnv>,
    next: Next
  ): Promise<Response | undefined> => {
    // Only the four canonical BetterAuth POST surfaces are gated.
    // Anything else (GET /api/auth/session, POST /api/auth/sign-out,
    // verify-email, internal SDK polls) passes straight through.
    if (
      c.req.method !== 'POST' ||
      !BETTERAUTH_RATE_LIMITED_PATHS_SET.has(c.req.path)
    ) {
      await next();
      return undefined;
    }

    // Without a KV binding the limiter cannot be enforced safely
    // across instances. We fail-open and rely on the security headers
    // / Cloudflare's edge protections, but log loudly via observability.
    const kv = c.env.RATE_LIMIT_KV;
    if (!kv) {
      const obs = c.get('obs');
      obs?.warn(
        '[auth] RATE_LIMIT_KV missing — auth endpoints unrate-limited',
        { path: c.req.path }
      );
      await next();
      return undefined;
    }

    // Delegate to the shared rateLimit middleware. It owns:
    //   - the read-modify-write counter in KV
    //   - X-RateLimit-* response headers
    //   - the 429 + Retry-After response when the budget is exhausted
    //   - calling next() on success
    //
    // Key is `${ip}:${path}` so each canonical surface keeps its own
    // budget — a user who fumbles a sign-in does not lose their
    // forget-password budget. Each surface still caps at 5 / 15 min.
    const limiter = rateLimit({
      kv,
      // Default keyGenerator returns `${cf-connecting-ip || x-forwarded-for ||
      // 'unknown'}:${pathname}` — so each canonical surface keeps its own
      // budget. A user who fumbles a sign-in does not lose their
      // forget-password budget. Each surface still caps at 5 / 15 min.
      keyPrefix: 'rl:auth:',
      ...RATE_LIMIT_PRESETS.auth,
    });
    const result = await limiter(c, next);
    // limiter returns a Response on 429, or undefined when it called
    // next() through. Either way, normalise to Response | undefined
    // so the `sequence` helper short-circuits correctly on 429.
    return result ?? undefined;
  };
}
