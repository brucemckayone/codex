/**
 * Denoise iter-007 F5 — proof test for
 * `performance:sequential-await-independent-queries` (recurrence #3 of F1).
 *
 * Finding: `AdminCustomerManagementService.getCustomerDetails`
 * (`packages/admin/src/services/customer-management-service.ts:218`) issues
 * three sequential queries:
 *
 *   - line 222: user lookup (early-return on null)
 *   - line 231: stats aggregate (totalPurchases + totalSpentCents)
 *   - line 259: purchase history (paginated rows with content title join)
 *
 * The user lookup is an early-return guard (must stay sequential to skip
 * the rest on null). But stats + history are independent of each other —
 * both filter by `(customerId, organizationId, status=COMPLETED)`. They
 * could run via `Promise.all` after the user check.
 *
 * Note: stats throws NotFoundError when totalPurchases===0, which today
 * happens BEFORE the history query. After the fix, both queries run; if
 * stats yields 0 we throw and discard the history result — slightly more
 * work in the no-purchases case, but the success case (the common case
 * for a customer detail view) saves a full round-trip.
 *
 * Rule: same as F1 — N independent DB queries MUST run via `Promise.all`.
 *
 * Proof shape: synthetic load harness (Catalogue row 6) — peak in-flight
 * counter for the post-user-lookup phase.
 *
 * Severity: minor (admin customer detail page; low traffic).
 */

import { describe, expect, it } from 'vitest';

class InFlightTracker {
  inFlight = 0;
  peak = 0;
  count = 0;

  async run<T>(value: T, delayMs = 10): Promise<T> {
    this.inFlight += 1;
    this.peak = Math.max(this.peak, this.inFlight);
    this.count += 1;
    try {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return value;
    } finally {
      this.inFlight -= 1;
    }
  }
}

describe('denoise proof: F5 performance:sequential-await-independent-queries — getCustomerDetails', () => {
  it.skip('stats + history queries overlap after user lookup (peak in-flight >= 2)', async () => {
    // After the fix: stats + history launch via Promise.all once the user
    // is confirmed to exist. Before the fix, peak stays at 1 throughout.
    const tracker = new InFlightTracker();
    // Wire AdminCustomerManagementService against a Drizzle-shaped mock;
    // assert tracker.peak >= 2 once Promise.all wraps the post-user-check
    // queries.
    expect(tracker.peak).toBeGreaterThanOrEqual(2);
  });
});
