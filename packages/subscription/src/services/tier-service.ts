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
 * All queries scoped by organizationId. Soft delete only.
 */

import { CURRENCY } from '@codex/constants';
import {
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import { BaseService, type ServiceConfig } from '@codex/service-errors';
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
   */
  async createTier(
    orgId: string,
    input: CreateTierInput
  ): Promise<SubscriptionTier> {
    // Validate Connect account is ready
    await this.requireActiveConnect(orgId);

    try {
      // Determine next sort order
      const existingTiers = await this.db
        .select({ sortOrder: subscriptionTiers.sortOrder })
        .from(subscriptionTiers)
        .where(
          and(
            eq(subscriptionTiers.organizationId, orgId),
            isNull(subscriptionTiers.deletedAt)
          )
        )
        .orderBy(sql`${subscriptionTiers.sortOrder} DESC`)
        .limit(1);

      const nextSortOrder =
        existingTiers.length > 0 ? (existingTiers[0]?.sortOrder ?? 0) + 1 : 1;

      // Create Stripe Product
      const product = await this.stripe.products.create({
        name: input.name,
        description: input.description ?? undefined,
        metadata: {
          codex_organization_id: orgId,
          codex_type: 'subscription_tier',
        },
      });

      // Create monthly + annual Stripe Prices
      const [monthlyPrice, annualPrice] = await Promise.all([
        this.stripe.prices.create({
          product: product.id,
          unit_amount: input.priceMonthly,
          currency: CURRENCY.GBP,
          recurring: { interval: 'month' },
          metadata: { codex_organization_id: orgId, interval: 'month' },
        }),
        this.stripe.prices.create({
          product: product.id,
          unit_amount: input.priceAnnual,
          currency: CURRENCY.GBP,
          recurring: { interval: 'year' },
          metadata: { codex_organization_id: orgId, interval: 'year' },
        }),
      ]);

      // Insert tier record
      const [tier] = await this.db
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

      if (!tier) {
        throw new Error('Failed to insert tier record');
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

      if ((monthlyChanged || annualChanged) && existing.stripeProductId) {
        // Create new Prices (Stripe Prices are immutable)
        if (monthlyChanged && input.priceMonthly !== undefined) {
          const newPrice = await this.stripe.prices.create({
            product: existing.stripeProductId,
            unit_amount: input.priceMonthly,
            currency: CURRENCY.GBP,
            recurring: { interval: 'month' },
            metadata: { codex_organization_id: orgId, interval: 'month' },
          });
          newMonthlyPriceId = newPrice.id;

          // Archive old Price
          if (existing.stripePriceMonthlyId) {
            await this.stripe.prices.update(existing.stripePriceMonthlyId, {
              active: false,
            });
          }
        }

        if (annualChanged && input.priceAnnual !== undefined) {
          const newPrice = await this.stripe.prices.create({
            product: existing.stripeProductId,
            unit_amount: input.priceAnnual,
            currency: CURRENCY.GBP,
            recurring: { interval: 'year' },
            metadata: { codex_organization_id: orgId, interval: 'year' },
          });
          newAnnualPriceId = newPrice.id;

          if (existing.stripePriceAnnualId) {
            await this.stripe.prices.update(existing.stripePriceAnnualId, {
              active: false,
            });
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

      // Update DB record
      const [updated] = await this.db
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
}
