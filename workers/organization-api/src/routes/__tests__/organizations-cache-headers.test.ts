/**
 * `Cache-Control` at the HTTP boundary of the organizations router
 * (Codex-1j5fw · WP3).
 *
 * WHY THIS FILE EXISTS AT ALL. `organizations.ts` mounts 13 `procedure()` routes
 * and only 5 of them are public. The obvious way to give the public five a
 * shared-cache header — the way `public.ts` and `journeys.ts` both did it — is a
 * router-wide `app.use('*')`. Here that would stamp `public, max-age=60,
 * s-maxage=60` on EIGHT AUTHENTICATED RESPONSES, including
 * `/my-organizations`, whose entire body is "which organizations does the
 * caller belong to". Shared caches key on URL and NEVER on Cookie, so the first
 * signed-in member's org list would be served to every subsequent visitor to
 * that URL. There is deliberately no wildcard mount in that file; cacheability
 * is declared per route as `policy.cache` and emitted centrally by
 * `procedure()`. This file is the assertion that the split holds on the wire.
 *
 * NOT-VACUOUS DISCIPLINE (the reason every case asserts a VALUE). A
 * `.not.toContain('public')` check against a header that turns out to be ABSENT
 * passes for the wrong reason and would keep passing if the emit were deleted
 * outright. `procedure()` now emits a preset on every success path, so each
 * authenticated case pins the exact `private, no-cache` string FIRST and only
 * then adds the negative form — the negative is there to name the hazard, the
 * positive is what makes it fail when the hazard returns.
 *
 * TEST SHAPE mirrors `workers/content-api/src/routes/__tests__/journeys-routes.test.ts`:
 * the REAL `procedure()` resolver runs (memory procedure_mock_hides_resolver_bugs
 * — a mocked procedure cannot tell you what header reaches the client), the
 * router is mounted on a Hono app and driven through `app.fetch()` with a real
 * `ExecutionContext` so the KV cache-aside writes on the public reads drain, and
 * exactly two seams are stubbed: a middleware pre-sets `c.set('user', …)` so the
 * real session middleware early-returns, and the service classes the registry
 * constructs are replaced with spies so no Neon call fires.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Service spies ───────────────────────────────────────────────────────────

const orgSpies = {
  getBySlug: vi.fn(),
  getPublicStats: vi.fn(),
  getPublicCreators: vi.fn(),
  getPublicMembers: vi.fn(),
  getUserOrganizations: vi.fn(),
  isSlugAvailable: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@codex/organization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/organization')>();
  return {
    ...actual,
    OrganizationService: vi.fn(() => orgSpies),
  };
});

// `/public/:slug` and `/public/:slug/info` do not go through the service
// registry — `fetchPublicOrgInfo` constructs these two directly.
const brandingSpies = { get: vi.fn() };
const featureSpies = { get: vi.fn() };

vi.mock('@codex/platform-settings', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@codex/platform-settings')>();
  return {
    ...actual,
    BrandingSettingsService: vi.fn(() => brandingSpies),
    FeatureSettingsService: vi.fn(() => featureSpies),
  };
});

// Imported AFTER the mocks so the real registry resolves the mocked classes.
import organizations from '../organizations';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER = {
  id: '7a1d0f2e-3b4c-4d5e-8f60-112233445566',
  email: 'creator@test.com',
  role: 'creator',
};
const ORG_ID = '3c111111-1111-4111-8111-111111111111';
const SLUG = 'studio-alpha';

/** The two presets these 13 routes resolve to. Exact strings, not substrings. */
const PUBLIC_60 = 'public, max-age=60, s-maxage=60';
const PRIVATE = 'private, no-cache';

const ORG_ROW = {
  id: ORG_ID,
  slug: SLUG,
  name: 'Studio Alpha',
  description: null,
};

const EMPTY_PAGE = {
  items: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
};

const testEnv = {
  ...env,
  ENVIRONMENT: 'test',
} as unknown as typeof env;

function buildApp(user: Record<string, unknown> | null) {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    if (user) {
      c.set('user', user);
      c.set('session', { id: 'sess_test', userId: user.id });
    }
    await next();
  });
  app.route('/api/organizations', organizations);
  return app;
}

async function dispatch(
  app: ReturnType<typeof buildApp>,
  path: string
): Promise<Response> {
  const ec = createExecutionContext();
  const res = await app.fetch(
    new Request(`http://organization-api.test${path}`, { method: 'GET' }),
    testEnv,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  orgSpies.getBySlug.mockResolvedValue(ORG_ROW);
  orgSpies.getPublicStats.mockResolvedValue({
    contentCounts: { video: 0, audio: 0, written: 0 },
    totalDurationSeconds: 0,
    creatorCount: 0,
    totalViews: 0,
  });
  orgSpies.getPublicCreators.mockResolvedValue(EMPTY_PAGE);
  orgSpies.getPublicMembers.mockResolvedValue(EMPTY_PAGE);
  orgSpies.getUserOrganizations.mockResolvedValue([]);
  orgSpies.isSlugAvailable.mockResolvedValue(true);
  orgSpies.get.mockResolvedValue(ORG_ROW);
  brandingSpies.get.mockResolvedValue({});
  featureSpies.get.mockResolvedValue({ enableSubscriptions: true });
});

// ─── The public five ─────────────────────────────────────────────────────────

describe('the 5 auth:none public reads declare cache: public', () => {
  it.each([
    ['/public/:slug (branding)', `/api/organizations/public/${SLUG}`],
    ['/public/:slug/info', `/api/organizations/public/${SLUG}/info`],
    ['/public/:slug/stats', `/api/organizations/public/${SLUG}/stats`],
    ['/public/:slug/creators', `/api/organizations/public/${SLUG}/creators`],
    ['/public/:slug/members', `/api/organizations/public/${SLUG}/members`],
  ])('%s carries the shared-cache header', async (_name, path) => {
    const res = await dispatch(buildApp(null), path);

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(PUBLIC_60);
  });

  it('a public read is byte-identical for an anonymous and a signed-in caller', async () => {
    // `auth: 'none'` means the session is never resolved, which is what makes
    // `public` a true statement and not merely a convenient one. If a cookie
    // could change this body, a CDN keying on URL alone would serve one
    // viewer's copy to the next.
    const anon = await dispatch(
      buildApp(null),
      `/api/organizations/public/${SLUG}/members`
    );
    const signedIn = await dispatch(
      buildApp(USER),
      `/api/organizations/public/${SLUG}/members`
    );

    expect(anon.headers.get('Cache-Control')).toBe(PUBLIC_60);
    expect(signedIn.headers.get('Cache-Control')).toBe(PUBLIC_60);
    expect(await anon.text()).toBe(await signedIn.text());
  });

  it('pagination rides the query string, so two pages are two cache keys', async () => {
    // The header is identical on both, which is only safe because a shared cache
    // keys on the FULL URL. Asserted so nobody "simplifies" page/limit into a
    // header or a body field later.
    const p1 = await dispatch(
      buildApp(null),
      `/api/organizations/public/${SLUG}/creators?page=1&limit=10`
    );
    const p2 = await dispatch(
      buildApp(null),
      `/api/organizations/public/${SLUG}/creators?page=2&limit=10`
    );

    expect(p1.headers.get('Cache-Control')).toBe(PUBLIC_60);
    expect(p2.headers.get('Cache-Control')).toBe(PUBLIC_60);
    expect(orgSpies.getPublicCreators).toHaveBeenNthCalledWith(1, SLUG, {
      page: 1,
      limit: 10,
    });
    expect(orgSpies.getPublicCreators).toHaveBeenNthCalledWith(2, SLUG, {
      page: 2,
      limit: 10,
    });
  });
});

// ─── The authenticated eight (the mis-scoping hazard) ────────────────────────

describe('CACHE POISONING GUARD: the authenticated reads are never shared-cacheable', () => {
  it('/my-organizations — the caller OWN org list — is private, and the header exists', async () => {
    // THE canonical case for this whole WP. A router-wide `app.use('*')` here
    // would have marked this body publicly cacheable, and it is the single most
    // per-viewer response in the file: `getUserOrganizations(ctx.user.id)`.
    const res = await dispatch(
      buildApp(USER),
      '/api/organizations/my-organizations'
    );

    expect(res.status).toBe(200);
    // Positive FIRST: proves the header is present, so the negative below cannot
    // pass by absence.
    expect(res.headers.get('Cache-Control')).toBe(PRIVATE);
    expect(res.headers.get('Cache-Control') ?? '').not.toContain('public');
    expect(res.headers.get('Cache-Control') ?? '').not.toContain('s-maxage');
    expect(orgSpies.getUserOrganizations).toHaveBeenCalledWith(USER.id);
  });

  it.each([
    ['/check-slug/:slug', `/api/organizations/check-slug/${SLUG}`],
    ['/slug/:slug', `/api/organizations/slug/${SLUG}`],
    ['/:id', `/api/organizations/${ORG_ID}`],
  ])('the auth:required read %s declares nothing and defaults to private', async (_name, path) => {
    const res = await dispatch(buildApp(USER), path);

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(PRIVATE);
    expect(res.headers.get('Cache-Control') ?? '').not.toContain('public');
  });

  it('the public/authenticated split is a per-route fact, not a path-prefix one', async () => {
    // `/public/:slug` and `/:id` differ by one path segment and by five orders
    // of magnitude of blast radius. Any scheme that derives cacheability from
    // the path — a wildcard mount, a prefix pattern, an allow-list of literal
    // pathnames — has to re-encode this boundary somewhere other than the route.
    const pub = await dispatch(
      buildApp(null),
      `/api/organizations/public/${SLUG}/members`
    );
    const priv = await dispatch(buildApp(USER), `/api/organizations/${ORG_ID}`);

    expect(pub.headers.get('Cache-Control')).toBe(PUBLIC_60);
    expect(priv.headers.get('Cache-Control')).toBe(PRIVATE);
    expect(pub.headers.get('Cache-Control')).not.toBe(
      priv.headers.get('Cache-Control')
    );
  });
});
