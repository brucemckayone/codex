import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import type { dbWs as DbClient } from '../../src';
import { schema } from '../../src';
import {
  CONNECT_ACCOUNTS,
  CONTENT,
  CONTENT_ACCESS,
  ORGS,
  PLATFORM_FEE,
  PURCHASES,
  SUBSCRIPTIONS,
  TIERS,
  USERS,
} from './constants';
import {
  assertTestModeKey,
  createOrFindStripeSubscription,
  SYNTHETIC_STRIPE_CUSTOMER_ID,
  SYNTHETIC_STRIPE_SUBSCRIPTION_ID,
} from './stripe-subscription';

const now = new Date();
const purchasedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

// ── Stripe Cleanup ─────────────────────────────────────────────────────────
// Remove stale seed objects from previous runs to keep the Stripe dashboard clean.

/**
 * Grace period before a seed Product is considered abandoned.
 *
 * WHY THIS EXISTS. The Stripe TEST-MODE ACCOUNT IS SHARED — by every
 * developer machine, every worktree, `seed-dev-db.yml`, and every CI run of
 * `testing.yml`. This cleanup selects on `metadata['codex_seed']:'true'`
 * globally, with no notion of which environment owns what, so before this
 * bound it archived the products and prices that OTHER live databases were
 * pointing at. Those rows are not repaired by anything: the other environment
 * keeps its `stripe_price_monthly_id`, and the next subscription checkout dies
 * in `SubscriptionService.createCheckoutSession` with Stripe's
 * `The price specified is inactive. This field only accepts active prices.`
 * (`line_items[0][price]`) — a 500 on the pricing page's Subscribe button.
 *
 * That is a cross-environment write, and it was observed: the seeded
 * `studio-alpha` Standard/Pro and `of-blood-and-bones` Soul Path tiers all had
 * `active: false` products AND prices in Stripe while the local database still
 * referenced them, which is exactly what
 * `e2e/subscription/03-subscribe-flow.spec.ts` fails on. A seed run in one
 * checkout had archived the objects a different checkout's database owned.
 *
 * A 24h floor keeps the hygiene the cleanup was written for while making it
 * impossible to archive anything an in-flight environment just created (a CI
 * E2E job lives ~15 minutes). Products newer than this are left alone; they
 * are inert rows in a test account, which is a far cheaper problem than
 * breaking someone else's checkout.
 */
const STRIPE_SEED_CLEANUP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

async function cleanupStripeSeedObjects(stripe: Stripe): Promise<void> {
  // 1. Archive stale seed Products and their Prices
  // Stripe doesn't allow deleting products with prices, so we archive instead.
  const seedProducts = await stripe.products.search({
    query: "metadata['codex_seed']:'true' AND active:'true'",
    limit: 100,
  });

  const archiveCutoff = Math.floor(
    (Date.now() - STRIPE_SEED_CLEANUP_MIN_AGE_MS) / 1000
  );
  const stale = seedProducts.data.filter((p) => p.created < archiveCutoff);
  const spared = seedProducts.data.length - stale.length;

  for (const product of stale) {
    // Archive all active prices first
    const prices = await stripe.prices.list({
      product: product.id,
      active: true,
      limit: 100,
    });
    for (const price of prices.data) {
      await stripe.prices.update(price.id, { active: false });
    }
    // Archive the product
    await stripe.products.update(product.id, { active: false });
  }

  if (stale.length > 0) {
    console.log(
      `  🧹 Archived ${stale.length} stale Stripe products + prices (older than 24h)`
    );
  }
  if (spared > 0) {
    console.log(
      `  ⏭ Spared ${spared} recent seed product(s) — another environment may be using them`
    );
  }

  // 2. Find existing seed Connect accounts (can't delete, but we track for reuse)
  // Stripe accounts.list doesn't support metadata filtering, so we list recent and check
  const accounts = await stripe.accounts.list({ limit: 100 });
  const seedAccounts = accounts.data.filter(
    (a) => a.metadata?.codex_seed === 'true'
  );
  if (seedAccounts.length > 0) {
    console.log(
      `  🔍 Found ${seedAccounts.length} existing seed Connect account(s)`
    );
  }

  return;
}

// ── Stripe Connect Pre-fill ────────────────────────────────────────────────
// Bypass onboarding requirements in test mode by providing all required fields.
// See: https://docs.stripe.com/connect/custom/onboarding#test-mode

interface ConnectIdentity {
  firstName: string;
  lastName: string;
  email: string;
  businessUrl: string;
}

/*
  Stripe test-mode magic values that make a Custom Connect account actually
  ACTIVATE. All three are required together — this was established by probing
  the live test-mode API, not by reading the field names.

  The problem they solve: a plausible-looking identity is not a magic value, so
  Stripe test mode runs REAL keyed identity verification against it and fails.
  This seed used to submit `line1: '1 Test Street'` with no id_number and no
  document, and every account it created came back
  `requirements.errors[].code === 'verification_failed_keyed_identity'` on all
  nine `individual.*` fields, `card_payments`/`transfers` stuck `inactive`, and
  `charges_enabled: false`.

  Measured, four variants against fresh accounts (identical in every other
  respect), polled to a terminal state:

    address_full_match alone .................. FAILED  keyed_identity @35s
    address_full_match + id_number ............ FAILED  keyed_identity @36s
    id_number alone (real street address) ..... FAILED  keyed_identity @54s
    address_full_match + id_number + document . ACTIVE            @64s

  Then 3/3 repeats of the winning combination: ACTIVE at 1s, 64s, 65s.

  Two consequences encoded below:

  1. `verification.document.front` is NOT optional. The keyed-identity path
     cannot be satisfied by field values alone; Stripe wants a document, and
     `file_identity_document_success` is the test-mode file token that always
     passes.

  2. Activation is ASYNCHRONOUS and slow. `charges_enabled` was true in the
     `accounts.update` response only 1 time in 4; the other three needed
     ~64s. The old code read `accounts.retrieve` ONCE, immediately, so even a
     correct prefill would have been recorded as `charges_enabled: false`.
     Hence the bounded poll.
*/
const STRIPE_TEST_VERIFIED_ADDRESS_LINE1 = 'address_full_match';
const STRIPE_TEST_VERIFIED_ID_NUMBER = '000000000';
const STRIPE_TEST_VERIFIED_DOCUMENT = 'file_identity_document_success';

/** Poll budget for capability activation. Observed worst case ~65s. */
const CONNECT_ACTIVATION_TIMEOUT_MS = 150_000;
const CONNECT_ACTIVATION_POLL_MS = 3_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function activateConnectAccount(
  stripe: Stripe,
  accountId: string,
  identity: ConnectIdentity
): Promise<{ chargesEnabled: boolean; payoutsEnabled: boolean }> {
  // Pre-fill all required fields for a GB Custom account
  const updated = await stripe.accounts.update(accountId, {
    business_type: 'individual',
    business_profile: {
      mcc: '5815', // Digital goods — matches content streaming platform
      url: identity.businessUrl,
    },
    individual: {
      first_name: identity.firstName,
      last_name: identity.lastName,
      email: identity.email,
      phone: '+44 7700 900000', // Stripe-valid UK test number
      dob: { day: 1, month: 1, year: 1990 },
      address: {
        line1: STRIPE_TEST_VERIFIED_ADDRESS_LINE1,
        city: 'London',
        postal_code: 'EC1A 1BB',
        country: 'GB',
      },
      id_number: STRIPE_TEST_VERIFIED_ID_NUMBER,
      verification: {
        document: { front: STRIPE_TEST_VERIFIED_DOCUMENT },
      },
    },
    tos_acceptance: {
      date: Math.floor(Date.now() / 1000),
      ip: '127.0.0.1',
    },
    external_account: {
      object: 'bank_account',
      country: 'GB',
      currency: 'gbp',
      account_number: '00012345',
      routing_number: '108800', // Stripe test sort code
    },
  });

  if (updated.charges_enabled) {
    return {
      chargesEnabled: true,
      payoutsEnabled: updated.payouts_enabled ?? false,
    };
  }

  // Capabilities activate asynchronously — wait for a TERMINAL state rather
  // than reading once and recording whatever happened to be true at t+0.
  const deadline = Date.now() + CONNECT_ACTIVATION_TIMEOUT_MS;
  let account = updated;
  while (Date.now() < deadline) {
    await sleep(CONNECT_ACTIVATION_POLL_MS);
    account = await stripe.accounts.retrieve(accountId);
    if (account.charges_enabled) break;
    // `requirements.past_due` with errors is terminal: Stripe has decided the
    // identity cannot be verified and further waiting changes nothing.
    if (
      account.requirements?.disabled_reason === 'requirements.past_due' &&
      (account.requirements.errors?.length ?? 0) > 0
    ) {
      console.log(
        `  ⚠ Connect ${accountId} verification failed: ` +
          account.requirements.errors
            ?.map((e) => e.code)
            .filter((c, i, a) => a.indexOf(c) === i)
            .join(', ')
      );
      break;
    }
  }

  return {
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
  };
}

interface SeededConnectAccountConfig {
  orgId: string;
  userId: string;
  identity: ConnectIdentity;
}

interface SeededConnectAccountResult {
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}

/**
 * Reuse an existing seed Connect account for the given org, or create + activate
 * a new one. Idempotent — safe to re-run `pnpm db:seed`.
 *
 * Pre-existing accounts are matched by `metadata.codex_seed === 'true'` AND
 * `metadata.codex_organization_id === config.orgId`. Older Express seed accounts
 * (`requirement_collection: 'stripe'`) cannot be programmatically activated, so
 * we ignore them and create a fresh Custom one.
 *
 * A matching account is only reused when it is ALREADY `charges_enabled`.
 * A Connect account that has once failed keyed identity verification is
 * TERMINALLY stuck: resubmitting the person (even with the magic verified
 * address) re-runs verification, briefly reports
 * `requirements.pending_verification`, and lands back on
 * `verification_failed_keyed_identity` / `requirements.past_due` with both
 * capabilities `inactive` — Stripe wants an identity DOCUMENT at that point,
 * which a seed cannot supply. Measured on the two accounts this seed had
 * already poisoned (`acct_1U8x45G5sYCpZ5i2`, `acct_1U8xhd6IzIZ7GWlI`): both
 * refused to activate. Reusing such an account made the seed permanently
 * unable to recover, so an inactive match is abandoned in favour of a fresh
 * account, which activates on the first update.
 */
async function ensureSeededConnectAccount(
  stripe: Stripe,
  existingAccounts: Stripe.Account[],
  config: SeededConnectAccountConfig
): Promise<SeededConnectAccountResult> {
  const existingSeed = existingAccounts.find(
    (a) =>
      a.metadata?.codex_seed === 'true' &&
      a.metadata?.codex_organization_id === config.orgId
  );

  let accountId: string;
  if (
    existingSeed &&
    existingSeed.controller?.requirement_collection === 'application' &&
    existingSeed.charges_enabled
  ) {
    accountId = existingSeed.id;
    console.log(
      `  ♻ Reusing existing seed Connect account for org ${config.orgId} (${accountId})`
    );
    // Return WITHOUT re-running activateConnectAccount. An account that is
    // already `charges_enabled` is already VERIFIED, and Stripe rejects any
    // attempt to re-submit `individual[verification][document][front]` on a
    // verified account:
    //
    //   StripeInvalidRequestError: You cannot change
    //   `individual[verification][document][front]` via API if an account is
    //   verified. (400, param individual[verification][document][front])
    //
    // Re-applying the prefill here made the seed succeed EXACTLY ONCE — the
    // run that verified these accounts — and fail on every run afterwards.
    // The Neon database is fresh each CI run but the Stripe test account is
    // shared and persistent, so CI reuses these same verified accounts and
    // would have hit this 400 on the very next build. Nothing needs
    // submitting: the account is in the state the prefill exists to reach.
    return {
      accountId,
      chargesEnabled: existingSeed.charges_enabled ?? false,
      payoutsEnabled: existingSeed.payouts_enabled ?? false,
    };
  }
  {
    if (existingSeed) {
      console.log(
        `  ⚠ Abandoning unusable seed Connect account ${existingSeed.id} for org ${config.orgId} ` +
          `(charges_enabled=${existingSeed.charges_enabled}, ` +
          `requirement_collection=${existingSeed.controller?.requirement_collection}) — creating a fresh one`
      );
    }
    // Create a Custom account (requirement_collection: 'application') so we can
    // programmatically accept TOS and pre-fill all fields. Production uses Express
    // (requirement_collection: 'stripe'), but seed needs full control for activation.
    // Transfer functionality (destination charges) works identically for both types.
    const account = await stripe.accounts.create({
      controller: {
        stripe_dashboard: { type: 'none' },
        fees: { payer: 'application' },
        losses: { payments: 'application' },
        requirement_collection: 'application',
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      country: 'GB',
      metadata: {
        codex_organization_id: config.orgId,
        codex_user_id: config.userId,
        codex_seed: 'true',
      },
    });
    accountId = account.id;
    console.log(
      `  ✓ Created new Connect account for org ${config.orgId} (${accountId})`
    );
  }

  const { chargesEnabled, payoutsEnabled } = await activateConnectAccount(
    stripe,
    accountId,
    config.identity
  );

  return { accountId, chargesEnabled, payoutsEnabled };
}

export async function seedCommerce(db: typeof DbClient) {
  // Platform fee config: 10% (1000 basis points)
  await db.insert(schema.platformFeeConfig).values({
    id: PLATFORM_FEE.id,
    platformFeePercentage: PLATFORM_FEE.platformFeePercentage,
    effectiveFrom: new Date('2025-01-01'),
    createdAt: now,
    updatedAt: now,
  });

  // Purchases — revenue split must satisfy CHECK: amount = platform + org + creator
  // Using 10% platform fee, 0% org fee (direct creator orgs)
  const sveltePriceCents = 1999;
  const sveltePlatformFee = Math.round(sveltePriceCents * 0.1);
  const svelteCreatorPayout = sveltePriceCents - sveltePlatformFee;

  const honoPriceCents = 2999;
  const honoPlatformFee = Math.round(honoPriceCents * 0.1);
  const honoCreatorPayout = honoPriceCents - honoPlatformFee;

  // Admin also buys Advanced Svelte (cross-org purchase)
  const adminSveltePlatformFee = Math.round(sveltePriceCents * 0.1);
  const adminSvelteCreatorPayout = sveltePriceCents - adminSveltePlatformFee;

  await db.insert(schema.purchases).values([
    {
      id: PURCHASES.viewerSvelte.id,
      customerId: USERS.viewer.id,
      contentId: CONTENT.advancedSvelte.id,
      organizationId: ORGS.alpha.id,
      amountPaidCents: sveltePriceCents,
      currency: 'gbp',
      platformFeeCents: sveltePlatformFee,
      organizationFeeCents: 0,
      creatorPayoutCents: svelteCreatorPayout,
      stripePaymentIntentId: 'pi_seed_svelte_purchase_001',
      status: 'completed',
      purchasedAt,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PURCHASES.viewerHono.id,
      customerId: USERS.viewer.id,
      contentId: CONTENT.honoApis.id,
      organizationId: ORGS.beta.id,
      amountPaidCents: honoPriceCents,
      currency: 'gbp',
      platformFeeCents: honoPlatformFee,
      organizationFeeCents: 0,
      creatorPayoutCents: honoCreatorPayout,
      stripePaymentIntentId: 'pi_seed_hono_purchase_001',
      status: 'completed',
      purchasedAt,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PURCHASES.adminSvelte.id,
      customerId: USERS.admin.id,
      contentId: CONTENT.advancedSvelte.id,
      organizationId: ORGS.alpha.id,
      amountPaidCents: sveltePriceCents,
      currency: 'gbp',
      platformFeeCents: adminSveltePlatformFee,
      organizationFeeCents: 0,
      creatorPayoutCents: adminSvelteCreatorPayout,
      stripePaymentIntentId: 'pi_seed_svelte_purchase_002',
      status: 'completed',
      purchasedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    },
  ]);

  // ── Additional purchases for customer filter testing ─────────────────────
  // Prices: advancedSvelte £19.99, tsDeepDive £14.99, cssMasterclass £4.99
  const tsDeepPrice = 1499;
  const tsDeepPlatform = Math.round(tsDeepPrice * 0.1);
  const tsDeepCreator = tsDeepPrice - tsDeepPlatform;

  const cssPrice = 499;
  const cssPlatform = Math.round(cssPrice * 0.1);
  const cssCreator = cssPrice - cssPlatform;

  const makePurchase = (
    id: string,
    customerId: string,
    contentId: string,
    orgId: string,
    amount: number,
    platformFee: number,
    creatorPayout: number,
    piSuffix: string,
    date: Date
  ) => ({
    id,
    customerId,
    contentId,
    organizationId: orgId,
    amountPaidCents: amount,
    currency: 'gbp' as const,
    platformFeeCents: platformFee,
    organizationFeeCents: 0,
    creatorPayoutCents: creatorPayout,
    stripePaymentIntentId: `pi_seed_${piSuffix}`,
    status: 'completed' as const,
    purchasedAt: date,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.purchases).values([
    // customer1 (Maria): 3 purchases from Alpha, total £39.97
    makePurchase(
      PURCHASES.c1Svelte.id,
      USERS.customer1.id,
      CONTENT.advancedSvelte.id,
      ORGS.alpha.id,
      sveltePriceCents,
      sveltePlatformFee,
      svelteCreatorPayout,
      'c1_svelte',
      daysAgo(2)
    ),
    makePurchase(
      PURCHASES.c1TsDeep.id,
      USERS.customer1.id,
      CONTENT.tsDeepDive.id,
      ORGS.alpha.id,
      tsDeepPrice,
      tsDeepPlatform,
      tsDeepCreator,
      'c1_ts_deep',
      daysAgo(30)
    ),
    makePurchase(
      PURCHASES.c1Css.id,
      USERS.customer1.id,
      CONTENT.cssMasterclass.id,
      ORGS.alpha.id,
      cssPrice,
      cssPlatform,
      cssCreator,
      'c1_css',
      daysAgo(60)
    ),
    // customer2 (James): 2 purchases from Alpha, total £34.98
    makePurchase(
      PURCHASES.c2Svelte.id,
      USERS.customer2.id,
      CONTENT.advancedSvelte.id,
      ORGS.alpha.id,
      sveltePriceCents,
      sveltePlatformFee,
      svelteCreatorPayout,
      'c2_svelte',
      daysAgo(5)
    ),
    makePurchase(
      PURCHASES.c2TsDeep.id,
      USERS.customer2.id,
      CONTENT.tsDeepDive.id,
      ORGS.alpha.id,
      tsDeepPrice,
      tsDeepPlatform,
      tsDeepCreator,
      'c2_ts_deep',
      daysAgo(5)
    ),
    // customer3 (Priya): 1 purchase from Alpha, total £4.99
    makePurchase(
      PURCHASES.c3Css.id,
      USERS.customer3.id,
      CONTENT.cssMasterclass.id,
      ORGS.alpha.id,
      cssPrice,
      cssPlatform,
      cssCreator,
      'c3_css',
      daysAgo(3)
    ),
    // customer4 (Lucas): 3 purchases from Alpha, total £39.97 (all older)
    makePurchase(
      PURCHASES.c4Svelte.id,
      USERS.customer4.id,
      CONTENT.advancedSvelte.id,
      ORGS.alpha.id,
      sveltePriceCents,
      sveltePlatformFee,
      svelteCreatorPayout,
      'c4_svelte',
      daysAgo(45)
    ),
    makePurchase(
      PURCHASES.c4TsDeep.id,
      USERS.customer4.id,
      CONTENT.tsDeepDive.id,
      ORGS.alpha.id,
      tsDeepPrice,
      tsDeepPlatform,
      tsDeepCreator,
      'c4_ts_deep',
      daysAgo(45)
    ),
    makePurchase(
      PURCHASES.c4Css.id,
      USERS.customer4.id,
      CONTENT.cssMasterclass.id,
      ORGS.alpha.id,
      cssPrice,
      cssPlatform,
      cssCreator,
      'c4_css',
      daysAgo(45)
    ),
    // customer5 (Emma): 1 purchase from Alpha, total £14.99
    makePurchase(
      PURCHASES.c5TsDeep.id,
      USERS.customer5.id,
      CONTENT.tsDeepDive.id,
      ORGS.alpha.id,
      tsDeepPrice,
      tsDeepPlatform,
      tsDeepCreator,
      'c5_ts_deep',
      daysAgo(80)
    ),
    // viewer: 1 purchase from Of Blood & Bones (Ceremonial Cacao £19.99)
    makePurchase(
      PURCHASES.viewerCacao.id,
      USERS.viewer.id,
      CONTENT.ceremonialCacao.id,
      ORGS.bones.id,
      1999,
      Math.round(1999 * 0.1),
      1999 - Math.round(1999 * 0.1),
      'viewer_cacao',
      daysAgo(1)
    ),
  ]);

  // Content access records
  await db.insert(schema.contentAccess).values([
    {
      id: CONTENT_ACCESS.viewerIntroTs.id,
      userId: USERS.viewer.id,
      contentId: CONTENT.introTs.id,
      organizationId: ORGS.alpha.id,
      accessType: 'complimentary',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: CONTENT_ACCESS.viewerSvelte.id,
      userId: USERS.viewer.id,
      contentId: CONTENT.advancedSvelte.id,
      organizationId: ORGS.alpha.id,
      accessType: 'purchased',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: CONTENT_ACCESS.viewerHono.id,
      userId: USERS.viewer.id,
      contentId: CONTENT.honoApis.id,
      organizationId: ORGS.beta.id,
      accessType: 'purchased',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: CONTENT_ACCESS.adminSvelte.id,
      userId: USERS.admin.id,
      contentId: CONTENT.advancedSvelte.id,
      organizationId: ORGS.alpha.id,
      accessType: 'purchased',
      createdAt: now,
      updatedAt: now,
    },
    // Additional access records for new customers
    {
      id: CONTENT_ACCESS.c1Svelte.id,
      userId: USERS.customer1.id,
      contentId: CONTENT.advancedSvelte.id,
      organizationId: ORGS.alpha.id,
      accessType: 'purchased',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: CONTENT_ACCESS.c1TsDeep.id,
      userId: USERS.customer1.id,
      contentId: CONTENT.tsDeepDive.id,
      organizationId: ORGS.alpha.id,
      accessType: 'purchased',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: CONTENT_ACCESS.c1Css.id,
      userId: USERS.customer1.id,
      contentId: CONTENT.cssMasterclass.id,
      organizationId: ORGS.alpha.id,
      accessType: 'purchased',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: CONTENT_ACCESS.c2Svelte.id,
      userId: USERS.customer2.id,
      contentId: CONTENT.advancedSvelte.id,
      organizationId: ORGS.alpha.id,
      accessType: 'purchased',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: CONTENT_ACCESS.c2TsDeep.id,
      userId: USERS.customer2.id,
      contentId: CONTENT.tsDeepDive.id,
      organizationId: ORGS.alpha.id,
      accessType: 'purchased',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: CONTENT_ACCESS.c3Css.id,
      userId: USERS.customer3.id,
      contentId: CONTENT.cssMasterclass.id,
      organizationId: ORGS.alpha.id,
      accessType: 'purchased',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: CONTENT_ACCESS.c4Svelte.id,
      userId: USERS.customer4.id,
      contentId: CONTENT.advancedSvelte.id,
      organizationId: ORGS.alpha.id,
      accessType: 'purchased',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: CONTENT_ACCESS.c4TsDeep.id,
      userId: USERS.customer4.id,
      contentId: CONTENT.tsDeepDive.id,
      organizationId: ORGS.alpha.id,
      accessType: 'purchased',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: CONTENT_ACCESS.c4Css.id,
      userId: USERS.customer4.id,
      contentId: CONTENT.cssMasterclass.id,
      organizationId: ORGS.alpha.id,
      accessType: 'purchased',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: CONTENT_ACCESS.c5TsDeep.id,
      userId: USERS.customer5.id,
      contentId: CONTENT.tsDeepDive.id,
      organizationId: ORGS.alpha.id,
      accessType: 'purchased',
      createdAt: now,
      updatedAt: now,
    },
    // Of Blood & Bones: viewer purchased Ceremonial Cacao
    {
      id: CONTENT_ACCESS.viewerCacao.id,
      userId: USERS.viewer.id,
      contentId: CONTENT.ceremonialCacao.id,
      organizationId: ORGS.bones.id,
      accessType: 'purchased',
      createdAt: now,
      updatedAt: now,
    },
  ]);

  // ── Subscription Tiers ────────────────────────────────────────────
  // Tiers are now seeded in `seedTiers()` before content (FK ordering), so
  // content rows can reference `includedInTierId` at insert time. Stripe
  // Product/Price linkage still happens here, below.

  // ── Stripe Objects (Products, Prices, Connect) ──────────────────
  // Only runs when STRIPE_SECRET_KEY is available.
  // 1. Cleans up stale seed objects from previous runs
  // 2. Creates Products + Prices for subscription tiers
  // 3. Creates (or reuses) a Connect account with pre-filled activation
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  // Populated below if Stripe is available. Kept in outer scope so the
  // subscription-insert section can look up the real price IDs to use
  // when creating a real test-mode Stripe subscription.
  let stripePriceIdsByTier: Map<
    string,
    { stripePriceMonthlyId: string; stripePriceAnnualId: string }
  > | null = null;

  if (stripeKey) {
    // Refuse to seed against a live Stripe account — the seed creates
    // disposable customers and subscriptions that must never touch real data.
    assertTestModeKey(stripeKey);
    const stripe = new Stripe(stripeKey);

    // Step 1: Clean up stale seed objects from previous runs
    await cleanupStripeSeedObjects(stripe);

    // Step 2: Create Products + Prices for tiers
    const seedTiers = [
      { ...TIERS.alphaStandard, organizationId: ORGS.alpha.id },
      { ...TIERS.alphaPro, organizationId: ORGS.alpha.id },
      { ...TIERS.betaStandard, organizationId: ORGS.beta.id },
      { ...TIERS.bonesSoulPath, organizationId: ORGS.bones.id },
    ];

    // Capture the created Stripe price IDs per Codex tier id so we can
    // reference them when creating real seed subscriptions below.
    const createdTierPriceIds = new Map<
      string,
      { stripePriceMonthlyId: string; stripePriceAnnualId: string }
    >();

    for (const tier of seedTiers) {
      const product = await stripe.products.create({
        name: tier.name,
        description: tier.description ?? undefined,
        metadata: {
          codex_tier_id: tier.id,
          codex_org_id: tier.organizationId,
          codex_seed: 'true',
        },
      });

      const [monthlyPrice, annualPrice] = await Promise.all([
        stripe.prices.create({
          product: product.id,
          unit_amount: tier.priceMonthly,
          currency: 'gbp',
          recurring: { interval: 'month' },
          metadata: { codex_tier_id: tier.id, interval: 'month' },
        }),
        stripe.prices.create({
          product: product.id,
          unit_amount: tier.priceAnnual,
          currency: 'gbp',
          recurring: { interval: 'year' },
          metadata: { codex_tier_id: tier.id, interval: 'year' },
        }),
      ]);

      createdTierPriceIds.set(tier.id, {
        stripePriceMonthlyId: monthlyPrice.id,
        stripePriceAnnualId: annualPrice.id,
      });

      await db
        .update(schema.subscriptionTiers)
        .set({
          stripeProductId: product.id,
          stripePriceMonthlyId: monthlyPrice.id,
          stripePriceAnnualId: annualPrice.id,
        })
        .where(eq(schema.subscriptionTiers.id, tier.id));
    }

    console.log(
      `  ✓ Created Stripe Products/Prices for ${seedTiers.length} tiers`
    );

    // Expose the created price IDs to the subscription section below.
    // Attaching to outer scope via a closure-friendly variable.
    stripePriceIdsByTier = createdTierPriceIds;
  } else {
    console.log(
      '  ⚠ STRIPE_SECRET_KEY not set — tiers will have null Stripe IDs (checkout will 422)'
    );
  }

  // Content-to-tier linkage was previously patched up here because content
  // was inserted before tiers existed. Now that tiers are seeded in
  // `seedTiers()` before content, the FK is set at insert time inside
  // `seedContent` — no post-hoc update needed.

  // ── Subscriptions ──────────────────────────────────────────────────
  // Two seeded subscribers on Alpha Standard tier:
  //   - viewer@test.com   (primary — used by most E2E specs)
  //   - viewer2@test.com  (parallel — used by subscription-cross-device.spec.ts
  //                        so Playwright workers=2 doesn't race the cancel flow
  //                        on the same row)
  // Each gets its own real Stripe subscription (or synthetic IDs when
  // STRIPE_SECRET_KEY is absent) so cancel/reactivate flows operate on
  // independent Stripe objects.
  const subMonthly = TIERS.alphaStandard.priceMonthly; // £4.99
  const subPlatformFee = Math.round(subMonthly * 0.1);
  const subCreatorPayout = subMonthly - subPlatformFee;

  type SeededSubscriber = {
    user: { id: string; email: string; name: string };
    subscriptionSeedId: string;
  };

  async function buildSubscriptionRow({
    user,
    subscriptionSeedId,
  }: SeededSubscriber) {
    // Default to synthetic IDs (used when STRIPE_SECRET_KEY is absent —
    // preserves zero-config seed behaviour for fresh clones and CI).
    let stripeSubscriptionId: string = SYNTHETIC_STRIPE_SUBSCRIPTION_ID;
    let stripeCustomerId: string = SYNTHETIC_STRIPE_CUSTOMER_ID;
    let currentPeriodStart: Date = now;
    let currentPeriodEnd: Date = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000
    ); // +30 days

    if (stripeKey && stripePriceIdsByTier) {
      const tierPrices = stripePriceIdsByTier.get(TIERS.alphaStandard.id);
      if (tierPrices) {
        const stripe = new Stripe(stripeKey);
        try {
          const result = await createOrFindStripeSubscription(stripe, {
            user,
            tier: {
              id: TIERS.alphaStandard.id,
              stripePriceMonthlyId: tierPrices.stripePriceMonthlyId,
              stripePriceAnnualId: tierPrices.stripePriceAnnualId,
            },
            subscriptionSeedId,
            billingInterval: 'month',
          });
          stripeSubscriptionId = result.stripeSubscriptionId;
          stripeCustomerId = result.stripeCustomerId;
          currentPeriodStart = result.currentPeriodStart;
          currentPeriodEnd = result.currentPeriodEnd;

          // Unified-customer invariant (Codex-cmhnv): the real Stripe Customer
          // created above IS this user's canonical customer. Overwrite any
          // synthetic value seeded in seedUsers() so `users.stripe_customer_id`
          // reflects the same Customer the subscription points to.
          await db
            .update(schema.users)
            .set({ stripeCustomerId: result.stripeCustomerId })
            .where(eq(schema.users.id, user.id));

          console.log(
            `  ✓ Created real Stripe test-mode subscription for ${user.email} (${stripeSubscriptionId})`
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new Error(
            `Seed failed while creating real Stripe subscription for ${user.email}: ${message}`
          );
        }
      }
    }

    return {
      id: subscriptionSeedId,
      userId: user.id,
      organizationId: ORGS.alpha.id,
      tierId: TIERS.alphaStandard.id,
      stripeSubscriptionId,
      stripeCustomerId,
      status: 'active' as const,
      billingInterval: 'month' as const,
      currentPeriodStart,
      currentPeriodEnd,
      amountCents: subMonthly,
      platformFeeCents: subPlatformFee,
      organizationFeeCents: 0,
      creatorPayoutCents: subCreatorPayout,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (!stripeKey) {
    console.warn(
      '  ⚠ STRIPE_SECRET_KEY not set — using synthetic Stripe IDs. ' +
        'E2E tests requiring real cancel/resume flows will not run green. ' +
        'Set STRIPE_SECRET_KEY (sk_test_*) to enable full fixture.'
    );
  }

  const seededSubscribers: SeededSubscriber[] = [
    {
      user: {
        id: USERS.viewer.id,
        email: USERS.viewer.email,
        name: USERS.viewer.name,
      },
      subscriptionSeedId: SUBSCRIPTIONS.viewerAlphaStandard.id,
    },
    {
      user: {
        id: USERS.viewer2.id,
        email: USERS.viewer2.email,
        name: USERS.viewer2.name,
      },
      subscriptionSeedId: SUBSCRIPTIONS.viewer2AlphaStandard.id,
    },
  ];

  // Run sequentially — parallel Stripe customers.create + subscriptions.create
  // calls from the same script can race on idempotency keys and rate limits.
  const subscriptionRows = [];
  for (const subscriber of seededSubscribers) {
    subscriptionRows.push(await buildSubscriptionRow(subscriber));
  }

  await db.insert(schema.subscriptions).values(subscriptionRows);

  // ── Stripe Connect accounts for monetised seed orgs ─────────────
  // Every org with subscription tiers needs a fully-active Connect account, or
  // SubscriptionService.createCheckoutSession throws ConnectAccountNotReadyError
  // (subscription-service.ts:401) before checkout can run. Seed both Studio Alpha
  // (Alex Creator) and Of Blood and Bones (Luzura) — both have tiers in TIERS.
  if (stripeKey) {
    // Re-assert test mode (cheap, defensive — key could have rotated mid-seed).
    assertTestModeKey(stripeKey);
    const stripe = new Stripe(stripeKey);

    // `limit: 100` (Stripe's maximum), not 20. `accounts.list` returns the
    // MOST RECENT accounts and supports no metadata filter, so the window has
    // to be wide enough to still contain the seed accounts. It competes with
    // real churn: E2E spec 1.b (`clicking Set up Stripe redirects to a Stripe
    // Connect URL`) drives `connectOnboard`, which creates a throwaway Connect
    // account on EVERY run — 20 was roughly ten runs of headroom, after which
    // the seed accounts fell out of the window and a duplicate was created each
    // time. Reuse now also requires `charges_enabled`
    // (see ensureSeededConnectAccount), so a miss is recoverable rather than
    // fatal, but a wider window keeps the account list from growing per seed.
    const existingAccounts = (await stripe.accounts.list({ limit: 100 })).data;

    const seededOrgs: Array<{
      label: string;
      connectId: string;
      orgId: string;
      userId: string;
      identity: ConnectIdentity;
    }> = [
      {
        label: 'Studio Alpha',
        connectId: CONNECT_ACCOUNTS.alphaCreator.id,
        orgId: ORGS.alpha.id,
        userId: USERS.creator.id,
        identity: {
          firstName: 'Alex',
          lastName: 'Creator',
          email: USERS.creator.email,
          businessUrl: 'https://studioalpha.test',
        },
      },
      {
        label: 'Of Blood and Bones',
        connectId: CONNECT_ACCOUNTS.bonesLuzura.id,
        orgId: ORGS.bones.id,
        userId: USERS.luzura.id,
        identity: {
          firstName: 'Luzura',
          lastName: 'Peralta',
          email: USERS.luzura.email,
          businessUrl: 'https://ofbloodandbones.test',
        },
      },
    ];

    const inactiveConnectOrgs: string[] = [];

    for (const seed of seededOrgs) {
      const { accountId, chargesEnabled, payoutsEnabled } =
        await ensureSeededConnectAccount(stripe, existingAccounts, {
          orgId: seed.orgId,
          userId: seed.userId,
          identity: seed.identity,
        });

      if (!chargesEnabled) {
        inactiveConnectOrgs.push(`${seed.label} (${accountId})`);
      }

      // Heal stale rows on re-seed: if an earlier seed run (or a failed live
      // onboarding attempt in dev) left an inactive row for this user, upsert
      // points it at the freshly-activated Stripe account so subscription
      // checkout passes the readiness gate. One account per user (Codex-69t7c)
      // → conflict target is userId alone.
      await db
        .insert(schema.stripeConnectAccounts)
        .values({
          id: seed.connectId,
          organizationId: seed.orgId,
          userId: seed.userId,
          stripeAccountId: accountId,
          status: chargesEnabled ? 'active' : 'onboarding',
          chargesEnabled,
          payoutsEnabled,
          onboardingCompletedAt: chargesEnabled ? now : null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [schema.stripeConnectAccounts.userId],
          set: {
            stripeAccountId: accountId,
            status: chargesEnabled ? 'active' : 'onboarding',
            chargesEnabled,
            payoutsEnabled,
            onboardingCompletedAt: chargesEnabled ? now : null,
            updatedAt: now,
          },
        });

      const statusIcon = chargesEnabled ? '✓' : '⚠';
      console.log(
        `  ${statusIcon} ${seed.label} Connect ${accountId} — charges: ${chargesEnabled}, payouts: ${payoutsEnabled}`
      );
    }

    /*
      Fail CLOSED on an inactive seed Connect account.

      This used to be a `⚠` log and nothing else, which made the seed's most
      consequential failure invisible. An org whose Connect account is not
      `charges_enabled` lands as `status: 'onboarding'`, and everything
      downstream that needs an active Connect account then fails somewhere far
      away from the cause: the studio monetisation page renders "Continue
      Setup" instead of "Connected", `TierService.createTier`'s
      `requireActiveConnect` gate rejects, and
      `SubscriptionService.createCheckoutSession` throws
      `ConnectAccountNotReadyError`. Three E2E specs failed on exactly that for
      a long time while this step reported success.

      A seed that cannot produce the fixture it promises is a broken seed. Say
      so here, where the Stripe response that caused it is still in hand.
    */
    if (inactiveConnectOrgs.length > 0) {
      throw new Error(
        `Seed Connect activation failed for: ${inactiveConnectOrgs.join(', ')}. ` +
          'charges_enabled is false, so these orgs cannot sell subscriptions and every ' +
          'Connect-gated E2E spec will fail. Inspect requirements.errors on the account — ' +
          '`verification_failed_keyed_identity` means the prefill address is not one of ' +
          "Stripe's test-mode magic values (expected 'address_full_match')."
      );
    }

    console.log(
      `  Seeded platform fee, 14 purchases, 15 content access, 4 tiers, 1 subscription, 2 Connect accounts`
    );
  } else {
    console.log(
      '  Seeded platform fee, 14 purchases, 15 content access, 4 tiers, 1 subscription (skipped Stripe — no STRIPE_SECRET_KEY)'
    );
  }
}
