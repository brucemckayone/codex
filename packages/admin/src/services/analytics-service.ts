/**
 * Admin Analytics Service
 *
 * Revenue, subscriber, follower and customer statistics for an
 * organisation's Studio. Revenue reads the payouts ledger, so it counts every
 * kind of payment (Codex-2hxff.20); the other figures read their own tables.
 */

import { ANALYTICS, PURCHASE_STATUS } from '@codex/constants';
import { dateWindow, schema, toIso } from '@codex/database';
import { STANDING_REFUND_STATUSES } from '@codex/purchase';
import { BaseService, NotFoundError } from '@codex/service-errors';
import type {
  PaginatedListResponse,
  PaginationMetadata,
} from '@codex/shared-types';
import type { AdminActivityQueryInput } from '@codex/validation';
import {
  and,
  countDistinct,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { DEFAULT_TOP_CONTENT_LIMIT } from '../constants';
import type {
  ActivityFeedItem,
  ActivityFeedResponse,
  AgreementShare,
  ContentPerformanceItem,
  ContentPerformanceQueryOptions,
  CreatorRevenueQueryOptions,
  CreatorRevenueSplitItem,
  CustomerStats,
  DailyFollowers,
  DailyRevenue,
  DailySubscribers,
  DashboardStats,
  DashboardStatsOptions,
  FollowerBlock,
  FollowerQueryOptions,
  FollowerStats,
  RevenueBlock,
  RevenueKind,
  RevenueQueryOptions,
  RevenueStats,
  SubscriberBlock,
  SubscriberQueryOptions,
  SubscriberStats,
  TopContentItem,
  TopContentQueryOptions,
} from '../types';
import {
  type AnalyticsWindow,
  resolveAnalyticsWindow,
  trailingDaysStart,
  zeroFillDays,
} from './analytics-window';

const REVENUE_KINDS: readonly RevenueKind[] = [
  'one_off',
  'course',
  'subscription',
  'course_plan',
];

/** `column`'s UTC calendar day as `YYYY-MM-DD` (owner decision Q-D: UTC). */
function utcDate(column: AnyPgColumn): SQL<string> {
  return sql<string>`((${column}) AT TIME ZONE 'UTC')::date::text`;
}

/** One row of the revenue read: one kind of payment on one UTC day. */
interface RevenueKindDayRow {
  kind: RevenueKind;
  day: string;
  kept_payments: number | string;
  revenue: number | string;
  codex_fee: number | string;
  creators: number | string;
  legacy_charges: number | string;
}

export class AdminAnalyticsService extends BaseService {
  /**
   * Get revenue statistics for an organization.
   *
   * Returns aggregate revenue metrics, a per-kind split and a daily
   * breakdown (one UTC day per day of the window) over the requested range.
   * Reads the payouts ledger (`orgCharges`), so it counts every kind of
   * payment (one-off sales, courses, subscriptions, course plans) whose
   * charge was first recorded in the window, less standing refunds and lost
   * disputes. Pass `compareFrom`/`compareTo` to get a `previous` block for
   * delta-vs-previous KPIs — if either is absent the comparison is skipped
   * and the result matches the single-period shape.
   */
  async getRevenueStats(
    organizationId: string,
    options?: RevenueQueryOptions
  ): Promise<RevenueStats> {
    try {
      // Current and previous windows are disjoint date ranges with no data
      // flow between them — launch via Promise.all when comparison is
      // requested (R12 hard rule). Combined with the inner-block Promise.all
      // in `computeRevenueBlock`, this collapses 4 sequential queries into
      // a single concurrent batch.
      if (options?.compareFrom && options?.compareTo) {
        const [current, previous] = await Promise.all([
          this.computeRevenueBlock(
            organizationId,
            options?.startDate,
            options?.endDate
          ),
          this.computeRevenueBlock(
            organizationId,
            options.compareFrom,
            options.compareTo
          ),
        ]);
        return { ...current, previous };
      }

      const current = await this.computeRevenueBlock(
        organizationId,
        options?.startDate,
        options?.endDate
      );
      return current;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      this.handleError(error, 'getRevenueStats');
    }
  }

  /**
   * The organisation's charges for one window, as a `WITH` clause that the
   * revenue block and Revenue by creator both read, so they cannot disagree
   * (data design §2.3).
   *
   * - `charges`: one row per Stripe charge of the organisation whose FIRST
   *   ledger row falls in the window. That row's time is the payment's date:
   *   it is the only time every source has (an invoice has no row of its
   *   own). A charge first recorded before the window is left out whole,
   *   even when a later replay adds a slice inside it. Its `gross` is the sum
   *   of its slices, which add up to what the buyer paid.
   * - `taken`: what went back to the buyer: its standing refunds and lost
   *   chargebacks, never more than the charge (owner decision Q-C).
   * - `slice_net`: each slice less its share of `taken`, by the clawback's own
   *   rounding, floor(slice × taken / gross), so the figures match what the
   *   ledger takes back without reading `payout_reversals`.
   *
   * Rows with no charge id are never a sale: support's re-pay rows and
   * pre-ledger rows. Both reads of `payouts` are org-scoped.
   */
  private orgCharges(organizationId: string, window: AnalyticsWindow): SQL {
    const start = window.start.toISOString();
    const end = window.end.toISOString();
    const standing = sql.join(
      STANDING_REFUND_STATUSES.map((status) => sql`${status}`),
      sql`, `
    );
    return sql`
      WITH window_charges AS (
        SELECT DISTINCT p.stripe_charge_id
        FROM payouts p
        WHERE p.organization_id = ${organizationId}
          AND p.stripe_charge_id IS NOT NULL
          AND p.created_at >= ${start}::timestamptz
          AND p.created_at <= ${end}::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM payouts e
            WHERE e.stripe_charge_id = p.stripe_charge_id
              AND e.created_at < ${start}::timestamptz
          )
      ),
      slices AS (
        SELECT p.stripe_charge_id, p.payout_type, p.user_id, p.amount_cents,
               p.created_at, p.purchase_id, p.subscription_id,
               p.course_subscription_id, p.source_type, pu.course_id
        FROM payouts p
        JOIN window_charges w ON w.stripe_charge_id = p.stripe_charge_id
        LEFT JOIN purchases pu ON pu.id = p.purchase_id
        WHERE p.organization_id = ${organizationId}
      ),
      charges AS (
        SELECT stripe_charge_id,
               MIN(created_at) AS charged_at,
               SUM(amount_cents)::bigint AS gross,
               CASE
                 WHEN bool_or(subscription_id IS NOT NULL) THEN 'subscription'
                 WHEN bool_or(course_subscription_id IS NOT NULL) THEN 'course_plan'
                 WHEN bool_or(course_id IS NOT NULL) THEN 'course'
                 WHEN bool_or(purchase_id IS NOT NULL) THEN 'one_off'
                 WHEN bool_or(source_type = 'subscription') THEN 'subscription'
                 ELSE 'one_off'
               END AS kind,
               NOT bool_or(purchase_id IS NOT NULL
                           OR subscription_id IS NOT NULL
                           OR course_subscription_id IS NOT NULL) AS legacy
        FROM slices
        GROUP BY stripe_charge_id
      ),
      taken AS (
        SELECT c.stripe_charge_id,
               LEAST(
                 c.gross,
                 COALESCE((SELECT SUM(r.amount_cents) FROM refunds r
                           WHERE r.stripe_charge_id = c.stripe_charge_id
                             AND r.status IN (${standing})), 0)
                 + COALESCE((SELECT SUM(d.amount_cents) FROM disputes d
                             WHERE d.stripe_charge_id = c.stripe_charge_id
                               AND d.status = 'lost'), 0)
               )::bigint AS cents
        FROM charges c
      ),
      slice_net AS (
        SELECT s.stripe_charge_id, s.payout_type, s.user_id,
               s.amount_cents - (s.amount_cents::bigint * t.cents / c.gross) AS net
        FROM slices s
        JOIN charges c ON c.stripe_charge_id = s.stripe_charge_id
        JOIN taken t ON t.stripe_charge_id = s.stripe_charge_id
      )
    `;
  }

  /**
   * One period's revenue, from the payouts ledger: every kind of payment,
   * each counting what the buyer kept (data design §2.3, read A). The day
   * list is one entry per UTC calendar day of the window, oldest first,
   * zero-filled (Codex-2hxff.75), so no reader sorts or guesses.
   */
  private async computeRevenueBlock(
    organizationId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<RevenueBlock> {
    const window = resolveAnalyticsWindow(startDate, endDate);
    const result = await this.db.execute(sql`
      ${this.orgCharges(organizationId, window)}
      SELECT c.kind,
             (c.charged_at AT TIME ZONE 'UTC')::date::text AS day,
             COUNT(*) FILTER (WHERE t.cents < c.gross)::int AS kept_payments,
             COALESCE(SUM(c.gross - t.cents), 0)::bigint AS revenue,
             COALESCE(SUM(n.fee), 0)::bigint AS codex_fee,
             COALESCE(SUM(n.creators), 0)::bigint AS creators,
             COUNT(*) FILTER (WHERE c.legacy)::int AS legacy_charges
      FROM charges c
      JOIN taken t ON t.stripe_charge_id = c.stripe_charge_id
      LEFT JOIN (
        SELECT stripe_charge_id,
               SUM(net) FILTER (WHERE payout_type = 'platform_fee') AS fee,
               SUM(net) FILTER (WHERE payout_type = 'creator_payout') AS creators
        FROM slice_net
        GROUP BY stripe_charge_id
      ) n ON n.stripe_charge_id = c.stripe_charge_id
      GROUP BY c.kind, day
    `);
    const rows = result.rows as unknown as RevenueKindDayRow[];

    const revenueByKind = Object.fromEntries(
      REVENUE_KINDS.map((kind) => [kind, 0])
    ) as Record<RevenueKind, number>;
    const days = new Map<string, DailyRevenue>();
    let platformFeeCents = 0;
    let creatorPayoutCents = 0;
    let totalPurchases = 0;
    let legacyCharges = 0;
    for (const row of rows) {
      const revenue = Number(row.revenue);
      // Sales only (owner decision S1): a subscription payment is not an order.
      const sales =
        row.kind === 'one_off' || row.kind === 'course'
          ? Number(row.kept_payments)
          : 0;
      revenueByKind[row.kind] += revenue;
      platformFeeCents += Number(row.codex_fee);
      creatorPayoutCents += Number(row.creators);
      totalPurchases += sales;
      legacyCharges += Number(row.legacy_charges);
      const day = days.get(row.day) ?? {
        date: row.day,
        revenueCents: 0,
        purchaseCount: 0,
      };
      day.revenueCents += revenue;
      day.purchaseCount += sales;
      days.set(row.day, day);
    }
    if (legacyCharges > 0) {
      this.obs.warn(
        'revenue read charges with no source; kind from source_type',
        {
          organizationId,
          legacyCharges,
        }
      );
    }

    const totalRevenueCents = REVENUE_KINDS.reduce(
      (sum, kind) => sum + revenueByKind[kind],
      0
    );
    const salesRevenueCents = revenueByKind.one_off + revenueByKind.course;
    return {
      totalRevenueCents,
      revenueByKind,
      totalPurchases,
      averageOrderValueCents:
        totalPurchases > 0 ? Math.round(salesRevenueCents / totalPurchases) : 0,
      platformFeeCents,
      // The remainder, so the statement adds up to the penny: the
      // organisation's slices, the owner pool, and a partial refund's
      // rounding pennies (data design §2.3).
      organizationFeeCents:
        totalRevenueCents - platformFeeCents - creatorPayoutCents,
      creatorPayoutCents,
      revenueByDay: zeroFillDays(window, [...days.values()], (date) => ({
        date,
        revenueCents: 0,
        purchaseCount: 0,
      })),
    };
  }

  /**
   * Get subscriber statistics for an organization.
   *
   * Returns active / new / churned counts plus a daily new-subscriber
   * breakdown over the same requested range. Pass `compareFrom`/`compareTo`
   * to get a `previous` block for delta-vs-previous KPIs — if either is
   * absent the comparison is skipped and the result matches the original
   * single-period shape.
   */
  async getSubscriberStats(
    organizationId: string,
    options?: SubscriberQueryOptions
  ): Promise<SubscriberStats> {
    try {
      // Current and previous windows are disjoint date ranges — launch via
      // Promise.all when comparison is requested (R12 hard rule).
      if (options?.compareFrom && options?.compareTo) {
        const [current, previous] = await Promise.all([
          this.computeSubscriberBlock(
            organizationId,
            options?.startDate,
            options?.endDate
          ),
          this.computeSubscriberBlock(
            organizationId,
            options.compareFrom,
            options.compareTo
          ),
        ]);
        return { ...current, previous };
      }

      const current = await this.computeSubscriberBlock(
        organizationId,
        options?.startDate,
        options?.endDate
      );
      return current;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      this.handleError(error, 'getSubscriberStats');
    }
  }

  /**
   * Aggregate + daily breakdown for subscribers in a single period. Daily
   * new-subscriber rows use the same window as the aggregates, and the day
   * list is one entry per UTC calendar day, oldest first, zero-filled, like
   * the revenue block's (Codex-2hxff.75).
   */
  private async computeSubscriberBlock(
    organizationId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<SubscriberBlock> {
    const window = resolveAnalyticsWindow(startDate, endDate);
    const effectiveStart = window.start;
    const effectiveEnd = window.end;

    // A duplicate subscription (a second one to an org the user already
    // subscribed to) was refunded and never subscribed anyone, so it is
    // neither new nor churned (Codex-2hxff.15). A tombstone — a real
    // subscription that ended — still churns.
    const orgSubscriptions = and(
      eq(schema.subscriptions.organizationId, organizationId),
      isNull(schema.subscriptions.duplicateOfSubscriptionId)
    );

    // Four independent aggregates — none consumes another's value. Launch via
    // Promise.all so the round-trip latency overlaps (R12 hard rule). At Neon
    // p95 this collapses ~320-480ms of sequential latency to ~100ms.
    const [activeResult, newResult, churnedResult, dailyRows] =
      await Promise.all([
        // Active at end of period: alive-alive statuses and
        //   createdAt <= end AND (cancelledAt IS NULL OR cancelledAt > end)
        this.db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(schema.subscriptions)
          .where(
            and(
              orgSubscriptions,
              inArray(schema.subscriptions.status, [
                'active',
                'past_due',
                'cancelling',
              ]),
              ...dateWindow(
                schema.subscriptions.createdAt,
                undefined,
                effectiveEnd
              ),
              or(
                isNull(schema.subscriptions.cancelledAt),
                gt(schema.subscriptions.cancelledAt, effectiveEnd)
              )
            )
          ),
        // New in period: createdAt within [start, end]
        this.db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(schema.subscriptions)
          .where(
            and(
              orgSubscriptions,
              ...dateWindow(
                schema.subscriptions.createdAt,
                effectiveStart,
                effectiveEnd
              )
            )
          ),
        // Churned in period: cancelledAt within [start, end]
        this.db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(schema.subscriptions)
          .where(
            and(
              orgSubscriptions,
              ...dateWindow(
                schema.subscriptions.cancelledAt,
                effectiveStart,
                effectiveEnd
              )
            )
          ),
        // Daily new subscribers, per UTC day of createdAt
        this.db
          .select({
            date: utcDate(schema.subscriptions.createdAt),
            newSubscribers: sql<number>`COUNT(*)::int`,
          })
          .from(schema.subscriptions)
          .where(
            and(
              orgSubscriptions,
              ...dateWindow(
                schema.subscriptions.createdAt,
                effectiveStart,
                effectiveEnd
              )
            )
          )
          .groupBy(utcDate(schema.subscriptions.createdAt)),
      ]);

    const subscribersByDay: DailySubscribers[] = zeroFillDays(
      window,
      dailyRows,
      (date) => ({ date, newSubscribers: 0 })
    );

    return {
      activeSubscribers: activeResult[0]?.count ?? 0,
      newSubscribers: newResult[0]?.count ?? 0,
      churnedSubscribers: churnedResult[0]?.count ?? 0,
      subscribersByDay,
    };
  }

  /**
   * Get follower statistics for an organization.
   *
   * Returns total / new counts plus a daily new-follower breakdown over the
   * same requested range. Pass `compareFrom`/`compareTo` to get a `previous`
   * block for delta-vs-previous KPIs — if either is absent the comparison is
   * skipped and the result matches the original single-period shape.
   */
  async getFollowerStats(
    organizationId: string,
    options?: FollowerQueryOptions
  ): Promise<FollowerStats> {
    try {
      // Current and previous windows are disjoint date ranges — launch via
      // Promise.all when comparison is requested (R12 hard rule).
      if (options?.compareFrom && options?.compareTo) {
        const [current, previous] = await Promise.all([
          this.computeFollowerBlock(
            organizationId,
            options?.startDate,
            options?.endDate
          ),
          this.computeFollowerBlock(
            organizationId,
            options.compareFrom,
            options.compareTo
          ),
        ]);
        return { ...current, previous };
      }

      const current = await this.computeFollowerBlock(
        organizationId,
        options?.startDate,
        options?.endDate
      );
      return current;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      this.handleError(error, 'getFollowerStats');
    }
  }

  /**
   * Aggregate + daily breakdown for followers in a single period. Daily
   * new-follower rows use the same window as the aggregates, and the day
   * list is one entry per UTC calendar day, oldest first, zero-filled, like
   * the revenue block's (Codex-2hxff.75).
   *
   * Limitation: `organizationFollowers` has no status or cancellation
   * column — unfollowing hard-deletes the row (intentional, see schema
   * comment). That means `totalFollowers` is the count of rows whose
   * `createdAt <= effectiveEnd` at query time: users who followed and
   * unfollowed within the window leave no trace, so this is an
   * approximation of "follower population at end of period" rather than
   * a historical point-in-time snapshot. It is exact when `endDate` is
   * "now" (equivalent to a live follower count).
   */
  private async computeFollowerBlock(
    organizationId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<FollowerBlock> {
    const window = resolveAnalyticsWindow(startDate, endDate);
    const effectiveStart = window.start;
    const effectiveEnd = window.end;

    // Three independent aggregates — none consumes another's value. Launch via
    // Promise.all so the round-trip latency overlaps (R12 hard rule).
    const [totalResult, newResult, dailyRows] = await Promise.all([
      // Total followers at end of period: rows that exist now with
      // createdAt <= effectiveEnd. Unfollows are hard-deletes so "was
      // following at X" can only be approximated as "row exists AND was
      // created by X".
      this.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(schema.organizationFollowers)
        .where(
          and(
            eq(schema.organizationFollowers.organizationId, organizationId),
            ...dateWindow(
              schema.organizationFollowers.createdAt,
              undefined,
              effectiveEnd
            )
          )
        ),
      // New followers in period: createdAt within [start, end]
      this.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(schema.organizationFollowers)
        .where(
          and(
            eq(schema.organizationFollowers.organizationId, organizationId),
            ...dateWindow(
              schema.organizationFollowers.createdAt,
              effectiveStart,
              effectiveEnd
            )
          )
        ),
      // Daily new followers, per UTC day of createdAt
      this.db
        .select({
          date: utcDate(schema.organizationFollowers.createdAt),
          newFollowers: sql<number>`COUNT(*)::int`,
        })
        .from(schema.organizationFollowers)
        .where(
          and(
            eq(schema.organizationFollowers.organizationId, organizationId),
            ...dateWindow(
              schema.organizationFollowers.createdAt,
              effectiveStart,
              effectiveEnd
            )
          )
        )
        .groupBy(utcDate(schema.organizationFollowers.createdAt)),
    ]);

    const followersByDay: DailyFollowers[] = zeroFillDays(
      window,
      dailyRows,
      (date) => ({ date, newFollowers: 0 })
    );

    return {
      totalFollowers: totalResult[0]?.count ?? 0,
      newFollowers: newResult[0]?.count ?? 0,
      followersByDay,
    };
  }

  /**
   * Get customer statistics for an organization
   *
   * Counts unique customers who have made purchases.
   */
  async getCustomerStats(organizationId: string): Promise<CustomerStats> {
    try {
      // Note: Organization existence is validated by middleware via organizationMemberships FK constraint

      // A "new customer" is one whose FIRST purchase was in the period. Both
      // periods are trailing UTC calendar days, today included, like the
      // revenue block's default window.
      const trendPeriodStartDate = trailingDaysStart(
        ANALYTICS.TREND_DAYS_DEFAULT
      );
      const weekStartDate = trailingDaysStart(7);

      // R12: parallelise independent reads — totalResult and newCustomersResult
      // are both aggregates over `purchases (organization_id, status=completed)`
      // with no FK resolution between them, so they MUST fire concurrently.
      const [totalResult, newCustomersResult] = await Promise.all([
        // Count distinct customers with completed purchases
        this.db
          .select({
            totalCustomers: countDistinct(schema.purchases.customerId),
          })
          .from(schema.purchases)
          .where(
            and(
              eq(schema.purchases.organizationId, organizationId),
              eq(schema.purchases.status, PURCHASE_STATUS.COMPLETED)
            )
          ),
        // Subquery to find first purchase date per customer
        this.db.execute(sql`
          WITH first_purchases AS (
            SELECT
              customer_id,
              MIN(purchased_at) as first_purchase_at
            FROM purchases
            WHERE organization_id = ${organizationId}
              AND status = ${PURCHASE_STATUS.COMPLETED}
            GROUP BY customer_id
          )
          SELECT
            COUNT(*) FILTER (
              WHERE first_purchase_at >= ${trendPeriodStartDate.toISOString()}::timestamptz
            ) AS last_30,
            COUNT(*) FILTER (
              WHERE first_purchase_at >= ${weekStartDate.toISOString()}::timestamptz
            ) AS last_7
          FROM first_purchases
        `),
      ]);

      const newCustomers = newCustomersResult.rows[0] as
        | { last_30: string | number; last_7: string | number }
        | undefined;

      return {
        totalCustomers: totalResult[0]?.totalCustomers ?? 0,
        newCustomersLast30Days: Number(newCustomers?.last_30 ?? 0),
        newCustomersLast7Days: Number(newCustomers?.last_7 ?? 0),
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      this.handleError(error, 'getCustomerStats');
    }
  }

  /**
   * Get top content by revenue.
   *
   * Ranks content by total revenue from completed purchases within the
   * requested period, annotated with distinct playback viewers for the same
   * window and — when `compareFrom`/`compareTo` are provided — a per-row
   * `trendDelta` measuring revenue change vs the previous window. When no
   * date range is provided we fall back to `ANALYTICS.TREND_DAYS_DEFAULT`,
   * matching the revenue/subscriber/follower helpers so the studio dashboard
   * sees a consistent recent-trend window across cards.
   *
   * The previous-period revenue is fetched in a second query scoped to the
   * content ids already returned, so the comparison never scans more rows
   * than the top-N result set.
   */
  async getTopContent(
    organizationId: string,
    options?: TopContentQueryOptions
  ): Promise<PaginatedListResponse<TopContentItem>> {
    try {
      const limit = options?.limit ?? DEFAULT_TOP_CONTENT_LIMIT;
      // The same windows as the revenue block, so a leaderboard counts the
      // end day (today, by default) as the KPIs above it do.
      const { start: effectiveStart, end: effectiveEnd } =
        resolveAnalyticsWindow(options?.startDate, options?.endDate);
      const compare =
        options?.compareFrom && options?.compareTo
          ? resolveAnalyticsWindow(options.compareFrom, options.compareTo)
          : null;

      // Correlates on `content.id`, NOT `purchases.contentId`. The two are equal
      // through the inner join, but only `content.id` is in the GROUP BY — and a
      // correlated subquery may reference only grouped columns, so the
      // `purchases.contentId` form made Postgres reject the whole statement with
      // "subquery uses ungrouped column". That regressed when WP-6 moved the
      // SELECT/GROUP BY to `content.id` (purchases.contentId became nullable for
      // course purchases) and left this correlation behind.
      const viewsInPeriod = sql<number>`(
        SELECT COUNT(DISTINCT ${schema.videoPlayback.userId})::int
        FROM ${schema.videoPlayback}
        WHERE ${schema.videoPlayback.contentId} = ${schema.content.id}
          AND ${schema.videoPlayback.updatedAt} >= ${effectiveStart}
          AND ${schema.videoPlayback.updatedAt} <= ${effectiveEnd}
      )::int`;

      const result = await this.db
        .select({
          // Codex-2pryk WP-6: use content.id (non-null via the inner join) —
          // purchases.contentId is now nullable for course purchases, which the
          // inner join already excludes from this content-revenue leaderboard.
          contentId: schema.content.id,
          contentTitle: schema.content.title,
          thumbnailUrl: schema.content.thumbnailUrl,
          revenueCents: sql<number>`COALESCE(SUM(${schema.purchases.amountPaidCents}), 0)::int`,
          purchaseCount: sql<number>`COUNT(*)::int`,
          viewsInPeriod,
        })
        .from(schema.purchases)
        .innerJoin(
          schema.content,
          eq(schema.purchases.contentId, schema.content.id)
        )
        .where(
          and(
            eq(schema.purchases.organizationId, organizationId),
            eq(schema.purchases.status, PURCHASE_STATUS.COMPLETED),
            ...dateWindow(
              schema.purchases.purchasedAt,
              effectiveStart,
              effectiveEnd
            )
          )
        )
        .groupBy(
          schema.content.id,
          schema.content.title,
          schema.content.thumbnailUrl
        )
        .orderBy(desc(sql`SUM(${schema.purchases.amountPaidCents})`))
        .limit(limit);

      const items: TopContentItem[] = result.map((row) => ({
        contentId: row.contentId,
        contentTitle: row.contentTitle,
        thumbnailUrl: row.thumbnailUrl,
        revenueCents: row.revenueCents,
        purchaseCount: row.purchaseCount,
        viewsInPeriod: row.viewsInPeriod,
        trendDelta: null,
      }));

      if (compare && items.length > 0) {
        const contentIds = items.map((item) => item.contentId);
        const previousRows = await this.db
          .select({
            contentId: schema.purchases.contentId,
            revenueCents: sql<number>`COALESCE(SUM(${schema.purchases.amountPaidCents}), 0)::int`,
          })
          .from(schema.purchases)
          .where(
            and(
              eq(schema.purchases.organizationId, organizationId),
              eq(schema.purchases.status, PURCHASE_STATUS.COMPLETED),
              ...dateWindow(
                schema.purchases.purchasedAt,
                compare.start,
                compare.end
              ),
              inArray(schema.purchases.contentId, contentIds)
            )
          )
          .groupBy(schema.purchases.contentId);

        const previousRevenueById = new Map(
          previousRows.map((row) => [row.contentId, row.revenueCents])
        );

        for (const item of items) {
          const prev = previousRevenueById.get(item.contentId) ?? 0;
          item.trendDelta = item.revenueCents - prev;
        }
      }

      // Build pagination metadata
      // Since this is a "top N" query without true pagination, we return page 1
      // with the actual count as total (indicating this is the full result set)
      const pagination: PaginationMetadata = {
        page: 1,
        limit,
        total: items.length,
        totalPages: 1,
      };

      return { items, pagination };
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      this.handleError(error, 'getTopContent');
    }
  }

  /**
   * Get content performance ranked by watch-time.
   *
   * Unlike `getTopContent` (ranked by purchase revenue), this method is
   * engagement-first: content is scanned from the `content` table so that
   * items with zero playback still surface (LEFT JOIN), and the ordering is
   * by cumulative in-period watch time. All aggregates are bounded by the
   * playback row's `updated_at` sitting inside the window — so a content
   * item with historical but no recent playback reports zeros.
   *
   * See `ContentPerformanceItem` for the exact semantics of each metric and
   * the known lower-bound behaviour of `totalWatchTimeSeconds` given
   * upserted playback state.
   *
   * When `compareFrom`/`compareTo` are provided, `trendDelta` is populated
   * by a second query bounded to the already-returned top-N contentIds so
   * the comparison never scans more rows than the result set.
   */
  async getContentPerformance(
    organizationId: string,
    options?: ContentPerformanceQueryOptions
  ): Promise<PaginatedListResponse<ContentPerformanceItem>> {
    try {
      const limit = options?.limit ?? DEFAULT_TOP_CONTENT_LIMIT;
      // The revenue block's windows, as in getTopContent.
      const { start: effectiveStart, end: effectiveEnd } =
        resolveAnalyticsWindow(options?.startDate, options?.endDate);
      const compare =
        options?.compareFrom && options?.compareTo
          ? resolveAnalyticsWindow(options.compareFrom, options.compareTo)
          : null;

      const currentRows = await this.runContentPerformanceWindow(
        organizationId,
        effectiveStart,
        effectiveEnd,
        limit
      );

      const items: ContentPerformanceItem[] = currentRows.map((row) => ({
        contentId: row.contentId,
        title: row.title,
        totalViews: row.totalViews,
        totalWatchTimeSeconds: row.totalWatchTimeSeconds,
        avgCompletionPercent: row.avgCompletionPercent,
        trendDelta: null,
      }));

      if (compare && items.length > 0) {
        const contentIds = items.map((item) => item.contentId);
        const previousWatchTime = await this.db
          .select({
            contentId: schema.videoPlayback.contentId,
            totalWatchTimeSeconds: sql<number>`COALESCE(SUM(${schema.videoPlayback.positionSeconds}), 0)::int`,
          })
          .from(schema.videoPlayback)
          .where(
            and(
              inArray(schema.videoPlayback.contentId, contentIds),
              ...dateWindow(
                schema.videoPlayback.updatedAt,
                compare.start,
                compare.end
              )
            )
          )
          .groupBy(schema.videoPlayback.contentId);

        const prevById = new Map(
          previousWatchTime.map((row) => [
            row.contentId,
            row.totalWatchTimeSeconds,
          ])
        );

        for (const item of items) {
          const prev = prevById.get(item.contentId) ?? 0;
          item.trendDelta = item.totalWatchTimeSeconds - prev;
        }
      }

      const pagination: PaginationMetadata = {
        page: 1,
        limit,
        total: items.length,
        totalPages: 1,
      };

      return { items, pagination };
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      this.handleError(error, 'getContentPerformance');
    }
  }

  /**
   * Single-window engagement aggregate for `getContentPerformance`. Kept
   * private + positional so both the current window and (future) comparison
   * windows go through the same shape. The date range is folded into the
   * LEFT JOIN predicate so content rows with zero in-window playback still
   * surface as zero-row results rather than being filtered out.
   */
  private async runContentPerformanceWindow(
    organizationId: string,
    startDate: Date,
    endDate: Date,
    limit: number
  ): Promise<
    Array<{
      contentId: string;
      title: string;
      totalViews: number;
      totalWatchTimeSeconds: number;
      avgCompletionPercent: number;
    }>
  > {
    const rows = await this.db
      .select({
        contentId: schema.content.id,
        title: schema.content.title,
        totalViews: sql<number>`COUNT(DISTINCT ${schema.videoPlayback.userId})::int`,
        totalWatchTimeSeconds: sql<number>`COALESCE(SUM(${schema.videoPlayback.positionSeconds}), 0)::int`,
        avgCompletionPercent: sql<number>`COALESCE(
          AVG(
            CASE
              WHEN ${schema.videoPlayback.durationSeconds} > 0 THEN
                LEAST(
                  100,
                  GREATEST(
                    0,
                    ${schema.videoPlayback.positionSeconds}::float
                      / ${schema.videoPlayback.durationSeconds} * 100
                  )
                )
              ELSE NULL
            END
          )::float,
          0
        )`,
      })
      .from(schema.content)
      .leftJoin(
        schema.videoPlayback,
        and(
          eq(schema.videoPlayback.contentId, schema.content.id),
          ...dateWindow(schema.videoPlayback.updatedAt, startDate, endDate)
        )
      )
      .where(
        and(
          eq(schema.content.organizationId, organizationId),
          isNull(schema.content.deletedAt)
        )
      )
      .groupBy(schema.content.id, schema.content.title)
      .orderBy(
        desc(sql`COALESCE(SUM(${schema.videoPlayback.positionSeconds}), 0)`),
        desc(sql`COUNT(DISTINCT ${schema.videoPlayback.userId})`)
      )
      .limit(limit);

    return rows;
  }

  /**
   * Get recent activity feed for an organization
   *
   * Returns a unified activity feed combining purchases, content published,
   * and member joined events. Uses UNION ALL for efficient querying.
   */
  async getRecentActivity(
    organizationId: string,
    query: AdminActivityQueryInput
  ): Promise<ActivityFeedResponse> {
    try {
      const { page = 1, limit = 20, type } = query;
      const offset = (page - 1) * limit;

      // Build type filter clause for each subquery
      const purchaseFilter =
        !type || type === 'purchase' ? sql`true` : sql`false`;
      const contentFilter =
        !type || type === 'content_published' ? sql`true` : sql`false`;
      const memberFilter =
        !type || type === 'member_joined' ? sql`true` : sql`false`;

      // Run items + count queries concurrently (independent queries)
      const [result, countResult] = await Promise.all([
        this.db.execute(sql`
          WITH activity AS (
            SELECT
              p.id::text AS id,
              'purchase' AS type,
              COALESCE(u.name, u.email) AS title,
              c.title AS description,
              p.created_at AS timestamp
            FROM purchases p
            JOIN users u ON p.customer_id = u.id
            JOIN content c ON p.content_id = c.id
            WHERE p.organization_id = ${organizationId}
              AND ${purchaseFilter}

            UNION ALL

            SELECT
              c.id::text AS id,
              'content_published' AS type,
              c.title AS title,
              COALESCE(u.name, u.email) AS description,
              c.published_at AS timestamp
            FROM content c
            JOIN users u ON c.creator_id = u.id
            WHERE c.organization_id = ${organizationId}
              AND c.published_at IS NOT NULL
              AND c.deleted_at IS NULL
              AND ${contentFilter}

            UNION ALL

            SELECT
              om.id::text AS id,
              'member_joined' AS type,
              COALESCE(u.name, u.email) AS title,
              om.role AS description,
              om.created_at AS timestamp
            FROM organization_memberships om
            JOIN users u ON om.user_id = u.id
            WHERE om.organization_id = ${organizationId}
              AND ${memberFilter}
          )
          SELECT id, type, title, description, timestamp::text
          FROM activity
          ORDER BY timestamp DESC
          LIMIT ${limit}
          OFFSET ${offset}
        `),
        this.db.execute(sql`
          SELECT (
            (SELECT COUNT(*) FROM purchases
              WHERE organization_id = ${organizationId} AND ${purchaseFilter})
            +
            (SELECT COUNT(*) FROM content
              WHERE organization_id = ${organizationId}
                AND published_at IS NOT NULL
                AND deleted_at IS NULL
                AND ${contentFilter})
            +
            (SELECT COUNT(*) FROM organization_memberships
              WHERE organization_id = ${organizationId} AND ${memberFilter})
          )::int AS total
        `),
      ]);

      const total = Number(
        (countResult.rows[0] as { total: number })?.total ?? 0
      );

      const items: ActivityFeedItem[] = result.rows.map(
        (row: Record<string, unknown>) => ({
          id: row.id as string,
          type: row.type as ActivityFeedItem['type'],
          title: row.title as string,
          description: (row.description as string) ?? null,
          timestamp: row.timestamp as string,
        })
      );

      return {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      this.handleError(error, 'getRecentActivity');
    }
  }

  /**
   * Get combined dashboard statistics
   *
   * Returns revenue, customer, and top content data in a single call.
   * Uses existing methods to avoid SQL duplication.
   */
  async getDashboardStats(
    organizationId: string,
    options?: DashboardStatsOptions
  ): Promise<DashboardStats> {
    try {
      // Execute all three queries in parallel for efficiency
      const [revenue, customers, topContent] = await Promise.all([
        this.getRevenueStats(organizationId, {
          startDate: options?.startDate,
          endDate: options?.endDate,
        }),
        this.getCustomerStats(organizationId),
        this.getTopContent(organizationId, {
          limit: options?.topContentLimit ?? DEFAULT_TOP_CONTENT_LIMIT,
          startDate: options?.startDate,
          endDate: options?.endDate,
        }),
      ]);

      return {
        revenue,
        customers,
        topContent,
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      this.handleError(error, 'getDashboardStats');
    }
  }

  /**
   * Each creator's subscription and sales shares, from their active
   * agreements. No agreement of a kind is `none`; one with no current
   * proposal pays nothing, so it is `unreadable` ("—", never "0%", fazy6) and
   * is alerted as the data fault it is.
   */
  private sharesByCreator(
    organizationId: string,
    agreements: ReadonlyArray<{
      agreementId: string;
      creatorId: string;
      revenueType: string;
      shareBps: number | null;
    }>
  ): Map<string, { subscription: AgreementShare; sales: AgreementShare }> {
    const byCreator = new Map<
      string,
      { subscription: AgreementShare; sales: AgreementShare }
    >();
    for (const row of agreements) {
      const shares = byCreator.get(row.creatorId) ?? {
        subscription: { kind: 'none' },
        sales: { kind: 'none' },
      };
      let share: AgreementShare;
      if (row.shareBps === null) {
        this.obs.error('agreement has no current proposal; it pays nothing', {
          errorId: crypto.randomUUID(),
          agreementId: row.agreementId,
          organizationId,
        });
        share = { kind: 'unreadable' };
      } else {
        // Display percent at the service boundary: the DOM never sees basis
        // points (10000 bps = 100%).
        share = { kind: 'share', percent: row.shareBps / 100 };
      }
      if (row.revenueType === 'subscription') shares.subscription = share;
      else shares.sales = share;
      byCreator.set(row.creatorId, shares);
    }
    return byCreator;
  }

  /**
   * Studio > Analytics "Revenue by creator" (Codex-zsh2p; owner decisions Q3
   * and Q-E, 2026-10-26): one row per creator who holds an active agreement
   * in the organisation, earned a slice in the window, or is still owed
   * money by it.
   *
   * - Earned is read B of the revenue block's read (`orgCharges`): their
   *   `creator_payout` slices on the organisation's charges in the window,
   *   every kind, sent or not, less the refund share. So Revenue by creator
   *   adds up to the revenue block's `creatorPayoutCents` for the same window.
   * - Each share from its active agreement's current proposal, as the payment
   *   resolver reads it (never the legacy `organization_fee_percentage`, the
   *   ORG's part, Codex-2hxff.19). There is at most one active agreement per
   *   (organisation, creator, type): `uq_creator_org_agreement_active_per_type`.
   * - Last payout and Pending are lifetime, and read their `creator_payout`
   *   rows in this organisation only (multi-org membership safety). Pending
   *   is money owed and not yet sent (data design §2.6): every `pending` or
   *   `failed` row, those held for review or by an open dispute included,
   *   less the partial refunds that already took from it (done
   *   `pending_reduction` steps, the predicate `pendingReductionsFor` reads).
   *   One aggregate, scoped to the organisation.
   */
  async getRevenueByCreator(
    organizationId: string,
    options?: CreatorRevenueQueryOptions
  ): Promise<PaginatedListResponse<CreatorRevenueSplitItem>> {
    try {
      const window = resolveAnalyticsWindow(
        options?.startDate,
        options?.endDate
      );
      const creatorRows = and(
        eq(schema.payouts.organizationId, organizationId),
        eq(schema.payouts.payoutType, 'creator_payout')
      );

      // Four independent reads, none consuming another's value (R12).
      const [agreementRows, earnedResult, pendingRows, lastPayoutRows] =
        await Promise.all([
          this.db
            .select({
              agreementId: schema.creatorOrganizationAgreements.id,
              creatorId: schema.creatorOrganizationAgreements.creatorId,
              revenueType: schema.creatorOrganizationAgreements.revenueType,
              shareBps: schema.agreementProposals.proposedCreatorSharePercent,
            })
            .from(schema.creatorOrganizationAgreements)
            .leftJoin(
              schema.agreementProposals,
              eq(
                schema.agreementProposals.id,
                schema.creatorOrganizationAgreements.currentProposalId
              )
            )
            .where(
              and(
                eq(
                  schema.creatorOrganizationAgreements.organizationId,
                  organizationId
                ),
                // Active, whatever the review date: it is not an expiry
                // (owner decision AGR-01, Codex-2hxff.17).
                eq(schema.creatorOrganizationAgreements.status, 'active')
              )
            ),
          this.db.execute(sql`
            ${this.orgCharges(organizationId, window)}
            SELECT user_id AS creator_id, COALESCE(SUM(net), 0)::bigint AS earned
            FROM slice_net
            WHERE payout_type = 'creator_payout' AND user_id IS NOT NULL
            GROUP BY user_id
          `),
          this.db
            .select({
              creatorId: schema.payouts.userId,
              // Drizzle renders a single-table select's fields unqualified,
              // so the correlated subquery names its tables itself: a bare
              // "id" there would be the reversal's own.
              pendingCents: sql<number | string>`COALESCE(SUM(GREATEST(
                payouts.amount_cents - COALESCE((
                  SELECT SUM(r.amount_cents)
                  FROM payout_reversals r
                  WHERE r.payout_id = payouts.id
                    AND r.kind = 'pending_reduction'
                    AND r.status = 'done'
                ), 0),
                0
              )), 0)::bigint`,
            })
            .from(schema.payouts)
            .where(
              and(
                creatorRows,
                inArray(schema.payouts.status, ['pending', 'failed'])
              )
            )
            .groupBy(schema.payouts.userId),
          this.db
            .select({
              creatorId: schema.payouts.userId,
              lastPayoutAt: sql<
                string | Date | null
              >`MAX(${schema.payouts.resolvedAt})`,
            })
            .from(schema.payouts)
            .where(and(creatorRows, eq(schema.payouts.status, 'paid')))
            .groupBy(schema.payouts.userId),
        ]);

      const earnedRows = earnedResult.rows as unknown as Array<{
        creator_id: string;
        earned: number | string;
      }>;
      const earnedByCreator = new Map(
        earnedRows.map((row) => [row.creator_id, Number(row.earned)])
      );

      const pendingByCreator = new Map<string, number>();
      for (const row of pendingRows) {
        if (row.creatorId) {
          pendingByCreator.set(row.creatorId, Number(row.pendingCents));
        }
      }

      const sharesByCreator = this.sharesByCreator(
        organizationId,
        agreementRows
      );

      const creatorIds = [
        ...new Set([
          ...sharesByCreator.keys(),
          ...earnedByCreator.keys(),
          ...[...pendingByCreator]
            .filter(([, cents]) => cents > 0)
            .map(([creatorId]) => creatorId),
        ]),
      ];
      if (creatorIds.length === 0) {
        const pagination: PaginationMetadata = {
          page: 1,
          limit: 0,
          total: 0,
          totalPages: 1,
        };
        return { items: [], pagination };
      }

      const profiles = await this.db
        .select({
          id: schema.users.id,
          name: schema.users.name,
          avatarUrl: schema.users.avatarUrl,
        })
        .from(schema.users)
        .where(inArray(schema.users.id, creatorIds));
      const profileById = new Map(profiles.map((user) => [user.id, user]));
      const lastPayoutByCreator = new Map(
        lastPayoutRows.map((row) => [row.creatorId, row.lastPayoutAt])
      );

      const items: CreatorRevenueSplitItem[] = creatorIds
        .map((creatorId) => {
          const profile = profileById.get(creatorId);
          const shares = sharesByCreator.get(creatorId);
          return {
            creatorId,
            name: profile?.name ?? '',
            avatarUrl: profile?.avatarUrl ?? null,
            earnedCents: earnedByCreator.get(creatorId) ?? 0,
            subscriptionShare: shares?.subscription ?? { kind: 'none' },
            salesShare: shares?.sales ?? { kind: 'none' },
            // Drivers hand back a Date or a string; `toIso` takes both.
            lastPayoutAt: toIso(lastPayoutByCreator.get(creatorId) ?? null),
            pendingPayoutCents: pendingByCreator.get(creatorId) ?? 0,
          };
        })
        .sort(
          (a, b) =>
            b.earnedCents - a.earnedCents || a.name.localeCompare(b.name)
        );

      const pagination: PaginationMetadata = {
        page: 1,
        limit: items.length,
        total: items.length,
        totalPages: 1,
      };

      return { items, pagination };
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      this.handleError(error, 'getRevenueByCreator');
    }
  }
}
