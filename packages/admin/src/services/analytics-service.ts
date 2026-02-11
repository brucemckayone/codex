/**
 * Admin Analytics Service
 *
 * Provides revenue and customer statistics for platform owner dashboard.
 * Uses SQL aggregation for efficient queries on purchases table.
 */

import { ANALYTICS, PURCHASE_STATUS } from '@codex/constants';
import { schema } from '@codex/database';
import { BaseService, NotFoundError, wrapError } from '@codex/service-errors';
import type { AdminActivityQueryInput } from '@codex/validation';
import { and, countDistinct, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { DEFAULT_TOP_CONTENT_LIMIT } from '../constants';
import type {
  ActivityFeedItem,
  ActivityFeedResponse,
  CustomerStats,
  DailyRevenue,
  RevenueQueryOptions,
  RevenueStats,
  TopContentItem,
} from '../types';

export class AdminAnalyticsService extends BaseService {
  /**
   * Get revenue statistics for an organization
   *
   * Returns aggregate revenue metrics and daily breakdown.
   * Only counts completed purchases.
   */
  async getRevenueStats(
    organizationId: string,
    options?: RevenueQueryOptions
  ): Promise<RevenueStats> {
    try {
      // Note: Organization existence is validated by middleware via organizationMemberships FK constraint
      // Build date filter conditions
      const dateConditions = [
        eq(schema.purchases.organizationId, organizationId),
        eq(schema.purchases.status, PURCHASE_STATUS.COMPLETED),
      ];

      if (options?.startDate) {
        dateConditions.push(
          gte(schema.purchases.purchasedAt, options.startDate)
        );
      }
      if (options?.endDate) {
        dateConditions.push(lte(schema.purchases.purchasedAt, options.endDate));
      }

      // Get aggregate stats using SQL aggregation
      const aggregateResult = await this.db
        .select({
          totalRevenueCents: sql<number>`COALESCE(SUM(${schema.purchases.amountPaidCents}), 0)::int`,
          totalPurchases: sql<number>`COUNT(*)::int`,
          platformFeeCents: sql<number>`COALESCE(SUM(${schema.purchases.platformFeeCents}), 0)::int`,
          organizationFeeCents: sql<number>`COALESCE(SUM(${schema.purchases.organizationFeeCents}), 0)::int`,
          creatorPayoutCents: sql<number>`COALESCE(SUM(${schema.purchases.creatorPayoutCents}), 0)::int`,
        })
        .from(schema.purchases)
        .where(and(...dateConditions));

      const stats = aggregateResult[0] ?? {
        totalRevenueCents: 0,
        totalPurchases: 0,
        platformFeeCents: 0,
        organizationFeeCents: 0,
        creatorPayoutCents: 0,
      };

      // Calculate average order value (avoid division by zero)
      const averageOrderValueCents =
        stats.totalPurchases > 0
          ? Math.round(stats.totalRevenueCents / stats.totalPurchases)
          : 0;

      // Get daily revenue for default trend period
      const trendPeriodStartDate = new Date();
      trendPeriodStartDate.setDate(
        trendPeriodStartDate.getDate() - ANALYTICS.TREND_DAYS_DEFAULT
      );

      const dailyRevenue = await this.db
        .select({
          date: sql<string>`DATE(${schema.purchases.purchasedAt})::text`,
          revenueCents: sql<number>`COALESCE(SUM(${schema.purchases.amountPaidCents}), 0)::int`,
          purchaseCount: sql<number>`COUNT(*)::int`,
        })
        .from(schema.purchases)
        .where(
          and(
            eq(schema.purchases.organizationId, organizationId),
            eq(schema.purchases.status, PURCHASE_STATUS.COMPLETED),
            gte(schema.purchases.purchasedAt, trendPeriodStartDate)
          )
        )
        .groupBy(sql`DATE(${schema.purchases.purchasedAt})`)
        .orderBy(desc(sql`DATE(${schema.purchases.purchasedAt})`));

      // Map to proper format
      const revenueByDay: DailyRevenue[] = dailyRevenue.map((row) => ({
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
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw wrapError(error, { organizationId, options });
    }
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
      throw wrapError(error, { organizationId });
    }
  }

  /**
   * Get top content by revenue
   *
   * Returns content ranked by total revenue from completed purchases.
   */
  async getTopContent(
    organizationId: string,
    limit = DEFAULT_TOP_CONTENT_LIMIT
  ): Promise<TopContentItem[]> {
    try {
      // Note: Organization existence is validated by middleware via organizationMemberships FK constraint
      // Get top content by revenue with JOIN to content table
      const result = await this.db
        .select({
          contentId: schema.purchases.contentId,
          contentTitle: schema.content.title,
          revenueCents: sql<number>`COALESCE(SUM(${schema.purchases.amountPaidCents}), 0)::int`,
          purchaseCount: sql<number>`COUNT(*)::int`,
        })
        .from(schema.purchases)
        .innerJoin(
          schema.content,
          eq(schema.purchases.contentId, schema.content.id)
        )
        .where(
          and(
            eq(schema.purchases.organizationId, organizationId),
            eq(schema.purchases.status, PURCHASE_STATUS.COMPLETED)
          )
        )
        .groupBy(schema.purchases.contentId, schema.content.title)
        .orderBy(desc(sql`SUM(${schema.purchases.amountPaidCents})`))
        .limit(limit);

      return result.map((row) => ({
        contentId: row.contentId,
        contentTitle: row.contentTitle,
        revenueCents: row.revenueCents,
        purchaseCount: row.purchaseCount,
      }));
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw wrapError(error, { organizationId, limit });
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

      // UNION ALL query across 3 tables
      const result = await this.db.execute(sql`
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
      `);

      // Get total count
      const countResult = await this.db.execute(sql`
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
      `);

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
        pagination: { page, limit, total },
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw wrapError(error, { organizationId, query });
    }
  }
}
