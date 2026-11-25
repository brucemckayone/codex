/**
 * Tests for the library-access join helper (Codex-k7ppt).
 *
 * The function under test is pure: it maps
 * (library item, subscription-by-slug map) → LibraryAccessState.
 * These tests cover the matrix documented in the bead:
 *
 *   Active       → existing (no change)
 *   Cancelling   → corner badge "Ends {date}"
 *   Past-Due     → dimmed + "Payment failed" CTA
 *   Revoked      → dimmed + "Subscription ended — reactivate" CTA
 *   Disputed     → dimmed + "Paused: payment dispute" (a purchase with an
 *                  open chargeback, Codex-2hxff.60)
 *
 * Plus the edge cases the helper handles explicitly:
 *   - Non-subscription library entries are 'active' unless disputed
 *   - Subscription entry with no slug is 'active' (can't join)
 *   - Subscription entry with a slug but missing sub row is 'active'
 *     (conservative — user may just not have visited that org)
 */
import { describe, expect, it } from 'vitest';
import type { SubscriptionItem } from '$lib/collections';
import {
  accessStateDateOf,
  getEnrolledCourseAccessState,
  getLibraryAccessState,
  getLibraryDisputeState,
  indexSubscriptionsBySlug,
} from '../library-access';

function makeSub(partial: Partial<SubscriptionItem>): SubscriptionItem {
  return {
    organizationId: 'org-1',
    organizationSlug: 'acme',
    tier: { id: 'tier-1', name: 'Basic', sortOrder: 1 },
    status: 'active',
    currentPeriodEnd: '2026-05-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    ...partial,
  };
}

describe('indexSubscriptionsBySlug', () => {
  it('indexes subscriptions that carry a slug', () => {
    const subs = [makeSub({ organizationSlug: 'acme' })];
    const map = indexSubscriptionsBySlug(subs);
    expect(map.size).toBe(1);
    expect(map.get('acme')?.organizationId).toBe('org-1');
  });

  it('skips subscriptions without a slug (legacy localStorage rows)', () => {
    const subs = [makeSub({ organizationSlug: undefined })];
    const map = indexSubscriptionsBySlug(subs);
    expect(map.size).toBe(0);
  });

  it('handles an empty iterable', () => {
    expect(indexSubscriptionsBySlug([]).size).toBe(0);
  });
});

describe('getLibraryAccessState', () => {
  it('returns active for purchased items regardless of subscription state', () => {
    const subs = indexSubscriptionsBySlug([makeSub({ status: 'past_due' })]);
    const state = getLibraryAccessState(
      {
        accessType: 'purchased',
        organizationSlug: 'acme',
        purchaseDisputedAt: null,
        leavesAt: null,
      },
      subs
    );
    expect(state).toEqual({ kind: 'active' });
  });

  it('returns active for membership-gated items regardless of subscription state', () => {
    const subs = indexSubscriptionsBySlug([makeSub({ status: 'past_due' })]);
    const state = getLibraryAccessState(
      {
        accessType: 'membership',
        organizationSlug: 'acme',
        purchaseDisputedAt: null,
        leavesAt: null,
      },
      subs
    );
    expect(state).toEqual({ kind: 'active' });
  });

  it('returns active when the item has no organizationSlug (personal content edge case)', () => {
    const subs = indexSubscriptionsBySlug([makeSub({})]);
    const state = getLibraryAccessState(
      {
        accessType: 'subscription',
        organizationSlug: null,
        purchaseDisputedAt: null,
        leavesAt: null,
      },
      subs
    );
    expect(state).toEqual({ kind: 'active' });
  });

  it('returns active when subscription row is missing — user may just not have visited that org', () => {
    const subs = indexSubscriptionsBySlug([]); // empty
    const state = getLibraryAccessState(
      {
        accessType: 'subscription',
        organizationSlug: 'acme',
        purchaseDisputedAt: null,
        leavesAt: null,
      },
      subs
    );
    expect(state).toEqual({ kind: 'active' });
  });

  it('returns active when the subscription is active', () => {
    const subs = indexSubscriptionsBySlug([
      makeSub({ status: 'active', cancelAtPeriodEnd: false }),
    ]);
    const state = getLibraryAccessState(
      {
        accessType: 'subscription',
        organizationSlug: 'acme',
        purchaseDisputedAt: null,
        leavesAt: null,
      },
      subs
    );
    expect(state).toEqual({ kind: 'active' });
  });

  it('returns cancelling with periodEnd when cancelAtPeriodEnd is true', () => {
    const subs = indexSubscriptionsBySlug([
      makeSub({
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-06-15T00:00:00.000Z',
      }),
    ]);
    const state = getLibraryAccessState(
      {
        accessType: 'subscription',
        organizationSlug: 'acme',
        purchaseDisputedAt: null,
        leavesAt: null,
      },
      subs
    );
    expect(state).toEqual({
      kind: 'cancelling',
      periodEnd: '2026-06-15T00:00:00.000Z',
    });
  });

  it("returns cancelling when status is 'cancelling'", () => {
    const subs = indexSubscriptionsBySlug([
      makeSub({
        status: 'cancelling',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: '2026-06-15T00:00:00.000Z',
      }),
    ]);
    const state = getLibraryAccessState(
      {
        accessType: 'subscription',
        organizationSlug: 'acme',
        purchaseDisputedAt: null,
        leavesAt: null,
      },
      subs
    );
    expect(state).toEqual({
      kind: 'cancelling',
      periodEnd: '2026-06-15T00:00:00.000Z',
    });
  });

  it('returns past_due when the subscription is past_due', () => {
    const subs = indexSubscriptionsBySlug([makeSub({ status: 'past_due' })]);
    const state = getLibraryAccessState(
      {
        accessType: 'subscription',
        organizationSlug: 'acme',
        purchaseDisputedAt: null,
        leavesAt: null,
      },
      subs
    );
    expect(state).toEqual({ kind: 'past_due' });
  });
});

// A purchase with an open chargeback stays in the library, paused
// (Codex-2hxff.60). Only `purchase.disputedAt` decides it.
describe('getLibraryAccessState: a payment dispute', () => {
  const DISPUTED_AT = '2026-10-20T09:00:00.000Z';

  it('returns disputed for a purchased item whose purchase is disputed', () => {
    const state = getLibraryAccessState(
      {
        accessType: 'purchased',
        organizationSlug: 'acme',
        purchaseDisputedAt: DISPUTED_AT,
        leavesAt: null,
      },
      indexSubscriptionsBySlug([])
    );
    expect(state).toEqual({ kind: 'disputed' });
  });

  it('returns active for a purchased item with no dispute', () => {
    const state = getLibraryAccessState(
      {
        accessType: 'purchased',
        organizationSlug: 'acme',
        purchaseDisputedAt: null,
        leavesAt: null,
      },
      indexSubscriptionsBySlug([])
    );
    expect(state).toEqual({ kind: 'active' });
  });

  it('leaves subscription items to the subscription join', () => {
    const subs = indexSubscriptionsBySlug([makeSub({ status: 'past_due' })]);
    const state = getLibraryAccessState(
      {
        accessType: 'subscription',
        organizationSlug: 'acme',
        purchaseDisputedAt: DISPUTED_AT,
        leavesAt: null,
      },
      subs
    );
    expect(state).toEqual({ kind: 'past_due' });
  });
});

// The org landing's "Jump back in" rail and the org library never joined the
// subscription collection; they take the dispute part of the same rule only
// (Codex-2hxff.60).
describe('getLibraryDisputeState', () => {
  it('returns disputed for a purchased item whose purchase is disputed', () => {
    expect(
      getLibraryDisputeState({
        accessType: 'purchased',
        organizationSlug: 'acme',
        purchaseDisputedAt: '2026-10-20T09:00:00.000Z',
        leavesAt: null,
      })
    ).toEqual({ kind: 'disputed' });
  });

  it('returns active for a purchased item with no dispute', () => {
    expect(
      getLibraryDisputeState({
        accessType: 'purchased',
        organizationSlug: 'acme',
        purchaseDisputedAt: null,
        leavesAt: null,
      })
    ).toEqual({ kind: 'active' });
  });

  it('never reads a subscription item as ended: it has no subscription rows', () => {
    expect(
      getLibraryDisputeState({
        accessType: 'subscription',
        organizationSlug: 'acme',
        purchaseDisputedAt: null,
        leavesAt: null,
      })
    ).toEqual({ kind: 'active' });
  });
});

// The org library's course shelf (Codex-2hxff.60): the worker's `disputeHold`
// decides it, and the card takes the same `disputed` state.
describe('getEnrolledCourseAccessState', () => {
  it.each([
    'purchase_dispute',
    'subscription_dispute',
  ] as const)('returns disputed while a %s holds the course back', (hold) => {
    expect(getEnrolledCourseAccessState({ disputeHold: hold })).toEqual({
      kind: 'disputed',
    });
  });

  it('returns active with no hold, or from a worker that sends no field', () => {
    expect(getEnrolledCourseAccessState({ disputeHold: null })).toEqual({
      kind: 'active',
    });
    expect(getEnrolledCourseAccessState({})).toEqual({ kind: 'active' });
  });
});

describe('getLibraryAccessState: a leaving piece (Codex-a6ofh.6.7, LN6)', () => {
  const LEAVES = '2026-04-17T00:00:00.000Z';
  const bought = {
    accessType: 'purchased' as const,
    organizationSlug: 'acme',
    purchaseDisputedAt: null,
    leavesAt: LEAVES,
  };
  const none = indexSubscriptionsBySlug([]);

  it('a bought piece that is leaving says the day it goes', () => {
    expect(getLibraryAccessState(bought, none)).toEqual({
      kind: 'leaving',
      leavesAt: LEAVES,
    });
  });

  it('an open dispute still wins: the piece will not open at all', () => {
    expect(
      getLibraryAccessState(
        { ...bought, purchaseDisputedAt: '2026-04-01T00:00:00.000Z' },
        none
      )
    ).toEqual({ kind: 'disputed' });
  });

  it('a cancelling subscription names the earlier end', () => {
    const asSub = { ...bought, accessType: 'subscription' as const };
    const endsLater = indexSubscriptionsBySlug([
      makeSub({
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-05-01T00:00:00.000Z',
      }),
    ]);
    const endsSooner = indexSubscriptionsBySlug([
      makeSub({
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-04-03T00:00:00.000Z',
      }),
    ]);
    expect(getLibraryAccessState(asSub, endsLater)).toEqual({
      kind: 'leaving',
      leavesAt: LEAVES,
    });
    expect(getLibraryAccessState(asSub, endsSooner)).toEqual({
      kind: 'cancelling',
      periodEnd: '2026-04-03T00:00:00.000Z',
    });
  });

  it('a subscription that no longer opens it wins over the date', () => {
    expect(
      getLibraryAccessState(
        { ...bought, accessType: 'subscription' },
        indexSubscriptionsBySlug([makeSub({ status: 'paused' })])
      )
    ).toEqual({ kind: 'revoked' });
  });

  it('a renewing subscription names the earlier end too: its renewal, or the leave', () => {
    const asSub = { ...bought, accessType: 'subscription' as const };
    const renewsFirst = indexSubscriptionsBySlug([
      makeSub({ currentPeriodEnd: '2026-04-03T00:00:00.000Z' }),
    ]);
    const renewsAfter = indexSubscriptionsBySlug([
      makeSub({ currentPeriodEnd: '2026-05-01T00:00:00.000Z' }),
    ]);
    expect(getLibraryAccessState(asSub, renewsFirst)).toEqual({
      kind: 'cancelling',
      periodEnd: '2026-04-03T00:00:00.000Z',
    });
    expect(getLibraryAccessState(asSub, renewsAfter)).toEqual({
      kind: 'leaving',
      leavesAt: LEAVES,
    });
  });

  it('a failed payment says so rather than the date', () => {
    expect(
      getLibraryAccessState(
        { ...bought, accessType: 'subscription' },
        indexSubscriptionsBySlug([makeSub({ status: 'past_due' })])
      )
    ).toEqual({ kind: 'past_due' });
  });

  it("a subscription's piece with its period unknown says no date at all", () => {
    expect(
      getLibraryAccessState({ ...bought, accessType: 'subscription' }, none)
    ).toEqual({ kind: 'active' });
    // The surfaces with no subscription join: an owner's piece still says it.
    expect(
      getLibraryDisputeState({ ...bought, accessType: 'subscription' })
    ).toEqual({ kind: 'active' });
    expect(getLibraryDisputeState(bought)).toEqual({
      kind: 'leaving',
      leavesAt: LEAVES,
    });
  });

  it('a free or followers piece that is leaving says so too', () => {
    expect(
      getLibraryAccessState({ ...bought, accessType: 'followers' }, none)
    ).toEqual({ kind: 'leaving', leavesAt: LEAVES });
  });

  it("the badge's date is the period end or the leave date", () => {
    expect(accessStateDateOf({ kind: 'leaving', leavesAt: LEAVES })).toBe(
      LEAVES
    );
    expect(
      accessStateDateOf({ kind: 'cancelling', periodEnd: '2026-05-01' })
    ).toBe('2026-05-01');
    expect(accessStateDateOf({ kind: 'active' })).toBeNull();
  });
});
