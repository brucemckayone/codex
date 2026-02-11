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
 * - Strict rate limiting: 10 requests/minute (prevents abuse)
 * - Validates input with createCheckoutSchema
 *
 * Integration:
 * - PurchaseService - Creates checkout session via Stripe
 * - Content validation - Ensures content exists and is purchasable
 * - Access control - Prevents duplicate purchases
 */

import type { HonoEnv } from '@codex/shared-types';
import {
  createCheckoutSchema,
  createPortalSessionSchema,
} from '@codex/validation';
import { procedure } from '@codex/worker-utils';
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
 * - Strict rate limiting: 10 requests/minute (prevents checkout session abuse)
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
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'auth', // 10 req/min - stricter than default api (100 req/min)
    },
    input: { body: createCheckoutSchema },
    handler: async (ctx): Promise<CheckoutSessionResponse> => {
      // Extract validated input
      const { contentId, successUrl, cancelUrl } = ctx.input.body;

      // Create checkout session (uses authenticated user's ID as customerId)
      const session = await ctx.services.purchase.createCheckoutSession(
        {
          contentId,
          successUrl,
          cancelUrl,
        },
        ctx.user.id
      );

      // Return checkout session URL and ID
      return {
        sessionUrl: session.sessionUrl,
        sessionId: session.sessionId,
      };
    },
  })
);

/**
 * POST /checkout/portal-session
 *
 * Create Stripe Billing Portal session for managing subscriptions and payments
 *
 * Request Body:
 * - returnUrl: Redirect URL after portal interaction (whitelisted domains only)
 *
 * Response (200):
 * {
 *   "data": {
 *     "url": "https://billing.stripe.com/..."
 *   }
 * }
 */
checkout.post(
  '/portal-session',
  procedure({
    policy: {
      auth: 'required',
      rateLimit: 'auth',
    },
    input: { body: createPortalSessionSchema },
    handler: async (ctx) => {
      return await ctx.services.purchase.createPortalSession(
        ctx.user.email,
        ctx.user.id,
        ctx.input.body.returnUrl
      );
    },
  })
);

export default checkout;
