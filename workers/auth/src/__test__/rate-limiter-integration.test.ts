/**
 * Auth Rate Limiter — Integration Tests
 *
 * Behavioural coverage for `createAuthRateLimiter()` mounted in
 * `workers/auth/src/index.ts`. These tests exercise the full middleware
 * chain through `SELF.fetch` (via `cloudflare:test`), so we hit the
 * real KV-backed limiter and the live mounted handler.
 *
 * Per `feedback_security_deep_test`: HMAC/auth/rate-limit changes
 * MUST have unit + integration tests for BOTH positive and negative
 * paths before closing.
 *
 * Background — Codex-ttavz.7 / denoise iter-002 F1: the limiter's
 * hard-coded path Set referenced legacy `/api/auth/email/*` routes
 * that BetterAuth never registers. Live BetterAuth POSTs go to
 * `/api/auth/sign-up/email`, `/api/auth/sign-in/email`,
 * `/api/auth/forget-password`, `/api/auth/reset-password`. Result: all
 * four user-facing brute-force surfaces were entirely unrate-limited.
 *
 * The canonical paths now live in `@codex/constants` as
 * `BETTERAUTH_RATE_LIMITED_PATHS` so future drift surfaces in one
 * place. This file is the R9 hard-rule integration assertion.
 *
 * Test strategy:
 *   - Positive path: under-budget requests pass through (no 429) and
 *     carry X-RateLimit-* headers
 *   - Negative path: the (BUDGET+1)th request to each canonical path
 *     returns 429 with Retry-After
 *   - Per-IP isolation: a different cf-connecting-ip gets a fresh
 *     budget on the same path
 *   - Per-path isolation: a different canonical path on the same IP
 *     gets a fresh budget
 *   - Non-rate-limited paths: GET /api/auth/session and POST
 *     /api/auth/sign-out share neither the path Set nor the budget
 *
 * We assert on rate-limit headers and HTTP status, not on response
 * body shape — BetterAuth itself runs after the limiter and may
 * return any status (200/400/422/500) depending on env config. The
 * limiter sits in front and the gate works regardless.
 */

import { SELF } from 'cloudflare:test';
import {
  BETTERAUTH_RATE_LIMITED_PATHS,
  RATE_LIMIT_PRESETS as PRESETS,
} from '@codex/constants';
import { describe, expect, it } from 'vitest';

// RATE_LIMIT_PRESETS.auth = 5 requests / 15 minutes.
const BUDGET = PRESETS.AUTH.maxRequests;

interface PostInit {
  ip: string;
  body?: unknown;
}

/**
 * POST a canonical BetterAuth path with a stable IP so the limiter
 * keys on `${ip}:${path}` predictably across calls.
 */
async function post(path: string, { ip, body }: PostInit): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-connecting-ip': ip,
    },
    body: JSON.stringify(body ?? {}),
  });
}

describe('createAuthRateLimiter — integration (Codex-ttavz.7)', () => {
  describe('positive path — under-budget requests', () => {
    // Each canonical path gets its own positive-path assertion so the
    // test fails loudly if any one of the four surfaces drops out of
    // the Set.
    for (const path of BETTERAUTH_RATE_LIMITED_PATHS) {
      it(`tags ${path} responses with X-RateLimit-* headers`, async () => {
        // Unique IP per case → fresh KV budget, no cross-test bleed.
        const ip = `198.51.100.${BETTERAUTH_RATE_LIMITED_PATHS.indexOf(path) + 10}`;
        const res = await post(path, { ip, body: { dummy: true } });
        await res.text();

        expect(res.headers.get('X-RateLimit-Limit')).toBe(String(BUDGET));
        const remaining = res.headers.get('X-RateLimit-Remaining');
        expect(remaining).not.toBeNull();
        expect(Number(remaining)).toBeLessThanOrEqual(BUDGET - 1);
        expect(res.headers.get('X-RateLimit-Reset')).not.toBeNull();
        expect(res.status).not.toBe(429);
      });
    }
  });

  describe('negative path — budget exhaustion returns 429 with Retry-After', () => {
    // Each canonical path is verified independently — proof that none
    // is left unrate-limited (the original bug).
    for (const path of BETTERAUTH_RATE_LIMITED_PATHS) {
      it(`returns 429 after ${BUDGET} POSTs to ${path}`, async () => {
        const ip = `198.51.100.${BETTERAUTH_RATE_LIMITED_PATHS.indexOf(path) + 30}`;

        // Burn the entire budget serially (KV limiter is RMW — racing
        // would break the assertion).
        for (let i = 0; i < BUDGET; i++) {
          const res = await post(path, { ip, body: { dummy: true } });
          // Sanity: still under budget → never 429.
          expect(res.status).not.toBe(429);
          await res.text();
        }

        // (BUDGET+1)th request must be rejected.
        const overBudget = await post(path, { ip, body: { dummy: true } });
        expect(overBudget.status).toBe(429);
        expect(overBudget.headers.get('Retry-After')).not.toBeNull();

        const body = (await overBudget.json()) as {
          error?: string;
          retryAfter?: number;
        };
        expect(body.error).toBe('Too many requests');
        expect(typeof body.retryAfter).toBe('number');
      });
    }
  });

  describe('isolation guarantees', () => {
    it('keeps separate budgets per IP on the same path', async () => {
      const path = '/api/auth/sign-in/email';
      const blockedIp = '198.51.100.50';
      const freshIp = '198.51.100.51';

      // Drain blockedIp's budget on this path.
      for (let i = 0; i < BUDGET; i++) {
        const res = await post(path, { ip: blockedIp });
        await res.text();
      }
      const blocked = await post(path, { ip: blockedIp });
      expect(blocked.status).toBe(429);
      await blocked.text();

      // freshIp must still be allowed on the same path.
      const allowed = await post(path, { ip: freshIp });
      expect(allowed.status).not.toBe(429);
      expect(allowed.headers.get('X-RateLimit-Limit')).toBe(String(BUDGET));
      await allowed.text();
    });

    it('keeps separate budgets per path on the same IP', async () => {
      const ip = '198.51.100.60';
      const exhausted = '/api/auth/sign-up/email';
      const fresh = '/api/auth/forget-password';

      // Drain exhausted path on this IP.
      for (let i = 0; i < BUDGET; i++) {
        const res = await post(exhausted, { ip });
        await res.text();
      }
      const blocked = await post(exhausted, { ip });
      expect(blocked.status).toBe(429);
      await blocked.text();

      // The other canonical path on the same IP must still be allowed —
      // a botched sign-up should not lock the user out of password reset.
      const allowed = await post(fresh, { ip });
      expect(allowed.status).not.toBe(429);
      expect(allowed.headers.get('X-RateLimit-Limit')).toBe(String(BUDGET));
      await allowed.text();
    });
  });

  describe('non-rate-limited paths bypass the limiter', () => {
    it('does NOT rate-limit GET /api/auth/session', async () => {
      // GET /api/auth/session is hit on every page load — it must
      // never charge the auth budget. Ten polls in quick succession
      // should never 429 and should NOT carry X-RateLimit-Limit (the
      // limiter never ran for this path).
      const ip = '198.51.100.70';
      for (let i = 0; i < BUDGET + 5; i++) {
        const res = await SELF.fetch('http://localhost/api/auth/session', {
          headers: { 'cf-connecting-ip': ip },
        });
        expect(res.status).not.toBe(429);
        // The auth limiter must not run on /session — so the
        // X-RateLimit-Limit header it would set must be absent.
        expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
        await res.text();
      }
    });

    it('does NOT rate-limit POST /api/auth/sign-out', async () => {
      // sign-out is a session-mutating endpoint, not a brute-force
      // surface, and is excluded from the canonical Set on purpose.
      const ip = '198.51.100.71';
      for (let i = 0; i < BUDGET + 2; i++) {
        const res = await SELF.fetch('http://localhost/api/auth/sign-out', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'cf-connecting-ip': ip,
          },
          body: '{}',
        });
        expect(res.status).not.toBe(429);
        expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
        await res.text();
      }
    });

    it('does NOT rate-limit GET on a canonical path (method-gated)', async () => {
      // The limiter only fires for POST. A GET to /api/auth/sign-in/email
      // (which BetterAuth would 405) must not consume budget.
      const ip = '198.51.100.72';
      for (let i = 0; i < BUDGET + 2; i++) {
        const res = await SELF.fetch(
          'http://localhost/api/auth/sign-in/email',
          {
            method: 'GET',
            headers: { 'cf-connecting-ip': ip },
          }
        );
        expect(res.status).not.toBe(429);
        expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
        await res.text();
      }
    });
  });
});
