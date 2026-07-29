/**
 * Journey checkout return leg (Codex-2pryk.2.4.4).
 *
 * This page exists because the entitlement is written by a webhook that races the
 * buyer's redirect back from Stripe. What it must never do is send someone who
 * has just paid to a dashboard that does not yet know about their purchase — nor
 * assert access that no entitlement row backs.
 *
 * Uses the REAL `@sveltejs/kit` so `redirect()` throws exactly as in production;
 * asserting on the thrown Redirect is what proves the load STOPS there.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_HEADERS } from '$lib/server/cache';

const COURSE_ID = '408f94d0-5442-43d3-a56a-3491110962eb';

const { offerMock, resolveCourseBySlugMock } = vi.hoisted(() => ({
  offerMock: vi.fn(),
  resolveCourseBySlugMock: vi.fn(),
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: () => ({ courses: { offer: offerMock } }),
}));

vi.mock('$lib/server/journeys/round-d-seam', () => ({
  resolveCourseBySlug: resolveCourseBySlugMock,
}));

type LoadInput = Parameters<typeof import('../+page.server').load>[0];
type LoadData = Extract<
  Awaited<ReturnType<typeof import('../+page.server').load>>,
  object
>;

function makeEvent({
  user = { id: 'user-1' },
  sessionId = 'cs_test_abc',
}: {
  user?: { id: string } | null;
  sessionId?: string | null;
} = {}) {
  const setHeaders = vi.fn();
  const depends = vi.fn();
  const url = new URL(
    'http://of-blood-and-bones.lvh.me:3000/journeys/pricing-smoke-test/checkout/success'
  );
  if (sessionId) url.searchParams.set('session_id', sessionId);
  const event = {
    params: { slug: 'of-blood-and-bones', journeySlug: 'pricing-smoke-test' },
    url,
    locals: user ? { user } : {},
    platform: {},
    cookies: {},
    setHeaders,
    depends,
  } as unknown as LoadInput;
  return { event, setHeaders, depends };
}

const OFFER = {
  courseId: COURSE_ID,
  organizationId: 'ddea4b84-64d1-451c-a8f5-4c28956e5fb2',
  paths: ['purchase'],
  purchase: { priceCents: 2499 },
  subscription: null,
  tiers: [],
  entitled: false,
};

describe('journey checkout success load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveCourseBySlugMock.mockResolvedValue({
      id: COURSE_ID,
      slug: 'pricing-smoke-test',
      title: 'Rootwork',
      organizationSlug: 'of-blood-and-bones',
    });
    offerMock.mockResolvedValue(OFFER);
  });

  it('forwards to the journey dashboard once the entitlement exists', async () => {
    offerMock.mockResolvedValueOnce({ ...OFFER, entitled: true });
    const { load } = await import('../+page.server');
    const { event } = makeEvent();

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: '/journeys/pricing-smoke-test/dashboard',
    });
  });

  it('holds the buyer in the waiting room while the webhook is in flight', async () => {
    const { load } = await import('../+page.server');
    const { event, depends } = makeEvent();

    const data = (await load(event)) as LoadData;

    expect(data.arrivedFromStripe).toBe(true);
    expect(data.courseTitle).toBe('Rootwork');
    expect(data.dashboardPath).toBe('/journeys/pricing-smoke-test/dashboard');
    expect(data.checkoutPath).toBe('/journeys/pricing-smoke-test/checkout');
    // The client re-polls by invalidating this key.
    expect(depends).toHaveBeenCalledWith('journey:entitlement');
  });

  it('keeps waiting (not erroring) when the entitlement read fails', async () => {
    // The buyer has already paid — bouncing them out of the flow over a
    // transient read is worse than letting the next poll try again.
    offerMock.mockRejectedValueOnce(new Error('ecom down'));
    const { load } = await import('../+page.server');
    const { event } = makeEvent();

    const data = (await load(event)) as LoadData;

    expect(data.arrivedFromStripe).toBe(true);
  });

  it('distinguishes a direct visit from a return from Stripe', async () => {
    const { load } = await import('../+page.server');
    const { event } = makeEvent({ sessionId: null });

    const data = (await load(event)) as LoadData;

    // Without a session there is nothing pending — the page says so instead of
    // polling forever for a payment that never happened.
    expect(data.arrivedFromStripe).toBe(false);
  });

  it('sends an anonymous visitor to login, returning to this page', async () => {
    const { load } = await import('../+page.server');
    const { event } = makeEvent({ user: null });

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: `/login?redirect=${encodeURIComponent(
        '/journeys/pricing-smoke-test/checkout/success?session_id=cs_test_abc'
      )}`,
    });
    // Entitlement is per-user; there is nobody to resolve it for yet.
    expect(offerMock).not.toHaveBeenCalled();
  });

  it('404s when the slug resolves to no course', async () => {
    resolveCourseBySlugMock.mockResolvedValueOnce(null);
    const { load } = await import('../+page.server');
    const { event } = makeEvent();

    await expect(load(event)).rejects.toMatchObject({ status: 404 });
  });

  it('never lets a payment confirmation sit in a cache', async () => {
    const { load } = await import('../+page.server');
    const { event, setHeaders } = makeEvent();

    await load(event);

    expect(setHeaders).toHaveBeenCalledWith(CACHE_HEADERS.PRIVATE);
    const [[headers]] = setHeaders.mock.calls;
    expect(headers['Cache-Control']).toBe('private, no-cache');
    expect(headers['Cache-Control']).not.toMatch(/public|s-maxage/);
  });
});
