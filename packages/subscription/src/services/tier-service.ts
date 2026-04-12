/**
 * Tier Service
 *
 * Manages subscription tier CRUD with Stripe Product/Price sync.
 *
 * Key Responsibilities:
 * - Create, update, delete, list, and reorder subscription tiers
 * - Sync tier definitions to Stripe Products + Prices (monthly + annual)
 * - Validate org ownership and Connect account readiness
 * - Enforce business rules (no delete with active subscribers)
 *
 * Stripe Sync:
 * - On create: stripe.products.create() + 2x stripe.prices.create()
 * - On price change: new Stripe Prices (Prices are immutable), archive old
 * - On delete: archive Stripe Product
 *
 * Stripe Orphan Prevention:
 * - On create: if DB insert fails, archive the Stripe Product (deactivates its Prices)
 * - On update: if DB update fails, archive new Prices and restore old ones
 * - All Stripe create calls use idempotency keys to prevent duplicates on retries
 * - Cleanup failures are logged but never mask the original error
 *
 * All queries scoped by organizationId. Soft delete only.
 */

import { CURRENCY } from '@codex/constants';
import {
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import {
  BaseService,
  InternalServiceError,
  type ServiceConfig,
} from '@codex/service-errors';
import type { CreateTierInput, UpdateTierInput } from '@codex/validation';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  ConnectAccountNotReadyError,
  TierHasSubscribersError,
  TierNotFoundError,
} from '../errors';

type SubscriptionTier = typeof subscriptionTiers.$inferSelect;

export class TierService extends BaseService {
  private readonly stripe: Stripe;

  constructor(config: ServiceConfig, stripe: Stripe) {
    super(config);
    this.stripe = stripe;
  }

  /**
   * Create a subscription tier with Stripe Product + Prices.
   * Validates the org has an active Connect account before proceeding.
   *
   * If the DB insert fails after Stripe resources are created, the Stripe
   * Product is archived (which deactivates its Prices) to prevent orphans.
   */
  async createTier(
    orgId: string,
    input: CreateTierInput
  ): Promise<SubscriptionTier> {
    // Validate Connect account is ready
    await this.requireActiveConnect(orgId);

    try {
      // Determine next sort order — include soft-deleted rows to avoid
      // unique constraint violation on (organization_id, sort_order)
      const existingTiers = await this.db
        .select({ sortOrder: subscriptionTiers.sortOrder })
        .from(subscriptionTiers)
        .where(eq(subscriptionTiers.organizationId, orgId))
        .orderBy(sql`${subscriptionTiers.sortOrder} DESC`)
        .limit(1);

      const nextSortOrder =
        existingTiers.length > 0 ? (existingTiers[0]?.sortOrder ?? 0) + 1 : 1;

      // Generate idempotency keys to prevent duplicate Stripe resources on retries
      const idempotencyBase = crypto.randomUUID();

      // Create Stripe Product
      const product = await this.stripe.products.create(
        {
          name: input.name,
          description: input.description ?? undefined,
          metadata: {
            codex_organization_id: orgId,
            codex_type: 'subscription_tier',
          },
        },
        { idempotencyKey: `tier-product-${idempotencyBase}` }
      );

      // Create monthly + annual Stripe Prices
      const [monthlyPrice, annualPrice] = await Promise.all([
        this.stripe.prices.create(
          {
            product: product.id,
            unit_amount: input.priceMonthly,
            currency: CURRENCY.GBP,
            recurring: { interval: 'month' },
            metadata: { codex_organization_id: orgId, interval: 'month' },
          },
          { idempotencyKey: `tier-price-monthly-${idempotencyBase}` }
        ),
        this.stripe.prices.create(
          {
            product: product.id,
            unit_amount: input.priceAnnual,
            currency: CURRENCY.GBP,
            recurring: { interval: 'year' },
            metadata: { codex_organization_id: orgId, interval: 'year' },
          },
          { idempotencyKey: `tier-price-annual-${idempotencyBase}` }
        ),
      ]);

      // Insert tier record — if this fails, clean up Stripe resources
      let tier: SubscriptionTier | undefined;
      try {
        const [inserted] = await this.db
          .insert(subscriptionTiers)
          .values({
            organizationId: orgId,
            name: input.name,
            description: input.description ?? null,
            sortOrder: nextSortOrder,
            priceMonthly: input.priceMonthly,
            priceAnnual: input.priceAnnual,
            stripeProductId: product.id,
            stripePriceMonthlyId: monthlyPrice.id,
            stripePriceAnnualId: annualPrice.id,
            isActive: true,
          })
          .returning();

        tier = inserted;
      } catch (dbError) {
        // DB insert failed — archive Stripe Product to prevent orphaned resources.
        // Archiving a product deactivates it and all its prices.
        this.obs.warn(
          'DB insert failed during createTier, cleaning up Stripe product',
          {
            organizationId: orgId,
            stripeProductId: product.id,
            dbError:
              dbError instanceof Error ? dbError.message : String(dbError),
          }
        );

        try {
          await this.stripe.products.update(product.id, { active: false });
          this.obs.info('Stripe product archived after DB failure', {
            stripeProductId: product.id,
            organizationId: orgId,
          });
        } catch (cleanupError) {
          // Log cleanup failure but do not mask the original DB error
          this.obs.error('Failed to archive Stripe product during cleanup', {
            stripeProductId: product.id,
            organizationId: orgId,
            cleanupError:
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError),
          });
        }

        throw dbError;
      }

      if (!tier) {
        throw new InternalServiceError('Failed to insert tier record');
      }

      this.obs.info('Subscription tier created', {
        tierId: tier.id,
        organizationId: orgId,
        sortOrder: nextSortOrder,
      });

      return tier;
    } catch (error) {
      this.handleError(error, 'createTier');
    }
  }

  /**
   * Update a tier's name, description, or prices.
   * If prices change, creates new Stripe Prices (Prices are immutable) and archives old ones.
   *
   * If the DB update fails after Stripe state has changed, new Prices are
   * archived and old Prices are restored to prevent Stripe/DB divergence.
   */
  async updateTier(
    tierId: string,
    orgId: string,
    input: UpdateTierInput
  ): Promise<SubscriptionTier> {
    try {
      const existing = await this.getTierOrThrow(tierId, orgId);

      // Check if prices changed — need new Stripe Prices
      const monthlyChanged =
        input.priceMonthly !== undefined &&
        input.priceMonthly !== existing.priceMonthly;
      const annualChanged =
        input.priceAnnual !== undefined &&
        input.priceAnnual !== existing.priceAnnual;

      let newMonthlyPriceId = existing.stripePriceMonthlyId;
      let newAnnualPriceId = existing.stripePriceAnnualId;

      // Track which old prices were archived so we can restore them on DB failure
      let archivedOldMonthlyId: string | null = null;
      let archivedOldAnnualId: string | null = null;
      // Track newly created prices so we can archive them on DB failure
      let createdNewMonthlyId: string | null = null;
      let createdNewAnnualId: string | null = null;

      // Generate idempotency keys for Stripe create calls
      const idempotencyBase = crypto.randomUUID();

      if ((monthlyChanged || annualChanged) && existing.stripeProductId) {
        // Create new Prices (Stripe Prices are immutable)
        if (monthlyChanged && input.priceMonthly !== undefined) {
          const newPrice = await this.stripe.prices.create(
            {
              product: existing.stripeProductId,
              unit_amount: input.priceMonthly,
              currency: CURRENCY.GBP,
              recurring: { interval: 'month' },
              metadata: { codex_organization_id: orgId, interval: 'month' },
            },
            { idempotencyKey: `tier-update-price-monthly-${idempotencyBase}` }
          );
          newMonthlyPriceId = newPrice.id;
          createdNewMonthlyId = newPrice.id;

          // Archive old Price
          if (existing.stripePriceMonthlyId) {
            await this.stripe.prices.update(existing.stripePriceMonthlyId, {
              active: false,
            });
            archivedOldMonthlyId = existing.stripePriceMonthlyId;
          }
        }

        if (annualChanged && input.priceAnnual !== undefined) {
          const newPrice = await this.stripe.prices.create(
            {
              product: existing.stripeProductId,
              unit_amount: input.priceAnnual,
              currency: CURRENCY.GBP,
              recurring: { interval: 'year' },
              metadata: { codex_organization_id: orgId, interval: 'year' },
            },
            { idempotencyKey: `tier-update-price-annual-${idempotencyBase}` }
          );
          newAnnualPriceId = newPrice.id;
          createdNewAnnualId = newPrice.id;

          if (existing.stripePriceAnnualId) {
            await this.stripe.prices.update(existing.stripePriceAnnualId, {
              active: false,
            });
            archivedOldAnnualId = existing.stripePriceAnnualId;
          }
        }
      }

      // Update Stripe Product name/description if changed
      if (
        existing.stripeProductId &&
        (input.name !== undefined || input.description !== undefined)
      ) {
        await this.stripe.products.update(existing.stripeProductId, {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && {
            description: input.description ?? '',
          }),
        });
      }

      // Update DB record — if this fails, roll back Stripe price changes
      let updated: SubscriptionTier | undefined;
      try {
        const [result] = await this.db
          .update(subscriptionTiers)
          .set({
            ...(input.name !== undefined && { name: input.name }),
            ...(input.description !== undefined && {
              description: input.description ?? null,
            }),
            ...(input.priceMonthly !== undefined && {
              priceMonthly: input.priceMonthly,
            }),
            ...(input.priceAnnual !== undefined && {
              priceAnnual: input.priceAnnual,
            }),
            stripePriceMonthlyId: newMonthlyPriceId,
            stripePriceAnnualId: newAnnualPriceId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(subscriptionTiers.id, tierId),
              eq(subscriptionTiers.organizationId, orgId),
              isNull(subscriptionTiers.deletedAt)
            )
          )
          .returning();

        updated = result;
      } catch (dbError) {
        // DB update failed — roll back Stripe price changes to prevent divergence
        this.obs.warn(
          'DB update failed during updateTier, rolling back Stripe price changes',
          {
            tierId,
            organizationId: orgId,
            dbError:
              dbError instanceof Error ? dbError.message : String(dbError),
          }
        );

        await this.rollbackStripePriceChanges({
          createdNewMonthlyId,
          createdNewAnnualId,
          archivedOldMonthlyId,
          archivedOldAnnualId,
          orgId,
          tierId,
        });

        throw dbError;
      }

      if (!updated) {
        throw new TierNotFoundError(tierId, { organizationId: orgId });
      }

      this.obs.info('Subscription tier updated', {
        tierId,
        organizationId: orgId,
        priceChanged: monthlyChanged || annualChanged,
      });

      return updated;
    } catch (error) {
      this.handleError(error, 'updateTier');
    }
  }

  /**
   * Soft-delete a tier. Fails if active subscribers exist.
   * Archives the Stripe Product.
   */
  async deleteTier(tierId: string, orgId: string): Promise<void> {
    try {
      const existing = await this.getTierOrThrow(tierId, orgId);

      // Check for active subscribers
      const [subCount] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.tierId, tierId),
            sql`${subscriptions.status} NOT IN ('cancelled')`
          )
        );

      if (subCount && subCount.count > 0) {
        throw new TierHasSubscribersError(tierId, subCount.count);
      }

      // Soft delete
      await this.db
        .update(subscriptionTiers)
        .set({ deletedAt: new Date(), isActive: false })
        .where(eq(subscriptionTiers.id, tierId));

      // Archive Stripe Product
      if (existing.stripeProductId) {
        await this.stripe.products.update(existing.stripeProductId, {
          active: false,
        });
      }

      this.obs.info('Subscription tier deleted', {
        tierId,
        organizationId: orgId,
      });
    } catch (error) {
      this.handleError(error, 'deleteTier');
    }
  }

  /**
   * List active tiers for an org, ordered by sortOrder ascending.
   * Public — no auth required (used on storefront pricing page).
   */
  async listTiers(orgId: string): Promise<SubscriptionTier[]> {
    return this.db
      .select()
      .from(subscriptionTiers)
      .where(
        and(
          eq(subscriptionTiers.organizationId, orgId),
          eq(subscriptionTiers.isActive, true),
          isNull(subscriptionTiers.deletedAt)
        )
      )
      .orderBy(subscriptionTiers.sortOrder);
  }

  /**
   * List all tiers including inactive (admin view).
   */
  async listAllTiers(orgId: string): Promise<SubscriptionTier[]> {
    return this.db
      .select()
      .from(subscriptionTiers)
      .where(
        and(
          eq(subscriptionTiers.organizationId, orgId),
          isNull(subscriptionTiers.deletedAt)
        )
      )
      .orderBy(subscriptionTiers.sortOrder);
  }

  /**
   * Reorder tiers. Accepts ordered array of tier IDs.
   * New sortOrder is assigned by array index (1-based).
   */
  async reorderTiers(orgId: string, tierIds: string[]): Promise<void> {
    try {
      // Validate all IDs belong to this org
      const tiers = await this.db
        .select({ id: subscriptionTiers.id })
        .from(subscriptionTiers)
        .where(
          and(
            eq(subscriptionTiers.organizationId, orgId),
            isNull(subscriptionTiers.deletedAt)
          )
        );

      const existingIds = new Set(tiers.map((t) => t.id));
      for (const id of tierIds) {
        if (!existingIds.has(id)) {
          throw new TierNotFoundError(id, { organizationId: orgId });
        }
      }

      // Update sort orders in a single transaction.
      // Uses high-offset temp values (10000+) to avoid both the UNIQUE constraint
      // on (organizationId, sortOrder) and the CHECK constraint (sort_order > 0).
      await (this.db as typeof import('@codex/database').dbWs).transaction(
        async (tx) => {
          // Phase 1: Move all to high temp values to clear the target range
          for (const [i, tierId] of tierIds.entries()) {
            await tx
              .update(subscriptionTiers)
              .set({ sortOrder: 10000 + i + 1 })
              .where(eq(subscriptionTiers.id, tierId));
          }

          // Phase 2: Set to final values (1-based)
          for (const [i, tierId] of tierIds.entries()) {
            await tx
              .update(subscriptionTiers)
              .set({ sortOrder: i + 1, updatedAt: new Date() })
              .where(eq(subscriptionTiers.id, tierId));
          }
        }
      );

      this.obs.info('Subscription tiers reordered', {
        organizationId: orgId,
        tierCount: tierIds.length,
      });
    } catch (error) {
      this.handleError(error, 'reorderTiers');
    }
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Get a tier or throw TierNotFoundError.
   */
  private async getTierOrThrow(
    tierId: string,
    orgId: string
  ): Promise<SubscriptionTier> {
    const [tier] = await this.db
      .select()
      .from(subscriptionTiers)
      .where(
        and(
          eq(subscriptionTiers.id, tierId),
          eq(subscriptionTiers.organizationId, orgId),
          isNull(subscriptionTiers.deletedAt)
        )
      )
      .limit(1);

    if (!tier) {
      throw new TierNotFoundError(tierId, { organizationId: orgId });
    }

    return tier;
  }

  /**
   * Validate that the org has an active Stripe Connect account.
   */
  private async requireActiveConnect(orgId: string): Promise<void> {
    const [account] = await this.db
      .select({
        chargesEnabled: stripeConnectAccounts.chargesEnabled,
        payoutsEnabled: stripeConnectAccounts.payoutsEnabled,
      })
      .from(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.organizationId, orgId))
      .limit(1);

    if (!account || !account.chargesEnabled || !account.payoutsEnabled) {
      throw new ConnectAccountNotReadyError(orgId);
    }
  }

  /**
   * Roll back Stripe price changes after a DB failure in updateTier.
   *
   * - Archives newly created prices (so they don't remain active in Stripe)
   * - Restores old prices that were archived (so the original state is maintained)
   *
   * Cleanup errors are logged but never mask the original DB error.
   */
  private async rollbackStripePriceChanges(params: {
    createdNewMonthlyId: string | null;
    createdNewAnnualId: string | null;
    archivedOldMonthlyId: string | null;
    archivedOldAnnualId: string | null;
    orgId: string;
    tierId: string;
  }): Promise<void> {
    const {
      createdNewMonthlyId,
      createdNewAnnualId,
      archivedOldMonthlyId,
      archivedOldAnnualId,
      orgId,
      tierId,
    } = params;

    // Archive newly created prices
    if (createdNewMonthlyId) {
      try {
        await this.stripe.prices.update(createdNewMonthlyId, { active: false });
        this.obs.info('New monthly price archived after DB failure', {
          stripePriceId: createdNewMonthlyId,
          tierId,
          organizationId: orgId,
        });
      } catch (cleanupError) {
        this.obs.error('Failed to archive new monthly price during rollback', {
          stripePriceId: createdNewMonthlyId,
          tierId,
          organizationId: orgId,
          cleanupError:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        });
      }
    }

    if (createdNewAnnualId) {
      try {
        await this.stripe.prices.update(createdNewAnnualId, { active: false });
        this.obs.info('New annual price archived after DB failure', {
          stripePriceId: createdNewAnnualId,
          tierId,
          organizationId: orgId,
        });
      } catch (cleanupError) {
        this.obs.error('Failed to archive new annual price during rollback', {
          stripePriceId: createdNewAnnualId,
          tierId,
          organizationId: orgId,
          cleanupError:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        });
      }
    }

    // Restore old prices that were archived
    if (archivedOldMonthlyId) {
      try {
        await this.stripe.prices.update(archivedOldMonthlyId, { active: true });
        this.obs.info('Old monthly price restored after DB failure', {
          stripePriceId: archivedOldMonthlyId,
          tierId,
          organizationId: orgId,
        });
      } catch (cleanupError) {
        this.obs.error('Failed to restore old monthly price during rollback', {
          stripePriceId: archivedOldMonthlyId,
          tierId,
          organizationId: orgId,
          cleanupError:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        });
      }
    }

    if (archivedOldAnnualId) {
      try {
        await this.stripe.prices.update(archivedOldAnnualId, { active: true });
        this.obs.info('Old annual price restored after DB failure', {
          stripePriceId: archivedOldAnnualId,
          tierId,
          organizationId: orgId,
        });
      } catch (cleanupError) {
        this.obs.error('Failed to restore old annual price during rollback', {
          stripePriceId: archivedOldAnnualId,
          tierId,
          organizationId: orgId,
          cleanupError:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        });
      }
    }
  }
}
