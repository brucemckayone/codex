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
  organizations,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
} from '@codex/database/schema';
import {
  createMockStripe,
  createTestConnectAccountInput,
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
  });
});
