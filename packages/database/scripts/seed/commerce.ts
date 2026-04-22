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

const now = new Date();
const purchasedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

// ── Stripe Cleanup ─────────────────────────────────────────────────────────
// Remove stale seed objects from previous runs to keep the Stripe dashboard clean.

async function cleanupStripeSeedObjects(stripe: Stripe): Promise<void> {
  // 1. Archive stale seed Products and their Prices
  // Stripe doesn't allow deleting products with prices, so we archive instead.
  const seedProducts = await stripe.products.search({
    query: "metadata['codex_seed']:'true' AND active:'true'",
    limit: 100,
  });

  for (const product of seedProducts.data) {
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

  if (seedProducts.data.length > 0) {
    console.log(
      `  🧹 Archived ${seedProducts.data.length} stale Stripe products + prices`
    );
  }

  // 2. Find existing seed Connect accounts (can't delete, but we track for reuse)
  // Stripe accounts.list doesn't support metadata filtering, so we list recent and check
  const accounts = await stripe.accounts.list({ limit: 20 });
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

async function activateConnectAccount(
  stripe: Stripe,
  accountId: string
): Promise<{ chargesEnabled: boolean; payoutsEnabled: boolean }> {
  // Pre-fill all required fields for a GB Express account
  await stripe.accounts.update(accountId, {
    business_type: 'individual',
    business_profile: {
      mcc: '5815', // Digital goods — matches content streaming platform
      url: 'https://studioalpha.test',
    },
    individual: {
      first_name: 'Alex',
      last_name: 'Creator',
      email: 'creator@test.com',
      phone: '+44 7700 900000', // Stripe-valid UK test number
      dob: { day: 1, month: 1, year: 1990 },
      address: {
        line1: '1 Test Street',
        city: 'London',
        postal_code: 'EC1A 1BB',
        country: 'GB',
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

  // Fetch the updated account to check if capabilities activated
  const updated = await stripe.accounts.retrieve(accountId);
  return {
    chargesEnabled: updated.charges_enabled ?? false,
    payoutsEnabled: updated.payouts_enabled ?? false,
  };
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
  // content rows can reference `minimumTierId` at insert time. Stripe
  // Product/Price linkage still happens here, below.

  // ── Stripe Objects (Products, Prices, Connect) ──────────────────
  // Only runs when STRIPE_SECRET_KEY is available.
  // 1. Cleans up stale seed objects from previous runs
  // 2. Creates Products + Prices for subscription tiers
  // 3. Creates (or reuses) a Connect account with pre-filled activation
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey) {
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
  // viewer@test.com subscribes to Alpha Standard tier.
  // This lets us test: viewer can access Standard-tier content but NOT Pro-tier.
  const subMonthly = TIERS.alphaStandard.priceMonthly; // £4.99
  const subPlatformFee = Math.round(subMonthly * 0.1);
  const subCreatorPayout = subMonthly - subPlatformFee;

  await db.insert(schema.subscriptions).values([
    {
      id: SUBSCRIPTIONS.viewerAlphaStandard.id,
      userId: USERS.viewer.id,
      organizationId: ORGS.alpha.id,
      tierId: TIERS.alphaStandard.id,
      stripeSubscriptionId: 'sub_seed_viewer_alpha_standard',
      stripeCustomerId: 'cus_seed_viewer',
      status: 'active',
      billingInterval: 'month',
      currentPeriodStart: now,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30 days
      amountCents: subMonthly,
      platformFeeCents: subPlatformFee,
      organizationFeeCents: 0,
      creatorPayoutCents: subCreatorPayout,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  // ── Stripe Connect account for Studio Alpha ─────────────────────
  // Reuses an existing seed account if found, otherwise creates a new one.
  // Pre-fills all onboarding requirements so the account is genuinely active in Stripe
  // (charges_enabled + payouts_enabled = true) — checkout with transfer_data works.
  if (stripeKey) {
    const stripe = new Stripe(stripeKey);

    // Try to reuse an existing seed Connect account
    const existingAccounts = await stripe.accounts.list({ limit: 20 });
    const existingSeed = existingAccounts.data.find(
      (a) =>
        a.metadata?.codex_seed === 'true' &&
        a.metadata?.codex_organization_id === ORGS.alpha.id
    );

    let accountId: string;

    if (
      existingSeed &&
      existingSeed.controller?.requirement_collection === 'application'
    ) {
      // Reuse existing seed account (must be application-managed for pre-fill)
      accountId = existingSeed.id;
      console.log(`  ♻ Reusing existing seed Connect account (${accountId})`);
    } else {
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
          codex_organization_id: ORGS.alpha.id,
          codex_user_id: USERS.creator.id,
          codex_seed: 'true',
        },
      });
      accountId = account.id;
      console.log(`  ✓ Created new Connect account (${accountId})`);
    }

    // Pre-fill onboarding requirements to activate the account in test mode
    const { chargesEnabled, payoutsEnabled } = await activateConnectAccount(
      stripe,
      accountId
    );

    await db
      .insert(schema.stripeConnectAccounts)
      .values({
        id: CONNECT_ACCOUNTS.alphaCreator.id,
        organizationId: ORGS.alpha.id,
        userId: USERS.creator.id,
        stripeAccountId: accountId,
        status: chargesEnabled ? 'active' : 'onboarding',
        chargesEnabled,
        payoutsEnabled,
        onboardingCompletedAt: chargesEnabled ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    const statusIcon = chargesEnabled ? '✓' : '⚠';
    console.log(
      `  ${statusIcon} Connect account ${accountId} — charges: ${chargesEnabled}, payouts: ${payoutsEnabled}`
    );
    console.log(
      `  Seeded platform fee, 14 purchases, 15 content access, 4 tiers, 1 subscription`
    );
  } else {
    console.log(
      '  Seeded platform fee, 14 purchases, 15 content access, 4 tiers, 1 subscription (skipped Stripe — no STRIPE_SECRET_KEY)'
    );
  }
}
