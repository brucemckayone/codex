/**
 * Stripe Webhook Handler Types
 *
 * Type definitions for the Stripe webhook worker.
 * Extends shared types with Stripe-specific bindings.
 */

import type { Bindings as SharedBindings } from '@codex/shared-types';
import type { ObservabilityClient } from '@codex/observability';
import type Stripe from 'stripe';

/**
 * Stripe Webhook Worker Bindings
 * Extends shared bindings with Stripe-specific environment variables
 */
export type StripeWebhookBindings = SharedBindings & {
  /**
   * Stripe API secret key
   */
  STRIPE_SECRET_KEY?: string;

  /**
   * Webhook secret for payment events
   */
  STRIPE_WEBHOOK_SECRET_PAYMENT?: string;

  /**
   * Webhook secret for subscription events
   */
  STRIPE_WEBHOOK_SECRET_SUBSCRIPTION?: string;

  /**
   * Webhook secret for Connect events
   */
  STRIPE_WEBHOOK_SECRET_CONNECT?: string;

  /**
   * Webhook secret for customer events
   */
  STRIPE_WEBHOOK_SECRET_CUSTOMER?: string;

  /**
   * Webhook secret for booking events
   */
  STRIPE_WEBHOOK_SECRET_BOOKING?: string;

  /**
   * Webhook secret for dispute events
   */
  STRIPE_WEBHOOK_SECRET_DISPUTE?: string;
};

/**
 * Stripe-specific context variables
 */
export type StripeWebhookVariables = {
  /**
   * Verified Stripe event from webhook
   */
  stripeEvent: Stripe.Event;

  /**
   * Stripe API client instance
   */
  stripe: Stripe;

  /**
   * Observability client for logging and metrics
   */
  obs: ObservabilityClient;
};

/**
 * Stripe Webhook Worker Environment
 */
export type StripeWebhookEnv = {
  Bindings: StripeWebhookBindings;
  Variables: StripeWebhookVariables;
};
