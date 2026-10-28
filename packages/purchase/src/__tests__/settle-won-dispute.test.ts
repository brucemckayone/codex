/**
 * A won dispute's outcome is marked only once its re-pay has succeeded
 * (Codex-2hxff.58). `repayDispute` can reject after writing the re-pay rows:
 * it re-runs the charge's clawback when a refund settled, and that can fail.
 * The outcome must then stay unapplied, so the webhook's redelivery or the
 * hourly dispute reconcile runs it again.
 */

import { InternalServiceError } from '@codex/service-errors';
import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@codex/payments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/payments')>();
  return { ...actual, repayDispute: vi.fn() };
});

import { repayDispute } from '@codex/payments';
import { createTestMoneyDeps } from '@codex/test-utils';
import { PurchaseService } from '../services/purchase-service';

function serviceWith(db: Record<string, unknown>): PurchaseService {
  return new PurchaseService(
    { db: db as never, environment: 'test', ...createTestMoneyDeps() },
    {} as Stripe
  );
}

/** A db whose only write is the outcome mark. */
function markingDb() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where }));
  return { db: { update: vi.fn(() => ({ set })) }, set };
}

describe('PurchaseService.settleWonDispute', () => {
  it('a re-pay that rejects is rethrown, and the outcome is NOT marked applied', async () => {
    const failure = new InternalServiceError('clawback after re-pay failed');
    vi.mocked(repayDispute).mockRejectedValueOnce(failure);
    const { db } = markingDb();

    await expect(
      serviceWith(db).settleWonDispute('dp_repay_fails')
    ).rejects.toBe(failure);

    expect(db.update).not.toHaveBeenCalled();
  });

  it('a re-pay that succeeds marks the outcome applied', async () => {
    vi.mocked(repayDispute).mockResolvedValueOnce(undefined as never);
    const { db, set } = markingDb();

    await serviceWith(db).settleWonDispute('dp_repay_ok');

    expect(db.update).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith({ outcomeAppliedAt: expect.any(Date) });
  });
});
