/**
 * Studio auth guard — the deep link survives sign-in, and the target is SAFE.
 *
 * Measured before the change: requesting `/studio/journeys/<id>/page` while
 * signed out returned `{"type":"redirect","location":"/login?redirect=/studio"}`
 * — the builder path was discarded, so signing in landed on the studio dashboard
 * and the creator had to navigate back.
 *
 * The interesting half of this is not the happy path. Putting an
 * attacker-influenced value into a `redirect=` parameter on the SIGN-IN path is
 * how open redirects become credential-phishing links, so the rejection cases are
 * tested explicitly and by name. The one that is easy to miss: a request for
 * `//evil.example/x` on this host parses to the PATHNAME `//evil.example/x`, and
 * a browser handed that as a redirect target reads it as a protocol-relative URL
 * and leaves the origin. `url.pathname` is not a safe value merely because it came
 * from a `URL`.
 *
 * The load itself is not exercised here — it needs a membership API, a remote
 * query and a parent layout — so the module is imported for its `_`-prefixed
 * helper only, with the two module-scope imports that would otherwise reach the
 * network stubbed out.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// `$lib/remote/org.remote` builds a remote `query()` at module scope, which needs
// the SvelteKit app hooks that a unit test has no access to; `$lib/server/api`
// and the timer-shaped logger are stubbed for the same reason. None of them is
// reached by the function under test — they are import-time weight, not
// behaviour.
vi.mock('$lib/remote/org.remote', () => ({
  getMyOrganizations: vi.fn(async () => []),
}));
vi.mock('$lib/server/api', () => ({
  createServerApi: () => ({
    org: { getMyMembership: vi.fn() },
    content: { list: vi.fn() },
  }),
}));
vi.mock('$lib/observability', () => ({
  logger: {
    startTimer: vi.fn(() => ({ end: vi.fn() })),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { _safeStudioRedirect } = await import('../+layout.server');

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD_SOURCE = readFileSync(
  join(HERE, '..', '+layout.server.ts'),
  'utf8'
);

/** The host the studio is actually served from in local dev. */
const ORIGIN = 'http://of-blood-and-bones.lvh.me:3010';

describe('_safeStudioRedirect — the deep link is preserved', () => {
  it('keeps the full builder path, which is the whole point', () => {
    const url = new URL(
      '/studio/journeys/bf965d70-1d6e-40b5-b313-4e48f7f2eebe/page',
      ORIGIN
    );
    expect(_safeStudioRedirect(url)).toBe(
      '/studio/journeys/bf965d70-1d6e-40b5-b313-4e48f7f2eebe/page'
    );
  });

  it('keeps the query string — "View live" uses ?preview=1', () => {
    const url = new URL('/studio/journeys/abc/page?preview=1&tab=look', ORIGIN);
    expect(_safeStudioRedirect(url)).toBe(
      '/studio/journeys/abc/page?preview=1&tab=look'
    );
  });

  it('keeps a plain /studio request unchanged', () => {
    expect(_safeStudioRedirect(new URL('/studio', ORIGIN))).toBe('/studio');
  });

  it('never carries the origin, the scheme or the host', () => {
    const out = _safeStudioRedirect(new URL('/studio/brand', ORIGIN));
    expect(out).not.toContain('http');
    expect(out).not.toContain('lvh.me');
    expect(out.startsWith('/')).toBe(true);
  });
});

describe('_safeStudioRedirect — the rejection cases, by name', () => {
  it('rejects a PROTOCOL-RELATIVE pathname, the one that actually leaves the site', () => {
    // HOW THIS SHAPE ARRIVES, corrected after getting it wrong once: resolving
    // the RELATIVE reference '//evil.example/x' against this origin does NOT
    // produce it — a leading '//' in a relative reference is a scheme-relative
    // URL, so it resolves to http://evil.example/x with the pathname '/x'. The
    // shape only exists when the doubled slash is part of an ABSOLUTE url's own
    // path, which is exactly what `GET //evil.example/x HTTP/1.1` gives the
    // server.
    expect(new URL('//evil.example/x', ORIGIN).pathname).toBe('/x');

    const url = new URL(`${ORIGIN}//evil.example/x`);
    expect(url.pathname).toBe('//evil.example/x');
    expect(url.origin).toBe(ORIGIN);
    expect(_safeStudioRedirect(url)).toBe('/studio');
  });

  it('rejects a backslash-prefixed pathname — some browsers read /\\host the same way', () => {
    const url = new URL(ORIGIN);
    // Assigning the pathname directly is how a proxy or a hand-built URL can
    // produce this shape; the guard must not depend on how it arrived.
    url.pathname = '/\\evil.example/x';
    expect(_safeStudioRedirect(url)).toBe('/studio');
  });

  it('rejects a bare "/" — nothing to deep-link to, and it is not the studio', () => {
    expect(_safeStudioRedirect(new URL('/', ORIGIN))).toBe('/studio');
  });

  it('cannot be made to emit an absolute URL by an absolute request', () => {
    // A URL is always split into origin + pathname, so an "absolute" target can
    // only ever reach this function as a path. Pinned so a future refactor that
    // starts reading `url.href` or a raw header fails here.
    const url = new URL('https://evil.example/studio/journeys/x/page');
    const out = _safeStudioRedirect(url);
    expect(out).toBe('/studio/journeys/x/page');
    expect(out).not.toContain('evil.example');
  });

  it('the value is URL-ENCODED into the parameter, so a path cannot inject one', () => {
    // The guard returns a path; the load encodes it. A '#' or '&' in the path
    // would otherwise truncate or extend the login URL's own query.
    const url = new URL(ORIGIN);
    url.pathname = '/studio/journeys/a&next=/x';
    const target = _safeStudioRedirect(url);
    const login = `/login?redirect=${encodeURIComponent(target)}`;
    expect(login).toBe(
      '/login?redirect=%2Fstudio%2Fjourneys%2Fa%26next%3D%2Fx'
    );
    // …and it round-trips to exactly the path asked for.
    expect(new URL(login, ORIGIN).searchParams.get('redirect')).toBe(target);
  });
});

describe('the guard is wired to the request, not to a constant', () => {
  it('the load no longer hard-codes /login?redirect=/studio', () => {
    // The exact string the guard used to emit. Its absence is the fix, and the
    // regression is someone "simplifying" the redirect back to a constant.
    expect(GUARD_SOURCE).not.toContain("'/login?redirect=/studio'");
    expect(GUARD_SOURCE).toContain('_safeStudioRedirect(url)');
    expect(GUARD_SOURCE).toContain('encodeURIComponent(');
  });

  it('the load destructures `url`, so the target is the request’s own path', () => {
    const load = GUARD_SOURCE.slice(
      GUARD_SOURCE.indexOf('export const load'),
      GUARD_SOURCE.indexOf('=> {', GUARD_SOURCE.indexOf('export const load'))
    );
    expect(load).toContain('url');
  });
});
