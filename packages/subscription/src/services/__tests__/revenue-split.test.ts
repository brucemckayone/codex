/**
 * Revenue Split Calculator Tests
 *
 * Pure unit tests for the 3-way revenue split (platform → org → creators).
 * Uses integer math only to prevent floating-point precision issues.
 *
 * Default Phase 1 constants:
 * - Platform: 10% of gross (1000 basis points)
 * - Organization: 15% of post-platform amount (1500 basis points)
 * - Creator pool: remainder (85% of post-platform)
 */

import { FEES } from '@codex/constants';
import { describe, expect, it } from 'vitest';
import { calculateRevenueSplit } from '../revenue-split';

// Default fee percentages from @codex/constants
const PLATFORM = FEES.PLATFORM_PERCENT; // 1000 bps = 10%
const ORG = FEES.SUBSCRIPTION_ORG_PERCENT; // 1500 bps = 15%

describe('calculateRevenueSplit', () => {
  // ─── Standard splits with default constants ──────────────────────────

  describe('standard splits (PLATFORM=1000bps, ORG=1500bps)', () => {
    it('should calculate correct split for 1000p (£10.00)', () => {
      const result = calculateRevenueSplit(1000, PLATFORM, ORG);
      // platform = ceil(1000 * 1000 / 10000) = ceil(100) = 100
      // postPlatform = 900
      // org = ceil(900 * 1500 / 10000) = ceil(135) = 135
      // creator = 900 - 135 = 765
      expect(result.platformFeeCents).toBe(100);
      expect(result.organizationFeeCents).toBe(135);
      expect(result.creatorPayoutCents).toBe(765);
      expect(
        result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents
      ).toBe(1000);
    });

    it('should calculate correct split for 999p (odd number, tests ceil rounding)', () => {
      const result = calculateRevenueSplit(999, PLATFORM, ORG);
      // platform = ceil(999 * 0.1) = ceil(99.9) = 100
      // postPlatform = 899
      // org = ceil(899 * 0.15) = ceil(134.85) = 135
      // creator = 899 - 135 = 764
      expect(result.platformFeeCents).toBe(100);
      expect(result.organizationFeeCents).toBe(135);
      expect(result.creatorPayoutCents).toBe(764);
      expect(
        result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents
      ).toBe(999);
    });

    it('should calculate correct split for 1p (minimum positive amount)', () => {
      const result = calculateRevenueSplit(1, PLATFORM, ORG);
      // platform = ceil(1 * 0.1) = ceil(0.1) = 1
      // postPlatform = 0
      // org = ceil(0 * 0.15) = 0
      // creator = 0
      expect(result.platformFeeCents).toBe(1);
      expect(result.organizationFeeCents).toBe(0);
      expect(result.creatorPayoutCents).toBe(0);
      expect(
        result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents
      ).toBe(1);
    });

    it('should calculate correct split for 100000p (£1000.00, large amount)', () => {
      const result = calculateRevenueSplit(100000, PLATFORM, ORG);
      expect(result.platformFeeCents).toBe(10000);
      expect(result.organizationFeeCents).toBe(13500);
      expect(result.creatorPayoutCents).toBe(76500);
      expect(
        result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents
      ).toBe(100000);
    });

    it('should calculate correct split for 2p (edge: both ceil effects active)', () => {
      const result = calculateRevenueSplit(2, PLATFORM, ORG);
      // platform = ceil(2 * 0.1) = ceil(0.2) = 1
      // postPlatform = 1
      // org = ceil(1 * 0.15) = ceil(0.15) = 1
      // creator = 1 - 1 = 0
      expect(result.platformFeeCents).toBe(1);
      expect(result.organizationFeeCents).toBe(1);
      expect(result.creatorPayoutCents).toBe(0);
      expect(
        result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents
      ).toBe(2);
    });

    it('should always sum to input amount for random values (property test)', () => {
      // Test 50 random amounts between 1 and 999999
      for (let i = 0; i < 50; i++) {
        const amount = Math.floor(Math.random() * 999999) + 1;
        const result = calculateRevenueSplit(amount, PLATFORM, ORG);
        const total =
          result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents;
        expect(total).toBe(amount);
        expect(result.platformFeeCents).toBeGreaterThanOrEqual(0);
        expect(result.organizationFeeCents).toBeGreaterThanOrEqual(0);
        expect(result.creatorPayoutCents).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ─── Zero and negative amounts ───────────────────────────────────────

  describe('zero and negative amounts', () => {
    it('should return all zeros for amount = 0', () => {
      const result = calculateRevenueSplit(0, PLATFORM, ORG);
      expect(result.platformFeeCents).toBe(0);
      expect(result.organizationFeeCents).toBe(0);
      expect(result.creatorPayoutCents).toBe(0);
    });

    it('should return all zeros for negative amount', () => {
      const result = calculateRevenueSplit(-500, PLATFORM, ORG);
      expect(result.platformFeeCents).toBe(0);
      expect(result.organizationFeeCents).toBe(0);
      expect(result.creatorPayoutCents).toBe(0);
    });
  });

  // ─── Custom fee percentages ──────────────────────────────────────────

  describe('custom fee percentages', () => {
    it('should handle 0% platform fee (all goes to org + creator)', () => {
      const result = calculateRevenueSplit(1000, 0, 1500);
      expect(result.platformFeeCents).toBe(0);
      expect(result.organizationFeeCents).toBe(150);
      expect(result.creatorPayoutCents).toBe(850);
      expect(
        result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents
      ).toBe(1000);
    });

    it('should handle 0% org fee (split between platform and creator)', () => {
      const result = calculateRevenueSplit(1000, 1000, 0);
      expect(result.platformFeeCents).toBe(100);
      expect(result.organizationFeeCents).toBe(0);
      expect(result.creatorPayoutCents).toBe(900);
      expect(
        result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents
      ).toBe(1000);
    });

    it('should handle 0% for both fees (all to creator)', () => {
      const result = calculateRevenueSplit(1000, 0, 0);
      expect(result.platformFeeCents).toBe(0);
      expect(result.organizationFeeCents).toBe(0);
      expect(result.creatorPayoutCents).toBe(1000);
    });

    it('should handle 100% platform fee (nothing to org or creator)', () => {
      const result = calculateRevenueSplit(1000, 10000, 0);
      expect(result.platformFeeCents).toBe(1000);
      expect(result.organizationFeeCents).toBe(0);
      expect(result.creatorPayoutCents).toBe(0);
    });

    it('should handle 50% platform fee (5000bps)', () => {
      const result = calculateRevenueSplit(1000, 5000, 1500);
      // platform = ceil(1000 * 5000 / 10000) = 500
      // postPlatform = 500
      // org = ceil(500 * 1500 / 10000) = ceil(75) = 75
      // creator = 500 - 75 = 425
      expect(result.platformFeeCents).toBe(500);
      expect(result.organizationFeeCents).toBe(75);
      expect(result.creatorPayoutCents).toBe(425);
      expect(
        result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents
      ).toBe(1000);
    });
  });

  // ─── Rounding behavior ──────────────────────────────────────────────

  describe('rounding behavior (ceil for platform and org, remainder to creator)', () => {
    it('should ceil platform fee and give remainder to creator', () => {
      // 101p: platform = ceil(101 * 0.1) = ceil(10.1) = 11
      const result = calculateRevenueSplit(101, PLATFORM, ORG);
      expect(result.platformFeeCents).toBe(11);
      // postPlatform = 90, org = ceil(90 * 0.15) = ceil(13.5) = 14
      expect(result.organizationFeeCents).toBe(14);
      expect(result.creatorPayoutCents).toBe(76);
      expect(
        result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents
      ).toBe(101);
    });

    it('should ceil org fee and give remainder to creator', () => {
      // 103p: platform = ceil(10.3) = 11, post = 92, org = ceil(92*0.15) = ceil(13.8) = 14
      const result = calculateRevenueSplit(103, PLATFORM, ORG);
      expect(result.platformFeeCents).toBe(11);
      expect(result.organizationFeeCents).toBe(14);
      expect(result.creatorPayoutCents).toBe(78);
      expect(
        result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents
      ).toBe(103);
    });

    it('should never produce negative creator payout', () => {
      // Very small amounts: 3p
      const result = calculateRevenueSplit(3, PLATFORM, ORG);
      expect(result.creatorPayoutCents).toBeGreaterThanOrEqual(0);
      expect(
        result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents
      ).toBe(3);
    });
  });

  // ─── Basis point precision ───────────────────────────────────────────

  describe('basis point precision', () => {
    it('should treat 10000 basis points as 100%', () => {
      const result = calculateRevenueSplit(1000, 10000, 1500);
      expect(result.platformFeeCents).toBe(1000);
      // postPlatform = 0, so org and creator are both 0
      expect(result.organizationFeeCents).toBe(0);
      expect(result.creatorPayoutCents).toBe(0);
    });

    it('should handle exact GBP subscription price (£4.99 = 499p)', () => {
      const result = calculateRevenueSplit(499, PLATFORM, ORG);
      // platform = ceil(499 * 0.1) = ceil(49.9) = 50
      // postPlatform = 449
      // org = ceil(449 * 0.15) = ceil(67.35) = 68
      // creator = 449 - 68 = 381
      expect(result.platformFeeCents).toBe(50);
      expect(result.organizationFeeCents).toBe(68);
      expect(result.creatorPayoutCents).toBe(381);
      expect(
        result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents
      ).toBe(499);
    });
  });
});
