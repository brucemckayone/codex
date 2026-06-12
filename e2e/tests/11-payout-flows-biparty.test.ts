/**
 * E2E Test: Bi-party (orgless) payout flows — Codex-69t7c WP11
 *
 * Covers the complete bi-party purchase-payout lifecycle for content whose
 * organizationId is NULL (direct creator-to-buyer, no org intermediary):
 *
 * Flow A — happy path:
 *   1. Creator onboards via POST /connect/me/onboard (records a stripeConnectAccounts
 *      row with status='onboarding'; the account is not yet active, so
 *      creator_payout rows land in status='pending' per the connect_not_ready
 *      branch in writePurchasePayouts).
 *   2. Creator publishes paid content with organizationId=null (orgless).
 *   3. Buyer purchases the content via Stripe webhook.
 *   4. Assert TWO payout rows written: platform_fee (status=paid) +
 *      creator_payout (status=pending, reason=connect_not_ready).
 *   5. Assert the creator's /subscriptions/me/payouts and
 *      /subscriptions/me/earnings-summary surface the pending payout.
 *   6. Refund the purchase via charge.refunded webhook.
 *   7. Assert BOTH payout rows are reversed/cancelled:
 *      - platform_fee  → status='reversed'
 *      - creator_payout pending → status='cancelled_by_refund'
 *
 * WP11 acceptance: bi-party (orgless) purchase → two payout rows →
 * visible on /me/payouts → refund reverses both.
 *
 * Env skip-gate: tests that exercise the full webhook pipeline require
 * STRIPE_WEBHOOK_SECRET_BOOKING and STRIPE_WEBHOOK_SECRET_PAYMENT.
 * Without these the worker rejects the HMAC signature before any payout
 * logic runs. Tests skip cleanly rather than passing hollow.
 */

import { closeDbPool, dbHttp, schema } from '@codex/database';
import {
  authFixture,
  expectSuccessResponse,
  httpClient,
  unwrapApiResponse,
} from '@codex/test-utils/e2e';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  createCheckoutCompletedEvent,
  generateStripeSignature,
  sendSignedWebhook,
} from '../helpers/stripe-webhook';
import { createScopedTestContext } from '../helpers/test-isolation';
import { WORKER_URLS } from '../helpers/worker-urls';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a charge.refunded Stripe event payload (minimal shape required by handler). */
function createChargeRefundedEvent(params: {
  paymentIntentId: string;
  chargeId: string;
  amountRefundedCents: number;
  stripeRefundId: string;
}) {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    id: `evt_test_refund_${timestamp}_${Math.random().toString(36).slice(2)}`,
    object: 'event' as const,
    api_version: '2025-10-29.clover',
    created: timestamp,
    livemode: false,
    type: 'charge.refunded' as const,
    data: {
      object: {
        id: params.chargeId,
        object: 'charge' as const,
        payment_intent: params.paymentIntentId,
        amount: params.amountRefundedCents,
        amount_refunded: params.amountRefundedCents,
        currency: 'gbp',
        refunds: {
          data: [
            {
              id: params.stripeRefundId,
              object: 'refund' as const,
              amount: params.amountRefundedCents,
              currency: 'gbp',
              reason: 'requested_by_customer',
            },
          ],
        },
      },
    },
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  } as const;
}

/**
 * Send any Stripe event (not just checkout.session.completed) with a valid
 * HMAC signature. sendSignedWebhook is typed to StripeCheckoutWebhookEvent;
 * this helper accepts any serialisable object so we can send charge.refunded,
 * account.updated, etc.
 */
async function sendSignedWebhookRaw(
  url: string,
  event: unknown,
  secret: string
): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const signature = generateStripeSignature(rawBody, secret);
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': signature,
    },
    body: rawBody,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Bi-party (orgless) payout flows', () => {
  afterAll(async () => {
    await closeDbPool();
  });

  test('should write platform_fee + creator_payout rows on orgless purchase, surface on /me/payouts, then reverse on refund', async () => {
    // ── Env skip-gate ────────────────────────────────────────────────────────
    // Both webhook secrets are required. Without them the worker rejects the
    // HMAC signature before any payout logic runs.
    const bookingSecret = process.env.STRIPE_WEBHOOK_SECRET_BOOKING;
    const paymentSecret = process.env.STRIPE_WEBHOOK_SECRET_PAYMENT;
    if (!bookingSecret || !paymentSecret) {
      test.skip();
      return;
    }

    const ctx = createScopedTestContext();

    // ======================================================================
    // Step 1: Register creator + onboard Stripe Connect (POST /connect/me/onboard)
    // ======================================================================
    const { cookie: creatorCookie, user: creator } =
      await authFixture.registerUser({
        email: ctx.email('creator'),
        password: 'SecurePassword123!',
        name: ctx.name('Creator'),
        role: 'creator',
      });

    // Onboard via /connect/me/onboard. This creates a stripeConnectAccounts row
    // with status='onboarding' so subsequent payout writes land as 'pending'
    // (connect_not_ready) until the Connect account activates.
    const onboardResponse = await httpClient.post(
      `${WORKER_URLS.ecom}/connect/me/onboard`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.ecom,
        },
        data: {
          returnUrl: 'http://localhost:5173/studio/earnings?connect=success',
          refreshUrl: 'http://localhost:5173/studio/earnings?connect=refresh',
        },
      }
    );
    // 201 or 200 — the route returns successStatus: 201 on create, service
    // may return 200 on reuse. Accept both.
    expect([200, 201]).toContain(onboardResponse.status);
    const onboardData = await onboardResponse.json();
    const onboard = unwrapApiResponse(onboardData);
    expect(onboard).toBeDefined();

    // Assert the stripeConnectAccounts row was created — this is mandatory.
    // Without the row the payout pipeline cannot write a pending creator_payout.
    const [connectRow] = await dbHttp
      .select({
        id: schema.stripeConnectAccounts.id,
        stripeAccountId: schema.stripeConnectAccounts.stripeAccountId,
        status: schema.stripeConnectAccounts.status,
      })
      .from(schema.stripeConnectAccounts)
      .where(eq(schema.stripeConnectAccounts.userId, creator.id))
      .limit(1);
    expect(connectRow).toBeDefined();
    expect(connectRow?.id).toBeDefined();
    // Row must be in 'onboarding' state (not active) so creator_payout lands as pending
    expect(connectRow?.status).toBe('onboarding');

    // ======================================================================
    // Step 2: Create and publish orgless paid content (organizationId = null)
    // ======================================================================
    const testMediaId = ctx.id(`media-${Date.now()}`);

    const mediaResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/media`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          title: ctx.name('Test Media'),
          mediaType: 'video',
          r2Key: `e2e/originals/${testMediaId}/original.mp4`,
          fileSizeBytes: 1048576,
          mimeType: 'video/mp4',
        },
      }
    );
    await expectSuccessResponse(mediaResponse, 201);
    const media = unwrapApiResponse(await mediaResponse.json());

    // Mark media ready (skips transcoding in E2E)
    await httpClient.patch(`${WORKER_URLS.content}/api/media/${media.id}`, {
      headers: {
        Cookie: creatorCookie,
        'Content-Type': 'application/json',
        Origin: WORKER_URLS.content,
      },
      data: {
        status: 'ready',
        hlsMasterPlaylistKey: `e2e/hls/${testMediaId}/master.m3u8`,
        thumbnailKey: `e2e/thumbnails/${testMediaId}/thumb.jpg`,
        durationSeconds: 300,
      },
    });

    // Create content WITHOUT organizationId → orgless (bi-party)
    const contentResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/content`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          title: ctx.name('Orgless Paid Content'),
          contentType: 'video',
          visibility: 'public',
          pricingType: 'paid',
          priceCents: 1999, // £19.99
          currency: 'gbp',
          mediaItemId: media.id,
          // organizationId intentionally omitted → null in DB (bi-party)
        },
      }
    );
    await expectSuccessResponse(contentResponse, 201);
    const content = unwrapApiResponse(await contentResponse.json());
    expect(content.id).toBeDefined();
    // Verify the content is actually orgless in the DB
    const [contentRow] = await dbHttp
      .select({ organizationId: schema.content.organizationId })
      .from(schema.content)
      .where(eq(schema.content.id, content.id))
      .limit(1);
    expect(contentRow?.organizationId).toBeNull();

    // Publish the content
    const publishResponse = await httpClient.patch(
      `${WORKER_URLS.content}/api/content/${content.id}`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: { status: 'published' },
      }
    );
    await expectSuccessResponse(publishResponse);

    // ======================================================================
    // Step 3: Register buyer + complete purchase via Stripe webhook
    // ======================================================================
    const { user: buyer } = await authFixture.registerUser({
      email: ctx.email('buyer'),
      password: 'SecurePassword123!',
      name: ctx.name('Buyer'),
      role: 'customer',
    });

    const paymentIntentId = `pi_test_biparty_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const chargeId = `ch_test_biparty_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const amountCents = 1999;

    // Build checkout.session.completed event with organizationId omitted
    // (bi-party: the metadata schema strips it when null per WP5).
    const webhookEvent = createCheckoutCompletedEvent({
      sessionId: `cs_test_biparty_${Date.now()}`,
      paymentIntentId,
      customerId: buyer.id,
      contentId: content.id,
      amountCents,
      organizationId: null, // orgless — WP5 path
    });

    const webhookResponse = await sendSignedWebhook(
      `${WORKER_URLS.ecom}/webhooks/stripe/booking`,
      webhookEvent,
      bookingSecret
    );
    expect(webhookResponse.status).toBe(200);
    const webhookResult = await webhookResponse.json();
    expect(webhookResult.received).toBe(true);

    // ======================================================================
    // Step 4: Verify purchase record in DB
    // ======================================================================
    const [purchase] = await dbHttp
      .select()
      .from(schema.purchases)
      .where(
        and(
          eq(schema.purchases.customerId, buyer.id),
          eq(schema.purchases.contentId, content.id)
        )
      )
      .limit(1);

    expect(purchase).toBeDefined();
    if (!purchase) throw new Error('purchase not found — test setup failed');
    expect(purchase.status).toBe('completed');
    expect(purchase.amountPaidCents).toBe(amountCents);
    // Orgless purchase: no organizationId
    expect(purchase.organizationId).toBeNull();

    // ======================================================================
    // Step 5: Assert EXACTLY 2 payout rows — platform_fee + creator_payout
    //         (unconditional — this is the core acceptance criterion)
    // ======================================================================
    // Webhooks are HMAC-signed locally; no live Stripe key is required for
    // the payout-row write path. Two rows are the non-negotiable AC:
    // - Absence means the payout pipeline is broken.
    // - An extra row means an erroneous organization_fee was written on an
    //   orgless purchase (regression in org-scoping logic).
    const payoutRows = await dbHttp
      .select()
      .from(schema.payouts)
      .where(eq(schema.payouts.purchaseId, purchase.id));

    expect(payoutRows).toHaveLength(2);

    const platformFeeRow = payoutRows.find(
      (r) => r.payoutType === 'platform_fee'
    );
    const creatorPayoutRow = payoutRows.find(
      (r) => r.payoutType === 'creator_payout'
    );

    expect(platformFeeRow).toBeDefined();
    expect(creatorPayoutRow).toBeDefined();

    // platform_fee: retained on platform balance → status='paid'
    expect(platformFeeRow?.status).toBe('paid');
    // userId is null for platform_fee rows (platform isn't a user)
    expect(platformFeeRow?.userId).toBeNull();
    // organizationId is null for orgless purchases
    expect(platformFeeRow?.organizationId).toBeNull();
    expect(platformFeeRow?.sourceType).toBe('purchase');
    expect(platformFeeRow?.amountCents).toBeGreaterThan(0);

    // creator_payout: Connect account is onboarding (not active) → pending
    // The connect_not_ready reason is set by writePurchasePayouts when the
    // creator's Connect row exists but chargesEnabled=false.
    expect(creatorPayoutRow?.status).toBe('pending');
    expect(creatorPayoutRow?.reason).toBe('connect_not_ready');
    expect(creatorPayoutRow?.userId).toBe(creator.id);
    expect(creatorPayoutRow?.organizationId).toBeNull();
    expect(creatorPayoutRow?.sourceType).toBe('purchase');
    expect(creatorPayoutRow?.amountCents).toBeGreaterThan(0);

    // platform_fee + creator_payout must sum to at most amountCents
    const total =
      (platformFeeRow?.amountCents ?? 0) + (creatorPayoutRow?.amountCents ?? 0);
    expect(total).toBeLessThanOrEqual(amountCents);
    expect(total).toBeGreaterThan(0);

    // ======================================================================
    // Step 6: Assert payout visible on creator's /me/payouts endpoint
    // ======================================================================
    const myPayoutsResponse = await httpClient.get(
      `${WORKER_URLS.ecom}/subscriptions/me/payouts`,
      {
        headers: {
          Cookie: creatorCookie,
          Origin: WORKER_URLS.ecom,
        },
      }
    );
    await expectSuccessResponse(myPayoutsResponse);
    const myPayoutsData = await myPayoutsResponse.json();
    // Response is paginated: { items: [...], pagination: {...} }
    expect(myPayoutsData.items).toBeDefined();
    expect(Array.isArray(myPayoutsData.items)).toBe(true);

    const myPayoutRow = myPayoutsData.items.find(
      (p: { purchaseId?: string }) => p.purchaseId === purchase.id
    );
    expect(myPayoutRow).toBeDefined();

    // Earnings summary: totalEarnedCents must be >= the creator's payout amount
    // (covers both pending and paid creator rows, not just >0)
    const summaryResponse = await httpClient.get(
      `${WORKER_URLS.ecom}/subscriptions/me/earnings-summary`,
      {
        headers: {
          Cookie: creatorCookie,
          Origin: WORKER_URLS.ecom,
        },
      }
    );
    await expectSuccessResponse(summaryResponse);
    const summaryData = await summaryResponse.json();
    const summary = unwrapApiResponse(summaryData);
    // totalEarnedCents must be at least the creator's payout amount
    expect(summary.totalEarnedCents).toBeGreaterThanOrEqual(
      creatorPayoutRow?.amountCents
    );

    // ======================================================================
    // Step 7: Refund → assert BOTH payout rows reversed/cancelled
    //         (unconditional — this is the core refund-reversal AC)
    // ======================================================================
    const stripeRefundId = `re_test_biparty_${Date.now()}`;
    const refundEvent = createChargeRefundedEvent({
      paymentIntentId,
      chargeId,
      amountRefundedCents: amountCents,
      stripeRefundId,
    });

    const refundWebhookResponse = await sendSignedWebhookRaw(
      `${WORKER_URLS.ecom}/webhooks/stripe/payment`,
      refundEvent,
      paymentSecret
    );
    expect(refundWebhookResponse.status).toBe(200);
    const refundResult = await refundWebhookResponse.json();
    expect(refundResult.received).toBe(true);

    // Verify purchase status updated to refunded
    const [refundedPurchase] = await dbHttp
      .select({ status: schema.purchases.status })
      .from(schema.purchases)
      .where(eq(schema.purchases.id, purchase.id))
      .limit(1);
    expect(refundedPurchase?.status).toBe('refunded');

    // Verify payout rows reversed — BOTH must be in a terminal refund state
    const reversedPayoutRows = await dbHttp
      .select()
      .from(schema.payouts)
      .where(eq(schema.payouts.purchaseId, purchase.id));

    const reversedPlatformFee = reversedPayoutRows.find(
      (r) => r.payoutType === 'platform_fee'
    );
    const reversedCreatorPayout = reversedPayoutRows.find(
      (r) => r.payoutType === 'creator_payout'
    );

    // platform_fee (was paid) → 'reversed'
    expect(reversedPlatformFee?.status).toBe('reversed');
    // creator_payout (was pending/connect_not_ready) → 'cancelled_by_refund'
    expect(reversedCreatorPayout?.status).toBe('cancelled_by_refund');
  }, 300_000); // 5 min — mirrors 04-paid-content-purchase

  test('creator /connect/me/status returns 200 with isConnected field', async () => {
    const ctx = createScopedTestContext();

    const { cookie: creatorCookie } = await authFixture.registerUser({
      email: ctx.email('creator-status'),
      password: 'SecurePassword123!',
      name: ctx.name('Creator Status'),
      role: 'creator',
    });

    // GET /connect/me/status — no Connect account yet → isConnected=false
    const statusResponse = await httpClient.get(
      `${WORKER_URLS.ecom}/connect/me/status`,
      {
        headers: {
          Cookie: creatorCookie,
          Origin: WORKER_URLS.ecom,
        },
      }
    );
    await expectSuccessResponse(statusResponse);
    const statusData = await statusResponse.json();
    const status = unwrapApiResponse(statusData);

    // Shape contract: must have isConnected boolean
    expect(typeof status.isConnected).toBe('boolean');
    // Fresh creator has no Connect account → not connected
    expect(status.isConnected).toBe(false);
  }, 60_000);

  test('creator cannot read another creator payouts via /me/payouts (IDOR prevention)', async () => {
    const ctx = createScopedTestContext();

    const { cookie: creatorACookie, user: creatorA } =
      await authFixture.registerUser({
        email: ctx.email('creator-a'),
        password: 'SecurePassword123!',
        name: ctx.name('Creator A'),
        role: 'creator',
      });
    const { user: creatorB } = await authFixture.registerUser({
      email: ctx.email('creator-b'),
      password: 'SecurePassword123!',
      name: ctx.name('Creator B'),
      role: 'creator',
    });

    // Seed a real payout row for creator B so there is concrete data to
    // potentially leak. Uses status='pending' (no stripeTransferId or
    // stripeChargeId required by the DB CHECK constraint for pending rows).
    await dbHttp.insert(schema.payouts).values({
      userId: creatorB.id,
      organizationId: null,
      purchaseId: null,
      amountCents: 500,
      payoutType: 'creator_payout',
      status: 'pending',
      reason: 'connect_not_ready',
      sourceType: 'purchase',
    });

    // Fetch creator B's seeded payout row ID so we can assert A doesn't see it
    const [bPayoutRow] = await dbHttp
      .select({ id: schema.payouts.id, userId: schema.payouts.userId })
      .from(schema.payouts)
      .where(
        and(
          eq(schema.payouts.userId, creatorB.id),
          eq(schema.payouts.amountCents, 500)
        )
      )
      .limit(1);
    expect(bPayoutRow).toBeDefined();
    expect(bPayoutRow?.userId).toBe(creatorB.id);

    // Creator A fetches /me/payouts — must NOT contain creator B's row
    const aResponse = await httpClient.get(
      `${WORKER_URLS.ecom}/subscriptions/me/payouts`,
      {
        headers: {
          Cookie: creatorACookie,
          Origin: WORKER_URLS.ecom,
        },
      }
    );
    await expectSuccessResponse(aResponse);
    const aData = await aResponse.json();
    expect(aData.items).toBeDefined();
    expect(Array.isArray(aData.items)).toBe(true);

    // IDOR assertion: creator A must not see creator B's payout row
    const leak = aData.items.find(
      (p: { id?: string; userId?: string }) =>
        p.id === bPayoutRow?.id || p.userId === creatorB.id
    );
    expect(leak).toBeUndefined();

    // All items returned to creator A must belong to creator A
    for (const item of aData.items as Array<{ userId?: string }>) {
      expect(item.userId).toBe(creatorA.id);
    }

    // Unauthenticated request must be rejected
    const unauthResponse = await httpClient.get(
      `${WORKER_URLS.ecom}/subscriptions/me/payouts`,
      {
        headers: {
          Origin: WORKER_URLS.ecom,
        },
      }
    );
    expect(unauthResponse.status).toBe(401);
  }, 60_000);
});
