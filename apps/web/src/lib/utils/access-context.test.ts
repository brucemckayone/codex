/**
 * Unit tests for the pure decision helpers in access-context.svelte.ts
 * (Codex-q7dyz — PriceBadge correctness for subscribers viewing
 * followers-only content under the `subscribers ⊇ followers` hierarchy).
 *
 * The reactive `useAccessContext()` hook is a thin wrapper that reads from
 * `subscriptionCollection` and an awaited tiers promise; the access decision
 * itself lives in pure helpers (`isAccessGrantingSubscription`,
 * `decideIsIncluded`) so it can be exercised here without a Svelte runtime.
 */
import { describe, expect, it } from 'vitest';
import type { SubscriptionItem } from '$lib/collections';
import type { SubscriptionTier } from '$lib/types';
import {
  decideIsIncluded,
  isAccessGrantingSubscription,
} from './access-context.svelte';

function makeSub(partial: Partial<SubscriptionItem> = {}): SubscriptionItem {
  return {
    organizationId: 'org-1',
    organizationSlug: 'acme',
    tier: { id: 'tier-bronze', name: 'Bronze', sortOrder: 1 },
    status: 'active',
    currentPeriodEnd: '2026-12-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    ...partial,
  };
}

const TIERS: SubscriptionTier[] = [
  { id: 'tier-bronze', name: 'Bronze', sortOrder: 1 } as SubscriptionTier,
  { id: 'tier-silver', name: 'Silver', sortOrder: 2 } as SubscriptionTier,
  { id: 'tier-gold', name: 'Gold', sortOrder: 3 } as SubscriptionTier,
];

describe('isAccessGrantingSubscription', () => {
  it('treats active and cancelling as access-granting', () => {
    expect(isAccessGrantingSubscription(makeSub({ status: 'active' }))).toBe(
      true
    );
    expect(
      isAccessGrantingSubscription(makeSub({ status: 'cancelling' }))
    ).toBe(true);
  });

  it('rejects past_due, paused, cancelled, and incomplete', () => {
    expect(isAccessGrantingSubscription(makeSub({ status: 'past_due' }))).toBe(
      false
    );
    expect(isAccessGrantingSubscription(makeSub({ status: 'paused' }))).toBe(
      false
    );
    expect(isAccessGrantingSubscription(makeSub({ status: 'cancelled' }))).toBe(
      false
    );
    expect(
      isAccessGrantingSubscription(makeSub({ status: 'incomplete' }))
    ).toBe(false);
  });

  it('rejects null/undefined input', () => {
    expect(isAccessGrantingSubscription(null)).toBe(false);
    expect(isAccessGrantingSubscription(undefined)).toBe(false);
  });
});

describe('decideIsIncluded — followers-only (Codex-xybr3 hierarchy)', () => {
  const followersItem = { accessType: 'followers', minimumTierId: null };

  it('returns true when an active subscription exists at any tier', () => {
    expect(decideIsIncluded(followersItem, makeSub(), TIERS)).toBe(true);
  });

  it('returns true for cancelling subscriptions (still in access window)', () => {
    expect(
      decideIsIncluded(followersItem, makeSub({ status: 'cancelling' }), TIERS)
    ).toBe(true);
  });

  it('returns true regardless of minimumTierId — followers-only is tier-agnostic', () => {
    // backend ignores minimumTierId for followers-only content (xybr3) —
    // any active tier counts. The pure helper preserves that semantic so
    // the badge decision matches the streaming-gate decision.
    const followersItemWithMinTier = {
      accessType: 'followers',
      minimumTierId: 'tier-gold',
    };
    expect(decideIsIncluded(followersItemWithMinTier, makeSub(), TIERS)).toBe(
      true
    );
  });

  it('returns false when no subscription exists', () => {
    expect(decideIsIncluded(followersItem, null, TIERS)).toBe(false);
  });
});

describe('decideIsIncluded — subscribers (tier-aware)', () => {
  it('returns true when no minimumTierId is set (any tier covers)', () => {
    const item = { accessType: 'subscribers', minimumTierId: null };
    expect(decideIsIncluded(item, makeSub(), TIERS)).toBe(true);
  });

  it('returns true when user tier sortOrder >= minimum tier sortOrder', () => {
    const item = { accessType: 'subscribers', minimumTierId: 'tier-silver' };
    const goldSub = makeSub({
      tier: { id: 'tier-gold', name: 'Gold', sortOrder: 3 },
    });
    expect(decideIsIncluded(item, goldSub, TIERS)).toBe(true);
  });

  it('returns true at exact tier match', () => {
    const item = { accessType: 'subscribers', minimumTierId: 'tier-silver' };
    const silverSub = makeSub({
      tier: { id: 'tier-silver', name: 'Silver', sortOrder: 2 },
    });
    expect(decideIsIncluded(item, silverSub, TIERS)).toBe(true);
  });

  it('returns false when user tier is below minimum', () => {
    const item = { accessType: 'subscribers', minimumTierId: 'tier-gold' };
    const bronzeSub = makeSub();
    expect(decideIsIncluded(item, bronzeSub, TIERS)).toBe(false);
  });

  it('returns false when minimumTierId is unknown to the resolved tiers', () => {
    // Defensive: if the tier list is stale and the content references a
    // tier we don't recognise, the badge stays neutral rather than
    // optimistically claiming inclusion.
    const item = { accessType: 'subscribers', minimumTierId: 'tier-platinum' };
    expect(decideIsIncluded(item, makeSub(), TIERS)).toBe(false);
  });
});

describe('decideIsIncluded — non-eligible access types', () => {
  it.each([
    { accessType: 'free', minimumTierId: null },
    { accessType: 'paid', minimumTierId: null },
    { accessType: 'team', minimumTierId: null },
  ])('returns false for $accessType content', (item) => {
    expect(decideIsIncluded(item, makeSub(), TIERS)).toBe(false);
  });
});
