/**
 * @codex/agreements — agreement-math unit tests
 *
 * Pure-function tests; no DB. Asserts:
 *   - sumActiveCreatorShares counts only active rows
 *   - validateProposedShare boundary semantics (inclusive at remaining-pool)
 *   - validateProposedShare basis-point bounds
 *
 * Per `feedback_service_error_test_instanceof` memory: assertions use
 * `toBeInstanceOf` + `err.name`, never `err.constructor.name`.
 */

import { describe, expect, it } from 'vitest';
import { ShareExceedsAvailableError } from '../../errors';
import {
  legacyOrgFeeFromCreatorShare,
  sumActiveCreatorShares,
  validateProposedShare,
} from '../agreement-math';

describe('agreement-math.sumActiveCreatorShares', () => {
  it('returns 0 for empty array', () => {
    expect(sumActiveCreatorShares([])).toBe(0);
  });

  it('sums a single active row', () => {
    expect(
      sumActiveCreatorShares([{ sharePercent: 3000, status: 'active' }])
    ).toBe(3000);
  });

  it('sums multiple active rows', () => {
    expect(
      sumActiveCreatorShares([
        { sharePercent: 3000, status: 'active' },
        { sharePercent: 2000, status: 'active' },
        { sharePercent: 1500, status: 'active' },
      ])
    ).toBe(6500);
  });

  it('ignores terminated rows', () => {
    expect(
      sumActiveCreatorShares([
        { sharePercent: 3000, status: 'active' },
        { sharePercent: 4000, status: 'terminated' },
      ])
    ).toBe(3000);
  });

  it('ignores expired rows', () => {
    expect(
      sumActiveCreatorShares([
        { sharePercent: 1000, status: 'active' },
        { sharePercent: 5000, status: 'expired' },
      ])
    ).toBe(1000);
  });

  it('ignores unknown statuses defensively', () => {
    expect(
      sumActiveCreatorShares([
        { sharePercent: 2000, status: 'pending' },
        { sharePercent: 3000, status: 'active' },
      ])
    ).toBe(3000);
  });
});

describe('agreement-math.validateProposedShare', () => {
  it('passes when proposed + existing + platform fee = 100% (inclusive boundary)', () => {
    // 10% platform + 60% existing + 30% proposed = 100%
    expect(() =>
      validateProposedShare({
        proposedSharePercent: 3000,
        existingActiveShares: [6000],
        platformFeePercent: 1000,
      })
    ).not.toThrow();
  });

  it('passes when proposed leaves room for the org residual', () => {
    expect(() =>
      validateProposedShare({
        proposedSharePercent: 2000,
        existingActiveShares: [3000, 1000],
        platformFeePercent: 1000,
      })
    ).not.toThrow();
  });

  it('passes with zero existing shares', () => {
    expect(() =>
      validateProposedShare({
        proposedSharePercent: 9000,
        existingActiveShares: [],
        platformFeePercent: 1000,
      })
    ).not.toThrow();
  });

  it('passes with zero platform fee', () => {
    expect(() =>
      validateProposedShare({
        proposedSharePercent: 5000,
        existingActiveShares: [3000, 2000],
        platformFeePercent: 0,
      })
    ).not.toThrow();
  });

  it('passes with high (30%) platform fee', () => {
    // 30% platform + 50% existing + 20% proposed = 100%
    expect(() =>
      validateProposedShare({
        proposedSharePercent: 2000,
        existingActiveShares: [5000],
        platformFeePercent: 3000,
      })
    ).not.toThrow();
  });

  it('throws ShareExceedsAvailableError when proposed + existing + platform fee > 100%', () => {
    // 10% platform + 60% existing + 31% proposed = 101%
    try {
      validateProposedShare({
        proposedSharePercent: 3100,
        existingActiveShares: [6000],
        platformFeePercent: 1000,
      });
      expect.fail('Expected ShareExceedsAvailableError');
    } catch (err) {
      expect(err).toBeInstanceOf(ShareExceedsAvailableError);
      expect((err as Error).name).toBe('ShareExceedsAvailableError');
    }
  });

  it('throws when proposed share exceeds 10000 basis points', () => {
    try {
      validateProposedShare({
        proposedSharePercent: 11000,
        existingActiveShares: [],
        platformFeePercent: 1000,
      });
      expect.fail('Expected ShareExceedsAvailableError');
    } catch (err) {
      expect(err).toBeInstanceOf(ShareExceedsAvailableError);
    }
  });

  it('throws when proposed share is negative', () => {
    try {
      validateProposedShare({
        proposedSharePercent: -1,
        existingActiveShares: [],
        platformFeePercent: 1000,
      });
      expect.fail('Expected ShareExceedsAvailableError');
    } catch (err) {
      expect(err).toBeInstanceOf(ShareExceedsAvailableError);
    }
  });

  it('throws when proposed share is non-integer', () => {
    try {
      validateProposedShare({
        proposedSharePercent: 1500.5,
        existingActiveShares: [],
        platformFeePercent: 1000,
      });
      expect.fail('Expected ShareExceedsAvailableError');
    } catch (err) {
      expect(err).toBeInstanceOf(ShareExceedsAvailableError);
    }
  });

  it('throws when platform fee is out of range', () => {
    try {
      validateProposedShare({
        proposedSharePercent: 1000,
        existingActiveShares: [],
        platformFeePercent: 12000,
      });
      expect.fail('Expected ShareExceedsAvailableError');
    } catch (err) {
      expect(err).toBeInstanceOf(ShareExceedsAvailableError);
    }
  });

  it('error context includes max allowed share', () => {
    try {
      validateProposedShare({
        proposedSharePercent: 5000,
        existingActiveShares: [4000],
        platformFeePercent: 2000,
      });
      expect.fail('Expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ShareExceedsAvailableError);
      const ctx = (err as ShareExceedsAvailableError).context as Record<
        string,
        unknown
      >;
      expect(ctx.maxAllowedSharePercent).toBe(4000); // 10000 - 2000 - 4000
      expect(ctx.existingActiveSharePercent).toBe(4000);
      expect(ctx.platformFeePercent).toBe(2000);
      expect(ctx.proposedSharePercent).toBe(5000);
    }
  });
});

describe('agreement-math.legacyOrgFeeFromCreatorShare', () => {
  it('returns 10000 - share', () => {
    expect(legacyOrgFeeFromCreatorShare(0)).toBe(10000);
    expect(legacyOrgFeeFromCreatorShare(3000)).toBe(7000);
    expect(legacyOrgFeeFromCreatorShare(10000)).toBe(0);
  });
});
