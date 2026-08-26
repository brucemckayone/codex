// @vitest-environment node

/**
 * Journey checkout submit — the pay step (Codex-2pryk.2.4.4).
 *
 * The button used to be `onclick={() => (initiated = true)}`; no course could be
 * bought. These tests lock the two things that make the real submit safe:
 *
 *   1. DISPATCH — each canonical offer path reaches the endpoint that owns it,
 *      with the interval MAPPED to the wire vocabulary (`month` / `year`, not the
 *      plan-row `monthly` / `annual`). Forwarding instead of mapping is a 400,
 *      and that mistake already shipped once in `api.checkout.courseSubscription`.
 *   2. THE CLIENT IS NOT TRUSTED — the only client inputs are a slug and an
 *      opaque offer id. No price crosses the wire; the course is resolved from
 *      the slug server-side; an id naming a path that does not exist (or has
 *      been withdrawn since the page rendered) starts NO Stripe session.
 *
 * Mocking follows the `checkout.remote.test.ts` precedent: `$app/server` is
 * stubbed with remote-metadata-carrying callables, and `redirect`/`isRedirect`
 * are spies so the redirect-as-success signal can be asserted. The offer-path
 * resolver is the REAL one — mocking it would test nothing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';
import type { CourseOffer } from '$lib/page-builder';

const TIER_ID = '33f6c1a1-bb69-4902-b24a-4365170c022c';
const COURSE_ID = '408f94d0-5442-43d3-a56a-3491110962eb';
const ORG_ID = 'ddea4b84-64d1-451c-a8f5-4c28956e5fb2';
const ORIGIN = 'http://of-blood-and-bones.lvh.me:3000';

const FULL_OFFER: CourseOffer = {
  courseId: COURSE_ID,
  organizationId: ORG_ID,
  paths: ['purchase', 'subscription', 'tier'],
  purchase: { priceCents: 2499 },
  subscription: {
    planId: 'b8341535-fd97-4976-81a9-6f218e151388',
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

const offerMock = vi.hoisted(() => vi.fn());
const courseCheckoutMock = vi.hoisted(() => vi.fn());
const courseSubscriptionCheckoutMock = vi.hoisted(() => vi.fn());
const tierCheckoutMock = vi.hoisted(() => vi.fn());
const resolveCourseBySlugMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());
const isRedirectMock = vi.hoisted(() => vi.fn((_e: unknown): boolean => false));

const getRequestEventMock = vi.hoisted(() =>
  vi.fn(() => ({
    platform: { env: {} },
    cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    url: new URL(`${ORIGIN}/journeys/pricing-smoke-test/checkout`),
    locals: { user: { id: 'user-1' } } as { user?: { id: string } },
  }))
);

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    courses: { offer: offerMock },
    checkout: {
      course: courseCheckoutMock,
      courseSubscription: courseSubscriptionCheckoutMock,
    },
    subscription: { checkout: tierCheckoutMock },
  })),
  serverApiUrl: vi.fn(() => 'http://localhost:42072'),
}));

vi.mock('$lib/server/journeys/round-d-seam', () => ({
  resolveCourseBySlug: resolveCourseBySlugMock,
}));

/**
 * SvelteKit's SSR `init_remote_functions` requires every `.remote.ts` export to
 * carry `__.type`; attach it and forward to the inner handler so the export stays
 * directly callable in tests.
 */
const makeRemote = <T extends (...args: never[]) => unknown>(
  type: 'form' | 'command' | 'query',
  fn: T
) => {
  const wrapped: T & { __: { type: string; id: string; name: string } } = ((
    ...args: unknown[]
  ) => fn(...(args as Parameters<T>))) as T & {
    __: { type: string; id: string; name: string };
  };
  wrapped.__ = { type, id: '', name: '' };
  return wrapped;
};

vi.mock('$app/server', () => ({
  command: vi.fn((_schema, fn) => makeRemote('command', fn)),
  form: vi.fn((_schema, fn) => makeRemote('form', fn)),
  query: vi.fn((fn) => makeRemote('query', fn)),
  getRequestEvent: getRequestEventMock,
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: redirectMock,
  isRedirect: isRedirectMock,
}));

type SubmitResult = { success: false; error: string } | undefined;

/**
 * The real `redirect()` THROWS, which is what stops the handler. A spy that
 * merely records the call lets execution run on past it — so a submit that both
 * redirected an entitled viewer away AND created a Stripe session would look
 * correct. The mock therefore throws a Redirect-shaped sentinel, exactly as
 * SvelteKit does, and `isRedirect` recognises it.
 */
class RedirectSignal {
  constructor(
    readonly status: number,
    readonly location: string
  ) {}
}

/** What the submit did: returned a form failure, or redirected somewhere. */
type Submitted = { result?: SubmitResult; redirectedTo?: string };

async function submit(input: {
  journeySlug?: string;
  offerId: string;
}): Promise<Submitted> {
  const { startJourneyCheckout } = await import('./journey-checkout.remote');
  try {
    const result = await (
      startJourneyCheckout as unknown as (i: unknown) => Promise<SubmitResult>
    )({ journeySlug: 'pricing-smoke-test', ...input });
    return { result };
  } catch (error) {
    if (error instanceof RedirectSignal) {
      return { redirectedTo: error.location };
    }
    throw error;
  }
}

/** Every Stripe-session creator, so "nothing was charged" is assertable. */
function allSessionMocks() {
  return [courseCheckoutMock, courseSubscriptionCheckoutMock, tierCheckoutMock];
}

function expectNoSessionCreated() {
  for (const mock of allSessionMocks()) {
    expect(mock).not.toHaveBeenCalled();
  }
}

describe('remote/journey-checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation((status: number, location: string) => {
      throw new RedirectSignal(status, location);
    });
    isRedirectMock.mockImplementation(
      (e: unknown) => e instanceof RedirectSignal
    );
    resolveCourseBySlugMock.mockResolvedValue({
      id: COURSE_ID,
      slug: 'pricing-smoke-test',
      title: 'Rootwork',
      organizationSlug: 'of-blood-and-bones',
    });
    offerMock.mockResolvedValue(FULL_OFFER);
    courseCheckoutMock.mockResolvedValue({
      sessionId: 'cs_test_a',
      sessionUrl: 'https://checkout.stripe.com/c/pay/cs_test_a',
    });
    courseSubscriptionCheckoutMock.mockResolvedValue({
      sessionId: 'cs_test_b',
      sessionUrl: 'https://checkout.stripe.com/c/pay/cs_test_b',
    });
    tierCheckoutMock.mockResolvedValue({
      sessionId: 'cs_test_c',
      sessionUrl: 'https://checkout.stripe.com/c/pay/cs_test_c',
    });
  });

  describe('dispatch by path kind', () => {
    it('one-off purchase → POST /checkout/course, then 303 to Stripe', async () => {
      const { redirectedTo } = await submit({ offerId: 'purchase' });

      expect(courseCheckoutMock).toHaveBeenCalledTimes(1);
      expect(courseCheckoutMock.mock.calls[0][0]).toMatchObject({
        courseId: COURSE_ID,
      });
      expect(courseSubscriptionCheckoutMock).not.toHaveBeenCalled();
      expect(tierCheckoutMock).not.toHaveBeenCalled();
      expect(redirectedTo).toBe('https://checkout.stripe.com/c/pay/cs_test_a');
    });

    it("monthly course subscription → billingInterval 'month' (mapped, not forwarded)", async () => {
      const { redirectedTo } = await submit({
        offerId: 'subscription-monthly',
      });

      expect(courseSubscriptionCheckoutMock).toHaveBeenCalledTimes(1);
      expect(courseSubscriptionCheckoutMock.mock.calls[0][0]).toMatchObject({
        courseId: COURSE_ID,
        billingInterval: 'month',
      });
      expect(redirectedTo).toBe('https://checkout.stripe.com/c/pay/cs_test_b');
    });

    it("annual course subscription → billingInterval 'year', NOT 'annual'", async () => {
      // The route validates `z.enum(['month','year'])`. Sending the plan-row
      // vocabulary is a 400 — the exact bug that shipped in the client method.
      await submit({ offerId: 'subscription-annual' });

      const payload = courseSubscriptionCheckoutMock.mock.calls[0][0];
      expect(payload.billingInterval).toBe('year');
      expect(payload.billingInterval).not.toBe('annual');
    });

    it('tier access → POST /subscriptions/checkout with the org + tier ids', async () => {
      await submit({ offerId: `tier:${TIER_ID}` });

      expect(tierCheckoutMock).toHaveBeenCalledTimes(1);
      expect(tierCheckoutMock.mock.calls[0][0]).toMatchObject({
        organizationId: ORG_ID,
        tierId: TIER_ID,
        billingInterval: 'month',
      });
      // A tier is an ORG subscription — the course endpoints must stay untouched.
      expect(courseCheckoutMock).not.toHaveBeenCalled();
      expect(courseSubscriptionCheckoutMock).not.toHaveBeenCalled();
    });
  });

  describe('the client cannot influence what is charged', () => {
    it('sends NO price field on any path', async () => {
      for (const offerId of [
        'purchase',
        'subscription-monthly',
        'subscription-annual',
        `tier:${TIER_ID}`,
      ]) {
        vi.clearAllMocks();
        offerMock.mockResolvedValue(FULL_OFFER);
        resolveCourseBySlugMock.mockResolvedValue({
          id: COURSE_ID,
          slug: 'pricing-smoke-test',
          title: 'Rootwork',
          organizationSlug: 'of-blood-and-bones',
        });
        courseCheckoutMock.mockResolvedValue({ sessionUrl: 'https://s/a' });
        courseSubscriptionCheckoutMock.mockResolvedValue({
          sessionUrl: 'https://s/b',
        });
        tierCheckoutMock.mockResolvedValue({ sessionUrl: 'https://s/c' });

        await submit({ offerId });

        const payload = allSessionMocks()
          .flatMap((m) => m.mock.calls)
          .map(([arg]) => arg as Record<string, unknown>)[0];
        expect(payload, offerId).toBeDefined();
        const keys = Object.keys(payload).sort();
        expect(keys, offerId).not.toContain('priceCents');
        expect(keys, offerId).not.toContain('amount');
        expect(keys, offerId).not.toContain('price');
        // Only ids, an interval, and the two redirect URLs.
        for (const key of keys) {
          expect(
            [
              'courseId',
              'organizationId',
              'tierId',
              'billingInterval',
              'successUrl',
              'cancelUrl',
            ],
            `${offerId} → ${key}`
          ).toContain(key);
        }
      }
    });

    it('resolves the course from the SLUG, never from a client-supplied id', async () => {
      await submit({ offerId: 'purchase' });

      expect(resolveCourseBySlugMock).toHaveBeenCalledWith(
        expect.anything(),
        'pricing-smoke-test'
      );
      // The id used downstream is the resolved one, so there is no (slug, id)
      // pair that could disagree.
      expect(courseCheckoutMock.mock.calls[0][0].courseId).toBe(COURSE_ID);
      expect(offerMock).toHaveBeenCalledWith(COURSE_ID);
    });

    it('refuses an offer id that names no real path — no session, no charge', async () => {
      const { result, redirectedTo } = await submit({
        offerId: 'tier:not-a-real-tier',
      });

      expect(result).toMatchObject({ success: false });
      expect(result?.error).toContain('no longer available');
      expectNoSessionCreated();
      expect(redirectedTo).toBeUndefined();
    });

    it('refuses a WITHDRAWN path even though its id is well-formed', async () => {
      // The page was rendered while a plan existed; the creator withdrew it
      // before the buyer pressed Continue. `subscription-monthly` is a perfectly
      // valid id and must still be refused.
      offerMock.mockResolvedValueOnce({
        ...FULL_OFFER,
        paths: ['purchase'],
        subscription: null,
        tiers: [],
      });

      const { result } = await submit({ offerId: 'subscription-monthly' });

      expect(result).toMatchObject({ success: false });
      expectNoSessionCreated();
    });

    it('re-reads the offer per submit rather than trusting the rendered page', async () => {
      await submit({ offerId: 'purchase' });
      expect(offerMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('viewers who should not be charged', () => {
    it('sends an anonymous buyer to login, preserving the chosen path', async () => {
      getRequestEventMock.mockReturnValueOnce({
        platform: { env: {} },
        cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
        url: new URL(`${ORIGIN}/journeys/pricing-smoke-test/checkout`),
        locals: {},
      });

      const { redirectedTo } = await submit({ offerId: `tier:${TIER_ID}` });

      expect(redirectedTo).toBe(
        `/login?redirect=${encodeURIComponent(
          `/journeys/pricing-smoke-test/checkout?offer=tier%3A${TIER_ID}`
        )}`
      );
      // Nothing else may run — the endpoints are all `auth: 'required'`.
      expect(offerMock).not.toHaveBeenCalled();
      expectNoSessionCreated();
    });

    it('sends an already-entitled viewer to the dashboard instead of charging again', async () => {
      offerMock.mockResolvedValueOnce({ ...FULL_OFFER, entitled: true });

      const { redirectedTo } = await submit({ offerId: 'purchase' });

      expect(redirectedTo).toBe('/journeys/pricing-smoke-test/dashboard');
      // The redirect must STOP the handler, not merely precede the charge.
      expectNoSessionCreated();
    });

    it('refuses when the slug resolves to no course', async () => {
      resolveCourseBySlugMock.mockResolvedValueOnce(null);

      const { result } = await submit({ offerId: 'purchase' });

      expect(result).toMatchObject({ success: false });
      expect(offerMock).not.toHaveBeenCalled();
      expectNoSessionCreated();
    });
  });

  describe('redirect URLs', () => {
    it('returns the buyer to a success waiting room carrying the Stripe session id', async () => {
      await submit({ offerId: 'purchase' });

      const { successUrl } = courseCheckoutMock.mock.calls[0][0];
      expect(successUrl).toBe(
        `${ORIGIN}/journeys/pricing-smoke-test/checkout/success?session_id={CHECKOUT_SESSION_ID}`
      );
    });

    it('cancels back to the checkout with the same path still selected', async () => {
      await submit({ offerId: 'subscription-annual' });

      const { cancelUrl } = courseSubscriptionCheckoutMock.mock.calls[0][0];
      expect(cancelUrl).toBe(
        `${ORIGIN}/journeys/pricing-smoke-test/checkout?offer=subscription-annual`
      );
      // Absolute + on an allowed host, or `checkoutRedirectUrlSchema` rejects it.
      expect(new URL(cancelUrl).hostname).toBe('of-blood-and-bones.lvh.me');
    });
  });

  describe('failure handling', () => {
    it('never converts the redirect-to-Stripe signal into a reported failure', async () => {
      // The handler wraps everything in try/catch to turn worker errors into form
      // errors. Its own success signal is a THROWN redirect, so dropping the
      // `isRedirect` re-throw would show "checkout failed" on the way to Stripe.
      const { result, redirectedTo } = await submit({ offerId: 'purchase' });

      expect(redirectedTo).toBe('https://checkout.stripe.com/c/pay/cs_test_a');
      expect(result).toBeUndefined();
    });

    it('surfaces a worker refusal as a readable form error, with no redirect', async () => {
      courseCheckoutMock.mockRejectedValueOnce(
        new ApiError(422, 'This course is not currently for sale', 'INVALID')
      );

      const { result, redirectedTo } = await submit({ offerId: 'purchase' });

      expect(result).toEqual({
        success: false,
        error: 'This course is not currently for sale',
      });
      expect(redirectedTo).toBeUndefined();
    });

    it('does not leak internals when the failure is not an Error', async () => {
      courseCheckoutMock.mockRejectedValueOnce('boom');

      const { result } = await submit({ offerId: 'purchase' });

      expect(result).toEqual({
        success: false,
        error: 'Checkout could not be started. Please try again.',
      });
      expect(JSON.stringify(result)).not.toMatch(/stack/i);
    });

    it('refuses rather than redirecting when a session comes back with no URL', async () => {
      courseCheckoutMock.mockResolvedValueOnce({ sessionUrl: '' });

      const { result, redirectedTo } = await submit({ offerId: 'purchase' });

      expect(result).toMatchObject({ success: false });
      expect(redirectedTo).toBeUndefined();
    });
  });
});
