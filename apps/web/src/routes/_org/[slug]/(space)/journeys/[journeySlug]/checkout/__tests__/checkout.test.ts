/**
 * Journey checkout — offer model + server-load contract (Codex-2pryk.3.6).
 *
 * Two suites, both Neon-free:
 *   1. the PURE offer/summary derivation (`../checkout-offer-model`) — the
 *      load-bearing logic that turns the frozen `getCoursePage` envelope into the
 *      presentational catalogue. Locks the WP-6 provenance split: the one-off
 *      price is ALWAYS server-authoritative (`course.priceCents`), recurring
 *      prices are page-builder-authored teasers, and a course with no authored
 *      offers still yields a single one-off path.
 *   2. the server `load` shell — mocks the `../journey-data` seam (mirrors the
 *      sell page test) to lock: 404 on a missing page, the PRIVATE (never
 *      shared-cacheable) header, guest ⇒ not-enrolled without a worker hit, and
 *      an enrolled resolver hiccup degrading to the pre-purchase view.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  JourneyCoursePage,
  JourneyCourseView,
  JourneyPageRecord,
} from '$lib/page-builder';
import { CACHE_HEADERS } from '$lib/server/cache';
import {
  buildHeadNote,
  deriveCheckoutOffers,
  deriveCourseSummary,
  resolvePreselectedOffer,
} from '../checkout-offer-model';

const AUTHORED_OFFERS = [
  {
    id: 'membership',
    name: 'Full membership',
    priceLabel: '£12',
    per: 'month',
    best: true,
    who: 'All-in on the whole path',
    blurb: 'Every journey, every practice.',
    bullets: ['All courses & journeys', 'Cancel anytime'],
  },
  {
    id: 'course-sub',
    name: 'Rootwork monthly',
    priceLabel: '£6',
    per: 'month',
    who: 'Just here for Rootwork',
    blurb: 'Just this course.',
    bullets: ['Rootwork only', 'Cancel anytime'],
  },
  // No authored priceLabel → the one-off price is derived from course.priceCents.
  {
    id: 'one-off',
    name: 'Own Rootwork',
    per: 'once',
    who: 'Prefer to own, not subscribe',
    blurb: 'Buy it outright.',
    bullets: ['Yours forever', 'No subscription'],
  },
];

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

describe('checkout-offer-model · deriveCheckoutOffers', () => {
  it('reads the invite section offers, deriving the one-off price from course.priceCents', () => {
    const offers = deriveCheckoutOffers(inviteWithOffers, COURSE);

    expect(offers.map((o) => o.id)).toEqual([
      'membership',
      'course-sub',
      'one-off',
    ]);

    const membership = offers[0];
    expect(membership.priceLabel).toBe('£12'); // authored teaser (WP-6 replaces)
    expect(membership.recurring).toBe(true);
    expect(membership.cadenceLabel).toBe('per month');
    expect(membership.best).toBe(true);
    expect(membership.bullets).toContain('Cancel anytime');

    const oneOff = offers[2];
    expect(oneOff.priceLabel).toBe('£49'); // SERVER-authoritative, not authored
    expect(oneOff.recurring).toBe(false);
    expect(oneOff.cadenceLabel).toBe('one-off');
  });

  it('falls back to a single one-off offer (from course.priceCents) when none are authored', () => {
    const offers = deriveCheckoutOffers(pageWith([]), COURSE);

    expect(offers).toHaveLength(1);
    expect(offers[0].id).toBe('one-off');
    expect(offers[0].priceLabel).toBe('£49');
    expect(offers[0].recurring).toBe(false);
    expect(offers[0].best).toBe(true);
  });

  it('returns no offers when the course has no authored offers and no standalone price', () => {
    const free = { ...COURSE, priceCents: null };
    expect(deriveCheckoutOffers(pageWith([]), free)).toEqual([]);
  });

  it('drops a half-authored recurring offer that has no price to show', () => {
    const page = pageWith([
      {
        id: 'sec-invite',
        type: 'invite',
        enabled: true,
        props: { offers: [{ id: 'x', name: 'No price', per: 'month' }] },
      },
    ]);
    // The bad recurring entry is dropped; the model degrades to the one-off.
    const offers = deriveCheckoutOffers(page, COURSE);
    expect(offers).toHaveLength(1);
    expect(offers[0].id).toBe('one-off');
  });
});

describe('checkout-offer-model · resolvePreselectedOffer', () => {
  const offers = deriveCheckoutOffers(inviteWithOffers, COURSE);

  it('honours ?offer= when it names a real path', () => {
    expect(resolvePreselectedOffer(offers, 'course-sub')).toBe('course-sub');
  });

  it('falls back to the best path when the query names nothing real', () => {
    expect(resolvePreselectedOffer(offers, 'bogus')).toBe('membership');
    expect(resolvePreselectedOffer(offers, null)).toBe('membership');
  });

  it('is empty when there are no offers', () => {
    expect(resolvePreselectedOffer([], 'membership')).toBe('');
  });
});

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

describe('checkout-offer-model · buildHeadNote', () => {
  it('summarises the number of ways in when more than one', () => {
    const offers = deriveCheckoutOffers(inviteWithOffers, COURSE);
    expect(buildHeadNote(offers)).toBe('One course. Three ways in.');
  });

  it('is undefined for a single path', () => {
    expect(
      buildHeadNote(deriveCheckoutOffers(pageWith([]), COURSE))
    ).toBeUndefined();
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

const { getCoursePageMock, resolveCanEnterCourseMock } = vi.hoisted(() => ({
  getCoursePageMock: vi.fn(),
  resolveCanEnterCourseMock: vi.fn(),
}));

vi.mock('../../journey-data', () => ({
  getCoursePage: getCoursePageMock,
}));

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
  } as unknown as LoadInput;
  return { event, setHeaders };
}

describe('journey checkout +page.server load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCoursePageMock.mockResolvedValue(MOCK_COURSE_PAGE);
    resolveCanEnterCourseMock.mockResolvedValue(false);
  });

  it('derives offers + summary + testimonial and resolves ?offer= for a guest', async () => {
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork', { offer: 'course-sub' });

    const data = (await load(event)) as LoadData;

    expect(getCoursePageMock).toHaveBeenCalledWith({ slug: 'rootwork' });
    expect(data.orgSlug).toBe('acme');
    expect(data.offers.map((o) => o.id)).toEqual([
      'membership',
      'course-sub',
      'one-off',
    ]);
    expect(data.summary.bullets[0]).toBe('5 practices across 2 stages');
    expect(data.headNote).toBe('One course. Three ways in.');
    expect(data.priceNote).toBe('VAT included');
    expect(data.testimonial?.authorName).toBe('A member');
    expect(data.preselectedOfferId).toBe('course-sub');
    // Guest ⇒ definitionally not enrolled; no worker round-trip.
    expect(data.enrolled).toBe(false);
    expect(resolveCanEnterCourseMock).not.toHaveBeenCalled();
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
  });

  it('re-targets an enrolled viewer (resolver consulted) via the enrolled flag', async () => {
    resolveCanEnterCourseMock.mockResolvedValueOnce(true);
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork', { user: { id: 'u1' } });

    const data = (await load(event)) as LoadData;

    expect(resolveCanEnterCourseMock).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      COURSE.id
    );
    expect(data.enrolled).toBe(true);
  });

  it('degrades to the pre-purchase view when the enrolment resolver throws', async () => {
    resolveCanEnterCourseMock.mockRejectedValueOnce(new Error('seam down'));
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork', { user: { id: 'u1' } });

    const data = (await load(event)) as LoadData;

    expect(data.enrolled).toBe(false);
  });
});
