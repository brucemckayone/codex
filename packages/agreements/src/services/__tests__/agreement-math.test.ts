/**
 * @codex/agreements — agreement-math unit tests
 *
 * Pure-function tests; no DB. Asserts:
 *   - sumActiveCreatorShares counts only active rows
 *   - validateProposedShare boundary semantics (inclusive at remaining-pool)
 *   - validateProposedShare basis-point bounds
 *   - dual-write inverse round-trip (creatorShareFromLegacyOrgFee ↔
 *     legacyOrgFeeFromCreatorShare)
 *
 * Per `feedback_service_error_test_instanceof` memory: assertions use
 * `toBeInstanceOf` + `err.name`, never `err.constructor.name`.
 */

import { describe, expect, it } from 'vitest';
import { ShareExceedsAvailableError } from '../../errors';
import {
  creatorShareFromLegacyOrgFee,
  formatRevenueTypeLabel,
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
  it('passes at the inclusive boundary — 70% existing + 30% proposed = 100% of post-platform pool', () => {
    expect(() =>
      validateProposedShare({
        proposedSharePercent: 3000,
        existingActiveShares: [7000],
      })
    ).not.toThrow();
  });

  it('passes when proposed leaves room for the org residual', () => {
    expect(() =>
      validateProposedShare({
        proposedSharePercent: 2000,
        existingActiveShares: [3000, 1000],
      })
    ).not.toThrow();
  });

  it('passes with zero existing shares (proposal can take the whole pool)', () => {
    expect(() =>
      validateProposedShare({
        proposedSharePercent: 10000,
        existingActiveShares: [],
      })
    ).not.toThrow();
  });

  it('passes with multiple existing siblings summing to most of the pool', () => {
    expect(() =>
      validateProposedShare({
        proposedSharePercent: 1000,
        existingActiveShares: [3000, 3000, 3000],
      })
    ).not.toThrow();
  });

  it('throws when proposed + existing > 100% of the post-platform pool', () => {
    try {
      validateProposedShare({
        proposedSharePercent: 4001,
        existingActiveShares: [6000],
      });
      expect.fail('Expected ShareExceedsAvailableError');
    } catch (err) {
      expect(err).toBeInstanceOf(ShareExceedsAvailableError);
      expect((err as Error).name).toBe('ShareExceedsAvailableError');
    }
  });

  it('throws when a single existing share already fills the pool and proposal is non-zero', () => {
    try {
      validateProposedShare({
        proposedSharePercent: 1,
        existingActiveShares: [10000],
      });
      expect.fail('Expected ShareExceedsAvailableError');
    } catch (err) {
      expect(err).toBeInstanceOf(ShareExceedsAvailableError);
    }
  });

  it('throws when proposed share exceeds 10000 basis points', () => {
    try {
      validateProposedShare({
        proposedSharePercent: 11000,
        existingActiveShares: [],
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
      });
      expect.fail('Expected ShareExceedsAvailableError');
    } catch (err) {
      expect(err).toBeInstanceOf(ShareExceedsAvailableError);
    }
  });

  it('throws when an existing share is out of basis-point range', () => {
    try {
      validateProposedShare({
        proposedSharePercent: 1000,
        existingActiveShares: [-100],
      });
      expect.fail('Expected ShareExceedsAvailableError');
    } catch (err) {
      expect(err).toBeInstanceOf(ShareExceedsAvailableError);
    }
  });

  it('is independent of platform fee — same shares, no platform-fee param, same result (regression guard for C1)', () => {
    // Pre-C1 the validator subtracted platform fee from the pool, which
    // double-counted (platform fee is already outside the post-platform
    // pool). After C1 the signature has no `platformFeePercent` field
    // and the function reasons purely about the post-platform pool.
    expect(() =>
      validateProposedShare({
        proposedSharePercent: 5000,
        existingActiveShares: [5000],
      })
    ).not.toThrow();
    expect(() =>
      validateProposedShare({
        proposedSharePercent: 5001,
        existingActiveShares: [5000],
      })
    ).toThrow(ShareExceedsAvailableError);
  });

  it('error context includes max allowed share', () => {
    try {
      validateProposedShare({
        proposedSharePercent: 5000,
        existingActiveShares: [6000],
      });
      expect.fail('Expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ShareExceedsAvailableError);
      const ctx = (err as ShareExceedsAvailableError).context as Record<
        string,
        unknown
      >;
      expect(ctx.maxAllowedSharePercent).toBe(4000); // 10000 - 6000
      expect(ctx.existingActiveSharePercent).toBe(6000);
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

describe('agreement-math.creatorShareFromLegacyOrgFee', () => {
  it('returns 10000 - orgFee (inverse direction)', () => {
    expect(creatorShareFromLegacyOrgFee(0)).toBe(10000);
    expect(creatorShareFromLegacyOrgFee(7000)).toBe(3000);
    expect(creatorShareFromLegacyOrgFee(10000)).toBe(0);
  });

  it('round-trips through legacyOrgFeeFromCreatorShare', () => {
    for (const share of [0, 100, 2500, 5000, 7500, 10000]) {
      expect(
        creatorShareFromLegacyOrgFee(legacyOrgFeeFromCreatorShare(share))
      ).toBe(share);
    }
  });
});

describe('agreement-math.formatRevenueTypeLabel', () => {
  it('returns "subscription" for the subscription revenue type', () => {
    expect(formatRevenueTypeLabel('subscription')).toBe('subscription');
  });

  it('returns the hyphenated "content-purchase" for content_purchase', () => {
    // Hyphen, not space — matches the revenue_type enum value the schema
    // stores, the email template subject lines, and the studio/creator UI
    // copy. Catches any future drift where this collapses to the value
    // with a space.
    expect(formatRevenueTypeLabel('content_purchase')).toBe('content-purchase');
  });
});
