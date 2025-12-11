/**
 * E-commerce API Types
 *
 * Type definitions for the e-commerce API worker.
 * Extends shared HonoEnv with Stripe-specific Variables.
 *
 * Note: Stripe credentials (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET_*)
 * are defined in shared Bindings, not custom per-worker types.
 */

import type { ObservabilityClient } from '@codex/observability';
import type { HonoEnv } from '@codex/shared-types';
import type Stripe from 'stripe';

/**
 * Stripe-specific context variables
 * Set by webhook middleware after signature verification
 */
type StripeWebhookVariables = {
  /**
   * Verified Stripe event from webhook
   * Set by verifyStripeSignature middleware
   */
  stripeEvent: Stripe.Event;

  /**
   * Stripe API client instance
   * Initialized with STRIPE_SECRET_KEY from shared Bindings
   */
  stripe: Stripe;

  /**
   * Observability client for logging and metrics
   * Set by observability middleware
   */
  obs: ObservabilityClient;
};

/**
 * E-commerce API Worker Environment
 * Uses base HonoEnv with extended Variables for Stripe context
 */
export type StripeWebhookEnv = {
  Bindings: HonoEnv['Bindings'];
  Variables: HonoEnv['Variables'] & StripeWebhookVariables;
};
