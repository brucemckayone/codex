/**
 * Denoise iter-007 F2 — proof test for
 * `performance:sequential-await-comparison-blocks` (sibling of F1).
 *
 * Finding: `getRevenueStats` (line 69 + 76), `getSubscriberStats` (lines
 * 184 + 191), and `getFollowerStats` (lines 313 + 320) compute the
 * `current` block, then sequentially compute the `previous` block when
 * `compareFrom` / `compareTo` are passed. The two blocks use disjoint date
 * ranges and do not depend on each other.
 *
 * When the studio dashboard requests trend deltas (default behaviour for the
 * analytics view, per the iter-018 redesign), every stats call doubles
 * latency: ~2x because previous waits for current. Compounded with F1's
 * intra-block serialisation, a single subscriber-stats call with comparison
 * issues 8 sequential queries (4 current + 4 previous) when 4 (or even 1
 * batch with `Promise.all`) would suffice.
 *
 * Rule: comparison blocks (current vs previous window) MUST run via
 * `Promise.all` — they are independent date-range queries and never share
 * data flow.
 *
 * Proof shape: synthetic load harness (Catalogue row 6) — wall-clock
 * timing comparison. Each block delays 50ms; sequential => ~100ms;
 * parallel => ~50ms. Assertion: with comparison, total time is closer to
 * single-block time than to 2x.
 *
 * Severity: major (studio analytics dashboard hot path with comparison
 * enabled by default).
 */

import { describe, expect, it } from 'vitest';

class FixedDelayTracker {
  callCount = 0;

  async run<T>(value: T, delayMs = 50): Promise<T> {
    this.callCount += 1;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return value;
  }
}

function makeMockDb(tracker: FixedDelayTracker) {
  const makeChain = (terminalValue: unknown) => {
    const chain: Record<string, unknown> = {};
    for (const m of [
      'select',
      'from',
      'where',
      'groupBy',
      'orderBy',
      'limit',
      'offset',
      'innerJoin',
      'leftJoin',
    ]) {
      chain[m] = () => chain;
    }
    // biome-ignore lint/suspicious/noThenProperty: deliberate thenable to mock Drizzle query builder
    chain.then = (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown
    ) => tracker.run(terminalValue, 50).then(onFulfilled, onRejected);
    return chain;
  };

  return {
    select: () => makeChain([{ count: 0 }]),
    execute: () => tracker.run({ rows: [{ count: '0' }] }, 50),
  };
}

describe('denoise proof: F2 performance:sequential-await-comparison-blocks — getRevenueStats', () => {
  it.skip('current + previous blocks run in parallel — total time < 1.5x single-block time', async () => {
    const tracker = new FixedDelayTracker();
    const db = makeMockDb(tracker) as unknown as never;
    const { AdminAnalyticsService } = await import(
      '../../services/analytics-service'
    );
    const svc = new AdminAnalyticsService({ db, environment: 'test' });

    const start = performance.now();
    await svc.getRevenueStats('org-1', {
      startDate: new Date('2026-04-01'),
      endDate: new Date('2026-04-15'),
      compareFrom: new Date('2026-03-15'),
      compareTo: new Date('2026-03-30'),
    });
    const elapsed = performance.now() - start;

    // Each block takes ~100ms minimum (2 inner queries × 50ms each).
    // Sequential current → previous would be ~200ms; parallel ~100ms.
    // Assertion: total elapsed < 150ms (1.5x of single block) proves they
    // overlapped. BEFORE FIX: ~200ms. AFTER FIX: ~100ms.
    //
    // NOTE: this test ALSO depends on F1's intra-block parallelism. To
    // isolate the comparison-level fix, the test stub uses 50ms delays
    // and a count assertion would also work — but wall-clock is the
    // cleanest signal of actual overlap.
    expect(elapsed).toBeLessThan(150);
    expect(tracker.callCount).toBeGreaterThanOrEqual(4);
  });
});
