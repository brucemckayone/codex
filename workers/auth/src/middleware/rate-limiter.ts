/**
 * Auth Rate Limiter Middleware
 *
 * Applies rate limiting specifically to the four user-facing
 * authentication surfaces (sign-up, sign-in, request-password-reset,
 * reset-password) to prevent brute-force / credential-stuffing.
 *
 * The path Set is sourced from `@codex/constants`
 * (BETTERAUTH_RATE_LIMITED_PATHS_SET) so it never drifts from
 * BetterAuth's actual routing — see Codex-ttavz.7 / denoise iter-002 F1
 * for the bug that motivated this single-source-of-truth pattern.
 */

import { BETTERAUTH_RATE_LIMITED_PATHS_SET } from '@codex/constants';
import {
  combineSubjects,
  credentialSubject,
  rateLimit,
  trustedIpSubject,
} from '@codex/security';
import type { Context, Next } from 'hono';
import type { AuthEnv } from '../types';

/**
 * Rate limiter middleware for auth endpoints.
 *
 * Applies the `auth` preset (5 req / 15 min) to the four canonical
 * BetterAuth user-facing POST endpoints, counted on the SUBMITTED CREDENTIAL
 * with the client address as a second signal only where that address can be
 * believed. It used to key on `cf-connecting-ip`, which on this platform is
 * the CALLING worker's Cloudflare egress address whenever the SvelteKit login
 * action forwards a sign-in — one measured address was 78% of all traffic to
 * the auth host, so every user on the platform shared one 5-per-15-min bucket
 * (Codex-kgrdp.16).
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

    const { RATE_LIMIT_DO } = c.env;

    // The shared middleware owns everything from here:
    //   - the atomic increment inside RateLimitDO (the 15-minute window the
    //     native rate-limit binding cannot express)
    //   - X-RateLimit-* response headers, which the DO store can compute
    //   - the 429 + Retry-After response when the budget is exhausted
    //   - calling next() on success
    //   - a loud, alertable `rate_limit.fail_open` signal on EVERY request if
    //     the namespace is missing or the DO throws
    //
    // Each subject gets its own bucket and the request is blocked if either is
    // exhausted, so one account being brute-forced never spends another
    // account's budget. `reset-password` carries a token rather than an email,
    // so on that path only the address counts — and when the call arrives over
    // a worker hop there is no trustworthy address either, which the fail-open
    // signal reports rather than silently guessing.
    //
    // The path goes in the key prefix so each canonical surface keeps its own
    // budget: a user who fumbles a sign-in five times must still be able to
    // ask for a password reset, which is exactly the recovery they need at that
    // moment. Safe as a key component because the Set check above closes it to
    // the four constants — nothing caller-supplied reaches the key space.
    const limiter = rateLimit({
      preset: 'auth',
      namespace: RATE_LIMIT_DO,
      keyPrefix: `rl:auth:${c.req.path}:`,
      subject: combineSubjects(credentialSubject(), trustedIpSubject()),
    });
    const result = await limiter(c, next);
    // limiter returns a Response on 429, or undefined when it called
    // next() through. Either way, normalise to Response | undefined
    // so the `sequence` helper short-circuits correctly on 429.
    return result ?? undefined;
  };
}
