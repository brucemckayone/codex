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
  getCourseBySlug: vi.fn(),
  getContentCourses: vi.fn(),
  getCoursePage: vi.fn(),
  getCourseSellPreview: vi.fn(),
  getCourseDashboard: vi.fn(),
  getInCoursePractice: vi.fn(),
  recordPracticeCompletion: vi.fn(),
};

vi.mock('@codex/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/access')>();
  return {
    ...actual,
    ContentAccessService: vi.fn(() => accessSpies),
    CourseJourneyService: vi.fn(() => journeySpies),
  };
});

// Import routes AFTER the mock so the real registry resolves the mocked classes.
import contentAccess from '../content-access';
import journeys from '../journeys';

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

// The env the real `access` registry getter needs to build its dev R2 signer
// without touching a real bucket (the service is mocked, so nothing signs).
const testEnv = {
  ...env,
  ENVIRONMENT: 'development',
  R2_PUBLIC_URL_BASE,
} as typeof env;

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

async function dispatch(
  app: ReturnType<typeof buildApp>,
  req: Request
): Promise<Response> {
  const ec = createExecutionContext();
  const res = await app.fetch(req, testEnv, ec);
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

beforeEach(() => {
  vi.clearAllMocks();
  accessSpies.canEnterCourse.mockResolvedValue(true);
  accessSpies.canView.mockResolvedValue(true);
  accessSpies.getStreamingUrl.mockResolvedValue(STREAM_RESULT);
  journeySpies.getCourseBySlug.mockResolvedValue(COURSE_SUMMARY);
  journeySpies.getContentCourses.mockResolvedValue(CONTENT_COURSES);
  journeySpies.getCoursePage.mockResolvedValue(COURSE_PAGE);
  journeySpies.getCourseSellPreview.mockResolvedValue(SELL_PREVIEW);
  journeySpies.getCourseDashboard.mockResolvedValue(DASHBOARD);
  journeySpies.getInCoursePractice.mockResolvedValue(MEDIA_PRACTICE);
  journeySpies.recordPracticeCompletion.mockResolvedValue(COMPLETION_RECORD);
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
    expect(journeySpies.getCoursePage).toHaveBeenCalledWith(ORG_ID, SLUG);
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
    expect(journeySpies.getCoursePage).toHaveBeenCalledWith(ORG_ID, SLUG);
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
