/**
 * The two client hooks that decide "is it included for me?" on the buyer's
 * pages (Codex-2hxff.91): `useSubscriptionContext` (the content page's gate)
 * and `useAccessContext` (the cards' "Included" and plan label).
 *
 * Both now read SET MEMBERSHIP in the item's `includedInTierIds`, never a
 * `sortOrder` ladder, so:
 * - a dearer plan outside a bundle is not covered (design §2.4 #2);
 * - a gated item with no plan ticked is covered by no plan (closed);
 * - the decision needs no tier list, so "Included" no longer waits on, or
 *   disappears with, the streamed tiers (design §4.3). Only the badge's plan
 *   NAMES wait for them.
 *
 * The live subscription comes from `subscriptionCollection`, stubbed here as a
 * plain Map keyed by org id.
 */
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const collectionState = vi.hoisted(() => new Map<string, unknown>());

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/collections', () => ({
  subscriptionCollection: { state: collectionState },
}));

import { useAccessContext } from './access-context.svelte';
import { useSubscriptionContext } from './subscription-context.svelte';

const ORG = 'org-1';
const BASIC = { id: 'basic', name: 'Basic', priceMonthly: 500, sortOrder: 1 };
const PRO = { id: 'pro', name: 'Pro', priceMonthly: 1200, sortOrder: 2 };
const PREMIUM = {
  id: 'premium',
  name: 'Premium',
  priceMonthly: 2000,
  sortOrder: 3,
};
const TIERS = [BASIC, PRO, PREMIUM];

function liveSub(tier: { id: string; name: string; sortOrder: number }) {
  collectionState.set(ORG, {
    organizationId: ORG,
    tier: { id: tier.id, name: tier.name, sortOrder: tier.sortOrder },
    status: 'active',
    currentPeriodEnd: '2026-11-12T09:00:00.000Z',
    cancelAtPeriodEnd: false,
  });
}

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  flushSync();
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  collectionState.clear();
});

describe('useSubscriptionContext: covered by set membership', () => {
  function subContext(
    item: {
      isTierGated: boolean;
      includedInTierIds: string[];
    },
    subscriptionContext:
      | Promise<never>
      | Promise<Record<string, unknown>>
      | null = null
  ) {
    let read: () => ReturnType<typeof useSubscriptionContext> = () => {
      throw new Error('not set up');
    };
    cleanup = $effect.root(() => {
      const hook = useSubscriptionContext(() => ({
        subscriptionContext: subscriptionContext as never,
        organizationId: ORG,
        enableSubscriptions: true,
        ...item,
      }));
      read = () => hook;
    });
    flushSync();
    return () => read();
  }

  it('a dearer plan outside a bundle is not covered; a plan in it is', () => {
    const bundle = {
      isTierGated: true,
      includedInTierIds: [BASIC.id, PREMIUM.id],
    };

    liveSub(PRO);
    const asPro = subContext(bundle);
    expect(asPro().subCtx).toMatchObject({
      requiresSubscription: true,
      hasSubscription: true,
      subscriptionCoversContent: false,
      currentPlan: { id: PRO.id, name: 'Pro' },
      currentPeriodEnd: '2026-11-12T09:00:00.000Z',
    });
    cleanup?.();

    liveSub(PREMIUM);
    const asPremium = subContext(bundle);
    expect(asPremium().subCtx.subscriptionCoversContent).toBe(true);
  });

  it('a closed item (gated, no plan ticked) is covered by no plan', () => {
    liveSub(PREMIUM);
    const read = subContext({ isTierGated: true, includedInTierIds: [] });
    expect(read().subCtx).toMatchObject({
      requiresSubscription: true,
      subscriptionCoversContent: false,
    });
  });

  it('an item with the switch off needs no subscription', () => {
    liveSub(BASIC);
    const read = subContext({ isTierGated: false, includedInTierIds: [] });
    expect(read().subCtx.requiresSubscription).toBe(false);
  });

  it('streams the plan list: loading, then ready', async () => {
    const read = subContext(
      { isTierGated: true, includedInTierIds: [PRO.id] },
      Promise.resolve({
        requiresSubscription: true,
        hasSubscription: true,
        subscriptionCoversContent: false,
        tiers: TIERS,
        tiersFailed: false,
        currentSubscription: {
          tier: { id: BASIC.id, name: 'Basic' },
          currentPeriodEnd: '2026-11-12T09:00:00.000Z',
        },
      })
    );
    expect(read().tiersStatus).toBe('loading');
    await settle();
    expect(read().tiersStatus).toBe('ready');
    expect(read().tiers).toEqual(TIERS);
    expect(read().subCtx.currentPlan).toEqual({ id: BASIC.id, name: 'Basic' });
  });

  it('carries a waiting move from the live entry, and from the stream (Codex-2hxff.16)', async () => {
    const moving = {
      tierId: BASIC.id,
      tierName: 'Basic',
      effectiveAt: '2026-11-12T09:00:00.000Z',
    };
    collectionState.set(ORG, {
      organizationId: ORG,
      tier: { id: PRO.id, name: PRO.name, sortOrder: PRO.sortOrder },
      status: 'active',
      currentPeriodEnd: '2026-11-12T09:00:00.000Z',
      cancelAtPeriodEnd: false,
      pendingTierChange: moving,
    });
    const live = subContext({
      isTierGated: true,
      includedInTierIds: [BASIC.id],
    });
    expect(live().subCtx.pendingPlan).toEqual({
      id: BASIC.id,
      name: 'Basic',
      effectiveAt: '2026-11-12T09:00:00.000Z',
    });
    cleanup?.();
    collectionState.clear();

    const streamed = subContext(
      { isTierGated: true, includedInTierIds: [BASIC.id] },
      Promise.resolve({
        requiresSubscription: true,
        hasSubscription: true,
        subscriptionCoversContent: false,
        tiers: TIERS,
        tiersFailed: false,
        currentSubscription: {
          tier: { id: PRO.id, name: 'Pro' },
          status: 'active',
          cancelAtPeriodEnd: false,
          currentPeriodEnd: '2026-11-12T09:00:00.000Z',
          pendingTierChange: {
            ...moving,
            kind: 'plan',
            amountCents: 500,
            billingInterval: 'month',
            laterPrice: null,
          },
        },
      })
    );
    await settle();
    expect(streamed().subCtx.pendingPlan).toEqual({
      id: BASIC.id,
      name: 'Basic',
      effectiveAt: '2026-11-12T09:00:00.000Z',
    });
  });

  // waiting-move.html state 6: a cancelling plan ends at the renewal the
  // move would land on, and the move goes with it. The server still sends
  // the move for a cancelling or past-due row, so the hook drops it.
  describe('a plan that is not carrying on drops its waiting move', () => {
    const moving = {
      tierId: BASIC.id,
      tierName: 'Basic',
      effectiveAt: '2026-11-12T09:00:00.000Z',
    };
    const item = { isTierGated: true, includedInTierIds: [BASIC.id] };

    it.each([
      ['cancelling', { status: 'cancelling', cancelAtPeriodEnd: true }],
      ['past due', { status: 'past_due', cancelAtPeriodEnd: false }],
    ])('the live entry, %s: nothing waits', (_label, state) => {
      collectionState.set(ORG, {
        organizationId: ORG,
        tier: { id: PRO.id, name: PRO.name, sortOrder: PRO.sortOrder },
        currentPeriodEnd: '2026-11-12T09:00:00.000Z',
        pendingTierChange: moving,
        ...state,
      });
      expect(subContext(item)().subCtx.pendingPlan).toBeNull();
    });

    it.each([
      ['set to cancel', { status: 'active', cancelAtPeriodEnd: true }],
      ['cancelling', { status: 'cancelling', cancelAtPeriodEnd: true }],
      ['past due', { status: 'past_due', cancelAtPeriodEnd: false }],
    ])('the streamed row, %s: nothing waits', async (_label, state) => {
      const read = subContext(
        item,
        Promise.resolve({
          requiresSubscription: true,
          hasSubscription: true,
          subscriptionCoversContent: false,
          tiers: TIERS,
          tiersFailed: false,
          currentSubscription: {
            tier: { id: PRO.id, name: 'Pro' },
            currentPeriodEnd: '2026-11-12T09:00:00.000Z',
            pendingTierChange: {
              ...moving,
              kind: 'plan',
              amountCents: 500,
              billingInterval: 'month',
              laterPrice: null,
            },
            ...state,
          },
        })
      );
      await settle();
      expect(read().subCtx.hasSubscription).toBe(true);
      expect(read().subCtx.pendingPlan).toBeNull();
    });
  });

  it('an entry written before the field existed reads as nothing waiting', () => {
    liveSub(PRO);
    const read = subContext({
      isTierGated: true,
      includedInTierIds: [BASIC.id],
    });
    expect(read().subCtx.pendingPlan).toBeNull();
  });

  it('a failed plan list is "failed", never an empty "ready"', async () => {
    const read = subContext(
      { isTierGated: true, includedInTierIds: [PRO.id] },
      Promise.resolve({
        requiresSubscription: true,
        hasSubscription: false,
        subscriptionCoversContent: false,
        tiers: [],
        tiersFailed: true,
      })
    );
    await settle();
    expect(read().tiersStatus).toBe('failed');
  });
});

describe('useAccessContext: "Included" and the plan label', () => {
  function accessContext(tiers: Promise<{ tiers: typeof TIERS }>) {
    let read: () => ReturnType<typeof useAccessContext> = () => {
      throw new Error('not set up');
    };
    cleanup = $effect.root(() => {
      const hook = useAccessContext(() => ({
        subscriptionContext: tiers as never,
        isFollowing: false,
        orgId: ORG,
      }));
      read = () => hook;
    });
    flushSync();
    return () => read();
  }

  it('"Included" is set membership and needs no tier list', () => {
    liveSub(PRO);
    // The tiers never arrive: "Included" must not wait on them.
    const read = accessContext(new Promise(() => {}));
    expect(
      read().isIncluded({ isTierGated: true, includedInTierIds: [PRO.id] })
    ).toBe(true);
    expect(
      read().isIncluded({
        isTierGated: true,
        includedInTierIds: [BASIC.id, PREMIUM.id],
      })
    ).toBe(false);
    // No names yet: the badge shows its generic "Subscription".
    expect(
      read().getTierName({ isTierGated: true, includedInTierIds: [PRO.id] })
    ).toBeNull();
  });

  it('names the set once the tiers land (U8)', async () => {
    const read = accessContext(Promise.resolve({ tiers: TIERS }));
    await settle();
    const label = (ids: string[], extra: Record<string, unknown> = {}) =>
      read().getTierName({
        isTierGated: true,
        includedInTierIds: ids,
        ...extra,
      });

    expect(label([PRO.id, PREMIUM.id])).toBe('Pro and above');
    expect(label([PRO.id])).toBe('Pro only');
    expect(label([BASIC.id, PREMIUM.id])).toBe('Basic, Premium');
    // A paid item in plans gets the label for its lower pill.
    expect(label([PRO.id], { isPurchasable: true })).toBe('Pro only');
    // Closed (no plan ticked): no label, so a priced one shows its price.
    expect(label([], { isPurchasable: true })).toBeNull();
    // The switch off: never a plan label.
    expect(
      read().getTierName({ isTierGated: false, includedInTierIds: [PRO.id] })
    ).toBeNull();
  });
});
