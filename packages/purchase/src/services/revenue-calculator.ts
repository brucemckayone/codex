/**
 * Revenue Split Calculator
 *
 * Calculates revenue distribution between platform, organization, and creator.
 *
 * Key Rules:
 * - Platform fee: Calculated from total amount (e.g., 10% of $100 = $10)
 * - Organization fee: Calculated from remaining after platform fee (e.g., 0% of $90 = $0)
 * - Creator payout: Remainder after both fees (e.g., $100 - $10 - $0 = $90)
 * - Round platform/org fees UP (Math.ceil) - platform/org get full cents
 * - Creator gets exact remainder - ensures total equality
 *
 * Business Logic:
 * - Percentages stored as basis points (10000 = 100%, 1000 = 10%)
 * - All amounts in integer cents (no decimal math)
 * - CHECK constraint enforces: amountPaidCents = platformFeeCents + orgFeeCents + creatorPayoutCents
 *
 * @module revenue-calculator
 */

import { RevenueCalculationError } from '../errors';

/**
 * Revenue split result
 */
export interface RevenueSplit {
  /** Platform fee in cents (rounded up) */
  platformFeeCents: number;
  /** Organization fee in cents (rounded up) */
  organizationFeeCents: number;
  /** Creator payout in cents (exact remainder) */
  creatorPayoutCents: number;
}

/**
 * Calculate revenue split with proper rounding
 *
 * Algorithm:
 * 1. Calculate platform fee: ceil(amount * platformFeePercentage / 10000)
 * 2. Calculate remaining after platform: amount - platformFeeCents
 * 3. Calculate org fee: ceil(remaining * orgFeePercentage / 10000)
 * 4. Calculate creator payout: amount - platformFeeCents - orgFeeCents
 * 5. Verify sum equals total (sanity check)
 *
 * @param amountCents - Total purchase amount in cents (>= 0)
 * @param platformFeePercentage - Platform fee in basis points (0-10000)
 * @param orgFeePercentage - Organization fee in basis points (0-10000)
 * @returns Revenue split with all fees in cents
 * @throws {RevenueCalculationError} If inputs invalid or calculation fails
 *
 * @example
 * // $29.99 purchase with 10% platform fee, 0% org fee
 * const split = calculateRevenueSplit(2999, 1000, 0);
 * // Result: { platformFeeCents: 300, organizationFeeCents: 0, creatorPayoutCents: 2699 }
 * // Verification: 300 + 0 + 2699 = 2999 ✓
 *
 * @example
 * // $100.00 purchase with 10% platform fee, 20% org fee
 * const split = calculateRevenueSplit(10000, 1000, 2000);
 * // Platform: ceil(10000 * 1000 / 10000) = ceil(1000) = 1000 ($10.00)
 * // Remaining: 10000 - 1000 = 9000
 * // Org: ceil(9000 * 2000 / 10000) = ceil(1800) = 1800 ($18.00)
 * // Creator: 10000 - 1000 - 1800 = 7200 ($72.00)
 * // Result: { platformFeeCents: 1000, organizationFeeCents: 1800, creatorPayoutCents: 7200 }
 */
export function calculateRevenueSplit(
  amountCents: number,
  platformFeePercentage: number,
  orgFeePercentage: number
): RevenueSplit {
  // Validate inputs
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new RevenueCalculationError('Amount must be a non-negative integer', {
      amountCents,
      type: 'invalid_amount',
    });
  }

  if (
    !Number.isInteger(platformFeePercentage) ||
    platformFeePercentage < 0 ||
    platformFeePercentage > 10000
  ) {
    throw new RevenueCalculationError(
      'Platform fee percentage must be between 0 and 10000 basis points',
      {
        platformFeePercentage,
        type: 'invalid_platform_fee',
      }
    );
  }

  if (
    !Number.isInteger(orgFeePercentage) ||
    orgFeePercentage < 0 ||
    orgFeePercentage > 10000
  ) {
    throw new RevenueCalculationError(
      'Organization fee percentage must be between 0 and 10000 basis points',
      {
        orgFeePercentage,
        type: 'invalid_org_fee',
      }
    );
  }

  // Step 1: Calculate platform fee (round up)
  // Example: $29.99 * 10% = $2.999 -> $3.00 (300 cents)
  const platformFeeCents = Math.ceil(
    (amountCents * platformFeePercentage) / 10000
  );

  // Step 2: Calculate remaining after platform fee
  const remainingAfterPlatform = amountCents - platformFeeCents;

  // Step 3: Calculate organization fee from remaining (round up)
  // Example: $26.99 * 0% = $0.00 (0 cents)
  const organizationFeeCents = Math.ceil(
    (remainingAfterPlatform * orgFeePercentage) / 10000
  );

  // Step 4: Creator gets exact remainder
  const creatorPayoutCents =
    amountCents - platformFeeCents - organizationFeeCents;

  // Step 5: Sanity check - verify sum equals total
  const calculatedTotal =
    platformFeeCents + organizationFeeCents + creatorPayoutCents;
  if (calculatedTotal !== amountCents) {
    throw new RevenueCalculationError(
      'Revenue split sum does not equal total amount',
      {
        amountCents,
        platformFeeCents,
        organizationFeeCents,
        creatorPayoutCents,
        calculatedTotal,
        difference: calculatedTotal - amountCents,
        type: 'calculation_mismatch',
      }
    );
  }

  // Verify no negative values
  if (
    platformFeeCents < 0 ||
    organizationFeeCents < 0 ||
    creatorPayoutCents < 0
  ) {
    throw new RevenueCalculationError('Calculated fee cannot be negative', {
      platformFeeCents,
      organizationFeeCents,
      creatorPayoutCents,
      type: 'negative_fee',
    });
  }

  return {
    platformFeeCents,
    organizationFeeCents,
    creatorPayoutCents,
  };
}

/**
 * Default revenue split configuration
 * Phase 1 defaults: 10% platform, 0% org, 90% creator
 */
export const DEFAULT_PLATFORM_FEE_PERCENTAGE = 1000; // 10%
export const DEFAULT_ORG_FEE_PERCENTAGE = 0; // 0%
