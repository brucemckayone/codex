/**
 * With no subscription agreements, an organisation's subscription invoice
 * pays its owner the organisation fee AND the whole creator pool
 * (Codex-2hxff.77; docs/payments/fees-and-splits.md, "Organisation
 * subscription invoice").
 *
 * The owner can't hold an agreement with their own organisation: Revenue
 * share never lists them, and `proposeAgreement` refuses one to yourself. The
 * owner decided that on one condition: "as long as the owner gets paid
 * correctly". A creator on the team with no agreement takes nothing from the
 * pool. The pool goes to the owner as a `creator_payout_to_owner` row.
 *
 * At the spec's fees (10% platform, 15% organisation), a £10.00 invoice pays
 * 100 to Codex, then 135 + 765 to the owner: 900, everything after Codex's fee.
 *
 * Real DB, mocked Stripe. The local database is shared with other sessions,
 * so every row hangs off this file's own users and organisation and is
 * deleted in afterAll. Payout rows feed global drains, so they never stay.
 */

import { randomUUID } from 'node:crypto';
import {
  organizationMemberships,
  organizationOwnershipPeriods,
  organizations,
  type Payout,
  payouts,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import type { FeeConfig, FeeConfigService } from '@codex/purchase';
import {
  createMockStripe,
  createMockStripeInvoice,
  createTestConnectAccountInput,
  createTestOrganizationInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setTestOrganisationPayee,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SubscriptionService } from '../subscription-service';

/** The spec's subscription fees: 10% platform, 15% organisation. */
const FEES: FeeConfig = {
  platformFeePercent: 1000,
  orgFeePercent: 1500,
  minPlatformFeeCents: 0,
  minTransferCents: 0,
};

describe('an organisation invoice with no subscription agreements (Codex-2hxff.77)', () => {
  let db: Database;
  let ownerId: string;
  /** On the team, with no agreement: takes nothing from the pool. */
  let creatorId: string;
  let subscriberId: string;
  let orgId: string;
  let stripeSubscriptionId: string;
  let subscriptionId: string;
  let tierId: string;

  const feeConfig = {
    getFeesForCreator: vi.fn(async () => FEES),
    getFeesForOrg: vi.fn(async () => FEES),
    getFeesPlatform: vi.fn(async () => FEES),
  } as unknown as FeeConfigService;

  beforeAll(async () => {
    db = setupTestDatabase();
    [ownerId, creatorId, subscriberId] = (await seedTestUsers(db, 3)) as [
      string,
      string,
      string,
    ];
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({
            slug: createUniqueSlug('owner-pool'),
          })
        )
        .returning()
    ).id;
    await db.insert(organizationMemberships).values([
      {
        organizationId: orgId,
        userId: ownerId,
        role: 'owner',
        status: 'active',
      },
      {
        organizationId: orgId,
        userId: creatorId,
        role: 'creator',
        status: 'active',
      },
    ]);
    await setTestOrganisationPayee(db, orgId, ownerId);
    await db
      .insert(stripeConnectAccounts)
      .values([
        createTestConnectAccountInput(null, ownerId),
        createTestConnectAccountInput(null, creatorId),
      ]);
    tierId = takeFirst(
      await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(orgId, { name: 'Owner pool tier' }))
        .returning()
    ).id;
    const sub = takeFirst(
      await db
        .insert(subscriptions)
        .values(
          createTestSubscriptionInput(subscriberId, orgId, tierId, {
            status: 'active',
          })
        )
        .returning()
    );
    subscriptionId = sub.id;
    stripeSubscriptionId = sub.stripeSubscriptionId;
  });

  afterAll(async () => {
    await db.delete(payouts).where(eq(payouts.organizationId, orgId));
    await db.delete(subscriptions).where(eq(subscriptions.id, subscriptionId));
    await db.delete(subscriptionTiers).where(eq(subscriptionTiers.id, tierId));
    await db
      .delete(stripeConnectAccounts)
      .where(inArray(stripeConnectAccounts.userId, [ownerId, creatorId]));
    await db
      .delete(organizationOwnershipPeriods)
      .where(eq(organizationOwnershipPeriods.organizationId, orgId));
    await db
      .delete(organizationMemberships)
      .where(eq(organizationMemberships.organizationId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db
      .delete(users)
      .where(inArray(users.id, [ownerId, creatorId, subscriberId]));
    await teardownTestDatabase();
  });

  it('pays the owner the organisation fee plus the whole pool, and the creator nothing', async () => {
    const service = new SubscriptionService(
      { db, environment: 'test', feeConfig },
      createMockStripe()
    );
    const chargeId = `ch_owner_pool_${randomUUID().slice(0, 8)}`;
    const invoice = createMockStripeInvoice({
      amount_paid: 1000,
      parent: { subscription_details: { subscription: stripeSubscriptionId } },
      payments: {
        data: [
          { payment: { charge: chargeId, payment_intent: 'pi_owner_pool' } },
        ],
      },
    }) as unknown as Stripe.Invoice;

    await service.handleInvoicePaymentSucceeded(invoice);

    const rows: Payout[] = await db
      .select()
      .from(payouts)
      .where(eq(payouts.stripeChargeId, chargeId));
    const byType = Object.fromEntries(
      rows.map((row) => [
        row.payoutType,
        { amountCents: row.amountCents, userId: row.userId },
      ])
    );
    expect(byType).toEqual({
      platform_fee: expect.objectContaining({ amountCents: 100 }),
      organization_fee: { amountCents: 135, userId: ownerId },
      creator_payout_to_owner: { amountCents: 765, userId: ownerId },
    });
    expect(rows.some((row) => row.userId === creatorId)).toBe(false);
  });
});
