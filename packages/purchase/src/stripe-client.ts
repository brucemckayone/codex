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
 * Current: 2025-02-24.acacia (pinned by Stripe Node v19.2.0)
 */
const STRIPE_API_VERSION = '2025-02-24.acacia';

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
 * const event = verifyWebhookSignature(
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
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  webhookSecret: string,
  stripeClient: Stripe
): Stripe.Event {
  if (!signature) {
    throw new Error('Missing stripe-signature header');
  }

  if (!webhookSecret) {
    throw new Error('Webhook secret not configured');
  }

  return stripeClient.webhooks.constructEvent(
    rawBody,
    signature,
    webhookSecret
  );
}
