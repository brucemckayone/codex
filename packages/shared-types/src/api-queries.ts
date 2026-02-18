/**
 * API Query Parameter Types (Documentation)
 *
 * This file provides JSDoc documentation for query parameters used across API endpoints.
 * These are NOT runtime types - the actual validation happens in @codex/validation using Zod schemas.
 *
 * Purpose: Serve as a reference for developers implementing API clients and understanding
 * what query parameters are accepted by various endpoints.
 *
 * For actual type-safe input validation, use the Zod schemas from @codex/validation:
 * - import { contentQuerySchema } from '@codex/validation';
 * - type ContentQueryInput = z.infer<typeof contentQuerySchema>;
 *
 * ============================================================================
 * ARCHITECTURE NOTE
 * ============================================================================
 *
 * Query Parameter Flow:
 * 1. Frontend: URLSearchParams (or typed input via remote functions)
 * 2. Backend Worker: Zod schema validation via procedure()
 * 3. Service Layer: Validated, typed input
 *
 * The server API client (apps/web/src/lib/server/api.ts) uses URLSearchParams
 * because it's a thin HTTP wrapper. Business logic validation happens in:
 * - Remote functions layer (apps/web/src/lib/remote/*.ts) - uses Zod schemas
 * - Backend workers - validates via procedure() with Zod schemas
 *
 * This file documents the expected query parameters for discoverability.
 */

/**
 * ============================================================================
 * ADMIN QUERY PARAMETERS
 * ============================================================================
 */

/**
 * Revenue analytics query parameters
 *
 * Endpoints: GET /api/admin/analytics/revenue
 *
 * @property startDate - ISO date string, e.g., '2025-01-01' (optional)
 * @property endDate - ISO date string, e.g., '2025-01-31' (optional)
 *
 * Validation (backend):
 * - Start date must be before or equal to end date
 * - Maximum date range: 365 days (prevents DoS via large queries)
 *
 * @example
 * ```typescript
 * const params = new URLSearchParams();
 * params.set('startDate', '2025-01-01');
 * params.set('endDate', '2025-01-31');
 * const revenue = await api.analytics.getRevenue(params);
 * ```
 *
 * @see {@link AdminRevenueQueryInput}
 * Actual type: import type { AdminRevenueQueryInput } from '@codex/validation';
 */
export interface AdminRevenueQueryInput {
  startDate?: string;
  endDate?: string;
}

/**
 * Dashboard stats query parameters
 *
 * Endpoints: GET /api/admin/dashboard/stats
 *
 * @property startDate - ISO date string (optional)
 * @property endDate - ISO date string (optional)
 * @property limit - Number of items for top content (1-100, default: 10)
 *
 * Validation (backend):
 * - Same date range constraints as AdminRevenueQueryInput
 * - Limit must be between 1-100
 */
export interface AdminDashboardStatsQueryInput {
  startDate?: string;
  endDate?: string;
  limit?: number;
}

/**
 * Top content query parameters
 *
 * Endpoints: GET /api/admin/analytics/top-content
 *
 * @property limit - Number of items to return (1-100, default: 10)
 *
 * @example
 * ```typescript
 * const params = new URLSearchParams();
 * params.set('limit', '20');
 * const topContent = await api.analytics.getTopContent(params);
 * ```
 */
export interface AdminTopContentQueryInput {
  limit?: number;
}

/**
 * Activity feed query parameters
 *
 * Endpoints: GET /api/admin/activity
 *
 * @property page - Page number (default: 1, max: 1000)
 * @property limit - Items per page (default: 20, max: 100)
 * @property type - Filter by activity type (optional)
 *
 * Activity types:
 * - 'purchase': New purchase made
 * - 'content_published': Content published
 * - 'member_joined': New member joined organization
 *
 * @example
 * ```typescript
 * const params = new URLSearchParams();
 * params.set('type', 'purchase');
 * params.set('limit', '10');
 * const activity = await api.admin.getActivity(params);
 * ```
 */
export interface AdminActivityQueryInput {
  page?: number;
  limit?: number;
  type?: 'purchase' | 'content_published' | 'member_joined';
}

/**
 * Customer list query parameters
 *
 * Endpoints: GET /api/admin/customers
 *
 * @property page - Page number (default: 1, max: 1000)
 * @property limit - Items per page (default: 20, max: 100)
 *
 * Standard pagination only. No additional filters currently supported.
 *
 * @example
 * ```typescript
 * const params = new URLSearchParams();
 * params.set('page', '2');
 * params.set('limit', '50');
 * const customers = await api.admin.getCustomers(params);
 * ```
 */
export interface AdminCustomerListQueryInput {
  page?: number;
  limit?: number;
}

/**
 * Admin content list query parameters
 *
 * Endpoints: GET /api/admin/content
 *
 * @property page - Page number (default: 1, max: 1000)
 * @property limit - Items per page (default: 20, max: 100)
 * @property status - Filter by content status (default: 'all')
 *
 * Status values:
 * - 'draft': Content not yet published
 * - 'published': Content live and available
 * - 'archived': Content no longer available
 * - 'all': Show all content (any status)
 */
export interface AdminContentListQueryInput {
  page?: number;
  limit?: number;
  status?: 'draft' | 'published' | 'archived' | 'all';
}

/**
 * ============================================================================
 * CONTENT QUERY PARAMETERS
 * ============================================================================
 */

/**
 * Content list query parameters
 *
 * Endpoints: GET /api/content
 *
 * Pagination:
 * @property page - Page number (default: 1, max: 1000)
 * @property limit - Items per page (default: 20, max: 100)
 *
 * Filters:
 * @property status - Filter by status: 'draft' | 'published' | 'archived'
 * @property contentType - Filter by type: 'video' | 'audio' | 'written'
 * @property visibility - Filter by visibility: 'public' | 'private' | 'members_only' | 'purchased_only'
 * @property category - Filter by category (string, max 100 chars)
 * @property organizationId - Filter by organization ID (UUID)
 * @property creatorId - Filter by creator ID (UUID)
 * @property search - Text search (max 255 chars)
 *
 * Sorting:
 * @property sortBy - Sort field (default: 'createdAt'):
 *   - 'createdAt': When content was created
 *   - 'updatedAt': When content was last modified
 *   - 'publishedAt': When content was published
 *   - 'title': Alphabetical by title
 *   - 'viewCount': Number of views
 *   - 'purchaseCount': Number of purchases
 * @property sortOrder - Sort order: 'asc' | 'desc' (default: 'desc')
 *
 * @example
 * ```typescript
 * const params = new URLSearchParams();
 * params.set('status', 'published');
 * params.set('contentType', 'video');
 * params.set('sortBy', 'purchaseCount');
 * params.set('sortOrder', 'desc');
 * params.set('page', '1');
 * params.set('limit', '20');
 * const content = await api.content.list(params);
 * ```
 */
export interface ContentQueryInput {
  // Pagination
  page?: number;
  limit?: number;

  // Filters
  status?: 'draft' | 'published' | 'archived';
  contentType?: 'video' | 'audio' | 'written';
  visibility?: 'public' | 'private' | 'members_only' | 'purchased_only';
  category?: string;
  organizationId?: string;
  creatorId?: string;
  search?: string;

  // Sorting
  sortBy?:
    | 'createdAt'
    | 'updatedAt'
    | 'publishedAt'
    | 'title'
    | 'viewCount'
    | 'purchaseCount';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Media list query parameters
 *
 * Endpoints: GET /api/content/media
 *
 * @property page - Page number (default: 1, max: 1000)
 * @property limit - Items per page (default: 20, max: 100)
 * @property status - Filter by status: 'uploading' | 'processing' | 'ready' | 'error'
 * @property mediaType - Filter by type: 'video' | 'audio' | 'image'
 * @property sortBy - Sort field (default: 'createdAt'): 'createdAt' | 'uploadedAt' | 'title'
 * @property sortOrder - Sort order: 'asc' | 'desc' (default: 'desc')
 */
export interface MediaQueryInput {
  page?: number;
  limit?: number;
  status?: 'uploading' | 'processing' | 'ready' | 'error';
  mediaType?: 'video' | 'audio' | 'image';
  sortBy?: 'createdAt' | 'uploadedAt' | 'title';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Organization list query parameters
 *
 * Endpoints: GET /api/organizations
 *
 * @property page - Page number (default: 1, max: 1000)
 * @property limit - Items per page (default: 20, max: 100)
 * @property search - Text search (max 255 chars)
 * @property sortBy - Sort field (default: 'createdAt'): 'createdAt' | 'name'
 * @property sortOrder - Sort order: 'asc' | 'desc' (default: 'desc')
 */
export interface OrganizationQueryInput {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: 'createdAt' | 'name';
  sortOrder?: 'asc' | 'desc';
}

/**
 * ============================================================================
 * SHARED QUERY PARAMETERS
 * ============================================================================
 */

/**
 * Base pagination parameters
 *
 * Used by all list endpoints. These are the core pagination parameters
 * that are extended by domain-specific query schemas.
 *
 * @property page - Page number (default: 1, max: 1000)
 * @property limit - Items per page (default: 20, max: 100)
 *
 * Coercion: Query string values are automatically coerced from strings to numbers.
 *
 * @example
 * ```typescript
 * // In URL: ?page=2&limit=50
 * // After coercion: { page: 2, limit: 50 }
 * ```
 */
export interface PaginationInput {
  page?: number;
  limit?: number;
}

/**
 * ============================================================================
 * OTHER QUERY PARAMETERS
 * ============================================================================
 */

/**
 * Purchase list query parameters
 *
 * Endpoints: GET /api/purchases
 *
 * @property page - Page number (default: 1, max: 1000)
 * @property limit - Items per page (default: 20, max: 100)
 * @property userId - Filter by user ID (UUID, optional)
 * @property contentId - Filter by content ID (UUID, optional)
 * @property status - Filter by purchase status (optional)
 */
export interface PurchaseQueryInput {
  page?: number;
  limit?: number;
  userId?: string;
  contentId?: string;
  status?: string;
}

/**
 * Organization members list query parameters
 *
 * Endpoints: GET /api/organizations/:orgId/members
 *
 * @property page - Page number (default: 1, max: 1000)
 * @property limit - Items per page (default: 20, max: 100)
 * @property role - Filter by member role (optional):
 *   - 'owner': Organization owner
 *   - 'admin': Can manage organization settings
 *   - 'creator': Can create content
 *   - 'subscriber': Purchased content
 *   - 'member': Regular member
 */
export interface ListMembersQueryInput {
  page?: number;
  limit?: number;
  role?: 'owner' | 'admin' | 'creator' | 'subscriber' | 'member';
}

/**
 * Public organization members query parameters
 *
 * Endpoints: GET /api/organizations/:orgId/members/public
 *
 * @property page - Page number (default: 1, max: 1000)
 * @property limit - Items per page (default: 20, max: 100)
 *
 * Note: Returns only public member information (no private details).
 */
export interface PublicMembersQueryInput {
  page?: number;
  limit?: number;
}

/**
 * Notification template list query parameters
 *
 * Endpoints: GET /api/notifications/templates
 *
 * @property page - Page number (default: 1, max: 1000)
 * @property limit - Items per page (default: 20, max: 100)
 * @property type - Filter by template type (optional)
 */
export interface ListTemplatesQuery {
  page?: number;
  limit?: number;
  type?: string;
}
