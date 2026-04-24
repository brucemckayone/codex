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
  content,
  organizations,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import {
  BaseService,
  InternalServiceError,
  type ServiceConfig,
  ValidationError,
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
   * Ensure only one tier per org is recommended.
   * Clears isRecommended on all other active tiers for the org.
   * Called INSIDE a transaction with the insert/update to prevent race conditions.
   */
  private async ensureSingleRecommended(
    tx: Parameters<
      Parameters<typeof import('@codex/database')['dbWs']['transaction']>[0]
    >[0],
    orgId: string,
    excludeTierId?: string
  ): Promise<void> {
    const conditions = [
      eq(subscriptionTiers.organizationId, orgId),
      eq(subscriptionTiers.isRecommended, true),
      isNull(subscriptionTiers.deletedAt),
    ];

    if (excludeTierId) {
      conditions.push(sql`${subscriptionTiers.id} != ${excludeTierId}`);
    }

    await tx
      .update(subscriptionTiers)
      .set({ isRecommended: false, updatedAt: new Date() })
      .where(and(...conditions));
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
      const tierValues = {
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
        isRecommended: input.isRecommended ?? false,
      };

      try {
        if (input.isRecommended) {
          // Atomically clear other recommended flags + insert new tier
          await (this.db as typeof import('@codex/database').dbWs).transaction(
            async (tx) => {
              await this.ensureSingleRecommended(tx, orgId);
              const [inserted] = await tx
                .insert(subscriptionTiers)
                .values(tierValues)
                .returning();
              tier = inserted;
            }
          );
        } else {
          const [inserted] = await this.db
            .insert(subscriptionTiers)
            .values(tierValues)
            .returning();
          tier = inserted;
        }
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
      const updateSet = {
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
        ...(input.isRecommended !== undefined && {
          isRecommended: input.isRecommended,
        }),
        stripePriceMonthlyId: newMonthlyPriceId,
        stripePriceAnnualId: newAnnualPriceId,
        updatedAt: new Date(),
      };
      const updateWhere = and(
        eq(subscriptionTiers.id, tierId),
        eq(subscriptionTiers.organizationId, orgId),
        isNull(subscriptionTiers.deletedAt)
      );

      try {
        if (input.isRecommended === true) {
          // Atomically clear other recommended flags + update this tier
          await (this.db as typeof import('@codex/database').dbWs).transaction(
            async (tx) => {
              await this.ensureSingleRecommended(tx, orgId, tierId);
              const [result] = await tx
                .update(subscriptionTiers)
                .set(updateSet)
                .where(updateWhere)
                .returning();
              updated = result;
            }
          );
        } else {
          const [result] = await this.db
            .update(subscriptionTiers)
            .set(updateSet)
            .where(updateWhere)
            .returning();
          updated = result;
        }
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
   *
   * The FK content.minimum_tier_id → subscription_tiers.id is
   * ON DELETE SET NULL, but soft deletes don't fire the trigger. Without
   * sweeping the reference column explicitly, any content gated by the
   * deleted tier becomes unreachable: listTiers no longer returns the
   * tier, so nobody can subscribe to it, but access control still
   * compares content.minimum_tier_id against a dangling row.
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

      // Tier soft-delete + content sweep must atomically succeed or fail.
      // A partial state (tier gone, content still gated) is the exact bug
      // this sweep is here to fix.
      let affectedContentCount = 0;
      await (this.db as typeof import('@codex/database').dbWs).transaction(
        async (tx) => {
          await tx
            .update(subscriptionTiers)
            .set({
              deletedAt: new Date(),
              isActive: false,
              isRecommended: false,
            })
            .where(eq(subscriptionTiers.id, tierId));

          const cleared = await tx
            .update(content)
            .set({ minimumTierId: null })
            .where(
              and(
                eq(content.minimumTierId, tierId),
                eq(content.organizationId, orgId)
              )
            )
            .returning({ id: content.id });
          affectedContentCount = cleared.length;
        }
      );

      // Archive Stripe Product after the DB transaction commits so a Stripe
      // 500 doesn't leave us with an orphaned deletedAt in the DB (the
      // service caller can retry the whole delete idempotently).
      if (existing.stripeProductId) {
        await this.stripe.products.update(existing.stripeProductId, {
          active: false,
        });
      }

      if (affectedContentCount > 0) {
        this.obs.warn(
          'Cleared minimum_tier_id on content gated by deleted tier',
          {
            tierId,
            organizationId: orgId,
            affectedContentCount,
          }
        );
      }

      this.obs.info('Subscription tier deleted', {
        tierId,
        organizationId: orgId,
        affectedContentCount,
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
   *
   * The caller MUST supply every non-deleted tier for the org. A partial
   * list leaves the omitted tiers with their old sortOrder, colliding
   * with the freshly renumbered ones from position 1 upward — the UNIQUE
   * constraint on (organizationId, sortOrder) can accept these because
   * the two-phase temp-offset hop only resolves collisions among the
   * tiers being renumbered.
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
      const providedIds = new Set(tierIds);

      if (providedIds.size !== tierIds.length) {
        throw new ValidationError('Duplicate tier IDs in reorder payload', {
          tierCount: tierIds.length,
          uniqueCount: providedIds.size,
        });
      }

      for (const id of tierIds) {
        if (!existingIds.has(id)) {
          throw new TierNotFoundError(id, { organizationId: orgId });
        }
      }

      if (providedIds.size !== existingIds.size) {
        throw new ValidationError(
          'Reorder must include every tier in the organisation',
          {
            organizationId: orgId,
            provided: providedIds.size,
            expected: existingIds.size,
          }
        );
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

  /**
   * Resolve a tier by id for an access-check or historic read path,
   * **including soft-deleted (archived) tiers**.
   *
   * Use this for:
   * - Access control (content.minimum_tier_id may point at an archived tier
   *   that active subscribers still reference via subscriptions.tier_id)
   * - Subscription → tier joins in notification/email/reporting paths
   * - Any read where the caller must resolve historic tier metadata (name,
   *   sortOrder, prices) rather than a mutable target
   *
   * Do NOT use for write paths (create / update / delete / new checkout).
   * Those must use the strict private `getTierOrThrow` helper so a
   * soft-deleted tier cannot silently receive new subscriptions or mutations.
   *
   * Returns null when the tier does not exist at all. Archived tiers still
   * resolve.
   */
  async getTierForAccessCheck(
    tierId: string
  ): Promise<SubscriptionTier | null> {
    const [tier] = await this.db
      .select()
      .from(subscriptionTiers)
      .where(eq(subscriptionTiers.id, tierId))
      .limit(1);

    return tier ?? null;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Resolve a tier for a **write path** (update / delete). Throws
   * TierNotFoundError if the tier is missing, belongs to another org, or
   * has been soft-deleted.
   *
   * Read paths that must resolve archived tiers (access checks, historic
   * joins, notification metadata) MUST use the public `getTierForAccessCheck`
   * method instead — it deliberately omits the deletedAt filter.
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
   *
   * Resolves through `organizations.primary_connect_account_user_id` so
   * orgs with multiple Connect accounts (one per user) have a single
   * canonical source of truth. Falls back to the oldest active account
   * only when the primary is not yet set — a safety net for orgs that
   * onboarded before the canonical column was populated.
   */
  private async requireActiveConnect(orgId: string): Promise<void> {
    const [org] = await this.db
      .select({
        primaryConnectAccountUserId: organizations.primaryConnectAccountUserId,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    const primaryUserId = org?.primaryConnectAccountUserId ?? null;

    const [account] = primaryUserId
      ? await this.db
          .select({
            chargesEnabled: stripeConnectAccounts.chargesEnabled,
            payoutsEnabled: stripeConnectAccounts.payoutsEnabled,
          })
          .from(stripeConnectAccounts)
          .where(
            and(
              eq(stripeConnectAccounts.organizationId, orgId),
              eq(stripeConnectAccounts.userId, primaryUserId)
            )
          )
          .limit(1)
      : await this.db
          .select({
            chargesEnabled: stripeConnectAccounts.chargesEnabled,
            payoutsEnabled: stripeConnectAccounts.payoutsEnabled,
          })
          .from(stripeConnectAccounts)
          .where(eq(stripeConnectAccounts.organizationId, orgId))
          .orderBy(stripeConnectAccounts.createdAt)
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
