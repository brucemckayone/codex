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

    it('should calculate correct split for 1p (minimum positive amount, capped by amountCents)', () => {
      const result = calculateRevenueSplit(1, PLATFORM, ORG);
      // percent = ceil(1 * 0.1) = 1, floor = MIN_PLATFORM_FEE_CENTS = 30
      // platform = min(1, max(1, 30)) = 1 (cap prevents > amountCents)
      // postPlatform = 0, org = 0, creator = 0
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

    it('should calculate correct split for 2p (floor capped at amountCents, eats whole gross)', () => {
      const result = calculateRevenueSplit(2, PLATFORM, ORG);
      // percent = ceil(2 * 0.1) = 1, floor = 30
      // platform = min(2, max(1, 30)) = 2 (floor wants 30, capped at amountCents)
      // postPlatform = 0, org = 0, creator = 0
      expect(result.platformFeeCents).toBe(2);
      expect(result.organizationFeeCents).toBe(0);
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
    it('should handle 0% platform fee (floor still applies — Codex-a6hop)', () => {
      const result = calculateRevenueSplit(1000, 0, 1500);
      // percent = 0, floor = MIN_PLATFORM_FEE_CENTS = 30
      // platform = min(1000, max(0, 30)) = 30
      // postPlatform = 970, org = ceil(970*0.15) = 146, creator = 824
      expect(result.platformFeeCents).toBe(30);
      expect(result.organizationFeeCents).toBe(146);
      expect(result.creatorPayoutCents).toBe(824);
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

    it('should handle 0% for both fees (floor still applies — Codex-a6hop)', () => {
      const result = calculateRevenueSplit(1000, 0, 0);
      // percent = 0, floor = 30 → platform = 30, creator = 970
      expect(result.platformFeeCents).toBe(30);
      expect(result.organizationFeeCents).toBe(0);
      expect(result.creatorPayoutCents).toBe(970);
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
    it('should apply platform-fee floor when percent < MIN (101p)', () => {
      // 101p: percent = ceil(10.1) = 11, floor = 30 → platform = 30
      // postPlatform = 71, org = ceil(71 * 0.15) = ceil(10.65) = 11
      // creator = 71 - 11 = 60
      const result = calculateRevenueSplit(101, PLATFORM, ORG);
      expect(result.platformFeeCents).toBe(30);
      expect(result.organizationFeeCents).toBe(11);
      expect(result.creatorPayoutCents).toBe(60);
      expect(
        result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents
      ).toBe(101);
    });

    it('should apply platform-fee floor when percent < MIN (103p)', () => {
      // 103p: percent = ceil(10.3) = 11, floor = 30 → platform = 30
      // postPlatform = 73, org = ceil(73 * 0.15) = ceil(10.95) = 11, creator = 62
      const result = calculateRevenueSplit(103, PLATFORM, ORG);
      expect(result.platformFeeCents).toBe(30);
      expect(result.organizationFeeCents).toBe(11);
      expect(result.creatorPayoutCents).toBe(62);
      expect(
        result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents
      ).toBe(103);
    });

    it('should never produce negative creator payout', () => {
      // Very small amounts: 3p — floor capped at amountCents → platform=3, rest=0
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
      // platform = ceil(499 * 0.1) = ceil(49.9) = 50 (> floor 30, percent wins)
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

  // ─── Minimum platform-fee floor (Codex-a6hop) ────────────────────────
  describe('minimum platform-fee floor (FEES.MIN_PLATFORM_FEE_CENTS)', () => {
    const FLOOR = FEES.MIN_PLATFORM_FEE_CENTS;

    it('floor kicks in when percent fee is below MIN_PLATFORM_FEE_CENTS', () => {
      // 200p at 10%: percent = 20, floor = 30 → platform = 30
      const result = calculateRevenueSplit(200, PLATFORM, ORG);
      expect(result.platformFeeCents).toBe(FLOOR);
      // postPlatform = 170, org = ceil(170*0.15) = ceil(25.5) = 26, creator = 144
      expect(result.organizationFeeCents).toBe(26);
      expect(result.creatorPayoutCents).toBe(144);
      expect(
        result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents
      ).toBe(200);
    });

    it('percent wins when percent fee is above MIN_PLATFORM_FEE_CENTS', () => {
      // 400p at 10%: percent = 40, floor = 30 → platform = 40
      const result = calculateRevenueSplit(400, PLATFORM, ORG);
      expect(result.platformFeeCents).toBe(40);
      // postPlatform = 360, org = ceil(360*0.15) = 54, creator = 306
      expect(result.organizationFeeCents).toBe(54);
      expect(result.creatorPayoutCents).toBe(306);
      expect(
        result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents
      ).toBe(400);
    });

    it('percent equals floor exactly at break-even (300p)', () => {
      // 300p at 10%: percent = 30, floor = 30 → platform = 30
      const result = calculateRevenueSplit(300, PLATFORM, ORG);
      expect(result.platformFeeCents).toBe(FLOOR);
      // postPlatform = 270, org = ceil(270*0.15) = ceil(40.5) = 41, creator = 229
      expect(result.organizationFeeCents).toBe(41);
      expect(result.creatorPayoutCents).toBe(229);
      expect(
        result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents
      ).toBe(300);
    });

    it('floor is capped at amountCents for micro-transactions (10p)', () => {
      // 10p at 10%: percent = 1, floor = 30, cap = 10 → platform = 10
      // postPlatform = 0, org = 0, creator = 0
      const result = calculateRevenueSplit(10, PLATFORM, ORG);
      expect(result.platformFeeCents).toBe(10);
      expect(result.organizationFeeCents).toBe(0);
      expect(result.creatorPayoutCents).toBe(0);
      expect(
        result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents
      ).toBe(10);
    });

    it('amount below MIN_TRANSFER_CENTS still splits correctly (transfer floor is separate concern)', () => {
      // 99p (just below £1 transfer floor) still gets a normal split.
      // Transfer-floor logic lives in the sweep cron, not the calculator.
      const result = calculateRevenueSplit(99, PLATFORM, ORG);
      // percent = ceil(9.9) = 10, floor = 30 → platform = 30
      // postPlatform = 69, org = ceil(69*0.15) = ceil(10.35) = 11, creator = 58
      expect(result.platformFeeCents).toBe(30);
      expect(result.organizationFeeCents).toBe(11);
      expect(result.creatorPayoutCents).toBe(58);
      expect(
        result.platformFeeCents +
          result.organizationFeeCents +
          result.creatorPayoutCents
      ).toBe(99);
    });
  });
});
