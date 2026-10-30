/**
 * Subscription Service Errors
 *
 * Domain-specific error classes for subscription, tier, and Connect operations.
 * Extends base errors from @codex/service-errors.
 */

import {
  BusinessLogicError,
  ConflictError,
  InternalServiceError,
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

/**
 * Deleting a tier that some films or courses are ONLY in, without saying what
 * happens to them (Codex-2hxff.91). The studio dialog asks "Move them to other
 * tiers" or "Keep them subscribers-only"; an older client that sends neither
 * fails safe here instead of leaving them in no tier by accident. Counts only:
 * the context is sent to the client.
 */
export class TierHasOnlyItemsError extends ConflictError {
  constructor(
    tierId: string,
    counts: { filmCount: number; courseCount: number }
  ) {
    super('Choose what happens to the items only in this plan', {
      tierId,
      filmCount: counts.filmCount,
      courseCount: counts.courseCount,
      code: 'TIER_HAS_ONLY_ITEMS',
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
 *
 * The context is sent to the client verbatim as `details`, so it never carries
 * Stripe's raw message (Codex-2hxff.23, SEC-02). The thrower logs that through
 * obs with an errorId instead.
 */
export interface SubscriptionPaymentRequiredErrorContext
  extends Record<string, unknown> {
  userId: string;
  organizationId: string;
  newTierId: string;
  billingInterval: 'month' | 'year';
  /** Matches the log line that holds Stripe's own message. */
  errorId?: string;
  /** Banned: the index signature would otherwise accept it again. */
  stripeMessage?: never;
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

/**
 * A tier change confirmed with a preview's `prorationDate` the server no
 * longer honours (Codex-2hxff.15, SUB-12; owner decision 2026-10-22): older
 * than `TIER_CHANGE_PREVIEW_TTL_MS`, in the future, or before the current
 * billing period. Nothing was changed at Stripe.
 *
 * Maps to HTTP 409 with its own top-level code, as
 * `SubscriptionPaymentRequiredError` does, so the pricing dialog can tell it
 * apart: it shows "Prices changed, review again" and fetches a fresh preview
 * for the subscriber to confirm.
 */
export class TierChangePreviewExpiredError extends ServiceError {
  constructor(context: { prorationDate: number; newTierId: string }) {
    super(
      'Prices changed. Review the change again.',
      'TIER_CHANGE_PREVIEW_EXPIRED',
      409,
      context
    );
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

/**
 * A live course's creator can't be paid yet, so it can't take a new way to
 * pay: a course plan, or one put back on sale (Codex-2hxff.14, owner decision
 * "Yes, same rule"). Same code and message as `@codex/content`'s
 * `CreatorPayoutsRequiredError`, so the Studio shows one message for all.
 *
 * Like it, the context never names the creator: it reaches the client
 * verbatim, and the caller is an org admin while the creator who can't be
 * paid is often another member (review round 2, as L5 did for the others).
 */
export class CreatorConnectRequiredError extends BusinessLogicError {
  constructor() {
    super(
      'Set up payouts before publishing paid or subscriber content. Complete Stripe Connect onboarding to receive payments.',
      { code: 'CREATOR_CONNECT_REQUIRED' }
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

// ============================================================================
// Price-change fan-out errors
// ============================================================================

/**
 * The Stripe call that threw on one subscriber's path through
 * `schedulePriceChange` before any notice went out: the read, or one of the
 * same-amount path's two writes (the item swap, or clearing the pending
 * marker).
 */
export type PriceChangeStage =
  | 'read'
  | 'same_amount_swap'
  | 'same_amount_clear';

/**
 * Stripe threw at `stage`, so the fan-out's alert can name the step that
 * failed: a failed write is not a failed read (review A round 2, correctness
 * #2). `cause` is Stripe's own error, and the refused-or-unknown judgement is
 * made on it. `currentPending` is the earlier change the subscription carried,
 * which a failed same-amount write may leave to land.
 *
 * It never reaches a client (the fan-out runs after the response). Its
 * context holds the stage only: no Stripe message and no date.
 */
export class PriceChangeStageError extends InternalServiceError {
  readonly stage: PriceChangeStage;
  readonly currentPending: { priceId: string; from: Date } | null;

  constructor(
    stage: PriceChangeStage,
    currentPending: { priceId: string; from: Date } | null,
    cause: unknown
  ) {
    super(`Price change: Stripe failed at ${stage}`, { stage }, { cause });
    this.stage = stage;
    this.currentPending = currentPending;
  }
}
