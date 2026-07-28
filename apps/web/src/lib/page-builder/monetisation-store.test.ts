/**
 * Monetisation store tests (Codex-2pryk.2.4.2).
 *
 * The bug this store exists to close: the pricing panel's "Membership tiers" and
 * "Course subscription" controls wrote into `landing_pages.offer` — a
 * presentational jsonb bag no authoritative read consults — so turning either on
 * could not change what a buyer was able to purchase, while the save reported
 * success. Every test here asserts a property that keeps that from recurring:
 *
 *  - the baseline is the AUTHORITATIVE state (plan row + tier-access rows), so a
 *    bag that disagrees loses on the next load;
 *  - a FAILED load never degrades to an empty draft, because saving that would
 *    withdraw a live plan and clear real tier grants the creator never touched;
 *  - `presentationOffer` is derived from the PERSISTED state, never the pending
 *    draft, so the bag cannot advertise a way in that does not exist;
 *  - `save()` propagates refusals instead of swallowing them, and only moves the
 *    baseline once the write comes back.
 *
 * The store is a module-level Svelte 5 `$state` singleton, so every test resets
 * via `close()` first.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JourneyMonetisation } from './journey-queries';

const getCourseMonetisation =
  vi.fn<(input: { courseId: string }) => Promise<JourneyMonetisation | null>>();
const updateCourseMonetisation =
  vi.fn<(input: unknown) => Promise<JourneyMonetisation>>();

vi.mock('$lib/remote/journeys.remote', () => ({
  getCourseMonetisation: (input: { courseId: string }) =>
    getCourseMonetisation(input),
  updateCourseMonetisation: (input: unknown) => updateCourseMonetisation(input),
}));

// Imported AFTER the mock so the store binds to the fakes.
const { monetisation } = await import('./monetisation-store.svelte');

const COURSE_ID = '00000000-0000-4000-8000-0000000000c0';
const TIER_A = '00000000-0000-4000-8000-0000000000a1';
const TIER_B = '00000000-0000-4000-8000-0000000000a2';

function makeState(
  overrides: Partial<JourneyMonetisation> = {}
): JourneyMonetisation {
  return {
    courseId: COURSE_ID,
    subscription: null,
    tierIds: [],
    tierOptions: [
      { id: TIER_A, name: 'Companion', priceMonthly: 800, priceAnnual: 8000 },
      { id: TIER_B, name: 'Circle', priceMonthly: 1800, priceAnnual: 18000 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  monetisation.close();
  getCourseMonetisation.mockReset();
  updateCourseMonetisation.mockReset();
});

describe('monetisation store · load', () => {
  it('adopts the authoritative plan + tier set as the baseline', async () => {
    getCourseMonetisation.mockResolvedValue(
      makeState({
        subscription: { priceMonthly: 1200, priceAnnual: 12000 },
        tierIds: [TIER_B, TIER_A],
      })
    );

    await monetisation.open(COURSE_ID);

    expect(monetisation.loaded).toBe(true);
    expect(monetisation.draft).toEqual({
      subscriptionEnabled: true,
      priceMonthlyCents: 1200,
      priceAnnualCents: 12000,
      // Normalised to a stable order so the dirty diff is not order-sensitive.
      tierIds: [TIER_A, TIER_B].sort(),
    });
    // A freshly loaded baseline is by definition not unsaved work.
    expect(monetisation.isDirty).toBe(false);
    expect(monetisation.tierOptions).toHaveLength(2);
  });

  it('reads "no plan" as the subscription being off, not as a missing field', async () => {
    getCourseMonetisation.mockResolvedValue(makeState());

    await monetisation.open(COURSE_ID);

    expect(monetisation.draft.subscriptionEnabled).toBe(false);
    expect(monetisation.draft.priceMonthlyCents).toBeNull();
  });

  it('a FAILED read stays unloaded — it never becomes an empty draft', async () => {
    getCourseMonetisation.mockRejectedValue(new Error('offer read down'));

    await monetisation.open(COURSE_ID);

    expect(monetisation.loaded).toBe(false);
    expect(monetisation.loadError).toBeTruthy();
    // The critical property: an unloaded placeholder must not look like unsaved
    // work, or Save would offer to persist "no plan, no tiers" over live state.
    expect(monetisation.isDirty).toBe(false);
    expect(monetisation.presentationOffer).toBeNull();
  });

  it('refuses to write an unloaded baseline even if the draft was mutated', async () => {
    getCourseMonetisation.mockResolvedValue(null);
    await monetisation.open(COURSE_ID);

    // A panel bug (or a stale render) toggling a control on an unloaded store must
    // not be able to clear real tier grants.
    monetisation.toggleTier(TIER_A);

    // The draft now genuinely DIFFERS from the (empty) placeholder baseline, so
    // this is where the `loaded` guard earns its keep. Without it the route's
    // dirty flag would light up, `beforeNavigate` would block leaving, and Save
    // would look like it had work to do — while `save()` silently did nothing.
    expect(monetisation.isDirty).toBe(false);

    await monetisation.save();
    expect(updateCourseMonetisation).not.toHaveBeenCalled();
  });

  it('a page with no subject course opens closed and writes nothing', async () => {
    await monetisation.open(null);

    expect(getCourseMonetisation).not.toHaveBeenCalled();
    expect(monetisation.loaded).toBe(false);
    expect(monetisation.courseId).toBeNull();

    await monetisation.save();
    expect(updateCourseMonetisation).not.toHaveBeenCalled();
  });
});

describe('monetisation store · editing', () => {
  beforeEach(async () => {
    getCourseMonetisation.mockResolvedValue(makeState());
    await monetisation.open(COURSE_ID);
  });

  it('toggling a tier is dirty, and toggling it back is not', () => {
    monetisation.toggleTier(TIER_A);
    expect(monetisation.hasTier(TIER_A)).toBe(true);
    expect(monetisation.isDirty).toBe(true);

    monetisation.toggleTier(TIER_A);
    expect(monetisation.hasTier(TIER_A)).toBe(false);
    expect(monetisation.isDirty).toBe(false);
  });

  it('tier order does not make the draft dirty', async () => {
    getCourseMonetisation.mockResolvedValue(
      makeState({ tierIds: [TIER_A, TIER_B] })
    );
    await monetisation.open(COURSE_ID);

    monetisation.toggleTier(TIER_A); // remove
    monetisation.toggleTier(TIER_A); // re-add — lands at the end pre-sort

    expect(monetisation.isDirty).toBe(false);
  });

  it('a no-op setter write does not mark the draft dirty', () => {
    monetisation.setSubscriptionEnabled(false);
    monetisation.setPriceMonthly(null);

    expect(monetisation.isDirty).toBe(false);
  });

  it('withdrawing the subscription KEEPS the prices, so re-listing is one click', () => {
    monetisation.setPriceMonthly(1200);
    monetisation.setPriceAnnual(12000);
    monetisation.setSubscriptionEnabled(true);
    monetisation.setSubscriptionEnabled(false);

    expect(monetisation.draft.priceMonthlyCents).toBe(1200);
    expect(monetisation.draft.priceAnnualCents).toBe(12000);
  });
});

describe('monetisation store · presentationOffer', () => {
  it('derives from the PERSISTED state, not the pending draft', async () => {
    getCourseMonetisation.mockResolvedValue(makeState());
    await monetisation.open(COURSE_ID);

    monetisation.setSubscriptionEnabled(true);
    monetisation.setPriceMonthly(1200);
    monetisation.toggleTier(TIER_A);

    // The whole point: an unsaved intention must NOT reach the bag, or the sales
    // page would tease a subscription that has no plan behind it.
    expect(monetisation.presentationOffer).toEqual({
      tiersEnabled: false,
      subscriptionEnabled: false,
      subscriptionPriceCents: null,
    });
  });

  it('mirrors the persisted state once a save has landed', async () => {
    getCourseMonetisation.mockResolvedValue(makeState());
    await monetisation.open(COURSE_ID);
    updateCourseMonetisation.mockResolvedValue(
      makeState({
        subscription: { priceMonthly: 1200, priceAnnual: 12000 },
        tierIds: [TIER_A],
      })
    );

    monetisation.setSubscriptionEnabled(true);
    monetisation.setPriceMonthly(1200);
    monetisation.setPriceAnnual(12000);
    await monetisation.save();

    expect(monetisation.presentationOffer).toEqual({
      tiersEnabled: true,
      subscriptionEnabled: true,
      subscriptionPriceCents: 1200,
    });
  });

  it('reports no monthly price for a withdrawn subscription', async () => {
    getCourseMonetisation.mockResolvedValue(
      makeState({ subscription: null, tierIds: [TIER_A] })
    );
    await monetisation.open(COURSE_ID);

    expect(monetisation.presentationOffer).toEqual({
      tiersEnabled: true,
      subscriptionEnabled: false,
      subscriptionPriceCents: null,
    });
  });
});

describe('monetisation store · save', () => {
  beforeEach(async () => {
    getCourseMonetisation.mockResolvedValue(makeState());
    await monetisation.open(COURSE_ID);
  });

  it('sends the TOTAL draft — an off subscription and an empty tier set included', async () => {
    updateCourseMonetisation.mockResolvedValue(
      makeState({ tierIds: [TIER_A] })
    );

    monetisation.toggleTier(TIER_A);
    await monetisation.save();

    expect(updateCourseMonetisation).toHaveBeenCalledWith({
      courseId: COURSE_ID,
      subscriptionEnabled: false,
      subscriptionPriceMonthly: null,
      subscriptionPriceAnnual: null,
      tierIds: [TIER_A],
    });
  });

  it('adopts the READ-BACK state as the new baseline, not the sent draft', async () => {
    // The server is the authority: if it normalises or refuses part of the draft,
    // the baseline must be what it holds — otherwise a lie gets promoted to
    // "saved" and the panel stops offering to fix it.
    updateCourseMonetisation.mockResolvedValue(
      makeState({ subscription: null, tierIds: [] })
    );

    monetisation.toggleTier(TIER_A);
    await monetisation.save();

    expect(monetisation.draft.tierIds).toEqual([]);
    expect(monetisation.isDirty).toBe(false);
  });

  it('PROPAGATES a refusal and leaves the draft dirty', async () => {
    updateCourseMonetisation.mockRejectedValue({
      status: 422,
      body: { message: 'Stripe Connect account is not fully onboarded' },
    });

    monetisation.setSubscriptionEnabled(true);
    monetisation.setPriceMonthly(1200);

    await expect(monetisation.save()).rejects.toMatchObject({ status: 422 });
    // Swallowing here is exactly how this panel came to report success on a save
    // that changed nothing.
    expect(monetisation.isDirty).toBe(true);
    expect(monetisation.presentationOffer).toEqual({
      tiersEnabled: false,
      subscriptionEnabled: false,
      subscriptionPriceCents: null,
    });
  });

  it('skips the rate-limited mutation when nothing changed', async () => {
    await monetisation.save();

    expect(updateCourseMonetisation).not.toHaveBeenCalled();
  });
});
