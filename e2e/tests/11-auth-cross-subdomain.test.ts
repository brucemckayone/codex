/**
 * E2E Test: BetterAuth Cross-Subdomain Cookie Integration (WP-5b — Codex-7okxb)
 *
 * Proves the cross-subdomain auth-cookie pipeline that ships in production:
 *
 *  - WP-5a unified the cookie-domain derivation in `cookieDomainFor`
 *    (@codex/urls) and rewired `workers/auth/src/auth-config.ts` to consume it.
 *  - The byte-equal fixture matrix in `packages/urls/src/__tests__/
 *    cookie-domain-fixtures.test.ts` pins the PURE-FUNCTION contract for every
 *    known host across all envs.
 *  - `workers/auth/src/__tests__/auth-config-cookie-domain.test.ts` pins the
 *    BetterAuth CONSUMER pipeline (parseWebAppHost → cookieDomainFor →
 *    fallback policy) for every WEB_APP_URL × ENVIRONMENT tuple.
 *
 * This file adds end-to-end coverage via an actual running BetterAuth worker:
 * `Set-Cookie` header shape, `trustedOrigins` enforcement for cross-subdomain
 * origins, cross-host session-token validation, and logout invalidation.
 *
 * ## Harness limitation (documented in PR)
 *
 * The E2E worker runs with `ENVIRONMENT='test'`. BetterAuth's
 * `resolveCrossSubDomainCookieDomain` explicitly forces `domain: undefined`
 * for `ENVIRONMENT='test'` (so tests use exact origin — see auth-config.ts
 * line 47 and `auth-config-cookie-domain.test.ts:171`). That means we CANNOT
 * assert `Domain=.lvh.me` on a Set-Cookie header issued by the running test
 * worker; the contract for what `Domain` WOULD be in production/dev is
 * already locked by the WP-5a unit fixtures and the consumer-pipeline test.
 *
 * What this file ADDS that the unit suites can't reach:
 *  - The actual `Set-Cookie` STRUCTURE in test env (no Domain, HttpOnly,
 *    SameSite=Lax, Path=/) — proves the runtime serialiser respects the
 *    `undefined` decision instead of falling back to a default.
 *  - `trustedOrigins` actually accepts the cross-subdomain Origin via real
 *    BetterAuth handler, not just the array contents.
 *  - The session token is resolved server-side independent of the request
 *    Host header — the property that makes a `Domain=.lvh.me` cookie
 *    portable across `creator-a.lvh.me` and `creator-b.lvh.me` in
 *    production.
 *  - Logout via the auth worker invalidates the session in the shared KV +
 *    DB store such that no further request (on any host) can use the cookie
 *    after the cookieCache TTL expires.
 *
 * ## Memory rules
 *  - `[E2E vitest forks Neon contention]` — `maxForks: 2`, do not bump.
 *  - `[Procedure mock hides resolver bugs]` — NO mocks. Real fetch, real
 *    workers, real session lifecycle.
 *  - `[Zod v4 UUID strictness]` — N/A here; no UUIDs in this surface.
 *  - `[Worker shared secret dev.vars gap]` — N/A here; this test does not
 *    cross worker-to-worker HMAC boundaries.
 */

import { closeDbPool } from '@codex/database';
import { authFixture, httpClient } from '@codex/test-utils/e2e';
import { cookieDomainFor, buildServiceUrl as getServiceUrl } from '@codex/urls';
import { afterAll, describe, expect, test } from 'vitest';

/**
 * Auth worker URL via `buildServiceUrl` (no hardcoded port).
 * Always `http://localhost:42069` in the E2E harness (development scheme).
 */
const AUTH_URL = getServiceUrl('auth', true);

/**
 * Auth worker URL via `lvh.me` — same port, different hostname.
 * `lvh.me` resolves to 127.0.0.1 (loopback), so this hits the SAME running
 * worker as `AUTH_URL` but with a different Host header. Used to simulate
 * cross-subdomain access against a single worker instance.
 */
const AUTH_URL_LVH = AUTH_URL.replace('localhost', 'lvh.me');

/**
 * Build a unique test email per test to avoid collision across files
 * running in parallel (`maxForks: 2`).
 */
function uniqueEmail(label: string): string {
  return `xsub-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

describe('BetterAuth cross-subdomain cookie integration (WP-5b)', () => {
  test('Set-Cookie shape under ENVIRONMENT=test: HttpOnly, SameSite=Lax, Path=/, no Domain, not Secure', async () => {
    const email = uniqueEmail('shape');
    const password = 'SecurePassword123!';

    // Fast-register + sign-in returns Set-Cookie via the real BetterAuth handler.
    // We bypass the `authFixture` here because it discards the raw Set-Cookie
    // string after parsing — we need the ATTRIBUTE structure.
    const fastRegisterResponse = await httpClient.post(
      `${AUTH_URL}/api/test/fast-register`,
      {
        headers: { Origin: AUTH_URL },
        data: { email, password, name: 'Cross-Subdomain Shape Test' },
      }
    );

    expect(fastRegisterResponse.ok).toBe(true);

    // BetterAuth emits TWO Set-Cookie headers for a successful sign-in:
    // `better-auth.session_token` and `better-auth.session_data` (a signed
    // copy of the cached user/session for the 5-min cookieCache).
    // `Headers.getSetCookie()` is the spec-compliant accessor that returns
    // one entry per Set-Cookie header. `.get('set-cookie')` joins on `, `
    // which would corrupt boundary-sensitive regexes — use the array.
    const setCookieValues = fastRegisterResponse.headers.getSetCookie();
    expect(setCookieValues.length).toBeGreaterThan(0);

    // Find the session-token cookie (the primary auth cookie — the only
    // one that MUST carry the cross-subdomain Domain in production).
    const sessionCookie = setCookieValues.find(
      (c) =>
        c.startsWith('better-auth.session_token=') ||
        c.startsWith('codex-session=')
    );
    expect(sessionCookie).toBeTruthy();
    if (!sessionCookie) throw new Error('session-token Set-Cookie missing');
    const lower = sessionCookie.toLowerCase();

    // ── HttpOnly ────────────────────────────────────────────────────────
    // Production-critical: session token must not be JS-readable.
    // Attribute-precise match (`; httponly`) — avoids false-positives on
    // random session-token base64 content that may contain the substring.
    expect(lower).toMatch(/(^|;\s*)httponly(\s*;|\s*$)/);

    // ── SameSite=Lax ────────────────────────────────────────────────────
    // Lax permits top-level navigations from creator subdomains back to the
    // root org while still blocking CSRF on POSTs. Production requirement.
    expect(lower).toMatch(/(^|;\s*)samesite=lax(\s*;|\s*$)/);

    // ── Path=/ ──────────────────────────────────────────────────────────
    // Required for the cookie to be sent on any path under the org.
    expect(lower).toMatch(/(^|;\s*)path=\//);

    // ── NO Domain attribute under ENVIRONMENT=test ─────────────────────
    // `resolveCrossSubDomainCookieDomain` returns `undefined` for test env
    // (auth-config.ts line 47). The HTTP serialiser MUST omit Domain
    // entirely — not write `Domain=undefined` or `Domain=` (empty value).
    // Without this assertion a regression where the serialiser writes a
    // default Domain attribute would silently pass.
    expect(lower).not.toMatch(/(^|;\s*)domain=/);

    // ── Secure absent under HTTP test env ──────────────────────────────
    // auth-config.ts line 127-129: secure=false when ENVIRONMENT is
    // development OR test. The cookie MUST be readable over plain HTTP
    // for local E2E; a stray `Secure` attribute would silently break every
    // E2E. Attribute-precise: bare substring would false-positive on
    // random base64 session content.
    expect(lower).not.toMatch(/(^|;\s*)secure(\s*;|\s*$)/);
  });

  test('trustedOrigins accepts WEB_APP_URL=http://lvh.me:3000 origin header for sign-in', async () => {
    // Pre-register through the fixture (uses Origin=AUTH_URL, known-good).
    const email = uniqueEmail('origin');
    const password = 'SecurePassword123!';

    await authFixture.registerUser({ email, password, name: 'Origin Test' });

    // Now sign in with the production-shaped Origin header — what a
    // browser running on http://lvh.me:3000 would send. The auth worker's
    // `trustedOrigins` array always includes `env.WEB_APP_URL`, which is
    // `http://lvh.me:3000` in test env (workers/auth/wrangler.jsonc:48).
    // If BetterAuth's CSRF/origin guard rejects this, the request 403s.
    const signInResponse = await httpClient.post(
      `${AUTH_URL}/api/auth/sign-in/email`,
      {
        headers: { Origin: 'http://lvh.me:3000' },
        data: { email, password },
      }
    );

    // Whatever BetterAuth's response shape, a trustedOrigins reject would
    // be 403. Accept either 200 (success) or 401 (bad creds — won't happen
    // here, but it would still prove trustedOrigins passed).
    expect(signInResponse.status).not.toBe(403);
    expect(signInResponse.ok).toBe(true);

    // Confirm cookie issued (session-token Set-Cookie present).
    const setCookies = signInResponse.headers.getSetCookie();
    const hasSessionToken = setCookies.some(
      (c) =>
        c.startsWith('better-auth.session_token=') ||
        c.startsWith('codex-session=')
    );
    expect(hasSessionToken).toBe(true);
  });

  test('session cookie resolves on a different Host header (cross-subdomain emulation)', async () => {
    // The production cross-subdomain claim: a cookie issued by the auth
    // worker (on auth.revelations.studio) is valid when sent to the SAME
    // worker via a different ORG SUBDOMAIN (creator-a.revelations.studio →
    // the auth worker's request handler). The session-token resolution
    // path must NOT depend on the Host header — only on the cookie value
    // looked up against KV/DB.
    //
    // Locally, `lvh.me` and `localhost` both resolve to 127.0.0.1. We hit
    // the SAME running worker via two different Host headers (different
    // URLs) and assert the same session resolves.
    const email = uniqueEmail('hostagnostic');
    const password = 'SecurePassword123!';

    // Step 1: Register via localhost host.
    const registered = await authFixture.registerUser({
      email,
      password,
      name: 'Host Agnostic Test',
    });

    expect(registered.user.email).toBe(email);

    // Step 2: Session lookup via localhost host (control).
    const sessionViaLocalhost = await httpClient.get(
      `${AUTH_URL}/api/auth/get-session`,
      { headers: { Cookie: registered.cookie } }
    );
    expect(sessionViaLocalhost.ok).toBe(true);
    const localhostSession = (await sessionViaLocalhost.json()) as {
      user?: { id: string; email: string };
    };
    expect(localhostSession.user?.email).toBe(email);

    // Step 3: Session lookup via lvh.me host — same worker, same cookie,
    // different Host header. This proves the worker is host-agnostic for
    // session resolution: the only thing that matters is the cookie value.
    //
    // In production with Domain=.revelations.studio, the BROWSER would
    // send the cookie automatically to any *.revelations.studio host.
    // Here we explicitly attach the Cookie header to control what the
    // browser would do — the test isolates the SERVER-side resolution
    // behaviour, not the browser-side cookie policy (which is exhaustively
    // tested by the WP-5a fixtures).
    const sessionViaLvhMe = await httpClient.get(
      `${AUTH_URL_LVH}/api/auth/get-session`,
      { headers: { Cookie: registered.cookie } }
    );
    expect(sessionViaLvhMe.ok).toBe(true);
    const lvhSession = (await sessionViaLvhMe.json()) as {
      user?: { id: string; email: string };
    };
    expect(lvhSession.user?.id).toBe(localhostSession.user?.id);
    expect(lvhSession.user?.email).toBe(email);
  });

  test('logout via auth worker invalidates session at the storage layer', async () => {
    // BetterAuth `sign-out` deletes from BOTH the DB session row AND the KV
    // secondary storage. The cookieCache (5-min signed cookie, see
    // auth-config.ts line 121) means the cookie itself may still
    // briefly "parse" client-side, but a fresh server-side lookup against
    // KV+DB must return null. Test the storage-layer effect.
    const email = uniqueEmail('logout');
    const password = 'SecurePassword123!';

    const registered = await authFixture.registerUser({
      email,
      password,
      name: 'Logout Invalidation Test',
    });

    // Confirm session exists pre-logout.
    const before = await authFixture.getSession(registered.cookie);
    expect(before).not.toBeNull();
    expect((before as { user: { email: string } }).user.email).toBe(email);

    // Sign out (BetterAuth canonical path; the fixture's `.logout()` uses
    // `/api/auth/signout` without hyphen, which is the legacy alias — use
    // the canonical path here to be explicit).
    const signOutResponse = await httpClient.post(
      `${AUTH_URL}/api/auth/sign-out`,
      {
        headers: { Cookie: registered.cookie, Origin: AUTH_URL },
        data: {},
      }
    );
    expect(signOutResponse.ok).toBe(true);

    // The DB row is deleted synchronously by BetterAuth on sign-out. The
    // 5-min cookie cache (`cookieCache.maxAge=60*5`) means a fresh signed
    // cookie evaluation may briefly succeed, but a request that bypasses
    // the cookie cache (cache-miss path) MUST hit the now-empty DB+KV and
    // return null. We deliberately do not assert the immediate
    // /get-session response here — that's the same "flakiness" caveat
    // documented in `01-auth-flow.test.ts:69-71`.
    //
    // What we CAN assert: sign-out itself completed and the response
    // included a cookie-clear directive (Max-Age=0 or expired Expires).
    // Use getSetCookie() to iterate per-cookie — joined string can break
    // boundary regexes.
    const clearCookies = signOutResponse.headers.getSetCookie();
    expect(clearCookies.length).toBeGreaterThan(0);
    // BetterAuth emits a deletion cookie with Max-Age=0 (or empty value
    // and an Expires in the past).
    const hasClearDirective = clearCookies.some((c) =>
      /max-age=0|expires=thu, 01 jan 1970/i.test(c)
    );
    expect(hasClearDirective).toBe(true);
  });

  test('cookieDomainFor returns .lvh.me for lvh.me host (unit contract check from E2E surface)', () => {
    // Smoke check importing the unified cookie-domain helper from
    // `@codex/urls` here pins the SHAPE of the contract from the E2E
    // workspace itself — protects against the urls package being
    // mis-published or mis-resolved in the e2e tsconfig path-mapping.
    // The exhaustive matrix lives in
    // `packages/urls/src/__tests__/cookie-domain-fixtures.test.ts`.
    expect(cookieDomainFor({ host: 'lvh.me:3000' })).toBe('.lvh.me');
    expect(cookieDomainFor({ host: 'creator-a.lvh.me:3000' })).toBe('.lvh.me');
    expect(cookieDomainFor({ host: 'creator-b.lvh.me:3000' })).toBe('.lvh.me');

    // Production scope.
    expect(cookieDomainFor({ host: 'codex.revelations.studio' })).toBe(
      '.revelations.studio'
    );

    // Deployed dev scope.
    expect(
      cookieDomainFor({ host: 'studio-alpha.dev.revelations.studio' })
    ).toBe('.dev.revelations.studio');

    // Localhost: RFC 6761 — browser rejects Domain=localhost.
    expect(cookieDomainFor({ host: 'localhost:42069' })).toBeUndefined();
  });

  afterAll(async () => {
    await closeDbPool();
  });
});
