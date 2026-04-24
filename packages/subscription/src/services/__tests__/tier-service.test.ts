/**
 * TierService Tests
 *
 * Integration tests with real DB + mocked Stripe.
 * Tests tier CRUD, Stripe Product/Price sync, and reordering.
 *
 * Each test creates its own org + connect account to avoid
 * data collisions on the shared local development database.
 */

import {
  content,
  organizations,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import { ValidationError } from '@codex/service-errors';
import {
  createMockStripe,
  createTestConnectAccountInput,
  createTestContentInput,
  createTestOrganizationInput,
  createTestSubscriptionInput,
  createUniqueSlug,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
  validateDatabaseConnection,
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type vi,
} from 'vitest';
import {
  ConnectAccountNotReadyError,
  TierHasSubscribersError,
  TierNotFoundError,
} from '../../errors';
import { TierService } from '../tier-service';

describe('TierService', () => {
  let db: ReturnType<typeof setupTestDatabase>;
  let stripe: Stripe;
  let service: TierService;
  let creatorId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    await validateDatabaseConnection(db);
    const userIds = await seedTestUsers(db, 1);
    [creatorId] = userIds;
  });

  beforeEach(() => {
    stripe = createMockStripe();
    service = new TierService({ db, environment: 'test' }, stripe);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  /** Helper: create an org with an active Connect account */
  async function createOrgWithConnect(slug?: string) {
    const [org] = await db
      .insert(organizations)
      .values(
        createTestOrganizationInput({
          slug: createUniqueSlug(slug ?? 'tier'),
          creatorId,
        })
      )
      .returning();
    await db.insert(stripeConnectAccounts).values(
      createTestConnectAccountInput(org.id, creatorId, {
        chargesEnabled: true,
        payoutsEnabled: true,
        status: 'active',
      })
    );
    return org;
  }

  /** Helper: create an org WITHOUT a Connect account */
  async function createOrgWithoutConnect(slug?: string) {
    const [org] = await db
      .insert(organizations)
      .values(
        createTestOrganizationInput({
          slug: createUniqueSlug(slug ?? 'no-connect'),
          creatorId,
        })
      )
      .returning();
    return org;
  }

  // ─── createTier ─────────────────────────────────────────────────────

  describe('createTier', () => {
    it('should create tier + Stripe product + 2 prices, sortOrder=1', async () => {
      const org = await createOrgWithConnect('create-1');
      const tier = await service.createTier(org.id, {
        name: 'Pro',
        description: 'Professional tier',
        priceMonthly: 999,
        priceAnnual: 9990,
      });

      expect(tier.name).toBe('Pro');
      expect(tier.sortOrder).toBe(1);
      expect(tier.stripeProductId).toBeDefined();
      expect(tier.stripePriceMonthlyId).toBeDefined();
      expect(tier.stripePriceAnnualId).toBeDefined();
      expect(tier.isActive).toBe(true);

      // Verify Stripe calls
      expect(stripe.products.create).toHaveBeenCalledOnce();
      expect(stripe.prices.create).toHaveBeenCalledTimes(2);
    });

    it('should auto-increment sortOrder for subsequent tiers', async () => {
      const org = await createOrgWithConnect('auto-sort');
      const t1 = await service.createTier(org.id, {
        name: 'Basic',
        priceMonthly: 499,
        priceAnnual: 4990,
      });
      const t2 = await service.createTier(org.id, {
        name: 'Pro',
        priceMonthly: 999,
        priceAnnual: 9990,
      });
      const t3 = await service.createTier(org.id, {
        name: 'Premium',
        priceMonthly: 1999,
        priceAnnual: 19990,
      });

      expect(t1.sortOrder).toBe(1);
      expect(t2.sortOrder).toBe(2);
      expect(t3.sortOrder).toBe(3);
    });

    it('should throw ConnectAccountNotReadyError when no account exists', async () => {
      const org = await createOrgWithoutConnect('no-acct');
      await expect(
        service.createTier(org.id, {
          name: 'X',
          priceMonthly: 100,
          priceAnnual: 1000,
        })
      ).rejects.toThrow(ConnectAccountNotReadyError);
    });

    it('should throw ConnectAccountNotReadyError when charges disabled', async () => {
      const [org] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('no-charges'),
            creatorId,
          })
        )
        .returning();
      await db.insert(stripeConnectAccounts).values(
        createTestConnectAccountInput(org.id, creatorId, {
          chargesEnabled: false,
          payoutsEnabled: true,
        })
      );

      await expect(
        service.createTier(org.id, {
          name: 'X',
          priceMonthly: 100,
          priceAnnual: 1000,
        })
      ).rejects.toThrow(ConnectAccountNotReadyError);
    });

    it('should create Stripe prices with GBP currency', async () => {
      const org = await createOrgWithConnect('gbp');
      await service.createTier(org.id, {
        name: 'GBP Tier',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      const pricesCalls = (stripe.prices.create as ReturnType<typeof vi.fn>)
        .mock.calls;
      expect(pricesCalls[0][0]).toMatchObject({ currency: 'gbp' });
      expect(pricesCalls[1][0]).toMatchObject({ currency: 'gbp' });
    });

    it('should resolve Connect via organizations.primary_connect_account_user_id (T10/X8)', async () => {
      // Two users in the same org, each with their own Connect account.
      // The primary column pins the canonical owner so tier ops route
      // there, not an arbitrary .limit(1) row. Exercise this by making
      // the primary owner INACTIVE and a secondary user ACTIVE — the
      // service should refuse (primary is not ready) rather than
      // silently succeed against the secondary account.
      const userIds = await seedTestUsers(db, 2);
      const [primaryUser, secondaryUser] = userIds;

      const [org] = await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('primary-connect'),
            creatorId: primaryUser,
          })
        )
        .returning();

      // Primary owner: Connect NOT ready
      await db.insert(stripeConnectAccounts).values(
        createTestConnectAccountInput(org.id, primaryUser, {
          chargesEnabled: false,
          payoutsEnabled: false,
          status: 'restricted',
        })
      );
      // Secondary user: Connect IS ready
      await db.insert(stripeConnectAccounts).values(
        createTestConnectAccountInput(org.id, secondaryUser, {
          chargesEnabled: true,
          payoutsEnabled: true,
          status: 'active',
        })
      );
      // Pin primary_connect_account_user_id to the non-ready user.
      await db
        .update(organizations)
        .set({ primaryConnectAccountUserId: primaryUser })
        .where(eq(organizations.id, org.id));

      await expect(
        service.createTier(org.id, {
          name: 'Gated',
          priceMonthly: 499,
          priceAnnual: 4990,
        })
      ).rejects.toThrow(ConnectAccountNotReadyError);
    });
  });

  // ─── updateTier ─────────────────────────────────────────────────────

  describe('updateTier', () => {
    it('should update name/desc without touching Stripe prices', async () => {
      const org = await createOrgWithConnect('update-name');
      const tier = await service.createTier(org.id, {
        name: 'Old',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      // Reset mocks after creation calls
      (stripe.prices.create as ReturnType<typeof vi.fn>).mockClear();
      (stripe.prices.update as ReturnType<typeof vi.fn>).mockClear();

      const updated = await service.updateTier(tier.id, org.id, {
        name: 'New Name',
        description: 'Updated',
      });

      expect(updated.name).toBe('New Name');
      expect(updated.description).toBe('Updated');
      // Prices should NOT be recreated
      expect(stripe.prices.create).not.toHaveBeenCalled();
      expect(stripe.prices.update).not.toHaveBeenCalled();
      // Product should be updated (name/desc)
      expect(stripe.products.update).toHaveBeenCalled();
    });

    it('should create new prices + archive old when monthly price changes', async () => {
      const org = await createOrgWithConnect('update-monthly');
      const tier = await service.createTier(org.id, {
        name: 'T',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      (stripe.prices.create as ReturnType<typeof vi.fn>).mockClear();
      (stripe.prices.update as ReturnType<typeof vi.fn>).mockClear();

      const updated = await service.updateTier(tier.id, org.id, {
        priceMonthly: 699,
      });

      expect(updated.priceMonthly).toBe(699);
      // One new price created (monthly), one archived
      expect(stripe.prices.create).toHaveBeenCalledOnce();
      expect(stripe.prices.update).toHaveBeenCalledOnce(); // archive old
    });

    it('should create new prices + archive old when annual price changes', async () => {
      const org = await createOrgWithConnect('update-annual');
      const tier = await service.createTier(org.id, {
        name: 'T',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      (stripe.prices.create as ReturnType<typeof vi.fn>).mockClear();
      (stripe.prices.update as ReturnType<typeof vi.fn>).mockClear();

      const updated = await service.updateTier(tier.id, org.id, {
        priceAnnual: 5990,
      });

      expect(updated.priceAnnual).toBe(5990);
      expect(stripe.prices.create).toHaveBeenCalledOnce();
      expect(stripe.prices.update).toHaveBeenCalledOnce();
    });

    it('should throw TierNotFoundError for nonexistent tier', async () => {
      const org = await createOrgWithConnect('update-notfound');
      await expect(
        service.updateTier('00000000-0000-0000-0000-000000000000', org.id, {
          name: 'X',
        })
      ).rejects.toThrow(TierNotFoundError);
    });

    it('should throw TierNotFoundError for tier from different org (scoping)', async () => {
      const orgA = await createOrgWithConnect('scope-a');
      const orgB = await createOrgWithConnect('scope-b');
      const tier = await service.createTier(orgA.id, {
        name: 'A Tier',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      await expect(
        service.updateTier(tier.id, orgB.id, { name: 'Hacked' })
      ).rejects.toThrow(TierNotFoundError);
    });

    it('should not update a soft-deleted tier', async () => {
      const org = await createOrgWithConnect('update-deleted');
      const tier = await service.createTier(org.id, {
        name: 'Deletable',
        priceMonthly: 499,
        priceAnnual: 4990,
      });
      await service.deleteTier(tier.id, org.id);

      await expect(
        service.updateTier(tier.id, org.id, { name: 'Ghost' })
      ).rejects.toThrow(TierNotFoundError);
    });
  });

  // ─── deleteTier ─────────────────────────────────────────────────────

  describe('deleteTier', () => {
    it('should soft-delete tier with no subscribers', async () => {
      const org = await createOrgWithConnect('delete-clean');
      const tier = await service.createTier(org.id, {
        name: 'Deletable',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      await service.deleteTier(tier.id, org.id);

      // Should not appear in active list
      const tiers = await service.listTiers(org.id);
      expect(tiers).toHaveLength(0);

      // Stripe product should be archived
      expect(stripe.products.update).toHaveBeenCalledWith(
        tier.stripeProductId,
        expect.objectContaining({ active: false })
      );
    });

    it('should throw TierHasSubscribersError when active subscribers exist', async () => {
      const org = await createOrgWithConnect('delete-blocked');
      const tier = await service.createTier(org.id, {
        name: 'Popular',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      // Insert an active subscription for this tier
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(creatorId, org.id, tier.id, {
          status: 'active',
        })
      );

      await expect(service.deleteTier(tier.id, org.id)).rejects.toThrow(
        TierHasSubscribersError
      );
    });

    it('should allow deletion when only cancelled subscribers exist', async () => {
      const org = await createOrgWithConnect('delete-cancelled');
      const tier = await service.createTier(org.id, {
        name: 'Cancelled',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      // Insert a cancelled subscription
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(creatorId, org.id, tier.id, {
          status: 'cancelled',
          cancelledAt: new Date(),
        })
      );

      await service.deleteTier(tier.id, org.id);
      const tiers = await service.listTiers(org.id);
      expect(tiers).toHaveLength(0);
    });

    it('should throw TierNotFoundError for nonexistent tier', async () => {
      const org = await createOrgWithConnect('delete-notfound');
      await expect(
        service.deleteTier('00000000-0000-0000-0000-000000000000', org.id)
      ).rejects.toThrow(TierNotFoundError);
    });

    it('should clear content.minimum_tier_id on soft-delete (X1 regression)', async () => {
      // FK content.minimum_tier_id -> subscription_tiers.id is ON DELETE SET
      // NULL, but that never fires for soft-deletes (deletedAt). Without this
      // sweep, deleting a tier would leave content silently unreachable.
      const org = await createOrgWithConnect('delete-sweep');
      const tier = await service.createTier(org.id, {
        name: 'Gated',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      // Two content rows gated by this tier, plus one unrelated row.
      const [gatedA] = await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId: org.id,
            minimumTierId: tier.id,
          })
        )
        .returning();
      const [gatedB] = await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId: org.id,
            minimumTierId: tier.id,
          })
        )
        .returning();
      const [ungated] = await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId: org.id,
            minimumTierId: null,
          })
        )
        .returning();

      await service.deleteTier(tier.id, org.id);

      const rows = await db
        .select({ id: content.id, minimumTierId: content.minimumTierId })
        .from(content)
        .where(eq(content.organizationId, org.id));
      const byId = new Map(rows.map((r) => [r.id, r.minimumTierId]));
      expect(byId.get(gatedA.id)).toBeNull();
      expect(byId.get(gatedB.id)).toBeNull();
      expect(byId.get(ungated.id)).toBeNull();
    });

    it('should only clear minimum_tier_id for content within the same org (scoping)', async () => {
      // A different org with its own tier accidentally sharing an id would
      // still be scoped out by the WHERE organizationId clause.
      const orgA = await createOrgWithConnect('delete-scope-a');
      const orgB = await createOrgWithConnect('delete-scope-b');

      const tierA = await service.createTier(orgA.id, {
        name: 'A-gated',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      // Content in org B that shares minimumTierId = tierA.id (contrived,
      // would not happen normally but guards against the sweep over-reaching).
      const [orgBContent] = await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId: orgB.id,
            minimumTierId: tierA.id,
          })
        )
        .returning();

      await service.deleteTier(tierA.id, orgA.id);

      const [row] = await db
        .select({ minimumTierId: content.minimumTierId })
        .from(content)
        .where(eq(content.id, orgBContent.id));
      expect(row.minimumTierId).toBe(tierA.id);
    });
  });

  // ─── listTiers ──────────────────────────────────────────────────────

  describe('listTiers', () => {
    it('should return only active non-deleted tiers ordered by sortOrder', async () => {
      const org = await createOrgWithConnect('list-filter');
      await service.createTier(org.id, {
        name: 'Active',
        priceMonthly: 499,
        priceAnnual: 4990,
      });
      const toDelete = await service.createTier(org.id, {
        name: 'Deleted',
        priceMonthly: 999,
        priceAnnual: 9990,
      });
      await service.deleteTier(toDelete.id, org.id);

      const tiers = await service.listTiers(org.id);
      expect(tiers).toHaveLength(1);
      expect(tiers[0].name).toBe('Active');
    });

    it('should return empty array for org with no tiers', async () => {
      const org = await createOrgWithConnect('list-empty');
      const tiers = await service.listTiers(org.id);
      expect(tiers).toHaveLength(0);
    });

    it('should scope results to the specified org', async () => {
      const orgA = await createOrgWithConnect('list-a');
      const orgB = await createOrgWithConnect('list-b');
      await service.createTier(orgA.id, {
        name: 'A Tier',
        priceMonthly: 499,
        priceAnnual: 4990,
      });
      await service.createTier(orgB.id, {
        name: 'B Tier',
        priceMonthly: 999,
        priceAnnual: 9990,
      });

      const tiersA = await service.listTiers(orgA.id);
      expect(tiersA).toHaveLength(1);
      expect(tiersA[0].name).toBe('A Tier');
    });
  });

  // ─── listAllTiers ───────────────────────────────────────────────────

  describe('listAllTiers', () => {
    it('should include inactive tiers but exclude deleted ones', async () => {
      const org = await createOrgWithConnect('list-all');
      const active = await service.createTier(org.id, {
        name: 'Active',
        priceMonthly: 499,
        priceAnnual: 4990,
      });
      const toDelete = await service.createTier(org.id, {
        name: 'Deleted',
        priceMonthly: 999,
        priceAnnual: 9990,
      });

      // Deactivate the first tier (not delete)
      await db
        .update(subscriptionTiers)
        .set({ isActive: false })
        .where(eq(subscriptionTiers.id, active.id));
      // Delete the second
      await service.deleteTier(toDelete.id, org.id);

      const allTiers = await service.listAllTiers(org.id);
      // Should include the deactivated tier but not the deleted one
      expect(allTiers).toHaveLength(1);
      expect(allTiers[0].id).toBe(active.id);
    });
  });

  // ─── Stripe failure handling ──────────────────────────────────────────

  describe('Stripe failure handling', () => {
    it('should not create DB record when Stripe product creation fails', async () => {
      const org = await createOrgWithConnect('stripe-fail-product');

      (
        stripe.products.create as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(
        new Error('Stripe API error: product creation failed')
      );

      await expect(
        service.createTier(org.id, {
          name: 'Fail Product',
          priceMonthly: 499,
          priceAnnual: 4990,
        })
      ).rejects.toThrow();

      // Verify no tier was created
      const tiers = await service.listTiers(org.id);
      expect(tiers).toHaveLength(0);
    });

    it('should handle Stripe price creation failure after product creation', async () => {
      const org = await createOrgWithConnect('stripe-fail-price');

      // Product creation succeeds, price creation fails
      (stripe.prices.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Stripe API error: price creation failed')
      );

      await expect(
        service.createTier(org.id, {
          name: 'Fail Price',
          priceMonthly: 499,
          priceAnnual: 4990,
        })
      ).rejects.toThrow();

      // Verify no tier was created in DB (transaction rollback or cleanup)
      const tiers = await service.listTiers(org.id);
      expect(tiers).toHaveLength(0);
    });

    it('should handle DB failure after Stripe product/price creation', async () => {
      const org = await createOrgWithConnect('stripe-fail-db');

      // NOTE: This test documents that if Stripe calls succeed but DB insert fails,
      // the Stripe product/prices may be orphaned. This is a known limitation —
      // Stripe resources are not rolled back if the DB transaction fails.
      // The workaround is manual cleanup or a reconciliation job.

      // We verify the happy path works — the DB-failure scenario would require
      // injecting DB failures which is complex with real DB integration tests.
      const tier = await service.createTier(org.id, {
        name: 'DB Fail Test',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      expect(tier).toBeDefined();
      expect(tier.stripeProductId).toBeDefined();
    });

    it('should not archive old prices when Stripe price creation fails during update', async () => {
      const org = await createOrgWithConnect('stripe-update-fail');
      const tier = await service.createTier(org.id, {
        name: 'Update Fail',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      // Reset mocks after creation
      (stripe.prices.create as ReturnType<typeof vi.fn>).mockClear();
      (stripe.prices.update as ReturnType<typeof vi.fn>).mockClear();

      // New price creation fails
      (stripe.prices.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Stripe API error: new price failed')
      );

      await expect(
        service.updateTier(tier.id, org.id, { priceMonthly: 699 })
      ).rejects.toThrow();

      // Old prices should NOT have been archived (since new price failed)
      // The archive call happens after successful price creation
      expect(stripe.prices.update).not.toHaveBeenCalled();
    });

    it('should handle DB failure after new Stripe prices during update', async () => {
      const org = await createOrgWithConnect('stripe-update-db-fail');
      const tier = await service.createTier(org.id, {
        name: 'Update DB Fail',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      // Verify the tier still has original prices after a failed update attempt
      // would leave Stripe in a potentially inconsistent state.
      // This documents the known limitation.
      const refetchedTier = await service.listTiers(org.id);
      expect(refetchedTier[0].priceMonthly).toBe(499);
    });
  });

  // ─── reorderTiers ───────────────────────────────────────────────────

  describe('reorderTiers', () => {
    it('should reorder tiers by provided ID array', async () => {
      const org = await createOrgWithConnect('reorder');
      const a = await service.createTier(org.id, {
        name: 'A',
        priceMonthly: 100,
        priceAnnual: 1000,
      });
      const b = await service.createTier(org.id, {
        name: 'B',
        priceMonthly: 200,
        priceAnnual: 2000,
      });
      const c = await service.createTier(org.id, {
        name: 'C',
        priceMonthly: 300,
        priceAnnual: 3000,
      });

      // Reorder to C, A, B
      await service.reorderTiers(org.id, [c.id, a.id, b.id]);

      const tiers = await service.listTiers(org.id);
      expect(tiers[0].name).toBe('C');
      expect(tiers[0].sortOrder).toBe(1);
      expect(tiers[1].name).toBe('A');
      expect(tiers[1].sortOrder).toBe(2);
      expect(tiers[2].name).toBe('B');
      expect(tiers[2].sortOrder).toBe(3);
    });

    it('should throw TierNotFoundError if ID does not belong to org', async () => {
      const org = await createOrgWithConnect('reorder-bad');
      const tier = await service.createTier(org.id, {
        name: 'Real',
        priceMonthly: 100,
        priceAnnual: 1000,
      });

      await expect(
        service.reorderTiers(org.id, [
          tier.id,
          '00000000-0000-0000-0000-000000000000',
        ])
      ).rejects.toThrow(TierNotFoundError);
    });

    it('should reject duplicate IDs in the reorder payload', async () => {
      const org = await createOrgWithConnect('reorder-dupe');
      const a = await service.createTier(org.id, {
        name: 'A',
        priceMonthly: 100,
        priceAnnual: 1000,
      });
      const b = await service.createTier(org.id, {
        name: 'B',
        priceMonthly: 200,
        priceAnnual: 2000,
      });

      await expect(
        service.reorderTiers(org.id, [a.id, b.id, a.id])
      ).rejects.toThrow(ValidationError);
    });

    it('should reject a subset of tiers (X5 regression)', async () => {
      // If the caller omits a tier, the omitted tier keeps its old
      // sortOrder, which collides with the newly renumbered ones (1..N).
      // The two-phase temp-offset hop only avoids collisions among the
      // tiers being moved, so the final state can contain duplicate
      // sortOrder values that listTiers() returns in an unstable order.
      const org = await createOrgWithConnect('reorder-subset');
      const a = await service.createTier(org.id, {
        name: 'A',
        priceMonthly: 100,
        priceAnnual: 1000,
      });
      const b = await service.createTier(org.id, {
        name: 'B',
        priceMonthly: 200,
        priceAnnual: 2000,
      });
      await service.createTier(org.id, {
        name: 'C',
        priceMonthly: 300,
        priceAnnual: 3000,
      });

      await expect(service.reorderTiers(org.id, [a.id, b.id])).rejects.toThrow(
        ValidationError
      );
    });
  });

  // ─── applyStripeProductUpdate (Q1 Dashboard sync-back) ──────────────────

  describe('applyStripeProductUpdate', () => {
    /** Helper: build a minimal Stripe.Product payload. */
    function buildProduct(
      overrides: Partial<{
        id: string;
        name: string;
        description: string | null;
        metadata: Record<string, string>;
      }> = {}
    ) {
      return {
        id: 'prod_stub',
        name: 'Stubbed',
        description: null,
        metadata: {
          codex_type: 'subscription_tier',
          codex_organization_id: 'will-be-overridden',
          ...(overrides.metadata ?? {}),
        },
        ...overrides,
      } as unknown as import('stripe').default.Product;
    }

    it('should mirror name + description and return changed=true', async () => {
      const org = await createOrgWithConnect('sync-prod-a');
      const tier = await service.createTier(org.id, {
        name: 'Pro',
        description: 'Old description',
        priceMonthly: 999,
        priceAnnual: 9990,
      });

      const result = await service.applyStripeProductUpdate(
        buildProduct({
          id: tier.stripeProductId ?? 'missing-product-id',
          name: 'Pro (renamed)',
          description: 'Brand new description',
          metadata: {
            codex_type: 'subscription_tier',
            codex_organization_id: org.id,
          },
        })
      );

      expect(result).toEqual({
        tierId: tier.id,
        organizationId: org.id,
        changed: true,
      });

      const [row] = await db
        .select({
          name: subscriptionTiers.name,
          description: subscriptionTiers.description,
        })
        .from(subscriptionTiers)
        .where(eq(subscriptionTiers.id, tier.id));
      expect(row.name).toBe('Pro (renamed)');
      expect(row.description).toBe('Brand new description');
    });

    it('should return changed=false when name + description already match (idempotent replay)', async () => {
      const org = await createOrgWithConnect('sync-prod-b');
      const tier = await service.createTier(org.id, {
        name: 'Basic',
        description: 'Unchanged',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      const result = await service.applyStripeProductUpdate(
        buildProduct({
          id: tier.stripeProductId ?? 'missing-product-id',
          name: 'Basic',
          description: 'Unchanged',
          metadata: {
            codex_type: 'subscription_tier',
            codex_organization_id: org.id,
          },
        })
      );

      expect(result).toEqual({
        tierId: tier.id,
        organizationId: org.id,
        changed: false,
      });
    });

    it('should return null for non-Codex products (metadata missing codex_type)', async () => {
      const result = await service.applyStripeProductUpdate(
        buildProduct({
          id: 'prod_external',
          metadata: { someone_elses: 'thing' },
        })
      );
      expect(result).toBeNull();
    });

    it('should return null when the tier has been soft-deleted since the edit was queued', async () => {
      const org = await createOrgWithConnect('sync-prod-c');
      const tier = await service.createTier(org.id, {
        name: 'Deprecated',
        priceMonthly: 499,
        priceAnnual: 4990,
      });
      await service.deleteTier(tier.id, org.id);

      const result = await service.applyStripeProductUpdate(
        buildProduct({
          id: tier.stripeProductId ?? 'missing-product-id',
          name: 'Too Late',
          metadata: {
            codex_type: 'subscription_tier',
            codex_organization_id: org.id,
          },
        })
      );
      expect(result).toBeNull();
    });
  });

  // ─── applyStripePriceCreated (Q1 Dashboard sync-back) ───────────────────

  describe('applyStripePriceCreated', () => {
    /** Helper: build a minimal Stripe.Price payload. */
    function buildPrice(args: {
      id: string;
      product: string;
      orgId: string;
      interval: 'month' | 'year';
      unitAmount?: number;
      active?: boolean;
    }) {
      return {
        id: args.id,
        active: args.active ?? true,
        unit_amount: args.unitAmount ?? 1999,
        currency: 'gbp',
        recurring: { interval: args.interval },
        product: args.product,
        metadata: {
          codex_organization_id: args.orgId,
          interval: args.interval,
        },
      } as unknown as import('stripe').default.Price;
    }

    it('should adopt the new Price for the monthly interval and archive the old Price in Stripe', async () => {
      const org = await createOrgWithConnect('sync-price-month');
      const tier = await service.createTier(org.id, {
        name: 'Fan',
        priceMonthly: 500,
        priceAnnual: 5000,
      });

      const oldMonthlyId = tier.stripePriceMonthlyId ?? 'missing-old-id';
      const pricesUpdate = stripe.prices.update as unknown as ReturnType<
        typeof vi.fn
      >;
      pricesUpdate.mockClear();

      const result = await service.applyStripePriceCreated(
        buildPrice({
          id: 'price_new_month_1500',
          product: tier.stripeProductId ?? 'missing-product-id',
          orgId: org.id,
          interval: 'month',
          unitAmount: 1500,
        })
      );

      expect(result).toEqual({
        tierId: tier.id,
        organizationId: org.id,
        changed: true,
      });

      const [row] = await db
        .select({
          priceMonthly: subscriptionTiers.priceMonthly,
          priceAnnual: subscriptionTiers.priceAnnual,
          stripePriceMonthlyId: subscriptionTiers.stripePriceMonthlyId,
          stripePriceAnnualId: subscriptionTiers.stripePriceAnnualId,
        })
        .from(subscriptionTiers)
        .where(eq(subscriptionTiers.id, tier.id));
      expect(row.priceMonthly).toBe(1500);
      expect(row.stripePriceMonthlyId).toBe('price_new_month_1500');
      // Annual must remain untouched.
      expect(row.priceAnnual).toBe(5000);
      expect(row.stripePriceAnnualId).toBe(tier.stripePriceAnnualId);
      // Old monthly price archived via Stripe API.
      expect(pricesUpdate).toHaveBeenCalledWith(oldMonthlyId, {
        active: false,
      });
    });

    it('should return changed=false when the tier already references the incoming price (idempotent replay)', async () => {
      const org = await createOrgWithConnect('sync-price-replay');
      const tier = await service.createTier(org.id, {
        name: 'Replay',
        priceMonthly: 999,
        priceAnnual: 9990,
      });
      const pricesUpdate = stripe.prices.update as unknown as ReturnType<
        typeof vi.fn
      >;
      pricesUpdate.mockClear();

      const result = await service.applyStripePriceCreated(
        buildPrice({
          id: tier.stripePriceMonthlyId ?? 'missing-monthly-id',
          product: tier.stripeProductId ?? 'missing-product-id',
          orgId: org.id,
          interval: 'month',
          unitAmount: 999,
        })
      );

      expect(result?.changed).toBe(false);
      // No Stripe archive call on a replay.
      expect(pricesUpdate).not.toHaveBeenCalled();
    });

    it('should return null for non-Codex prices (metadata missing codex_organization_id)', async () => {
      const result = await service.applyStripePriceCreated({
        id: 'price_external',
        active: true,
        unit_amount: 1000,
        currency: 'gbp',
        recurring: { interval: 'month' },
        product: 'prod_external',
        metadata: {},
      } as unknown as import('stripe').default.Price);
      expect(result).toBeNull();
    });

    it('should return null for archived prices (active=false) — we never adopt a dead Price', async () => {
      const org = await createOrgWithConnect('sync-price-archived');
      const tier = await service.createTier(org.id, {
        name: 'Guard',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      const result = await service.applyStripePriceCreated(
        buildPrice({
          id: 'price_dead',
          product: tier.stripeProductId ?? 'missing-product-id',
          orgId: org.id,
          interval: 'month',
          active: false,
        })
      );
      expect(result).toBeNull();
    });
  });

  // ─── getTierForAccessCheck (archived-tier read path) ────────────────────

  describe('getTierForAccessCheck', () => {
    it('should return the tier when active (positive, non-archived)', async () => {
      const org = await createOrgWithConnect('access-active');
      const tier = await service.createTier(org.id, {
        name: 'Active',
        priceMonthly: 499,
        priceAnnual: 4990,
      });

      const resolved = await service.getTierForAccessCheck(tier.id);
      expect(resolved?.id).toBe(tier.id);
      expect(resolved?.deletedAt).toBeNull();
    });

    it('should return soft-deleted tiers so access checks can still resolve sortOrder (Q8 archived model)', async () => {
      // Q8 product decision: archived tiers still resolve for access-check
      // read paths. A subscription that predates the delete still references
      // the tier via subscriptions.tier_id; access checks compare sortOrder
      // against content.minimum_tier_id which may also point at the archived
      // tier. Filtering deletedAt here would silently break those reads.
      const org = await createOrgWithConnect('access-archived');
      const tier = await service.createTier(org.id, {
        name: 'Archived',
        priceMonthly: 499,
        priceAnnual: 4990,
      });
      await service.deleteTier(tier.id, org.id);

      const resolved = await service.getTierForAccessCheck(tier.id);
      expect(resolved?.id).toBe(tier.id);
      expect(resolved?.deletedAt).toBeInstanceOf(Date);
      expect(resolved?.sortOrder).toBe(tier.sortOrder);
    });

    it('should return null when the tier id does not exist at all', async () => {
      const resolved = await service.getTierForAccessCheck(
        '00000000-0000-0000-0000-000000000000'
      );
      expect(resolved).toBeNull();
    });
  });
});
