/**
 * GET /api/user/public/:username — route-level contract.
 *
 * This route did not exist. The three `creators.<host>/<username>` page loads
 * called it anyway, so every request 404'd into their `catch` and each
 * creator's public page rendered a placeholder for everyone.
 *
 * These assertions are deliberately DB-free, because they are the two things
 * that must hold before any query runs:
 *
 * 1. It is ANONYMOUS. Every other route in this worker is `auth: 'required'`,
 *    so the failure mode to guard is someone "tidying" this one into the same
 *    policy — which would 401 every visitor and restore the placeholder.
 * 2. Params are slug-validated. This is the only unauthenticated, enumerable
 *    surface in the worker; a non-slug username must be rejected by the schema
 *    rather than reaching Neon or occupying a cache slot.
 *
 * Runs in workerd via `cloudflare:test`.
 */

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const url = (name: string) =>
  `http://localhost/api/user/public/${encodeURIComponent(name)}`;

describe('GET /api/user/public/:username — anonymous access', () => {
  it('does NOT demand a session', async () => {
    const res = await SELF.fetch(url('alex-creator'));

    // The single most important property. 401 here means the route was
    // switched to an authenticated policy and every anonymous visitor to a
    // creator page is back to seeing a placeholder profile.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('is registered — a 404 carries the handler error, not Hono not-found', async () => {
    const res = await SELF.fetch(url('definitely-no-such-creator'));

    if (res.status === 404) {
      // Distinguishes "no such creator" (our NotFoundError, which travels
      // through mapErrorToResponse into the `{ error: { code, message } }`
      // envelope) from "no such route" (Hono's bare 404, no envelope). Before
      // this change, EVERY username got the bare one.
      const body = (await res.json()) as { error?: { message?: string } };
      expect(body.error).toBeDefined();
      expect(body.error?.message).toBe('Creator not found');
    } else {
      // A DB-backed environment may resolve or 500; either way the route ran.
      expect(res.status).not.toBe(401);
    }
  });
});

describe('GET /api/user/public/:username — input validation', () => {
  // Rejected by `publicProfileParamsSchema` before the handler, so no DB
  // query and no cache slot for arbitrary path input.
  for (const bad of [
    'Not A Slug',
    'has_underscores',
    'trailing-',
    'sym$bol',
    'a'.repeat(51),
  ]) {
    it(`rejects ${JSON.stringify(bad.slice(0, 24))} with 400`, async () => {
      const res = await SELF.fetch(url(bad));
      expect(res.status).toBe(400);
    });
  }

  it('accepts a well-formed slug (not a validation error)', async () => {
    const res = await SELF.fetch(url('alex-creator-2'));
    expect(res.status).not.toBe(400);
  });

  it('NORMALISES case rather than rejecting it', async () => {
    // `createSlugSchema` lowercases BEFORE applying its regex, so an
    // uppercase handle is not a validation error — it is the same handle.
    // Asserted explicitly because the first draft of this test expected a
    // 400 and was wrong: profile URLs are case-insensitive, which is the
    // better contract (people type `/@Alex-Creator`), and it is what makes
    // the service's lowercased cache key correct rather than merely
    // defensive — both casings share one slot instead of fragmenting the
    // version namespace.
    const res = await SELF.fetch(url('ALEX-CREATOR'));
    expect(res.status).not.toBe(400);
  });
});
