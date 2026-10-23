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
import { ApiError } from '$lib/server/errors';

const COURSE_ID = '408f94d0-5442-43d3-a56a-3491110962eb';

const {
  offerMock,
  resolveCourseBySlugMock,
  purchaseVerifyMock,
  courseSubscriptionVerifyMock,
  tierVerifyMock,
  warnMock,
} = vi.hoisted(() => ({
  offerMock: vi.fn(),
  resolveCourseBySlugMock: vi.fn(),
  purchaseVerifyMock: vi.fn(),
  courseSubscriptionVerifyMock: vi.fn(),
  tierVerifyMock: vi.fn(),
  warnMock: vi.fn(),
}));

vi.mock('$lib/observability', () => ({ logger: { warn: warnMock } }));

vi.mock('$lib/server/api', () => ({
  createServerApi: () => ({
    courses: { offer: offerMock },
    checkout: {
      verify: purchaseVerifyMock,
      verifyCourseSubscription: courseSubscriptionVerifyMock,
    },
    subscription: { verify: tierVerifyMock },
  }),
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
  kind = null,
}: {
  user?: { id: string } | null;
  sessionId?: string | null;
  /** The checkout path `startJourneyCheckout` puts on the success URL. */
  kind?: string | null;
} = {}) {
  const setHeaders = vi.fn();
  const depends = vi.fn();
  const url = new URL(
    'http://of-blood-and-bones.lvh.me:3000/journeys/pricing-smoke-test/checkout/success'
  );
  if (kind) url.searchParams.set('kind', kind);
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

  /**
   * A second payment for access the buyer already held (Codex-o4jvw). They are
   * entitled before this payment's own row exists, so the load reads our record
   * of THIS session (by its `kind`) before forwarding, and shows the notice for
   * a duplicate.
   */
  describe('a second payment', () => {
    const DASHBOARD = '/journeys/pricing-smoke-test/dashboard';
    const COURSE = { id: COURSE_ID, title: 'Rootwork' };

    it('shows the notice for a duplicate course purchase, though entitled', async () => {
      offerMock.mockResolvedValueOnce({ ...OFFER, entitled: true });
      purchaseVerifyMock.mockResolvedValueOnce({
        sessionStatus: 'complete',
        course: COURSE,
        duplicatePayment: true,
      });
      const { load } = await import('../+page.server');

      const data = (await load(
        makeEvent({ kind: 'purchase' }).event
      )) as LoadData;

      expect(purchaseVerifyMock).toHaveBeenCalledWith('cs_test_abc');
      expect(data.duplicate).toEqual({ kind: 'purchase' });
      expect(data.courseTitle).toBe('Rootwork');
      expect(data.dashboardPath).toBe(DASHBOARD);
    });

    it("waits for this payment's own row before forwarding an entitled buyer", async () => {
      offerMock.mockResolvedValueOnce({ ...OFFER, entitled: true });
      // Stripe is done; our webhook has not written the row yet.
      purchaseVerifyMock.mockResolvedValueOnce({ sessionStatus: 'complete' });
      const { load } = await import('../+page.server');

      const data = (await load(
        makeEvent({ kind: 'purchase' }).event
      )) as LoadData;

      expect(data.duplicate).toBeNull();
      expect(data.arrivedFromStripe).toBe(true);
    });

    it("forwards once this payment's row exists and is not a duplicate", async () => {
      offerMock.mockResolvedValueOnce({ ...OFFER, entitled: true });
      purchaseVerifyMock.mockResolvedValueOnce({
        sessionStatus: 'complete',
        course: COURSE,
      });
      const { load } = await import('../+page.server');

      await expect(
        load(makeEvent({ kind: 'purchase' }).event)
      ).rejects.toMatchObject({
        status: 303,
        location: DASHBOARD,
      });
    });

    it('shows the notice for a duplicate course plan subscription', async () => {
      offerMock.mockResolvedValueOnce({ ...OFFER, entitled: true });
      courseSubscriptionVerifyMock.mockResolvedValueOnce({
        sessionStatus: 'complete',
        subscription: {
          id: 'cs-dup',
          courseId: COURSE_ID,
          courseTitle: 'Rootwork',
          startedAt: '2026-10-22T10:00:00.000Z',
          duplicateOf: { id: 'cs-kept' },
        },
      });
      const { load } = await import('../+page.server');

      const data = (await load(
        makeEvent({ kind: 'subscription' }).event
      )) as LoadData;

      expect(courseSubscriptionVerifyMock).toHaveBeenCalledWith('cs_test_abc');
      expect(data.duplicate).toEqual({ kind: 'subscription' });
    });

    it('names the kept tier for a duplicate tier subscription, entitled or not', async () => {
      // The kept tier need not include this course: not entitled, still told.
      const tierSubscription = {
        id: 'sub-dup',
        organizationId: OFFER.organizationId,
        tierId: 'tier-pro',
        tierName: 'Pro',
        organizationName: 'Of Blood and Bones',
        organizationSlug: 'of-blood-and-bones',
        startedAt: '2026-10-22T10:00:00.000Z',
      };
      tierVerifyMock.mockResolvedValueOnce({
        sessionStatus: 'complete',
        subscription: {
          ...tierSubscription,
          duplicateOf: {
            id: 'sub-kept',
            tierId: 'tier-basic',
            tierName: 'Basic',
          },
        },
      });
      const { load } = await import('../+page.server');

      const other = (await load(makeEvent({ kind: 'tier' }).event)) as LoadData;
      expect(other.duplicate).toEqual({
        kind: 'tier',
        organizationName: 'Of Blood and Bones',
        keptTierName: 'Basic',
        otherTierName: 'Pro',
      });

      tierVerifyMock.mockResolvedValueOnce({
        sessionStatus: 'complete',
        subscription: {
          ...tierSubscription,
          duplicateOf: { id: 'sub-kept', tierId: 'tier-pro', tierName: 'Pro' },
        },
      });
      const same = (await load(makeEvent({ kind: 'tier' }).event)) as LoadData;
      expect(same.duplicate).toMatchObject({
        keptTierName: 'Pro',
        otherTierName: null,
      });
    });

    it('reports nothing for a duplicate recorded against another course', async () => {
      offerMock.mockResolvedValueOnce({ ...OFFER, entitled: true });
      purchaseVerifyMock.mockResolvedValueOnce({
        sessionStatus: 'complete',
        course: { id: 'another-course', title: 'Elsewhere' },
        duplicatePayment: true,
      });
      const { load } = await import('../+page.server');

      await expect(
        load(makeEvent({ kind: 'purchase' }).event)
      ).rejects.toMatchObject({
        status: 303,
        location: DASHBOARD,
      });
    });

    it('falls back to the entitlement alone without a kind, or an unknown one', async () => {
      const { load } = await import('../+page.server');

      for (const kind of [null, 'refund-me']) {
        offerMock.mockResolvedValueOnce({ ...OFFER, entitled: true });
        await expect(load(makeEvent({ kind }).event)).rejects.toMatchObject({
          status: 303,
          location: DASHBOARD,
        });
      }
      expect(purchaseVerifyMock).not.toHaveBeenCalled();
      expect(courseSubscriptionVerifyMock).not.toHaveBeenCalled();
      expect(tierVerifyMock).not.toHaveBeenCalled();
    });

    it('a failed read is logged and not settled: the buyer waits, the next poll shows the notice', async () => {
      const { load } = await import('../+page.server');

      // Poll 1: entitled already, the verify fails. Forwarding here would send
      // a duplicate buyer to the dashboard as if this were a new purchase.
      offerMock.mockResolvedValueOnce({ ...OFFER, entitled: true });
      purchaseVerifyMock.mockRejectedValueOnce(
        new ApiError(503, 'Service unavailable')
      );
      const first = (await load(
        makeEvent({ kind: 'purchase' }).event
      )) as LoadData;
      expect(first.duplicate).toBeNull();
      expect(first.arrivedFromStripe).toBe(true);
      expect(warnMock).toHaveBeenCalledWith(
        'journey-checkout-success: session verify failed',
        {
          kind: 'purchase',
          sessionId: 'cs_test_abc',
          status: 503,
          error: 'Service unavailable',
        }
      );

      // Poll 2: the read succeeds and the record is a duplicate.
      offerMock.mockResolvedValueOnce({ ...OFFER, entitled: true });
      purchaseVerifyMock.mockResolvedValueOnce({
        sessionStatus: 'complete',
        course: COURSE,
        duplicatePayment: true,
      });
      const second = (await load(
        makeEvent({ kind: 'purchase' }).event
      )) as LoadData;
      expect(second.duplicate).toEqual({ kind: 'purchase' });
    });
  });
});
