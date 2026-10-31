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
    moveWaiting: false,
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
        classifyTierChange(facts(PREMIUM, 'month', { moveWaiting: true }))
      ).toEqual({ refused: 'keep_first' });
    });

    it('cheaper: a downgrade, waiting for the period end (T1)', () => {
      expect(classifyTierChange(facts(BASIC, 'month'))).toEqual({
        kind: 'downgrade',
      });
    });

    it('cheaper while a move waits: a downgrade again, which replaces it (latest wins, T2)', () => {
      expect(
        classifyTierChange(facts(BASIC, 'month', { moveWaiting: true }))
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
            moveWaiting: true,
          })
        )
      ).toEqual({ kind: 'lateral' });
    });

    it('their own plan while a move waits: refused, keep the current plan (Keep restores the exact Price)', () => {
      expect(
        classifyTierChange(facts(PRO, 'month', { moveWaiting: true }))
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
          moveWaiting: true,
          cancelling: false,
        })
      ).toEqual({ kind: 'downgrade' });
    });
  });

  describe('the same tier on the other billing period', () => {
    it('yearly to monthly: switches now with credit, as today (T1)', () => {
      expect(classifyTierChange(facts(PRO, 'month', { from: 'year' }))).toEqual(
        { kind: 'interval_switch' }
      );
    });

    it('monthly to yearly: switches now with a charge, as today', () => {
      expect(classifyTierChange(facts(PRO, 'year'))).toEqual({
        kind: 'interval_switch',
      });
    });

    it.each([
      ['yearly to monthly', 'year', 'month'],
      ['monthly to yearly', 'month', 'year'],
    ] as const)('%s while a move waits: refused (Q3)', (_, from, to) => {
      expect(
        classifyTierChange(facts(PRO, to, { from, moveWaiting: true }))
      ).toEqual({ refused: 'interval_while_moving' });
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

    it('cheaper from yearly: two steps too', () => {
      expect(
        classifyTierChange(facts(BASIC, 'month', { from: 'year' }))
      ).toEqual({ refused: 'two_steps' });
    });

    it('dearer: now, with Stripe proration across periods', () => {
      // Pro yearly (£120) to Premium monthly (£20): Premium is dearer on the
      // yearly period (£200 > £120), though £20 < £120.
      expect(
        classifyTierChange(facts(PREMIUM, 'month', { from: 'year' }))
      ).toEqual({ kind: 'cross_period_change' });
    });

    it('dearer while a move waits: refused, keep first', () => {
      expect(
        classifyTierChange(facts(PREMIUM, 'year', { moveWaiting: true }))
      ).toEqual({ refused: 'keep_first' });
    });

    it('cheaper while a move waits: two steps (step 1 replaces the move)', () => {
      expect(
        classifyTierChange(facts(BASIC, 'year', { moveWaiting: true }))
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
