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
  type CreateCourseSubscriptionCheckoutInput,
  type CreateSubscriptionCheckoutInput,
  type CreateTierInput,
  cancelSubscriptionSchema,
  changeTierSchema,
  connectAccountStatusEnum,
  connectStatusQuerySchema,
  createCourseSubscriptionCheckoutSchema,
  createSubscriptionCheckoutSchema,
  createTierSchema,
  getCurrentSubscriptionQuerySchema,
  getSubscriptionStatsQuerySchema,
  type ListPayoutsQueryInput,
  type ListSubscribersQueryInput,
  listPayoutsQuerySchema,
  listSubscribersQuerySchema,
  type PayoutSourceFilter,
  type PayoutStatusFilter,
  payoutSourceFilterEnum,
  payoutStatusFilterEnum,
  type ReorderTiersInput,
  reorderTiersSchema,
  type SetCourseTierAccessInput,
  type SubscriptionStatus,
  setCourseTierAccessSchema,
  subscriptionStatusEnum,
  type UpdateTierInput,
  type UpsertCourseSubscriptionPlanInput,
  updateTierSchema,
  upsertCourseSubscriptionPlanSchema,
} from '@codex/validation';
// Error classes
export {
  AlreadyCourseSubscribedError,
  AlreadySubscribedError,
  ConnectAccountNotFoundError,
  ConnectAccountNotReadyError,
  CourseSubscriptionPlanExistsError,
  CourseSubscriptionPlanNotFoundError,
  CreatorConnectRequiredError,
  isSubscriptionServiceError,
  SubscriptionCheckoutError,
  SubscriptionNotFoundError,
  type SubscriptionServiceError,
  TierChangePreviewExpiredError,
  TierHasSubscribersError,
  TierNotFoundError,
  TierSortOrderConflictError,
  wrapError,
} from './errors';

// Services
export { ConnectAccountService } from './services/connect-account-service';
export {
  COURSE_SUBSCRIPTION_METADATA_TYPE,
  type CourseSubscriptionCheckoutVerifyResult,
  CourseSubscriptionService,
  type CourseSubscriptionWebhookResult,
} from './services/course-subscription-service';
export {
  applyDuePendingPriceChange,
  PENDING_PRICE_FROM_KEY,
  PENDING_PRICE_ID_KEY,
  PRICE_NOTICE_TIMEOUT_MS,
} from './services/pending-price-change';
export {
  calculateRevenueSplit,
  type RevenueSplit,
} from './services/revenue-split';
// A second subscription the user already had (Codex-2hxff.15)
export {
  cancelAndRefundDuplicate,
  isDuplicateSubscription,
} from './services/subscription-duplicates';
export {
  type InvalidateForUserArgs,
  type InvalidateForUserOptions,
  type InvalidationLogger,
  type InvalidationReason,
  invalidateForUser,
  type WaitUntilFn,
} from './services/subscription-invalidation';
// Whether a payment paid for the current billing period: support's refund
// preview (Codex-2hxff.28)
export { isCurrentPeriodPayment } from './services/subscription-refund';
export type {
  CreatorEarningsSummary,
  CreatorPayoutBreakdown,
  CreatorPayoutRow,
  PayoutDisplayStatus,
  PayoutSummary,
  PayoutWithCreator,
  PropagateTierPriceOptions,
  PropagateTierPriceResult,
  SubscriberListItem,
  SubscriberSubscription,
  SubscriptionCheckoutVerifyResult,
  TierChangePreview,
  WebhookEmailPayload,
  WebhookHandlerResult,
} from './services/subscription-service';
export {
  type PayoutReleasedMailer,
  SUBSCRIBER_HIDDEN_COLUMNS,
  SubscriptionService,
} from './services/subscription-service';
export {
  type TierPricePropagator,
  TierService,
} from './services/tier-service';
