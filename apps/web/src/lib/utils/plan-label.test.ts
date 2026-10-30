/**
 * The buyer's plan names (Codex-2hxff.91): the card badge (owner decision U8),
 * the paywall (U9, U11) and the pricing highlight (U10), on the buyer
 * mockup's org: Basic £5, Pro £12 (Most Popular), Premium £20 a month.
 *
 * "Dearer" and "cheapest" are by MONTHLY price, strictly (U1), never by the
 * display order, so the badge's "and above" is exactly the set the Studio
 * shortcut ticks.
 */
import { describe, expect, it } from 'vitest';
import {
  describePlanPaywall,
  includingPlans,
  type PlanPaywallInput,
  planBadgeLabel,
  planNamesPhrase,
  planPaywallCopy,
  pricingHighlight,
} from './plan-label';

const BASIC = { id: 'basic', name: 'Basic', priceMonthly: 500, sortOrder: 1 };
const PRO = { id: 'pro', name: 'Pro', priceMonthly: 1200, sortOrder: 2 };
const PREMIUM = {
  id: 'premium',
  name: 'Premium',
  priceMonthly: 2000,
  sortOrder: 3,
};
const TIERS = [BASIC, PRO, PREMIUM];

const formatDate = (iso: string) => `<${iso.slice(0, 10)}>`;

describe('includingPlans', () => {
  it('keeps the active plans in the set, cheapest first', () => {
    expect(includingPlans([PREMIUM.id, BASIC.id], TIERS)).toEqual([
      BASIC,
      PREMIUM,
    ]);
  });

  it('drops a tick on a plan nobody can join (not in the active list)', () => {
    expect(includingPlans(['retired', PRO.id], TIERS)).toEqual([PRO]);
  });

  it('orders by monthly price, not display order', () => {
    // The creator lists Pro first, but Basic is cheaper.
    const reordered = [
      { ...PRO, sortOrder: 1 },
      { ...BASIC, sortOrder: 2 },
    ];
    expect(
      includingPlans([PRO.id, BASIC.id], reordered).map((t) => t.id)
    ).toEqual([BASIC.id, PRO.id]);
  });

  it('is empty for no set at all', () => {
    expect(includingPlans(undefined, TIERS)).toEqual([]);
    expect(includingPlans([], TIERS)).toEqual([]);
  });
});

describe('planBadgeLabel (U8, mockup badge A)', () => {
  it.each([
    ['The Long Field', [BASIC.id, PRO.id, PREMIUM.id], 'Basic and above'],
    ['Salt Roads', [PRO.id, PREMIUM.id], 'Pro and above'],
    ['Harbour Light', [PRO.id], 'Pro only'],
    ['Night Ferry (the dearest)', [PREMIUM.id], 'Premium'],
    ['Winter Light (not Pro)', [BASIC.id, PREMIUM.id], 'Basic, Premium'],
  ])('%s → %s', (_film, ids, label) => {
    expect(planBadgeLabel(ids, TIERS)).toBe(label);
  });

  it('names a pair in price order, whatever order the ticks are in', () => {
    expect(planBadgeLabel([PREMIUM.id, BASIC.id], TIERS)).toBe(
      'Basic, Premium'
    );
  });

  it('counts a scattered set of three or more', () => {
    const ULTRA = {
      id: 'ultra',
      name: 'Ultra',
      priceMonthly: 3000,
      sortOrder: 4,
    };
    expect(
      planBadgeLabel([BASIC.id, PRO.id, ULTRA.id], [...TIERS, ULTRA])
    ).toBe('3 plans');
  });

  it('judges "above" by price: a same-price plan is not dearer', () => {
    // Two £5 plans: "Basic and above" is Basic + every plan costing MORE.
    const TWIN = { id: 'twin', name: 'Twin', priceMonthly: 500, sortOrder: 4 };
    const tiers = [...TIERS, TWIN];
    expect(planBadgeLabel([BASIC.id, PRO.id, PREMIUM.id], tiers)).toBe(
      'Basic and above'
    );
    // One plan with a same-price twin and nothing dearer is bare.
    expect(planBadgeLabel([TWIN.id], [BASIC, TWIN])).toBe('Twin');
  });

  it('is null when no active plan includes it, or the plans have not loaded', () => {
    expect(planBadgeLabel([], TIERS)).toBeNull();
    expect(planBadgeLabel(['retired'], TIERS)).toBeNull();
    expect(planBadgeLabel([PRO.id], [])).toBeNull();
  });
});

describe('planNamesPhrase', () => {
  it('says "and above" for the shortcut shape, else joins the names', () => {
    expect(planNamesPhrase([PRO, PREMIUM], TIERS)).toBe('Pro and above');
    expect(planNamesPhrase([BASIC, PREMIUM], TIERS)).toBe('Basic and Premium');
    expect(planNamesPhrase([PRO], TIERS)).toBe('Pro');
    expect(planNamesPhrase([PREMIUM], TIERS)).toBe('Premium');
    expect(planNamesPhrase([], TIERS)).toBe('');
  });
});

describe('describePlanPaywall + planPaywallCopy (U9, U11)', () => {
  const input = (overrides: Partial<PlanPaywallInput>): PlanPaywallInput => ({
    includedInTierIds: [PRO.id, PREMIUM.id],
    tiers: TIERS,
    tiersStatus: 'ready',
    currentPlan: null,
    currentPeriodEnd: null,
    ...overrides,
  });
  const copy = (overrides: Partial<PlanPaywallInput>) =>
    planPaywallCopy(describePlanPaywall(input(overrides)), formatDate);

  it('no plan yet: the plans and the cheapest price', () => {
    expect(copy({})).toEqual({
      title: 'Subscribe to Watch',
      short: 'Included with Pro and above.',
      full: 'Included with Pro and above, from £12.00 a month.',
      timing: null,
    });
  });

  it('every including plan dearer than mine: Upgrade', () => {
    expect(copy({ currentPlan: { id: BASIC.id, name: 'Basic' } })).toEqual({
      title: 'Upgrade to Watch',
      short: 'Not in your Basic plan. Included with Pro and above.',
      full: "Your Basic plan doesn't include this. It's included with Pro and above, from £12.00 a month.",
      timing: null,
    });
  });

  it('a cheaper plan includes it: Change plan, naming each with its price and timing', () => {
    expect(
      copy({
        includedInTierIds: [BASIC.id, PREMIUM.id],
        currentPlan: { id: PRO.id, name: 'Pro' },
        currentPeriodEnd: '2026-11-12T09:00:00.000Z',
      })
    ).toEqual({
      title: 'Change plan to watch',
      short: 'Not in your Pro plan. Included with Basic and Premium.',
      full: "Your Pro plan doesn't include this. It's included with Basic (£5.00 a month) and Premium (£20.00 a month).",
      timing:
        'Premium starts straight away; a move to Basic starts when your Pro period ends on <2026-11-12>.',
    });
  });

  it('only cheaper plans include it: the move starts at the period end', () => {
    const result = copy({
      includedInTierIds: [BASIC.id],
      currentPlan: { id: PREMIUM.id, name: 'Premium' },
      currentPeriodEnd: '2026-11-12T09:00:00.000Z',
    });
    expect(result.title).toBe('Change plan to watch');
    expect(result.timing).toBe(
      'A move to Basic starts when your Premium period ends on <2026-11-12>.'
    );
  });

  it('several cheaper plans read as one choice ("or")', () => {
    const result = copy({
      includedInTierIds: [BASIC.id, PRO.id],
      currentPlan: { id: PREMIUM.id, name: 'Premium' },
    });
    expect(result.timing).toBe(
      'A move to Basic or Pro starts when your current Premium period ends.'
    );
  });

  it('a same-price plan is a change at the period end, never an upgrade', () => {
    const TWIN = { id: 'twin', name: 'Twin', priceMonthly: 1200, sortOrder: 4 };
    const paywall = describePlanPaywall(
      input({
        includedInTierIds: [TWIN.id],
        tiers: [...TIERS, TWIN],
        currentPlan: { id: PRO.id, name: 'Pro' },
      })
    );
    expect(paywall).toMatchObject({
      kind: 'change',
      upgradePlans: null,
      downgradePlans: 'Twin',
    });
  });

  it('my plan is off sale (price unknown): names the plans, no timing', () => {
    const paywall = describePlanPaywall(
      input({ currentPlan: { id: 'retired', name: 'Founders' } })
    );
    expect(paywall).toMatchObject({
      kind: 'change',
      currentPlan: 'Founders',
      upgradePlans: null,
      downgradePlans: null,
    });
    expect(planPaywallCopy(paywall, formatDate).timing).toBeNull();
  });

  describe('closed (U11)', () => {
    const closed = {
      title: 'Not available right now',
      short: 'No plan includes this at the moment.',
      full: 'No plan includes this at the moment.',
      timing: null,
    };

    it('gated with no plan ticked', () => {
      expect(copy({ includedInTierIds: [] })).toEqual(closed);
    });

    it('called without the plan list: no tick needs no list', () => {
      expect(
        describePlanPaywall(
          input({ includedInTierIds: [], tiersStatus: 'loading' })
        )
      ).toEqual({ kind: 'closed' });
      expect(
        describePlanPaywall(
          input({ includedInTierIds: [], tiersStatus: 'failed' })
        )
      ).toEqual({ kind: 'closed' });
    });

    it('ticked only on plans nobody can join', () => {
      expect(copy({ includedInTierIds: ['retired'] })).toEqual(closed);
    });
  });

  it('while the plans load: a title, no plan line yet', () => {
    expect(copy({ tiersStatus: 'loading' })).toEqual({
      title: 'Subscribe to Watch',
      short: null,
      full: null,
      timing: null,
    });
  });

  it('the plans failed: names no plan, and never calls it closed', () => {
    expect(copy({ tiersStatus: 'failed' })).toMatchObject({
      title: 'Subscribe to Watch',
      full: 'Subscribe to get access to this content',
    });
    expect(
      copy({
        tiersStatus: 'failed',
        currentPlan: { id: BASIC.id, name: 'Basic' },
      })
    ).toMatchObject({
      title: 'Change plan to watch',
      full: "Your plan doesn't include this content",
    });
  });

  it('a row without the set (older content-api) is unnamed, never closed', () => {
    expect(describePlanPaywall(input({ includedInTierIds: null }))).toEqual({
      kind: 'unnamed',
      member: false,
    });
  });
});

describe('pricingHighlight (U10)', () => {
  it('names the including plans in full and marks their cards', () => {
    const highlight = pricingHighlight(
      { title: 'Salt Roads', includedInTierIds: [PRO.id, PREMIUM.id] },
      TIERS
    );
    expect(highlight.headline).toBe(
      'Salt Roads is included with Pro and Premium.'
    );
    expect([...highlight.includedTierIds]).toEqual([PRO.id, PREMIUM.id]);
  });

  it('says no plan includes it when none on the page does', () => {
    const highlight = pricingHighlight(
      { title: 'Lost Reels', includedInTierIds: ['retired'] },
      TIERS
    );
    expect(highlight.headline).toBe('No plan includes Lost Reels right now.');
    expect(highlight.includedTierIds.size).toBe(0);
  });
});
