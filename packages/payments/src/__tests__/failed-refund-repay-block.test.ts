/**
 * failedRefundRepayBlock (money HIGH-1, owner decision 2026-10-25): a failed
 * refund is re-paid (`creators_repaid`) only when no later cause was shared
 * against it. The re-pay drops it from the running total, but a cause shared
 * while it counted keeps the share it got then.
 */

import { describe, expect, it } from 'vitest';
import {
  type ClawbackDispute,
  type ClawbackRefund,
  failedRefundRepayBlock,
} from '../clawback';

const CHARGE = 1000;
const refund = (id: string, amountCents: number): ClawbackRefund => ({
  id,
  amountCents,
  createdAt: 0,
});
const lost: ClawbackDispute = {
  id: 'dp_lost',
  amountCents: CHARGE,
  createdAt: 0,
  lost: true,
};

function block(
  refunds: ClawbackRefund[],
  chargebacks: ClawbackDispute[] = [],
  stripeRefundId = 're_failed'
) {
  return failedRefundRepayBlock({
    chargeAmountCents: CHARGE,
    refunds,
    chargebacks,
    stripeRefundId,
  });
}

describe('failedRefundRepayBlock', () => {
  it('nothing after the failed refund: it can be re-paid', () => {
    expect(block([refund('re_failed', CHARGE)])).toBeNull();
  });

  it('a chargeback, open or lost: blocked, whatever the amounts', () => {
    expect(block([refund('re_failed', 300)], [lost])).toBe('chargeback');
    expect(block([refund('re_failed', 300)], [{ ...lost, lost: false }])).toBe(
      'chargeback'
    );
  });

  it('a later refund taking the running total over the charge: blocked (its share was capped)', () => {
    // Scenario B: R1 = 1000 failed, R2 = 1000.
    expect(
      block([refund('re_failed', CHARGE), refund('re_later', CHARGE)])
    ).toBe('later_refunds');
    // The partial variant: 600 then 600.
    expect(block([refund('re_failed', 600), refund('re_later', 600)])).toBe(
      'later_refunds'
    );
  });

  it('a later refund that fills the charge exactly: not capped, so not blocked', () => {
    expect(
      block([refund('re_failed', 600), refund('re_later', 400)])
    ).toBeNull();
  });

  it('refunds BEFORE the failed one that fill the charge: nothing later was shared against it', () => {
    expect(
      block([refund('re_earlier', 600), refund('re_failed', 600)])
    ).toBeNull();
  });

  it('a refund the engine no longer counts (already re-paid) blocks nothing', () => {
    expect(block([refund('re_later', CHARGE)], [lost])).toBeNull();
  });
});
