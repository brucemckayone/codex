/**
 * Denoise iter-007 F7 — proof test for
 * `performance:subrequest-cap-sequential-stripe-calls`.
 *
 * Finding: `TierService.updateTier`
 * (`packages/subscription/src/services/tier-service.ts:340`) issues 2-5
 * sequential Stripe API calls when both monthly and annual prices change:
 *
 *   line 371: stripe.prices.create(monthly)
 *   line 386: stripe.prices.update(oldMonthly archive)
 *   line 394: stripe.prices.create(annual)
 *   line 408: stripe.prices.update(oldAnnual archive)
 *   line 421: stripe.products.update(name/description)
 *
 * Each call is a Cloudflare subrequest (~200-500ms wall clock, no Stripe
 * batching). The monthly and annual blocks are independent — both could
 * launch in parallel via Promise.all. The product update is also
 * independent of price changes.
 *
 * Sequential worst-case: 5 × 300ms = 1.5s tier update. Parallel worst-case:
 * ~600ms (longest of the parallelised pairs). For a creator editing tier
 * pricing in the studio, this is felt latency.
 *
 * Worker subrequest cap is 50/request (paid tier 1000) — not at risk for a
 * single tier update, but the sequential pattern is still wasteful.
 *
 * Rule: independent Stripe API calls in the same handler MUST run via
 * `Promise.all` when the success/failure of one does not gate the other.
 *
 * Proof shape: synthetic load harness (Catalogue row 6) — instrument a
 * mock Stripe client; assert that the monthly price ops and annual price
 * ops overlap (peak in-flight >= 2) after the fix.
 *
 * Severity: minor (low-frequency operation; bounded subrequest count).
 */

import { describe, expect, it } from 'vitest';

class MockStripeTracker {
  calls: string[] = [];
  inFlight = 0;
  peak = 0;

  async run<T>(label: string, value: T, delayMs = 30): Promise<T> {
    this.calls.push(label);
    this.inFlight += 1;
    this.peak = Math.max(this.peak, this.inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return value;
    } finally {
      this.inFlight -= 1;
    }
  }
}

describe('denoise proof: F7 performance:subrequest-cap-sequential-stripe-calls — TierService.update', () => {
  it.skip('monthly + annual price changes overlap (peak in-flight >= 2)', async () => {
    // After the fix: monthly create+archive runs in parallel with annual
    // create+archive (and the product update can join the same Promise.all).
    // Before the fix: peak === 1 throughout.
    const tracker = new MockStripeTracker();
    // Build a Stripe stub whose `prices.create` / `prices.update` /
    // `products.update` all delegate to tracker.run; wire TierService
    // and call updateTier({ priceMonthly: X, priceAnnual: Y, name: N }).
    expect(tracker.peak).toBeGreaterThanOrEqual(2);
  });
});
