/**
 * Admin Analytics Service
 *
 * Provides revenue and customer statistics for platform owner dashboard.
 * Uses SQL aggregation for efficient queries on purchases table.
 */

import { ANALYTICS, PURCHASE_STATUS } from '@codex/constants';
import { schema } from '@codex/database';
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
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { DEFAULT_TOP_CONTENT_LIMIT } from '../constants';
import type {
  ActivityFeedItem,
  ActivityFeedResponse,
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
  RevenueQueryOptions,
  RevenueStats,
  SubscriberBlock,
  SubscriberQueryOptions,
  SubscriberStats,
  TopContentItem,
  TopContentQueryOptions,
} from '../types';

export class AdminAnalyticsService extends BaseService {
  /**
   * Get revenue statistics for an organization.
   *
   * Returns aggregate revenue metrics and a daily breakdown over the same
   * requested range. Only counts completed purchases. Pass
   * `compareFrom`/`compareTo` to get a `previous` block for delta-vs-previous
   * KPIs — if either is absent the comparison is skipped and the result
   * matches the original single-period shape.
   */
  async getRevenueStats(
    organizationId: string,
    options?: RevenueQueryOptions
  ): Promise<RevenueStats> {
    try {
      const current = await this.computeRevenueBlock(
        organizationId,
        options?.startDate,
        options?.endDate
      );

      if (options?.compareFrom && options?.compareTo) {
        const previous = await this.computeRevenueBlock(
          organizationId,
          options.compareFrom,
          options.compareTo
        );
        return { ...current, previous };
      }

      return current;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      this.handleError(error, 'getRevenueStats');
    }
  }

  /**
   * Aggregate + daily breakdown for a single period. Daily rows use the same
   * date window as the aggregate so the two views stay consistent — the
   * previous implementation hardcoded the last 30 days for the daily query,
   * which diverged from the aggregate once a caller passed `startDate`/`endDate`.
   * When no range is provided we fall back to the trend-days default so the
   * dashboard's zero-argument call still returns a sensible recent trend.
   */
  private async computeRevenueBlock(
    organizationId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<RevenueBlock> {
    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - ANALYTICS.TREND_DAYS_DEFAULT);
    const effectiveStart = startDate ?? defaultStart;
    const effectiveEnd = endDate ?? new Date();

    const baseConditions = [
      eq(schema.purchases.organizationId, organizationId),
      eq(schema.purchases.status, PURCHASE_STATUS.COMPLETED),
      gte(schema.purchases.purchasedAt, effectiveStart),
      lte(schema.purchases.purchasedAt, effectiveEnd),
    ];

    const aggregateResult = await this.db
      .select({
        totalRevenueCents: sql<number>`COALESCE(SUM(${schema.purchases.amountPaidCents}), 0)::int`,
        totalPurchases: sql<number>`COUNT(*)::int`,
        platformFeeCents: sql<number>`COALESCE(SUM(${schema.purchases.platformFeeCents}), 0)::int`,
        organizationFeeCents: sql<number>`COALESCE(SUM(${schema.purchases.organizationFeeCents}), 0)::int`,
        creatorPayoutCents: sql<number>`COALESCE(SUM(${schema.purchases.creatorPayoutCents}), 0)::int`,
      })
      .from(schema.purchases)
      .where(and(...baseConditions));

    const stats = aggregateResult[0] ?? {
      totalRevenueCents: 0,
      totalPurchases: 0,
      platformFeeCents: 0,
      organizationFeeCents: 0,
      creatorPayoutCents: 0,
    };

    const averageOrderValueCents =
      stats.totalPurchases > 0
        ? Math.round(stats.totalRevenueCents / stats.totalPurchases)
        : 0;

    const dailyRows = await this.db
      .select({
        date: sql<string>`DATE(${schema.purchases.purchasedAt})::text`,
        revenueCents: sql<number>`COALESCE(SUM(${schema.purchases.amountPaidCents}), 0)::int`,
        purchaseCount: sql<number>`COUNT(*)::int`,
      })
      .from(schema.purchases)
      .where(and(...baseConditions))
      .groupBy(sql`DATE(${schema.purchases.purchasedAt})`)
      .orderBy(desc(sql`DATE(${schema.purchases.purchasedAt})`));

    const revenueByDay: DailyRevenue[] = dailyRows.map((row) => ({
      date: row.date,
      revenueCents: row.revenueCents,
      purchaseCount: row.purchaseCount,
    }));

    return {
      totalRevenueCents: stats.totalRevenueCents,
      totalPurchases: stats.totalPurchases,
      averageOrderValueCents,
      platformFeeCents: stats.platformFeeCents,
      organizationFeeCents: stats.organizationFeeCents,
      creatorPayoutCents: stats.creatorPayoutCents,
      revenueByDay,
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
      const current = await this.computeSubscriberBlock(
        organizationId,
        options?.startDate,
        options?.endDate
      );

      if (options?.compareFrom && options?.compareTo) {
        const previous = await this.computeSubscriberBlock(
          organizationId,
          options.compareFrom,
          options.compareTo
        );
        return { ...current, previous };
      }

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
   * new-subscriber rows use the same date window as the aggregates so the
   * two views stay consistent. When no range is provided we fall back to
   * the trend-days default (matching the revenue helper) so zero-argument
   * callers still get a sensible recent trend.
   */
  private async computeSubscriberBlock(
    organizationId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<SubscriberBlock> {
    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - ANALYTICS.TREND_DAYS_DEFAULT);
    const effectiveStart = startDate ?? defaultStart;
    const effectiveEnd = endDate ?? new Date();

    // Active at end of period: alive-alive statuses and
    //   createdAt <= end AND (cancelledAt IS NULL OR cancelledAt > end)
    const activeResult = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(schema.subscriptions)
      .where(
        and(
          eq(schema.subscriptions.organizationId, organizationId),
          inArray(schema.subscriptions.status, [
            'active',
            'past_due',
            'cancelling',
          ]),
          lte(schema.subscriptions.createdAt, effectiveEnd),
          or(
            isNull(schema.subscriptions.cancelledAt),
            gt(schema.subscriptions.cancelledAt, effectiveEnd)
          )
        )
      );

    // New in period: createdAt within [start, end]
    const newResult = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(schema.subscriptions)
      .where(
        and(
          eq(schema.subscriptions.organizationId, organizationId),
          gte(schema.subscriptions.createdAt, effectiveStart),
          lte(schema.subscriptions.createdAt, effectiveEnd)
        )
      );

    // Churned in period: cancelledAt within [start, end]
    const churnedResult = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(schema.subscriptions)
      .where(
        and(
          eq(schema.subscriptions.organizationId, organizationId),
          gte(schema.subscriptions.cancelledAt, effectiveStart),
          lte(schema.subscriptions.cancelledAt, effectiveEnd)
        )
      );

    // Daily new subscribers, grouped by DATE(createdAt), most recent first
    const dailyRows = await this.db
      .select({
        date: sql<string>`DATE(${schema.subscriptions.createdAt})::text`,
        newSubscribers: sql<number>`COUNT(*)::int`,
      })
      .from(schema.subscriptions)
      .where(
        and(
          eq(schema.subscriptions.organizationId, organizationId),
          gte(schema.subscriptions.createdAt, effectiveStart),
          lte(schema.subscriptions.createdAt, effectiveEnd)
        )
      )
      .groupBy(sql`DATE(${schema.subscriptions.createdAt})`)
      .orderBy(desc(sql`DATE(${schema.subscriptions.createdAt})`));

    const subscribersByDay: DailySubscribers[] = dailyRows.map((row) => ({
      date: row.date,
      newSubscribers: row.newSubscribers,
    }));

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
      const current = await this.computeFollowerBlock(
        organizationId,
        options?.startDate,
        options?.endDate
      );

      if (options?.compareFrom && options?.compareTo) {
        const previous = await this.computeFollowerBlock(
          organizationId,
          options.compareFrom,
          options.compareTo
        );
        return { ...current, previous };
      }

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
   * new-follower rows use the same date window as the aggregates so the two
   * views stay consistent. When no range is provided we fall back to the
   * trend-days default (matching the revenue/subscriber helpers) so
   * zero-argument callers still get a sensible recent trend.
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
    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - ANALYTICS.TREND_DAYS_DEFAULT);
    const effectiveStart = startDate ?? defaultStart;
    const effectiveEnd = endDate ?? new Date();

    // Total followers at end of period: rows that exist now with
    // createdAt <= effectiveEnd. Unfollows are hard-deletes so "was
    // following at X" can only be approximated as "row exists AND was
    // created by X".
    const totalResult = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(schema.organizationFollowers)
      .where(
        and(
          eq(schema.organizationFollowers.organizationId, organizationId),
          lte(schema.organizationFollowers.createdAt, effectiveEnd)
        )
      );

    // New followers in period: createdAt within [start, end]
    const newResult = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(schema.organizationFollowers)
      .where(
        and(
          eq(schema.organizationFollowers.organizationId, organizationId),
          gte(schema.organizationFollowers.createdAt, effectiveStart),
          lte(schema.organizationFollowers.createdAt, effectiveEnd)
        )
      );

    // Daily new followers, grouped by DATE(createdAt), most recent first
    const dailyRows = await this.db
      .select({
        date: sql<string>`DATE(${schema.organizationFollowers.createdAt})::text`,
        newFollowers: sql<number>`COUNT(*)::int`,
      })
      .from(schema.organizationFollowers)
      .where(
        and(
          eq(schema.organizationFollowers.organizationId, organizationId),
          gte(schema.organizationFollowers.createdAt, effectiveStart),
          lte(schema.organizationFollowers.createdAt, effectiveEnd)
        )
      )
      .groupBy(sql`DATE(${schema.organizationFollowers.createdAt})`)
      .orderBy(desc(sql`DATE(${schema.organizationFollowers.createdAt})`));

    const followersByDay: DailyFollowers[] = dailyRows.map((row) => ({
      date: row.date,
      newFollowers: row.newFollowers,
    }));

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
      // Count distinct customers with completed purchases
      const totalResult = await this.db
        .select({
          totalCustomers: countDistinct(schema.purchases.customerId),
        })
        .from(schema.purchases)
        .where(
          and(
            eq(schema.purchases.organizationId, organizationId),
            eq(schema.purchases.status, PURCHASE_STATUS.COMPLETED)
          )
        );

      // Count new customers in default trend period
      // A "new customer" is one whose FIRST purchase was in that period
      const trendPeriodStartDate = new Date();
      trendPeriodStartDate.setDate(
        trendPeriodStartDate.getDate() - ANALYTICS.TREND_DAYS_DEFAULT
      );

      // Subquery to find first purchase date per customer
      const newCustomersResult = await this.db.execute(sql`
        WITH first_purchases AS (
          SELECT
            customer_id,
            MIN(purchased_at) as first_purchase_at
          FROM purchases
          WHERE organization_id = ${organizationId}
            AND status = ${PURCHASE_STATUS.COMPLETED}
          GROUP BY customer_id
        )
        SELECT COUNT(*) as count
        FROM first_purchases
        WHERE first_purchase_at >= ${trendPeriodStartDate}
      `);

      const newCustomersLast30Days = Number(
        (newCustomersResult.rows[0] as { count: string })?.count ?? 0
      );

      return {
        totalCustomers: totalResult[0]?.totalCustomers ?? 0,
        newCustomersLast30Days,
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
      const defaultStart = new Date();
      defaultStart.setDate(
        defaultStart.getDate() - ANALYTICS.TREND_DAYS_DEFAULT
      );
      const effectiveStart = options?.startDate ?? defaultStart;
      const effectiveEnd = options?.endDate ?? new Date();

      const viewsInPeriod = sql<number>`(
        SELECT COUNT(DISTINCT ${schema.videoPlayback.userId})::int
        FROM ${schema.videoPlayback}
        WHERE ${schema.videoPlayback.contentId} = ${schema.purchases.contentId}
          AND ${schema.videoPlayback.updatedAt} >= ${effectiveStart}
          AND ${schema.videoPlayback.updatedAt} <= ${effectiveEnd}
      )::int`;

      const result = await this.db
        .select({
          contentId: schema.purchases.contentId,
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
            gte(schema.purchases.purchasedAt, effectiveStart),
            lte(schema.purchases.purchasedAt, effectiveEnd)
          )
        )
        .groupBy(
          schema.purchases.contentId,
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

      const wantsCompare = Boolean(options?.compareFrom && options?.compareTo);
      if (wantsCompare && items.length > 0) {
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
              // Non-null assertions are safe here: wantsCompare is only true
              // when both compareFrom and compareTo are defined.
              gte(schema.purchases.purchasedAt, options!.compareFrom!),
              lte(schema.purchases.purchasedAt, options!.compareTo!),
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
}
