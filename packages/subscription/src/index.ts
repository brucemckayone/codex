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
  type CreateCourseSubscriptionCheckoutInput,
  type CreateSubscriptionCheckoutInput,
  type CreateTierInput,
  cancelSubscriptionSchema,
  changeTierSchema,
  connectAccountStatusEnum,
  connectDashboardSchema,
  connectOnboardSchema,
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
  TierHasSubscribersError,
  TierNotFoundError,
  TierSortOrderConflictError,
  wrapError,
} from './errors';

// Services
export { ConnectAccountService } from './services/connect-account-service';
export {
  COURSE_SUBSCRIPTION_METADATA_TYPE,
  CourseSubscriptionService,
  type CourseSubscriptionWebhookResult,
} from './services/course-subscription-service';
export {
  calculateRevenueSplit,
  type RevenueSplit,
} from './services/revenue-split';
export {
  type InvalidateForUserArgs,
  type InvalidateForUserOptions,
  type InvalidationLogger,
  type InvalidationReason,
  invalidateForUser,
  type WaitUntilFn,
} from './services/subscription-invalidation';
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
  TierChangePreview,
  WebhookEmailPayload,
  WebhookHandlerResult,
} from './services/subscription-service';
export {
  type PayoutReleasedMailer,
  SubscriptionService,
} from './services/subscription-service';
export {
  type TierPricePropagator,
  TierService,
} from './services/tier-service';
