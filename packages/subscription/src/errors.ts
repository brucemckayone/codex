/**
 * Subscription Service Errors
 *
 * Domain-specific error classes for subscription, tier, and Connect operations.
 * Extends base errors from @codex/service-errors.
 */

import {
  BusinessLogicError,
  ConflictError,
  NotFoundError,
  ServiceError,
} from '@codex/service-errors';

// Re-export base error classes for convenience
export {
  BusinessLogicError,
  ConflictError,
  ForbiddenError,
  InternalServiceError,
  isServiceError as isSubscriptionServiceError,
  NotFoundError,
  ServiceError as SubscriptionServiceError,
  ValidationError,
  wrapError,
} from '@codex/service-errors';

// ============================================================================
// Tier Errors
// ============================================================================

export class TierNotFoundError extends NotFoundError {
  constructor(tierId: string, context?: Record<string, unknown>) {
    super('Subscription tier not found', {
      tierId,
      code: 'TIER_NOT_FOUND',
      ...context,
    });
  }
}

export class TierHasSubscribersError extends BusinessLogicError {
  constructor(tierId: string, subscriberCount: number) {
    super('Cannot delete tier with active subscribers', {
      tierId,
      subscriberCount,
      code: 'TIER_HAS_SUBSCRIBERS',
    });
  }
}

export class TierSortOrderConflictError extends ConflictError {
  constructor(orgId: string, sortOrder: number) {
    super('A tier with this sort order already exists', {
      orgId,
      sortOrder,
      code: 'TIER_SORT_ORDER_CONFLICT',
    });
  }
}

// ============================================================================
// Subscription Errors
// ============================================================================

export class SubscriptionNotFoundError extends NotFoundError {
  constructor(context?: Record<string, unknown>) {
    super('Subscription not found', {
      code: 'SUBSCRIPTION_NOT_FOUND',
      ...context,
    });
  }
}

export class AlreadySubscribedError extends ConflictError {
  constructor(userId: string, orgId: string) {
    super('User already has an active subscription to this organization', {
      userId,
      orgId,
      code: 'ALREADY_SUBSCRIBED',
    });
  }
}

export class SubscriptionCheckoutError extends BusinessLogicError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, {
      code: 'SUBSCRIPTION_CHECKOUT_ERROR',
      ...context,
    });
  }
}

/**
 * Stripe rejected the proration invoice payment during a tier upgrade.
 *
 * Maps to HTTP 402 (Payment Required). Stripe's `payment_behavior:
 * 'error_if_incomplete'` reverts the price update on failure, so the
 * subscription stays on the old tier — no reconciliation needed. The
 * frontend surfaces this as a "card declined, please update your payment
 * method" toast.
 *
 * `context.prorationDate` is the Unix-seconds timestamp that
 * `SubscriptionService.changeTier` forwarded to Stripe as `proration_date`.
 * The pricing dialog uses its presence/identity to branch:
 *   - if the dialog still holds the same prorationDate, the failure is
 *     payment-side (declined card / SCA needed) — prompt for a fresh
 *     payment method, keep the preview;
 *   - if the dialog has no matching prorationDate (e.g. preview never
 *     ran, or the user reloaded), refresh `previewTierChange` before
 *     retrying.
 *
 * `context.tierIdAtCommit` is the new tier id the failed commit targeted
 * — exposed so the dialog can correlate the error to the specific row
 * the user clicked (defensive: the dialog could in principle be open on
 * a different tier by the time the error returns).
 */
export interface SubscriptionPaymentRequiredErrorContext
  extends Record<string, unknown> {
  userId: string;
  organizationId: string;
  newTierId: string;
  billingInterval: 'month' | 'year';
  stripeMessage: string;
  prorationDate?: number;
  tierIdAtCommit?: string;
}

export class SubscriptionPaymentRequiredError extends ServiceError {
  constructor(
    message: string,
    context?: SubscriptionPaymentRequiredErrorContext
  ) {
    super(message, 'PAYMENT_REQUIRED', 402, context);
  }
}

// ============================================================================
// Course Subscription Errors (Codex-2pryk WP-6 · SPEC §7)
// ============================================================================

export class CourseSubscriptionPlanNotFoundError extends NotFoundError {
  constructor(courseId: string, context?: Record<string, unknown>) {
    super('No course subscription plan configured for this course', {
      courseId,
      code: 'COURSE_SUBSCRIPTION_PLAN_NOT_FOUND',
      ...context,
    });
  }
}

export class CourseSubscriptionPlanExistsError extends ConflictError {
  constructor(courseId: string) {
    super('A subscription plan already exists for this course', {
      courseId,
      code: 'COURSE_SUBSCRIPTION_PLAN_EXISTS',
    });
  }
}

export class AlreadyCourseSubscribedError extends ConflictError {
  constructor(userId: string, courseId: string) {
    super('User already has an active subscription to this course', {
      userId,
      courseId,
      code: 'ALREADY_COURSE_SUBSCRIBED',
    });
  }
}

// ============================================================================
// Connect Account Errors
// ============================================================================

export class ConnectAccountNotFoundError extends NotFoundError {
  constructor(orgId: string) {
    super('Stripe Connect account not found for this organization', {
      orgId,
      code: 'CONNECT_ACCOUNT_NOT_FOUND',
    });
  }
}

export class ConnectAccountNotReadyError extends BusinessLogicError {
  constructor(orgId: string) {
    super('Stripe Connect account is not fully onboarded', {
      orgId,
      code: 'CONNECT_ACCOUNT_NOT_READY',
    });
  }
}

export class CreatorConnectRequiredError extends BusinessLogicError {
  constructor(creatorId: string) {
    super(
      'Creator must have an active Stripe Connect account to assign subscription-gated content',
      {
        creatorId,
        code: 'CREATOR_CONNECT_REQUIRED',
      }
    );
  }
}

/**
 * The PLATFORM's own Stripe account has not been enabled for Connect, so no
 * connected accounts can be created for ANY creator — `stripe.accounts.create`
 * throws a `StripeInvalidRequestError` ("You can only create new accounts if
 * you've signed up for Connect…").
 *
 * This is an operator/platform misconfiguration, NOT a creator error. It keeps
 * the honest 500 (the failure is genuinely server-side), but because it is a
 * typed `ServiceError` — not a raw Stripe throw — `mapErrorToResponse` surfaces
 * this specific `code` + `message` to the client verbatim instead of the
 * generic "An unexpected error occurred" masking (safe: we authored the
 * message, it leaks no Stripe internals). That distinct code is what lets the
 * studio show an actionable message and lets operators grep this failure apart
 * from ordinary 500s.
 *
 * Fix: enable Connect for the platform account at
 * https://dashboard.stripe.com/connect. Connect enablement is per-mode — test
 * and live must each be switched on separately.
 */
export class ConnectPlatformNotConfiguredError extends ServiceError {
  constructor(context?: Record<string, unknown>) {
    super(
      'Payments are not fully set up on this platform yet. Please try again later or contact support.',
      'CONNECT_PLATFORM_NOT_CONFIGURED',
      500,
      context
    );
  }
}
