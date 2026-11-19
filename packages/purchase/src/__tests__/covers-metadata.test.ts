/**
 * The set a refund of everything owed records in its Stripe metadata
 * (`coversMetadata`, review r9): one value, `codex_covers`, within Stripe's
 * 500-character limit, or nothing and an error with the ids.
 */

import { describe, expect, it, vi } from 'vitest';
import { coversMetadata } from '../services/covered-refunds';

function logger() {
  return { info: vi.fn(), error: vi.fn() };
}

describe('coversMetadata', () => {
  it('records nothing for an empty set, and logs nothing', () => {
    const obs = logger();
    expect(coversMetadata([], obs, { chargeId: 'ch_1' })).toEqual({});
    expect(obs.error).not.toHaveBeenCalled();
  });

  it('records the set comma-joined in one value', () => {
    const obs = logger();
    expect(
      coversMetadata(['re_1Qa', 're_1Qb'], obs, { chargeId: 'ch_1' })
    ).toEqual({ codex_covers: 're_1Qa,re_1Qb' });
    expect(obs.error).not.toHaveBeenCalled();
  });

  it('records a set of exactly 500 characters', () => {
    const obs = logger();
    // 19 ids of 24 characters and one of 25, with 19 commas: 500.
    const ids = [
      ...Array.from(
        { length: 19 },
        (_, i) => `re_${String(i).padStart(21, '0')}`
      ),
      `re_${'9'.repeat(22)}`,
    ];
    expect(ids.join(',')).toHaveLength(500);
    expect(coversMetadata(ids, obs, {})).toEqual({
      codex_covers: ids.join(','),
    });
    expect(obs.error).not.toHaveBeenCalled();
  });

  it('records nothing for a set past the limit, and alerts at error with the errorId, the context and every id', () => {
    const obs = logger();
    const ids = Array.from(
      { length: 18 },
      (_, i) => `re_3QdP7aLk2vRb${String(i).padStart(12, '0')}`
    );
    expect(ids.join(',').length).toBeGreaterThan(500);

    expect(
      coversMetadata(ids, obs, { purchaseId: 'p_1', chargeId: 'ch_1' })
    ).toEqual({});
    expect(obs.error).toHaveBeenCalledWith(
      'A refund of everything owed includes more failed refunds than its Stripe metadata can name, so only this request can cover them: if it fails after Stripe makes the refund, they are covered later by the newest refund that counts instead',
      {
        errorId: expect.any(String),
        purchaseId: 'p_1',
        chargeId: 'ch_1',
        coveredRefundIds: ids,
      }
    );
  });
});
