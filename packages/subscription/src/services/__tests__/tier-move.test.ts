/**
 * Which change of plan happens when (Codex-2hxff.16, data design §1, every
 * row), and the metadata a move, a Keep and a flip write (§2.1, §4, §5.1).
 * Pure: no database, no Stripe.
 *
 * The prices are the mockups': Basic £5, Pro £12, Premium £20 a month (£50,
 * £120, £200 a year). The member is on Pro.
 */

import { describe, expect, it } from 'vitest';
import {
  billingChangeMetadata,
  classifyTierChange,
  flipMetadata,
  keepMetadata,
  moveMetadata,
  readWaitingMove,
  type TierChangeFacts,
} from '../tier-move';

const PRO = 'tier-pro';
const BASIC = 'tier-basic';
const PREMIUM = 'tier-premium';
const MONTHLY: Record<string, number> = {
  [BASIC]: 500,
  [PRO]: 1200,
  [PREMIUM]: 2000,
};
const ANNUAL: Record<string, number> = {
  [BASIC]: 5000,
  [PRO]: 12000,
  [PREMIUM]: 20000,
};

/** A move to Basic waiting for the renewal, on the same billing. */
const PLAN_MOVE = { kind: 'plan', tierId: BASIC } as const;
/** A switch to monthly billing waiting for the year's end (Codex-2hxff.97). */
const BILLING_WAIT = { kind: 'billing', tierId: PRO } as const;

/** A change from Pro on `from` to `tier` on `to`. */
function facts(
  tier: string,
  to: 'month' | 'year',
  overrides: Partial<TierChangeFacts> & { from?: 'month' | 'year' } = {}
): TierChangeFacts {
  const from = overrides.from ?? 'month';
  const onCurrent = from === 'month' ? MONTHLY : ANNUAL;
  return {
    currentTierId: PRO,
    currentInterval: from,
    currentAmountCents: onCurrent[PRO] ?? 0,
    targetTierId: tier,
    targetInterval: to,
    targetAmountOnCurrentIntervalCents: onCurrent[tier] ?? 0,
    targetOnCurrentInterval: true,
    waiting: null,
    cancelling: false,
    ...overrides,
  };
}

describe('classifyTierChange (data design §1)', () => {
  describe('another tier on the same billing period', () => {
    it('dearer: an upgrade, now', () => {
      expect(classifyTierChange(facts(PREMIUM, 'month'))).toEqual({
        kind: 'upgrade',
      });
    });

    it('dearer while a move waits: refused, keep the current plan first (T2)', () => {
      expect(
        classifyTierChange(facts(PREMIUM, 'month', { waiting: PLAN_MOVE }))
      ).toEqual({ refused: 'keep_first' });
    });

    it('cheaper: a downgrade, waiting for the period end (T1)', () => {
      expect(classifyTierChange(facts(BASIC, 'month'))).toEqual({
        kind: 'downgrade',
      });
    });

    it('cheaper while a move waits: a downgrade again, which replaces it (latest wins, T2)', () => {
      expect(
        classifyTierChange(facts(BASIC, 'month', { waiting: PLAN_MOVE }))
      ).toEqual({ kind: 'downgrade' });
    });

    it('the same price: a lateral switch, now (Q4)', () => {
      expect(
        classifyTierChange(
          facts('tier-pro-plus', 'month', {
            targetAmountOnCurrentIntervalCents: 1200,
          })
        )
      ).toEqual({ kind: 'lateral' });
    });

    it('the same price while a move waits: lateral, which replaces the move', () => {
      expect(
        classifyTierChange(
          facts('tier-pro-plus', 'month', {
            targetAmountOnCurrentIntervalCents: 1200,
            waiting: PLAN_MOVE,
          })
        )
      ).toEqual({ kind: 'lateral' });
    });

    it('their own plan while a move waits: refused, keep the current plan (Keep restores the exact Price)', () => {
      expect(
        classifyTierChange(facts(PRO, 'month', { waiting: PLAN_MOVE }))
      ).toEqual({ refused: 'keep_first' });
    });

    it('their own plan with nothing waiting: by price, as today (the same price is lateral)', () => {
      expect(classifyTierChange(facts(PRO, 'month'))).toEqual({
        kind: 'lateral',
      });
    });

    it('judges by what the member PAYS while a move waits, not the cheaper next bill (§2.2 trap 2)', () => {
      // Premium (£20, held) with a move to Basic waiting: the row's next bill
      // says £5. "Downgrade to Pro" (£12) is a downgrade, not an upgrade.
      expect(
        classifyTierChange({
          currentTierId: PREMIUM,
          currentInterval: 'month',
          currentAmountCents: 2000,
          targetTierId: PRO,
          targetInterval: 'month',
          targetAmountOnCurrentIntervalCents: 1200,
          targetOnCurrentInterval: true,
          waiting: PLAN_MOVE,
          cancelling: false,
        })
      ).toEqual({ kind: 'downgrade' });
    });
  });

  describe('the same tier on the other billing period', () => {
    it("yearly to monthly: waits for the year's end, nothing credited (Codex-2hxff.97, A)", () => {
      expect(classifyTierChange(facts(PRO, 'month', { from: 'year' }))).toEqual(
        { kind: 'billing_wait' }
      );
    });

    it('monthly to yearly: switches now with a charge, as today', () => {
      expect(classifyTierChange(facts(PRO, 'year'))).toEqual({
        kind: 'interval_switch',
      });
    });

    it('monthly to yearly while a move waits: refused (Q3)', () => {
      expect(
        classifyTierChange(facts(PRO, 'year', { waiting: PLAN_MOVE }))
      ).toEqual({ refused: 'interval_while_moving' });
    });

    it.each([
      ['a move to a cheaper plan', PLAN_MOVE],
      ['a change of billing', BILLING_WAIT],
    ] as const)('yearly to monthly while %s waits: joins it, the latest choice wins (Q2)', (_, waiting) => {
      expect(
        classifyTierChange(facts(PRO, 'month', { from: 'year', waiting }))
      ).toEqual({ kind: 'billing_wait' });
    });
  });

  describe('another tier on the other billing period (Q1: compare on the current period)', () => {
    it('cheaper: two steps, the plan first', () => {
      // Pro monthly (£12) to Basic yearly (£50): Basic is cheaper than Pro on
      // the member's monthly period (£5 < £12), though £50 > £12.
      expect(classifyTierChange(facts(BASIC, 'year'))).toEqual({
        refused: 'two_steps',
      });
    });

    it('cheaper from yearly: one waiting change, plan and billing together (Codex-2hxff.97, B, Q3)', () => {
      expect(
        classifyTierChange(facts(BASIC, 'month', { from: 'year' }))
      ).toEqual({ kind: 'move_with_billing' });
    });

    it.each([
      ['a move to a cheaper plan', PLAN_MOVE],
      ['a change of billing', BILLING_WAIT],
    ] as const)('cheaper from yearly while %s waits: replaces it (Q2)', (_, waiting) => {
      expect(
        classifyTierChange(facts(BASIC, 'month', { from: 'year', waiting }))
      ).toEqual({ kind: 'move_with_billing' });
    });

    it('dearer from yearly: the plan now on yearly billing, monthly from the renewal (C(b), Q1)', () => {
      // Pro yearly (£120) to Premium monthly (£20): Premium is dearer on the
      // yearly period (£200 > £120), though £20 < £120.
      expect(
        classifyTierChange(facts(PREMIUM, 'month', { from: 'year' }))
      ).toEqual({ kind: 'change_then_billing_wait' });
    });

    it('dearer from yearly with no yearly Price: the whole change waits (C(a))', () => {
      expect(
        classifyTierChange(
          facts(PREMIUM, 'month', {
            from: 'year',
            targetOnCurrentInterval: false,
          })
        )
      ).toEqual({ kind: 'move_with_billing' });
    });

    it.each([
      ['a move to a cheaper plan', PLAN_MOVE],
      ['a change of billing', BILLING_WAIT],
    ] as const)('dearer from yearly while %s waits: refused, keep first', (_, waiting) => {
      expect(
        classifyTierChange(facts(PREMIUM, 'month', { from: 'year', waiting }))
      ).toEqual({ refused: 'keep_first' });
    });

    it('the same price from yearly while something waits: the plan now, replacing it', () => {
      expect(
        classifyTierChange(
          facts('tier-pro-plus', 'month', {
            from: 'year',
            targetAmountOnCurrentIntervalCents: 12000,
            waiting: BILLING_WAIT,
          })
        )
      ).toEqual({ kind: 'change_then_billing_wait' });
    });

    it('monthly to a cheaper yearly plan: still two steps', () => {
      expect(classifyTierChange(facts(BASIC, 'year'))).toEqual({
        refused: 'two_steps',
      });
    });

    it('dearer while a move waits: refused, keep first', () => {
      expect(
        classifyTierChange(facts(PREMIUM, 'year', { waiting: PLAN_MOVE }))
      ).toEqual({ refused: 'keep_first' });
    });

    it('cheaper while a move waits: two steps (step 1 replaces the move)', () => {
      expect(
        classifyTierChange(facts(BASIC, 'year', { waiting: PLAN_MOVE }))
      ).toEqual({ refused: 'two_steps' });
    });
  });

  it.each([
    ['an upgrade', PREMIUM, 'month'],
    ['a downgrade', BASIC, 'month'],
    ['a billing switch', PRO, 'year'],
    ['a cheaper plan on the other period', BASIC, 'year'],
  ] as const)('%s while set to cancel: refused, reactivate first (Q2)', (_, tier, to) => {
    expect(classifyTierChange(facts(tier, to, { cancelling: true }))).toEqual({
      refused: 'cancelling',
    });
  });

  it('leaving yearly billing while set to cancel: refused, reactivate first', () => {
    expect(
      classifyTierChange(
        facts(PRO, 'month', { from: 'year', cancelling: true })
      )
    ).toEqual({ refused: 'cancelling' });
  });

  describe('on yearly billing while a change of billing waits (Codex-2hxff.97)', () => {
    const yearly = (tier: string, amount?: number) =>
      facts(tier, 'year', {
        from: 'year',
        waiting: BILLING_WAIT,
        ...(amount !== undefined && {
          targetAmountOnCurrentIntervalCents: amount,
        }),
      });

    it('a cheaper plan on yearly: a downgrade, which replaces it (§2.4)', () => {
      expect(classifyTierChange(yearly(BASIC))).toEqual({ kind: 'downgrade' });
    });

    it('their own plan on yearly: keep first (Keep yearly billing)', () => {
      expect(classifyTierChange(yearly(PRO))).toEqual({
        refused: 'keep_first',
      });
    });

    it('a dearer plan on yearly: keep first', () => {
      expect(classifyTierChange(yearly(PREMIUM))).toEqual({
        refused: 'keep_first',
      });
    });

    it('the same price on yearly: lateral, which replaces it', () => {
      expect(classifyTierChange(yearly('tier-pro-plus', 12000))).toEqual({
        kind: 'lateral',
      });
    });
  });
});

describe('the waiting move metadata', () => {
  const TARGET = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';
  const base = {
    currentTierId: PRO,
    userId: 'user-1',
    organizationId: 'org-1',
    targetTierId: TARGET,
    moveAt: 1_702_000_000,
  };

  it('the first move writes the hold marker, parks a pending price change and clears it live', () => {
    const written = moveMetadata({
      ...base,
      hold: {
        priceId: 'price_pro_m',
        amountCents: 1200,
        metadata: {
          codex_pending_price_id: 'price_pro_m_v2',
          codex_pending_price_from: '1705000000',
        },
      },
    });

    expect(written).toEqual({
      codex_tier_id: PRO,
      codex_user_id: 'user-1',
      codex_organization_id: 'org-1',
      codex_move_tier_id: TARGET,
      codex_move_at: '1702000000',
      codex_hold_price_id: 'price_pro_m',
      codex_hold_amount: '1200',
      codex_hold_pending_price_id: 'price_pro_m_v2',
      codex_hold_pending_price_from: '1705000000',
      codex_pending_price_id: '',
      codex_pending_price_from: '',
      // A move on the same billing replaces a waiting change of billing.
      codex_move_interval: '',
      codex_move_price_id: '',
      codex_move_amount: '',
    });
  });

  it('a replacement (latest wins) writes no hold key, so the first move’s are kept', () => {
    const written = moveMetadata(base);

    for (const key of Object.keys(written)) {
      expect(key).not.toMatch(/^codex_hold_/);
    }
    expect(written.codex_move_tier_id).toBe(TARGET);
    // An earlier target's price change belonged to that target.
    expect(written.codex_pending_price_id).toBe('');
  });

  it('Keep clears the move and hold keys and restores the parked price change', () => {
    const move = readWaitingMove({
      codex_move_tier_id: TARGET,
      codex_move_at: '1702000000',
      codex_hold_price_id: 'price_pro_m',
      codex_hold_amount: '1200',
      codex_hold_pending_price_id: 'price_pro_m_v2',
      codex_hold_pending_price_from: '1705000000',
    });
    expect(move).not.toBeNull();
    if (!move) return;

    expect(keepMetadata(move)).toEqual({
      codex_move_tier_id: '',
      codex_move_at: '',
      codex_move_interval: '',
      codex_move_price_id: '',
      codex_move_amount: '',
      codex_hold_price_id: '',
      codex_hold_amount: '',
      codex_hold_pending_price_id: '',
      codex_hold_pending_price_from: '',
      codex_pending_price_id: 'price_pro_m_v2',
      codex_pending_price_from: '1705000000',
    });
  });

  it('Keep with nothing parked clears codex_pending_price_* (a change on the target was the target’s)', () => {
    const move = readWaitingMove({
      codex_move_tier_id: TARGET,
      codex_move_at: '1702000000',
      codex_hold_price_id: 'price_pro_m',
      codex_hold_amount: '1200',
      codex_pending_price_id: 'price_basic_m_v2',
    });
    expect(move).not.toBeNull();
    if (!move) return;

    const written = keepMetadata(move);
    expect(written.codex_pending_price_id).toBe('');
    expect(written.codex_pending_price_from).toBe('');
  });

  it('the flip moves codex_tier_id to the target and leaves codex_pending_price_* alone (T6)', () => {
    const move = readWaitingMove({
      codex_move_tier_id: TARGET,
      codex_move_at: '1702000000',
      codex_hold_price_id: 'price_pro_m',
      codex_hold_amount: '1200',
    });
    expect(move).not.toBeNull();
    if (!move) return;

    const written = flipMetadata(move);
    expect(written.codex_tier_id).toBe(TARGET);
    expect(written.codex_move_tier_id).toBe('');
    expect(written.codex_hold_price_id).toBe('');
    expect(written).not.toHaveProperty('codex_pending_price_id');
  });
});

describe('a waiting change of billing, as metadata (Codex-2hxff.97, §2.1)', () => {
  const TARGET = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';
  const record = billingChangeMetadata({
    tierId: PRO,
    userId: 'user-1',
    organizationId: 'org-1',
    targetTierId: TARGET,
    moveAt: 1_702_000_000,
    hold: { priceId: 'price_pro_y', amountCents: 12000 },
    parkedPendingPrice: { priceId: 'price_pro_y_v2', from: '1705000000' },
    billing: {
      interval: 'month',
      priceId: 'price_basic_m',
      amountCents: 500,
    },
  });

  it('the record: the move, the item’s own Price held, the price change parked, and the billing keys', () => {
    expect(record).toEqual({
      codex_tier_id: PRO,
      codex_user_id: 'user-1',
      codex_organization_id: 'org-1',
      codex_move_tier_id: TARGET,
      codex_move_at: '1702000000',
      codex_hold_price_id: 'price_pro_y',
      codex_hold_amount: '12000',
      codex_hold_pending_price_id: 'price_pro_y_v2',
      codex_hold_pending_price_from: '1705000000',
      // A live marker on the yearly Price would outlive the switch (P4).
      codex_pending_price_id: '',
      codex_pending_price_from: '',
      codex_move_interval: 'month',
      codex_move_price_id: 'price_basic_m',
      codex_move_amount: '500',
    });
  });

  it('reads back as a waiting move with its billing', () => {
    expect(readWaitingMove(record)).toEqual({
      tierId: TARGET,
      at: 1_702_000_000,
      holdPriceId: 'price_pro_y',
      holdAmountCents: 12000,
      parkedPendingPrice: { priceId: 'price_pro_y_v2', from: '1705000000' },
      billing: {
        interval: 'month',
        priceId: 'price_basic_m',
        amountCents: 500,
      },
    });
  });

  it('a plan move reads with no billing; half the billing keys read as none', () => {
    const { codex_move_amount: _amount, ...half } = record;
    expect(readWaitingMove(half)?.billing).toBeNull();
    expect(
      readWaitingMove({ ...record, codex_move_interval: 'week' })?.billing
    ).toBeNull();
  });

  it('Keep clears all of it and puts the parked price change back', () => {
    const move = readWaitingMove(record);
    expect(move).not.toBeNull();
    if (!move) return;
    const kept = { ...record, ...keepMetadata(move) };
    const left = Object.fromEntries(
      Object.entries(kept).filter(([, value]) => value !== '')
    );
    expect(left).toEqual({
      codex_tier_id: PRO,
      codex_user_id: 'user-1',
      codex_organization_id: 'org-1',
      codex_pending_price_id: 'price_pro_y_v2',
      codex_pending_price_from: '1705000000',
    });
  });

  it("phase 2's flip: the target tier, every move and hold key gone, a price change on the target left alone", () => {
    const flip = flipMetadata({ tierId: TARGET });
    expect(flip.codex_tier_id).toBe(TARGET);
    for (const key of Object.keys(record)) {
      if (key.startsWith('codex_move_') || key.startsWith('codex_hold_')) {
        expect(flip[key]).toBe('');
      }
    }
    expect(flip).not.toHaveProperty('codex_pending_price_id');
    expect(flip).not.toHaveProperty('codex_pending_price_from');
  });
});
