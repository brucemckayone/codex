/**
 * Admin API Worker
 *
 * Provides admin dashboard functionality for platform owners including:
 * - Revenue analytics
 * - Content management across creators
 * - Customer management and support tools
 *
 * Security Features:
 * - Request tracking (UUID request IDs, IP tracking, user agent)
 * - Security headers (CSP, XFO, etc.)
 * - Rate limiting for all endpoints
 * - Session-based authentication with platform owner role verification
 *
 * All endpoints require:
 * 1. Valid session (authenticated user)
 * 2. Organization membership with 'owner' or 'admin' role
 *
 * Uses the procedure() pattern for unified policy, validation, and error handling.
 */

import type { CONTENT_STATUS } from '@codex/constants';
import { RATE_LIMIT_PRESETS, rateLimit } from '@codex/security';
import {
  adminActivityQuerySchema,
  adminContentIdParamsSchema,
  adminContentListQuerySchema,
  adminContentPerformanceQuerySchema,
  adminCustomerIdParamsSchema,
  adminCustomerListQuerySchema,
  adminDashboardStatsQuerySchema,
  adminFollowersQuerySchema,
  adminGrantAccessParamsSchema,
  adminRevenueByCreatorQuerySchema,
  adminRevenueQuerySchema,
  adminSubscribersQuerySchema,
  adminTopContentQuerySchema,
  feeAuditLogQuerySchema,
  orgCreatorParamsSchema,
  orgIdParamsSchema,
  updateOrgFeesSchema,
  updatePlatformFeesSchema,
  upsertCreatorOverrideSchema,
} from '@codex/validation';
import {
  createKvCheck,
  createWorker,
  PaginatedResult,
  procedure,
  standardDatabaseCheck,
} from '@codex/worker-utils';
import type { AdminApiEnv } from './types';

// ============================================================================
// Application Setup
// ============================================================================

/**
 * Create worker with standard middleware
 *
 * Configuration:
 * - enableGlobalAuth: false (admin routes use org management policy)
 * - healthCheck: database and KV checks
 */
const app = createWorker<AdminApiEnv>({
  serviceName: 'admin-api',
  version: '1.0.0',
  enableGlobalAuth: false,
  healthCheck: {
    checkDatabase: standardDatabaseCheck,
    checkKV: createKvCheck(['RATE_LIMIT_KV', 'AUTH_SESSION_KV']),
  },
});

// ============================================================================
// Custom Middleware
// ============================================================================

// Rate limiting for all API endpoints
app.use('/api/*', (c, next) => {
  return rateLimit({
    kv: c.env.RATE_LIMIT_KV,
    ...RATE_LIMIT_PRESETS.api, // 100 req/min
  })(c, next);
});

// ============================================================================
// Analytics Endpoints
// ============================================================================

/**
 * GET /api/admin/analytics/revenue
 * Get revenue statistics for the platform owner's organization
 */
app.get(
  '/api/admin/analytics/revenue',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: adminRevenueQuerySchema },
    handler: async (ctx) => {
      return await ctx.services.adminAnalytics.getRevenueStats(
        ctx.organizationId,
        ctx.input.query
      );
    },
  })
);

/**
 * GET /api/admin/analytics/customers
 * Get customer statistics for the platform owner's organization
 */
app.get(
  '/api/admin/analytics/customers',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    handler: async (ctx) => {
      return await ctx.services.adminAnalytics.getCustomerStats(
        ctx.organizationId
      );
    },
  })
);

/**
 * GET /api/admin/analytics/top-content
 * Get top content by revenue for the platform owner's organization
 */
app.get(
  '/api/admin/analytics/top-content',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: adminTopContentQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.adminAnalytics.getTopContent(
        ctx.organizationId,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /api/admin/analytics/subscribers
 * Get subscriber statistics (active/new/churned + daily breakdown)
 * for the platform owner's organization. Supports optional main date range
 * and optional compare-period for period-over-period KPIs.
 */
app.get(
  '/api/admin/analytics/subscribers',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: adminSubscribersQuerySchema },
    handler: async (ctx) => {
      return await ctx.services.adminAnalytics.getSubscriberStats(
        ctx.organizationId,
        ctx.input.query
      );
    },
  })
);

/**
 * GET /api/admin/analytics/followers
 * Get follower statistics (total/new + daily breakdown) for the platform
 * owner's organization. Supports optional main date range and optional
 * compare-period for period-over-period KPIs.
 */
app.get(
  '/api/admin/analytics/followers',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: adminFollowersQuerySchema },
    handler: async (ctx) => {
      return await ctx.services.adminAnalytics.getFollowerStats(
        ctx.organizationId,
        ctx.input.query
      );
    },
  })
);

/**
 * GET /api/admin/analytics/revenue-by-creator
 * Per-creator revenue split visibility (Codex-mtv05).
 *
 * Returns one row per ACTIVE creator-organization agreement for the
 * org-owner's organization, annotated with totalRevenueCents (purchases
 * only in Phase 1), CURRENT splitPercent (display %, not basis points),
 * lastPayoutAt, and pendingPayoutCents.
 *
 * Section is hidden in the UI for single-creator orgs; this endpoint returns
 * the same shape regardless and the client renders conditionally on
 * `items.length > 1`.
 */
app.get(
  '/api/admin/analytics/revenue-by-creator',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: adminRevenueByCreatorQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.adminAnalytics.getRevenueByCreator(
        ctx.organizationId,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /api/admin/analytics/content-performance
 * Get content performance ranked by watch time, with optional main date
 * range and optional compare-period for per-row trend deltas.
 */
app.get(
  '/api/admin/analytics/content-performance',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: adminContentPerformanceQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.adminAnalytics.getContentPerformance(
        ctx.organizationId,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /api/admin/analytics/dashboard-stats
 * Get combined dashboard statistics for platform owner's organization
 */
app.get(
  '/api/admin/analytics/dashboard-stats',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: adminDashboardStatsQuerySchema },
    handler: async (ctx) => {
      return await ctx.services.adminAnalytics.getDashboardStats(
        ctx.organizationId,
        ctx.input.query
      );
    },
  })
);

/**
 * GET /api/admin/activity
 * Get recent activity feed for the platform owner's organization
 * Returns purchases, content published, and member joined events
 */
app.get(
  '/api/admin/activity',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: adminActivityQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.adminAnalytics.getRecentActivity(
        ctx.organizationId,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

// ============================================================================
// Content Management Endpoints
// ============================================================================

/**
 * GET /api/admin/content
 * List all content in the platform owner's organization
 */
app.get(
  '/api/admin/content',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: adminContentListQuerySchema },
    handler: async (ctx) => {
      // Map 'all' status to undefined for service layer
      const statusFilter =
        ctx.input.query.status === 'all' ? undefined : ctx.input.query.status;

      const result = await ctx.services.adminContent.listAllContent(
        ctx.organizationId,
        {
          page: ctx.input.query.page,
          limit: ctx.input.query.limit,
          status: statusFilter as
            | typeof CONTENT_STATUS.DRAFT
            | typeof CONTENT_STATUS.PUBLISHED
            | typeof CONTENT_STATUS.ARCHIVED
            | undefined,
        }
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * POST /api/admin/content/:contentId/publish
 * Publish content (admin override).
 * Param is `:contentId` (not `:id`) so the procedure org resolver does not
 * treat a content UUID as an org UUID. Org supplied via ?organizationId=.
 */
app.post(
  '/api/admin/content/:contentId/publish',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { params: adminContentIdParamsSchema },
    handler: async (ctx) => {
      return await ctx.services.adminContent.publishContent(
        ctx.organizationId,
        ctx.input.params.contentId
      );
    },
  })
);

/**
 * POST /api/admin/content/:contentId/unpublish
 * Unpublish content (admin override)
 */
app.post(
  '/api/admin/content/:contentId/unpublish',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { params: adminContentIdParamsSchema },
    handler: async (ctx) => {
      return await ctx.services.adminContent.unpublishContent(
        ctx.organizationId,
        ctx.input.params.contentId
      );
    },
  })
);

/**
 * DELETE /api/admin/content/:contentId
 * Soft delete content (admin override)
 */
app.delete(
  '/api/admin/content/:contentId',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { params: adminContentIdParamsSchema },
    successStatus: 204,
    handler: async (ctx) => {
      await ctx.services.adminContent.deleteContent(
        ctx.organizationId,
        ctx.input.params.contentId
      );
      return null;
    },
  })
);

// ============================================================================
// Customer Management Endpoints
// ============================================================================

/**
 * GET /api/admin/customers
 * List customers who have purchased from the organization
 */
app.get(
  '/api/admin/customers',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { query: adminCustomerListQuerySchema },
    handler: async (ctx) => {
      const result = await ctx.services.adminCustomer.listCustomers(
        ctx.organizationId,
        ctx.input.query
      );
      return new PaginatedResult(result.items, result.pagination);
    },
  })
);

/**
 * GET /api/admin/customers/:id
 * Get customer details with purchase history
 */
app.get(
  '/api/admin/customers/:id',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { params: adminCustomerIdParamsSchema },
    handler: async (ctx) => {
      return await ctx.services.adminCustomer.getCustomerDetails(
        ctx.organizationId,
        ctx.input.params.id
      );
    },
  })
);

/**
 * POST /api/admin/customers/:customerId/grant-access/:contentId
 * Grant complimentary content access (for refunds/support)
 */
app.post(
  '/api/admin/customers/:customerId/grant-access/:contentId',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    input: { params: adminGrantAccessParamsSchema },
    handler: async (ctx) => {
      await ctx.services.adminCustomer.grantContentAccess(
        ctx.organizationId,
        ctx.input.params.customerId,
        ctx.input.params.contentId
      );
      return { success: true };
    },
  })
);

// ============================================================================
// Fee Configuration Endpoints (Codex-m644n) — INTERNAL
//
// 3-tier DB-configurable fee model: platform → org → creator-override.
// All routes are gated by `policy: { auth: 'platform_owner' }` — they are NOT
// safe for org-admin consumption (the platform's revenue model lives here).
//
// IMPORTANT: These endpoints are NOT public. They are not described in any
// public OpenAPI document and there is no SvelteKit/web UI that consumes
// them today. The future local desktop admin app (epic Codex-xyb7v) is the
// planned consumer. Until that ships, mutations happen via direct DB edits
// or by ad-hoc admin tooling running on a trusted local machine.
//
// All write endpoints bump the row's version counter and write one row per
// changed column to `fee_config_audit_log`, then fire-and-forget invalidate
// the VersionedCache key for that entity (NO TTL — cache is effectively
// immutable until the next write).
// ============================================================================

app.get(
  '/api/admin/fees/platform',
  procedure({
    policy: { auth: 'platform_owner' },
    handler: async (ctx) => {
      const row = await ctx.services.feeConfig.getPlatformRow();
      return { config: row };
    },
  })
);

app.patch(
  '/api/admin/fees/platform',
  procedure({
    policy: { auth: 'platform_owner' },
    input: { body: updatePlatformFeesSchema },
    handler: async (ctx) => {
      await ctx.services.feeConfig.updatePlatformFees(
        ctx.input.body,
        ctx.user.id
      );
      const row = await ctx.services.feeConfig.getPlatformRow();
      return { config: row };
    },
  })
);

app.get(
  '/api/admin/fees/org/:orgId',
  procedure({
    policy: { auth: 'platform_owner' },
    input: { params: orgIdParamsSchema },
    handler: async (ctx) => {
      const row = await ctx.services.feeConfig.getOrgRow(
        ctx.input.params.orgId
      );
      return { config: row };
    },
  })
);

app.patch(
  '/api/admin/fees/org/:orgId',
  procedure({
    policy: { auth: 'platform_owner' },
    input: { params: orgIdParamsSchema, body: updateOrgFeesSchema },
    handler: async (ctx) => {
      await ctx.services.feeConfig.updateOrgFees(
        ctx.input.params.orgId,
        ctx.input.body,
        ctx.user.id
      );
      const row = await ctx.services.feeConfig.getOrgRow(
        ctx.input.params.orgId
      );
      return { config: row };
    },
  })
);

app.delete(
  '/api/admin/fees/org/:orgId',
  procedure({
    policy: { auth: 'platform_owner' },
    input: { params: orgIdParamsSchema },
    successStatus: 204,
    handler: async (ctx) => {
      await ctx.services.feeConfig.deleteOrgFees(
        ctx.input.params.orgId,
        ctx.user.id
      );
      return null;
    },
  })
);

app.get(
  '/api/admin/fees/org/:orgId/creators',
  procedure({
    policy: { auth: 'platform_owner' },
    input: { params: orgIdParamsSchema },
    handler: async (ctx) => {
      const rows = await ctx.services.feeConfig.listCreatorOverrides(
        ctx.input.params.orgId
      );
      return { overrides: rows };
    },
  })
);

app.get(
  '/api/admin/fees/org/:orgId/creator/:creatorId',
  procedure({
    policy: { auth: 'platform_owner' },
    input: { params: orgCreatorParamsSchema },
    handler: async (ctx) => {
      const row = await ctx.services.feeConfig.getCreatorOverrideRow(
        ctx.input.params.orgId,
        ctx.input.params.creatorId
      );
      return { override: row };
    },
  })
);

app.put(
  '/api/admin/fees/org/:orgId/creator/:creatorId',
  procedure({
    policy: { auth: 'platform_owner' },
    input: {
      params: orgCreatorParamsSchema,
      body: upsertCreatorOverrideSchema,
    },
    handler: async (ctx) => {
      await ctx.services.feeConfig.upsertCreatorOverride(
        ctx.input.params.orgId,
        ctx.input.params.creatorId,
        ctx.input.body,
        ctx.user.id
      );
      const row = await ctx.services.feeConfig.getCreatorOverrideRow(
        ctx.input.params.orgId,
        ctx.input.params.creatorId
      );
      return { override: row };
    },
  })
);

app.delete(
  '/api/admin/fees/org/:orgId/creator/:creatorId',
  procedure({
    policy: { auth: 'platform_owner' },
    input: { params: orgCreatorParamsSchema },
    successStatus: 204,
    handler: async (ctx) => {
      await ctx.services.feeConfig.deleteCreatorOverride(
        ctx.input.params.orgId,
        ctx.input.params.creatorId,
        ctx.user.id
      );
      return null;
    },
  })
);

app.get(
  '/api/admin/fees/audit-log',
  procedure({
    policy: { auth: 'platform_owner' },
    input: { query: feeAuditLogQuerySchema },
    handler: async (ctx) => {
      const entries = await ctx.services.feeConfig.getAuditLog(ctx.input.query);
      return { entries };
    },
  })
);

// ============================================================================
// Status Endpoint (for debugging)
// ============================================================================

app.get(
  '/api/admin/status',
  procedure({
    policy: {
      auth: 'required',
      requireOrgMembership: true,
      requireOrgManagement: true,
    },
    handler: async (ctx) => {
      return {
        status: 'ok',
        message: 'Admin API is operational',
        user: {
          id: ctx.user.id,
          role: ctx.user.role,
        },
      };
    },
  })
);

export default app;
