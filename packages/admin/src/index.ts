/**
 * @codex/admin
 *
 * Admin Dashboard Services for Codex Platform
 *
 * This package provides services for platform owner dashboard operations:
 * - Revenue analytics and customer statistics
 * - Cross-creator content management
 * - Customer support tools (access grants)
 *
 * Core Principles:
 * 1. Organization scoping on ALL queries (platform owner sees only their org)
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
} from './services';

// ============================================================================
// Types
// ============================================================================

export type {
  AdminContentItem,
  AdminContentListOptions,
  AdminContentStatus,
  CustomerDetails,
  CustomerStats,
  CustomerWithStats,
  DailyRevenue,
  PaginatedResponse,
  PaginationMetadata,
  PaginationParams,
  PurchaseHistoryItem,
  RevenueQueryOptions,
  RevenueStats,
  ServiceConfig,
  TopContentItem,
} from './types';

// ============================================================================
// Errors
// ============================================================================

export {
  AdminServiceError,
  BusinessLogicError,
  ConflictError,
  ForbiddenError,
  InternalServiceError,
  isAdminServiceError,
  NotFoundError,
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
