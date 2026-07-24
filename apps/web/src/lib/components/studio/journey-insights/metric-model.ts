/**
 * Journey insights — metric model & provenance tagging (WP-7, Codex-2pryk.3.4).
 *
 * The reporting surface (SPEC §11, §14.4 · FRONTEND-MAP §5.3) ships metrics in
 * PROVENANCE tiers. Provenance is STRUCTURAL, not cosmetic: every metric is
 * constructed carrying its `tier`, and metrics are physically grouped by tier
 * for rendering. The legend (`METRIC_TIERS`) is the single source of truth for
 * what each tier means and why it exists.
 *
 * Two tiers ship for v1:
 *   • `live`   — financial data derivable TODAY from purchases / subscriptions /
 *                payouts (revenue, purchase mix, subscription mix).
 *   • `course` — engagement data from the WP-1 tables `course_enrollments` +
 *                `practice_completions` (enrolled / active / completed / rate).
 *
 * The third tier from the spec — `track` (sales-page views, referrer, campaign)
 * — is DELIBERATELY NOT BUILT: it is instrumented nowhere today and is not yet
 * planned (maps to the unstarted Codex-arhvd pipeline). It is surfaced in the
 * legend only, as an explicit "not tracked yet" note, so the provenance model
 * stays honest without fabricating data. See `UNTRACKED_TIER`.
 *
 * This module is PURE (no Svelte, no I/O, no DB): it transforms the seam's
 * contract-shaped data into render-ready, tier-tagged metrics. It is the unit
 * under test — the raw data source is mocked at the seam (`journey-insights.remote.ts`).
 */

/** Data-provenance tiers that ship for v1. `track` is intentionally absent. */
export type MetricTier = 'live' | 'course';

/** How a metric's value should be rendered. */
export type MetricFormat = 'money' | 'number' | 'percent';

/** A single point on a metric's trend sparkline. */
export interface TrendPoint {
  date: string;
  value: number;
}

/**
 * A current value paired with the equivalent from the previous comparison
 * window. `previousValue` is `null` when there is no comparable prior period
 * (KPICard suppresses the delta row in that case).
 */
export interface MetricSample {
  value: number;
  previousValue: number | null;
}

/**
 * `live`-tier source data — the money path. Values are GBP **pence** (matching
 * the platform convention: `courses.priceCents`, `RevenueStats.totalRevenueCents`).
 * Derivable today from `@codex/purchase` + `@codex/subscription` + payouts,
 * scoped to the course's creator/org.
 */
export interface LiveFinancials {
  /** Gross course revenue in GBP pence (one-off purchases + course subscriptions). */
  revenueCents: MetricSample;
  /** Count of one-off course purchases. */
  purchaseCount: MetricSample;
  /** Count of active course-specific subscriptions. */
  subscriptionCount: MetricSample;
  /** Optional revenue trend for the sparkline (pence per bucket). */
  revenueTrend: TrendPoint[];
}

/**
 * `course`-tier source data — the engagement path. Needs the WP-1 tables
 * `course_enrollments` (enrolled / active-via-`lastActivityAt` / completed-via-
 * `completedAt`) and `practice_completions` (rollup). Completion rate is DERIVED
 * from completed ÷ enrolled, not stored.
 */
export interface CourseEngagement {
  /** Rows in `course_enrollments` for the course. */
  enrolledCount: MetricSample;
  /** Enrollments with recent `lastActivityAt` (active learners). */
  activeCount: MetricSample;
  /** Enrollments with a non-null `completedAt`. */
  completedCount: MetricSample;
}

/** The supported reporting windows. Drives the period toggle + query re-key. */
export type InsightsPeriod = '7d' | '30d' | '90d' | 'all';

/**
 * The seam's return contract — everything the insights surface needs for one
 * course/journey in one period. Produced by `getJourneyInsights` (mocked today,
 * real aggregation at Round-D).
 */
export interface JourneyInsightsData {
  courseId: string;
  courseTitle: string;
  period: InsightsPeriod;
  financials: LiveFinancials;
  engagement: CourseEngagement;
}

/** A render-ready metric, tagged with its provenance tier. */
export interface JourneyMetric {
  /** Stable key for `{#each}` and testing. */
  key: string;
  /** Human label (already in display language). */
  label: string;
  /** Provenance tier — matches the group this metric lives in. */
  tier: MetricTier;
  format: MetricFormat;
  value: number;
  previousValue: number | null;
  /** Suffix for `number`/`percent` metrics (e.g. "%", "learners"). */
  unit?: string;
  /** Optional sparkline series (money/number only). */
  trend?: TrendPoint[];
}

/** Legend metadata for a provenance tier. */
export interface MetricTierMeta {
  id: MetricTier;
  label: string;
  /** One-line explanation of the data source — shown in the legend. */
  description: string;
}

/**
 * Single source of truth for provenance semantics. The legend renders from
 * this; the group builders tag metrics with the matching `id`. `live` is listed
 * first because it ships first (SPEC §14.4: "ship `live` first").
 */
export const METRIC_TIERS = {
  live: {
    id: 'live',
    label: 'Live',
    description:
      'Financial data from real purchases, subscriptions and payouts — available now.',
  },
  course: {
    id: 'course',
    label: 'Course',
    description:
      'Engagement data from course enrolments and practice completions.',
  },
} as const satisfies Record<MetricTier, MetricTierMeta>;

/**
 * The `track` tier from SPEC §14.4, surfaced in the legend but NOT built for v1.
 * Sales-page views / referrer / campaign source are captured nowhere today, so
 * reach and top-of-funnel metrics are intentionally omitted rather than faked.
 */
export const UNTRACKED_TIER = {
  id: 'track',
  label: 'Traffic',
  description:
    'Sales-page views, referrer and campaign source are not captured yet, so reach and top-of-funnel metrics are intentionally omitted.',
} as const;

/**
 * Completion rate as an integer percentage (0–100). Guards div-by-zero: a
 * course with no enrolments reports 0%, never NaN or Infinity.
 */
export function completionRate(completed: number, enrolled: number): number {
  if (enrolled <= 0) return 0;
  return Math.round((completed / enrolled) * 100);
}

/** Build the `live`-tier (financial) metrics. Every metric is tagged `live`. */
export function buildLiveMetrics(financials: LiveFinancials): JourneyMetric[] {
  return [
    {
      key: 'revenue',
      label: 'Course revenue',
      tier: 'live',
      format: 'money',
      value: financials.revenueCents.value,
      previousValue: financials.revenueCents.previousValue,
      trend: financials.revenueTrend,
    },
    {
      key: 'purchases',
      label: 'One-off purchases',
      tier: 'live',
      format: 'number',
      value: financials.purchaseCount.value,
      previousValue: financials.purchaseCount.previousValue,
    },
    {
      key: 'subscriptions',
      label: 'Course subscriptions',
      tier: 'live',
      format: 'number',
      value: financials.subscriptionCount.value,
      previousValue: financials.subscriptionCount.previousValue,
    },
  ];
}

/**
 * Build the `course`-tier (engagement) metrics. Every metric is tagged `course`.
 * Completion rate is derived from completed ÷ enrolled (current and previous).
 */
export function buildCourseMetrics(
  engagement: CourseEngagement
): JourneyMetric[] {
  const { enrolledCount, activeCount, completedCount } = engagement;

  const ratePrevious =
    enrolledCount.previousValue !== null &&
    completedCount.previousValue !== null
      ? completionRate(
          completedCount.previousValue,
          enrolledCount.previousValue
        )
      : null;

  return [
    {
      key: 'enrolled',
      label: 'Enrolled',
      tier: 'course',
      format: 'number',
      value: enrolledCount.value,
      previousValue: enrolledCount.previousValue,
      unit: 'learners',
    },
    {
      key: 'active',
      label: 'Active learners',
      tier: 'course',
      format: 'number',
      value: activeCount.value,
      previousValue: activeCount.previousValue,
      unit: 'learners',
    },
    {
      key: 'completed',
      label: 'Completed',
      tier: 'course',
      format: 'number',
      value: completedCount.value,
      previousValue: completedCount.previousValue,
      unit: 'learners',
    },
    {
      key: 'completionRate',
      label: 'Completion rate',
      tier: 'course',
      format: 'percent',
      value: completionRate(completedCount.value, enrolledCount.value),
      previousValue: ratePrevious,
      unit: '%',
    },
  ];
}

/** A provenance-tagged group of metrics ready to render as one section. */
export interface MetricTierGroupModel {
  tier: MetricTier;
  meta: MetricTierMeta;
  metrics: JourneyMetric[];
}

/**
 * Group all metrics by provenance tier — the structural expression of
 * provenance. Returns exactly the two v1 tiers, `live` before `course`. The
 * `track` tier is never produced here (it is legend-only, `UNTRACKED_TIER`).
 */
export function buildJourneyMetricGroups(
  data: JourneyInsightsData
): MetricTierGroupModel[] {
  return [
    {
      tier: 'live',
      meta: METRIC_TIERS.live,
      metrics: buildLiveMetrics(data.financials),
    },
    {
      tier: 'course',
      meta: METRIC_TIERS.course,
      metrics: buildCourseMetrics(data.engagement),
    },
  ];
}
