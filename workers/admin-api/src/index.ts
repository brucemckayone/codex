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
  adminCustomerIdParamsSchema,
  adminCustomerListQuerySchema,
  adminDashboardStatsQuerySchema,
  adminGrantAccessParamsSchema,
  adminRevenueQuerySchema,
  adminTopContentQuerySchema,
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
        ctx.input.query.limit
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
 * POST /api/admin/content/:id/publish
 * Publish content (admin override)
 */
app.post(
  '/api/admin/content/:id/publish',
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
        ctx.input.params.id
      );
    },
  })
);

/**
 * POST /api/admin/content/:id/unpublish
 * Unpublish content (admin override)
 */
app.post(
  '/api/admin/content/:id/unpublish',
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
        ctx.input.params.id
      );
    },
  })
);

/**
 * DELETE /api/admin/content/:id
 * Soft delete content (admin override)
 */
app.delete(
  '/api/admin/content/:id',
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
        ctx.input.params.id
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
