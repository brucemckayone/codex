/**
 * Financial types shared across @codex/purchase and @codex/subscription.
 *
 * These shapes are part of the public revenue contract and any divergence
 * silently breaks ecom-api consumers that import from both packages, so
 * the canonical declaration lives here.
 */

/**
 * Three-way revenue split: Platform → Organization → Creator.
 *
 * All amounts are integer pence (GBP). The three fields MUST sum to the
 * gross amount paid — calculators enforce this invariant.
 *
 * Used by:
 * - `@codex/purchase` `calculateRevenueSplit` (one-time purchases)
 * - `@codex/subscription` `calculateRevenueSplit` (recurring subscriptions)
 */
export interface RevenueSplit {
  /** Platform fee in pence (rounded up — platform never underpaid) */
  platformFeeCents: number;
  /** Organization fee in pence (rounded up, applied post-platform) */
  organizationFeeCents: number;
  /** Creator payout in pence (exact remainder — preserves total equality) */
  creatorPayoutCents: number;
}
