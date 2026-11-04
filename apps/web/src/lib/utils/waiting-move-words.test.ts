/**
 * The words of what waits for the renewal, by its kind (Codex-2hxff.97,
 * year-to-month-waits.html E1-E4, E7 and A2): a cheaper plan (.16's
 * words, unchanged), monthly billing on the same plan, or both. The pricing
 * and account pages share these, so one test covers both notices.
 */

import { describe, expect, it } from 'vitest';
import { formatPrice } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import {
  type WaitingMove,
  waitingMoveBody,
  waitingMoveKeepFailedLine,
  waitingMoveKeepLabel,
  waitingMoveKeptLine,
  waitingMoveLandedLine,
  waitingMoveSurvivesCancelLine,
  waitingMoveTitle,
} from './plan-label';

const RENEWAL = '2027-03-12T00:00:00.000Z';
const date = (iso: string) => (iso === RENEWAL ? '12 March' : iso);

function move(
  kind: WaitingMove['kind'],
  overrides: Partial<WaitingMove> = {}
): WaitingMove & { effectiveAt: string } {
  const toBasic = kind !== 'billing';
  return {
    kind,
    tierName: toBasic ? 'Basic' : 'Pro',
    amountCents: toBasic ? 500 : 1200,
    billingInterval: kind === 'plan' ? 'year' : 'month',
    laterPrice: null,
    effectiveAt: RENEWAL,
    ...overrides,
  };
}

describe('only the billing waits (A, E1, E3)', () => {
  const billing = move('billing');

  it('says when monthly billing starts, the monthly price, and Keep yearly billing', () => {
    expect(waitingMoveTitle(billing, date)).toBe(
      m.pricing_billing_notice_title_month({ date: '12 March' })
    );
    expect(waitingMoveBody(billing, 'Pro', date)).toBe(
      m.pricing_billing_notice_body_month({
        plan: 'Pro',
        price: formatPrice(1200),
      })
    );
    expect(waitingMoveKeepLabel(billing)).toBe(m.pricing_billing_keep());
  });

  it('names a later price on the monthly bill', () => {
    expect(
      waitingMoveBody(
        move('billing', {
          laterPrice: {
            amountCents: 1400,
            effectiveAt: '2027-05-12T00:00:00.000Z',
          },
        }),
        'Pro',
        date
      )
    ).toBe(
      m.pricing_billing_notice_body_later_month({
        plan: 'Pro',
        price: formatPrice(1200),
        laterPrice: formatPrice(1400),
        laterDate: '2027-05-12T00:00:00.000Z',
      })
    );
  });

  it("Keep's lines are about yearly billing (A2)", () => {
    expect(waitingMoveKeptLine(billing, 'Pro', '12 March', '£120.00')).toBe(
      m.pricing_move_kept_billing({ date: '12 March', price: '£120.00' })
    );
    expect(waitingMoveKeptLine(billing, 'Pro', null, null)).toBe(
      m.pricing_move_kept_billing_undated()
    );
    expect(waitingMoveKeepFailedLine(billing, 'Pro', date)).toBe(
      m.pricing_move_keep_failed_billing({ date: '12 March' })
    );
    expect(waitingMoveLandedLine(billing)).toBe(
      m.pricing_move_landed_billing()
    );
  });

  it('set to cancel, the switch to monthly billing survives a reactivate (E7)', () => {
    expect(waitingMoveSurvivesCancelLine(billing, date)).toBe(
      m.account_billing_change_survives_cancel({ date: '12 March' })
    );
  });
});

describe('the plan and the billing wait together (B, D, E2, E4)', () => {
  const both = move('plan_and_billing');

  it('says "billed monthly" and "billed yearly", and the one Keep current plan (Q4)', () => {
    expect(waitingMoveTitle(both, date)).toBe(
      m.pricing_move_notice_title_billing_month({
        plan: 'Basic',
        date: '12 March',
      })
    );
    expect(waitingMoveBody(both, 'Pro', date)).toBe(
      m.pricing_move_notice_body_billing_month({
        currentPlan: 'Pro',
        plan: 'Basic',
        price: formatPrice(500),
      })
    );
    expect(waitingMoveKeepLabel(both)).toBe(m.pricing_move_keep());
  });

  it("Keep's lines and the cancel note are the plan move's own (page 2, E7)", () => {
    expect(waitingMoveKeptLine(both, 'Pro', '12 March', '£120.00')).toBe(
      m.pricing_move_kept({ plan: 'Pro', date: '12 March', price: '£120.00' })
    );
    expect(waitingMoveKeepFailedLine(both, 'Pro', date)).toBe(
      m.pricing_move_keep_failed({
        plan: 'Pro',
        movingTo: 'Basic',
        date: '12 March',
      })
    );
    expect(waitingMoveLandedLine(both)).toBe(
      m.pricing_move_landed({ plan: 'Basic' })
    );
    expect(waitingMoveSurvivesCancelLine(both, date)).toBe(
      m.subscription_move_survives_cancel({ plan: 'Basic', date: '12 March' })
    );
  });
});

describe('a cheaper plan on the same billing keeps .16 words', () => {
  const plan = move('plan');

  it('the title, the yearly body and Keep current plan', () => {
    expect(waitingMoveTitle(plan, date)).toBe(
      m.pricing_move_notice_title({ plan: 'Basic', date: '12 March' })
    );
    expect(waitingMoveBody(plan, 'Pro', date)).toBe(
      m.pricing_move_notice_body_year({
        currentPlan: 'Pro',
        plan: 'Basic',
        price: formatPrice(500),
      })
    );
    expect(waitingMoveKeepLabel(plan)).toBe(m.pricing_move_keep());
    expect(waitingMoveKeptLine(null, 'Pro', null, null)).toBe(
      m.pricing_move_kept_undated({ plan: 'Pro' })
    );
  });
});
