/**
 * Journey insights — data seam (WP-7, Codex-2pryk.3.4).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠️  ROUND-D SEAM — THE SINGLE UNWIRED MODULE.                              │
 * │                                                                            │
 * │ `getJourneyInsights` returns CONTRACT-SHAPED MOCK data today. Every        │
 * │ number is fabricated deterministically from (courseId, organizationId,     │
 * │ period) so the surface renders stably — NONE of it reads the database.     │
 * │                                                                            │
 * │ Round-D replaces ONLY the body of `getJourneyInsights` (the call site and  │
 * │ the `JourneyInsightsData` contract are frozen). Wire it to the real        │
 * │ aggregations, then delete `mockJourneyInsights` and this banner:           │
 * │                                                                            │
 * │   live  (financial)  → scope purchase/subscription/payout to the course's  │
 * │                        creator+org (reuse @codex/purchase + @codex/        │
 * │                        subscription; the money is GBP pence). Mirror        │
 * │                        `sales.remote.ts`: `const { platform, cookies } =`  │
 * │                        `getRequestEvent(); createServerApi(...)`; the       │
 * │                        worker enforces `requireOrgManagement` + re-derives  │
 * │                        scope from the session.                             │
 * │   course (engagement) → aggregate `course_enrollments` (enrolled / active   │
 * │                        via recent `lastActivityAt` / completed via          │
 * │                        `completedAt`) + `practice_completions` rollup for   │
 * │                        the course.                                         │
 * │                                                                            │
 * │ `track` (views/referrer) is NOT part of the contract and MUST NOT be       │
 * │ added here — it is instrumented nowhere (SPEC §14.4). See `UNTRACKED_TIER`. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Snapshot query semantics (like `sales.remote.ts`): every period change
 * re-fires the query; no TanStack DB live collection.
 */

import { z } from 'zod';
import { query } from '$app/server';
import type {
  CourseEngagement,
  InsightsPeriod,
  JourneyInsightsData,
  LiveFinancials,
  TrendPoint,
} from '$lib/components/studio/journey-insights/metric-model';

const insightsQueryArgsSchema = z.object({
  organizationId: z.string().uuid(),
  courseId: z.string().uuid(),
  period: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
});

/**
 * Studio journey insights for one course in one period.
 *
 * @example
 * const insights = getJourneyInsights({
 *   organizationId: data.org.id,
 *   courseId: page.params.id,
 *   period: '30d',
 * });
 * // insights.current → JourneyInsightsData
 */
export const getJourneyInsights = query(
  insightsQueryArgsSchema,
  async ({
    organizationId,
    courseId,
    period,
  }): Promise<JourneyInsightsData> => {
    // ROUND-D: replace this line with the real aggregations (see banner above).
    return mockJourneyInsights({ organizationId, courseId, period });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// MOCK — everything below is deleted at Round-D.
// ─────────────────────────────────────────────────────────────────────────────

/** Deterministic 32-bit hash so mock numbers are stable per (course, org). */
function seedFrom(...parts: string[]): number {
  let h = 2166136261;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      h ^= part.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

/** Mulberry32 PRNG — deterministic, seedable. */
function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Volume multiplier per window — larger windows accumulate more activity. */
const PERIOD_SCALE: Record<InsightsPeriod, number> = {
  '7d': 0.25,
  '30d': 1,
  '90d': 2.6,
  all: 5.2,
};

/** Number of sparkline buckets to synthesise per window. */
const PERIOD_BUCKETS: Record<InsightsPeriod, number> = {
  '7d': 7,
  '30d': 10,
  '90d': 12,
  all: 12,
};

function mockJourneyInsights({
  organizationId,
  courseId,
  period,
}: {
  organizationId: string;
  courseId: string;
  period: InsightsPeriod;
}): JourneyInsightsData {
  const rng = makeRng(seedFrom(courseId, organizationId, period));
  const scale = PERIOD_SCALE[period];

  // Draw a current value and a plausible previous-period value (±25%).
  const sample = (base: number) => {
    const value = Math.round(base * scale * (0.75 + rng() * 0.5));
    const previousValue = Math.round(value * (0.7 + rng() * 0.45));
    return { value, previousValue };
  };

  const enrolled = sample(180);
  // Active/completed are constrained subsets of enrolled (active ≤ enrolled, etc.).
  const active = {
    value: Math.round(enrolled.value * (0.45 + rng() * 0.25)),
    previousValue: Math.round((enrolled.previousValue ?? 0) * 0.5),
  };
  const completed = {
    value: Math.round(active.value * (0.35 + rng() * 0.3)),
    previousValue: Math.round((active.previousValue ?? 0) * 0.4),
  };

  const purchaseCount = sample(90);
  const subscriptionCount = sample(45);

  // Revenue is roughly (purchases · ~£29) + (subs · ~£12), in GBP pence.
  const revenueValue =
    purchaseCount.value * 2900 + subscriptionCount.value * 1200;
  const revenueCents = {
    value: revenueValue,
    previousValue: Math.round(revenueValue * (0.7 + rng() * 0.4)),
  };

  const buckets = PERIOD_BUCKETS[period];
  const revenueTrend: TrendPoint[] = Array.from(
    { length: buckets },
    (_, i) => ({
      date: `t-${buckets - i}`,
      value: Math.round((revenueValue / buckets) * (0.6 + rng() * 0.9)),
    })
  );

  const financials: LiveFinancials = {
    revenueCents,
    purchaseCount,
    subscriptionCount,
    revenueTrend,
  };

  const engagement: CourseEngagement = {
    enrolledCount: enrolled,
    activeCount: active,
    completedCount: completed,
  };

  return {
    courseId,
    courseTitle: `Course ${courseId.slice(0, 8)}`,
    period,
    financials,
    engagement,
  };
}
