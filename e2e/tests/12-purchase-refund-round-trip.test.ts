/**
 * E2E: one-off purchase and refund round trips on real Stripe test-mode
 * objects (Codex-2hxff.25; owner decision 2026-10-27, "Purchases and
 * refunds").
 *
 * Tests 04/05/06 deliver checkout.session.completed with invented
 * `pi_test_*` ids. The webhook's paymentIntents.retrieve 404s, the charge id
 * is null and completePurchase skips the payouts ledger, so they pass with no
 * payout rows at all. Here the PaymentIntent, its charge and the refunds are
 * real, and each delivery is signed with the secret of the route production
 * uses: checkout.session.completed on /webhooks/stripe/booking,
 * charge.refunded on /webhooks/stripe/payment.
 *
 * The expected numbers are the spec's, never the code's:
 * - the split: docs/payments/fees-and-splits.md, "One-off purchase of
 *   organisation content", a £10.00 sale with no agreement;
 * - refunds: docs/payments/purchases.md, "Refunds", and each slice's share:
 *   docs/payments/refund-reversal-record.md §2.
 *
 * The creator is payable when the content is published and stops being
 * payable before it sells, so its slices wait as pending rows
 * (connect-and-payouts.md, "What needs payouts set up first"). No money moves
 * to a connected account, and every amount is a ledger row this file reads.
 *
 * Like every file here it leaves its rows: run it only against a database of
 * its own (CI's service database, or a throwaway one locally; e2e/README.md).
 */

import { randomUUID } from 'node:crypto';
import { closeDbPool, dbHttp, schema } from '@codex/database';
import {
  authFixture,
  expectSuccessResponse,
  httpClient,
  unwrapApiResponse,
} from '@codex/test-utils/e2e';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { markVideoReady } from '../helpers/media';
import {
  createUnverifiedConnectAccount,
  deleteConnectAccount,
  payCheckoutSession,
  refundCharge,
  type StripeClient,
  testModeStripe,
} from '../helpers/stripe-test-mode';
import {
  createStripeEvent,
  sendSignedWebhook,
} from '../helpers/stripe-webhook';
import { createScopedTestContext } from '../helpers/test-isolation';
import { WORKER_URLS } from '../helpers/worker-urls';

const PASSWORD = 'SecurePassword123!';
const PRICE_CENTS = 1000;

/**
 * fees-and-splits.md, £10.00 with no agreement: the platform takes 10% of the
 * gross, the organisation 10% of the 900p pool, the creator the rest.
 */
const SPLIT = { platform_fee: 100, organization_fee: 90, creator_payout: 810 };

/**
 * A quarter of the charge. Each slice's share is
 * floor(gross × 250 / 1000) (refund-reversal-record.md §2): 25, floor(22.5)
 * and floor(202.5). The 1p those floors leave is the platform's
 * (purchases.md: "the platform absorbs its own fee's share of the refund and
 * the rounding").
 */
const PARTIAL_REFUND_CENTS = 250;
const PARTIAL_SHARES = {
  platform_fee: 25,
  organization_fee: 22,
  creator_payout: 202,
};

type Payout = typeof schema.payouts.$inferSelect;

interface Sale {
  buyerCookie: string;
  purchaseId: string;
  chargeId: string;
}

const ctx = createScopedTestContext();
let stripe: StripeClient;
let bookingSecret: string;
let paymentSecret: string;
let creatorId: string;
let organizationId: string;
let contentId: string;
let connectAccountId: string | undefined;

/**
 * A secret the deliveries are signed with. Missing, the file fails: a skip
 * is how the payout flows went unexercised in CI (Codex-chh3e).
 */
function webhookSecret(
  name: 'STRIPE_WEBHOOK_SECRET_BOOKING' | 'STRIPE_WEBHOOK_SECRET_PAYMENT'
): string {
  const secret = process.env[name];
  if (!secret) {
    throw new Error(`${name} is not set: this file signs its webhooks with it`);
  }
  return secret;
}

function jsonHeaders(cookie: string, origin: string) {
  return { Cookie: cookie, 'Content-Type': 'application/json', Origin: origin };
}

/** What the buyer gets when they ask to stream the content now. */
async function streamStatus(buyerCookie: string): Promise<number> {
  const response = await httpClient.get(
    `${WORKER_URLS.content}/api/access/content/${contentId}/stream`,
    { headers: { Cookie: buyerCookie, Origin: WORKER_URLS.content } }
  );
  return response.status;
}

async function purchaseOf(purchaseId: string) {
  const [purchase] = await dbHttp
    .select()
    .from(schema.purchases)
    .where(eq(schema.purchases.id, purchaseId));
  if (!purchase) throw new Error(`No purchase ${purchaseId}`);
  return purchase;
}

/** The one entitlement the purchase granted. */
async function entitlementOf(purchaseId: string) {
  const rows = await dbHttp
    .select()
    .from(schema.entitlements)
    .where(
      and(
        eq(schema.entitlements.source, 'content_purchase'),
        eq(schema.entitlements.sourceRef, purchaseId)
      )
    );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

/** The purchase's payout rows; each one must be keyed on the sale's charge. */
async function ledgerOf(sale: Sale): Promise<Payout[]> {
  const rows = await dbHttp
    .select()
    .from(schema.payouts)
    .where(eq(schema.payouts.purchaseId, sale.purchaseId));
  for (const row of rows) expect(row.stripeChargeId).toBe(sale.chargeId);
  return rows;
}

/** Each slice's amount and status, by slice type. */
function slices(rows: Payout[]) {
  return Object.fromEntries(
    rows.map((row) => [
      row.payoutType,
      { amountCents: row.amountCents, status: row.status },
    ])
  );
}

/** What the refund recorded against each slice, by slice type. */
async function stepsOf(refundId: string, rows: Payout[]) {
  const typeOf = new Map(rows.map((row) => [row.id, row.payoutType]));
  const steps = await dbHttp
    .select()
    .from(schema.payoutReversals)
    .where(
      and(
        eq(schema.payoutReversals.causeType, 'refund'),
        eq(schema.payoutReversals.causeId, refundId)
      )
    );
  return Object.fromEntries(
    steps.map((step) => [
      typeOf.get(step.payoutId) ?? `not this sale's: ${step.payoutId}`,
      { kind: step.kind, amountCents: step.amountCents, status: step.status },
    ])
  );
}

/**
 * Buy the content as a new buyer, the way a real checkout ends: the app
 * opens the Checkout Session, the buyer pays with a real test card, and
 * Stripe's signed checkout.session.completed arrives. Asserts the purchase,
 * the access and the ledger it leaves.
 */
async function buy(label: string): Promise<Sale> {
  // A fresh buyer per attempt: CI retries a failed test, and a buyer who
  // already owns the content cannot check out again.
  const { cookie, user } = await authFixture.registerUser({
    email: ctx.email(`${label}-${randomUUID().slice(0, 8)}`),
    password: PASSWORD,
    name: ctx.name(`Buyer ${label}`),
    role: 'user',
  });

  // Before the sale the buyer cannot stream it, so the 200 below is the
  // purchase's doing.
  expect(await streamStatus(cookie)).toBe(403);

  const checkoutResponse = await httpClient.post(
    `${WORKER_URLS.ecom}/checkout/create`,
    {
      headers: jsonHeaders(cookie, WORKER_URLS.ecom),
      data: {
        contentId,
        successUrl: 'http://localhost:3000/purchase/success',
        cancelUrl: 'http://localhost:3000/purchase/cancel',
      },
    }
  );
  await expectSuccessResponse(checkoutResponse);
  const { sessionId } = unwrapApiResponse(await checkoutResponse.json());

  const paid = await payCheckoutSession(stripe, sessionId);
  const delivery = await sendSignedWebhook(
    `${WORKER_URLS.ecom}/webhooks/stripe/booking`,
    createStripeEvent('checkout.session.completed', paid.session),
    bookingSecret
  );
  // Proves only that the signature passed: a permanent failure is
  // acknowledged with a 200 too (createWebhookHandler). The rows prove the rest.
  expect(delivery.status).toBe(200);

  const [purchase] = await dbHttp
    .select()
    .from(schema.purchases)
    .where(eq(schema.purchases.stripePaymentIntentId, paid.paymentIntentId));
  expect(purchase).toMatchObject({
    customerId: user.id,
    contentId,
    organizationId,
    status: 'completed',
    amountPaidCents: PRICE_CENTS,
    currency: 'gbp',
    platformFeeCents: SPLIT.platform_fee,
    organizationFeeCents: SPLIT.organization_fee,
    creatorPayoutCents: SPLIT.creator_payout,
  });
  const sale = {
    buyerCookie: cookie,
    purchaseId: purchase!.id,
    chargeId: paid.chargeId,
  };

  expect((await entitlementOf(sale.purchaseId)).revokedAt).toBeNull();
  expect(await streamStatus(cookie)).toBe(200);

  // One row per slice, keyed on pi.latest_charge, summing to the price. The
  // platform keeps its fee; the creator's slice and the organisation's (the
  // creator owns the organisation) wait for an account that can be paid.
  const rows = await ledgerOf(sale);
  expect(
    rows.map((row) => ({
      payoutType: row.payoutType,
      amountCents: row.amountCents,
      status: row.status,
      reason: row.reason,
      userId: row.userId,
    }))
  ).toEqual(
    expect.arrayContaining([
      {
        payoutType: 'platform_fee',
        amountCents: SPLIT.platform_fee,
        status: 'paid',
        reason: null,
        userId: null,
      },
      {
        payoutType: 'organization_fee',
        amountCents: SPLIT.organization_fee,
        status: 'pending',
        reason: 'connect_restricted',
        userId: creatorId,
      },
      {
        payoutType: 'creator_payout',
        amountCents: SPLIT.creator_payout,
        status: 'pending',
        reason: 'connect_restricted',
        userId: creatorId,
      },
    ])
  );
  expect(rows).toHaveLength(3);
  expect(rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(PRICE_CENTS);

  return sale;
}

/**
 * Refund the sale's charge in Stripe and deliver the signed charge.refunded
 * Stripe sends for it, carrying the charge as Stripe now holds it.
 */
async function refund(sale: Sale, amountCents?: number) {
  const issued = await refundCharge(stripe, {
    chargeId: sale.chargeId,
    amountCents,
  });
  const charge = await stripe.charges.retrieve(sale.chargeId);
  const delivery = await sendSignedWebhook(
    `${WORKER_URLS.ecom}/webhooks/stripe/payment`,
    createStripeEvent('charge.refunded', charge),
    paymentSecret
  );
  expect(delivery.status).toBe(200);

  const [recorded] = await dbHttp
    .select()
    .from(schema.refunds)
    .where(eq(schema.refunds.stripeRefundId, issued.id));
  expect(recorded).toMatchObject({
    stripeChargeId: sale.chargeId,
    purchaseId: sale.purchaseId,
    amountCents: issued.amount,
    currency: 'gbp',
    status: 'succeeded',
    reason: 'requested_by_customer',
  });
  return issued;
}

describe('One-off purchase and refund round trips (real Stripe test mode)', () => {
  beforeAll(async () => {
    stripe = testModeStripe();
    bookingSecret = webhookSecret('STRIPE_WEBHOOK_SECRET_BOOKING');
    paymentSecret = webhookSecret('STRIPE_WEBHOOK_SECRET_PAYMENT');

    const creator = await authFixture.registerUser({
      email: ctx.email('creator'),
      password: PASSWORD,
      name: ctx.name('Creator'),
      role: 'creator',
    });
    creatorId = creator.user.id;

    const orgResponse = await httpClient.post(
      `${WORKER_URLS.organization}/api/organizations`,
      {
        headers: jsonHeaders(creator.cookie, WORKER_URLS.organization),
        data: { name: ctx.name('Refund Org'), slug: ctx.slug('refund-org') },
      }
    );
    await expectSuccessResponse(orgResponse, 201);
    organizationId = unwrapApiResponse(await orgResponse.json()).id;

    const mediaResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/media`,
      {
        headers: jsonHeaders(creator.cookie, WORKER_URLS.content),
        data: {
          title: ctx.name('Refund Media'),
          mediaType: 'video',
          fileSizeBytes: 1048576,
          mimeType: 'video/mp4',
        },
      }
    );
    await expectSuccessResponse(mediaResponse, 201);
    const media = unwrapApiResponse(await mediaResponse.json());
    await markVideoReady(media.id, {
      hlsMasterPlaylistKey: `e2e/hls/${ctx.id('refund')}/master.m3u8`,
      thumbnailKey: `e2e/thumbnails/${ctx.id('refund')}/thumb.jpg`,
      durationSeconds: 300,
    });

    const contentResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/content`,
      {
        headers: jsonHeaders(creator.cookie, WORKER_URLS.content),
        data: {
          title: ctx.name('Refund Course'),
          slug: ctx.slug('refund-course'),
          contentType: 'video',
          mediaItemId: media.id,
          organizationId,
          accessType: 'paid',
          priceCents: PRICE_CENTS,
          isPurchasable: true,
        },
      }
    );
    await expectSuccessResponse(contentResponse, 201);
    contentId = unwrapApiResponse(await contentResponse.json()).id;

    // Payable at publish: priced content needs it (requiresPayoutsToPublish).
    // The row is the app's for an account that finished onboarding. The
    // account is real, so a refund's late-transfer lookup gets production's
    // answer rather than an error alert (createUnverifiedConnectAccount).
    connectAccountId = await createUnverifiedConnectAccount(stripe, creatorId);
    await dbHttp.insert(schema.stripeConnectAccounts).values({
      userId: creatorId,
      stripeAccountId: connectAccountId,
      status: 'active',
      chargesEnabled: true,
      payoutsEnabled: true,
      onboardingCompletedAt: new Date(),
    });
    const publishResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/content/${contentId}/publish`,
      { headers: jsonHeaders(creator.cookie, WORKER_URLS.content) }
    );
    await expectSuccessResponse(publishResponse);

    // Then it stops being payable, as the account really is: Stripe has not
    // enabled charges on it. That is the row account.updated leaves.
    await dbHttp
      .update(schema.stripeConnectAccounts)
      .set({
        status: 'restricted',
        chargesEnabled: false,
        payoutsEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(schema.stripeConnectAccounts.userId, creatorId));
  }, 120_000);

  afterAll(async () => {
    try {
      if (connectAccountId) {
        await deleteConnectAccount(stripe, connectAccountId);
      }
    } finally {
      await closeDbPool();
    }
  });

  test('a full refund ends access, cancels the unpaid slices and keeps the platform fee', async () => {
    const sale = await buy('full');
    const issued = await refund(sale);

    expect(await purchaseOf(sale.purchaseId)).toMatchObject({
      status: 'refunded',
      refundAmountCents: PRICE_CENTS,
      stripeRefundId: issued.id,
      refundReason: 'requested_by_customer',
    });
    expect((await purchaseOf(sale.purchaseId)).refundedAt).not.toBeNull();

    // Access ends: the entitlement is revoked and no new stream is issued.
    expect((await entitlementOf(sale.purchaseId)).revokedAt).not.toBeNull();
    expect(await streamStatus(sale.buyerCookie)).toBe(403);

    // Rows keep their gross; the unpaid slices are cancelled whole, and the
    // fee's whole share is retained, which reverses its row.
    const rows = await ledgerOf(sale);
    expect(slices(rows)).toEqual({
      platform_fee: { amountCents: SPLIT.platform_fee, status: 'reversed' },
      organization_fee: {
        amountCents: SPLIT.organization_fee,
        status: 'cancelled_by_refund',
      },
      creator_payout: {
        amountCents: SPLIT.creator_payout,
        status: 'cancelled_by_refund',
      },
    });
    expect(await stepsOf(issued.id, rows)).toEqual({
      platform_fee: {
        kind: 'retained_fee',
        amountCents: SPLIT.platform_fee,
        status: 'done',
      },
      organization_fee: {
        kind: 'cancellation',
        amountCents: SPLIT.organization_fee,
        status: 'done',
      },
      creator_payout: {
        kind: 'cancellation',
        amountCents: SPLIT.creator_payout,
        status: 'done',
      },
    });
  }, 180_000);

  test('a partial refund keeps access and reduces each unpaid slice by its share, rounded down', async () => {
    const sale = await buy('partial');
    const issued = await refund(sale, PARTIAL_REFUND_CENTS);

    expect(await purchaseOf(sale.purchaseId)).toMatchObject({
      status: 'completed',
      refundAmountCents: PARTIAL_REFUND_CENTS,
      stripeRefundId: issued.id,
      refundReason: 'requested_by_customer',
    });

    // The buyer keeps access (owner decision P-1).
    expect((await entitlementOf(sale.purchaseId)).revokedAt).toBeNull();
    expect(await streamStatus(sale.buyerCookie)).toBe(200);

    // Rows keep their gross and their status; each share is recorded
    // against its slice, and a drain pays a pending slice less its reductions.
    const rows = await ledgerOf(sale);
    expect(slices(rows)).toEqual({
      platform_fee: { amountCents: SPLIT.platform_fee, status: 'paid' },
      organization_fee: {
        amountCents: SPLIT.organization_fee,
        status: 'pending',
      },
      creator_payout: { amountCents: SPLIT.creator_payout, status: 'pending' },
    });
    const steps = await stepsOf(issued.id, rows);
    expect(steps).toEqual({
      platform_fee: {
        kind: 'retained_fee',
        amountCents: PARTIAL_SHARES.platform_fee,
        status: 'done',
      },
      organization_fee: {
        kind: 'pending_reduction',
        amountCents: PARTIAL_SHARES.organization_fee,
        status: 'done',
      },
      creator_payout: {
        kind: 'pending_reduction',
        amountCents: PARTIAL_SHARES.creator_payout,
        status: 'done',
      },
    });
    const taken = Object.values(steps).reduce(
      (sum, step) => sum + step.amountCents,
      0
    );
    expect(PARTIAL_REFUND_CENTS - taken).toBe(1);
  }, 180_000);
});
