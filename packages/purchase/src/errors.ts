/**
 * Purchase Service Errors
 *
 * Domain-specific error classes for purchase and payment operations.
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
  isServiceError as isPurchaseServiceError,
  NotFoundError,
  ServiceError as PurchaseServiceError,
  ValidationError,
  wrapError,
} from '@codex/service-errors';

/**
 * Purchase-specific errors
 */

/**
 * Purchase not found error
 * Thrown when a purchase record doesn't exist or doesn't belong to the user
 */
export class PurchaseNotFoundError extends NotFoundError {
  constructor(purchaseId: string, context?: Record<string, unknown>) {
    super('Purchase not found', {
      purchaseId,
      code: 'PURCHASE_NOT_FOUND',
      ...context,
    });
  }
}

/**
 * Already purchased error
 * Thrown when user attempts to purchase content they already own
 */
export class AlreadyPurchasedError extends ConflictError {
  constructor(contentId: string, customerId: string) {
    super('Content already purchased', {
      contentId,
      customerId,
      code: 'ALREADY_PURCHASED',
    });
  }
}

/**
 * Content not purchasable error
 * Thrown when content is free, not published, or otherwise not available for purchase
 */
export class ContentNotPurchasableError extends BusinessLogicError {
  constructor(
    contentId: string,
    reason:
      | 'free'
      | 'not_published'
      | 'deleted'
      | 'no_price'
      | 'below_minimum_price'
      | 'not_sold_separately',
    context?: Record<string, unknown>
  ) {
    const messages = {
      free: 'Content is free and does not require purchase',
      not_published: 'Content must be published before it can be purchased',
      deleted: 'Content is no longer available',
      no_price: 'Content does not have a price set',
      below_minimum_price:
        'Content is priced below the £1.00 minimum, so it cannot be sold',
      // Not marked purchasable, or a purchase would not open it: course-only,
      // team-only, followers-only, or orgless with a tier (Codex-2hxff.14).
      not_sold_separately: 'This content is not sold on its own',
    };

    super(messages[reason], {
      contentId,
      reason,
      code: 'CONTENT_NOT_PURCHASABLE',
      ...context,
    });
  }
}

/**
 * Course not purchasable error (Codex-2pryk WP-6)
 * Thrown when a course has no one-off price, is unpublished, or is deleted.
 */
export class CourseNotPurchasableError extends BusinessLogicError {
  constructor(
    courseId: string,
    reason: 'no_price' | 'not_published' | 'deleted' | 'below_minimum_price',
    context?: Record<string, unknown>
  ) {
    const messages = {
      no_price: 'Course is not sold as a one-off purchase',
      not_published: 'Course must be published before it can be purchased',
      deleted: 'Course is no longer available',
      below_minimum_price:
        'Course is priced below the £1.00 minimum, so it cannot be sold',
    };

    super(messages[reason], {
      courseId,
      reason,
      code: 'COURSE_NOT_PURCHASABLE',
      ...context,
    });
  }
}

/**
 * Course already owned error (Codex-2pryk WP-6)
 * Thrown when a user starts a course checkout while already holding a live
 * entitlement over that course (purchase, subscription, tier, or grant).
 */
export class CourseAlreadyOwnedError extends ConflictError {
  constructor(courseId: string, customerId: string) {
    super('Course already owned', {
      courseId,
      customerId,
      code: 'COURSE_ALREADY_OWNED',
    });
  }
}

/**
 * Payment processing error
 * Thrown when Stripe checkout session creation or payment processing fails.
 * `options.cause` keeps the Stripe error, never sent, for a caller that
 * judges whether a retry can fix it (`isTransientError` in ecom-api).
 */
export class PaymentProcessingError extends InternalServiceError {
  constructor(
    message: string,
    context?: Record<string, unknown>,
    options?: ErrorOptions
  ) {
    super(
      message,
      {
        code: 'PAYMENT_PROCESSING_ERROR',
        ...context,
      },
      options
    );
  }
}

/**
 * A paid checkout session that nothing will record (Codex-2hxff.81). The
 * success page's completion was refused before its commit, by a failure no
 * retry changes (an unsupported currency, bad metadata, an item gone), and
 * no row of ours records the session. Support was alerted under `errorId`.
 * The page tells the buyer so and stops checking (owner decision 2026-10-27,
 * "Say we're on it").
 *
 * It is a 500 with a code of its own: the buyer did nothing wrong, and the
 * code is what the page acts on. Its context is the session id and the
 * errorId, nothing more. The refusal stays on `cause`, which is never sent.
 */
export class CheckoutNotRecordedError extends ServiceError {
  constructor(
    context: { sessionId: string; errorId: string },
    options?: ErrorOptions
  ) {
    super(
      'The purchase could not be recorded',
      'CHECKOUT_NOT_RECORDED',
      500,
      context,
      options
    );
  }
}

/**
 * Revenue calculation error
 * Thrown when revenue split calculation produces invalid results
 */
export class RevenueCalculationError extends InternalServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(`Revenue calculation error: ${message}`, {
      code: 'REVENUE_CALCULATION_ERROR',
      ...context,
    });
  }
}
