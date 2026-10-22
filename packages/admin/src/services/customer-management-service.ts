/**
 * Admin Customer Management Service
 *
 * Provides customer support operations for platform owners.
 * All operations are scoped to organization.
 *
 * Key Features:
 * - List customers (users with completed purchases from org)
 * - View customer details with purchase history
 * - Grant complimentary access (for refunds/support), list and revoke grants
 *
 * IMPORTANT: Complimentary access is a `grant` entitlement (the row
 * `@codex/access` reads), NOT a purchase record. This keeps revenue analytics
 * accurate. Rules: docs/payments/access.md#support-grants.
 */

import {
  isGrantableContent,
  PAGINATION,
  PURCHASE_STATUS,
} from '@codex/constants';
import { schema, toIso, withPagination } from '@codex/database';
import {
  BaseService,
  ConflictError,
  NotFoundError,
} from '@codex/service-errors';
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { ContentNotGrantableError } from '../errors';
import type {
  CustomerDetails,
  CustomerGrant,
  CustomerWithStats,
  PaginatedListResponse,
  PaginationParams,
  PurchaseHistoryItem,
} from '../types';

/** The `entitlements.source` of a support grant. */
const GRANT = 'grant';

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
    options: Partial<PaginationParams> & {
      search?: string;
      contentId?: string;
      joinedWithin?: number;
      minSpendCents?: number;
      maxSpendCents?: number;
    } = {}
  ): Promise<PaginatedListResponse<CustomerWithStats>> {
    const {
      page = 1,
      limit = PAGINATION.DEFAULT,
      search,
      contentId,
      joinedWithin,
      minSpendCents,
      maxSpendCents,
    } = options;

    try {
      // Note: Organization existence is validated by middleware via organizationMemberships FK constraint
      const { limit: safeLimit, offset } = withPagination({ page, limit });

      // Purchase-scoped conditions
      const purchaseConditions = and(
        eq(schema.purchases.organizationId, organizationId),
        eq(schema.purchases.status, PURCHASE_STATUS.COMPLETED),
        ...(contentId ? [eq(schema.purchases.contentId, contentId)] : [])
      );

      // User search condition (name or email, case-insensitive)
      const escaped = search?.replace(/%/g, '\\%').replace(/_/g, '\\_');
      const searchCondition = escaped
        ? or(
            ilike(schema.users.name, `%${escaped}%`),
            ilike(schema.users.email, `%${escaped}%`)
          )
        : undefined;

      // Joined date filter (user createdAt within N days)
      const joinedCondition = joinedWithin
        ? gte(
            schema.users.createdAt,
            new Date(Date.now() - joinedWithin * 86_400_000)
          )
        : undefined;

      const whereCondition = and(
        purchaseConditions,
        ...(searchCondition ? [searchCondition] : []),
        ...(joinedCondition ? [joinedCondition] : [])
      );

      // HAVING conditions for aggregate filters (spend range)
      const spendSum = sql`COALESCE(SUM(${schema.purchases.amountPaidCents}), 0)`;
      const havingConditions = and(
        ...(minSpendCents != null
          ? [gte(spendSum, sql`${minSpendCents}`)]
          : []),
        ...(maxSpendCents != null ? [sql`${spendSum} < ${maxSpendCents}`] : [])
      );

      // Build base items query
      let itemsQuery = this.db
        .select({
          userId: schema.purchases.customerId,
          email: schema.users.email,
          name: schema.users.name,
          createdAt: schema.users.createdAt,
          totalPurchases: sql<number>`COUNT(*)::int`,
          totalSpentCents: sql<number>`${spendSum}::int`,
        })
        .from(schema.purchases)
        .innerJoin(
          schema.users,
          eq(schema.purchases.customerId, schema.users.id)
        )
        .where(whereCondition)
        .groupBy(
          schema.purchases.customerId,
          schema.users.email,
          schema.users.name,
          schema.users.createdAt
        )
        .orderBy(desc(spendSum))
        .limit(safeLimit)
        .offset(offset)
        .$dynamic();

      if (havingConditions) {
        itemsQuery = itemsQuery.having(havingConditions);
      }

      // Count query needs the same filters including HAVING
      // Use a subquery to count distinct customers after aggregate filtering
      const countQuery = havingConditions
        ? this.db
            .select({ total: sql<number>`COUNT(*)::int` })
            .from(
              this.db
                .select({ userId: schema.purchases.customerId })
                .from(schema.purchases)
                .innerJoin(
                  schema.users,
                  eq(schema.purchases.customerId, schema.users.id)
                )
                .where(whereCondition)
                .groupBy(schema.purchases.customerId, schema.users.createdAt)
                .having(havingConditions)
                .as('filtered_customers')
            )
        : this.db
            .select({ total: countDistinct(schema.purchases.customerId) })
            .from(schema.purchases)
            .innerJoin(
              schema.users,
              eq(schema.purchases.customerId, schema.users.id)
            )
            .where(whereCondition);

      const [customersQuery, countResult] = await Promise.all([
        itemsQuery,
        countQuery,
      ]);

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
      this.handleError(error, 'listCustomers');
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
          // content.id is non-null via the inner join; purchases.contentId is
          // nullable for course purchases (excluded by the join). Codex-2pryk WP-6.
          contentId: schema.content.id,
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
      this.handleError(error, 'getCustomerDetails');
    }
  }

  /**
   * Grant complimentary content access
   *
   * Used for refunds, support, promotions. Writes a `grant` entitlement — the
   * row the access decision and the library read — recording who gave it.
   *
   * IMPORTANT:
   * - Only paid or subscriber content (`isGrantableContent`); anything else
   *   is a `ContentNotGrantableError` (422)
   * - Does NOT create a purchase record
   * - Idempotent: a re-grant of a live grant is a no-op (`ON CONFLICT DO
   *   NOTHING` on `uq_entitlement_live_content`); after a revoke it writes a
   *   fresh row, and the revoked one stays for the audit trail
   * - Revenue analytics remain accurate (only real purchases counted)
   */
  async grantContentAccess(
    organizationId: string,
    customerId: string,
    contentId: string,
    grantedByUserId: string
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

        // Verify content exists, is not deleted, and belongs to organization
        const content = await tx.query.content.findFirst({
          where: and(
            eq(schema.content.id, contentId),
            eq(schema.content.organizationId, organizationId),
            isNull(schema.content.deletedAt)
          ),
        });

        if (!content) {
          throw new NotFoundError('Content not found in this organization', {
            contentId,
            organizationId,
          });
        }

        // Only an item a grant can open: paid or subscriber content. For any
        // other kind the access decision never reads an entitlement, so the
        // grant would sit on the shelf and open nothing (owner decision,
        // "only items it can open").
        if (!isGrantableContent(content)) {
          throw new ContentNotGrantableError(contentId);
        }

        // The partial unique index allows one LIVE grant per (user, content),
        // so a re-grant conflicts and does nothing.
        await tx
          .insert(schema.entitlements)
          .values({
            userId: customerId,
            organizationId,
            contentId,
            source: GRANT,
            grantedByUserId,
          })
          .onConflictDoNothing();
      });

      return true;
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ConflictError) {
        throw error;
      }
      this.handleError(error, 'grantContentAccess');
    }
  }

  /**
   * List this organization's support grants for one customer, newest first,
   * for the Studio customer drawer. Live AND revoked grants are both listed,
   * so the drawer keeps an audit trail.
   *
   * The granter's and revoker's names are scalar lookups on `users` rather
   * than two aliased joins: both are nullable (SET NULL when that account is
   * deleted), and a lookup keeps the row even when the person is gone.
   */
  async listCustomerGrants(
    organizationId: string,
    customerId: string,
    options: Partial<PaginationParams> = {}
  ): Promise<PaginatedListResponse<CustomerGrant>> {
    const { page = 1, limit = PAGINATION.DEFAULT } = options;

    try {
      const { limit: safeLimit, offset } = withPagination({ page, limit });

      // An array, spread into each `and()`: nesting one `and()` (typed
      // `SQL | undefined`) in another would drop the scope silently if it
      // were ever undefined, and list every customer's grants.
      const scope = [
        eq(schema.entitlements.userId, customerId),
        eq(schema.entitlements.organizationId, organizationId),
        eq(schema.entitlements.source, GRANT),
      ];

      const [rows, countResult] = await Promise.all([
        this.db
          .select({
            id: schema.entitlements.id,
            contentId: schema.content.id,
            contentTitle: schema.content.title,
            contentSlug: schema.content.slug,
            grantedAt: schema.entitlements.grantedAt,
            grantedByName: sql<
              string | null
            >`(SELECT ${schema.users.name} FROM ${schema.users} WHERE ${schema.users.id} = ${schema.entitlements.grantedByUserId})`,
            revokedAt: schema.entitlements.revokedAt,
            revokedByName: sql<
              string | null
            >`(SELECT ${schema.users.name} FROM ${schema.users} WHERE ${schema.users.id} = ${schema.entitlements.revokedByUserId})`,
          })
          .from(schema.entitlements)
          .innerJoin(
            schema.content,
            eq(schema.content.id, schema.entitlements.contentId)
          )
          .where(and(...scope))
          .orderBy(
            desc(schema.entitlements.grantedAt),
            desc(schema.entitlements.id)
          )
          .limit(safeLimit)
          .offset(offset),
        this.db
          .select({ total: count() })
          .from(schema.entitlements)
          .where(and(...scope)),
      ]);

      const total = Number(countResult[0]?.total ?? 0);

      return {
        items: rows.map((row) => ({
          id: row.id,
          contentId: row.contentId,
          contentTitle: row.contentTitle,
          contentSlug: row.contentSlug,
          grantedAt: toIso(row.grantedAt),
          grantedByName: row.grantedByName,
          revokedAt: toIso(row.revokedAt),
          revokedByName: row.revokedByName,
        })),
        pagination: {
          page,
          limit: safeLimit,
          total,
          totalPages: Math.ceil(total / safeLimit),
        },
      };
    } catch (error) {
      this.handleError(error, 'listCustomerGrants');
    }
  }

  /**
   * Revoke one support grant. Scoped to the entitlement id, the customer, this
   * organization AND `source = 'grant'`, so it can never end a purchase or a
   * subscription, nor another organization's grant — each of those is a 404.
   *
   * Idempotent: revoking an already-revoked grant changes nothing and returns
   * `revoked: false`. Access ends on the next decision (the resolver reads
   * `revoked_at`); a stream URL already issued lasts until it expires.
   *
   * @returns the grant's content and whether THIS call revoked it
   */
  async revokeGrant(
    organizationId: string,
    customerId: string,
    entitlementId: string,
    revokedByUserId: string
  ): Promise<{ contentId: string; revoked: boolean }> {
    try {
      // An array, spread into each `and()`, never a nested `and()`: one that
      // collapsed to undefined would be dropped silently and revoke every
      // live entitlement.
      const scope = [
        eq(schema.entitlements.id, entitlementId),
        eq(schema.entitlements.userId, customerId),
        eq(schema.entitlements.organizationId, organizationId),
        eq(schema.entitlements.source, GRANT),
      ];

      const [revoked] = await this.db
        .update(schema.entitlements)
        .set({ revokedAt: new Date(), revokedByUserId })
        .where(and(...scope, isNull(schema.entitlements.revokedAt)))
        .returning();

      if (revoked?.contentId) {
        return { contentId: revoked.contentId, revoked: true };
      }

      // Nothing live matched: already revoked (a no-op), or no such grant.
      const existing = await this.db.query.entitlements.findFirst({
        where: and(...scope),
        columns: { contentId: true },
      });

      if (!existing?.contentId) {
        throw new NotFoundError('Grant not found', {
          customerId,
          entitlementId,
        });
      }

      return { contentId: existing.contentId, revoked: false };
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      this.handleError(error, 'revokeGrant');
    }
  }
}
