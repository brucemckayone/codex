/**
 * CourseInsightsService (Codex-2pryk · Round-D · Codex-776gg · SPEC §11 / §14.4).
 *
 * The STUDIO reporting read side of a course — the owner/admin-facing insights
 * surface (WP-7). Two provenance tiers ship for v1:
 *
 *   • `live`   — financial data derivable TODAY, scoped to the course:
 *                gross revenue (one-off course purchases + course-subscription
 *                recurring revenue), one-off purchase count, active
 *                course-subscription count, and a revenue sparkline. Money is
 *                GBP **pence**.
 *   • `course` — engagement data from the WP-1 progress tables: enrolled /
 *                active (recent `lastActivityAt`) / completed (`completedAt`).
 *
 * The `track` tier (sales-page views / referrer / campaign) is instrumented
 * nowhere (SPEC §14.4) and is deliberately absent — the surface shows it as a
 * legend-only "not tracked yet" note rather than fabricating numbers.
 *
 * PROVENANCE & SCOPING
 * --------------------
 * Every metric is counted WITHIN the selected period window, with `previousValue`
 * the same count over the immediately-preceding equal-length window (null for
 * `'all'`, which has no comparable prior period). See {@link resolveInsightsWindow}.
 *
 * Cross-org guard: `getInsights` resolves the course scoped to BOTH its id AND
 * the caller's managed `organizationId`. A manager of org A passing a courseId
 * owned by org B resolves nothing → `NotFoundError` (404), so another org's
 * revenue can never be summed. This is the second layer of defence behind the
 * route's `requireOrgManagement` (which re-derives the org from the session and
 * ignores the client-supplied `organizationId` beyond org resolution).
 *
 * COURSE-ATTRIBUTABLE MONEY (WP-6)
 * --------------------------------
 * Revenue is course-scoped WITHOUT reinventing the fee-split math — it reads the
 * existing immutable snapshots:
 *   - one-off purchases → `purchases.amountPaidCents` WHERE `purchases.courseId`
 *     (the split-target FK added by WP-6), status `completed`.
 *   - course subscriptions → the `payouts` ledger rows whose `courseSubscriptionId`
 *     maps (via `course_subscriptions.courseId`) to the course. The per-charge
 *     split rows (`platform_fee` + `organization_fee` + `creator_payout`) sum to
 *     the GROSS charge, so SUM over them = gross recurring revenue collected.
 */

import {
  courseEnrollments,
  courseSubscriptions,
  courses,
  landingPages,
  payouts,
  purchases,
} from '@codex/database/schema';
import { BaseService, NotFoundError } from '@codex/service-errors';
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  bucketRevenueTrend,
  type InsightsPeriod,
  type InsightsWindow,
  resolveInsightsWindow,
  resolveTrendWindow,
  type TrendPoint,
  type TrendSample,
} from './insights-window';

export type { InsightsPeriod, TrendPoint } from './insights-window';

/**
 * A current value paired with the equivalent from the previous comparison
 * window. `previousValue` is `null` when there is no comparable prior period
 * (e.g. period `'all'`). Structurally identical to the FROZEN FE contract twin
 * (`MetricSample` in the web app's `journey-insights/metric-model.ts`) — this
 * BE copy exists because a package cannot import an apps/web `$lib` module.
 */
export interface MetricSample {
  value: number;
  previousValue: number | null;
}

/** `live`-tier source data — the money path (GBP pence). */
export interface LiveFinancials {
  /** Gross course revenue: one-off purchases + course subscriptions. */
  revenueCents: MetricSample;
  /** Count of completed one-off course purchases. */
  purchaseCount: MetricSample;
  /** Count of course-specific subscriptions acquired in the window. */
  subscriptionCount: MetricSample;
  /** Revenue per bucket over the window (pence). */
  revenueTrend: TrendPoint[];
}

/** `course`-tier source data — the engagement path. */
export interface CourseEngagement {
  /** Enrollments created in the window. */
  enrolledCount: MetricSample;
  /** Enrollments with `lastActivityAt` in the window (active learners). */
  activeCount: MetricSample;
  /** Enrollments with `completedAt` in the window. */
  completedCount: MetricSample;
}

/** The seam's return contract for one course/journey in one period. */
export interface JourneyInsightsData {
  courseId: string;
  courseTitle: string;
  period: InsightsPeriod;
  financials: LiveFinancials;
  engagement: CourseEngagement;
}

// Status vocabularies (mirror the schema CHECK constraints).
const PURCHASE_STATUS_COMPLETED = 'completed';
/** Payout rows that represent revenue collected (excludes refund reversals). */
const PAYOUT_REVENUE_STATUSES = ['paid', 'pending'] as const;
/** Course-subscription statuses that count as an active acquisition. */
const ACTIVE_COURSE_SUB_STATUSES = [
  'active',
  'past_due',
  'cancelling',
  'paused',
] as const;

function metric(value: number, previousValue: number | null): MetricSample {
  return { value, previousValue };
}

interface FinancialTotals {
  revenueCents: number;
  purchaseCount: number;
  subscriptionCount: number;
}

interface EngagementTotals {
  enrolled: number;
  active: number;
  completed: number;
}

export class CourseInsightsService extends BaseService {
  /**
   * Studio insights for one course in one reporting period. Owner/admin only —
   * the route enforces `requireOrgManagement`; this method additionally scopes
   * the course to the managed org (the cross-org guard).
   */
  async getInsights(
    organizationId: string,
    courseId: string,
    period: InsightsPeriod
  ): Promise<JourneyInsightsData> {
    try {
      // Cross-org guard: the course MUST belong to the caller's managed org.
      const [course] = await this.db
        .select({ id: courses.id, title: courses.title })
        .from(courses)
        .where(
          and(
            eq(courses.id, courseId),
            eq(courses.organizationId, organizationId),
            isNull(courses.deletedAt)
          )
        )
        .limit(1);
      if (!course) {
        throw new NotFoundError('Course not found');
      }

      const window = resolveInsightsWindow(period, new Date());

      const [financials, engagement] = await Promise.all([
        this.loadFinancials(courseId, period, window),
        this.loadEngagement(courseId, window),
      ]);

      return {
        courseId: course.id,
        courseTitle: course.title,
        period,
        financials,
        engagement,
      };
    } catch (error) {
      this.handleError(error, 'getInsights');
    }
  }

  /**
   * BATCH course revenue for the studio index badge — gross revenue over
   * `period` (default 30d) for every course-type journey the org owns, keyed by
   * **landing-page id** (the id each index row already carries). This is the
   * authoritative figure `listJourneysForOrg` deliberately returns as `null`
   * (see its docstring): the per-row money join lives HERE, computed with the
   * SAME definition as {@link aggregateFinancials} (one-off course purchases +
   * course-subscription payouts), so the badge can never drift from the
   * per-journey Insights read. Org-scoped by construction — the course ids come
   * only from the org's own non-deleted `landing_pages`, so no foreign revenue
   * can be summed. Only pages with `> 0` revenue are returned (the badge hides
   * falsy values, matching the prototype's `it.revenue ? … : ''`).
   */
  async getOrgJourneyRevenue(
    organizationId: string,
    period: InsightsPeriod = '30d'
  ): Promise<Record<string, number>> {
    try {
      // Org's non-deleted course-type journeys → (landingPageId, courseId). The
      // inner join to a non-deleted, same-org course is the cross-org guard.
      const pages = await this.db
        .select({ landingPageId: landingPages.id, courseId: courses.id })
        .from(landingPages)
        .innerJoin(
          courses,
          and(
            eq(courses.id, landingPages.subjectId),
            eq(courses.organizationId, landingPages.organizationId),
            isNull(courses.deletedAt)
          )
        )
        .where(
          and(
            eq(landingPages.organizationId, organizationId),
            eq(landingPages.subjectType, 'course'),
            isNull(landingPages.deletedAt)
          )
        );

      if (pages.length === 0) return {};

      const courseIds = pages.map((p) => p.courseId);
      const window = resolveInsightsWindow(period, new Date());

      // Two GROUPED aggregates (no per-row N+1), each mirroring one arm of
      // `aggregateFinancials`: completed one-off purchases + course-subscription
      // payout ledger rows, summed within `[start, end)`, grouped by course.
      const [purchaseRows, payoutRows] = await Promise.all([
        this.db
          .select({
            courseId: purchases.courseId,
            gross: sql<number>`coalesce(sum(${purchases.amountPaidCents}), 0)`,
          })
          .from(purchases)
          .where(
            and(
              inArray(purchases.courseId, courseIds),
              eq(purchases.status, PURCHASE_STATUS_COMPLETED),
              gte(purchases.createdAt, window.start),
              lt(purchases.createdAt, window.end)
            )
          )
          .groupBy(purchases.courseId),
        this.db
          .select({
            courseId: courseSubscriptions.courseId,
            gross: sql<number>`coalesce(sum(${payouts.amountCents}), 0)`,
          })
          .from(payouts)
          .innerJoin(
            courseSubscriptions,
            eq(payouts.courseSubscriptionId, courseSubscriptions.id)
          )
          .where(
            and(
              inArray(courseSubscriptions.courseId, courseIds),
              inArray(payouts.status, [...PAYOUT_REVENUE_STATUSES]),
              gte(payouts.createdAt, window.start),
              lt(payouts.createdAt, window.end)
            )
          )
          .groupBy(courseSubscriptions.courseId),
      ]);

      const byCourse = new Map<string, number>();
      for (const r of purchaseRows) {
        if (r.courseId) byCourse.set(r.courseId, Number(r.gross ?? 0));
      }
      for (const r of payoutRows) {
        if (r.courseId) {
          byCourse.set(
            r.courseId,
            (byCourse.get(r.courseId) ?? 0) + Number(r.gross ?? 0)
          );
        }
      }

      // Re-key by landing-page id; omit zero (the badge hides falsy values).
      const out: Record<string, number> = {};
      for (const p of pages) {
        const cents = byCourse.get(p.courseId) ?? 0;
        if (cents > 0) out[p.landingPageId] = cents;
      }
      return out;
    } catch (error) {
      this.handleError(error, 'getOrgJourneyRevenue');
    }
  }

  // ── live (financial) tier ───────────────────────────────────────────────

  private async loadFinancials(
    courseId: string,
    period: InsightsPeriod,
    window: InsightsWindow
  ): Promise<LiveFinancials> {
    const [current, previous, samples] = await Promise.all([
      this.aggregateFinancials(courseId, window.start, window.end),
      window.previousStart && window.previousEnd
        ? this.aggregateFinancials(
            courseId,
            window.previousStart,
            window.previousEnd
          )
        : Promise.resolve(null),
      this.loadRevenueSamples(courseId, window.start, window.end),
    ]);

    const trendWindow = resolveTrendWindow(period, window, samples);
    const revenueTrend = bucketRevenueTrend(samples, trendWindow, period);

    return {
      revenueCents: metric(
        current.revenueCents,
        previous?.revenueCents ?? null
      ),
      purchaseCount: metric(
        current.purchaseCount,
        previous?.purchaseCount ?? null
      ),
      subscriptionCount: metric(
        current.subscriptionCount,
        previous?.subscriptionCount ?? null
      ),
      revenueTrend,
    };
  }

  /** Sum gross course revenue + counts within `[from, to)`. */
  private async aggregateFinancials(
    courseId: string,
    from: Date,
    to: Date
  ): Promise<FinancialTotals> {
    const [purchaseRows, subGrossRows, subCountRows] = await Promise.all([
      this.db
        .select({
          gross: sql<number>`coalesce(sum(${purchases.amountPaidCents}), 0)`,
          count: sql<number>`count(*)`,
        })
        .from(purchases)
        .where(
          and(
            eq(purchases.courseId, courseId),
            eq(purchases.status, PURCHASE_STATUS_COMPLETED),
            gte(purchases.createdAt, from),
            lt(purchases.createdAt, to)
          )
        ),
      this.db
        .select({
          gross: sql<number>`coalesce(sum(${payouts.amountCents}), 0)`,
        })
        .from(payouts)
        .innerJoin(
          courseSubscriptions,
          eq(payouts.courseSubscriptionId, courseSubscriptions.id)
        )
        .where(
          and(
            eq(courseSubscriptions.courseId, courseId),
            inArray(payouts.status, [...PAYOUT_REVENUE_STATUSES]),
            gte(payouts.createdAt, from),
            lt(payouts.createdAt, to)
          )
        ),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(courseSubscriptions)
        .where(
          and(
            eq(courseSubscriptions.courseId, courseId),
            inArray(courseSubscriptions.status, [
              ...ACTIVE_COURSE_SUB_STATUSES,
            ]),
            gte(courseSubscriptions.createdAt, from),
            lt(courseSubscriptions.createdAt, to)
          )
        ),
    ]);

    const purchaseGross = Number(purchaseRows[0]?.gross ?? 0);
    const subscriptionGross = Number(subGrossRows[0]?.gross ?? 0);
    return {
      revenueCents: purchaseGross + subscriptionGross,
      purchaseCount: Number(purchaseRows[0]?.count ?? 0),
      subscriptionCount: Number(subCountRows[0]?.count ?? 0),
    };
  }

  /**
   * Dated revenue contributions within `[from, to)` for the sparkline: each
   * completed one-off purchase and each course-subscription payout row. Bounded
   * by a single course, so the row count is modest even for the `'all'` window.
   */
  private async loadRevenueSamples(
    courseId: string,
    from: Date,
    to: Date
  ): Promise<TrendSample[]> {
    const [purchaseRows, payoutRows] = await Promise.all([
      this.db
        .select({
          at: purchases.createdAt,
          amountCents: purchases.amountPaidCents,
        })
        .from(purchases)
        .where(
          and(
            eq(purchases.courseId, courseId),
            eq(purchases.status, PURCHASE_STATUS_COMPLETED),
            gte(purchases.createdAt, from),
            lt(purchases.createdAt, to)
          )
        ),
      this.db
        .select({
          at: payouts.createdAt,
          amountCents: payouts.amountCents,
        })
        .from(payouts)
        .innerJoin(
          courseSubscriptions,
          eq(payouts.courseSubscriptionId, courseSubscriptions.id)
        )
        .where(
          and(
            eq(courseSubscriptions.courseId, courseId),
            inArray(payouts.status, [...PAYOUT_REVENUE_STATUSES]),
            gte(payouts.createdAt, from),
            lt(payouts.createdAt, to)
          )
        ),
    ]);

    return [
      ...purchaseRows.map((r) => ({
        at: r.at,
        amountCents: Number(r.amountCents),
      })),
      ...payoutRows.map((r) => ({
        at: r.at,
        amountCents: Number(r.amountCents),
      })),
    ];
  }

  // ── course (engagement) tier ──────────────────────────────────────────────

  private async loadEngagement(
    courseId: string,
    window: InsightsWindow
  ): Promise<CourseEngagement> {
    const [current, previous] = await Promise.all([
      this.aggregateEngagement(courseId, window.start, window.end),
      window.previousStart && window.previousEnd
        ? this.aggregateEngagement(
            courseId,
            window.previousStart,
            window.previousEnd
          )
        : Promise.resolve(null),
    ]);

    return {
      enrolledCount: metric(current.enrolled, previous?.enrolled ?? null),
      activeCount: metric(current.active, previous?.active ?? null),
      completedCount: metric(current.completed, previous?.completed ?? null),
    };
  }

  /**
   * Count enrolled / active / completed within `[from, to)`. Each metric windows
   * on its own timestamp: enrollments by `enrolledAt`, active learners by
   * `lastActivityAt`, completions by `completedAt` (a `gte`/`lt` on a nullable
   * column excludes NULLs, so no `IS NOT NULL` guard is needed).
   */
  private async aggregateEngagement(
    courseId: string,
    from: Date,
    to: Date
  ): Promise<EngagementTotals> {
    const [enrolledRows, activeRows, completedRows] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(courseEnrollments)
        .where(
          and(
            eq(courseEnrollments.courseId, courseId),
            gte(courseEnrollments.enrolledAt, from),
            lt(courseEnrollments.enrolledAt, to)
          )
        ),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(courseEnrollments)
        .where(
          and(
            eq(courseEnrollments.courseId, courseId),
            gte(courseEnrollments.lastActivityAt, from),
            lt(courseEnrollments.lastActivityAt, to)
          )
        ),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(courseEnrollments)
        .where(
          and(
            eq(courseEnrollments.courseId, courseId),
            gte(courseEnrollments.completedAt, from),
            lt(courseEnrollments.completedAt, to)
          )
        ),
    ]);

    return {
      enrolled: Number(enrolledRows[0]?.count ?? 0),
      active: Number(activeRows[0]?.count ?? 0),
      completed: Number(completedRows[0]?.count ?? 0),
    };
  }
}
