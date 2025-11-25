/**
 * Checkout Routes
 *
 * Handles Stripe Checkout session creation for content purchases.
 *
 * Endpoints:
 * - POST /checkout/create - Create Stripe Checkout session
 *
 * Security:
 * - Requires authentication (user must be logged in)
 * - Rate limited with 'api' preset (100 req/min)
 * - Validates input with createCheckoutSchema
 *
 * Integration:
 * - PurchaseService - Creates checkout session via Stripe
 * - Content validation - Ensures content exists and is purchasable
 * - Access control - Prevents duplicate purchases
 */

import { dbHttp } from '@codex/database';
import {
  createStripeClient,
  PaymentProcessingError,
  PurchaseService,
} from '@codex/purchase';
import type { HonoEnv, SingleItemResponse } from '@codex/shared-types';
import { createCheckoutSchema } from '@codex/validation';
import {
  createAuthenticatedHandler,
  POLICY_PRESETS,
  withPolicy,
} from '@codex/worker-utils';
import { Hono } from 'hono';

// ============================================================================
// Types
// ============================================================================

/**
 * Checkout session response
 * Contains Stripe Checkout URL and session ID
 */
interface CheckoutSessionResponse {
  sessionUrl: string;
  sessionId: string;
}

// ============================================================================
// Routes
// ============================================================================

const checkout = new Hono<HonoEnv>();

/**
 * POST /checkout/create
 *
 * Create Stripe Checkout session for content purchase
 *
 * Request Body:
 * - contentId: UUID of content to purchase
 * - successUrl: Redirect URL after successful payment
 * - cancelUrl: Redirect URL if user cancels
 *
 * Response (200):
 * {
 *   "data": {
 *     "sessionUrl": "https://checkout.stripe.com/...",
 *     "sessionId": "cs_..."
 *   }
 * }
 *
 * Error Responses:
 * - 400 Bad Request: Invalid input (validation failed)
 * - 401 Unauthorized: Not authenticated
 * - 409 Conflict: Content already purchased (AlreadyPurchasedError)
 * - 400 Bad Request: Content not purchasable (ContentNotPurchasableError)
 * - 500 Internal Server Error: Payment processing failed (PaymentProcessingError)
 *
 * Security:
 * - Requires authentication (withPolicy)
 * - Rate limited (POLICY_PRESETS.authenticated includes rate limiting)
 * - User can only create checkout for themselves (uses session userId)
 * - Validates content is published, has price, and not already purchased
 *
 * Example:
 * POST /checkout/create
 * {
 *   "contentId": "550e8400-e29b-41d4-a716-446655440000",
 *   "successUrl": "https://app.example.com/purchase/success",
 *   "cancelUrl": "https://app.example.com/purchase/cancel"
 * }
 */
checkout.post(
  '/create',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedHandler({
    schema: {
      body: createCheckoutSchema,
    },
    handler: async (_c, ctx) => {
      // Initialize Stripe client
      const stripeSecretKey = ctx.env.STRIPE_SECRET_KEY;
      if (!stripeSecretKey) {
        throw new PaymentProcessingError('STRIPE_SECRET_KEY not configured');
      }

      const stripe = createStripeClient(stripeSecretKey);

      // Initialize purchase service
      const purchaseService = new PurchaseService(
        {
          db: dbHttp,
          environment: ctx.env.ENVIRONMENT || 'development',
        },
        stripe
      );

      // Extract validated input
      const { contentId, successUrl, cancelUrl } = ctx.validated.body;

      // Create checkout session (uses authenticated user's ID as customerId)
      const session = await purchaseService.createCheckoutSession(
        {
          contentId,
          successUrl,
          cancelUrl,
        },
        ctx.user.id
      );

      // Return checkout session URL and ID
      const response: SingleItemResponse<CheckoutSessionResponse> = {
        data: {
          sessionUrl: session.sessionUrl,
          sessionId: session.sessionId,
        },
      };

      return response;
    },
  })
);

export default checkout;
