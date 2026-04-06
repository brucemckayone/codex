/**
 * @codex/subscription
 *
 * Subscription service package for Codex platform.
 *
 * Provides:
 * - TierService: Subscription tier CRUD with Stripe Product/Price sync
 * - ConnectAccountService: Stripe Express onboarding and account management (Phase 2)
 * - SubscriptionService: Checkout, webhooks, lifecycle management (Phase 2)
 * - Error classes: Domain-specific subscription errors
 */

// Re-export validation schemas for convenience
export {
  type BillingInterval,
  billingIntervalEnum,
  type CancelSubscriptionInput,
  type ChangeTierInput,
  type ConnectAccountStatus,
  type ConnectOnboardInput,
  type CreateSubscriptionCheckoutInput,
  type CreateTierInput,
  cancelSubscriptionSchema,
  changeTierSchema,
  connectAccountStatusEnum,
  connectDashboardSchema,
  connectOnboardSchema,
  connectStatusQuerySchema,
  createSubscriptionCheckoutSchema,
  createTierSchema,
  getCurrentSubscriptionQuerySchema,
  getSubscriptionStatsQuerySchema,
  type ListSubscribersQueryInput,
  listSubscribersQuerySchema,
  type ReorderTiersInput,
  reorderTiersSchema,
  type SubscriptionStatus,
  subscriptionStatusEnum,
  type UpdateTierInput,
  updateTierSchema,
} from '@codex/validation';

// Error classes
export {
  AlreadySubscribedError,
  ConnectAccountNotFoundError,
  ConnectAccountNotReadyError,
  CreatorConnectRequiredError,
  isSubscriptionServiceError,
  SubscriptionCheckoutError,
  SubscriptionNotFoundError,
  type SubscriptionServiceError,
  TierHasSubscribersError,
  TierNotFoundError,
  TierSortOrderConflictError,
  wrapError,
} from './errors';

// Services
export { ConnectAccountService } from './services/connect-account-service';
export {
  calculateRevenueSplit,
  type RevenueSplit,
} from './services/revenue-split';
export { SubscriptionService } from './services/subscription-service';
export { TierService } from './services/tier-service';
