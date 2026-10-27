/**
 * Subscription state drift — tier subscriptions (Codex-2hxff.15).
 *
 * Integration tests with the real DB and a mocked Stripe, one block per item
 * of the bead:
 * - SUB-07: a second subscription to an org is recorded as a duplicate of the
 *   first, cancelled at Stripe and refunded, and inert on every later event
 *   (owner decision 2026-10-22, "Keep the first").
 * - SUB-09: a deletion is final (a tombstone), and its side effects follow
 *   the subscription, not the user.
 * - SUB-11: the recorded amount is the price, not a proration invoice's.
 * - SUB-12: the preview's proration date is bounded before Stripe sees it.
 * - SUB-13: one resume key per pause; the row takes Stripe's status.
 * - SUB-20: an invited member stays a member; payout summaries leave out the
 *   platform's fee and count stuck charges, not rows.
 */

import { randomUUID } from 'node:crypto';
import {
  organizationMemberships,
  organizations,
  payouts as payoutsTable,
  stripeConnectAccounts,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import { ServiceUnavailableError } from '@codex/service-errors';
import {
  createMockStripe,
  createMockStripeInvoice,
  createMockStripeSubscription,
  createTestConnectAccountInput,
  createTestOrganizationInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  seedTestUsers,
  setTestOrganisationPayee,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
  validateDatabaseConnection,
} from '@codex/test-utils';
import { and, eq, inArray, sql } from 'drizzle-orm';
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
import {
  AlreadySubscribedError,
  TierChangePreviewExpiredError,
} from '../../errors';
import { SubscriptionService } from '../subscription-service';

/** A vi.fn() behind one of Stripe's overloaded methods. */
function asMock(fn: unknown): ReturnType<typeof vi.fn> {
  return fn as ReturnType<typeof vi.fn>;
}

describe('Subscription drift — tier subscriptions (Codex-2hxff.15)', () => {
  let db: ReturnType<typeof setupTestDatabase>;
  let stripe: Stripe;
  let service: SubscriptionService;
  let ownerId: string;
  let subscriberId: string;
  let otherId: string;
  const orgIds: string[] = [];
  // Stripe's own state, so a retry reads back what an earlier call changed
  // (a refund made, a subscription cancelled), as it would at Stripe.
  const refundedCharges = new Set<string>();
  const paidInvoicesBySub = new Map<string, Array<Record<string, unknown>>>();

  beforeAll(async () => {
    db = setupTestDatabase();
    await validateDatabaseConnection(db);
    [ownerId, subscriberId, otherId] = (await seedTestUsers(db, 3)) as [
      string,
      string,
      string,
    ];
  });

  beforeEach(async () => {
    stripe = createMockStripe();
    (stripe as unknown as { customers: unknown }).customers = {
      list: vi.fn().mockResolvedValue({ data: [], has_more: false }),
      create: vi.fn().mockImplementation(async () => ({
        id: `cus_drift_${randomUUID().slice(0, 8)}`,
        metadata: {},
      })),
    };
    refundedCharges.clear();
    paidInvoicesBySub.clear();
    asMock(stripe.refunds.create).mockImplementation(
      async (params: { charge?: string }) => {
        if (params.charge) refundedCharges.add(params.charge);
        return {
          id: `re_drift_${randomUUID().slice(0, 8)}`,
          object: 'refund',
          status: 'succeeded',
        };
      }
    );
    asMock(stripe.charges.retrieve).mockImplementation(async (id: string) => ({
      id,
      object: 'charge',
      amount: 499,
      amount_refunded: refundedCharges.has(id) ? 499 : 0,
      refunded: refundedCharges.has(id),
    }));
    asMock(stripe.invoices.list).mockImplementation(
      async (params: { subscription?: string }) => ({
        object: 'list',
        has_more: false,
        data: paidInvoicesBySub.get(params.subscription ?? '') ?? [],
      })
    );
    service = new SubscriptionService({ db, environment: 'test' }, stripe);
    await db
      .update(users)
      .set({ stripeCustomerId: null })
      .where(eq(users.id, subscriberId));
    // One Connect account per user: the owner's is re-seeded per org.
    await db
      .delete(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.userId, ownerId));
  });

  afterAll(async () => {
    // The payouts sweeps read the ledger globally: leave no rows behind.
    if (orgIds.length > 0) {
      await db
        .delete(payoutsTable)
        .where(inArray(payoutsTable.organizationId, orgIds));
    }
    await teardownTestDatabase();
  });

  /** An org whose owner can be paid, with a £4.99 and a £9.99 tier. */
  async function createFullOrg(slug: string) {
    const org = takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput({ slug: createUniqueSlug(slug) }))
        .returning()
    );
    orgIds.push(org.id);
    await db.insert(stripeConnectAccounts).values(
      createTestConnectAccountInput(org.id, ownerId, {
        chargesEnabled: true,
        payoutsEnabled: true,
        status: 'active',
      })
    );
    await setTestOrganisationPayee(db, org.id, ownerId);
    const [tier1, tier2] = await db
      .insert(subscriptionTiers)
      .values([
        createTestTierInput(org.id, {
          name: 'Basic',
          sortOrder: 1,
          priceMonthly: 499,
          priceAnnual: 4990,
        }),
        createTestTierInput(org.id, {
          name: 'Pro',
          sortOrder: 2,
          priceMonthly: 999,
          priceAnnual: 9990,
        }),
      ])
      .returning();
    if (!tier1 || !tier2) throw new Error('tiers not seeded');
    return { org, tier1, tier2 };
  }

  /** A subscription of ours at Stripe: env-tagged, with the codex ids. */
  function stripeSub(
    orgId: string,
    tierId: string,
    options: { unitAmount?: number; userId?: string } = {}
  ): Stripe.Subscription {
    const now = Math.floor(Date.now() / 1000);
    return createMockStripeSubscription({
      metadata: {
        codex_user_id: options.userId ?? subscriberId,
        codex_organization_id: orgId,
        codex_tier_id: tierId,
        codex_env: 'test',
      },
      items: {
        data: [
          {
            id: `si_drift_${randomUUID().slice(0, 8)}`,
            price: {
              id: `price_drift_${randomUUID().slice(0, 8)}`,
              unit_amount: options.unitAmount ?? 499,
              currency: 'gbp',
              recurring: { interval: 'month' },
            },
            current_period_start: now,
            current_period_end: now + 30 * 24 * 60 * 60,
          },
        ],
      },
    }) as unknown as Stripe.Subscription;
  }

  /**
   * What `subscriptions.retrieve` answers for these ids. A cancel changes it:
   * the subscription reads back `canceled` afterwards, as at Stripe.
   */
  function liveAtStripe(...subs: Stripe.Subscription[]) {
    const byId = new Map(subs.map((sub) => [sub.id, sub]));
    asMock(stripe.subscriptions.retrieve).mockImplementation(
      async (id: string) =>
        byId.get(id) ?? {
          id,
          status: 'active',
          metadata: {},
          items: { data: [] },
        }
    );
    asMock(stripe.subscriptions.cancel).mockImplementation(
      async (id: string) => {
        const cancelled = {
          ...(byId.get(id) ?? { id, metadata: {}, items: { data: [] } }),
          status: 'canceled',
        } as Stripe.Subscription;
        byId.set(id, cancelled);
        return cancelled;
      }
    );
  }

  /** One paid invoice on the subscription, as `invoices.list` returns it. */
  function paidInvoice(stripeSubId: string, amountPaid: number) {
    const invoiceId = `in_dup_${randomUUID().slice(0, 8)}`;
    const chargeId = `ch_dup_${randomUUID().slice(0, 8)}`;
    paidInvoicesBySub.set(stripeSubId, [
      ...(paidInvoicesBySub.get(stripeSubId) ?? []),
      {
        id: invoiceId,
        amount_paid: amountPaid,
        payments: { data: [{ payment: { charge: chargeId } }] },
      },
    ]);
    return { invoiceId, chargeId };
  }

  function invoiceFor(
    stripeSubId: string,
    overrides: Record<string, unknown> = {}
  ): Stripe.Invoice {
    return createMockStripeInvoice({
      billing_reason: 'subscription_cycle',
      parent: { subscription_details: { subscription: stripeSubId } },
      ...overrides,
    }) as unknown as Stripe.Invoice;
  }

  async function rowFor(stripeSubId: string) {
    const [row] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId));
    return row;
  }

  async function membershipOf(userId: string, orgId: string) {
    const [row] = await db
      .select()
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.organizationId, orgId)
        )
      );
    return row;
  }

  /** A live subscription, then a second one to the same org, settled. */
  async function subscribeTwice(slug: string) {
    const { org, tier1, tier2 } = await createFullOrg(slug);
    const first = stripeSub(org.id, tier1.id);
    const second = stripeSub(org.id, tier2.id, { unitAmount: 999 });
    liveAtStripe(first, second);
    const paid = paidInvoice(second.id, 999);
    await service.handleSubscriptionCreated(first);
    const firstRow = await rowFor(first.id);
    if (!firstRow) throw new Error('first subscription not recorded');
    return { org, tier1, tier2, first, second, firstRow, ...paid };
  }

  // ─── SUB-07 ──────────────────────────────────────────────────────────────

  describe('a second subscription to an org (SUB-07)', () => {
    it('is recorded as a cancelled duplicate: one Stripe cancel, one full refund, nothing else changes', async () => {
      const { org, first, second, firstRow, invoiceId, chargeId } =
        await subscribeTwice('dup-basic');
      const membershipBefore = await membershipOf(subscriberId, org.id);

      const result = await service.handleSubscriptionCreated(second);

      // No userId/orgId/email: no streaming block, no clear, no welcome.
      expect(result).toEqual({});
      const duplicate = await rowFor(second.id);
      expect(duplicate?.status).toBe('cancelled');
      expect(duplicate?.duplicateOfSubscriptionId).toBe(firstRow.id);
      expect(duplicate?.duplicateSettledAt).not.toBeNull();
      expect((await rowFor(first.id))?.status).toBe('active');

      expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
      expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(
        second.id,
        expect.objectContaining({ prorate: false }),
        { idempotencyKey: `dup_cancel_${second.id}` }
      );
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(stripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({ charge: chargeId, reason: 'duplicate' }),
        { idempotencyKey: `refund_duplicate_${invoiceId}` }
      );
      expect(await membershipOf(subscriberId, org.id)).toEqual(
        membershipBefore
      );

      // A redelivery of its checkout makes no second Stripe call.
      expect(await service.handleSubscriptionCreated(second)).toEqual({});
      expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    });

    it('a refund Stripe refuses leaves it owed and the event retryable; the retry settles it', async () => {
      const { second, firstRow, invoiceId } =
        await subscribeTwice('dup-refused');
      asMock(stripe.refunds.create).mockRejectedValueOnce(
        Object.assign(new Error('Insufficient platform balance'), {
          type: 'StripeInvalidRequestError',
          code: 'balance_insufficient',
        })
      );

      await expect(
        service.handleSubscriptionCreated(second)
      ).rejects.toBeInstanceOf(ServiceUnavailableError);
      const owed = await rowFor(second.id);
      expect(owed?.duplicateOfSubscriptionId).toBe(firstRow.id);
      expect(owed?.duplicateSettledAt).toBeNull();

      // Stripe redelivers the event.
      expect(await service.handleSubscriptionCreated(second)).toEqual({});
      expect((await rowFor(second.id))?.duplicateSettledAt).not.toBeNull();
      const keys = asMock(stripe.refunds.create).mock.calls.map(
        (call) => (call[1] as { idempotencyKey: string }).idempotencyKey
      );
      expect(keys).toEqual([
        `refund_duplicate_${invoiceId}`,
        `refund_duplicate_${invoiceId}`,
      ]);
    });

    it('its own invoice, update, pause and resume change nothing and pay no one', async () => {
      const { second } = await subscribeTwice('dup-inert');
      await service.handleSubscriptionCreated(second);
      const settled = await rowFor(second.id);

      expect(
        await service.handleInvoicePaymentSucceeded(
          invoiceFor(second.id, {
            amount_paid: 999,
            billing_reason: 'subscription_create',
            customer_email: 'dup@example.com',
          })
        )
      ).toEqual({});
      expect(await service.handleSubscriptionUpdated(second)).toBeUndefined();
      expect(await service.handleSubscriptionPaused(second)).toEqual({});
      expect(await service.handleSubscriptionResumed(second)).toEqual({});
      expect(
        await service.handleInvoicePaymentFailed(
          invoiceFor(second.id, { customer_email: 'dup@example.com' })
        )
      ).toEqual({});

      const after = await rowFor(second.id);
      expect(after?.status).toBe('cancelled');
      expect(after?.updatedAt).toEqual(settled?.updatedAt);
      expect(stripe.transfers.create).not.toHaveBeenCalled();
      const slices = await db
        .select()
        .from(payoutsTable)
        .where(eq(payoutsTable.subscriptionId, settled?.id ?? ''));
      expect(slices).toHaveLength(0);
      expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
    });

    it('its invoice paid after it was settled (a delayed method) is refunded too, under its own key', async () => {
      const { second } = await subscribeTwice('dup-late-paid');
      await service.handleSubscriptionCreated(second);
      expect((await rowFor(second.id))?.duplicateSettledAt).not.toBeNull();
      const lateChargeId = `ch_late_${randomUUID().slice(0, 8)}`;
      const late = invoiceFor(second.id, {
        amount_paid: 999,
        payments: {
          data: [{ payment: { payment_intent: null, charge: lateChargeId } }],
        },
      });

      expect(await service.handleInvoicePaymentSucceeded(late)).toEqual({});

      expect(stripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({ charge: lateChargeId, reason: 'duplicate' }),
        { idempotencyKey: `refund_duplicate_${late.id}` }
      );
      const slices = await db
        .select()
        .from(payoutsTable)
        .where(eq(payoutsTable.stripeChargeId, lateChargeId));
      expect(slices).toHaveLength(0);
    });

    it('its customer.subscription.deleted leaves the first subscription and the membership alone', async () => {
      const { org, first, second } = await subscribeTwice('dup-deleted');
      await service.handleSubscriptionCreated(second);
      const membershipBefore = await membershipOf(subscriberId, org.id);

      const result = await service.handleSubscriptionDeleted({
        ...second,
        status: 'canceled',
      });

      expect(result).toEqual({});
      const firstAfter = await rowFor(first.id);
      expect(firstAfter?.status).toBe('active');
      expect(firstAfter?.endedAt).toBeNull();
      expect(await membershipOf(subscriberId, org.id)).toEqual(
        membershipBefore
      );
      expect((await rowFor(second.id))?.endedAt).not.toBeNull();
      expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    });

    it('is no subscriber in the Studio list, even with cancelled rows shown', async () => {
      const { org, second, firstRow } = await subscribeTwice('dup-list');
      await service.handleSubscriptionCreated(second);

      const all = await service.listSubscribers(org.id, {
        page: 1,
        limit: 20,
        includeCancelled: true,
      });
      const cancelled = await service.listSubscribers(org.id, {
        page: 1,
        limit: 20,
        status: 'cancelled',
      });

      expect(all.items.map((item) => item.id)).toEqual([firstRow.id]);
      expect(all.pagination.total).toBe(1);
      expect(cancelled.items).toHaveLength(0);
    });

    it('two first-time completions at once leave exactly one live subscription', async () => {
      const { org, tier1, tier2 } = await createFullOrg('dup-race');
      const a = stripeSub(org.id, tier1.id);
      const b = stripeSub(org.id, tier2.id, { unitAmount: 999 });
      liveAtStripe(a, b);

      const results = await Promise.all([
        service.handleSubscriptionCreated(a),
        service.handleSubscriptionCreated(b),
      ]);

      const rows = await db
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, subscriberId),
            eq(subscriptions.organizationId, org.id)
          )
        );
      expect(rows).toHaveLength(2);
      const live = rows.filter((row) => row.status === 'active');
      expect(live).toHaveLength(1);
      const duplicate = rows.find((row) => row.status === 'cancelled');
      expect(duplicate?.duplicateOfSubscriptionId).toBe(live[0]?.id);
      expect(duplicate?.duplicateSettledAt).not.toBeNull();
      expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
      expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(
        duplicate?.stripeSubscriptionId,
        expect.anything(),
        expect.anything()
      );
      // Only the survivor's result carries the ids (and its welcome email).
      expect(results.filter((r) => r?.userId === subscriberId)).toHaveLength(1);
    });
  });

  // ─── SUB-09 ──────────────────────────────────────────────────────────────

  describe('a deleted subscription is final (SUB-09)', () => {
    it('a deletion before any row, next to a live subscription, is a duplicate of it and is refunded', async () => {
      const { org, first, second, firstRow, chargeId } =
        await subscribeTwice('tomb-dup');
      const membershipBefore = await membershipOf(subscriberId, org.id);
      // Ended at Stripe before any event of it reached us.
      liveAtStripe(first, { ...second, status: 'canceled' });

      const result = await service.handleSubscriptionDeleted({
        ...second,
        status: 'canceled',
      });

      expect(result).toEqual({});
      const duplicate = await rowFor(second.id);
      expect(duplicate?.status).toBe('cancelled');
      expect(duplicate?.endedAt).not.toBeNull();
      expect(duplicate?.duplicateOfSubscriptionId).toBe(firstRow.id);
      expect(duplicate?.duplicateSettledAt).not.toBeNull();
      // Already ended, so not cancelled again; every payment refunded.
      expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(stripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({ charge: chargeId, reason: 'duplicate' }),
        expect.anything()
      );
      expect((await rowFor(first.id))?.status).toBe('active');
      expect(await membershipOf(subscriberId, org.id)).toEqual(
        membershipBefore
      );
    });

    it('an update reporting canceled ends access now and leaves the end itself to the deletion', async () => {
      const { org, tier1 } = await createFullOrg('tomb-update');
      const sub = stripeSub(org.id, tier1.id);
      liveAtStripe(sub);
      await service.handleSubscriptionCreated(sub);
      const ended = { ...sub, status: 'canceled' } as Stripe.Subscription;

      await service.handleSubscriptionUpdated(ended);

      // Cancelled (no access), not yet a tombstone: the membership stays
      // until the deletion, whose first end carries the block and the email.
      const row = await rowFor(sub.id);
      expect(row?.status).toBe('cancelled');
      expect(row?.endedAt).toBeNull();
      expect((await membershipOf(subscriberId, org.id))?.status).toBe('active');
      expect(await service.handleSubscriptionDeleted(ended)).toMatchObject({
        userId: subscriberId,
        orgId: org.id,
        email: { templateName: 'subscription-cancelled' },
      });
      expect((await rowFor(sub.id))?.endedAt).not.toBeNull();
    });

    it('a deletion before any row leaves a tombstone a stale update or a late resume cannot revive', async () => {
      const { org, tier1 } = await createFullOrg('tomb-first');
      const sub = stripeSub(org.id, tier1.id);
      liveAtStripe({ ...sub, status: 'canceled' });

      expect(
        await service.handleSubscriptionDeleted({ ...sub, status: 'canceled' })
      ).toEqual({});
      const tombstone = await rowFor(sub.id);
      expect(tombstone?.status).toBe('cancelled');
      expect(tombstone?.endedAt).not.toBeNull();
      // No other live subscription: a plain tombstone, nothing refunded.
      expect(tombstone?.duplicateOfSubscriptionId).toBeNull();
      expect(stripe.refunds.create).not.toHaveBeenCalled();

      // Stale events whose payloads still say `active`.
      expect(await service.handleSubscriptionUpdated(sub)).toBeUndefined();
      // Inert: no ids, so the webhook keeps the streaming block.
      expect(await service.handleSubscriptionResumed(sub)).toEqual({});
      expect(await service.handleSubscriptionCreated(sub)).toEqual({});

      expect((await rowFor(sub.id))?.status).toBe('cancelled');
      expect(await membershipOf(subscriberId, org.id)).toBeUndefined();
    });

    it("a deletion of a subscription that is not this environment's writes nothing", async () => {
      const { org, tier1 } = await createFullOrg('tomb-foreign');
      const sub = stripeSub(org.id, tier1.id);

      const result = await service.handleSubscriptionDeleted({
        ...sub,
        status: 'canceled',
        metadata: { ...sub.metadata, codex_env: 'production' },
      });

      expect(result).toEqual({});
      expect(await rowFor(sub.id)).toBeUndefined();
    });

    it('the first end carries the cancellation email; the real event after it (or a replay) is inert', async () => {
      const { org, tier1 } = await createFullOrg('tomb-email');
      const sub = stripeSub(org.id, tier1.id);
      liveAtStripe(sub);
      await service.handleSubscriptionCreated(sub);
      const [subscriber] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, subscriberId));
      const cancelled = { ...sub, status: 'canceled' } as Stripe.Subscription;

      // The full-refund path ends it first, with the web app's URL.
      const first = await service.handleSubscriptionDeleted(
        cancelled,
        'https://app.example'
      );

      expect(first).toMatchObject({
        userId: subscriberId,
        orgId: org.id,
        email: {
          to: subscriber?.email,
          templateName: 'subscription-cancelled',
          data: {
            resubscribeUrl: 'https://app.example/account/subscriptions',
          },
        },
      });
      expect((await membershipOf(subscriberId, org.id))?.status).toBe(
        'inactive'
      );

      // Then Stripe's own customer.subscription.deleted lands.
      expect(
        await service.handleSubscriptionDeleted(
          cancelled,
          'https://app.example'
        )
      ).toEqual({});
    });

    it('a late invoice on an ended subscription changes nothing on it and restores no access', async () => {
      const { org, tier1 } = await createFullOrg('tomb-invoice');
      const sub = stripeSub(org.id, tier1.id);
      liveAtStripe(sub);
      await service.handleSubscriptionCreated(sub);
      const ended = await service.handleSubscriptionDeleted({
        ...sub,
        status: 'canceled',
      });
      expect(ended.userId).toBe(subscriberId);
      const before = await rowFor(sub.id);

      liveAtStripe({ ...sub, status: 'canceled' });
      const result = await service.handleInvoicePaymentSucceeded(
        invoiceFor(sub.id, { customer_email: 'late@example.com' })
      );

      expect(result).toEqual({});
      expect(await rowFor(sub.id)).toEqual(before);
    });

    it('unpaid, then paid, still returns to active', async () => {
      const { org, tier1 } = await createFullOrg('tomb-unpaid');
      const sub = stripeSub(org.id, tier1.id);
      liveAtStripe(sub);
      await service.handleSubscriptionCreated(sub);

      await service.handleSubscriptionUpdated({ ...sub, status: 'unpaid' });
      expect((await rowFor(sub.id))?.status).toBe('cancelled');

      // The customer pays the open invoice: Stripe has it active again.
      liveAtStripe(sub);
      const result = await service.handleSubscriptionUpdated(sub);

      expect(result).toEqual({ userId: subscriberId, orgId: org.id });
      const row = await rowFor(sub.id);
      expect(row?.status).toBe('active');
      expect(row?.endedAt).toBeNull();
    });

    it('a late deletion of an old subscription leaves the current one, its membership and its access alone', async () => {
      const { org, tier1 } = await createFullOrg('tomb-old');
      const old = stripeSub(org.id, tier1.id);
      liveAtStripe(old);
      await service.handleSubscriptionCreated(old);
      await service.handleSubscriptionUpdated({ ...old, status: 'unpaid' });
      const current = stripeSub(org.id, tier1.id);
      liveAtStripe(old, current);
      await service.handleSubscriptionCreated(current);
      expect((await rowFor(current.id))?.duplicateOfSubscriptionId).toBeNull();

      const result = await service.handleSubscriptionDeleted({
        ...old,
        status: 'canceled',
      });

      expect(result).toEqual({});
      expect((await rowFor(old.id))?.endedAt).not.toBeNull();
      expect((await rowFor(current.id))?.status).toBe('active');
      const membership = await membershipOf(subscriberId, org.id);
      expect(membership?.role).toBe('subscriber');
      expect(membership?.status).toBe('active');
    });

    it("an old row's update, while a newer subscription is live, carries no ids: it cannot block or clear that one", async () => {
      const { org, tier1 } = await createFullOrg('old-update');
      const old = stripeSub(org.id, tier1.id);
      liveAtStripe(old);
      await service.handleSubscriptionCreated(old);
      await service.handleSubscriptionUpdated({ ...old, status: 'unpaid' });
      const current = stripeSub(org.id, tier1.id);
      liveAtStripe(old, current);
      await service.handleSubscriptionCreated(current);

      // A redelivered `unpaid` for the old one: on ids, the webhook would
      // block the user's streaming for the org.
      const result = await service.handleSubscriptionUpdated({
        ...old,
        status: 'unpaid',
      });

      expect(result?.userId).toBeUndefined();
      expect(result?.orgId).toBeUndefined();
      expect((await rowFor(current.id))?.status).toBe('active');
    });

    it('an invited member who subscribes, then cancels, stays an active member (SUB-20)', async () => {
      const { org, tier1 } = await createFullOrg('member-kept');
      await db.insert(organizationMemberships).values({
        organizationId: org.id,
        userId: subscriberId,
        role: 'member',
        status: 'active',
      });
      const sub = stripeSub(org.id, tier1.id);
      liveAtStripe(sub);

      await service.handleSubscriptionCreated(sub);
      expect((await membershipOf(subscriberId, org.id))?.role).toBe('member');

      const result = await service.handleSubscriptionDeleted({
        ...sub,
        status: 'canceled',
      });

      // The subscription's access still ends; the team role does not.
      expect(result.userId).toBe(subscriberId);
      const membership = await membershipOf(subscriberId, org.id);
      expect(membership?.role).toBe('member');
      expect(membership?.status).toBe('active');
    });
  });

  // ─── Owner decision 7 ────────────────────────────────────────────────────

  describe('an old subscription revived next to a newer one (decision 7: "Cancel old, refund it")', () => {
    /**
     * Old A goes `unpaid`, the buyer subscribes again (B, live), then pays
     * A's open invoice: Stripe has A active again, that invoice its latest.
     */
    async function reviveNextToNewer(slug: string) {
      const { org, tier1, tier2 } = await createFullOrg(slug);
      const a = stripeSub(org.id, tier1.id);
      liveAtStripe(a);
      await service.handleSubscriptionCreated(a);
      await service.handleSubscriptionUpdated({ ...a, status: 'unpaid' });
      const b = stripeSub(org.id, tier2.id, { unitAmount: 999 });
      liveAtStripe(a, b);
      await service.handleSubscriptionCreated(b);
      const aRow = await rowFor(a.id);
      const bRow = await rowFor(b.id);
      expect(aRow?.status).toBe('cancelled');
      expect(bRow?.status).toBe('active');
      expect(bRow?.duplicateOfSubscriptionId).toBeNull();

      const chargeId = `ch_revive_${randomUUID().slice(0, 8)}`;
      const invoice = invoiceFor(a.id, {
        amount_paid: 499,
        status: 'paid',
        customer_email: 'revived@example.com',
        payments: {
          data: [{ payment: { payment_intent: null, charge: chargeId } }],
        },
      });
      const revivedA = { ...a, latest_invoice: invoice } as Stripe.Subscription;
      liveAtStripe(revivedA, b);
      return { org, a, b, aRow, bRow, invoice, chargeId, revivedA };
    }

    async function slicesFor(chargeId: string) {
      return db
        .select()
        .from(payoutsTable)
        .where(eq(payoutsTable.stripeChargeId, chargeId));
    }

    /** Stripe refuses the next call to `method`, once. */
    function refuseOnce(method: unknown) {
      asMock(method).mockRejectedValueOnce(
        Object.assign(new Error('Stripe refused'), {
          type: 'StripeInvalidRequestError',
          code: 'balance_insufficient',
        })
      );
    }

    it('its reviving invoice: the refund, THEN one cancel, A tombstoned, B untouched, no payout', async () => {
      const { org, a, b, bRow, invoice, chargeId } =
        await reviveNextToNewer('revive-invoice');

      const result = await service.handleInvoicePaymentSucceeded(invoice);

      expect(result).toEqual({});
      const aAfter = await rowFor(a.id);
      expect(aAfter?.status).toBe('cancelled');
      expect(aAfter?.endedAt).not.toBeNull();
      expect(await rowFor(b.id)).toEqual(bRow);
      expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
      expect(stripe.subscriptions.cancel).toHaveBeenCalledWith(
        a.id,
        expect.objectContaining({ prorate: false }),
        { idempotencyKey: `revived_cancel_${a.id}` }
      );
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(stripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({
          charge: chargeId,
          reason: 'requested_by_customer',
        }),
        { idempotencyKey: `refund_revived_${invoice.id}` }
      );
      // Refund first: a refused refund must never follow a cancel.
      expect(
        asMock(stripe.refunds.create).mock.invocationCallOrder[0]
      ).toBeLessThan(
        asMock(stripe.subscriptions.cancel).mock.invocationCallOrder[0] ?? 0
      );
      expect(await slicesFor(chargeId)).toHaveLength(0);
      expect(stripe.transfers.create).not.toHaveBeenCalled();
      // B's access is untouched: the membership stays active.
      expect((await membershipOf(subscriberId, org.id))?.status).toBe('active');
    });

    it('revived by an update first: retired there, and its invoice after is inert with no second Stripe call', async () => {
      const { a, b, bRow, invoice, chargeId, revivedA } =
        await reviveNextToNewer('revive-update');

      expect(await service.handleSubscriptionUpdated(revivedA)).toBeUndefined();

      expect((await rowFor(a.id))?.endedAt).not.toBeNull();
      expect(await rowFor(b.id)).toEqual(bRow);
      expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(stripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({ charge: chargeId }),
        { idempotencyKey: `refund_revived_${invoice.id}` }
      );

      // That invoice's own event lands after: its charge is refunded in full.
      expect(await service.handleInvoicePaymentSucceeded(invoice)).toEqual({});
      expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(await slicesFor(chargeId)).toHaveLength(0);
    });

    it('a refund Stripe refuses changes nothing anywhere; the retry refunds, cancels and pays no one', async () => {
      const { a, aRow, invoice, chargeId } = await reviveNextToNewer(
        'revive-refund-refused'
      );
      refuseOnce(stripe.refunds.create);

      await expect(
        service.handleInvoicePaymentSucceeded(invoice)
      ).rejects.toBeInstanceOf(ServiceUnavailableError);
      expect(await rowFor(a.id)).toEqual(aRow);
      // Not cancelled: the retry still sees the revival.
      expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();

      // Stripe redelivers the event.
      expect(await service.handleInvoicePaymentSucceeded(invoice)).toEqual({});
      expect((await rowFor(a.id))?.endedAt).not.toBeNull();
      const keys = asMock(stripe.refunds.create).mock.calls.map(
        (call) => (call[1] as { idempotencyKey: string }).idempotencyKey
      );
      expect(keys).toEqual([
        `refund_revived_${invoice.id}`,
        `refund_revived_${invoice.id}`,
      ]);
      expect(refundedCharges).toContain(chargeId);
      expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
      expect(await slicesFor(chargeId)).toHaveLength(0);
    });

    it('a cancel Stripe refuses after a good refund: the retry repeats the refund under its key and completes', async () => {
      const { a, aRow, invoice, chargeId } = await reviveNextToNewer(
        'revive-cancel-refused'
      );
      refuseOnce(stripe.subscriptions.cancel);

      await expect(
        service.handleInvoicePaymentSucceeded(invoice)
      ).rejects.toBeInstanceOf(ServiceUnavailableError);
      expect(await rowFor(a.id)).toEqual(aRow);

      expect(await service.handleInvoicePaymentSucceeded(invoice)).toEqual({});
      expect((await rowFor(a.id))?.endedAt).not.toBeNull();
      const keys = asMock(stripe.refunds.create).mock.calls.map(
        (call) => (call[1] as { idempotencyKey: string }).idempotencyKey
      );
      expect(new Set(keys)).toEqual(new Set([`refund_revived_${invoice.id}`]));
      expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(2);
      expect(await slicesFor(chargeId)).toHaveLength(0);
    });

    it('an OLDER invoice redelivered is not refunded and pays out; the revival is retired on its latest invoice', async () => {
      const { a, invoice, chargeId } =
        await reviveNextToNewer('revive-old-invoice');
      const oldChargeId = `ch_old_${randomUUID().slice(0, 8)}`;
      const oldInvoice = invoiceFor(a.id, {
        amount_paid: 499,
        payments: {
          data: [{ payment: { payment_intent: null, charge: oldChargeId } }],
        },
      });

      expect(await service.handleInvoicePaymentSucceeded(oldInvoice)).toEqual(
        {}
      );

      // Only the reviving (latest) invoice is refunded.
      expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
      expect(stripe.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({ charge: chargeId }),
        { idempotencyKey: `refund_revived_${invoice.id}` }
      );
      expect((await rowFor(a.id))?.endedAt).not.toBeNull();
      expect(await slicesFor(chargeId)).toHaveLength(0);
      // The older payment bought real access: it pays out.
      expect((await slicesFor(oldChargeId)).length).toBeGreaterThan(0);
    });

    it('an update and its invoice processed at once: A retired, one refund, no payout', async () => {
      const { a, b, bRow, invoice, chargeId, revivedA } =
        await reviveNextToNewer('revive-concurrent');

      const results = await Promise.all([
        service.handleSubscriptionUpdated(revivedA),
        service.handleInvoicePaymentSucceeded(invoice),
      ]);

      expect(results[0]?.userId).toBeUndefined();
      expect(results[1]).toEqual({});
      expect((await rowFor(a.id))?.endedAt).not.toBeNull();
      expect(await rowFor(b.id)).toEqual(bRow);
      expect(refundedCharges).toContain(chargeId);
      // Each Stripe call carries one key, however many events made it.
      const keys = asMock(stripe.refunds.create).mock.calls.map(
        (call) => (call[1] as { idempotencyKey: string }).idempotencyKey
      );
      expect(new Set(keys)).toEqual(new Set([`refund_revived_${invoice.id}`]));
      expect(await slicesFor(chargeId)).toHaveLength(0);
    });

    it('with no newer subscription, paying the open invoice still restores A (decision 4)', async () => {
      const { org, tier1 } = await createFullOrg('revive-alone');
      const a = stripeSub(org.id, tier1.id);
      liveAtStripe(a);
      await service.handleSubscriptionCreated(a);
      await service.handleSubscriptionUpdated({ ...a, status: 'unpaid' });

      const result = await service.handleInvoicePaymentSucceeded(
        invoiceFor(a.id, { customer_email: 'alone@example.com' })
      );

      expect(result?.userId).toBe(subscriberId);
      expect((await rowFor(a.id))?.status).toBe('active');
      expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
      expect(stripe.refunds.create).not.toHaveBeenCalled();
    });

    it('a late invoice on an ended subscription pays no one when its charge was refunded in full', async () => {
      const { org, tier1 } = await createFullOrg('ended-refunded');
      const sub = stripeSub(org.id, tier1.id);
      liveAtStripe(sub);
      await service.handleSubscriptionCreated(sub);
      await service.handleSubscriptionDeleted({ ...sub, status: 'canceled' });
      const chargeId = `ch_ended_${randomUUID().slice(0, 8)}`;
      asMock(stripe.charges.retrieve).mockResolvedValue({
        id: chargeId,
        object: 'charge',
        amount: 499,
        amount_refunded: 499,
        refunded: true,
      });

      const result = await service.handleInvoicePaymentSucceeded(
        invoiceFor(sub.id, {
          payments: {
            data: [{ payment: { payment_intent: null, charge: chargeId } }],
          },
        })
      );

      expect(result).toEqual({});
      expect(await slicesFor(chargeId)).toHaveLength(0);
      expect(stripe.transfers.create).not.toHaveBeenCalled();
    });
  });

  // ─── Review round 1: T6, T8 ──────────────────────────────────────────────

  describe('the one-live index never fails quietly (review T6)', () => {
    it('a unique violation with no row of its own is retryable, and the retry records it', async () => {
      const { org, tier1 } = await createFullOrg('t6-index');
      const sub = stripeSub(org.id, tier1.id);
      liveAtStripe(sub);
      // The insert meets the index (a live row written outside the lock):
      // the first transaction fails as Postgres would fail it.
      let violated = false;
      const violatingDb = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop === 'transaction' && !violated) {
            violated = true;
            return async () => {
              throw Object.assign(new Error('duplicate key value'), {
                code: '23505',
              });
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      const violating = new SubscriptionService(
        { db: violatingDb, environment: 'test' },
        stripe
      );

      await expect(
        violating.handleSubscriptionCreated(sub)
      ).rejects.toBeInstanceOf(ServiceUnavailableError);
      expect(await rowFor(sub.id)).toBeUndefined();

      // Stripe redelivers it.
      expect(await service.handleSubscriptionCreated(sub)).toMatchObject({
        userId: subscriberId,
      });
    });

    it('resuming a paused subscription while a newer one is live is refused before Stripe is asked', async () => {
      const { org, tier1, tier2 } = await createFullOrg('t6-resume');
      await db.insert(subscriptions).values([
        createTestSubscriptionInput(subscriberId, org.id, tier1.id, {
          status: 'paused',
        }),
        createTestSubscriptionInput(subscriberId, org.id, tier2.id),
      ]);

      await expect(
        service.resumeSubscription(subscriberId, org.id)
      ).rejects.toBeInstanceOf(AlreadySubscribedError);
      expect(stripe.subscriptions.resume).not.toHaveBeenCalled();
    });
  });

  describe('owed duplicates are retried by the sweep (review T8)', () => {
    it('settles the owed ones, reports those Stripe still refuses, and never throws', async () => {
      const good = await subscribeTwice('t8-good');
      // One Connect account per user: the second org's owner is re-seeded.
      await db
        .delete(stripeConnectAccounts)
        .where(eq(stripeConnectAccounts.userId, ownerId));
      const bad = await subscribeTwice('t8-bad');
      for (const duplicate of [good.second, bad.second]) {
        asMock(stripe.refunds.create).mockRejectedValueOnce(
          Object.assign(new Error('Stripe refused'), {
            type: 'StripeInvalidRequestError',
            code: 'balance_insufficient',
          })
        );
        await expect(
          service.handleSubscriptionCreated(duplicate)
        ).rejects.toBeInstanceOf(ServiceUnavailableError);
      }
      // Owed for two hours now, past Stripe's redeliveries.
      await db
        .update(subscriptions)
        .set({ createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
        .where(
          inArray(subscriptions.stripeSubscriptionId, [
            good.second.id,
            bad.second.id,
          ])
        );
      const badRow = await rowFor(bad.second.id);
      // Stripe still refuses the bad one's refund.
      asMock(stripe.refunds.create).mockImplementation(
        async (params: { charge?: string }) => {
          if (params.charge === bad.chargeId) {
            throw Object.assign(new Error('Stripe refused'), {
              type: 'StripeInvalidRequestError',
              code: 'balance_insufficient',
            });
          }
          return { id: `re_${randomUUID().slice(0, 8)}`, object: 'refund' };
        }
      );

      const result = await service.settleOwedDuplicates({
        olderThanMs: 60 * 60 * 1000,
        limit: 500,
      });

      expect(result.settled).toBeGreaterThanOrEqual(1);
      expect((await rowFor(good.second.id))?.duplicateSettledAt).not.toBeNull();
      expect(result.stillOwed).toContainEqual({
        id: badRow?.id,
        stripeSubscriptionId: bad.second.id,
      });
      expect((await rowFor(bad.second.id))?.duplicateSettledAt).toBeNull();

      // Stripe accepts it at last: nothing is left owed.
      asMock(stripe.refunds.create).mockResolvedValue({
        id: `re_${randomUUID().slice(0, 8)}`,
        object: 'refund',
      });
      const after = await service.settleOwedDuplicates({
        olderThanMs: 60 * 60 * 1000,
        limit: 500,
      });
      expect(after.stillOwed.map((row) => row.id)).not.toContain(badRow?.id);
      expect((await rowFor(bad.second.id))?.duplicateSettledAt).not.toBeNull();
    });
  });

  // ─── SUB-11 ──────────────────────────────────────────────────────────────

  describe('the recorded amount is the price, not a proration invoice (SUB-11)', () => {
    async function upgrade(order: 'update-first' | 'invoice-first') {
      const { org, tier1, tier2 } = await createFullOrg(`amount-${order}`);
      const sub = stripeSub(org.id, tier1.id, { unitAmount: 499 });
      liveAtStripe(sub);
      await service.handleSubscriptionCreated(sub);

      const [item] = sub.items.data;
      if (!item) throw new Error('subscription has no item');
      const upgraded = {
        ...sub,
        metadata: { ...sub.metadata, codex_tier_id: tier2.id },
        items: {
          ...sub.items,
          data: [{ ...item, price: { ...item.price, unit_amount: 999 } }],
        },
      } as Stripe.Subscription;
      liveAtStripe(upgraded);
      const chargeId = `ch_prorate_${randomUUID().slice(0, 8)}`;
      const proration = invoiceFor(sub.id, {
        amount_paid: 500,
        billing_reason: 'subscription_update',
        payments: {
          data: [{ payment: { payment_intent: null, charge: chargeId } }],
        },
      });

      if (order === 'update-first') {
        await service.handleSubscriptionUpdated(upgraded);
        await service.handleInvoicePaymentSucceeded(proration);
      } else {
        await service.handleInvoicePaymentSucceeded(proration);
        await service.handleSubscriptionUpdated(upgraded);
      }

      const row = await rowFor(sub.id);
      expect(row?.amountCents).toBe(999);
      expect(
        (row?.platformFeeCents ?? 0) +
          (row?.organizationFeeCents ?? 0) +
          (row?.creatorPayoutCents ?? 0)
      ).toBe(999);
      // The money follows the invoice: its slices add up to what it took.
      const slices = await db
        .select({ amountCents: payoutsTable.amountCents })
        .from(payoutsTable)
        .where(eq(payoutsTable.stripeChargeId, chargeId));
      expect(slices.reduce((sum, s) => sum + s.amountCents, 0)).toBe(500);
      return { org, tier1 };
    }

    it('an update, then the proration invoice', async () => {
      const { org, tier1 } = await upgrade('update-first');

      // A later move to the cheaper tier is a downgrade, not an upgrade.
      await service.changeTier(subscriberId, org.id, tier1.id, 'month');
      const params = asMock(stripe.subscriptions.update).mock.calls.at(
        -1
      )?.[1] as { proration_behavior: string };
      expect(params.proration_behavior).toBe('create_prorations');
    });

    it('the proration invoice, then the update', async () => {
      await upgrade('invoice-first');
    });
  });

  // ─── SUB-12 ──────────────────────────────────────────────────────────────

  describe("the preview's proration date is checked (SUB-12)", () => {
    it('one too old, from the future, or before the period → TierChangePreviewExpiredError, Stripe untouched', async () => {
      const { org, tier1, tier2 } = await createFullOrg('pdate-refused');
      await db.insert(subscriptions).values(
        createTestSubscriptionInput(subscriberId, org.id, tier1.id, {
          currentPeriodStart: new Date(Date.now() - 2 * 60 * 1000),
        })
      );
      const nowSec = Math.floor(Date.now() / 1000);

      for (const prorationDate of [
        nowSec - 11 * 60, // older than the 10-minute preview
        nowSec + 5 * 60, // from the future
        nowSec - 5 * 60, // fresh, but before the current period began
      ]) {
        const error = await service
          .changeTier(subscriberId, org.id, tier2.id, 'month', prorationDate)
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(TierChangePreviewExpiredError);
        expect(error).toMatchObject({
          code: 'TIER_CHANGE_PREVIEW_EXPIRED',
          statusCode: 409,
        });
      }
      expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it('upgrade, downgrade, then the same upgrade from a fresh preview are three distinct changes', async () => {
      const { org, tier1, tier2 } = await createFullOrg('pdate-keys');
      const sub = takeFirst(
        await db
          .insert(subscriptions)
          .values(
            createTestSubscriptionInput(subscriberId, org.id, tier1.id, {
              currentPeriodStart: new Date(Date.now() - 24 * 60 * 60 * 1000),
            })
          )
          .returning()
      );
      const nowSec = Math.floor(Date.now() / 1000);

      await service.changeTier(
        subscriberId,
        org.id,
        tier2.id,
        'month',
        nowSec - 30
      );
      await service.changeTier(
        subscriberId,
        org.id,
        tier1.id,
        'month',
        nowSec - 20
      );
      await service.changeTier(
        subscriberId,
        org.id,
        tier2.id,
        'month',
        nowSec - 10
      );

      const keys = asMock(stripe.subscriptions.update).mock.calls.map(
        (call) => (call[2] as { idempotencyKey: string }).idempotencyKey
      );
      expect(keys).toEqual([
        `upgrade_${sub.id}_${tier2.stripePriceMonthlyId}_${nowSec - 30}`,
        `downgrade_${sub.id}_${tier1.stripePriceMonthlyId}_${nowSec - 20}`,
        `upgrade_${sub.id}_${tier2.stripePriceMonthlyId}_${nowSec - 10}`,
      ]);
    });
  });

  // ─── SUB-13 ──────────────────────────────────────────────────────────────

  describe('resuming a paused subscription (SUB-13)', () => {
    it("each pause gets its own resume key, and the row takes Stripe's status", async () => {
      const { org, tier1 } = await createFullOrg('resume-keys');
      const sub = takeFirst(
        await db
          .insert(subscriptions)
          .values(
            createTestSubscriptionInput(subscriberId, org.id, tier1.id, {
              status: 'paused',
            })
          )
          .returning()
      );
      await service.resumeSubscription(subscriberId, org.id);

      // Paused again later.
      const pausedAgain = takeFirst(
        await db
          .update(subscriptions)
          .set({ status: 'paused', updatedAt: new Date(Date.now() + 1000) })
          .where(eq(subscriptions.id, sub.id))
          .returning()
      );
      // Stripe keeps it paused this time (an invoice is still to be paid).
      asMock(stripe.subscriptions.resume).mockResolvedValueOnce({
        id: sub.stripeSubscriptionId,
        status: 'paused',
        cancel_at_period_end: false,
      });
      await service.resumeSubscription(subscriberId, org.id);

      const keys = asMock(stripe.subscriptions.resume).mock.calls.map(
        (call) => (call[2] as { idempotencyKey: string }).idempotencyKey
      );
      expect(keys).toEqual([
        `resume_${sub.stripeSubscriptionId}_${sub.updatedAt.getTime()}`,
        `resume_${sub.stripeSubscriptionId}_${pausedAgain.updatedAt.getTime()}`,
      ]);
      expect(keys[0]).not.toBe(keys[1]);
      expect((await rowFor(sub.stripeSubscriptionId))?.status).toBe('paused');
    });
  });

  // ─── SUB-20 ──────────────────────────────────────────────────────────────

  describe('payout summaries (SUB-20)', () => {
    async function seedCharge(slug: string) {
      const { org, tier1 } = await createFullOrg(slug);
      const sub = takeFirst(
        await db
          .insert(subscriptions)
          .values(createTestSubscriptionInput(otherId, org.id, tier1.id))
          .returning()
      );
      return {
        org,
        sub,
        chargeId: `ch_sum_${randomUUID().slice(0, 8)}`,
        transferGroup: `sub_${sub.id}`,
      };
    }

    it("the org's Total earned leaves out the platform's fee", async () => {
      const { org, sub, chargeId, transferGroup } =
        await seedCharge('sum-platform-fee');
      const slice = {
        organizationId: org.id,
        subscriptionId: sub.id,
        currency: 'gbp',
        status: 'paid',
        sourceType: 'subscription',
        stripeChargeId: chargeId,
        transferGroup,
        resolvedAt: new Date(),
      } as const;
      await db.insert(payoutsTable).values([
        {
          ...slice,
          userId: null,
          payoutType: 'platform_fee',
          amountCents: 100,
        },
        {
          ...slice,
          userId: ownerId,
          payoutType: 'creator_payout_to_owner',
          amountCents: 900,
          stripeTransferId: `tr_${randomUUID().slice(0, 8)}`,
        },
      ]);

      const summary = await service.getPayoutSummary(org.id);

      expect(summary.totalEarnedCents).toBe(900);
      expect(summary.earnedInPeriodCents).toBe(900);
    });

    it('needs attention counts one stuck charge with three rows as one, in both summaries and the table', async () => {
      const { org, sub, chargeId, transferGroup } =
        await seedCharge('sum-stuck');
      const slice = {
        organizationId: org.id,
        subscriptionId: sub.id,
        userId: ownerId,
        currency: 'gbp',
        status: 'pending',
        reason: 'connect_not_ready',
        sourceType: 'subscription',
        stripeChargeId: chargeId,
        transferGroup,
      } as const;
      await db.insert(payoutsTable).values([
        { ...slice, payoutType: 'organization_fee', amountCents: 150 },
        { ...slice, payoutType: 'creator_payout_to_owner', amountCents: 300 },
        { ...slice, payoutType: 'creator_payout', amountCents: 400 },
      ]);

      const orgSummary = await service.getPayoutSummary(org.id);
      const creatorSummary =
        await service.getEarningsSummaryForCreator(ownerId);
      const table = await service.getPayoutsByCreatorBreakdown(org.id);

      expect(orgSummary.needsAttentionCount).toBe(1);
      expect(creatorSummary.needsAttentionCount).toBe(1);
      expect(
        table.find((row) => row.userId === ownerId)?.needsAttentionCount
      ).toBe(1);
    });

    it('needs attention counts two stuck renewals of one subscription as two, everywhere', async () => {
      const { org, sub, transferGroup } = await seedCharge('sum-renewals');
      const renewal = (chargeId: string) =>
        ({
          organizationId: org.id,
          subscriptionId: sub.id,
          userId: otherId,
          currency: 'gbp',
          status: 'pending',
          reason: 'connect_not_ready',
          sourceType: 'subscription',
          stripeChargeId: chargeId,
          transferGroup,
          payoutType: 'creator_payout',
          amountCents: 400,
        }) as const;
      await db
        .insert(payoutsTable)
        .values([
          renewal(`ch_r1_${randomUUID().slice(0, 8)}`),
          renewal(`ch_r2_${randomUUID().slice(0, 8)}`),
        ]);

      const orgSummary = await service.getPayoutSummary(org.id);
      const creatorSummary =
        await service.getEarningsSummaryForCreator(otherId);
      const table = await service.getPayoutsByCreatorBreakdown(org.id);

      expect(orgSummary.needsAttentionCount).toBe(2);
      expect(creatorSummary.needsAttentionCount).toBe(2);
      const creatorRow = table.find((row) => row.userId === otherId);
      // "2 transactions · 2 need attention", not "1 · 2".
      expect(creatorRow?.transactionCount).toBe(2);
      expect(creatorRow?.needsAttentionCount).toBe(2);
    });
  });

  // ─── Lock order against an account deletion (Codex-kk9nv.20) ─────────────

  describe('lock order against an account deletion (Codex-kk9nv.20)', () => {
    type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

    /**
     * Resolve once a statement on `table` is waiting on a lock `pid` holds.
     * The table must match, and a delete or truncate (a peer's cleanup on the
     * shared database) does not count. The same harness as
     * packages/organization/src/services/__tests__/lock-order.test.ts.
     */
    async function untilBlockedBy(
      pid: number,
      table: string,
      settled: () => { value: unknown } | undefined
    ): Promise<void> {
      for (let attempt = 0; attempt < 250; attempt++) {
        const early = settled();
        if (early) {
          throw new Error(
            `the path under test settled before it waited on ${table}`,
            { cause: early.value }
          );
        }
        const { rows } = await db.execute(
          sql`select 1 from pg_stat_activity
              where ${pid}::int = any(pg_blocking_pids(pid))
                and query ilike ${`%"${table}"%`}
                and query not ilike 'delete%'
                and query not ilike 'truncate%'`
        );
        if (rows.length > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`the path under test never waited on ${table}`);
    }

    it('waits on the membership a deletion holds without holding the user row, so the deletion commits', async () => {
      const { org, tier1 } = await createFullOrg('kk9nv20-lock');
      // A user with a membership already (here a creator), as the bead's case.
      await db.insert(organizationMemberships).values({
        organizationId: org.id,
        userId: subscriberId,
        role: 'creator',
        status: 'active',
      });
      const sub = stripeSub(org.id, tier1.id);
      liveAtStripe(sub);

      let outcome: Promise<unknown> = Promise.resolve('done');
      let settled: { value: unknown } | undefined;
      // The deletion: lock the user's memberships FOR UPDATE, then scrub the
      // user's email, a unique column, which takes FOR UPDATE on the user
      // row. A webhook holding a KEY SHARE on that row while it waits on the
      // membership deadlocks with it (40P01).
      await db.transaction(async (tx: Tx) => {
        await tx
          .select({ id: organizationMemberships.id })
          .from(organizationMemberships)
          .where(eq(organizationMemberships.userId, subscriberId))
          .for('update');
        const { rows } = await tx.execute(sql`select pg_backend_pid() as pid`);
        const pid = Number((rows[0] as { pid: unknown } | undefined)?.pid);
        outcome = service.handleSubscriptionCreated(sub).then(
          () => 'done',
          (error: unknown) => error
        );
        void outcome.then((value) => {
          settled = { value };
        });
        await untilBlockedBy(pid, 'organization_memberships', () => settled);
        await tx
          .update(users)
          .set({ email: `scrubbed-${randomUUID()}@example.invalid` })
          .where(eq(users.id, subscriberId));
      });

      expect(await outcome).toBe('done');
      expect((await rowFor(sub.id))?.status).toBe('active');
      // The creator keeps the team role.
      expect((await membershipOf(subscriberId, org.id))?.role).toBe('creator');
    });
  });
});
