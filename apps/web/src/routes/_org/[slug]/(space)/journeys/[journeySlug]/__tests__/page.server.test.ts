/**
 * Public journey sales page — server load (Codex-2pryk.3.1 · WP-3).
 *
 * Locks the shell+stream contract:
 *   - the course page is AWAITED (SEO / first paint);
 *   - the sell-preview is STREAMED as a bare, `.catch()`-guarded promise off the
 *     critical path (a media-resolver failure degrades to null, never rejects
 *     the load);
 *   - a missing published page → 404.
 *
 * The `../journey-data` seam is mocked so the load's shell/stream wiring is
 * tested in isolation from the (currently mocked) data source. Neon-free.
 *
 * Lives in `__tests__/` (not a `+`-prefixed route file — SvelteKit reserves
 * those); mirrors the explore page-load test precedent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JourneyCoursePage } from '$lib/page-builder';
import type { SellPreview } from '$lib/page-builder/render';
import { CACHE_HEADERS } from '$lib/server/cache';

// Contract-shaped fixtures (inlined — the WP-3 `journey-page.mock` was deleted
// at integration). This test mocks the `../journey-data` seam, so it exercises
// only the load's shell/stream wiring; these fixtures just flow through it. The
// load reads `page.id` + `course.id` to build the streamed preview args.
const MOCK_COURSE_PAGE = {
  page: {
    id: '00000000-0000-4000-8000-0000000000a0',
    organizationId: '00000000-0000-4000-8000-000000000001',
    publishedAt: '2026-05-01T09:00:00.000Z',
    pageType: 'course',
    slug: 'rootwork',
    title: 'Rootwork',
    status: 'published',
    subjectType: 'course',
    subjectId: '00000000-0000-4000-8000-0000000000c0',
    brandOverrides: null,
    sections: [],
  },
  course: {
    id: '00000000-0000-4000-8000-0000000000c0',
    slug: 'rootwork',
    title: 'Rootwork',
    kicker: null,
    lede: null,
    status: 'published',
    priceCents: 4900,
    stageCount: 0,
    practiceCount: 0,
  },
  stages: [],
  testimonials: [],
} satisfies JourneyCoursePage;

const MOCK_SELL_PREVIEW = {
  intro: {
    playlistUrl: '/cdn/preview/rootwork-intro/preview.m3u8',
    posterUrl: null,
    durationSeconds: 90,
  },
  reel: {
    playlistUrl: '/cdn/preview/rootwork-reel/preview.m3u8',
    posterUrl: null,
    durationSeconds: 30,
  },
} satisfies SellPreview;

const {
  getCoursePageMock,
  getCoursePagePreviewMock,
  resolveSellPreviewMock,
  resolveCanEnterCourseMock,
} = vi.hoisted(() => ({
  getCoursePageMock: vi.fn(),
  getCoursePagePreviewMock: vi.fn(),
  resolveSellPreviewMock: vi.fn(),
  resolveCanEnterCourseMock: vi.fn(),
}));

vi.mock('../journey-data', () => ({
  getCoursePage: getCoursePageMock,
  getCoursePagePreview: getCoursePagePreviewMock,
  resolveSellPreview: resolveSellPreviewMock,
}));

// The enrolment check that flips the hero/invite CTA (anon → checkout; enrolled
// → dashboard). Mocked so the load's CTA-branch wiring is tested without a
// content-api round-trip.
vi.mock('$lib/server/journeys/round-d-seam', () => ({
  resolveCanEnterCourse: resolveCanEnterCourseMock,
}));

// NOTE: `$lib/server/cache` is intentionally NOT mocked — the assertion below
// locks the sell page's cache decision against the REAL `CACHE_HEADERS.PRIVATE`
// constant, so a regression to a shared-cacheable header fails this test.

type LoadInput = Parameters<typeof import('../+page.server').load>[0];

// `load` is typed `PageServerLoad`, whose return union includes `void`; this
// load always resolves to the data object (or throws), so filter `void` off the
// awaited union for the property assertions below.
type LoadData = Extract<
  Awaited<ReturnType<typeof import('../+page.server').load>>,
  object
>;

function makeEvent(journeySlug: string, user: { id: string } | null = null) {
  const setHeaders = vi.fn();
  const depends = vi.fn();
  const event = {
    params: { slug: 'acme', journeySlug },
    parent: async () => ({ user }),
    setHeaders,
    depends,
    url: new URL(`http://acme.lvh.me:3000/journeys/${journeySlug}`),
    // Present so the load can build a round-d-seam context (the seam is mocked).
    platform: {},
    cookies: {},
    // The draft-preview fallback gates on `locals.user`, not the parent's — keep
    // them in step so a signed-in event exercises that branch.
    locals: user ? { user } : {},
  } as unknown as LoadInput;
  return { event, setHeaders, depends };
}

describe('journey sales +page.server load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCoursePageMock.mockResolvedValue(MOCK_COURSE_PAGE);
    getCoursePagePreviewMock.mockResolvedValue(null);
    resolveSellPreviewMock.mockResolvedValue(MOCK_SELL_PREVIEW);
    resolveCanEnterCourseMock.mockResolvedValue(false);
  });

  it('awaits the course page and returns it for first paint / SEO', async () => {
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork');

    const data = (await load(event)) as LoadData;

    expect(getCoursePageMock).toHaveBeenCalledWith({ slug: 'rootwork' });
    expect(data.coursePage).toBe(MOCK_COURSE_PAGE);
    expect(data.orgSlug).toBe('acme');
  });

  it('registers the version-cache dependency and locks the PRIVATE (never shared-cacheable) header', async () => {
    const { load } = await import('../+page.server');
    const { event, setHeaders, depends } = makeEvent('rootwork');

    await load(event);

    expect(depends).toHaveBeenCalledWith('cache:versions');
    // The sell shell is auth-varying (the org layout injects `user`) and shared
    // caches key by URL, not Cookie — so the response MUST be private and never
    // public / s-maxage (the content-detail bug class). Assert the exact header
    // the load commits, against the REAL constant, so a regression to a
    // shared-cacheable header fails here.
    expect(setHeaders).toHaveBeenCalledTimes(1);
    expect(setHeaders).toHaveBeenCalledWith(CACHE_HEADERS.PRIVATE);
    const [[headers]] = setHeaders.mock.calls;
    expect(headers['Cache-Control']).toBe('private, no-cache');
    expect(headers['Cache-Control']).not.toMatch(/public|s-maxage/);
  });

  it('streams the sell-preview as a promise (off the critical path)', async () => {
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork');

    const data = (await load(event)) as LoadData;

    expect(data.sellPreview).toBeInstanceOf(Promise);
    await expect(data.sellPreview).resolves.toBe(MOCK_SELL_PREVIEW);
    expect(resolveSellPreviewMock).toHaveBeenCalledWith({
      pageId: MOCK_COURSE_PAGE.page.id,
      courseId: MOCK_COURSE_PAGE.course.id,
    });
  });

  it('.catch()-guards the streamed preview so a resolver failure degrades to null', async () => {
    resolveSellPreviewMock.mockRejectedValueOnce(
      new Error('media resolver down')
    );
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork');

    const data = (await load(event)) as LoadData;

    // The load already returned; the streamed promise must not reject.
    await expect(data.sellPreview).resolves.toBeNull();
  });

  it('throws 404 when no published page matches the slug', async () => {
    getCoursePageMock.mockResolvedValueOnce(null);
    const { load } = await import('../+page.server');
    const { event } = makeEvent('does-not-exist');

    await expect(load(event)).rejects.toMatchObject({ status: 404 });
  });

  it('skips the enrolment check for an anonymous visitor (enrolled=false)', async () => {
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork'); // no user

    const data = (await load(event)) as LoadData;

    // No session ⇒ definitionally not enrolled; the worker round-trip is skipped
    // entirely so the SEO-critical anonymous path never blocks on it.
    expect(data.enrolled).toBe(false);
    expect(resolveCanEnterCourseMock).not.toHaveBeenCalled();
  });

  it('resolves enrolled=true for an enrolled member (CTA → dashboard)', async () => {
    resolveCanEnterCourseMock.mockResolvedValueOnce(true);
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork', { id: 'user-1' });

    const data = (await load(event)) as LoadData;

    expect(resolveCanEnterCourseMock).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      MOCK_COURSE_PAGE.course.id
    );
    expect(data.enrolled).toBe(true);
  });

  it('degrades to enrolled=false when the entitlement check throws', async () => {
    resolveCanEnterCourseMock.mockRejectedValueOnce(new Error('resolver down'));
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork', { id: 'user-1' });

    const data = (await load(event)) as LoadData;

    // A resolver hiccup must never throw the SEO-critical load — it degrades to
    // the public/join CTA.
    expect(data.enrolled).toBe(false);
  });

  // ── Draft preview vs LIVE (Codex-xzwl5) ───────────────────────────────────
  // A manager viewing an unpublished journey got an apparently live page with
  // nothing saying otherwise ("I am not sure if live pages are preview pages").
  // Which read served the page is the only signal, so the load must publish it.
  describe('draft-preview flag', () => {
    const DRAFT_COURSE_PAGE = {
      ...MOCK_COURSE_PAGE,
      page: { ...MOCK_COURSE_PAGE.page, status: 'draft', publishedAt: null },
    } satisfies JourneyCoursePage;

    it('marks the page as a draft preview when the management read served it', async () => {
      getCoursePageMock.mockResolvedValueOnce(null);
      getCoursePagePreviewMock.mockResolvedValueOnce(DRAFT_COURSE_PAGE);
      const { load } = await import('../+page.server');
      const { event } = makeEvent('rootwork', { id: 'manager-1' });

      const data = (await load(event)) as LoadData;

      expect(getCoursePagePreviewMock).toHaveBeenCalledWith({
        slug: 'rootwork',
      });
      expect(data.draftPreview).toBe(true);
      // The view keys its banner + noindex off the page status it carries.
      expect(data.coursePage.page.status).toBe('draft');
    });

    it('does NOT mark the live page as a preview (the published read served it)', async () => {
      const { load } = await import('../+page.server');
      const { event } = makeEvent('rootwork', { id: 'manager-1' });

      const data = (await load(event)) as LoadData;

      // Preview and live must be distinguishable in BOTH directions — a banner
      // on the live page would be as confusing as none on the draft.
      expect(data.draftPreview).toBe(false);
      expect(getCoursePagePreviewMock).not.toHaveBeenCalled();
    });

    it('stays false (and 404s) when the preview read denies a non-manager', async () => {
      getCoursePageMock.mockResolvedValueOnce(null);
      getCoursePagePreviewMock.mockResolvedValueOnce(null);
      const { load } = await import('../+page.server');
      const { event } = makeEvent('rootwork', { id: 'outsider-1' });

      await expect(load(event)).rejects.toMatchObject({ status: 404 });
    });

    it('never reaches the preview read for an anonymous visitor', async () => {
      getCoursePageMock.mockResolvedValueOnce(null);
      const { load } = await import('../+page.server');
      const { event } = makeEvent('rootwork'); // no session

      await expect(load(event)).rejects.toMatchObject({ status: 404 });
      expect(getCoursePagePreviewMock).not.toHaveBeenCalled();
    });
  });
});
