/**
 * Stripe Client Factory
 *
 * Centralized Stripe client initialization and webhook verification.
 * Provides single source of truth for Stripe API version and configuration.
 *
 * Usage:
 * ```typescript
 * import { createStripeClient, verifyWebhookSignature } from '@codex/purchase';
 *
 * // In checkout routes
 * const stripe = createStripeClient(env.STRIPE_SECRET_KEY);
 *
 * // In webhook middleware
 * const event = verifyWebhookSignature(
 *   rawBody,
 *   signature,
 *   env.STRIPE_WEBHOOK_SECRET_BOOKING,
 *   stripe
 * );
 * ```
 */

import Stripe from 'stripe';

/**
 * Stripe API version
 * Internal constant - updated when upgrading Stripe API version
 * Current: 2025-10-29.clover (pinned by Stripe Node v19.3.1)
 */
const STRIPE_API_VERSION = '2025-10-29.clover';

/**
 * Create configured Stripe client instance
 *
 * Provides consistent Stripe initialization across all workers and services.
 * All Stripe operations should use this factory instead of direct instantiation.
 *
 * @param apiKey - Stripe API secret key (from env.STRIPE_SECRET_KEY)
 * @returns Configured Stripe client with pinned API version
 * @throws Error if apiKey is empty or undefined
 *
 * @example
 * ```typescript
 * const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);
 * const session = await stripe.checkout.sessions.create({...});
 * ```
 */
export function createStripeClient(apiKey: string): Stripe {
  if (!apiKey) {
    throw new Error('Stripe API key is required');
  }

  return new Stripe(apiKey, {
    apiVersion: STRIPE_API_VERSION,
  });
}

/**
 * Create a lazily-failing Stripe client for contexts that hold a
 * `PurchaseService` only for its DB-backed methods (e.g. `@codex/access`
 * `verifyPurchase`) and never call the Stripe API.
 *
 * content-api is intentionally NOT provisioned with a `STRIPE_SECRET_KEY`
 * (see `.github/scripts/upload-worker-secrets.sh` — Stripe secrets are
 * ecom-api only). Eagerly constructing a real client there throws
 * "Stripe API key is required" and 500s every streaming request, even for
 * free content whose access check is purely a DB read.
 *
 * This returns a `Stripe`-typed proxy that constructs freely (so
 * `new PurchaseService(config, stripe)` and `verifyPurchase()` work) but
 * throws the moment ANY Stripe operation is actually attempted — a genuine
 * misuse still fails loudly, just at call time instead of construction time.
 *
 * @returns A Stripe-typed proxy that throws on any property access
 */
export function createLazyStripeClient(): Stripe {
  return new Proxy(Object.create(null) as Stripe, {
    get(_target, prop) {
      throw new Error(
        `Stripe API key is required (attempted to use stripe.${String(prop)})`
      );
    },
  });
}

/**
 * Verify Stripe webhook signature and construct event
 *
 * Validates webhook authenticity using HMAC-SHA256 signature verification.
 * Prevents webhook spoofing and ensures events originate from Stripe.
 *
 * NOTE: Uses async signature verification for Cloudflare Workers compatibility.
 * In edge runtimes, SubtleCrypto requires async operations.
 *
 * @param rawBody - Raw request body (must be exact bytes from Stripe)
 * @param signature - Stripe signature header (stripe-signature)
 * @param webhookSecret - Webhook signing secret (env.STRIPE_WEBHOOK_SECRET_*)
 * @param stripeClient - Initialized Stripe client instance
 * @returns Verified Stripe event object
 * @throws Stripe.errors.StripeSignatureVerificationError if signature invalid
 *
 * @example
 * ```typescript
 * const stripe = createStripeClient(env.STRIPE_SECRET_KEY);
 * const event = await verifyWebhookSignature(
 *   rawBody,
 *   req.header('stripe-signature'),
 *   env.STRIPE_WEBHOOK_SECRET_BOOKING,
 *   stripe
 * );
 * ```
 *
 * Security:
 * - Raw body required (no JSON parsing before verification)
 * - Timing-safe signature comparison
 * - Prevents replay attacks (signature includes timestamp)
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  webhookSecret: string,
  stripeClient: Stripe
): Promise<Stripe.Event> {
  if (!signature) {
    throw new Error('Missing stripe-signature header');
  }

  if (!webhookSecret) {
    throw new Error('Webhook secret not configured');
  }

  return await stripeClient.webhooks.constructEventAsync(
    rawBody,
    signature,
    webhookSecret
  );
}
