/**
 * Journey checkout — order summary + server-load contract (Codex-2pryk.3.6;
 * offer rewire Codex-2pryk.2.4.3).
 *
 * Two suites, both Neon-free:
 *   1. the order-summary derivation (`../checkout-offer-model`) — the factual,
 *      DB-derived "what's inside" lines.
 *   2. the server `load` shell — mocks the `../journey-data` seam (mirrors the
 *      sell page test) AND the offer read, to lock: the offer is the source of
 *      every price, `entitled` comes from that same read, a failed read does NOT
 *      render a pay page, 404 on a missing page, and the PRIVATE (never
 *      shared-cacheable) header.
 *
 * The OFFER DERIVATION itself is tested at `$lib/page-builder/offer-paths.test.ts`
 * — it is shared with the sell page's `invite` section, which had the same bug.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CourseOffer,
  JourneyCoursePage,
  JourneyCourseView,
  JourneyPageRecord,
} from '$lib/page-builder';
import { CACHE_HEADERS } from '$lib/server/cache';
import { ApiError } from '$lib/server/errors';
import { deriveCourseSummary } from '../checkout-offer-model';

const TIER_ID = '33f6c1a1-bb69-4902-b24a-4365170c022c';

const COURSE: JourneyCourseView = {
  id: '00000000-0000-4000-8000-0000000000c0',
  slug: 'rootwork',
  title: 'Rootwork',
  kicker: 'A guided descent',
  lede: null,
  status: 'published',
  priceCents: 4900,
  stageCount: 2,
  practiceCount: 5,
};

/**
 * The offer as the ecom read returns it. Note `purchase.priceCents` (2499)
 * deliberately DISAGREES with the stale `course.priceCents` (4900) carried by the
 * page envelope: the checkout must price from the offer, and this fixture makes
 * a regression to `course.priceCents` visible rather than coincidentally right.
 */
const OFFER: CourseOffer = {
  courseId: COURSE.id,
  organizationId: '00000000-0000-4000-8000-000000000001',
  paths: ['purchase', 'subscription', 'tier'],
  purchase: { priceCents: 2499 },
  subscription: {
    planId: '00000000-0000-4000-8000-0000000000f1',
    priceMonthly: 2700,
    priceAnnual: 27000,
  },
  tiers: [
    {
      tierId: TIER_ID,
      tierName: 'Soul Path',
      priceMonthly: 1500,
      priceAnnual: 14400,
    },
  ],
  entitled: false,
};

/** The authored copy that used to BE the catalogue — now decoration at most. */
const AUTHORED_OFFERS = [
  {
    id: 'membership',
    name: 'Full membership',
    priceLabel: '£12',
    per: 'month',
    best: true,
  },
  {
    id: 'course-sub',
    name: 'Rootwork monthly',
    priceLabel: '£6',
    per: 'month',
  },
  { id: 'one-off', name: 'Own Rootwork', per: 'once' },
];

function pageWith(sections: JourneyPageRecord['sections']): JourneyPageRecord {
  return {
    id: '00000000-0000-4000-8000-0000000000a0',
    organizationId: '00000000-0000-4000-8000-000000000001',
    publishedAt: '2026-05-01T09:00:00.000Z',
    pageType: 'course',
    slug: 'rootwork',
    title: 'Rootwork',
    status: 'published',
    subjectType: 'course',
    subjectId: COURSE.id,
    brandOverrides: null,
    sections,
  } as unknown as JourneyPageRecord;
}

const inviteWithOffers = pageWith([
  {
    id: 'sec-invite',
    type: 'invite',
    enabled: true,
    props: { priceNote: 'VAT included', offers: AUTHORED_OFFERS },
  },
]);

const STAGES = [
  { practices: [{ contentType: 'video' }, { contentType: 'written' }] },
  { practices: [{ contentType: 'video' }, { contentType: 'audio' }] },
];

describe('checkout-offer-model · deriveCourseSummary', () => {
  it('builds DB-derived facts: counts, content mix, and an invitation', () => {
    const summary = deriveCourseSummary(COURSE, STAGES);

    expect(summary.kicker).toBe('A guided descent');
    expect(summary.title).toBe('Rootwork');
    expect(summary.bullets[0]).toBe('5 practices across 2 stages');
    expect(summary.bullets.some((b) => b.includes('practice'))).toBe(true);
    // First-seen order across stages: video → written → audio.
    expect(summary.bullets).toContain('Video, written & audio practice');
    expect(summary.bullets.at(-1)).toBe(
      'Yours to return to, as often as you need'
    );
  });

  it('uses a neutral kicker fallback and omits count/mix lines when absent', () => {
    const bare = { ...COURSE, kicker: null, stageCount: 0, practiceCount: 0 };
    const summary = deriveCourseSummary(bare, []);
    expect(summary.kicker).toBe('The course');
    expect(summary.bullets).toEqual([
      'Yours to return to, as often as you need',
    ]);
  });
});

// ── server load shell ────────────────────────────────────────────────────────

const MOCK_COURSE_PAGE = {
  page: inviteWithOffers,
  course: COURSE,
  stages: STAGES,
  testimonials: [
    {
      id: 't1',
      quote: 'It met my body where it was.',
      authorName: 'A member',
      authorContext: 'six months in',
      sortOrder: 0,
    },
  ],
} as unknown as JourneyCoursePage;

const { getCoursePageMock, offerMock, resolveCanEnterCourseMock } = vi.hoisted(
  () => ({
    getCoursePageMock: vi.fn(),
    offerMock: vi.fn(),
    resolveCanEnterCourseMock: vi.fn(),
  })
);

vi.mock('../../journey-data', () => ({
  getCoursePage: getCoursePageMock,
}));

// The authoritative offer read. Mocked at the API-client boundary so the load's
// error handling (404 vs unavailable) is exercised against real `ApiError`s.
vi.mock('$lib/server/api', () => ({
  createServerApi: () => ({ courses: { offer: offerMock } }),
}));

// Still mocked so the assertion that it is NO LONGER CALLED can fail loudly if
// the round-trip comes back — `offer.entitled` resolves the same entitlement.
vi.mock('$lib/server/journeys/round-d-seam', () => ({
  resolveCanEnterCourse: resolveCanEnterCourseMock,
}));

type LoadInput = Parameters<typeof import('../+page.server').load>[0];
type LoadData = Extract<
  Awaited<ReturnType<typeof import('../+page.server').load>>,
  object
>;

function makeEvent(
  journeySlug: string,
  {
    user = null,
    offer = null,
  }: { user?: { id: string } | null; offer?: string | null } = {}
) {
  const setHeaders = vi.fn();
  const url = new URL(
    `http://acme.lvh.me:3000/journeys/${journeySlug}/checkout`
  );
  if (offer) url.searchParams.set('offer', offer);
  const event = {
    params: { slug: 'acme', journeySlug },
    parent: async () => ({ user }),
    setHeaders,
    url,
    platform: {},
    cookies: {},
  } as unknown as LoadInput;
  return { event, setHeaders };
}

describe('journey checkout +page.server load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCoursePageMock.mockResolvedValue(MOCK_COURSE_PAGE);
    offerMock.mockResolvedValue(OFFER);
    resolveCanEnterCourseMock.mockResolvedValue(false);
  });

  it('prices every way in from the offer read, never from authored copy', async () => {
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork');

    const data = (await load(event)) as LoadData;

    expect(offerMock).toHaveBeenCalledWith(COURSE.id);
    expect(data.offers.map((o) => o.id)).toEqual([
      'purchase',
      'subscription-monthly',
      'subscription-annual',
      `tier:${TIER_ID}`,
    ]);
    expect(data.offers.map((o) => o.priceCents)).toEqual([
      2499, 2700, 27000, 1500,
    ]);
    // The authored teasers that used to BE this catalogue are gone: none of them
    // names a canonical path, and their hand-typed prices never applied anyway.
    const rendered = JSON.stringify(data.offers);
    expect(rendered).not.toContain('£12');
    expect(rendered).not.toContain('Full membership');
    // The stale one-off on the page envelope must not leak in either.
    expect(rendered).not.toContain('£49');
  });

  it('returns the summary, head note, price note, proof and preselection', async () => {
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork', { offer: 'subscription-annual' });

    const data = (await load(event)) as LoadData;

    expect(getCoursePageMock).toHaveBeenCalledWith({ slug: 'rootwork' });
    expect(data.orgSlug).toBe('acme');
    expect(data.summary.bullets[0]).toBe('5 practices across 2 stages');
    // Three PATHS, four cards — the note counts ways in.
    expect(data.headNote).toBe('One course. Three ways in.');
    expect(data.priceNote).toBe('VAT included');
    expect(data.testimonial?.authorName).toBe('A member');
    expect(data.preselectedOfferId).toBe('subscription-annual');
  });

  it('reads `enrolled` from the offer and never round-trips the resolver', async () => {
    offerMock.mockResolvedValueOnce({ ...OFFER, entitled: true });
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork', { user: { id: 'u1' } });

    const data = (await load(event)) as LoadData;

    expect(data.enrolled).toBe(true);
    // `getCourseOffer` resolves entitlement through the SAME
    // `hasCourseEntitlement` the seam called — a second call would be pure cost,
    // and its `.catch(() => false)` used to demote an entitled viewer.
    expect(resolveCanEnterCourseMock).not.toHaveBeenCalled();
  });

  it('reports an anonymous viewer as not entitled', async () => {
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork');

    const data = (await load(event)) as LoadData;

    expect(data.enrolled).toBe(false);
  });

  it('offers nothing when the course has no purchasable path', async () => {
    offerMock.mockResolvedValueOnce({
      ...OFFER,
      paths: [],
      purchase: null,
      subscription: null,
      tiers: [],
    });
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork');

    const data = (await load(event)) as LoadData;

    // The view renders "isn't open for enrolment" — NOT a fabricated price.
    expect(data.offers).toEqual([]);
    expect(data.headNote).toBeUndefined();
    expect(data.preselectedOfferId).toBe('');
  });

  it('locks the PRIVATE (never shared-cacheable) header', async () => {
    const { load } = await import('../+page.server');
    const { event, setHeaders } = makeEvent('rootwork');

    await load(event);

    expect(setHeaders).toHaveBeenCalledTimes(1);
    expect(setHeaders).toHaveBeenCalledWith(CACHE_HEADERS.PRIVATE);
    const [[headers]] = setHeaders.mock.calls;
    expect(headers['Cache-Control']).toBe('private, no-cache');
    expect(headers['Cache-Control']).not.toMatch(/public|s-maxage/);
  });

  it('throws 404 when no published page matches the slug', async () => {
    getCoursePageMock.mockResolvedValueOnce(null);
    const { load } = await import('../+page.server');
    const { event } = makeEvent('does-not-exist');

    await expect(load(event)).rejects.toMatchObject({ status: 404 });
    expect(offerMock).not.toHaveBeenCalled();
  });

  it('refuses to render a pay page when the offer read is unavailable', async () => {
    offerMock.mockRejectedValueOnce(new Error('ecom down'));
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork');

    // Degrading to "no ways in" here would tell a buyer the course is closed;
    // degrading to authored copy would quote a price we cannot honour. 503.
    await expect(load(event)).rejects.toMatchObject({ status: 503 });
  });

  it('surfaces a missing course behind a published page as a 404, not a 503', async () => {
    offerMock.mockRejectedValueOnce(
      new ApiError(404, 'Course not found', 'NOT_FOUND')
    );
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork');

    await expect(load(event)).rejects.toMatchObject({ status: 404 });
  });
});
