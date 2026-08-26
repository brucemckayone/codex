/**
 * Unit tests for the insights reporting-window math (Codex-2pryk · Round-D ·
 * WP-7). Pure functions — no DB, no I/O. The falsifiable core of the feature:
 * period → [start, end) + previous window, and the sparkline bucketing.
 */

import { describe, expect, it } from 'vitest';
import {
  bucketRevenueTrend,
  resolveInsightsWindow,
  resolveTrendWindow,
  type TrendSample,
} from '../insights-window';

const NOW = new Date('2026-07-24T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

describe('resolveInsightsWindow', () => {
  it('30d: current window is the trailing 30 days ending at now', () => {
    const w = resolveInsightsWindow('30d', NOW);
    expect(w.end.getTime()).toBe(NOW.getTime());
    expect(w.start.getTime()).toBe(NOW.getTime() - 30 * DAY);
  });

  it('30d: previous window is the equal-length span immediately before', () => {
    const w = resolveInsightsWindow('30d', NOW);
    expect(w.previousEnd?.getTime()).toBe(w.start.getTime());
    expect(w.previousStart?.getTime()).toBe(NOW.getTime() - 60 * DAY);
  });

  it('7d and 90d use their own trailing spans', () => {
    expect(resolveInsightsWindow('7d', NOW).start.getTime()).toBe(
      NOW.getTime() - 7 * DAY
    );
    expect(resolveInsightsWindow('90d', NOW).start.getTime()).toBe(
      NOW.getTime() - 90 * DAY
    );
  });

  it("'all': spans from the epoch with NO comparable previous window", () => {
    const w = resolveInsightsWindow('all', NOW);
    expect(w.start.getTime()).toBe(0);
    expect(w.end.getTime()).toBe(NOW.getTime());
    expect(w.previousStart).toBeNull();
    expect(w.previousEnd).toBeNull();
  });

  it('does not mutate the passed-in now', () => {
    const now = new Date(NOW.getTime());
    resolveInsightsWindow('30d', now);
    expect(now.getTime()).toBe(NOW.getTime());
  });
});

describe('bucketRevenueTrend', () => {
  const window = { start: new Date(NOW.getTime() - 30 * DAY), end: NOW };

  it('sums pence into the correct bucket and ignores out-of-range samples', () => {
    const samples: TrendSample[] = [
      // First day → bucket 0.
      { at: new Date(window.start.getTime() + 1 * DAY), amountCents: 1000 },
      { at: new Date(window.start.getTime() + 2 * DAY), amountCents: 500 },
      // Last day → final bucket.
      { at: new Date(NOW.getTime() - 1 * DAY), amountCents: 2000 },
      // Before the window → ignored.
      { at: new Date(window.start.getTime() - 5 * DAY), amountCents: 9999 },
    ];
    const trend = bucketRevenueTrend(samples, window, '30d');

    // 30d → 10 buckets, each ISO-dated at its start edge.
    expect(trend).toHaveLength(10);
    expect(trend[0]?.value).toBe(1500);
    expect(trend[9]?.value).toBe(2000);
    // The out-of-range sample never lands anywhere.
    const total = trend.reduce((sum, p) => sum + p.value, 0);
    expect(total).toBe(3500);
  });

  it('returns all-zero buckets when there are no samples', () => {
    const trend = bucketRevenueTrend([], window, '7d');
    expect(trend).toHaveLength(7);
    expect(trend.every((p) => p.value === 0)).toBe(true);
  });

  it('clamps a sample on the end edge into the last bucket (never overflows)', () => {
    const trend = bucketRevenueTrend(
      // exactly `end` is exclusive, so use one ms before end.
      [{ at: new Date(NOW.getTime() - 1), amountCents: 42 }],
      window,
      '90d'
    );
    expect(trend).toHaveLength(12);
    expect(trend[11]?.value).toBe(42);
  });
});

describe('resolveTrendWindow', () => {
  it('finite periods reuse the metric window', () => {
    const w = resolveInsightsWindow('30d', NOW);
    const t = resolveTrendWindow('30d', w, []);
    expect(t.start.getTime()).toBe(w.start.getTime());
    expect(t.end.getTime()).toBe(w.end.getTime());
  });

  it("'all' clamps the trend start to the earliest sample", () => {
    const w = resolveInsightsWindow('all', NOW);
    const earliest = new Date(NOW.getTime() - 200 * DAY);
    const samples: TrendSample[] = [
      { at: new Date(NOW.getTime() - 10 * DAY), amountCents: 1 },
      { at: earliest, amountCents: 2 },
    ];
    const t = resolveTrendWindow('all', w, samples);
    expect(t.start.getTime()).toBe(earliest.getTime());
    expect(t.end.getTime()).toBe(NOW.getTime());
  });

  it("'all' with no samples falls back to a 30-day trailing span (not the epoch)", () => {
    const w = resolveInsightsWindow('all', NOW);
    const t = resolveTrendWindow('all', w, []);
    expect(t.start.getTime()).toBe(NOW.getTime() - 30 * DAY);
    expect(t.end.getTime()).toBe(NOW.getTime());
  });
});
