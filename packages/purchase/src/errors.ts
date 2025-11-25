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
    reason: 'free' | 'not_published' | 'deleted' | 'no_price',
    context?: Record<string, unknown>
  ) {
    const messages = {
      free: 'Content is free and does not require purchase',
      not_published: 'Content must be published before it can be purchased',
      deleted: 'Content is no longer available',
      no_price: 'Content does not have a price set',
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
 * Payment processing error
 * Thrown when Stripe checkout session creation or payment processing fails
 */
export class PaymentProcessingError extends InternalServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, {
      code: 'PAYMENT_PROCESSING_ERROR',
      ...context,
    });
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
