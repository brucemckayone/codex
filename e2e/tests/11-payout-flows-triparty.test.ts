/**
 * E2E Test: Tri-party agreement payout flows — Codex-69t7c WP11
 *
 * Covers the in-org agreement payout lifecycle:
 *
 * Flow B — tri-party (org ↔ creator agreement):
 *   1. Org owner creates an organization and onboards Stripe Connect
 *      (POST /connect/onboard for the org). We also seed the org's
 *      primaryConnectAccountUserId and a chargesEnabled Connect account
 *      so organization_fee rows ARE written.
 *   2. Creator joins the org and the owner proposes a revenue-share
 *      agreement (POST /agreements/propose).
 *   3. Creator accepts the agreement (POST /agreements/:id/accept).
 *   4. A purchase is completed via Stripe webhook. With an active agreement
 *      and a chargesEnabled org Connect account, writePurchasePayouts writes:
 *        - platform_fee   (status=paid)
 *        - creator_payout (status=pending, reason=connect_not_ready)
 *        - organization_fee (status=paid with live Stripe key, status=failed locally)
 *   5. Assert EXACTLY 3 payout rows.
 *   6. Simulate account.updated webhook (chargesEnabled=true, payoutsEnabled=true)
 *      for the CREATOR's Connect account → assert creator_payout transitions
 *      to status='paid' (resolvePendingPayouts exercise — AC-b).
 *   7. Assert the creator's /subscriptions/me/payouts returns the row.
 *   8. Assert the org owner's /subscriptions/payouts returns the org row.
 *
 * WP11 acceptance: in-org agreement purchase → three payout rows →
 * creator sees own row on /me/payouts, org owner sees org rows on /payouts.
 * Creator's pending row transitions to paid on Connect activation (AC-b).
 *
 * Env skip-gate: STRIPE_WEBHOOK_SECRET_BOOKING and
 * STRIPE_WEBHOOK_SECRET_CONNECT are required for the payout pipeline and
 * the account.updated simulation respectively. Tests skip cleanly without them.
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

/**
 * Send any Stripe event with a valid HMAC signature.
 * sendSignedWebhook is typed to StripeCheckoutWebhookEvent; this helper
 * accepts any serialisable object for connect and other event types.
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

/**
 * Build an account.updated event with chargesEnabled=true + payoutsEnabled=true
 * for the given stripeAccountId and orgId (in metadata).
 * Sending this to /webhooks/stripe/connect triggers resolvePendingPayouts.
 */
function createAccountUpdatedEvent(params: {
  stripeAccountId: string;
  orgId: string;
}) {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    id: `evt_test_acct_${timestamp}_${Math.random().toString(36).slice(2)}`,
    object: 'event' as const,
    api_version: '2025-10-29.clover',
    created: timestamp,
    livemode: false,
    type: 'account.updated' as const,
    account: params.stripeAccountId,
    data: {
      object: {
        id: params.stripeAccountId,
        object: 'account' as const,
        charges_enabled: true,
        payouts_enabled: true,
        metadata: {
          codex_organization_id: params.orgId,
        },
        // Minimal required fields
        type: 'express',
        country: 'GB',
        default_currency: 'gbp',
        details_submitted: true,
        requirements: { disabled_reason: null, errors: [] },
      },
    },
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  } as const;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Tri-party (in-org agreement) payout flows', () => {
  afterAll(async () => {
    await closeDbPool();
  });

  test('should write platform_fee + creator_payout + organization_fee rows for in-org purchase, then release creator_payout on Connect activation', async ({
    skip,
  }) => {
    // ── Env skip-gate ────────────────────────────────────────────────────────
    // Runtime skip via the test context (`ctx.skip()`). `test.skip()` is the
    // collection-time chained modifier; calling it inside a running test body
    // throws "Calling the test function inside another test function" and, with
    // CI bail:1, aborts the entire e2e:api suite (Codex-730tq.9).
    const bookingSecret = process.env.STRIPE_WEBHOOK_SECRET_BOOKING;
    const connectSecret = process.env.STRIPE_WEBHOOK_SECRET_CONNECT;
    if (!bookingSecret || !connectSecret) {
      skip();
      return;
    }

    const ctx = createScopedTestContext();

    // ======================================================================
    // Step 1: Register org owner + create org
    // ======================================================================
    const { cookie: ownerCookie, user: owner } = await authFixture.registerUser(
      {
        email: ctx.email('owner'),
        password: 'SecurePassword123!',
        name: ctx.name('Org Owner'),
        role: 'creator',
      }
    );

    const orgResponse = await httpClient.post(
      `${WORKER_URLS.organization}/api/organizations`,
      {
        headers: {
          Cookie: ownerCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.organization,
        },
        data: {
          name: ctx.name('Test Org'),
          slug: ctx.slug(`org-${Date.now()}`),
          description: 'Tri-party payout E2E org',
        },
      }
    );
    await expectSuccessResponse(orgResponse, 201);
    const organization = unwrapApiResponse(await orgResponse.json());
    expect(organization.id).toBeDefined();

    // ======================================================================
    // Step 2: Seed org Connect account with chargesEnabled=true so that
    //         organization_fee rows ARE written (not just pending).
    //         The /connect/onboard route may fail Stripe-side without a live key,
    //         so we seed directly into the DB and wire primaryConnectAccountUserId.
    // ======================================================================
    const orgStripeAccountId = `acct_test_org_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Insert an active Connect account for the org owner
    await dbHttp.insert(schema.stripeConnectAccounts).values({
      userId: owner.id,
      organizationId: organization.id,
      stripeAccountId: orgStripeAccountId,
      status: 'active',
      chargesEnabled: true,
      payoutsEnabled: true,
      onboardingCompletedAt: new Date(),
    });

    // Wire the org's primaryConnectAccountUserId so writePurchasePayouts
    // can resolve the org's Connect account and write the organization_fee row.
    await dbHttp
      .update(schema.organizations)
      .set({ primaryConnectAccountUserId: owner.id })
      .where(eq(schema.organizations.id, organization.id));

    // ======================================================================
    // Step 3: Register creator + add to org as member
    // ======================================================================
    const { cookie: creatorCookie, user: creator } =
      await authFixture.registerUser({
        email: ctx.email('creator'),
        password: 'SecurePassword123!',
        name: ctx.name('Creator'),
        role: 'creator',
      });

    await dbHttp.insert(schema.organizationMemberships).values({
      organizationId: organization.id,
      userId: creator.id,
      role: 'creator',
      status: 'active',
      invitedBy: owner.id,
    });

    // ======================================================================
    // Step 4: Creator onboards their personal Connect account (status=onboarding)
    //         so that creator_payout is written as pending/connect_not_ready.
    // ======================================================================
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
    expect([200, 201]).toContain(onboardResponse.status);

    // Assert the creator's Connect row was created in onboarding state
    const [creatorConnectRow] = await dbHttp
      .select({
        id: schema.stripeConnectAccounts.id,
        stripeAccountId: schema.stripeConnectAccounts.stripeAccountId,
        status: schema.stripeConnectAccounts.status,
      })
      .from(schema.stripeConnectAccounts)
      .where(eq(schema.stripeConnectAccounts.userId, creator.id))
      .limit(1);
    expect(creatorConnectRow).toBeDefined();
    expect(creatorConnectRow?.status).toBe('onboarding');
    const creatorStripeAccountId = creatorConnectRow?.stripeAccountId;

    // ======================================================================
    // Step 5: Propose revenue-share agreement (owner → creator)
    // ======================================================================
    const proposeResponse = await httpClient.post(
      `${WORKER_URLS.ecom}/agreements/propose?organizationId=${organization.id}`,
      {
        headers: {
          Cookie: ownerCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.ecom,
        },
        data: {
          creatorId: creator.id,
          revenueType: 'content_purchase',
          // 70% to creator (post-platform basis points: 7000 / 10000)
          creatorShareBps: 7000,
          notes: 'E2E test agreement',
        },
      }
    );
    await expectSuccessResponse(proposeResponse, 201);
    const proposalData = await proposeResponse.json();
    const proposal = unwrapApiResponse(proposalData);
    expect(proposal.id).toBeDefined();
    const proposalId = proposal.id;

    // ======================================================================
    // Step 6: Creator accepts the agreement
    // ======================================================================
    const acceptResponse = await httpClient.post(
      `${WORKER_URLS.ecom}/agreements/${proposalId}/accept`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.ecom,
        },
        data: {},
      }
    );
    await expectSuccessResponse(acceptResponse);

    // Verify agreement is now active in DB
    const [agreementRow] = await dbHttp
      .select({
        id: schema.creatorOrganizationAgreements.id,
        status: schema.creatorOrganizationAgreements.status,
      })
      .from(schema.creatorOrganizationAgreements)
      .where(
        and(
          eq(
            schema.creatorOrganizationAgreements.organizationId,
            organization.id
          ),
          eq(schema.creatorOrganizationAgreements.creatorId, creator.id)
        )
      )
      .limit(1);

    expect(agreementRow).toBeDefined();
    expect(agreementRow?.status).toBe('active');

    // ======================================================================
    // Step 7: Creator publishes paid content under the org
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
          fileSizeBytes: 2097152,
          mimeType: 'video/mp4',
        },
      }
    );
    await expectSuccessResponse(mediaResponse, 201);
    const media = unwrapApiResponse(await mediaResponse.json());

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
        durationSeconds: 600,
      },
    });

    const contentResponse = await httpClient.post(
      `${WORKER_URLS.content}/api/content`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.content,
        },
        data: {
          title: ctx.name('Tri-party Paid Content'),
          contentType: 'video',
          visibility: 'public',
          pricingType: 'paid',
          priceCents: 2999, // £29.99
          currency: 'gbp',
          mediaItemId: media.id,
          organizationId: organization.id, // in-org content
        },
      }
    );
    await expectSuccessResponse(contentResponse, 201);
    const content = unwrapApiResponse(await contentResponse.json());

    await httpClient.patch(`${WORKER_URLS.content}/api/content/${content.id}`, {
      headers: {
        Cookie: creatorCookie,
        'Content-Type': 'application/json',
        Origin: WORKER_URLS.content,
      },
      data: { status: 'published' },
    });

    // ======================================================================
    // Step 8: Buyer purchases the content via Stripe webhook
    // ======================================================================
    const { user: buyer } = await authFixture.registerUser({
      email: ctx.email('buyer'),
      password: 'SecurePassword123!',
      name: ctx.name('Buyer'),
      role: 'customer',
    });

    const paymentIntentId = `pi_test_triparty_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const amountCents = 2999;

    const webhookEvent = createCheckoutCompletedEvent({
      sessionId: `cs_test_triparty_${Date.now()}`,
      paymentIntentId,
      customerId: buyer.id,
      contentId: content.id,
      amountCents,
      organizationId: organization.id,
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
    // Step 9: Verify purchase + assert EXACTLY 3 payout rows (unconditional)
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
    expect(purchase.organizationId).toBe(organization.id);

    const payoutRows = await dbHttp
      .select()
      .from(schema.payouts)
      .where(eq(schema.payouts.purchaseId, purchase.id));

    // MUST be exactly 3 rows: platform_fee + creator_payout + organization_fee.
    // The org's Connect account has chargesEnabled=true (seeded above), so the
    // organization_fee transfer path runs and writes the third row.
    // Absence of rows → payout pipeline broken.
    // Only 2 rows → organization_fee missing (org Connect not resolved).
    expect(payoutRows).toHaveLength(3);

    const platformFeeRow = payoutRows.find(
      (r) => r.payoutType === 'platform_fee'
    );
    const creatorPayoutRow = payoutRows.find(
      (r) => r.payoutType === 'creator_payout'
    );
    const orgFeeRow = payoutRows.find(
      (r) => r.payoutType === 'organization_fee'
    );

    expect(platformFeeRow).toBeDefined();
    expect(creatorPayoutRow).toBeDefined();
    expect(orgFeeRow).toBeDefined();

    // platform_fee: retained on platform
    expect(platformFeeRow?.status).toBe('paid');
    expect(platformFeeRow?.userId).toBeNull();
    expect(platformFeeRow?.organizationId).toBe(organization.id);
    expect(platformFeeRow?.sourceType).toBe('purchase');

    // creator_payout: creator's Connect is onboarding → pending/connect_not_ready
    expect(creatorPayoutRow?.status).toBe('pending');
    expect(creatorPayoutRow?.reason).toBe('connect_not_ready');
    expect(creatorPayoutRow?.userId).toBe(creator.id);
    expect(creatorPayoutRow?.organizationId).toBe(organization.id);
    expect(creatorPayoutRow?.sourceType).toBe('purchase');
    expect(creatorPayoutRow?.amountCents).toBeGreaterThan(0);

    // organization_fee: org Connect has chargesEnabled=true → transfer attempted.
    // With live Stripe key: status='paid'. Without (local/CI-no-key): transfer throws
    // → status='failed' (transfer_failed). Both prove the row IS written (the 3-row AC).
    expect(['paid', 'failed']).toContain(orgFeeRow?.status);
    expect(orgFeeRow?.userId).toBe(owner.id);
    expect(orgFeeRow?.organizationId).toBe(organization.id);
    expect(orgFeeRow?.sourceType).toBe('purchase');
    expect(orgFeeRow?.amountCents).toBeGreaterThan(0);

    // Sum check: all three rows ≤ amountCents
    const total = payoutRows.reduce((s, r) => s + r.amountCents, 0);
    expect(total).toBeLessThanOrEqual(amountCents);
    expect(total).toBeGreaterThan(0);

    // ======================================================================
    // Step 10: Simulate account.updated webhook for CREATOR's Connect account
    //          (chargesEnabled=true) → resolvePendingPayouts must run and
    //          transition creator_payout from 'pending' to 'paid' (AC-b).
    // ======================================================================
    // The account.updated handler reads the CURRENT DB row for wasActive,
    // then calls handleAccountUpdated (persists new state), then fires
    // resolvePendingPayouts via waitUntil. We poll the DB after the webhook
    // returns to give waitUntil time to settle.
    const accountUpdatedEvent = createAccountUpdatedEvent({
      stripeAccountId: creatorStripeAccountId,
      orgId: organization.id,
    });

    const connectWebhookResponse = await sendSignedWebhookRaw(
      `${WORKER_URLS.ecom}/webhooks/stripe/connect`,
      accountUpdatedEvent,
      connectSecret
    );
    expect(connectWebhookResponse.status).toBe(200);
    const connectResult = await connectWebhookResponse.json();
    // The handler always returns { received: true } for known event types
    expect(connectResult.received).toBe(true);

    // resolvePendingPayouts runs in waitUntil — poll DB until the row
    // transitions or the test times out (vitest timeout governs).
    // We give it up to 15 s in 500 ms increments.
    let resolvedPayoutRow:
      | { status: string; reason: string | null }
      | undefined;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const [row] = await dbHttp
        .select({
          status: schema.payouts.status,
          reason: schema.payouts.reason,
        })
        .from(schema.payouts)
        .where(eq(schema.payouts.id, creatorPayoutRow?.id))
        .limit(1);
      if (row?.status === 'paid') {
        resolvedPayoutRow = row;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // AC-b: the pending creator_payout must have transitioned to 'paid'
    // once the Connect account activates.
    expect(resolvedPayoutRow).toBeDefined();
    expect(resolvedPayoutRow?.status).toBe('paid');
    expect(resolvedPayoutRow?.reason).toBeNull();

    // ======================================================================
    // Step 11: Assert payout visible on creator's /me/payouts
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
    expect(myPayoutsData.items).toBeDefined();
    expect(Array.isArray(myPayoutsData.items)).toBe(true);

    const creatorRow = myPayoutsData.items.find(
      (p: { purchaseId?: string; payoutType?: string }) =>
        p.purchaseId === purchase.id && p.payoutType === 'creator_payout'
    );
    expect(creatorRow).toBeDefined();

    // ======================================================================
    // Step 12: Assert org owner can see payouts via /subscriptions/payouts
    // ======================================================================
    const orgPayoutsResponse = await httpClient.get(
      `${WORKER_URLS.ecom}/subscriptions/payouts?organizationId=${organization.id}`,
      {
        headers: {
          Cookie: ownerCookie,
          Origin: WORKER_URLS.ecom,
        },
      }
    );
    await expectSuccessResponse(orgPayoutsResponse);
    const orgPayoutsData = await orgPayoutsResponse.json();
    expect(orgPayoutsData.items).toBeDefined();
    expect(Array.isArray(orgPayoutsData.items)).toBe(true);

    // Org-scoped payouts include the rows for this org's purchases
    const orgRow = orgPayoutsData.items.find(
      (p: { purchaseId?: string }) => p.purchaseId === purchase.id
    );
    expect(orgRow).toBeDefined();
  }, 300_000); // 5 min

  test('GET /agreements/me returns active agreement for creator', async () => {
    const ctx = createScopedTestContext();

    const { cookie: ownerCookie, user: owner } = await authFixture.registerUser(
      {
        email: ctx.email('owner-me'),
        password: 'SecurePassword123!',
        name: ctx.name('Owner Me'),
        role: 'creator',
      }
    );

    const orgResponse = await httpClient.post(
      `${WORKER_URLS.organization}/api/organizations`,
      {
        headers: {
          Cookie: ownerCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.organization,
        },
        data: {
          name: ctx.name('Me-Org'),
          slug: ctx.slug(`me-org-${Date.now()}`),
          description: 'Agreement /me test org',
        },
      }
    );
    await expectSuccessResponse(orgResponse, 201);
    const organization = unwrapApiResponse(await orgResponse.json());

    const { cookie: creatorCookie, user: creator } =
      await authFixture.registerUser({
        email: ctx.email('creator-me'),
        password: 'SecurePassword123!',
        name: ctx.name('Creator Me'),
        role: 'creator',
      });

    await dbHttp.insert(schema.organizationMemberships).values({
      organizationId: organization.id,
      userId: creator.id,
      role: 'creator',
      status: 'active',
      invitedBy: owner.id,
    });

    // Propose + accept agreement
    const proposeResponse = await httpClient.post(
      `${WORKER_URLS.ecom}/agreements/propose?organizationId=${organization.id}`,
      {
        headers: {
          Cookie: ownerCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.ecom,
        },
        data: {
          creatorId: creator.id,
          revenueType: 'content_purchase',
          creatorShareBps: 6000,
          notes: 'E2E /me test',
        },
      }
    );
    await expectSuccessResponse(proposeResponse, 201);
    const proposalId = unwrapApiResponse(await proposeResponse.json()).id;

    await httpClient.post(
      `${WORKER_URLS.ecom}/agreements/${proposalId}/accept`,
      {
        headers: {
          Cookie: creatorCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.ecom,
        },
        data: {},
      }
    );

    // GET /agreements/me — creator should see their own agreement
    const meResponse = await httpClient.get(
      `${WORKER_URLS.ecom}/agreements/me`,
      {
        headers: {
          Cookie: creatorCookie,
          Origin: WORKER_URLS.ecom,
        },
      }
    );
    await expectSuccessResponse(meResponse);
    const meData = await meResponse.json();

    // Assert the response envelope shape explicitly before normalising.
    // The /agreements/me route follows the standard list envelope: { items: [...] }.
    // If the shape is wrong we want a loud failure, not silent empty-array behaviour.
    if (!meData.items && !meData.data) {
      throw new Error(
        `/agreements/me returned unexpected shape: ${JSON.stringify(meData)}`
      );
    }
    // Normalise: list endpoint returns { items: [...] }, single-item returns { data: {...} }
    const agreements = Array.isArray(meData.items)
      ? (meData.items as unknown[])
      : meData.data
        ? [meData.data]
        : [];
    expect(Array.isArray(agreements)).toBe(true);

    const myAgreement = agreements.find(
      (a: unknown) =>
        (a as { organizationId?: string }).organizationId === organization.id
    );
    expect(myAgreement).toBeDefined();
  }, 120_000);

  test('creator cannot see org-scoped /subscriptions/payouts (auth guard)', async () => {
    const ctx = createScopedTestContext();

    const { cookie: ownerCookie } = await authFixture.registerUser({
      email: ctx.email('owner-guard'),
      password: 'SecurePassword123!',
      name: ctx.name('Owner Guard'),
      role: 'creator',
    });

    const orgResponse = await httpClient.post(
      `${WORKER_URLS.organization}/api/organizations`,
      {
        headers: {
          Cookie: ownerCookie,
          'Content-Type': 'application/json',
          Origin: WORKER_URLS.organization,
        },
        data: {
          name: ctx.name('Guard Org'),
          slug: ctx.slug(`guard-org-${Date.now()}`),
          description: 'Auth guard test org',
        },
      }
    );
    await expectSuccessResponse(orgResponse, 201);
    const organization = unwrapApiResponse(await orgResponse.json());

    // A different user (not org owner/admin) tries to see org payouts
    const { cookie: outsiderCookie } = await authFixture.registerUser({
      email: ctx.email('outsider'),
      password: 'SecurePassword123!',
      name: ctx.name('Outsider'),
      role: 'creator',
    });

    const guardResponse = await httpClient.get(
      `${WORKER_URLS.ecom}/subscriptions/payouts?organizationId=${organization.id}`,
      {
        headers: {
          Cookie: outsiderCookie,
          Origin: WORKER_URLS.ecom,
        },
      }
    );
    // Outsider should be rejected: 403 (not org manager) or 400 (org context)
    expect([400, 403]).toContain(guardResponse.status);
  }, 60_000);
});
