/**
 * Denoise iter-002 F1 — Auth rate limiter is wired against stale paths.
 *
 * Fingerprint: security:auth-endpoint-no-ratelimit
 * Severity: blocker
 * File:Line: workers/auth/src/middleware/rate-limiter.ts (was 22-27)
 *
 * Proof shape: Catalogue row 11 — "API regression with no test infra:
 * Snapshot the route map; any drift fails." Adapted: snapshot the
 * canonical BetterAuth path Set against the live BetterAuth POST
 * endpoints actually hit by the SvelteKit app and the auth worker's
 * own E2E helpers.
 *
 * Pre-fix failure mode (Codex-ttavz.7): the limiter's path Set
 * contained `/api/auth/email/login`, `/api/auth/email/register`, etc.,
 * but the actual BetterAuth POST endpoints are
 * `/api/auth/sign-in/email`, `/api/auth/sign-up/email`,
 * `/api/auth/forget-password`, `/api/auth/reset-password`. Result:
 * every auth endpoint was unrate-limited in production — brute-force
 * vulnerability.
 *
 * Fix: paths now live in `@codex/constants` as
 * `BETTERAUTH_RATE_LIMITED_PATHS_SET` and are imported by the auth
 * worker's middleware. This test asserts the canonical Set matches the
 * live BetterAuth POST endpoints — the single source of truth.
 *
 * Source-of-truth grep evidence (apps/web/src):
 *   apps/web/src/routes/(auth)/login/+page.server.ts:48 → /api/auth/sign-in/email
 *   apps/web/src/routes/(auth)/register/+page.server.ts:57 → /api/auth/sign-up/email
 *   apps/web/src/routes/(auth)/forgot-password/+page.server.ts:29 → /api/auth/forget-password
 *   apps/web/src/lib/remote/auth.remote.ts:106 → /api/auth/sign-up/email
 */
import {
  BETTERAUTH_RATE_LIMITED_PATHS,
  BETTERAUTH_RATE_LIMITED_PATHS_SET,
} from '@codex/constants';
import { describe, expect, it } from 'vitest';

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

describe('iter-002 F1 — auth rate limiter covers live BetterAuth paths', () => {
  it('the canonical Set covers every live BetterAuth auth endpoint', () => {
    for (const livePath of BETTERAUTH_RATE_LIMITED_POST_PATHS) {
      expect(
        BETTERAUTH_RATE_LIMITED_PATHS_SET.has(livePath),
        `Rate limiter does not cover ${livePath} — brute-force gap`
      ).toBe(true);
    }
  });

  it('the canonical Set has zero stale entries (no longer-routed paths)', () => {
    for (const configuredPath of BETTERAUTH_RATE_LIMITED_PATHS_SET) {
      expect(
        (BETTERAUTH_RATE_LIMITED_POST_PATHS as readonly string[]).includes(
          configuredPath
        ),
        `Stale path ${configuredPath} in BETTERAUTH_RATE_LIMITED_PATHS — BetterAuth never routes there`
      ).toBe(true);
    }
  });

  it('the canonical Set and array agree (no drift between exports)', () => {
    expect([...BETTERAUTH_RATE_LIMITED_PATHS].sort()).toEqual(
      [...BETTERAUTH_RATE_LIMITED_PATHS_SET].sort()
    );
  });
});
