/**
 * Insights reporting-window math (Codex-2pryk · Round-D · Codex-776gg · WP-7).
 *
 * Pure, dependency-free date arithmetic for the studio journey-insights surface.
 * Given a period token and a reference `now`, resolves the current reporting
 * window `[start, end)` plus the immediately-preceding equal-length window
 * `[previousStart, previousEnd)` that drives every metric's period-over-period
 * delta.
 *
 * `'all'` has NO comparable prior window: `previousStart` / `previousEnd` are
 * `null`, and every metric then reports `previousValue: null` (the KPICard
 * suppresses the delta row) — so we never fabricate a comparison against empty
 * pre-history.
 *
 * Extracted from {@link CourseInsightsService} so the fiddly boundary
 * arithmetic is unit-testable in isolation (bd memory
 * implement/tests-must-be-able-to-fail): the risk in this feature is the window
 * math and the bucketing, not the SQL.
 */

/** Supported reporting windows — mirrors the frozen FE `InsightsPeriod`. */
export type InsightsPeriod = '7d' | '30d' | '90d' | 'all';

/** A single point on the revenue sparkline (pence per bucket). */
export interface TrendPoint {
  date: string;
  value: number;
}

/** A dated money contribution (GBP pence) fed into the trend bucketer. */
export interface TrendSample {
  at: Date;
  amountCents: number;
}

/** The resolved current + previous comparison windows for a period. */
export interface InsightsWindow {
  /** Inclusive lower bound of the current reporting window. */
  start: Date;
  /** Exclusive upper bound of the current window (the reference `now`). */
  end: Date;
  /** Inclusive lower bound of the previous window, or `null` for `'all'`. */
  previousStart: Date | null;
  /** Exclusive upper bound of the previous window, or `null` for `'all'`. */
  previousEnd: Date | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Trailing-day span per finite period. `'all'` is handled separately. */
const PERIOD_DAYS: Record<Exclude<InsightsPeriod, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/** Sparkline bucket count per period (finer windows get fewer buckets). */
const PERIOD_BUCKETS: Record<InsightsPeriod, number> = {
  '7d': 7,
  '30d': 10,
  '90d': 12,
  all: 12,
};

/** Fallback trend span when an `'all'` window has no data to anchor to. */
const EMPTY_ALL_TREND_DAYS = 30;

/**
 * Resolve the current + previous comparison windows for a reporting period.
 * The current window is a trailing span ending at `now`; the previous window is
 * the equal-length span immediately before it. `'all'` spans from the Unix
 * epoch with no previous window.
 */
export function resolveInsightsWindow(
  period: InsightsPeriod,
  now: Date
): InsightsWindow {
  const end = new Date(now.getTime());

  if (period === 'all') {
    return {
      start: new Date(0),
      end,
      previousStart: null,
      previousEnd: null,
    };
  }

  const spanMs = PERIOD_DAYS[period] * MS_PER_DAY;
  const start = new Date(end.getTime() - spanMs);
  const previousEnd = start;
  const previousStart = new Date(start.getTime() - spanMs);
  return { start, end, previousStart, previousEnd };
}

/**
 * Bucket revenue samples into a fixed number of equal-width time buckets across
 * `[trendStart, trendEnd)`, summing pence per bucket. Samples outside the range
 * are ignored; the final edge is clamped into the last bucket. Each point's
 * `date` is the ISO instant of its bucket's start edge. Deterministic and pure
 * — this is exactly the series the KPICard sparkline renders.
 */
export function bucketRevenueTrend(
  samples: readonly TrendSample[],
  trend: { start: Date; end: Date },
  period: InsightsPeriod
): TrendPoint[] {
  const buckets = PERIOD_BUCKETS[period];
  const startMs = trend.start.getTime();
  const endMs = trend.end.getTime();
  // Guard a zero/negative span (defensive — a real window is always positive).
  const width = Math.max(endMs - startMs, 1) / buckets;

  const totals = new Array<number>(buckets).fill(0);
  for (const { at, amountCents } of samples) {
    const t = at.getTime();
    if (t < startMs || t >= endMs) continue;
    const idx = Math.min(Math.floor((t - startMs) / width), buckets - 1);
    totals[idx] = (totals[idx] ?? 0) + amountCents;
  }

  return totals.map((value, i) => ({
    date: new Date(startMs + i * width).toISOString(),
    value,
  }));
}

/**
 * The window the sparkline spans. Finite periods reuse their metric window; an
 * `'all'` window is clamped to the earliest sample (so the 1970→now epoch span
 * never dominates the chart with empty pre-history), falling back to a short
 * trailing span when there is no data at all.
 */
export function resolveTrendWindow(
  period: InsightsPeriod,
  window: InsightsWindow,
  samples: readonly TrendSample[]
): { start: Date; end: Date } {
  if (period !== 'all') {
    return { start: window.start, end: window.end };
  }
  if (samples.length === 0) {
    return {
      start: new Date(window.end.getTime() - EMPTY_ALL_TREND_DAYS * MS_PER_DAY),
      end: window.end,
    };
  }
  // Earliest sample time; seeded with `end` so indexed access into `samples`
  // (which noUncheckedIndexedAccess would widen to `undefined`) is avoided.
  let earliest = window.end.getTime();
  for (const s of samples) {
    const t = s.at.getTime();
    if (t < earliest) earliest = t;
  }
  return { start: new Date(earliest), end: window.end };
}
