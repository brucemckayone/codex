/**
 * @codex/purchase
 *
 * Purchase service package for Codex platform.
 *
 * Provides:
 * - PurchaseService: Stripe Checkout integration and purchase management
 * - Revenue calculator: Calculate platform/org/creator revenue splits
 * - Error classes: Domain-specific purchase errors
 * - Types: Purchase records and service types
 *
 * @example
 * import { PurchaseService, calculateRevenueSplit } from '@codex/purchase';
 * import { createDbClient } from '@codex/database';
 * import Stripe from 'stripe';
 *
 * const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
 * const purchaseService = new PurchaseService(
 *   { db: createDbClient(c.env), environment: 'production' },
 *   stripe
 * );
 *
 * // Create checkout session
 * const session = await purchaseService.createCheckoutSession({
 *   contentId: 'content-123',
 *   successUrl: 'https://example.com/success',
 *   cancelUrl: 'https://example.com/cancel',
 * }, 'customer-456');
 *
 * // Calculate revenue split
 * const split = calculateRevenueSplit(2999, 1000, 0);
 * // { platformFeeCents: 300, organizationFeeCents: 0, creatorPayoutCents: 2699 }
 */

// The clawback's wait for a won chargeback to settle: the webhook logs it at
// warn, not as an alert (Codex-2hxff.70). ecom-api reads it from here, not
// @codex/payments.
export { WinSettlingError } from '@codex/payments';
// Re-export validation schemas for convenience
export {
  type CreateCheckoutInput,
  type CreateCourseCheckoutInput,
  createCheckoutSchema,
  createCourseCheckoutSchema,
  type GetPurchaseInput,
  getPurchaseSchema,
  type PurchaseQueryInput,
  type PurchaseStatus,
  purchaseQuerySchema,
  purchaseStatusEnum,
  type SalesQueryInput,
  type SalesStatsQueryInput,
  salesQuerySchema,
  salesStatsQuerySchema,
} from '@codex/validation';
// Error classes
export {
  AlreadyPurchasedError,
  BusinessLogicError,
  CheckoutNotRecordedError,
  ConflictError,
  ContentNotPurchasableError,
  CourseAlreadyOwnedError,
  CourseNotPurchasableError,
  ForbiddenError,
  InternalServiceError,
  isPurchaseServiceError,
  LateWinRefundRefusedError,
  NotFoundError,
  PaymentProcessingError,
  PurchaseNotFoundError,
  type PurchaseServiceError,
  RevenueCalculationError,
  ValidationError,
  wrapError,
} from './errors';
// Creator agreement-share resolver (Codex-nk4km WP-4, shared with WP-6)
export {
  type AgreementRevenueType,
  findActiveCreatorAgreementShare,
} from './services/agreement-share';
// One open checkout per buyer and item (Codex-2hxff.14, .15)
export {
  CheckoutReservations,
  type CheckoutReservationTarget,
  checkoutIdempotencyKey,
  stripeErrorCode,
  toStripeTime,
} from './services/checkout-reservations';
// Which refunds count as the buyer's money back (Codex-3xnta)
export {
  countsAgainstCharge,
  STANDING_REFUND_STATUSES,
  settledElsewhere,
  settledElsewhereCentsIn,
} from './services/counted-refunds';
// Entitlement + auto-enrollment write seam (Codex-2pryk WP-6)
export {
  autoEnroll,
  type EntitlementWriteClient,
  refreshCourseSubscriptionEntitlementExpiry,
  revokeCourseSubscriptionEntitlement,
  writeContentPurchaseEntitlement,
  writeCoursePurchaseEntitlement,
  writeCourseSubscriptionEntitlement,
} from './services/entitlement-writer';
// Fee configuration service (Codex-m644n)
export {
  type AuditLogEntry,
  type AuditLogFilters,
  type CreatorOverrideUpdate,
  type FeeChangeSummary,
  type FeeConfig,
  FeeConfigService,
  type FeeConfigUpdate,
  type FeeContext,
  type FeeResolver,
  type FeeWriteResult,
  type PlatformFeeConfigUpdate,
  type UpcomingFeeChange,
  type UpcomingFeeLine,
} from './services/fee-config-service';
// Service
export {
  type BuyerPurchase,
  isDuplicatePayment,
  type PurchaseMailer,
  PurchaseService,
  type RefundAccessKept,
  type RestoredRefundAccess,
  supportRequesterOf,
} from './services/purchase-service';
// Customer resolution (Codex-49gev)
export {
  isStaleCustomerError,
  type ResolveCustomerDeps,
  type ResolveCustomerInput,
  resolveOrCreateCustomer,
  type StaleCustomerRecoveryEvent,
  type WithStaleCustomerRecoveryOptions,
  withStaleCustomerRecovery,
} from './services/resolve-customer';
// Revenue calculator
export {
  applyMinPlatformFeeFloor,
  calculateRevenueSplit,
  DEFAULT_ORG_FEE_PERCENTAGE,
  DEFAULT_PLATFORM_FEE_PERCENTAGE,
  type RevenueSplit,
} from './services/revenue-calculator';
// Customer integrity helpers (Codex-qsvxf — Q4.4 belt-and-braces)
export {
  findStripeCustomerCollisions,
  findUsersByStripeCustomerId,
  type StripeCustomerCollision,
  type UserCustomerMatch,
} from './services/stripe-customer-integrity';
// The content-purchase read other domains go through (rule A8, Codex-2hxff.55)
export { verifyPurchase } from './services/verify-purchase';
// Stripe client factory
export {
  createStripeClient,
  verifyWebhookSignature,
} from './stripe-client';
// Types
export type {
  CheckoutSessionResult,
  CheckoutSessionState,
  CheckoutSessionVerifyResult,
  CompleteCoursePurchaseMetadata,
  CompletePurchaseMetadata,
  LateWinRefundStep,
  LateWinRestore,
  LateWinRestoreOutcome,
  NewPurchaseInput,
  PaymentIntentCharge,
  Purchase,
  PurchaseItemLink,
  PurchaseListItem,
  PurchaseWithItem,
  SaleListItem,
  SalesStats,
} from './types';
