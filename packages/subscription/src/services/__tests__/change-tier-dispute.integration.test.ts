/**
 * A tier change, and its preview, are refused while a chargeback holds the
 * subscription (Codex-2hxff.60, owner decision 2026-10-24, Q4b).
 *
 * While `disputed_at` is set the subscription's access and billing are paused.
 * The account page hides Change Plan, but the org pricing page still offers a
 * tier change, and an upgrade would invoice at once. So the service refuses it
 * with a 409 before Stripe is touched, and refuses the preview the same way,
 * so the subscriber is told before confirming a price. A won dispute (the
 * mark cleared) lets both through again.
 *
 * Real DB. Every row hangs off this file's own organisation and subscriber,
 * and is deleted in afterAll.
 */

import {
  organizations,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import { ConflictError } from '@codex/service-errors';
import {
  createMockStripe,
  createTestMoneyDeps,
  createTestOrganizationInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
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
  vi,
} from 'vitest';
import { SubscriptionService } from '../subscription-service';

describe('changeTier while a payment dispute is open (Codex-2hxff.60)', () => {
  let db: Database;
  let stripe: Stripe;
  let service: SubscriptionService;
  let subscriberId: string;
  let orgId: string;
  let tierId: string;
  let upperTierId: string;
  let subscriptionId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    [subscriberId] = await seedTestUsers(db, 1);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('tier-dispute'),
          })
        )
        .returning()
    ).id;
    tierId = takeFirst(
      await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(orgId, { sortOrder: 1 }))
        .returning()
    ).id;
    upperTierId = takeFirst(
      await db
        .insert(subscriptionTiers)
        .values(
          createTestTierInput(orgId, {
            sortOrder: 2,
            priceMonthly: 999,
            priceAnnual: 9990,
          })
        )
        .returning()
    ).id;
    subscriptionId = takeFirst(
      await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(subscriberId, orgId, tierId, {
            disputedAt: new Date(),
          })
        )
        .returning()
    ).id;
  });

  beforeEach(() => {
    stripe = createMockStripe();
    service = new SubscriptionService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      stripe
    );
  });

  // Subscriptions restrict their user, organisation and tier, so go first.
  afterAll(async () => {
    await db
      .delete(subscriptions)
      .where(eq(subscriptions.userId, subscriberId));
    await db
      .delete(subscriptionTiers)
      .where(eq(subscriptionTiers.organizationId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(users).where(eq(users.id, subscriberId));
    await teardownTestDatabase();
  });

  async function storedTier(): Promise<string> {
    return takeFirst(
      await db
        .select({ tierId: subscriptions.tierId })
        .from(subscriptions)
        .where(eq(subscriptions.id, subscriptionId))
    ).tierId;
  }

  /** What `previewTierChange` reads from Stripe's invoice preview. */
  function stubCreatePreview(): ReturnType<typeof vi.fn> {
    const createPreview = vi.fn().mockResolvedValue({
      amount_due: 500,
      lines: { data: [] },
    });
    (stripe as unknown as { invoices: unknown }).invoices = { createPreview };
    return createPreview;
  }

  /** The 409 both calls give, with a client-facing context free of dates. */
  function expectDisputedConflict(refused: unknown): void {
    expect(refused).toBeInstanceOf(ConflictError);
    const conflict = refused as ConflictError;
    expect(conflict.statusCode).toBe(409);
    // The context is sent to the client as `details`.
    expect(conflict.context).toEqual({
      code: 'SUBSCRIPTION_DISPUTED',
      organizationId: orgId,
    });
  }

  describe('while disputed', () => {
    it('the preview is refused with a 409 before Stripe is asked for a price', async () => {
      const createPreview = stubCreatePreview();

      const refused = await service
        .previewTierChange(subscriberId, orgId, upperTierId, 'month')
        .catch((error: unknown) => error);

      expectDisputedConflict(refused);
      expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(createPreview).not.toHaveBeenCalled();
    });

    it('the change is refused with a 409: Stripe untouched, the row unchanged', async () => {
      const refused = await service
        .changeTier(subscriberId, orgId, upperTierId, 'month')
        .catch((error: unknown) => error);

      expectDisputedConflict(refused);
      expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
      expect(await storedTier()).toBe(tierId);
    });
  });

  describe('once the dispute is won (the mark cleared)', () => {
    beforeAll(async () => {
      await db
        .update(subscriptions)
        .set({ disputedAt: null })
        .where(eq(subscriptions.id, subscriptionId));
    });

    it('the preview goes through', async () => {
      const createPreview = stubCreatePreview();

      const preview = await service.previewTierChange(
        subscriberId,
        orgId,
        upperTierId,
        'month'
      );

      expect(createPreview).toHaveBeenCalledTimes(1);
      expect(preview.amountDueCents).toBe(500);
    });

    it('the change goes through', async () => {
      await service.changeTier(subscriberId, orgId, upperTierId, 'month');

      expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
      expect(await storedTier()).toBe(upperTierId);
    });
  });
});
