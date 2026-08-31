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
import type { CourseOffer, JourneyCoursePage } from '$lib/page-builder';
import { deriveOfferPaths } from '$lib/page-builder/offer-paths';
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

/**
 * The authoritative offer the `invite` section prices itself from
 * (Codex-2pryk.2.4.3). Read in parallel with the enrolment check.
 */
const MOCK_OFFER = {
  courseId: MOCK_COURSE_PAGE.course.id,
  organizationId: MOCK_COURSE_PAGE.page.organizationId,
  paths: ['purchase'],
  purchase: { priceCents: 2499 },
  subscription: null,
  tiers: [],
  entitled: false,
} satisfies CourseOffer;

const {
  getCoursePageMock,
  getCoursePagePreviewMock,
  resolveSellPreviewMock,
  resolveCanEnterCourseMock,
  offerMock,
} = vi.hoisted(() => ({
  getCoursePageMock: vi.fn(),
  getCoursePagePreviewMock: vi.fn(),
  resolveSellPreviewMock: vi.fn(),
  resolveCanEnterCourseMock: vi.fn(),
  offerMock: vi.fn(),
}));

vi.mock('../journey-data', () => ({
  getCoursePage: getCoursePageMock,
  getCoursePagePreview: getCoursePagePreviewMock,
  resolveSellPreview: resolveSellPreviewMock,
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: () => ({ courses: { offer: offerMock } }),
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

function makeEvent(
  journeySlug: string,
  user: { id: string } | null = null,
  // Query string (no leading `?`). `preview=1` is the builder's View-live opt-out
  // from the entitled→dashboard redirect (Codex-aectb).
  search = ''
) {
  const setHeaders = vi.fn();
  const depends = vi.fn();
  const event = {
    params: { slug: 'acme', journeySlug },
    parent: async () => ({ user }),
    setHeaders,
    depends,
    url: new URL(
      `http://acme.lvh.me:3000/journeys/${journeySlug}${search ? `?${search}` : ''}`
    ),
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
    offerMock.mockResolvedValue(MOCK_OFFER);
  });

  // ── the authoritative offer (Codex-2pryk.2.4.3) ────────────────────────────
  // The `invite` section used to price itself from the authored `priceLabel` a
  // creator typed into the builder, so a page could advertise a price and a path
  // that did not exist. It now renders THIS.

  it('awaits the offer and returns it for the invite section to price from', async () => {
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork');

    const data = (await load(event)) as LoadData;

    expect(offerMock).toHaveBeenCalledWith(MOCK_COURSE_PAGE.course.id);
    expect(data.offer).toEqual(MOCK_OFFER);
  });

  it('degrades the offer to null (never a wrong price) when the read fails', async () => {
    offerMock.mockRejectedValueOnce(new Error('ecom down'));
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork');

    // The sell page is SEO-critical and must not 500 over a pricing hiccup; the
    // section shows a price-less CTA and the checkout states the terms.
    const data = (await load(event)) as LoadData;
    expect(data.offer).toBeNull();
    expect(data.coursePage).toBe(MOCK_COURSE_PAGE);
  });

  it('reads the offer for an anonymous visitor too (prices are public)', async () => {
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork'); // no user

    const data = (await load(event)) as LoadData;

    // Unlike the enrolment check, the offer is NOT skipped for a guest — an
    // anonymous visitor is exactly who the prices are for.
    expect(offerMock).toHaveBeenCalledTimes(1);
    expect(data.offer?.paths).toEqual(['purchase']);
  });

  /**
   * THE LOAD-LEVEL GUARD FOR `purchasable` (WP-1's handoff, WP-G's file).
   *
   * `JourneyRenderer` derives `purchasable` as
   * `offer === null ? true : deriveOfferPaths(offer, course).length > 0`, and
   * that flag decides whether the hero CTA and the floating pill exist at all.
   * Every assertion above stops at the ENVELOPE — `data.offer.paths` is
   * `['purchase']` — which is one derivation short of the thing that matters: a
   * `paths` entry with no matching `purchase`/`subscription`/`tiers` payload
   * enumerates to ZERO paths, so the load could return a perfectly well-shaped
   * offer and still strip the buy button off a purchasable page.
   *
   * So this runs the REAL derivation the renderer runs, over what the load
   * actually returned. `deriveOfferPaths` is deliberately called exactly as
   * `JourneyRenderer` calls it — without the authored `invite` decorations,
   * which may rename a path but never create one.
   */
  it('returns an offer the renderer can derive at least one real path from', async () => {
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork');

    const data = (await load(event)) as LoadData;

    const paths = deriveOfferPaths(data.offer, MOCK_COURSE_PAGE.course);
    expect(paths.length).toBeGreaterThan(0);
    // And the price the renderer will show comes from the OFFER (2499), not the
    // course row (4900) — the two disagree in this fixture on purpose.
    expect(paths[0]).toMatchObject({ id: 'purchase', priceCents: 2499 });
    // The predicate itself, spelled out, so the guard reads as what it defends.
    expect(data.offer === null ? true : paths.length > 0).toBe(true);
  });

  it('a well-shaped offer whose paths back NOTHING derives to zero (the trap)', async () => {
    // The negative control for the case above, and the reason asserting
    // `data.offer.paths` is not enough: `paths: ['purchase']` with
    // `purchase: null` is a legal envelope that enumerates to nothing, and the
    // renderer would correctly suppress every CTA. If a future load ever
    // returned this shape for a priced course, the test above is what catches
    // it — this one proves that test is not vacuous.
    offerMock.mockResolvedValueOnce({
      ...MOCK_OFFER,
      paths: ['purchase'],
      purchase: null,
    } satisfies CourseOffer);
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork');

    const data = (await load(event)) as LoadData;

    expect(data.offer?.paths).toEqual(['purchase']);
    expect(deriveOfferPaths(data.offer, MOCK_COURSE_PAGE.course)).toHaveLength(
      0
    );
  });

  // ── pageMeta: the tags the ROOT LAYOUT renders on this page's behalf (O32) ──
  // `routes/+layout.svelte` emitted `description` + `og:type` unconditionally
  // and `<svelte:head>` dedupes only `<title>`, so a page that set its own got
  // TWO tags — root first. A parser takes the FIRST value of a repeated Open
  // Graph property, so the page's `og:type="product"` was dead and every journey
  // snippet was shadowed by the platform tagline. The root now renders one of
  // each FROM THIS BAG, which is why the description is derived here and not in
  // `+page.svelte`.
  describe('pageMeta', () => {
    it('declares the product vertical for the root layout to render', async () => {
      const { load } = await import('../+page.server');
      const { event } = makeEvent('rootwork');

      const data = (await load(event)) as LoadData;

      expect(data.pageMeta.ogType).toBe('product');
    });

    it('prefers the authored seo description', async () => {
      getCoursePageMock.mockResolvedValueOnce({
        ...MOCK_COURSE_PAGE,
        page: { ...MOCK_COURSE_PAGE.page, seo: { description: 'Slow work.' } },
        course: { ...MOCK_COURSE_PAGE.course, lede: 'The lede beneath it.' },
      });
      const { load } = await import('../+page.server');
      const { event } = makeEvent('rootwork');

      const data = (await load(event)) as LoadData;

      expect(data.pageMeta.description).toBe('Slow work.');
    });

    it('falls back to the lede when the seo description is CLEARED to ""', async () => {
      // The case a naive `??` gets wrong: the key is PRESENT, so `??` keeps `''`
      // and the page ships `<meta name="description" content="">`. A creator must
      // be able to undo their own override.
      getCoursePageMock.mockResolvedValueOnce({
        ...MOCK_COURSE_PAGE,
        page: { ...MOCK_COURSE_PAGE.page, seo: { description: '' } },
        course: {
          ...MOCK_COURSE_PAGE.course,
          lede: 'The lede that must come back.',
        },
      });
      const { load } = await import('../+page.server');
      const { event } = makeEvent('rootwork');

      const data = (await load(event)) as LoadData;

      expect(data.pageMeta.description).toBe('The lede that must come back.');
    });

    it('extracts plain text from a TipTap lede', async () => {
      getCoursePageMock.mockResolvedValueOnce({
        ...MOCK_COURSE_PAGE,
        course: {
          ...MOCK_COURSE_PAGE.course,
          lede: JSON.stringify({
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Close to the bone.' }],
              },
            ],
          }),
        },
      });
      const { load } = await import('../+page.server');
      const { event } = makeEvent('rootwork');

      const data = (await load(event)) as LoadData;

      // A raw TipTap document in a meta description is worse than none — it is
      // JSON in a search snippet.
      expect(data.pageMeta.description).toBe('Close to the bone.');
    });

    it('falls back when a lede is STRUCTURALLY present but has no text', async () => {
      // The gap the previous shape (`course.lede ? extractPlainText(...) : …`)
      // left open: an empty TipTap doc is a truthy string, so it took the first
      // branch and `extractPlainText` returned '' — an empty description, from a
      // course that has a perfectly good title.
      getCoursePageMock.mockResolvedValueOnce({
        ...MOCK_COURSE_PAGE,
        course: {
          ...MOCK_COURSE_PAGE.course,
          lede: JSON.stringify({ type: 'doc', content: [] }),
        },
      });
      const { load } = await import('../+page.server');
      const { event } = makeEvent('rootwork');

      const data = (await load(event)) as LoadData;

      expect(data.pageMeta.description).toBe('Rootwork — a guided course.');
    });

    it('falls back to the course title when there is no lede at all', async () => {
      const { load } = await import('../+page.server');
      const { event } = makeEvent('rootwork'); // MOCK fixture has lede: null

      const data = (await load(event)) as LoadData;

      expect(data.pageMeta.description).toBe('Rootwork — a guided course.');
    });
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

  it('resolves enrolled=true for an entitled member (CTA → dashboard)', async () => {
    resolveCanEnterCourseMock.mockResolvedValueOnce(true);
    const { load } = await import('../+page.server');
    // `preview=1` so the load RETURNS rather than 303-ing to the dashboard
    // (Codex-aectb) — this case is about the flag the CTA reads, and the preview
    // bypass is the one path on which an entitled viewer still sees the page.
    const { event } = makeEvent('rootwork', { id: 'user-1' }, 'preview=1');

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

  // ── Entitled → dashboard redirect (Codex-aectb) ─────────────────────────────
  // Owning the course used to earn you the marketing page with a relabelled CTA.
  // It now 303s to the dashboard.
  //
  // NOTE ON THE MOCKING: `@sveltejs/kit` is deliberately NOT mocked, so these
  // assertions run against the REAL `redirect()`, which THROWS. A hand-rolled
  // `redirect` spy that merely records its arguments would let the guarded code
  // run on to the `return`, and every case below would pass vacuously.
  describe('entitled → dashboard redirect', () => {
    /** The location the sell page must send an entitled viewer to. */
    const DASHBOARD_URL = '/journeys/rootwork/dashboard';

    it('303s an entitled viewer to their course dashboard', async () => {
      resolveCanEnterCourseMock.mockResolvedValueOnce(true);
      const { load } = await import('../+page.server');
      const { event } = makeEvent('rootwork', { id: 'user-1' });

      // Root-relative: the org slug lives in the hostname (we are already on
      // acme.lvh.me), so `buildJourneyUrl` must not emit an absolute URL.
      await expect(load(event)).rejects.toMatchObject({
        status: 303,
        location: DASHBOARD_URL,
      });
    });

    it('targets the COURSE slug, not the landing-page slug', async () => {
      // The two are authored independently and can diverge. The dashboard
      // resolves its course by the COURSE slug (`resolveCourseBySlug`), so a
      // redirect built from the page slug would 404 on arrival.
      getCoursePageMock.mockResolvedValueOnce({
        ...MOCK_COURSE_PAGE,
        page: { ...MOCK_COURSE_PAGE.page, slug: 'rootwork-landing' },
        course: { ...MOCK_COURSE_PAGE.course, slug: 'rootwork-course' },
      } satisfies JourneyCoursePage);
      resolveCanEnterCourseMock.mockResolvedValueOnce(true);
      const { load } = await import('../+page.server');
      const { event } = makeEvent('rootwork-landing', { id: 'user-1' });

      await expect(load(event)).rejects.toMatchObject({
        status: 303,
        location: '/journeys/rootwork-course/dashboard',
      });
    });

    it('renders the sales page when the course has no slug (no reachable target)', async () => {
      // `buildJourneyUrl` would fall back to the course id, and the dashboard
      // resolves by slug only — so `/journeys/<uuid>/dashboard` is a 404 the
      // visitor could not escape, since every retry of this page would 303 them
      // back into it. No confident target ⇒ render, same as a failed lookup.
      //
      // Deliberately not `satisfies JourneyCoursePage`: `JourneyCourseView.slug`
      // is typed `string`, so this fixture models a FUTURE relaxation of that DTO
      // — which is the whole reason the guard exists, `apps/web` having
      // strictNullChecks off and no warning to give.
      getCoursePageMock.mockResolvedValueOnce({
        ...MOCK_COURSE_PAGE,
        course: { ...MOCK_COURSE_PAGE.course, slug: null },
      });
      resolveCanEnterCourseMock.mockResolvedValueOnce(true);
      const { load } = await import('../+page.server');
      const { event } = makeEvent('rootwork', { id: 'user-1' });

      const data = (await load(event)) as LoadData;

      expect(data.enrolled).toBe(true);
      expect(data.coursePage.course.slug).toBeNull();
    });

    it('renders the sales page for an anonymous visitor (never redirects)', async () => {
      const { load } = await import('../+page.server');
      const { event } = makeEvent('rootwork'); // no session

      // Resolving at all proves no redirect — the real `redirect()` throws.
      const data = (await load(event)) as LoadData;

      expect(data.coursePage).toBe(MOCK_COURSE_PAGE);
      expect(data.enrolled).toBe(false);
      // The SEO-critical anonymous path never pays for the worker round-trip.
      expect(resolveCanEnterCourseMock).not.toHaveBeenCalled();
    });

    it('renders the sales page for a signed-in visitor who is NOT entitled', async () => {
      resolveCanEnterCourseMock.mockResolvedValueOnce(false);
      const { load } = await import('../+page.server');
      const { event } = makeEvent('rootwork', { id: 'window-shopper' });

      const data = (await load(event)) as LoadData;

      expect(data.enrolled).toBe(false);
      expect(data.coursePage).toBe(MOCK_COURSE_PAGE);
    });

    it('renders the sales page for an entitled viewer when ?preview=1 is set', async () => {
      resolveCanEnterCourseMock.mockResolvedValueOnce(true);
      const { load } = await import('../+page.server');
      const { event } = makeEvent('rootwork', { id: 'creator-1' }, 'preview=1');

      // The builder's View-live link carries this. A creator who also holds the
      // course must see the page they just edited, not their own dashboard.
      const data = (await load(event)) as LoadData;

      expect(data.enrolled).toBe(true);
      expect(data.coursePage).toBe(MOCK_COURSE_PAGE);
    });

    it('renders the sales page for an entitled viewer previewing a DRAFT', async () => {
      // `draftPreview` is only ever true when the management-gated preview read
      // succeeded, so it is already proof the viewer is an org manager — it
      // bypasses the redirect without any extra role query.
      getCoursePageMock.mockResolvedValueOnce(null);
      getCoursePagePreviewMock.mockResolvedValueOnce({
        ...MOCK_COURSE_PAGE,
        page: { ...MOCK_COURSE_PAGE.page, status: 'draft', publishedAt: null },
      } satisfies JourneyCoursePage);
      resolveCanEnterCourseMock.mockResolvedValueOnce(true);
      const { load } = await import('../+page.server');
      const { event } = makeEvent('rootwork', { id: 'manager-1' }); // no ?preview

      const data = (await load(event)) as LoadData;

      expect(data.draftPreview).toBe(true);
      expect(data.enrolled).toBe(true);
    });

    it('renders the sales page when the entitlement resolver THROWS', async () => {
      resolveCanEnterCourseMock.mockRejectedValueOnce(new Error('access down'));
      const { load } = await import('../+page.server');
      const { event } = makeEvent('rootwork', { id: 'user-1' });

      // Only redirect on a positive, confident signal; on doubt, render where you
      // are. This is the half of the invariant that makes the sell↔dashboard pair
      // loop-free: a flaky resolver leaves the user ON the sales page, so nothing
      // can bounce them around a cycle.
      const data = (await load(event)) as LoadData;

      expect(data.enrolled).toBe(false);
      expect(data.coursePage).toBe(MOCK_COURSE_PAGE);
    });
  });
});
