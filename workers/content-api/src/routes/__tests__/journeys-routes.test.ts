/**
 * Route-layer HTTP-boundary tests for the journey member-surface endpoints
 * (Codex-2pryk · Round-D · Codex-776gg).
 *
 * These run against the REAL `procedure()` resolver (NOT mocked — memory
 * procedure_mock_hides_resolver_bugs). The routes are mounted on a Hono app and
 * driven via `app.fetch()` with a genuine `ExecutionContext` so `procedure`'s
 * `waitUntil` cleanup runs. Two seams are stubbed, matching the established
 * `connect-me-routes` pattern:
 *
 *   1. The session: a middleware sets `c.set('user', …)` BEFORE the route so the
 *      real `authenticateSession()` early-returns and the rest of the resolver
 *      (validation → handler) runs for real. Injecting NO user exercises the
 *      real session middleware's 401 (auth:'required') / anonymous (auth:'optional')
 *      paths.
 *   2. `@codex/access`'s `ContentAccessService` + `CourseJourneyService` are
 *      replaced with spies so no Neon / R2 call fires. The real service registry
 *      still constructs them (proving the registry wiring), returning the spies.
 *
 * The env is doctored to `ENVIRONMENT=development` + `R2_PUBLIC_URL_BASE` so the
 * `access` registry getter takes its dev-signer branch and never throws building
 * an R2 client (we never sign — the service is a spy).
 *
 * Falsifiability (implement/tests-must-be-able-to-fail): the SUT is the real
 * route + real resolver; every assertion is unconditional. The gate tests
 * ("not entitled → journey service NOT called") fail if a route drops the
 * `canEnterCourse` gate; the anonymous canView test fails if the route stops
 * resolving an absent user to `null`.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Service spies (replace the real @codex/access classes) ──────────────────

const accessSpies = {
  canEnterCourse: vi.fn(),
  canView: vi.fn(),
  getStreamingUrl: vi.fn(),
};

const journeySpies = {
  listPublishedCourses: vi.fn(),
  getCourseBySlug: vi.fn(),
  getContentCourses: vi.fn(),
  getCoursePage: vi.fn(),
  getCourseSellPreview: vi.fn(),
  getCourseDashboard: vi.fn(),
  getInCoursePractice: vi.fn(),
  recordPracticeCompletion: vi.fn(),
  listEnrolledCourses: vi.fn(),
  // The member-discovery reads (Codex-oi2w4). Added with the cache/CDN wiring
  // (Codex-72k55) — the file previously covered `/courses` but not these two.
  listPublishedJourneys: vi.fn(),
  listEnrolledJourneys: vi.fn(),
};

vi.mock('@codex/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/access')>();
  return {
    ...actual,
    ContentAccessService: vi.fn(() => accessSpies),
    CourseJourneyService: vi.fn(() => journeySpies),
  };
});

/**
 * Route modules — two kinds, one block, because biome's `organizeImports` sorts
 * the whole run alphabetically and would orphan a comment attached to half of
 * it. Both kinds sit BELOW the `vi.mock` above (biome never moves an import
 * across a statement), which is what makes the real service registry resolve
 * the mocked `@codex/access` classes.
 *
 * `../x` — the mounted Hono routers this file drives via `app.fetch`.
 *
 * `../x.ts?raw` — the SAME files imported as TEXT with Vite's `?raw` (inlined at
 * build time, so it works under workerd where there is no `node:fs`; the same
 * technique the denoise proofs in workers/organization-api use). Never executed.
 * They exist so the carve-out guard at the bottom of this file can DISCOVER
 * which routes declare `variesBySession: false` instead of trusting a
 * hand-written list that only ever describes the day it was written. One per
 * `app.route(...)` in `src/index.ts`; the helper modules (`journeys-cache.ts`,
 * `public-cache.ts`, `category-space.ts`, `category-cover-url.ts`,
 * `content-cleanup.ts`) are excluded deliberately — they register no routes, so
 * they can hold no policy.
 */
import workerIndexSrc from '../../index.ts?raw';
import categoriesSrc from '../categories.ts?raw';
import contentSrc from '../content.ts?raw';
import contentAccess from '../content-access';
import contentAccessSrc from '../content-access.ts?raw';
import journeyInsightsSrc from '../journey-insights.ts?raw';
import journeys from '../journeys';
import journeysSrc from '../journeys.ts?raw';
import mediaSrc from '../media.ts?raw';
import publicSrc from '../public.ts?raw';

// ─── Fixtures (valid RFC4122 v4 UUIDs so uuidSchema accepts them) ─────────────

const USER = {
  id: '7a1d0f2e-3b4c-4d5e-8f60-112233445566',
  email: 'creator@test.com',
  role: 'creator',
};
const COURSE_ID = '2c000000-0000-4000-8000-000000000001';
const CONTENT_ID = '2c000000-0000-4000-8000-000000000101';
const ORG_ID = '3c111111-1111-4111-8111-111111111111';
const SLUG = 'rootwork';
const CONTENT_SLUG = 'welcome';

const COURSE_SUMMARY = {
  id: COURSE_ID,
  slug: SLUG,
  title: 'Rootwork',
  organizationSlug: 'studio-alpha',
};

// The `getContentCourses` projection (standalone content viewer cross-link).
const CONTENT_COURSES = { courses: [COURSE_SUMMARY] };

const DASHBOARD = {
  course: COURSE_SUMMARY,
  enrollment: {
    courseId: COURSE_ID,
    enrolledAt: '2026-07-20T00:00:00.000Z',
    lastActivityAt: null,
    completedAt: null,
  },
  stages: [],
  completions: [],
};

const ENROLLMENTS = [
  {
    course: {
      id: COURSE_ID,
      slug: SLUG,
      title: 'Rootwork',
      organizationSlug: 'studio-alpha',
      kicker: 'The foundation course',
      lede: null,
      guideName: 'The Guide',
      coverImageUrl: null,
    },
    enrollment: {
      courseId: COURSE_ID,
      enrolledAt: '2026-07-20T00:00:00.000Z',
      lastActivityAt: null,
      completedAt: null,
    },
    enrollmentSource: 'course_purchase',
    progress: {
      done: 4,
      total: 5,
      percent: 80,
      status: 'in-progress',
      lastCompletedAt: '2026-07-24T00:00:00.000Z',
      nextPracticeSlug: 'where-am-i-holding',
      nextPracticeTitle: 'Where am I holding?',
    },
  },
];

const MEDIA_PRACTICE = {
  course: COURSE_SUMMARY,
  stage: { id: '2c000000-0000-4000-8000-0000000000a1', name: 'Orientation' },
  practice: {
    contentId: CONTENT_ID,
    slug: CONTENT_SLUG,
    title: 'Welcome to the journey',
    contentType: 'video' as const,
    durationSeconds: 320,
    thumbnailUrl: null,
    sortOrder: 0,
  },
  streamingUrl: null,
  waveformUrl: null,
  bodyHtml: null,
  initialProgressSeconds: 0,
  playlist: [],
  completions: [],
};

const WRITTEN_PRACTICE = {
  ...MEDIA_PRACTICE,
  practice: {
    ...MEDIA_PRACTICE.practice,
    contentId: '2c000000-0000-4000-8000-000000000102',
    slug: 'set-your-intention',
    title: 'Set your intention',
    contentType: 'written' as const,
    durationSeconds: null,
  },
  bodyHtml: '<p>Set your intention.</p>',
};

const PAGE_ID = '2c000000-0000-4000-8000-0000000000f0';

// Public sales-page envelope (WP-3) — the `getCoursePage` projection.
const COURSE_PAGE = {
  page: {
    id: PAGE_ID,
    organizationId: ORG_ID,
    publishedAt: '2026-05-01T09:00:00.000Z',
    pageType: 'course',
    slug: SLUG,
    title: 'Rootwork',
    status: 'published' as const,
    subjectType: 'course',
    subjectId: COURSE_ID,
    brandOverrides: null,
    sections: [],
  },
  course: {
    id: COURSE_ID,
    slug: SLUG,
    title: 'Rootwork',
    kicker: null,
    lede: null,
    status: 'published' as const,
    priceCents: 4900,
    stageCount: 0,
    practiceCount: 0,
  },
  stages: [],
  testimonials: [],
};

// Public 30s sell-preview clips (WP-3 · SPEC §10) — the `getCourseSellPreview`
// projection (already resolved to CDN URLs; no signing).
const SELL_PREVIEW = {
  intro: {
    playlistUrl: 'http://localhost:4100/hls/intro-media/preview/preview.m3u8',
    posterUrl: 'http://localhost:4100/thumbnails/intro-media/thumb.jpg',
    durationSeconds: 90,
  },
  reel: {
    playlistUrl: 'http://localhost:4100/hls/reel-media/preview/preview.m3u8',
    posterUrl: null,
    durationSeconds: 30,
  },
};

const COMPLETION_RECORD = {
  contentId: CONTENT_ID,
  completedAt: '2026-07-24T00:00:00.000Z',
  source: 'manual' as const,
};

const STREAM_RESULT = {
  streamingUrl: 'https://api.test/api/access/content/x/hls/master.m3u8?token=t',
  waveformUrl: 'https://cdn.test/waveform.png',
  expiresAt: new Date('2026-07-24T00:10:00.000Z'),
  contentType: 'video' as const,
  readyVariants: ['1080p', '720p'],
};

// The public CDN base the sell-preview route forwards to the service (and that
// the `access` registry getter reads for its dev R2 signer). `ProvidedEnv` does
// not declare this optional binding, so it lives as a typed local the tests can
// both inject and assert against.
const R2_PUBLIC_URL_BASE = 'http://localhost:4100';

/**
 * `CACHE_KV` is the REAL Miniflare binding from wrangler.jsonc (Codex-e32xz).
 *
 * It used to be a hand-rolled in-memory Map. The reason was that
 * `VersionedCache.get` wrote its data slot as a bare floating promise: against
 * Miniflare's real KV that promise outlived the test, and `vitest-pool-workers`
 * isolated storage then failed to pop its stack frame ("IoContext timed out due
 * to inactivity, waitUntil tasks were cancelled" → "unable to pop KV storage").
 * `waitOnExecutionContext` could not help, because the write was never
 * registered on the execution context.
 *
 * That is exactly the production bug the stub was papering over — the same
 * cancellation gave `CACHE_KV_PRODUCTION` 62 version keys and 0 data keys, a
 * literal 0% hit rate. Now that the put IS registered on
 * `ctx.executionCtx.waitUntil`, `dispatch`'s `waitOnExecutionContext(ec)`
 * drains it before the test returns, the storage frame pops cleanly, and these
 * tests exercise real KV instead of a mock that could never reproduce the
 * failure.
 *
 * No manual reset is needed either: `isolatedStorage` (on by default) undoes
 * every KV write between tests.
 */
// The env the real `access` registry getter needs to build its dev R2 signer
// without touching a real bucket (the service is mocked, so nothing signs).
const testEnv = {
  ...env,
  ENVIRONMENT: 'development',
  R2_PUBLIC_URL_BASE,
} as unknown as typeof env;

/** Mount both journey route groups behind a user-injection middleware. */
function buildApp(user: Record<string, unknown> | null) {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    if (user) {
      c.set('user', user);
      c.set('session', { id: 'sess_test', userId: user.id });
    }
    await next();
  });
  app.route('/api/access', contentAccess);
  app.route('/api/journeys', journeys);
  return app;
}

/**
 * Drive one request against a mounted app.
 *
 * `envOverride` exists for the carve-out guard at the bottom of this file, which
 * has to take `CACHE_KV` AWAY: both carve-out routes are KV cache-aside, so with
 * the binding present the second of two identical requests is served from the
 * data slot and the two bodies match BY CONSTRUCTION, whatever the handler did
 * with the session. Every other caller keeps the real Miniflare binding.
 */
async function dispatch(
  app: ReturnType<typeof buildApp>,
  req: Request,
  envOverride: typeof env = testEnv
): Promise<Response> {
  const ec = createExecutionContext();
  const res = await app.fetch(req, envOverride, ec);
  await waitOnExecutionContext(ec);
  return res;
}

function getReq(path: string) {
  return new Request(`http://content-api.test${path}`, { method: 'GET' });
}

function postReq(path: string, body?: unknown) {
  return new Request(`http://content-api.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Discovery card summaries (SPEC §8.5) — the `listPublishedCourses` projection.
const COURSE_CARDS = [
  {
    id: COURSE_ID,
    slug: SLUG,
    title: 'Rootwork',
    kicker: 'A guided five-practice descent',
    lede: 'Return to the body you have been carrying.',
    guideName: 'Alex Creator',
    priceCents: 4900,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  // KV is NOT cleared here: `isolatedStorage` (vitest-pool-workers default)
  // rolls back every write between tests. A value primed by one test must not
  // survive into the next — the public portal reads are cache-aside, so a
  // leaked entry would silently satisfy the next read, the service spy would go
  // uncalled, and a "service called with …" assertion would fail for a reason
  // that has nothing to do with the route.
  accessSpies.canEnterCourse.mockResolvedValue(true);
  accessSpies.canView.mockResolvedValue(true);
  accessSpies.getStreamingUrl.mockResolvedValue(STREAM_RESULT);
  journeySpies.listPublishedCourses.mockResolvedValue(COURSE_CARDS);
  journeySpies.listPublishedJourneys.mockResolvedValue([]);
  journeySpies.listEnrolledJourneys.mockResolvedValue([]);
  journeySpies.getCourseBySlug.mockResolvedValue(COURSE_SUMMARY);
  journeySpies.getContentCourses.mockResolvedValue(CONTENT_COURSES);
  journeySpies.getCoursePage.mockResolvedValue(COURSE_PAGE);
  journeySpies.getCourseSellPreview.mockResolvedValue(SELL_PREVIEW);
  journeySpies.getCourseDashboard.mockResolvedValue(DASHBOARD);
  journeySpies.getInCoursePractice.mockResolvedValue(MEDIA_PRACTICE);
  journeySpies.recordPracticeCompletion.mockResolvedValue(COMPLETION_RECORD);
  journeySpies.listEnrolledCourses.mockResolvedValue(ENROLLMENTS);
});

// ─── GET /api/journeys/user/enrollments ──────────────────────────────────────

describe('GET /api/journeys/user/enrollments — member journeys shelf', () => {
  it('authenticated → 200 { data: enrollments }, service scoped to session id + orgId', async () => {
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/user/enrollments?organizationId=${ORG_ID}`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: ENROLLMENTS });
    // Third arg is the CDN base the service resolves each course's cover key
    // against — without it every library journey card reports a null cover
    // (Codex-tnwnu).
    expect(journeySpies.listEnrolledCourses).toHaveBeenCalledWith(
      USER.id,
      ORG_ID,
      R2_PUBLIC_URL_BASE
    );
  });

  it('IDOR: a DIFFERENT session scopes to THAT user id — never the other user, never a query param', async () => {
    const OTHER = {
      ...USER,
      id: '9b2e1f3a-4c5d-4e6f-8071-223344556677',
    };
    const res = await dispatch(
      buildApp(OTHER),
      getReq(`/api/journeys/user/enrollments?organizationId=${ORG_ID}`)
    );
    expect(res.status).toBe(200);
    expect(journeySpies.listEnrolledCourses).toHaveBeenCalledWith(
      OTHER.id,
      ORG_ID,
      R2_PUBLIC_URL_BASE
    );
    expect(journeySpies.listEnrolledCourses).not.toHaveBeenCalledWith(
      USER.id,
      ORG_ID,
      R2_PUBLIC_URL_BASE
    );
  });

  it('unauthenticated → 401, service NOT called', async () => {
    const res = await dispatch(
      buildApp(null),
      getReq(`/api/journeys/user/enrollments?organizationId=${ORG_ID}`)
    );
    expect(res.status).toBe(401);
    expect(journeySpies.listEnrolledCourses).not.toHaveBeenCalled();
  });

  it('missing organizationId → 400, service NOT called', async () => {
    const res = await dispatch(
      buildApp(USER),
      getReq('/api/journeys/user/enrollments')
    );
    expect(res.status).toBe(400);
    expect(journeySpies.listEnrolledCourses).not.toHaveBeenCalled();
  });

  it('non-uuid organizationId → 400, service NOT called', async () => {
    const res = await dispatch(
      buildApp(USER),
      getReq('/api/journeys/user/enrollments?organizationId=not-a-uuid')
    );
    expect(res.status).toBe(400);
    expect(journeySpies.listEnrolledCourses).not.toHaveBeenCalled();
  });
});

// ─── GET /api/access/courses/:courseId/can-enter ─────────────────────────────

describe('GET /api/access/courses/:courseId/can-enter — entitlement gate', () => {
  it('authenticated → 200 { data: { canEnter } }, resolver called with session id + courseId', async () => {
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/access/courses/${COURSE_ID}/can-enter`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { canEnter: true } });
    expect(accessSpies.canEnterCourse).toHaveBeenCalledWith(USER.id, COURSE_ID);
  });

  it('resolver denies → 200 { canEnter: false } (no throw, no leak)', async () => {
    accessSpies.canEnterCourse.mockResolvedValue(false);
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/access/courses/${COURSE_ID}/can-enter`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { canEnter: false } });
  });

  it('unauthenticated → 401, resolver NOT called', async () => {
    const res = await dispatch(
      buildApp(null),
      getReq(`/api/access/courses/${COURSE_ID}/can-enter`)
    );
    expect(res.status).toBe(401);
    expect(accessSpies.canEnterCourse).not.toHaveBeenCalled();
  });

  it('non-uuid courseId → 400, resolver NOT called', async () => {
    const res = await dispatch(
      buildApp(USER),
      getReq('/api/access/courses/not-a-uuid/can-enter')
    );
    expect(res.status).toBe(400);
    expect(accessSpies.canEnterCourse).not.toHaveBeenCalled();
  });
});

// ─── GET /api/access/content/:contentId/can-view ─────────────────────────────

describe('GET /api/access/content/:contentId/can-view — view gate (optional auth)', () => {
  it('authenticated → 200 { canView }, resolver called with session id + contentId', async () => {
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/access/content/${CONTENT_ID}/can-view`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { canView: true } });
    expect(accessSpies.canView).toHaveBeenCalledWith(USER.id, CONTENT_ID);
  });

  it('anonymous → 200, resolver called with userId = null (public/free path)', async () => {
    const res = await dispatch(
      buildApp(null),
      getReq(`/api/access/content/${CONTENT_ID}/can-view`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { canView: true } });
    expect(accessSpies.canView).toHaveBeenCalledWith(null, CONTENT_ID);
  });

  it('resolver denies → 200 { canView: false } and NOTHING else leaks', async () => {
    accessSpies.canView.mockResolvedValue(false);
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/access/content/${CONTENT_ID}/can-view`)
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { data: Record<string, unknown> };
    expect(payload).toEqual({ data: { canView: false } });
    // No streaming URL / content fields leak through the boolean gate.
    expect(Object.keys(payload.data)).toEqual(['canView']);
  });

  it('non-uuid contentId → 400, resolver NOT called', async () => {
    const res = await dispatch(
      buildApp(USER),
      getReq('/api/access/content/not-a-uuid/can-view')
    );
    expect(res.status).toBe(400);
    expect(accessSpies.canView).not.toHaveBeenCalled();
  });
});

// ─── GET /api/journeys/courses ───────────────────────────────────────────────

describe('GET /api/journeys/courses — list published courses (public)', () => {
  it('found → 200 { data: cards }, service called with organizationId', async () => {
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/courses?organizationId=${ORG_ID}`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: COURSE_CARDS });
    // The CDN base is env-owned and forwarded by the route so the service can
    // resolve each course's cover key to a URL (Codex-eqh0z).
    expect(journeySpies.listPublishedCourses).toHaveBeenCalledWith(
      ORG_ID,
      R2_PUBLIC_URL_BASE
    );
  });

  it('anonymous (no session) → 200 — the discovery rail is fully public', async () => {
    const res = await dispatch(
      buildApp(null),
      getReq(`/api/journeys/courses?organizationId=${ORG_ID}`)
    );
    expect(res.status).toBe(200);
    expect(journeySpies.listPublishedCourses).toHaveBeenCalledWith(
      ORG_ID,
      R2_PUBLIC_URL_BASE
    );
  });

  it('no published courses → 200 { data: [] }', async () => {
    journeySpies.listPublishedCourses.mockResolvedValue([]);
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/courses?organizationId=${ORG_ID}`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });

  it('missing organizationId → 400, service NOT called', async () => {
    const res = await dispatch(buildApp(USER), getReq('/api/journeys/courses'));
    expect(res.status).toBe(400);
    expect(journeySpies.listPublishedCourses).not.toHaveBeenCalled();
  });

  it('non-uuid organizationId → 400, service NOT called', async () => {
    const res = await dispatch(
      buildApp(USER),
      getReq('/api/journeys/courses?organizationId=not-a-uuid')
    );
    expect(res.status).toBe(400);
    expect(journeySpies.listPublishedCourses).not.toHaveBeenCalled();
  });
});

// ─── Portal read caching + CDN headers (Codex-72k55) ─────────────────────────
//
// The wiring lives in `journeys-cache.ts` and is unit-tested there; these assert
// it is actually REACHED through the real route + resolver, and — the part a unit
// test cannot cover — that the CDN header lands on the public reads and on
// nothing else.

describe('portal public reads — KV cache-aside through the real route', () => {
  it('a repeat read is served from cache: the service runs ONCE', async () => {
    await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/courses?organizationId=${ORG_ID}`)
    );
    const second = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/courses?organizationId=${ORG_ID}`)
    );

    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ data: COURSE_CARDS });
    // The DB-backed service was NOT consulted the second time — the whole point
    // of the change. Before this, both renders queried Postgres.
    expect(journeySpies.listPublishedCourses).toHaveBeenCalledTimes(1);
  });

  it('ORG ISOLATION: another org is a miss, not a hit on the first org’s rows', async () => {
    const otherOrg = '3c222222-2222-4222-8222-222222222222';
    await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/courses?organizationId=${ORG_ID}`)
    );
    await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/courses?organizationId=${otherOrg}`)
    );

    expect(journeySpies.listPublishedCourses).toHaveBeenCalledTimes(2);
    expect(journeySpies.listPublishedCourses).toHaveBeenLastCalledWith(
      otherOrg,
      R2_PUBLIC_URL_BASE
    );
  });

  it('SLOT SPLIT: featured and unfiltered /published reads do not satisfy each other', async () => {
    // The landing page issues exactly these two reads in one render.
    await dispatch(
      buildApp(USER),
      getReq(
        `/api/journeys/published?organizationId=${ORG_ID}&featured=true&limit=4`
      )
    );
    await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/published?organizationId=${ORG_ID}&limit=12`)
    );

    expect(journeySpies.listPublishedJourneys).toHaveBeenCalledTimes(2);
    expect(journeySpies.listPublishedJourneys).toHaveBeenNthCalledWith(
      1,
      ORG_ID,
      expect.objectContaining({ featured: true, limit: 4 })
    );
    expect(journeySpies.listPublishedJourneys).toHaveBeenNthCalledWith(
      2,
      ORG_ID,
      expect.objectContaining({ featured: false, limit: 12 })
    );
  });
});

/**
 * Cache-Control per route (Codex-1j5fw).
 *
 * These assertions used to cover a router-wide `app.use('*')` gated by an
 * exact-path allow-list (`isPublicPortalRead`). Both are gone: each route
 * declares `policy.cache` (+ `variesBySession` for the two public ones) and
 * `procedure()` emits `CACHE_PRESETS[…]`. The header values are pinned as exact
 * strings on purpose — a preset drifting to carry an `s-maxage` on a per-viewer
 * body is the leak this whole vocabulary exists to prevent, and only a
 * whole-string assertion catches a widening.
 *
 * NOT-VACUOUS DISCIPLINE: every `.not.toContain('public')` below is paired with
 * a `toBe('private, no-cache')` on the same response. A negative assertion
 * against a header that turns out to be ABSENT passes for the wrong reason —
 * which is exactly what these two guards were doing before `procedure()` emitted
 * a default, when the value they tested was the empty string.
 */
describe('Cache-Control per route — declared on the policy, emitted by procedure()', () => {
  const PUBLIC_60 = 'public, max-age=60, s-maxage=60';
  const PRIVATE = 'private, no-cache';

  it('the two portal reads that were allow-listed still carry the shared-cache header', async () => {
    const courses = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/courses?organizationId=${ORG_ID}`)
    );
    const published = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/published?organizationId=${ORG_ID}&limit=12`)
    );

    expect(courses.headers.get('Cache-Control')).toBe(PUBLIC_60);
    expect(published.headers.get('Cache-Control')).toBe(PUBLIC_60);
  });

  it('a public read carries the shared-cache header for an ANONYMOUS caller too', async () => {
    // WHAT THIS PROVES, EXACTLY: `procedure()` emits the declared preset on the
    // ANONYMOUS branch of `auth: 'optional'` as well as the resolved-session
    // branch. That is a real property — the two branches take different paths
    // through `authenticateSession()`, and an implementation that stamped the
    // header only after resolving a user would fail here.
    //
    // WHAT IT DOES NOT PROVE, AND USED TO CLAIM IT DID. This assertion once
    // carried a comment saying it showed `variesBySession: false` — that the
    // BODY ignores the session. It cannot: the header is emitted from a
    // compile-time-constant policy (`CACHE_PRESETS[policy.cache]`), so it is
    // incapable of varying by session and the comparison was a tautology.
    // Injecting `if (!ctx.user) return [];` into the `/published` handler made
    // the BODY differ between an anonymous and a signed-in caller while the
    // policy still declared it did not, and this file stayed green. The claim
    // now lives in "the `variesBySession: false` carve-out" block below, where
    // it is asserted on the response BYTES.
    const anon = await dispatch(
      buildApp(null),
      getReq(`/api/journeys/courses?organizationId=${ORG_ID}`)
    );

    expect(anon.status).toBe(200);
    expect(anon.headers.get('Cache-Control')).toBe(PUBLIC_60);
  });

  it.each([
    [
      '/courses/by-slug',
      `/api/journeys/courses/by-slug?organizationId=${ORG_ID}&slug=${SLUG}`,
    ],
    [
      '/content/:contentId/courses',
      `/api/journeys/content/${CONTENT_ID}/courses`,
    ],
    [
      '/pages/by-slug',
      `/api/journeys/pages/by-slug?organizationId=${ORG_ID}&slug=${SLUG}`,
    ],
    [
      '/courses/:courseId/sell-preview',
      `/api/journeys/courses/${COURSE_ID}/sell-preview`,
    ],
  ])('the auth:optional read %s was never allow-listed and stays out of shared caches', async (_name, path) => {
    const res = await dispatch(buildApp(USER), getReq(path));

    expect(res.status).toBe(200);
    // Pinned so a future widening to `cache: 'public'` on one of these is a
    // deliberate act with a red test attached, not a silent side effect.
    expect(res.headers.get('Cache-Control')).toBe(PRIVATE);
  });

  it('CACHE POISONING GUARD: the per-user enrolled shelf is NEVER publicly cacheable', async () => {
    // `/enrolled` is auth:'required' and its body varies by session, while shared
    // caches key by URL and NOT by Cookie. If this response ever carried
    // `public, max-age=...`, the first member's shelf would be served to every
    // subsequent visitor to the same URL. The type rule now makes `cache:
    // 'public'` here a COMPILE error; this is the runtime half of that guard.
    journeySpies.listEnrolledJourneys.mockResolvedValue([]);
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/enrolled?organizationId=${ORG_ID}`)
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(PRIVATE);
    expect(res.headers.get('Cache-Control') ?? '').not.toContain('public');
  });

  it('CACHE POISONING GUARD: an entitlement-gated course read is not publicly cacheable', async () => {
    // Shares the `/courses` prefix with the public list. Under the old
    // middleware that mattered because a `/courses/*` pattern would have caught
    // it; now the two routes simply declare different presets, and no pattern
    // can reach across them.
    journeySpies.getCourseDashboard.mockResolvedValue(null);
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/courses/${COURSE_ID}/dashboard`)
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(PRIVATE);
    expect(res.headers.get('Cache-Control') ?? '').not.toContain('public');
  });

  it('NO s-maxage on a validation FAILURE for an allow-listed public path', async () => {
    // The deleted middleware gated on `c.req.path` and ran AFTER `await next()`,
    // so it stamped the shared-cache header on this route's 400s and 429s too —
    // an edge-cached rate-limit or validation error is a 60-second outage for
    // that URL, reachable by anyone since `organizationId` is caller-supplied.
    // `procedure()` emits the preset on the SUCCESS path only. Verified by
    // reinstating the old middleware, which turns this red.
    const res = await dispatch(
      buildApp(null),
      getReq('/api/journeys/published?organizationId=not-a-uuid')
    );

    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control') ?? '').not.toContain('s-maxage');
  });

  it('FAILS CLOSED: an undeclared auth:required read is private, not header-less', async () => {
    // The property the deleted allow-list provided ("a route added later carries
    // no public header until someone adds it deliberately") is now the
    // framework's: `resolveCacheControl` defaults an undeclared policy to
    // `private`. `/user/enrollments` declares no `cache` at all, and it is the
    // member's OWN enrollment shelf — the body a shared cache must never reuse.
    // Asserted by VALUE, because a header-less response would also satisfy a
    // `.not.toContain('public')` check and prove nothing.
    journeySpies.listEnrolledCourses.mockResolvedValue([]);
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/user/enrollments?organizationId=${ORG_ID}`)
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(PRIVATE);
  });
});

/**
 * The `variesBySession: false` carve-out, asserted on the BODY.
 *
 * WHY A SECOND BLOCK. Everything above tests HEADERS. `procedure()` emits the
 * header from a compile-time-constant policy — `CACHE_PRESETS[policy.cache]` —
 * so no header assertion can ever fail for the reason `variesBySession: false`
 * exists. PROVEN, not reasoned: injecting `if (!ctx.user) return [];` at the top
 * of the `/published` handler makes the BODY differ between an anonymous and a
 * signed-in caller while the policy still declares it does not, and the header
 * block above stays green.
 *
 * WHAT THE DECLARATION ACTUALLY PROMISES. `CACHE_PRESETS.public` carries
 * `s-maxage=60`, and a shared cache keys on the URL and NEVER on Cookie. So
 * `variesBySession: false` is a promise about BYTES: for one URL, every viewer
 * gets the same body, and whichever viewer arrives first may have theirs served
 * to all the others for the next 60 seconds. These are the only two routes in
 * the repo where a shared window sits on a route that RESOLVES A SESSION, so
 * they are the only two where the promise can be broken.
 *
 * WHY `CACHE_KV` IS TAKEN AWAY. Both routes are KV cache-aside. Left in place,
 * the first request populates the data slot and the rest are served from it —
 * byte-identical whatever the handler does with the session, and the comparison
 * would be vacuous again for a new reason. The handler's own
 * `if (!ctx.env.CACHE_KV) return fetchX()` branch is the seam that puts every
 * request back through the handler.
 *
 * WHY THE ROUTE SET IS DERIVED FROM SOURCE. A list covers today's two routes and
 * silently misses the third. `carveOutRoutesIn` reads every mounted route
 * module's TEXT and names each route declaring the carve-out; TOTALITY below
 * asserts the derived set EQUALS the covered set in both directions, so adding
 * `variesBySession: false` anywhere in this worker turns this file red until a
 * request URL is supplied for it, and deleting one turns it red until the stale
 * entry goes. This file owns that guard for the whole worker, not just journeys.
 */

/** A route registration at column 0 — `app.get(\n  '/path',` and friends. */
const ROUTE_REGISTRATION =
  /^app\.(?:get|post|put|patch|delete|all)\(\s*(['"`])([^'"`\n]*)\1/gm;

/**
 * A carve-out DECLARATION, matched code-shaped: the line is whitespace, then the
 * property, then an OPTIONAL trailing comment. Prose mentions of the phrase are
 * indented `* ` inside a JSDoc block, and `*` is not whitespace, so a docstring
 * can never register coverage it does not have — journeys.ts has three such
 * prose mentions today and none of them matches.
 *
 * TWO FAIL-OPEN BUGS HAVE BEEN FOUND IN THIS ONE PATTERN, both by mutation and
 * neither by reading it. Recording both, because the shape kept reappearing:
 *
 *   1. It required end-of-line right after the comma, so
 *      `variesBySession: false, // the handler never reads ctx.user` was
 *      INVISIBLE — and `rateLimit: 'api', // 100 req/min` is the house style two
 *      lines up in every one of these policies. Adding a carve-out with a
 *      trailing comment to `/courses/by-slug` left the file 66/66 green.
 *   2. It was anchored to start-of-line (`^[ \t]*`), so a policy written on ONE
 *      line — `policy: { auth: 'optional', cache: 'public', variesBySession: false }`
 *      — was also invisible. That is the repo's dominant style for short policies.
 *
 * Both are fail-OPEN: the route carries a shared 60s window while TOTALITY below
 * reports full coverage, which is the one direction this guard must never fail.
 *
 * THE ANCHOR IS GONE, AND SO IS ITS REASON. `^[ \t]*` existed to stop prose
 * mentions inside JSDoc from registering coverage — `*` is not whitespace, so an
 * indented `* variesBySession: false` could not match. Blanking comments FIRST
 * removes that problem at the source and lets the declaration be found anywhere on
 * a line, which is what both bugs above needed. journeys.ts has three prose
 * mentions today; the control test below pins that none of them counts.
 */
const CARVE_OUT_DECLARATION = /variesBySession:\s*false\b/g;

/**
 * Blank every comment, preserving byte offsets so route attribution still works.
 *
 * Offsets matter: `carveOutRoutesIn` attributes a declaration to the nearest
 * registration ABOVE it by index, so deleting bytes rather than replacing them
 * would silently re-attribute every match after the first comment.
 */
function blankComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) =>
    m.replace(/[^\n]/g, ' ')
  );
}

/**
 * Name every route in one module that declares the carve-out, as
 * `"<file> <router-relative path>"`.
 *
 * Attribution is "nearest column-0 registration ABOVE the declaration". If a
 * route were ever registered indented (inside a helper), attribution would name
 * the wrong path or none — and TOTALITY would then fail on set equality rather
 * than pass, so the guard degrades closed.
 */
function carveOutRoutesIn(file: string, rawSrc: string): string[] {
  const src = blankComments(rawSrc);
  const registrations = [...src.matchAll(ROUTE_REGISTRATION)].map((m) => ({
    at: m.index ?? 0,
    path: m[2] ?? '',
  }));
  return [...src.matchAll(CARVE_OUT_DECLARATION)].map((m) => {
    const at = m.index ?? 0;
    let owner: string | null = null;
    for (const r of registrations) if (r.at < at) owner = r.path;
    return `${file} ${owner ?? `<unattributed@${at}>`}`;
  });
}

/**
 * The route modules whose text is scanned. Hand-written — `?raw` specifiers must
 * be static for Vite to inline them, so this list cannot be built at runtime.
 *
 * It is therefore the LAST convention in the chain, and the test below removes
 * it as one: `mountedModulesIn(workerIndexSrc)` reads `src/index.ts` and names
 * every module actually reached by an `app.route(...)`, and the keys here must
 * equal that. Mount a new router with a carve-out in it and this file goes red
 * pointing at the module it cannot see, instead of quietly not scanning it.
 */
const MOUNTED_ROUTE_SOURCES: ReadonlyArray<readonly [string, string]> = [
  ['public.ts', publicSrc],
  ['content.ts', contentSrc],
  ['categories.ts', categoriesSrc],
  ['media.ts', mediaSrc],
  ['content-access.ts', contentAccessSrc],
  ['journey-insights.ts', journeyInsightsSrc],
  ['journeys.ts', journeysSrc],
];

/**
 * Name every `./routes/*` module that `src/index.ts` actually MOUNTS, as
 * `"<file>.ts"`.
 *
 * Two steps, because `app.route()` takes the local binding, not the path:
 * collect `import <ident> from './routes/<name>'`, then keep the ones an
 * `app.route('<prefix>', <ident>)` names. An imported-but-never-mounted module
 * is correctly excluded (it registers no reachable route); a mounted module with
 * no matching import is impossible.
 */
function mountedModulesIn(src: string): string[] {
  const byIdent = new Map<string, string>();
  for (const m of src.matchAll(
    /^import\s+(\w+)\s+from\s+'\.\/routes\/([\w-]+)';/gm
  )) {
    byIdent.set(m[1] ?? '', `${m[2] ?? ''}.ts`);
  }
  const mounted = new Set<string>();
  for (const m of src.matchAll(/^app\.route\(\s*'[^']*'\s*,\s*(\w+)\s*\)/gm)) {
    const file = byIdent.get(m[1] ?? '');
    if (file) mounted.add(file);
  }
  return [...mounted];
}

describe('variesBySession: false — the carve-out asserted on the response BYTES', () => {
  // The env WITHOUT the cache-aside binding — see the block docstring.
  const NO_KV_ENV = {
    ...testEnv,
    CACHE_KV: undefined,
  } as unknown as typeof env;

  /**
   * Three callers that differ in every way a handler could observe: no session
   * at all; the member the rest of this file uses; and a different user id with
   * a different platform role. `ctx.user` / `ctx.session` are the entire
   * session-derived surface these two handlers can reach.
   */
  const OTHER_USER = {
    id: '9b2e1f3a-4c5d-4e6f-8071-223344556677',
    email: 'admin@test.com',
    role: 'admin',
  };
  const CALLERS: ReadonlyArray<readonly [string, typeof USER | null]> = [
    ['anonymous', null],
    ['session USER (creator)', USER],
    ['session OTHER_USER (admin, different id)', OTHER_USER],
  ];

  /**
   * A NON-EMPTY projection for both routes.
   *
   * This is load-bearing, not fixture noise. The top-level `beforeEach` primes
   * `listPublishedJourneys` with `[]`, and `[]` is also exactly what an
   * `if (!ctx.user) return []` leak returns — so under the default fixture the
   * leak and the truth serialise to the same bytes and a byte comparison proves
   * nothing. The non-vacuity assertion in the body test below pins that: the
   * compared bodies must actually carry a row before their equality means
   * anything.
   */
  const CARVE_OUT_JOURNEY_CARDS = [
    {
      id: COURSE_ID,
      slug: SLUG,
      title: 'Rootwork',
      kicker: 'A guided five-practice descent',
      coverImageUrl: `${R2_PUBLIC_URL_BASE}/covers/rootwork/md.webp`,
      priceCents: 4900,
      stageCount: 5,
    },
  ];

  /**
   * Request URL + the service spy each carve-out route calls, keyed by the name
   * `carveOutRoutesIn` derives. The keys are the coverage claim TOTALITY checks.
   */
  const CARVE_OUT_REQUESTS: Record<
    string,
    { path: string; spy: ReturnType<typeof vi.fn> }
  > = {
    'journeys.ts /courses': {
      path: `/api/journeys/courses?organizationId=${ORG_ID}`,
      spy: journeySpies.listPublishedCourses,
    },
    'journeys.ts /published': {
      path: `/api/journeys/published?organizationId=${ORG_ID}&limit=12`,
      spy: journeySpies.listPublishedJourneys,
    },
  };

  beforeEach(() => {
    journeySpies.listPublishedCourses.mockResolvedValue(COURSE_CARDS);
    journeySpies.listPublishedJourneys.mockResolvedValue(
      CARVE_OUT_JOURNEY_CARDS
    );
  });

  it('EXTRACTOR CONTROL: finds a code-shaped declaration, ignores a prose one', () => {
    // A positive and a negative control on the discovery mechanism itself. A
    // silently-broken extractor returns `[]`, which would make TOTALITY's "every
    // declared route is covered" direction vacuously true; set EQUALITY is what
    // catches that, and this test is what says why it broke.
    const synthetic = [
      '/**',
      ' * A docstring mentioning variesBySession: false inline.',
      ' */',
      'app.get(',
      "  '/decoy',",
      "  procedure({ policy: { auth: 'optional', cache: 'private' } })",
      ');',
      'app.get(',
      "  '/real',",
      '  procedure({',
      '    policy: {',
      "      auth: 'optional',",
      "      cache: 'public',",
      '      variesBySession: false,',
      '    },',
      '  })',
      ');',
      'app.get(',
      "  '/real-with-trailing-comment',",
      '  procedure({',
      '    policy: {',
      "      auth: 'optional',",
      "      cache: 'public',",
      '      variesBySession: false, // the handler never reads ctx.user',
      '    },',
      '  })',
      ');',
      '// A line comment mentioning variesBySession: false.',
    ].join('\n');

    // Three decoys, one per way the phrase appears WITHOUT being a declaration
    // (JSDoc prose, a `//` line comment, a route that simply does not declare
    // it) and two real forms, including the trailing-comment form that a
    // mutation caught this pattern missing.
    expect(carveOutRoutesIn('synthetic.ts', synthetic)).toEqual([
      'synthetic.ts /real',
      'synthetic.ts /real-with-trailing-comment',
    ]);
    // And the real files agree with the eyeball: journeys.ts holds both, and it
    // holds them despite three prose mentions of the same phrase.
    expect(carveOutRoutesIn('journeys.ts', journeysSrc)).toEqual([
      'journeys.ts /courses',
      'journeys.ts /published',
    ]);
  });

  it('SCAN COVERAGE: every route module src/index.ts mounts is one this file scans', () => {
    // Without this, TOTALITY below is only total over the modules someone
    // remembered to add to MOUNTED_ROUTE_SOURCES — a list that looks complete
    // whether or not it is. Derived from index.ts, so mounting a new router is
    // what turns it red.
    expect(mountedModulesIn(workerIndexSrc).sort()).toEqual(
      MOUNTED_ROUTE_SOURCES.map(([file]) => file).sort()
    );
  });

  it('TOTALITY: every carve-out route in this worker has a body-invariance case here', () => {
    const declared = MOUNTED_ROUTE_SOURCES.flatMap(([file, src]) =>
      carveOutRoutesIn(file, src)
    ).sort();
    const covered = Object.keys(CARVE_OUT_REQUESTS).sort();

    // EQUALITY, both directions. `declared ⊄ covered` = a route earned a shared
    // 60s window with nothing proving its body ignores the session. `covered ⊄
    // declared` = this file claims to guard a route that no longer declares the
    // carve-out, i.e. a stale promise.
    expect(declared).toEqual(covered);
  });

  it.each(
    Object.entries(CARVE_OUT_REQUESTS)
  )('%s: three different callers get BYTE-IDENTICAL bodies for one URL', async (name, {
    path,
  }) => {
    const bodies: Array<[string, string]> = [];
    for (const [who, caller] of CALLERS) {
      const res = await dispatch(buildApp(caller), getReq(path), NO_KV_ENV);
      expect(res.status, `${name} · ${who}`).toBe(200);
      bodies.push([who, await res.text()]);
    }

    const [[baselineWho, baseline], ...rest] = bodies as [
      [string, string],
      ...Array<[string, string]>,
    ];

    // THE CLAIM, asserted before the non-vacuity guard below so that a real
    // leak reports as "the bodies differ" rather than as "the baseline was
    // empty" — a leak makes ONE of these bodies empty, and whichever caller
    // happens to be the baseline should not decide which message a reviewer
    // reads.
    for (const [who, body] of rest) {
      expect(
        body,
        `${name}: the body served to "${who}" differs from "${baselineWho}" — ` +
          'a shared cache keys on URL and NOT on Cookie, so whichever of ' +
          'these arrives first would be served to the other for 60s'
      ).toBe(baseline);
    }

    // NON-VACUITY, and it has to come from the SAME dispatches the equality
    // above compared. An all-empty envelope is byte-identical under a leak
    // too, so equality alone can pass for the wrong reason. Equality is
    // already proven here, so pinning the baseline pins all three.
    expect(
      baseline,
      `${name}: every caller got an EMPTY body, so the equality above proved ` +
        'nothing — the fixture stopped returning rows'
    ).toContain(COURSE_ID);
  });

  it.each(
    Object.entries(CARVE_OUT_REQUESTS)
  )('%s: the service sees identical arguments from every caller — nothing session-derived reaches it', async (name, {
    path,
    spy,
  }) => {
    for (const [, caller] of CALLERS) {
      await dispatch(buildApp(caller), getReq(path), NO_KV_ENV);
    }

    // Body equality alone cannot see this: the service is a spy returning a
    // constant, so a handler that forwarded `ctx.user.id` into the query would
    // still hand back identical bytes HERE while returning per-viewer rows in
    // production. Arity/argument invariance is the half that catches it.
    const calls = spy.mock.calls.map((args) => JSON.stringify(args));
    expect(calls, `${name}: one service call per caller`).toHaveLength(
      CALLERS.length
    );
    expect(
      new Set(calls).size,
      `${name}: the service was called with more than one argument list — ` +
        `a session-derived value reached it (${calls.join(' | ')})`
    ).toBe(1);
  });
});

// ─── GET /api/journeys/courses/by-slug ───────────────────────────────────────

describe('GET /api/journeys/courses/by-slug — resolve summary', () => {
  it('found → 200 { data: summary }, service called with (orgId, slug)', async () => {
    const res = await dispatch(
      buildApp(USER),
      getReq(
        `/api/journeys/courses/by-slug?organizationId=${ORG_ID}&slug=${SLUG}`
      )
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: COURSE_SUMMARY });
    expect(journeySpies.getCourseBySlug).toHaveBeenCalledWith(ORG_ID, SLUG);
  });

  it('not found → 200 { data: null }', async () => {
    journeySpies.getCourseBySlug.mockResolvedValue(null);
    const res = await dispatch(
      buildApp(USER),
      getReq(
        `/api/journeys/courses/by-slug?organizationId=${ORG_ID}&slug=missing`
      )
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
  });

  it('missing organizationId → 400, service NOT called', async () => {
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/courses/by-slug?slug=${SLUG}`)
    );
    expect(res.status).toBe(400);
    expect(journeySpies.getCourseBySlug).not.toHaveBeenCalled();
  });
});

// ─── GET /api/journeys/content/:contentId/courses ────────────────────────────

describe('GET /api/journeys/content/:contentId/courses — cross-link (public)', () => {
  it('found → 200 { data: links }, service called with contentId', async () => {
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/content/${CONTENT_ID}/courses`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: CONTENT_COURSES });
    expect(journeySpies.getContentCourses).toHaveBeenCalledWith(CONTENT_ID);
  });

  it('anonymous (no session) → 200 — the cross-link is fully public', async () => {
    const res = await dispatch(
      buildApp(null),
      getReq(`/api/journeys/content/${CONTENT_ID}/courses`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: CONTENT_COURSES });
    expect(journeySpies.getContentCourses).toHaveBeenCalledWith(CONTENT_ID);
  });

  it('no parent course → 200 { data: { courses: [] } }', async () => {
    journeySpies.getContentCourses.mockResolvedValueOnce({ courses: [] });
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/content/${CONTENT_ID}/courses`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { courses: [] } });
  });

  it('non-uuid contentId → 400, service NOT called', async () => {
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/content/not-a-uuid/courses`)
    );
    expect(res.status).toBe(400);
    expect(journeySpies.getContentCourses).not.toHaveBeenCalled();
  });
});

// ─── GET /api/journeys/pages/by-slug ─────────────────────────────────────────

describe('GET /api/journeys/pages/by-slug — public sales page (optional auth)', () => {
  it('found → 200 { data: coursePage }, service called with (orgId, slug)', async () => {
    const res = await dispatch(
      buildApp(USER),
      getReq(
        `/api/journeys/pages/by-slug?organizationId=${ORG_ID}&slug=${SLUG}`
      )
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: COURSE_PAGE });
    expect(journeySpies.getCoursePage).toHaveBeenCalledWith(
      ORG_ID,
      SLUG,
      R2_PUBLIC_URL_BASE
    );
  });

  it('anonymous (no session) → 200 — the sell shell is fully public', async () => {
    const res = await dispatch(
      buildApp(null),
      getReq(
        `/api/journeys/pages/by-slug?organizationId=${ORG_ID}&slug=${SLUG}`
      )
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: COURSE_PAGE });
    expect(journeySpies.getCoursePage).toHaveBeenCalledWith(
      ORG_ID,
      SLUG,
      R2_PUBLIC_URL_BASE
    );
  });

  it('no published page → 200 { data: null }', async () => {
    journeySpies.getCoursePage.mockResolvedValue(null);
    const res = await dispatch(
      buildApp(USER),
      getReq(
        `/api/journeys/pages/by-slug?organizationId=${ORG_ID}&slug=missing`
      )
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
  });

  it('missing organizationId → 400, service NOT called', async () => {
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/pages/by-slug?slug=${SLUG}`)
    );
    expect(res.status).toBe(400);
    expect(journeySpies.getCoursePage).not.toHaveBeenCalled();
  });

  it('non-uuid organizationId → 400, service NOT called', async () => {
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/pages/by-slug?organizationId=nope&slug=${SLUG}`)
    );
    expect(res.status).toBe(400);
    expect(journeySpies.getCoursePage).not.toHaveBeenCalled();
  });
});

// ─── GET /api/journeys/courses/:courseId/sell-preview ────────────────────────

describe('GET /api/journeys/courses/:courseId/sell-preview — public previews', () => {
  it('found → 200 { data: preview }, service called with (courseId, R2 base)', async () => {
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/courses/${COURSE_ID}/sell-preview`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: SELL_PREVIEW });
    // The route supplies the env-owned CDN base; the service resolves URLs.
    expect(journeySpies.getCourseSellPreview).toHaveBeenCalledWith(
      COURSE_ID,
      R2_PUBLIC_URL_BASE
    );
  });

  it('anonymous → 200 — previews are public (no auth, no canView)', async () => {
    const res = await dispatch(
      buildApp(null),
      getReq(`/api/journeys/courses/${COURSE_ID}/sell-preview`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: SELL_PREVIEW });
    expect(journeySpies.getCourseSellPreview).toHaveBeenCalledWith(
      COURSE_ID,
      R2_PUBLIC_URL_BASE
    );
  });

  it('course not published → 200 { data: null }', async () => {
    journeySpies.getCourseSellPreview.mockResolvedValue(null);
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/courses/${COURSE_ID}/sell-preview`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
  });

  it('non-uuid courseId → 400, service NOT called', async () => {
    const res = await dispatch(
      buildApp(USER),
      getReq('/api/journeys/courses/not-a-uuid/sell-preview')
    );
    expect(res.status).toBe(400);
    expect(journeySpies.getCourseSellPreview).not.toHaveBeenCalled();
  });
});

// ─── GET /api/journeys/courses/:courseId/dashboard ───────────────────────────

describe('GET /api/journeys/courses/:courseId/dashboard — gated read', () => {
  it('entitled → 200 { data: dashboard }, gate + read called with session id', async () => {
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/courses/${COURSE_ID}/dashboard`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: DASHBOARD });
    expect(accessSpies.canEnterCourse).toHaveBeenCalledWith(USER.id, COURSE_ID);
    expect(journeySpies.getCourseDashboard).toHaveBeenCalledWith(
      USER.id,
      COURSE_ID
    );
  });

  it('NOT entitled → 200 { data: null } and the dashboard read is NEVER called', async () => {
    accessSpies.canEnterCourse.mockResolvedValue(false);
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/courses/${COURSE_ID}/dashboard`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
    expect(journeySpies.getCourseDashboard).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401, neither gate nor read called', async () => {
    const res = await dispatch(
      buildApp(null),
      getReq(`/api/journeys/courses/${COURSE_ID}/dashboard`)
    );
    expect(res.status).toBe(401);
    expect(accessSpies.canEnterCourse).not.toHaveBeenCalled();
    expect(journeySpies.getCourseDashboard).not.toHaveBeenCalled();
  });
});

// ─── GET /api/journeys/courses/:courseId/practices/:contentSlug ──────────────

describe('GET /api/journeys/courses/:courseId/practices/:contentSlug — in-course player', () => {
  it('media practice → 200 with a signed stream URL from getStreamingUrl', async () => {
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/courses/${COURSE_ID}/practices/${CONTENT_SLUG}`)
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      data: { streamingUrl: string | null; waveformUrl: string | null };
    };
    expect(payload.data.streamingUrl).toBe(STREAM_RESULT.streamingUrl);
    expect(payload.data.waveformUrl).toBe(STREAM_RESULT.waveformUrl);
    expect(accessSpies.getStreamingUrl).toHaveBeenCalledWith(
      USER.id,
      expect.objectContaining({ contentId: CONTENT_ID })
    );
  });

  it('written practice → 200 with bodyHtml and NO stream signing', async () => {
    journeySpies.getInCoursePractice.mockResolvedValue(WRITTEN_PRACTICE);
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/courses/${COURSE_ID}/practices/set-your-intention`)
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      data: { streamingUrl: string | null; bodyHtml: string | null };
    };
    expect(payload.data.streamingUrl).toBeNull();
    expect(payload.data.bodyHtml).toBe(WRITTEN_PRACTICE.bodyHtml);
    expect(accessSpies.getStreamingUrl).not.toHaveBeenCalled();
  });

  it('NOT entitled → 200 { data: null }, practice read NEVER called', async () => {
    accessSpies.canEnterCourse.mockResolvedValue(false);
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/courses/${COURSE_ID}/practices/${CONTENT_SLUG}`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
    expect(journeySpies.getInCoursePractice).not.toHaveBeenCalled();
    expect(accessSpies.getStreamingUrl).not.toHaveBeenCalled();
  });

  it('practice not found in course → 200 { data: null }', async () => {
    journeySpies.getInCoursePractice.mockResolvedValue(null);
    const res = await dispatch(
      buildApp(USER),
      getReq(`/api/journeys/courses/${COURSE_ID}/practices/ghost`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
    expect(accessSpies.getStreamingUrl).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401', async () => {
    const res = await dispatch(
      buildApp(null),
      getReq(`/api/journeys/courses/${COURSE_ID}/practices/${CONTENT_SLUG}`)
    );
    expect(res.status).toBe(401);
    expect(journeySpies.getInCoursePractice).not.toHaveBeenCalled();
  });
});

// ─── POST /api/journeys/practices/completions ────────────────────────────────

describe('POST /api/journeys/practices/completions — idempotent write', () => {
  it('valid body → 200 { data: record }, service called with session id + input', async () => {
    const res = await dispatch(
      buildApp(USER),
      postReq('/api/journeys/practices/completions', {
        contentId: CONTENT_ID,
        source: 'manual',
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: COMPLETION_RECORD });
    expect(journeySpies.recordPracticeCompletion).toHaveBeenCalledWith(
      USER.id,
      CONTENT_ID,
      'manual'
    );
  });

  it('accepts source = auto', async () => {
    const res = await dispatch(
      buildApp(USER),
      postReq('/api/journeys/practices/completions', {
        contentId: CONTENT_ID,
        source: 'auto',
      })
    );
    expect(res.status).toBe(200);
    expect(journeySpies.recordPracticeCompletion).toHaveBeenCalledWith(
      USER.id,
      CONTENT_ID,
      'auto'
    );
  });

  it('invalid source → 400, service NOT called', async () => {
    const res = await dispatch(
      buildApp(USER),
      postReq('/api/journeys/practices/completions', {
        contentId: CONTENT_ID,
        source: 'nonsense',
      })
    );
    expect(res.status).toBe(400);
    expect(journeySpies.recordPracticeCompletion).not.toHaveBeenCalled();
  });

  it('missing contentId → 400, service NOT called', async () => {
    const res = await dispatch(
      buildApp(USER),
      postReq('/api/journeys/practices/completions', { source: 'manual' })
    );
    expect(res.status).toBe(400);
    expect(journeySpies.recordPracticeCompletion).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401, service NOT called', async () => {
    const res = await dispatch(
      buildApp(null),
      postReq('/api/journeys/practices/completions', {
        contentId: CONTENT_ID,
        source: 'manual',
      })
    );
    expect(res.status).toBe(401);
    expect(journeySpies.recordPracticeCompletion).not.toHaveBeenCalled();
  });
});
