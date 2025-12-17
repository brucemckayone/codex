/**
 * Admin Analytics Service
 *
 * Provides revenue and customer statistics for platform owner dashboard.
 * Uses SQL aggregation for efficient queries on purchases table.
 */

import { schema } from '@codex/database';
import { BaseService, NotFoundError, wrapError } from '@codex/service-errors';
import { and, countDistinct, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type {
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
        eq(schema.purchases.status, 'completed'),
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

      // Get daily revenue for last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

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
            eq(schema.purchases.status, 'completed'),
            gte(schema.purchases.purchasedAt, thirtyDaysAgo)
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
            eq(schema.purchases.status, 'completed')
          )
        );

      // Count new customers in last 30 days
      // A "new customer" is one whose FIRST purchase was in the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Subquery to find first purchase date per customer
      const newCustomersResult = await this.db.execute(sql`
        WITH first_purchases AS (
          SELECT
            customer_id,
            MIN(purchased_at) as first_purchase_at
          FROM purchases
          WHERE organization_id = ${organizationId}
            AND status = 'completed'
          GROUP BY customer_id
        )
        SELECT COUNT(*) as count
        FROM first_purchases
        WHERE first_purchase_at >= ${thirtyDaysAgo}
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
    limit = 10
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
            eq(schema.purchases.status, 'completed')
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
}
