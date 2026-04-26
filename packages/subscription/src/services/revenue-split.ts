/**
 * Revenue Split Calculator for Subscriptions
 *
 * Calculates the three-way split: Platform → Organization → Creator pool.
 *
 * Phase 1 defaults:
 * - Platform: 10% of gross (1000 basis points)
 * - Organization: 15% of post-platform amount (1500 basis points)
 * - Creator pool: remainder (85% of post-platform)
 *
 * All amounts in pence (GBP). Uses integer math only — no floating point.
 * Rounding: ceil for platform and org, remainder goes to creators.
 */

import { InternalServiceError } from '@codex/service-errors';
import type { RevenueSplit } from '@codex/shared-types';

// Re-export the canonical type for back-compat with existing
// `import { RevenueSplit } from '@codex/subscription'` consumers.
// The single source of truth is `@codex/shared-types`.
export type { RevenueSplit };

/**
 * Calculate revenue split from a subscription payment.
 *
 * @param amountCents - Total payment amount in pence
 * @param platformFeePercent - Platform fee in basis points (10000 = 100%)
 * @param orgFeePercent - Org fee in basis points, applied to post-platform amount
 * @returns Split amounts that sum to amountCents exactly
 */
export function calculateRevenueSplit(
  amountCents: number,
  platformFeePercent: number,
  orgFeePercent: number
): RevenueSplit {
  if (amountCents <= 0) {
    return {
      platformFeeCents: 0,
      organizationFeeCents: 0,
      creatorPayoutCents: 0,
    };
  }

  // Platform fee: ceil to ensure platform never underpaid
  const platformFeeCents = Math.ceil(
    (amountCents * platformFeePercent) / 10000
  );

  // Post-platform remainder
  const postPlatform = amountCents - platformFeeCents;

  // Org fee: ceil, applied to post-platform amount
  const organizationFeeCents = Math.ceil(
    (postPlatform * orgFeePercent) / 10000
  );

  // Creator pool: exact remainder (never loses a pence)
  const creatorPayoutCents = postPlatform - organizationFeeCents;

  // Sanity check
  const total = platformFeeCents + organizationFeeCents + creatorPayoutCents;
  if (total !== amountCents) {
    throw new InternalServiceError(
      `Revenue split mismatch: ${total} !== ${amountCents} ` +
        `(platform=${platformFeeCents}, org=${organizationFeeCents}, creator=${creatorPayoutCents})`
    );
  }

  return { platformFeeCents, organizationFeeCents, creatorPayoutCents };
}
