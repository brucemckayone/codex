/**
 * Stripe Webhook Testing Utilities
 *
 * Provides helpers for programmatically generating valid Stripe webhook signatures
 * and creating checkout.session.completed event payloads for E2E testing.
 *
 * Uses Stripe's official generateTestHeaderString() method to create valid
 * HMAC-SHA256 signatures, ensuring compatibility with Stripe's verification logic.
 */

import type { APIRequestContext, APIResponse } from '@playwright/test';
import Stripe from 'stripe';

/**
 * Checkout session object as embedded in webhook events
 */
export interface StripeCheckoutSession {
  id: string;
  object: 'checkout.session';
  payment_intent: string;
  customer: string;
  customer_email: string;
  amount_total: number;
  currency: string;
  metadata: {
    customerId: string;
    contentId: string;
    organizationId: string | null;
  };
  status: string;
  client_reference_id: string;
  payment_status: string;
  mode: string;
}

/**
 * Stripe webhook event structure for checkout.session.completed
 */
export interface StripeCheckoutWebhookEvent {
  id: string;
  object: 'event';
  api_version: string;
  created: number;
  livemode: boolean;
  type: 'checkout.session.completed';
  data: {
    object: StripeCheckoutSession;
  };
  pending_webhooks: number;
  request: {
    id: null;
    idempotency_key: null;
  };
}

/**
 * Generate valid Stripe webhook signature for testing
 *
 * Uses Stripe's official generateTestHeaderString() method to create a properly
 * signed webhook header. This ensures the signature matches exactly what Stripe's
 * constructEvent() expects during verification.
 *
 * @param rawBody - Raw JSON string of webhook event (MUST be exact bytes)
 * @param webhookSecret - Webhook signing secret (STRIPE_WEBHOOK_SECRET_BOOKING)
 * @param timestamp - Optional unix timestamp in seconds (defaults to current time)
 * @returns Stripe signature header value: "t=<timestamp>,v1=<signature>"
 *
 * @example
 * const event = { type: 'checkout.session.completed', ... };
 * const rawBody = JSON.stringify(event);
 * const signature = generateStripeSignature(
 *   rawBody,
 *   process.env.STRIPE_WEBHOOK_SECRET_BOOKING!
 * );
 * // Returns: "t=1234567890,v1=abc123def456..."
 */
export function generateStripeSignature(
  rawBody: string,
  webhookSecret: string,
  timestamp?: number
): string {
  // Use Stripe's official test signature generator
  // This ensures 100% compatibility with Stripe's verification logic
  const stripe = new Stripe('sk_test_dummy', {
    apiVersion: '2025-10-29.clover',
  });

  return stripe.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret: webhookSecret,
    timestamp: timestamp,
  });
}

/**
 * Parameters for creating checkout.session.completed event
 */
export interface CheckoutCompletedEventParams {
  /** Stripe Checkout session ID (cs_...) */
  sessionId: string;
  /** Stripe Payment Intent ID (pi_...) - used as idempotency key */
  paymentIntentId: string;
  /** Codex user ID (UUID) making the purchase */
  customerId: string;
  /** Codex content ID (UUID) being purchased */
  contentId: string;
  /** Amount paid in cents (e.g., 2999 for $29.99) */
  amountCents: number;
  /** Optional organization ID (UUID) */
  organizationId?: string;
}

/**
 * Create checkout.session.completed webhook event payload
 *
 * Constructs a Stripe webhook event matching the structure expected by
 * the ecom-api webhook handler. All metadata fields are properly populated
 * to enable purchase recording and access granting.
 *
 * @param params - Event parameters (IDs, amount, metadata)
 * @returns Stripe Event object ready for webhook delivery
 *
 * @example
 * const event = createCheckoutCompletedEvent({
 *   sessionId: 'cs_test_abc123',
 *   paymentIntentId: 'pi_test_xyz789',
 *   customerId: user.id,
 *   contentId: content.id,
 *   amountCents: 2999,
 * });
 * // Use with sendSignedWebhook() to simulate webhook
 */
export function createCheckoutCompletedEvent(
  params: CheckoutCompletedEventParams
): StripeCheckoutWebhookEvent {
  const timestamp = Math.floor(Date.now() / 1000);

  return {
    id: `evt_test_${timestamp}_${Math.random().toString(36).slice(2)}`,
    object: 'event',
    api_version: '2025-10-29.clover', // Matches Stripe client API version
    created: timestamp,
    livemode: false,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: params.sessionId,
        object: 'checkout.session',
        payment_intent: params.paymentIntentId,
        customer: `cus_test_${timestamp}`,
        customer_email: `test-${timestamp}@example.com`,
        amount_total: params.amountCents, // Already in cents
        currency: 'usd',
        metadata: {
          customerId: params.customerId,
          contentId: params.contentId,
          organizationId: params.organizationId || null,
        },
        status: 'complete',
        client_reference_id: params.customerId,
        payment_status: 'paid',
        mode: 'payment',
      },
    },
    pending_webhooks: 1,
    request: {
      id: null,
      idempotency_key: null,
    },
  };
}

/**
 * Send webhook request with valid HMAC-SHA256 signature
 *
 * Sends a webhook event to the specified URL with a cryptographically valid
 * Stripe signature generated using Stripe's official test signature method.
 *
 * This function handles the complete workflow:
 * 1. Serialize event to JSON string (raw body)
 * 2. Generate valid signature using Stripe SDK
 * 3. Set required headers (Content-Type, stripe-signature)
 * 4. Send POST request
 *
 * @param request - Playwright API request context
 * @param webhookUrl - Full webhook endpoint URL
 * @param event - Stripe event object (will be JSON serialized)
 * @param webhookSecret - Webhook signing secret for signature generation
 * @returns Playwright API response
 *
 * @example
 * const event = createCheckoutCompletedEvent({ ... });
 * const response = await sendSignedWebhook(
 *   request,
 *   'http://localhost:42072/webhooks/stripe/booking',
 *   event,
 *   process.env.STRIPE_WEBHOOK_SECRET_BOOKING!
 * );
 * expect(response.status()).toBe(200);
 */
export async function sendSignedWebhook(
  request: APIRequestContext,
  webhookUrl: string,
  event: StripeCheckoutWebhookEvent,
  webhookSecret: string
): Promise<APIResponse> {
  // Serialize event to exact JSON string (critical for signature verification)
  const rawBody = JSON.stringify(event);

  // Generate valid signature using Stripe's official method
  const signature = generateStripeSignature(rawBody, webhookSecret);

  // Send webhook with signature header
  return await request.post(webhookUrl, {
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': signature,
    },
    data: rawBody, // Send as raw string, not parsed JSON
  });
}
