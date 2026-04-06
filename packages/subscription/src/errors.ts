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
