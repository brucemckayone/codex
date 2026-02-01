/**
 * Admin Customer Management Service
 *
 * Provides customer support operations for platform owners.
 * All operations are scoped to organization.
 *
 * Key Features:
 * - List customers (users with completed purchases from org)
 * - View customer details with purchase history
 * - Grant complimentary access (for refunds/support)
 *
 * IMPORTANT: Complimentary access is granted via contentAccess table,
 * NOT by creating purchase records. This keeps revenue analytics accurate.
 */

import { ACCESS_TYPES, PAGINATION, PURCHASE_STATUS } from '@codex/constants';
import { schema, withPagination } from '@codex/database';
import {
  BaseService,
  ConflictError,
  NotFoundError,
  wrapError,
} from '@codex/service-errors';
import { and, countDistinct, desc, eq, sql } from 'drizzle-orm';
import type {
  CustomerDetails,
  CustomerWithStats,
  PaginatedListResponse,
  PaginationParams,
  PurchaseHistoryItem,
} from '../types';

export class AdminCustomerManagementService extends BaseService {
  /**
   * List customers who have purchased from organization
   *
   * Returns users with completed purchases, aggregated with:
   * - Total number of purchases
   * - Total amount spent
   *
   * "Customer" = user with at least one completed purchase from this org
   */
  async listCustomers(
    organizationId: string,
    options: Partial<PaginationParams> = {}
  ): Promise<PaginatedListResponse<CustomerWithStats>> {
    const { page = 1, limit = PAGINATION.DEFAULT } = options;

    try {
      // Note: Organization existence is validated by middleware via organizationMemberships FK constraint
      const { limit: safeLimit, offset } = withPagination({ page, limit });

      // Get customers with aggregated stats
      // Customer = user with completed purchases from this org
      const customersQuery = await this.db
        .select({
          userId: schema.purchases.customerId,
          email: schema.users.email,
          name: schema.users.name,
          createdAt: schema.users.createdAt,
          totalPurchases: sql<number>`COUNT(*)::int`,
          totalSpentCents: sql<number>`COALESCE(SUM(${schema.purchases.amountPaidCents}), 0)::int`,
        })
        .from(schema.purchases)
        .innerJoin(
          schema.users,
          eq(schema.purchases.customerId, schema.users.id)
        )
        .where(
          and(
            eq(schema.purchases.organizationId, organizationId),
            eq(schema.purchases.status, PURCHASE_STATUS.COMPLETED)
          )
        )
        .groupBy(
          schema.purchases.customerId,
          schema.users.email,
          schema.users.name,
          schema.users.createdAt
        )
        .orderBy(desc(sql`SUM(${schema.purchases.amountPaidCents})`))
        .limit(safeLimit)
        .offset(offset);

      // Get total count of distinct customers
      const countResult = await this.db
        .select({
          total: countDistinct(schema.purchases.customerId),
        })
        .from(schema.purchases)
        .where(
          and(
            eq(schema.purchases.organizationId, organizationId),
            eq(schema.purchases.status, PURCHASE_STATUS.COMPLETED)
          )
        );

      const total = Number(countResult[0]?.total ?? 0);
      const totalPages = Math.ceil(total / safeLimit);

      const items: CustomerWithStats[] = customersQuery.map((row) => ({
        userId: row.userId,
        email: row.email,
        name: row.name,
        createdAt: row.createdAt,
        totalPurchases: row.totalPurchases,
        totalSpentCents: row.totalSpentCents,
      }));

      return {
        items,
        pagination: {
          page,
          limit: safeLimit,
          total,
          totalPages,
        },
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw wrapError(error, { organizationId, options });
    }
  }

  /**
   * Get customer details with purchase history
   *
   * Returns full customer profile including:
   * - Basic info (email, name, createdAt)
   * - Aggregated stats (total purchases, total spent)
   * - Complete purchase history for this organization
   */
  async getCustomerDetails(
    organizationId: string,
    customerId: string
  ): Promise<CustomerDetails> {
    try {
      // Note: Organization existence is validated by middleware via organizationMemberships FK constraint
      // Get user info
      const user = await this.db.query.users.findFirst({
        where: eq(schema.users.id, customerId),
      });

      if (!user) {
        throw new NotFoundError('Customer not found', { customerId });
      }

      // Get aggregated stats
      const statsResult = await this.db
        .select({
          totalPurchases: sql<number>`COUNT(*)::int`,
          totalSpentCents: sql<number>`COALESCE(SUM(${schema.purchases.amountPaidCents}), 0)::int`,
        })
        .from(schema.purchases)
        .where(
          and(
            eq(schema.purchases.customerId, customerId),
            eq(schema.purchases.organizationId, organizationId),
            eq(schema.purchases.status, PURCHASE_STATUS.COMPLETED)
          )
        );

      const stats = statsResult[0] ?? { totalPurchases: 0, totalSpentCents: 0 };

      // Check if this user is actually a customer of this org
      if (stats.totalPurchases === 0) {
        throw new NotFoundError(
          'Customer has no purchases from this organization',
          {
            customerId,
            organizationId,
          }
        );
      }

      // Get purchase history with content titles
      const purchaseHistory = await this.db
        .select({
          purchaseId: schema.purchases.id,
          contentId: schema.purchases.contentId,
          contentTitle: schema.content.title,
          amountPaidCents: schema.purchases.amountPaidCents,
          purchasedAt: schema.purchases.purchasedAt,
        })
        .from(schema.purchases)
        .innerJoin(
          schema.content,
          eq(schema.purchases.contentId, schema.content.id)
        )
        .where(
          and(
            eq(schema.purchases.customerId, customerId),
            eq(schema.purchases.organizationId, organizationId),
            eq(schema.purchases.status, PURCHASE_STATUS.COMPLETED)
          )
        )
        .orderBy(desc(schema.purchases.purchasedAt));

      const historyItems: PurchaseHistoryItem[] = purchaseHistory
        .filter(
          (row): row is typeof row & { purchasedAt: Date } =>
            row.purchasedAt !== null
        )
        .map((row) => ({
          purchaseId: row.purchaseId,
          contentId: row.contentId,
          contentTitle: row.contentTitle,
          amountPaidCents: row.amountPaidCents,
          purchasedAt: row.purchasedAt,
        }));

      return {
        userId: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        totalPurchases: stats.totalPurchases,
        totalSpentCents: stats.totalSpentCents,
        purchaseHistory: historyItems,
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      throw wrapError(error, { organizationId, customerId });
    }
  }

  /**
   * Grant complimentary content access
   *
   * Used for refunds, support, promotions.
   * Creates contentAccess record with accessType='complimentary'.
   *
   * IMPORTANT:
   * - Does NOT create a purchase record
   * - Idempotent: returns success if access already exists
   * - Revenue analytics remain accurate (only real purchases counted)
   */
  async grantContentAccess(
    organizationId: string,
    customerId: string,
    contentId: string
  ): Promise<boolean> {
    try {
      await this.db.transaction(async (tx) => {
        // Note: Organization existence is validated by middleware via organizationMemberships FK constraint
        // Verify customer exists and has relationship with org
        // (either via purchase or org membership)
        const customer = await tx.query.users.findFirst({
          where: eq(schema.users.id, customerId),
        });

        if (!customer) {
          throw new NotFoundError('Customer not found', { customerId });
        }

        // Check for existing purchase or membership relationship
        const hasPurchase = await tx.query.purchases.findFirst({
          where: and(
            eq(schema.purchases.customerId, customerId),
            eq(schema.purchases.organizationId, organizationId)
          ),
        });

        const hasMembership = await tx.query.organizationMemberships.findFirst({
          where: and(
            eq(schema.organizationMemberships.userId, customerId),
            eq(schema.organizationMemberships.organizationId, organizationId)
          ),
        });

        if (!hasPurchase && !hasMembership) {
          throw new NotFoundError(
            'Customer has no relationship with this organization',
            { customerId, organizationId }
          );
        }

        // Verify content exists and belongs to organization
        const content = await tx.query.content.findFirst({
          where: and(
            eq(schema.content.id, contentId),
            eq(schema.content.organizationId, organizationId)
          ),
        });

        if (!content) {
          throw new NotFoundError('Content not found in this organization', {
            contentId,
            organizationId,
          });
        }

        // Check for existing access (idempotent operation)
        const existingAccess = await tx.query.contentAccess.findFirst({
          where: and(
            eq(schema.contentAccess.userId, customerId),
            eq(schema.contentAccess.contentId, contentId)
          ),
        });

        if (existingAccess) {
          // Already has access - idempotent success
          return;
        }

        // Insert complimentary access record
        await tx.insert(schema.contentAccess).values({
          userId: customerId,
          contentId,
          organizationId,
          accessType: ACCESS_TYPES.COMPLIMENTARY,
        });
      });

      return true;
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ConflictError) {
        throw error;
      }
      throw wrapError(error, { organizationId, customerId, contentId });
    }
  }
}
