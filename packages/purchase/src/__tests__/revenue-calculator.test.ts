/**
 * Revenue Calculator Tests
 *
 * Tests for revenue split calculation logic
 */

import { describe, expect, it } from 'vitest';
import { RevenueCalculationError } from '../errors';
import {
  calculateRevenueSplit,
  DEFAULT_ORG_FEE_PERCENTAGE,
  DEFAULT_PLATFORM_FEE_PERCENTAGE,
} from '../services/revenue-calculator';

describe('Revenue Calculator', () => {
  describe('calculateRevenueSplit', () => {
    describe('default split (10% platform / 0% org / 90% creator)', () => {
      it('calculates correctly for $29.99 (2999 cents)', () => {
        const split = calculateRevenueSplit(
          2999,
          DEFAULT_PLATFORM_FEE_PERCENTAGE,
          DEFAULT_ORG_FEE_PERCENTAGE
        );

        // Platform: ceil(2999 * 1000 / 10000) = ceil(299.9) = 300
        expect(split.platformFeeCents).toBe(300);
        expect(split.organizationFeeCents).toBe(0);
        expect(split.creatorPayoutCents).toBe(2699);

        // Verify sum equals total
        const total =
          split.platformFeeCents +
          split.organizationFeeCents +
          split.creatorPayoutCents;
        expect(total).toBe(2999);
      });

      it('calculates correctly for $100.00 (10000 cents)', () => {
        const split = calculateRevenueSplit(
          10000,
          DEFAULT_PLATFORM_FEE_PERCENTAGE,
          DEFAULT_ORG_FEE_PERCENTAGE
        );

        // Platform: ceil(10000 * 1000 / 10000) = 1000
        expect(split.platformFeeCents).toBe(1000);
        expect(split.organizationFeeCents).toBe(0);
        expect(split.creatorPayoutCents).toBe(9000);

        // Verify sum equals total
        expect(
          split.platformFeeCents +
            split.organizationFeeCents +
            split.creatorPayoutCents
        ).toBe(10000);
      });

      it('calculates correctly for $9.99 (999 cents)', () => {
        const split = calculateRevenueSplit(
          999,
          DEFAULT_PLATFORM_FEE_PERCENTAGE,
          DEFAULT_ORG_FEE_PERCENTAGE
        );

        // Platform: ceil(999 * 1000 / 10000) = ceil(99.9) = 100
        expect(split.platformFeeCents).toBe(100);
        expect(split.organizationFeeCents).toBe(0);
        expect(split.creatorPayoutCents).toBe(899);

        expect(
          split.platformFeeCents +
            split.organizationFeeCents +
            split.creatorPayoutCents
        ).toBe(999);
      });
    });

    describe('rounding behavior', () => {
      it('rounds platform fee UP (ceil)', () => {
        // $1.01 (101 cents) with 10% = 10.1 cents -> 11 cents
        const split = calculateRevenueSplit(101, 1000, 0);

        expect(split.platformFeeCents).toBe(11);
        expect(split.creatorPayoutCents).toBe(90);
        expect(
          split.platformFeeCents +
            split.organizationFeeCents +
            split.creatorPayoutCents
        ).toBe(101);
      });

      it('rounds organization fee UP (ceil)', () => {
        // $100 with 10% platform, 20% org
        // Platform: 1000 cents
        // Remaining: 9000 cents
        // Org: ceil(9000 * 2000 / 10000) = ceil(1800) = 1800
        const split = calculateRevenueSplit(10000, 1000, 2000);

        expect(split.platformFeeCents).toBe(1000);
        expect(split.organizationFeeCents).toBe(1800);
        expect(split.creatorPayoutCents).toBe(7200);
        expect(
          split.platformFeeCents +
            split.organizationFeeCents +
            split.creatorPayoutCents
        ).toBe(10000);
      });

      it('creator gets exact remainder (no rounding)', () => {
        // Test that creator always gets what's left after fees
        const split = calculateRevenueSplit(1000, 1000, 500); // 10% platform, 5% org

        const expectedPlatformFee = Math.ceil((1000 * 1000) / 10000); // 100
        const remaining = 1000 - expectedPlatformFee; // 900
        const expectedOrgFee = Math.ceil((remaining * 500) / 10000); // ceil(45) = 45
        const expectedCreatorPayout =
          1000 - expectedPlatformFee - expectedOrgFee; // 855

        expect(split.platformFeeCents).toBe(expectedPlatformFee);
        expect(split.organizationFeeCents).toBe(expectedOrgFee);
        expect(split.creatorPayoutCents).toBe(expectedCreatorPayout);
      });
    });

    describe('edge cases', () => {
      it('handles 0 amount', () => {
        const split = calculateRevenueSplit(0, 1000, 0);

        expect(split.platformFeeCents).toBe(0);
        expect(split.organizationFeeCents).toBe(0);
        expect(split.creatorPayoutCents).toBe(0);
      });

      it('handles 100% platform fee (10000 basis points)', () => {
        const split = calculateRevenueSplit(1000, 10000, 0);

        expect(split.platformFeeCents).toBe(1000);
        expect(split.organizationFeeCents).toBe(0);
        expect(split.creatorPayoutCents).toBe(0);
      });

      it('handles 0% platform fee', () => {
        const split = calculateRevenueSplit(1000, 0, 0);

        expect(split.platformFeeCents).toBe(0);
        expect(split.organizationFeeCents).toBe(0);
        expect(split.creatorPayoutCents).toBe(1000);
      });

      it('handles combined fees totaling 100%', () => {
        // 50% platform + 50% of remaining (which is 25% of total)
        const split = calculateRevenueSplit(1000, 5000, 5000);

        // Platform: ceil(1000 * 5000 / 10000) = 500
        // Remaining: 500
        // Org: ceil(500 * 5000 / 10000) = 250
        // Creator: 1000 - 500 - 250 = 250
        expect(split.platformFeeCents).toBe(500);
        expect(split.organizationFeeCents).toBe(250);
        expect(split.creatorPayoutCents).toBe(250);
      });

      it('handles very small amount (1 cent)', () => {
        const split = calculateRevenueSplit(1, 1000, 0);

        // Platform: ceil(1 * 1000 / 10000) = ceil(0.1) = 1
        // Creator: 1 - 1 = 0
        expect(split.platformFeeCents).toBe(1);
        expect(split.organizationFeeCents).toBe(0);
        expect(split.creatorPayoutCents).toBe(0);
      });

      it('handles large amount ($999,999.99)', () => {
        const amount = 99999999; // cents
        const split = calculateRevenueSplit(amount, 1000, 0);

        expect(split.platformFeeCents).toBe(10000000); // $100,000
        expect(split.organizationFeeCents).toBe(0);
        expect(split.creatorPayoutCents).toBe(89999999); // $899,999.99
        expect(
          split.platformFeeCents +
            split.organizationFeeCents +
            split.creatorPayoutCents
        ).toBe(amount);
      });
    });

    describe('validation errors', () => {
      it('throws RevenueCalculationError for negative amount', () => {
        expect(() => calculateRevenueSplit(-100, 1000, 0)).toThrow(
          RevenueCalculationError
        );
      });

      it('throws RevenueCalculationError for non-integer amount', () => {
        expect(() => calculateRevenueSplit(10.5, 1000, 0)).toThrow(
          RevenueCalculationError
        );
      });

      it('throws RevenueCalculationError for negative platform fee', () => {
        expect(() => calculateRevenueSplit(1000, -100, 0)).toThrow(
          RevenueCalculationError
        );
      });

      it('throws RevenueCalculationError for platform fee > 100%', () => {
        expect(() => calculateRevenueSplit(1000, 10001, 0)).toThrow(
          RevenueCalculationError
        );
      });

      it('throws RevenueCalculationError for negative org fee', () => {
        expect(() => calculateRevenueSplit(1000, 1000, -100)).toThrow(
          RevenueCalculationError
        );
      });

      it('throws RevenueCalculationError for org fee > 100%', () => {
        expect(() => calculateRevenueSplit(1000, 1000, 10001)).toThrow(
          RevenueCalculationError
        );
      });

      it('throws RevenueCalculationError for non-integer platform fee', () => {
        expect(() => calculateRevenueSplit(1000, 10.5, 0)).toThrow(
          RevenueCalculationError
        );
      });

      it('throws RevenueCalculationError for non-integer org fee', () => {
        expect(() => calculateRevenueSplit(1000, 1000, 10.5)).toThrow(
          RevenueCalculationError
        );
      });

      it('includes error context in RevenueCalculationError', () => {
        try {
          calculateRevenueSplit(-100, 1000, 0);
        } catch (e) {
          expect(e).toBeInstanceOf(RevenueCalculationError);
          expect((e as RevenueCalculationError).context).toMatchObject({
            amountCents: -100,
            type: 'invalid_amount',
          });
        }
      });
    });

    describe('sum verification', () => {
      it('always returns values that sum to total', () => {
        // Test multiple random-ish values
        const testCases = [
          { amount: 100, platform: 1000, org: 0 },
          { amount: 999, platform: 1000, org: 500 },
          { amount: 12345, platform: 1500, org: 200 },
          { amount: 50000, platform: 800, org: 1200 },
          { amount: 1, platform: 5000, org: 2000 },
        ];

        for (const tc of testCases) {
          const split = calculateRevenueSplit(tc.amount, tc.platform, tc.org);
          const sum =
            split.platformFeeCents +
            split.organizationFeeCents +
            split.creatorPayoutCents;

          expect(sum).toBe(tc.amount);
        }
      });

      it('never produces negative creator payout', () => {
        // Even with max fees, creator should be >= 0
        const split = calculateRevenueSplit(100, 10000, 10000);

        expect(split.platformFeeCents).toBeGreaterThanOrEqual(0);
        expect(split.organizationFeeCents).toBeGreaterThanOrEqual(0);
        expect(split.creatorPayoutCents).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('default constants', () => {
    it('DEFAULT_PLATFORM_FEE_PERCENTAGE is 10% (1000 basis points)', () => {
      expect(DEFAULT_PLATFORM_FEE_PERCENTAGE).toBe(1000);
    });

    it('DEFAULT_ORG_FEE_PERCENTAGE is 0% (0 basis points)', () => {
      expect(DEFAULT_ORG_FEE_PERCENTAGE).toBe(0);
    });
  });
});
