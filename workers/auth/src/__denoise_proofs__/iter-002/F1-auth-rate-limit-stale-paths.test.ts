/**
 * Denoise iter-002 F1 — Auth rate limiter is wired against stale paths.
 *
 * Fingerprint: security:auth-endpoint-no-ratelimit
 * Severity: blocker
 * File:Line: workers/auth/src/middleware/rate-limiter.ts:22-27
 *
 * Proof shape: Catalogue row 11 — "API regression with no test infra:
 * Snapshot the route map; any drift fails." Adapted: snapshot the
 * RATE_LIMITED_PATHS Set against the live BetterAuth POST endpoints
 * actually hit by the SvelteKit app and the auth worker's own E2E
 * helpers.
 *
 * Failure mode this test would catch: the rate limiter's path Set
 * contains `/api/auth/email/login`, `/api/auth/email/register`, etc.,
 * but the actual BetterAuth POST endpoints are
 * `/api/auth/sign-in/email`, `/api/auth/sign-up/email`,
 * `/api/auth/forget-password`. Result: every auth endpoint is currently
 * unrate-limited in production — brute-force vulnerability.
 *
 * Source-of-truth grep evidence (apps/web/src):
 *   apps/web/src/routes/(auth)/login/+page.server.ts:48 → /api/auth/sign-in/email
 *   apps/web/src/routes/(auth)/register/+page.server.ts:57 → /api/auth/sign-up/email
 *   apps/web/src/routes/(auth)/forgot-password/+page.server.ts:29 → /api/auth/forget-password
 *   apps/web/src/lib/remote/auth.remote.ts:106 → /api/auth/sign-up/email
 *
 * `it.skip` while the bug stands. Un-skip in the same PR as the fix,
 * which should either (a) update RATE_LIMITED_PATHS to the live
 * BetterAuth paths, or (b) replace the Set check with a path-prefix
 * predicate driven from a single canonical constant in @codex/constants.
 */
import { describe, expect, it } from 'vitest';

/**
 * The rate-limited path Set as currently encoded in
 * `workers/auth/src/middleware/rate-limiter.ts`. Frozen here as a
 * snapshot — the assertion below shows the drift.
 */
const RATE_LIMITED_PATHS_AS_CONFIGURED = new Set([
  '/api/auth/email/login',
  '/api/auth/email/register',
  '/api/auth/email/send-reset-password-email',
  '/api/auth/email/reset-password',
]);

/**
 * The BetterAuth POST endpoints the SvelteKit app actually hits. Names
 * are taken from `apps/web/src/routes/(auth)/**` and
 * `apps/web/src/lib/remote/auth.remote.ts`. These are also the paths
 * documented in `workers/auth/CLAUDE.md`.
 */
const BETTERAUTH_RATE_LIMITED_POST_PATHS = [
  '/api/auth/sign-up/email',
  '/api/auth/sign-in/email',
  '/api/auth/forget-password',
  '/api/auth/reset-password',
] as const;

describe.skip('iter-002 F1 — auth rate limiter wired against stale paths', () => {
  it('the configured Set covers every live BetterAuth auth endpoint', () => {
    for (const livePath of BETTERAUTH_RATE_LIMITED_POST_PATHS) {
      // FAILS on current main: configured set contains the legacy
      // `/api/auth/email/*` paths, none of which BetterAuth ever
      // routes to. Every live path is missing → the limiter never
      // fires → endpoints are unrate-limited.
      expect(
        RATE_LIMITED_PATHS_AS_CONFIGURED.has(livePath),
        `Rate limiter does not cover ${livePath} — brute-force gap`
      ).toBe(true);
    }
  });

  it('the configured Set has zero stale entries (no longer-routed paths)', () => {
    // Defensive: even after the fix, leftover legacy paths shouldn't
    // linger. After fix, this set should match
    // BETTERAUTH_RATE_LIMITED_POST_PATHS exactly.
    for (const configuredPath of RATE_LIMITED_PATHS_AS_CONFIGURED) {
      expect(
        (BETTERAUTH_RATE_LIMITED_POST_PATHS as readonly string[]).includes(
          configuredPath
        ),
        `Stale path ${configuredPath} in RATE_LIMITED_PATHS — BetterAuth never routes there`
      ).toBe(true);
    }
  });
});
