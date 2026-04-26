/**
 * Denoise iter-026 F1 — proof test for
 * `performance:sequential-await-independent-queries` recurrence (R12).
 *
 * Finding: `AdminAnalyticsService.getCustomerStats` (lines 462 + 482) issues
 * two sequential `await` statements where neither result feeds the other:
 *
 *   const totalResult = await this.db.select(...).from(purchases).where(...);
 *   ...
 *   const newCustomersResult = await this.db.execute(sql`WITH first_purchases ...`);
 *
 * Both queries:
 *   - Filter on the same `(organization_id, status='completed')` predicate
 *   - Touch the same `purchases` table
 *   - Are independent — `totalResult` is NOT used to build the second query;
 *     `newCustomersResult` is NOT used to build the first
 *
 * R12 hard rule (denoise SKILL.md §1, promoted iter-008):
 *   "Service methods MUST launch independent DB/API awaits via `Promise.all`.
 *   Sequential `await` is permitted only when a later query consumes a prior
 *   query's value (guard-then-fetch, transaction step ordering, foreign-key
 *   resolution)."
 *
 * Recurrence context: `performance:sequential-await-independent-queries`
 * fingerprint was promoted to R12 from the iter-007 endemic 5-hit cluster.
 * iter-026 is the FIRST drift-detection sighting since R12 landed and since
 * the Round 3 Tier 4.D parallelisation pass (commit 7715eaf3) closed
 * Codex-y63gl.1, .4, .5. The Tier 4.D pass parallelised:
 *   - computeRevenueBlock / computeSubscriberBlock / computeFollowerBlock
 *     (the iter-007 F1 inner-block awaits)
 *   - getRevenueStats / getSubscriberStats / getFollowerStats current+previous
 *     (the iter-007 F2 comparison-block awaits)
 *   - hasContentAccess FOLLOWERS/SUBSCRIBERS/PAID(with-tier) deny-path
 *     (the iter-007 F3 access-decision branches)
 *
 * `getCustomerStats` was NOT touched in Tier 4.D — it remains the same shape
 * it had pre-iter-007 but was missed by that audit (focused on the dashboard
 * trend KPIs). Latency: at Neon HTTP p95 (~80-120ms per round-trip), this
 * sequential pair adds ~80-120ms over the parallel equivalent. The studio
 * customers card surfaces the result on every dashboard navigation.
 *
 * Severity: minor (single +1 round-trip; mitigated by per-creator KV cache
 * but cold-cache is the studio's first paint).
 *
 * Proof shape: synthetic load harness (Catalogue row 6) — instrument the DB
 * client with a "queries in flight" counter. Assert peak >= 2 after the fix.
 * Sequential code can never overlap; parallel code overlaps when each query
 * takes longer than zero ms. Mirrors iter-007 F1's pattern.
 *
 * Fix shape:
 *
 * ```typescript
 * const [totalResult, newCustomersResult] = await Promise.all([
 *   this.db.select({...}).from(purchases).where(...),
 *   this.db.execute(sql`WITH first_purchases AS (...) SELECT COUNT(*) ...`),
 * ]);
 * ```
 *
 * Both queries are read-only aggregates with no FK resolution between them.
 *
 * MCP evidence: cell-canonical Vitest `bench()` (per SKILL.md §3 matrix).
 * The harness below uses a fixed-delay mock; the bead body should attach a
 * before/after delta from `pnpm --filter @codex/admin test:bench` once the
 * fix lands.
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

function makeMockDb(tracker: InFlightTracker) {
  // Returns a thenable chain that, when awaited, increments the counter.
  // The terminal `[{ totalCustomers: 0 }]` matches `countDistinct` shape;
  // `execute` returns `{ rows: [{ count: '0' }] }` matching the CTE subquery.
  const makeThenableChain = (terminalValue: unknown) => {
    const chain: Record<string, unknown> = {};
    const methods = [
      'select',
      'from',
      'where',
      'groupBy',
      'orderBy',
      'limit',
      'offset',
      'innerJoin',
      'leftJoin',
    ];
    for (const m of methods) {
      chain[m] = () => chain;
    }
    // biome-ignore lint/suspicious/noThenProperty: deliberate thenable to mock Drizzle query builder
    chain.then = (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown
    ) => tracker.run(terminalValue, 10).then(onFulfilled, onRejected);
    return chain;
  };

  return {
    select: () => makeThenableChain([{ totalCustomers: 0 }]),
    execute: () => tracker.run({ rows: [{ count: '0' }] }, 10),
  };
}

describe('denoise proof: F1 performance:sequential-await-independent-queries — getCustomerStats', () => {
  it.skip('issues totalCustomers + newCustomers queries in parallel (peak in-flight >= 2)', async () => {
    // The fix should wrap the two existing awaits in a single Promise.all
    // so totalResult + newCustomersResult fire concurrently. Then peak
    // in-flight will be >= 2.
    //
    // BEFORE FIX: peak === 1 (sequential awaits never overlap) — assertion
    //   `peak >= 2` fails.
    // AFTER FIX: peak === 2 (Promise.all puts both queries in flight at once).
    //
    // Test wires a real `AdminAnalyticsService` against the mocked db.
    // Removing `.skip()` runs the real method.
    const tracker = new InFlightTracker();
    const db = makeMockDb(tracker) as unknown as never;
    const { AdminAnalyticsService } = await import(
      '../../services/analytics-service'
    );
    const svc = new AdminAnalyticsService({ db, environment: 'test' });

    await svc.getCustomerStats('org-1');

    expect(tracker.count).toBeGreaterThanOrEqual(2);
    expect(tracker.peak).toBeGreaterThanOrEqual(2);
  });
});
