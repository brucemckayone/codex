/**
 * Stripe test-mode subscription helpers for the seed script.
 *
 * Creates real test-mode Stripe customers + subscriptions for seeded users
 * when STRIPE_SECRET_KEY is available, so E2E tests that exercise
 * cancel/reactivate flows hit real Stripe objects (not 404 synthetic IDs).
 *
 * Falls back to synthetic IDs when the key is absent — preserves the
 * existing zero-config seed behaviour for fresh clones and CI without
 * Stripe credentials.
 *
 * Hard rules:
 * - Never runs against live keys — sk_live_* is explicitly rejected
 * - All create calls use deterministic idempotency keys so re-running
 *   pnpm db:seed does not create duplicates
 * - Existing objects are found by metadata tag (codex_seed_user_id,
 *   codex_seed_subscription_id) before attempting to create new ones
 */

import type Stripe from 'stripe';

/**
 * Synthetic fallback IDs used when STRIPE_SECRET_KEY is not set.
 * Preserves the pre-Codex-z1wuz zero-config seed behaviour.
 */
export const SYNTHETIC_STRIPE_CUSTOMER_ID = 'cus_seed_viewer';
export const SYNTHETIC_STRIPE_SUBSCRIPTION_ID =
  'sub_seed_viewer_alpha_standard';

/** Metadata tag placed on every Codex seed-created Stripe object. */
const SEED_METADATA_TAG = 'codex_seed';

/**
 * Guard against seeding into a live Stripe account. Throws immediately
 * if the key starts with sk_live_. Returns silently for sk_test_ keys
 * (or the restricted-key rk_test_ prefix).
 */
export function assertTestModeKey(stripeKey: string): void {
  if (stripeKey.startsWith('sk_live_') || stripeKey.startsWith('rk_live_')) {
    throw new Error(
      'REFUSING TO SEED AGAINST LIVE STRIPE KEY. ' +
        'STRIPE_SECRET_KEY starts with sk_live_/rk_live_ — the seed script ' +
        'creates and cancels test fixtures and MUST only run against test mode. ' +
        'Use a sk_test_* key from https://dashboard.stripe.com/test/apikeys'
    );
  }

  if (!stripeKey.startsWith('sk_test_') && !stripeKey.startsWith('rk_test_')) {
    // Not a recognised prefix — warn but do not block (user may be running
    // against stripe-mock or a forwarded test environment).
    console.warn(
      `  ⚠ STRIPE_SECRET_KEY does not start with sk_test_ — proceeding but refusing to run against sk_live_*.`
    );
  }
}

/**
 * Canonical prefix check used by assertions/tests without logging the key.
 * Returns 'live', 'test', or 'unknown'.
 */
export function classifyStripeKey(
  stripeKey: string | undefined
): 'live' | 'test' | 'unknown' | 'missing' {
  if (!stripeKey) {
    return 'missing';
  }
  if (stripeKey.startsWith('sk_live_') || stripeKey.startsWith('rk_live_')) {
    return 'live';
  }
  if (stripeKey.startsWith('sk_test_') || stripeKey.startsWith('rk_test_')) {
    return 'test';
  }
  return 'unknown';
}

interface SeedStripeUser {
  /** Codex user id (stable across seeds) — used for idempotency + metadata tag. */
  id: string;
  email: string;
  name: string;
}

interface SeedStripeTier {
  /** Codex tier id — used for idempotency + metadata tag. */
  id: string;
  stripePriceMonthlyId: string;
  stripePriceAnnualId: string;
}

interface SeedSubscriptionResult {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

/**
 * Create or look up a Stripe test-mode customer for a seeded user.
 *
 * Lookup order:
 *   1. customers.search by metadata.codex_seed_user_id (exact, idempotent)
 *   2. customers.create with idempotency key `seed_customer_${userId}`
 *
 * The idempotency key means a re-run within 24h returns the original
 * customer; after 24h, the metadata search catches duplicates.
 */
export async function createOrFindStripeCustomer(
  stripe: Stripe,
  user: SeedStripeUser
): Promise<Stripe.Customer> {
  // Step 1 — metadata search (durable across idempotency key expiry)
  const existing = await stripe.customers.search({
    query: `metadata['codex_seed_user_id']:'${user.id}' AND metadata['codex_seed']:'true'`,
    limit: 1,
  });

  if (existing.data.length > 0) {
    return existing.data[0];
  }

  // Step 2 — create with idempotency key (protects burst re-runs)
  try {
    return await stripe.customers.create(
      {
        email: user.email,
        name: user.name,
        metadata: {
          codex_seed_user_id: user.id,
          [SEED_METADATA_TAG]: 'true',
        },
      },
      {
        idempotencyKey: `seed_customer_${user.id}`,
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to create Stripe customer for seed user ${user.email}: ${message}`
    );
  }
}

/**
 * Ensure a customer has a default test-mode payment method attached.
 *
 * Stripe subscriptions require a payment method to collect recurring
 * charges. In test mode we can use the documented `tok_visa` card token
 * (never real PII). This function is idempotent — if the customer
 * already has an `invoice_settings.default_payment_method`, we leave it.
 */
async function ensureDefaultPaymentMethod(
  stripe: Stripe,
  customer: Stripe.Customer
): Promise<string> {
  const existingDefault =
    typeof customer.invoice_settings?.default_payment_method === 'string'
      ? customer.invoice_settings.default_payment_method
      : customer.invoice_settings?.default_payment_method?.id;

  if (existingDefault) {
    return existingDefault;
  }

  // Create a payment method from the Stripe-documented test token.
  // `tok_visa` is a static test token — NEVER use in production.
  const pm = await stripe.paymentMethods.create(
    {
      type: 'card',
      card: { token: 'tok_visa' },
    },
    {
      idempotencyKey: `seed_pm_${customer.id}`,
    }
  );

  await stripe.paymentMethods.attach(pm.id, { customer: customer.id });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: pm.id },
  });

  return pm.id;
}

interface CreateSubscriptionArgs {
  user: SeedStripeUser;
  tier: SeedStripeTier;
  /** Codex subscription id — used as the primary idempotency/metadata key. */
  subscriptionSeedId: string;
  billingInterval: 'month' | 'year';
}

/**
 * Create or look up a Stripe test-mode subscription for a seeded user.
 *
 * Lookup order:
 *   1. subscriptions.search by metadata.codex_seed_subscription_id
 *      (catches re-runs even after the idempotency key expires).
 *      Active-ish subscriptions (active/trialing/past_due) are reused;
 *      cancelled ones are ignored so a new active fixture is created.
 *   2. subscriptions.create with idempotency key
 *      `seed_subscription_${subscriptionSeedId}`
 *
 * Returns the Stripe IDs + period timestamps so the seed can write
 * matching currentPeriodStart/End to the DB.
 */
export async function createOrFindStripeSubscription(
  stripe: Stripe,
  args: CreateSubscriptionArgs
): Promise<SeedSubscriptionResult> {
  const { user, tier, subscriptionSeedId, billingInterval } = args;

  // Ensure the customer exists first (idempotent).
  const customer = await createOrFindStripeCustomer(stripe, user);

  // Ensure a default payment method so subscriptions.create can charge.
  await ensureDefaultPaymentMethod(stripe, customer);

  // Step 1 — search for an existing seed subscription by metadata.
  const existing = await stripe.subscriptions.search({
    query: `metadata['codex_seed_subscription_id']:'${subscriptionSeedId}' AND metadata['codex_seed']:'true'`,
    limit: 5,
  });

  const reusable = existing.data.find((sub) =>
    ['active', 'trialing', 'past_due'].includes(sub.status)
  );

  if (reusable) {
    return mapSubscriptionToResult(reusable);
  }

  const priceId =
    billingInterval === 'month'
      ? tier.stripePriceMonthlyId
      : tier.stripePriceAnnualId;

  if (!priceId) {
    throw new Error(
      `Cannot create seed subscription for tier ${tier.id}: missing ` +
        `${billingInterval === 'month' ? 'stripePriceMonthlyId' : 'stripePriceAnnualId'}. ` +
        'Tier Stripe Products/Prices must be created before subscriptions.'
    );
  }

  try {
    const created = await stripe.subscriptions.create(
      {
        customer: customer.id,
        items: [{ price: priceId }],
        metadata: {
          codex_seed_subscription_id: subscriptionSeedId,
          codex_seed_user_id: user.id,
          codex_seed_tier_id: tier.id,
          [SEED_METADATA_TAG]: 'true',
        },
        // Payment is charged immediately from default_payment_method attached above.
        payment_behavior: 'allow_incomplete',
      },
      {
        idempotencyKey: `seed_subscription_${subscriptionSeedId}`,
      }
    );

    return mapSubscriptionToResult(created);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to create Stripe subscription for seed user ${user.email}: ${message}`
    );
  }
}

/**
 * Extract period start/end from a Stripe Subscription. Handles both
 * older SDK shapes (period fields on Subscription) and newer shapes
 * (period fields live on the subscription item). Falls back to a
 * generated window only if both paths are absent — which should never
 * happen in practice but keeps the seed resilient.
 */
function mapSubscriptionToResult(
  sub: Stripe.Subscription
): SeedSubscriptionResult {
  // Stripe SDK v19+ keeps current_period_start/end on the subscription for
  // non-Checkout subs and on items[0] for some Checkout paths. Read both.
  const subLike = sub as unknown as {
    current_period_start?: number;
    current_period_end?: number;
  };
  const firstItem = sub.items.data[0] as unknown as
    | {
        current_period_start?: number;
        current_period_end?: number;
      }
    | undefined;

  const startSec =
    subLike.current_period_start ?? firstItem?.current_period_start;
  const endSec = subLike.current_period_end ?? firstItem?.current_period_end;

  const customerId =
    typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  const start = startSec ? new Date(startSec * 1000) : new Date();
  const end = endSec
    ? new Date(endSec * 1000)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  return {
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    currentPeriodStart: start,
    currentPeriodEnd: end,
  };
}
