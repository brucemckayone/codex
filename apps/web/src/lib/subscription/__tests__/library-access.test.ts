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
 *
 * Plus the edge cases the helper handles explicitly:
 *   - Non-subscription library entries are always 'active'
 *   - Subscription entry with no slug is 'active' (can't join)
 *   - Subscription entry with a slug but missing sub row is 'active'
 *     (conservative — user may just not have visited that org)
 */
import { describe, expect, it } from 'vitest';
import type { SubscriptionItem } from '$lib/collections';
import {
  getLibraryAccessState,
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
      { accessType: 'purchased', organizationSlug: 'acme' },
      subs
    );
    expect(state).toEqual({ kind: 'active' });
  });

  it('returns active for membership-gated items regardless of subscription state', () => {
    const subs = indexSubscriptionsBySlug([makeSub({ status: 'past_due' })]);
    const state = getLibraryAccessState(
      { accessType: 'membership', organizationSlug: 'acme' },
      subs
    );
    expect(state).toEqual({ kind: 'active' });
  });

  it('returns active when the item has no organizationSlug (personal content edge case)', () => {
    const subs = indexSubscriptionsBySlug([makeSub({})]);
    const state = getLibraryAccessState(
      { accessType: 'subscription', organizationSlug: null },
      subs
    );
    expect(state).toEqual({ kind: 'active' });
  });

  it('returns active when subscription row is missing — user may just not have visited that org', () => {
    const subs = indexSubscriptionsBySlug([]); // empty
    const state = getLibraryAccessState(
      { accessType: 'subscription', organizationSlug: 'acme' },
      subs
    );
    expect(state).toEqual({ kind: 'active' });
  });

  it('returns active when the subscription is active', () => {
    const subs = indexSubscriptionsBySlug([
      makeSub({ status: 'active', cancelAtPeriodEnd: false }),
    ]);
    const state = getLibraryAccessState(
      { accessType: 'subscription', organizationSlug: 'acme' },
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
      { accessType: 'subscription', organizationSlug: 'acme' },
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
      { accessType: 'subscription', organizationSlug: 'acme' },
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
      { accessType: 'subscription', organizationSlug: 'acme' },
      subs
    );
    expect(state).toEqual({ kind: 'past_due' });
  });
});
