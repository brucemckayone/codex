/**
 * Denoise iter-007 F1 — proof test for
 * `performance:sequential-await-independent-queries` (new fingerprint).
 *
 * Finding: `AdminAnalyticsService.computeRevenueBlock` (line 118 + 142),
 * `computeSubscriberBlock` (lines 227, 247, 259, 271), and
 * `computeFollowerBlock` (lines 367, 378, 390) issue 2-4 sequential `await`
 * calls against `this.db` whose results are independent — none of the later
 * queries depend on the earlier query's value. The studio dashboard composes
 * these via top-level `Promise.all` (see `getDashboardStats` line 903), but
 * the inner sequential pattern multiplies inner-block latency by N regardless
 * of the outer parallelism.
 *
 * For the studio analytics dashboard hot path, computeSubscriberBlock issues
 * FOUR sequential queries (active + new + churned + daily) — at p95 Neon HTTP
 * latency of ~80-120ms each, the inner block alone is 320-480ms when it
 * could be ~100ms via Promise.all.
 *
 * Rule: when a service method issues N independent DB queries, they MUST
 * run in parallel (`Promise.all`) — not sequentially via successive `await`
 * statements.
 *
 * Proof shape: synthetic load harness (Catalogue row 6) — instrument the DB
 * client with a "queries in flight" counter; assert that during the call the
 * counter reaches >= 2 (i.e., at least two queries overlapped). Sequential
 * code can never overlap; parallel code always overlaps when each query
 * takes longer than zero ms.
 *
 * Severity: major (studio analytics dashboard; loaded on every studio
 * dashboard navigation; per-block sequential pattern repeats across
 * 3 helpers).
 */

import { describe, expect, it } from 'vitest';

/**
 * Minimal mock that mimics Drizzle's chainable query builder. Each terminal
 * call (the `await` resolution) takes a fixed delay and increments/decrements
 * an in-flight counter so the test can observe parallelism.
 */
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
  // Each terminal value is `[{ count: 0 }]` — matching the shape returned
  // by the analytics aggregate selects.
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
    select: () => makeThenableChain([{ count: 0 }]),
    execute: () => tracker.run({ rows: [{ count: '0' }] }, 10),
  };
}

describe('denoise proof: F1 performance:sequential-await-independent-queries — analytics block helpers', () => {
  it.skip('computeSubscriberBlock issues independent queries in parallel (peak in-flight >= 2)', async () => {
    // The fix should change `computeSubscriberBlock` so its 4 independent
    // selects run via Promise.all instead of 4 successive awaits. Then peak
    // in-flight will be >= 2 (typically 4).
    //
    // BEFORE FIX: peak === 1 (sequential awaits never overlap) — assertion
    //   `peak >= 2` fails.
    // AFTER FIX: peak === 4 (Promise.all puts all queries in flight at once).
    //
    // Test wires a real `AdminAnalyticsService` instance against the mocked
    // db. Removing `.skip()` runs the real method against the mock.

    const tracker = new InFlightTracker();
    const db = makeMockDb(tracker) as unknown as never;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AdminAnalyticsService } = await import(
      '../../services/analytics-service'
    );
    const svc = new AdminAnalyticsService({ db, environment: 'test' });

    // computeSubscriberBlock is private; exercise via the public surface.
    await svc.getSubscriberStats('org-1');

    expect(tracker.count).toBeGreaterThanOrEqual(4);
    expect(tracker.peak).toBeGreaterThanOrEqual(2);
  });

  it.skip('computeRevenueBlock issues aggregate + daily queries in parallel (peak >= 2)', async () => {
    const tracker = new InFlightTracker();
    const db = makeMockDb(tracker) as unknown as never;
    const { AdminAnalyticsService } = await import(
      '../../services/analytics-service'
    );
    const svc = new AdminAnalyticsService({ db, environment: 'test' });

    await svc.getRevenueStats('org-1');

    expect(tracker.count).toBeGreaterThanOrEqual(2);
    expect(tracker.peak).toBeGreaterThanOrEqual(2);
  });

  it.skip('computeFollowerBlock issues total + new + daily in parallel (peak >= 2)', async () => {
    const tracker = new InFlightTracker();
    const db = makeMockDb(tracker) as unknown as never;
    const { AdminAnalyticsService } = await import(
      '../../services/analytics-service'
    );
    const svc = new AdminAnalyticsService({ db, environment: 'test' });

    await svc.getFollowerStats('org-1');

    expect(tracker.count).toBeGreaterThanOrEqual(3);
    expect(tracker.peak).toBeGreaterThanOrEqual(2);
  });
});
