/**
 * Checkout Routes
 *
 * Handles Stripe Checkout session creation for content purchases.
 *
 * Endpoints:
 * - POST /checkout/create - Create Stripe Checkout session
 * - POST /checkout/complete - Record a paid session's purchase on arrival
 * - GET /checkout/verify - Where a session stands, for the success page
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

import { invalidateUserLibrary } from '@codex/cache';
import type { ObservabilityClient } from '@codex/observability';
import type { CheckoutSessionVerifyResult } from '@codex/purchase';
import { ServiceUnavailableError } from '@codex/service-errors';
import type { HonoEnv } from '@codex/shared-types';
import {
  completeCheckoutSessionSchema,
  createCheckoutSchema,
  createCourseCheckoutSchema,
  createCourseSubscriptionCheckoutSchema,
  createPortalSessionSchema,
  verifyCheckoutSessionSchema,
} from '@codex/validation';
import { procedure } from '@codex/worker-utils';
import { Hono } from 'hono';
import {
  type CheckoutCompletion,
  completeCheckoutSession,
  resolvePaymentIntentCharge,
} from '../handlers/checkout';
import {
  describeRootCause,
  isTransientError,
} from '../utils/error-classification';

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

/**
 * The success page recorded the purchase, and something after the commit
 * failed. The webhook's redelivery finishes it when a retry can help (its
 * transient failure is a 500, which Stripe redelivers); a permanent one is
 * acknowledged there too, so no retry is coming and support must finish it.
 */
function warnFinishedLater(
  obs: ObservabilityClient | undefined,
  fields: { sessionId: string; purchaseId?: string; failure: unknown }
) {
  const transient = isTransientError(fields.failure);
  obs?.warn(
    transient
      ? 'Recorded from the success page; the webhook finishes the rest'
      : 'Recorded from the success page; support must finish the rest',
    {
      errorId: crypto.randomUUID(),
      sessionId: fields.sessionId,
      purchaseId: fields.purchaseId,
      transient,
      cause: describeRootCause(fields.failure),
    }
  );
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
      rateLimit: 'strict', // 20/min for checkout operations
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
 * POST /checkout/course
 *
 * Create a Stripe Checkout session for a one-off COURSE purchase (Codex-2pryk
 * WP-6 · SPEC §7). The org + creator (payout recipient) are resolved server-side
 * from the course row; the client supplies only the courseId + redirect URLs.
 */
checkout.post(
  '/course',
  procedure({
    policy: { auth: 'required', rateLimit: 'strict' },
    input: { body: createCourseCheckoutSchema },
    handler: async (ctx): Promise<CheckoutSessionResponse> => {
      const { courseId, successUrl, cancelUrl } = ctx.input.body;
      const session = await ctx.services.purchase.createCourseCheckoutSession(
        { courseId, successUrl, cancelUrl },
        ctx.user.id
      );
      return { sessionUrl: session.sessionUrl, sessionId: session.sessionId };
    },
  })
);

/**
 * POST /checkout/course-subscription
 *
 * Create a Stripe Checkout session for a course-specific SUBSCRIPTION (SPEC §7
 * path 3). The plan + Stripe Price are resolved server-side from the courseId.
 */
checkout.post(
  '/course-subscription',
  procedure({
    policy: { auth: 'required', rateLimit: 'strict' },
    input: { body: createCourseSubscriptionCheckoutSchema },
    handler: async (ctx): Promise<CheckoutSessionResponse> => {
      const session =
        await ctx.services.courseSubscription.createCheckoutSession(
          ctx.user.id,
          ctx.input.body
        );
      return { sessionUrl: session.sessionUrl, sessionId: session.sessionId };
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
      rateLimit: 'strict',
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

/**
 * POST /checkout/complete
 *
 * Record the purchase a paid checkout session stands for, the moment the
 * buyer lands on the success page (Codex-2hxff.22; owner decision 2026-10-26,
 * "Unlock on arrival"; Stripe's "trigger fulfillment on your landing page").
 * It runs `completeCheckoutSession`, the webhook's own completion, for content
 * and course purchases alike. The webhook stays the backstop: whichever runs
 * second finds the work done.
 *
 * Request Body:
 * - sessionId: Stripe checkout session ID (cs_xxx)
 *
 * Response (200): the same `{ data }` as GET /checkout/verify, read after.
 * - Our row already there (the usual case: Stripe holds the redirect while
 *   our webhook answers), or nothing paid: nothing is written.
 * - Paid with no row: recorded, then read again.
 * - A failure after the purchase committed (a payout slice not written, a
 *   clawback not sent) is logged, never answered as an error: the purchase
 *   and its access stand, so the page gets `unlocked` (purchases.md, Errors).
 *   The webhook finishes what is left when a retry can; otherwise support.
 *
 * Error Responses:
 * - 400 Bad Request: Invalid body
 * - 401 Unauthorized: Not authenticated
 * - 403 Forbidden: Session belongs to different user
 * - 404 Not Found: Stripe does not know the session, or another environment's
 * - 429 Too Many Requests: over the `strict` rate limit
 * - 503 Service Unavailable: a failure a retry can fix, with nothing committed
 *
 * Security:
 * - Only the session id comes from the client. The session is read from
 *   Stripe here, and the item, amount and payment status come from it
 * - Rate limiting: strict (20 req/min)
 */
checkout.post(
  '/complete',
  procedure({
    policy: { auth: 'required', rateLimit: 'strict' },
    input: { body: completeCheckoutSessionSchema },
    handler: async (ctx): Promise<CheckoutSessionVerifyResult> => {
      const startedAt = Date.now();
      const { sessionId } = ctx.input.body;
      const purchase = ctx.services.purchase;
      const session = await purchase.retrieveCheckoutSession(
        sessionId,
        ctx.user.id
      );

      const arrival = await purchase.readCheckoutSession(session, ctx.user.id);
      if (arrival.recorded || arrival.result.state !== 'recording') {
        ctx.obs?.info('Checkout completed from the success page', {
          sessionId,
          trigger: 'landing',
          outcome: arrival.recorded ? 'already_recorded' : 'not_paid',
          durationMs: Date.now() - startedAt,
        });
        return arrival.result;
      }

      let completion: CheckoutCompletion;
      try {
        completion = await completeCheckoutSession(session, {
          env: ctx.env,
          executionCtx: ctx.executionCtx,
          obs: ctx.obs,
          trigger: 'landing',
          resolveCharge: (paymentIntentId) =>
            resolvePaymentIntentCharge(
              () => purchase.retrievePaymentIntentCharge(paymentIntentId),
              paymentIntentId,
              ctx.obs
            ),
          withPurchaseService: (run) => run(purchase),
        });
      } catch (error) {
        // Only a clawback's failure comes back as `completion.failure`; a
        // payout slice that could not be written is thrown, after the
        // purchase committed. Our row tells the two apart. If the read fails
        // too, the original error is the answer.
        const after = await purchase
          .readCheckoutSession(session, ctx.user.id)
          .catch(() => undefined);
        if (after?.result.state === 'unlocked') {
          warnFinishedLater(ctx.obs, {
            sessionId,
            purchaseId: after.result.purchase?.id,
            failure: error,
          });
          // The completion threw before its own library bump.
          invalidateUserLibrary({
            kv: ctx.env.CACHE_KV,
            waitUntil: ctx.executionCtx.waitUntil.bind(ctx.executionCtx),
            userId: ctx.user.id,
            logger: ctx.obs,
          });
          ctx.obs?.info('Checkout completed from the success page', {
            sessionId,
            trigger: 'landing',
            outcome: 'recorded',
            purchaseId: after.result.purchase?.id,
            durationMs: Date.now() - startedAt,
          });
          return after.result;
        }
        // Nothing committed. A failure a retry can fix (an outage, the
        // duplicate's refund still in flight) is "not yet" to the page,
        // which checks again; the webhook records it meanwhile.
        if (isTransientError(error)) {
          throw new ServiceUnavailableError(
            'The purchase could not be recorded yet',
            { sessionId },
            { cause: error }
          );
        }
        throw error;
      }

      if (completion.kind === 'completed' && completion.failure) {
        warnFinishedLater(ctx.obs, {
          sessionId,
          purchaseId: completion.purchase.id,
          failure: completion.failure,
        });
      }

      const recorded = await purchase.readCheckoutSession(session, ctx.user.id);
      ctx.obs?.info('Checkout completed from the success page', {
        sessionId,
        trigger: 'landing',
        outcome:
          completion.kind === 'skipped'
            ? `skipped:${completion.reason}`
            : 'recorded',
        purchaseId:
          completion.kind === 'completed' ? completion.purchase.id : undefined,
        durationMs: Date.now() - startedAt,
      });
      return recorded.result;
    },
  })
);

/**
 * GET /checkout/verify
 *
 * Verify Stripe checkout session status for success page display
 *
 * Query Params:
 * - session_id: Stripe checkout session ID (cs_xxx)
 *
 * Response (200):
 * {
 *   "data": {
 *     "sessionStatus": "complete",
 *     "state": "unlocked",
 *     "purchase": { ... },
 *     "content": { ... }
 *   }
 * }
 *
 * Error Responses:
 * - 400 Bad Request: Invalid session_id format
 * - 401 Unauthorized: Not authenticated
 * - 403 Forbidden: Session belongs to different user
 * - 404 Not Found: Stripe does not know the session, or another environment's
 * - 500 Internal Server Error: Stripe API failure
 *
 * Security:
 * - Requires authentication (withPolicy)
 * - Rate limiting: api (100 req/min, the default)
 * - Validates session ownership via metadata.customerId
 */
checkout.get(
  '/verify',
  procedure({
    policy: { auth: 'required' },
    input: { query: verifyCheckoutSessionSchema },
    handler: async (ctx) => {
      return await ctx.services.purchase.verifyCheckoutSession(
        ctx.input.query.session_id,
        ctx.user.id
      );
    },
  })
);

/**
 * GET /checkout/course-subscription/verify
 *
 * The course-plan counterpart of `/checkout/verify` (Codex-o4jvw): the
 * journey success page reads `subscription` once our row exists, and its
 * `duplicateOf` for a second subscription to a course the buyer already
 * holds. Ownership is checked against `metadata.codex_user_id`; errors as
 * `/subscriptions/verify`.
 */
checkout.get(
  '/course-subscription/verify',
  procedure({
    policy: { auth: 'required' },
    input: { query: verifyCheckoutSessionSchema },
    handler: async (ctx) => {
      return await ctx.services.courseSubscription.verifyCheckoutSession(
        ctx.input.query.session_id,
        ctx.user.id
      );
    },
  })
);

export default checkout;
