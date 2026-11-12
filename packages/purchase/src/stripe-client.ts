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
 * Stripe API version: the one every request is made at. Updated when
 * upgrading the Stripe API version.
 * Current: 2026-10-28.endive, the version stripe-node 23.1.0 pins (its
 * `esm/apiVersion.js`).
 *
 * Exported so test fixtures that build a Stripe event can say the version
 * the platform asks for. A webhook payload itself is rendered at the
 * endpoint's own API version, which is set in the Stripe Dashboard.
 *
 * Before an upgrade, run packages/subscription/scripts/test-clock-paid-price.ts
 * on the new version: a switch after an early price move relies on Stripe
 * crediting the invoiced line, not the item's current Price (Codex-2hxff.95).
 */
export const STRIPE_API_VERSION = '2026-10-28.endive';

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
