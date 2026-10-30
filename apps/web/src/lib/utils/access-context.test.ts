/**
 * Unit tests for the pure decision helpers in access-context.svelte.ts
 * (Codex-q7dyz — PriceBadge correctness for subscribers viewing
 * followers-only content under the `subscribers ⊇ followers` hierarchy).
 *
 * The reactive `useAccessContext()` hook is a thin wrapper that reads from
 * `subscriptionCollection` and an awaited tiers promise; the access decision
 * itself lives in pure helpers (`isAccessGrantingSubscription`,
 * `decideIsIncluded`) so it can be exercised here without a Svelte runtime.
 *
 * Plan access (Codex-2hxff.91): "Included" is set membership in the item's
 * `includedInTierIds`, never a `sortOrder` compare, so it needs no tier list.
 */
import { describe, expect, it } from 'vitest';
import type { SubscriptionItem } from '$lib/collections';
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

describe('isAccessGrantingSubscription', () => {
  it('treats active, cancelling and past_due as access-granting', () => {
    expect(isAccessGrantingSubscription(makeSub({ status: 'active' }))).toBe(
      true
    );
    expect(
      isAccessGrantingSubscription(makeSub({ status: 'cancelling' }))
    ).toBe(true);
    // A failed renewal keeps access while Stripe retries (Codex-2hxff.10).
    expect(isAccessGrantingSubscription(makeSub({ status: 'past_due' }))).toBe(
      true
    );
  });

  it('rejects paused, cancelled, and incomplete', () => {
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

describe('decideIsIncluded — follower-gated (Codex-xybr3 hierarchy)', () => {
  const followersItem = { isFollowerGated: true };

  it('returns true when an active subscription exists at any tier', () => {
    expect(decideIsIncluded(followersItem, makeSub())).toBe(true);
  });

  it('returns true for cancelling subscriptions (still in access window)', () => {
    expect(
      decideIsIncluded(followersItem, makeSub({ status: 'cancelling' }))
    ).toBe(true);
  });

  it('returns true regardless of the plan set — follower-gated is tier-agnostic', () => {
    // backend ignores the tier for follower-gated content (xybr3) — any active
    // subscription counts. The pure helper preserves that semantic so the badge
    // decision matches the streaming-gate decision.
    const followersItemWithTier = {
      isFollowerGated: true,
      includedInTierIds: ['tier-gold'],
    };
    expect(decideIsIncluded(followersItemWithTier, makeSub())).toBe(true);
  });

  it('returns false when no subscription exists', () => {
    expect(decideIsIncluded(followersItem, null)).toBe(false);
  });
});

describe('decideIsIncluded — tier-gated (set membership)', () => {
  const sub = (id: string, name: string, sortOrder: number) =>
    makeSub({ tier: { id, name, sortOrder } });

  it('returns false when not tier-gated and not follower-gated', () => {
    // The switch off is "not tier-gated", not "any tier covers". With no
    // follower gate either, the item is not subscription-included.
    const item = { isTierGated: false, includedInTierIds: [] };
    expect(decideIsIncluded(item, makeSub())).toBe(false);
  });

  it("returns true when the user's plan is one of the item's plans", () => {
    const item = {
      isTierGated: true,
      includedInTierIds: ['tier-silver', 'tier-gold'],
    };
    expect(decideIsIncluded(item, sub('tier-gold', 'Gold', 3))).toBe(true);
    expect(decideIsIncluded(item, sub('tier-silver', 'Silver', 2))).toBe(true);
  });

  it("returns false when the user's plan is not in the set", () => {
    const item = { isTierGated: true, includedInTierIds: ['tier-gold'] };
    expect(decideIsIncluded(item, makeSub())).toBe(false);
  });

  it('returns false for a dearer plan left out of a non-contiguous set', () => {
    // A bundle: Bronze and Gold include it, Silver doesn't. Under the old
    // ladder a Silver member (sortOrder 2 >= Bronze's 1) read "Included";
    // the server denies them (Codex-2hxff.91, design §2.4 #2).
    const item = {
      isTierGated: true,
      includedInTierIds: ['tier-bronze', 'tier-gold'],
    };
    expect(decideIsIncluded(item, sub('tier-silver', 'Silver', 2))).toBe(false);
    expect(decideIsIncluded(item, sub('tier-bronze', 'Bronze', 1))).toBe(true);
    expect(decideIsIncluded(item, sub('tier-gold', 'Gold', 3))).toBe(true);
  });

  it('returns false for a closed item: gated with no plan ticked', () => {
    // Fail closed: no plan includes it, so no subscriber reads "Included".
    expect(
      decideIsIncluded({ isTierGated: true, includedInTierIds: [] }, makeSub())
    ).toBe(false);
    expect(decideIsIncluded({ isTierGated: true }, makeSub())).toBe(false);
  });

  it('ignores a set on an item whose switch is off', () => {
    // I1 says no switch, no ticks; a stale set must not open it.
    const item = { isTierGated: false, includedInTierIds: ['tier-bronze'] };
    expect(decideIsIncluded(item, makeSub())).toBe(false);
  });
});

describe('decideIsIncluded — non-eligible content', () => {
  it.each([
    { label: 'free', item: {} },
    { label: 'purchasable', item: { isPurchasable: true } },
  ])('returns false for $label content', ({ item }) => {
    expect(decideIsIncluded(item, makeSub())).toBe(false);
  });
});
