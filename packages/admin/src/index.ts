/**
 * @codex/admin
 *
 * Admin Dashboard Services for Codex Platform
 *
 * This package provides services for platform owner dashboard operations:
 * - Revenue analytics and customer statistics
 * - Cross-creator content management
 * - Customer support tools (access grants)
 * - Platform support refunds and their queue (SupportService, Codex-2hxff.28)
 *
 * Core Principles:
 * 1. Organization scoping on every org-admin query. SupportService is the one
 *    platform-wide service, scoped by the charge, behind `platform_owner`
 * 2. SQL aggregation for analytics (not application-level)
 * 3. Complimentary access via contentAccess table (not purchases)
 * 4. Extends BaseService for consistent patterns
 *
 * Usage Example:
 * ```typescript
 * import { AdminAnalyticsService } from '@codex/admin';
 * import { dbHttp } from '@codex/database';
 *
 * const service = new AdminAnalyticsService({
 *   db: dbHttp,
 *   environment: 'production',
 * });
 *
 * const stats = await service.getRevenueStats(organizationId);
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// Services
// ============================================================================

export {
  AdminAnalyticsService,
  AdminContentManagementService,
  AdminCustomerManagementService,
  type FailedRefundSettlement,
  SupportService,
  type SupportServiceConfig,
} from './services';

// ============================================================================
// Types
// ============================================================================

// Support refunds: the platform-owner refund screen and queue (Codex-2hxff.28)
export type {
  AccessNotRestoredReason,
  AccessRestorePrediction,
  ChargebackRow,
  ChargebackState,
  ChargeDetail,
  ChargeDetailSource,
  ChargeSummary,
  CheckedOwedToCreator,
  CreatorDebtItem,
  CreatorDebtPerson,
  CreatorDebtResolution,
  CreditAction,
  CreditState,
  FailedRefundItem,
  FailedRefundResolution,
  HistoryCredit,
  HistoryLine,
  HistoryOutcome,
  OwedToCreatorAction,
  OwedToCreatorItem,
  PayeeRole,
  QueueCause,
  RefundBlock,
  RefundPreview,
  RefundPreviewLine,
  RefundPreviewMethod,
  RefundRequester,
  RefundRow,
  ResolvedCreatorDebt,
  ResolvedFailedRefund,
  ResolvedOwedToCreator,
  Slice,
  StripeHeldTakeBack,
  SupportBuyer,
  SupportChargeKind,
  SupportPerson,
  SupportQueueCounts,
  SupportRefundResult,
  SupportRefundWindow,
  SystemDecision,
} from './support-types';
export type {
  ActivityFeedItem,
  ActivityFeedResponse,
  ActivityItem,
  ActivityItemType,
  AdminContentItem,
  AdminContentListOptions,
  AdminContentStatus,
  AgreementShare,
  ContentPerformanceItem,
  ContentPerformanceQueryOptions,
  CreatorRevenueQueryOptions,
  CreatorRevenueSplitItem,
  CustomerDetails,
  CustomerGrant,
  CustomerListItem,
  CustomerStats,
  CustomerWithStats,
  DailyFollowers,
  DailyRevenue,
  DailySubscribers,
  DashboardStats,
  DashboardStatsOptions,
  FollowerBlock,
  FollowerQueryOptions,
  FollowerStats,
  PaginatedListResponse,
  PaginationMetadata,
  PaginationParams,
  PurchaseHistoryItem,
  RevenueAnalyticsResponse,
  RevenueBlock,
  RevenueByDay,
  RevenueKind,
  RevenueQueryOptions,
  RevenueStats,
  ServiceConfig,
  SubscriberBlock,
  SubscriberQueryOptions,
  SubscriberStats,
  TopContentAnalyticsResponse,
  TopContentItem,
  TopContentQueryOptions,
} from './types';

// ============================================================================
// Errors
// ============================================================================

export {
  AdminServiceError,
  AlreadySettledError,
  BusinessLogicError,
  ChargeChangedError,
  ChargeHasChargebackError,
  ConflictError,
  ContentNotGrantableError,
  CreatorPayoutsRequiredError,
  ForbiddenError,
  InternalServiceError,
  isAdminServiceError,
  MediaDeletedError,
  NotFoundError,
  NothingLeftToRefundError,
  RefundAmountTooLargeError,
  RefundInFlightError,
  RefundKeySpentError,
  RefundWindowClosedError,
  StripeRefusedRefundError,
  TierRequiredToPublishError,
  ValidationError,
  wrapError,
} from './errors';

// ============================================================================
// Re-export Error Mapper (for convenience)
// ============================================================================

export {
  type ErrorResponse,
  isKnownError,
  type MappedError,
  mapErrorToResponse,
} from '@codex/service-errors';
