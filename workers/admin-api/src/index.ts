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
 * - Session-based authentication via requireAuth
 * - Platform owner role verification via requirePlatformOwner
 *
 * All endpoints require:
 * 1. Valid session (authenticated user)
 * 2. User role = 'platform_owner'
 */

import {
  AdminAnalyticsService,
  AdminContentManagementService,
  AdminCustomerManagementService,
  mapErrorToResponse,
} from '@codex/admin';
import { createPerRequestDbClient, dbHttp, schema } from '@codex/database';
import {
  RATE_LIMIT_PRESETS,
  rateLimit,
  requirePlatformOwner,
} from '@codex/security';
import {
  adminContentIdParamsSchema,
  adminContentListQuerySchema,
  adminCustomerIdParamsSchema,
  adminCustomerListQuerySchema,
  adminGrantAccessParamsSchema,
  adminRevenueQuerySchema,
  adminTopContentQuerySchema,
} from '@codex/validation';
import {
  createHealthCheckHandler,
  createKvCheck,
  createNotFoundHandler,
  createObservabilityErrorHandler,
  createStandardMiddlewareChain,
  standardDatabaseCheck,
} from '@codex/worker-utils';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AdminApiEnv } from './types';

// ============================================================================
// Application Setup
// ============================================================================

const app = new Hono<AdminApiEnv>();

// ============================================================================
// Global Middleware
// ============================================================================

/**
 * Global middleware chain
 * Applies request tracking, logging, security headers, and observability to all routes
 */
const globalMiddleware = createStandardMiddlewareChain({
  serviceName: 'admin-api',
  enableObservability: true,
});

for (const middleware of globalMiddleware) {
  app.use('*', middleware);
}

// Rate limiting for all API endpoints
app.use('/api/*', (c, next) => {
  return rateLimit({
    kv: c.env.RATE_LIMIT_KV,
    ...RATE_LIMIT_PRESETS.api, // 100 req/min
  })(c, next);
});

// ============================================================================
// Error Handling
// ============================================================================

app.onError(createObservabilityErrorHandler('admin-api'));
app.notFound(createNotFoundHandler());

// ============================================================================
// Health Check Endpoints
// ============================================================================

app.get('/', (c) => {
  return c.json({ status: 'ok', service: 'admin-api' });
});

app.get(
  '/health',
  createHealthCheckHandler('admin-api', '1.0.0', {
    checkDatabase: standardDatabaseCheck,
    checkKV: createKvCheck(['RATE_LIMIT_KV']),
  })
);

// ============================================================================
// Admin API Routes (Protected)
// ============================================================================

/**
 * All admin routes require:
 * 1. Authentication (valid session)
 * 2. Platform owner role
 */
app.use(
  '/api/admin/*',
  requirePlatformOwner({
    cookieName: 'better-auth.session_token',
  })
);

// ============================================================================
// Helper: Get Platform Owner's Organization
// ============================================================================

/**
 * Get the organization ID for the authenticated platform owner.
 * Platform owners are identified by their membership with 'owner' role.
 *
 * @throws Error if user has no organization ownership
 */
async function getOwnerOrganizationId(userId: string): Promise<string> {
  const membership = await dbHttp.query.organizationMemberships.findFirst({
    where: eq(schema.organizationMemberships.userId, userId),
    columns: {
      organizationId: true,
      role: true,
    },
  });

  if (!membership) {
    throw new Error('Platform owner has no organization');
  }

  return membership.organizationId;
}

/**
 * Get user from context with type assertion.
 * requirePlatformOwner() middleware guarantees user exists.
 */
function getUserFromContext(c: {
  get: (key: 'user') => { id: string; role: string } | undefined;
}): {
  id: string;
  role: string;
} {
  const user = c.get('user');
  if (!user) {
    // This should never happen - requirePlatformOwner() ensures user exists
    throw new Error('User not found in context');
  }
  return user;
}

// ============================================================================
// Analytics Endpoints
// ============================================================================

/**
 * GET /api/admin/analytics/revenue
 * Get revenue statistics for the platform owner's organization
 */
app.get('/api/admin/analytics/revenue', async (c) => {
  try {
    const user = getUserFromContext(c);
    const organizationId = await getOwnerOrganizationId(user.id);

    // Parse and validate query params
    const query = c.req.query();
    const validated = adminRevenueQuerySchema.parse({
      startDate: query.startDate,
      endDate: query.endDate,
    });

    const service = new AdminAnalyticsService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    const stats = await service.getRevenueStats(organizationId, validated);
    return c.json({ data: stats });
  } catch (error) {
    const mapped = mapErrorToResponse(error);
    return c.json(mapped.response, mapped.statusCode);
  }
});

/**
 * GET /api/admin/analytics/customers
 * Get customer statistics for the platform owner's organization
 */
app.get('/api/admin/analytics/customers', async (c) => {
  try {
    const user = getUserFromContext(c);
    const organizationId = await getOwnerOrganizationId(user.id);

    const service = new AdminAnalyticsService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    const stats = await service.getCustomerStats(organizationId);
    return c.json({ data: stats });
  } catch (error) {
    const mapped = mapErrorToResponse(error);
    return c.json(mapped.response, mapped.statusCode);
  }
});

/**
 * GET /api/admin/analytics/top-content
 * Get top content by revenue for the platform owner's organization
 */
app.get('/api/admin/analytics/top-content', async (c) => {
  try {
    const user = getUserFromContext(c);
    const organizationId = await getOwnerOrganizationId(user.id);

    // Parse and validate query params
    const query = c.req.query();
    const validated = adminTopContentQuerySchema.parse({
      limit: query.limit,
    });

    const service = new AdminAnalyticsService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    const topContent = await service.getTopContent(
      organizationId,
      validated.limit
    );
    return c.json({ data: topContent });
  } catch (error) {
    const mapped = mapErrorToResponse(error);
    return c.json(mapped.response, mapped.statusCode);
  }
});

// ============================================================================
// Content Management Endpoints
// ============================================================================

/**
 * GET /api/admin/content
 * List all content in the platform owner's organization
 */
app.get('/api/admin/content', async (c) => {
  try {
    const user = getUserFromContext(c);
    const organizationId = await getOwnerOrganizationId(user.id);

    // Parse and validate query params
    const query = c.req.query();
    const validated = adminContentListQuerySchema.parse({
      page: query.page,
      limit: query.limit,
      status: query.status,
    });

    const service = new AdminContentManagementService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    // Map 'all' status to undefined for service layer
    const statusFilter =
      validated.status === 'all' ? undefined : validated.status;

    const result = await service.listAllContent(organizationId, {
      page: validated.page,
      limit: validated.limit,
      status: statusFilter as 'draft' | 'published' | 'archived' | undefined,
    });

    return c.json(result);
  } catch (error) {
    const mapped = mapErrorToResponse(error);
    return c.json(mapped.response, mapped.statusCode);
  }
});

/**
 * POST /api/admin/content/:id/publish
 * Publish content (admin override)
 */
app.post('/api/admin/content/:id/publish', async (c) => {
  const { db, cleanup } = createPerRequestDbClient(c.env);

  try {
    const user = getUserFromContext(c);
    const organizationId = await getOwnerOrganizationId(user.id);

    // Validate path params
    const params = adminContentIdParamsSchema.parse({ id: c.req.param('id') });

    const service = new AdminContentManagementService({
      db,
      environment: c.env.ENVIRONMENT || 'development',
    });

    const content = await service.publishContent(organizationId, params.id);
    return c.json({ data: content });
  } catch (error) {
    const mapped = mapErrorToResponse(error);
    return c.json(mapped.response, mapped.statusCode);
  } finally {
    await cleanup();
  }
});

/**
 * POST /api/admin/content/:id/unpublish
 * Unpublish content (admin override)
 */
app.post('/api/admin/content/:id/unpublish', async (c) => {
  const { db, cleanup } = createPerRequestDbClient(c.env);

  try {
    const user = getUserFromContext(c);
    const organizationId = await getOwnerOrganizationId(user.id);

    // Validate path params
    const params = adminContentIdParamsSchema.parse({ id: c.req.param('id') });

    const service = new AdminContentManagementService({
      db,
      environment: c.env.ENVIRONMENT || 'development',
    });

    const content = await service.unpublishContent(organizationId, params.id);
    return c.json({ data: content });
  } catch (error) {
    const mapped = mapErrorToResponse(error);
    return c.json(mapped.response, mapped.statusCode);
  } finally {
    await cleanup();
  }
});

/**
 * DELETE /api/admin/content/:id
 * Soft delete content (admin override)
 */
app.delete('/api/admin/content/:id', async (c) => {
  const { db, cleanup } = createPerRequestDbClient(c.env);

  try {
    const user = getUserFromContext(c);
    const organizationId = await getOwnerOrganizationId(user.id);

    // Validate path params
    const params = adminContentIdParamsSchema.parse({ id: c.req.param('id') });

    const service = new AdminContentManagementService({
      db,
      environment: c.env.ENVIRONMENT || 'development',
    });

    await service.deleteContent(organizationId, params.id);
    return c.body(null, 204);
  } catch (error) {
    const mapped = mapErrorToResponse(error);
    return c.json(mapped.response, mapped.statusCode);
  } finally {
    await cleanup();
  }
});

// ============================================================================
// Customer Management Endpoints
// ============================================================================

/**
 * GET /api/admin/customers
 * List customers who have purchased from the organization
 */
app.get('/api/admin/customers', async (c) => {
  try {
    const user = getUserFromContext(c);
    const organizationId = await getOwnerOrganizationId(user.id);

    // Parse and validate query params
    const query = c.req.query();
    const validated = adminCustomerListQuerySchema.parse({
      page: query.page,
      limit: query.limit,
    });

    const service = new AdminCustomerManagementService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    const result = await service.listCustomers(organizationId, validated);
    return c.json(result);
  } catch (error) {
    const mapped = mapErrorToResponse(error);
    return c.json(mapped.response, mapped.statusCode);
  }
});

/**
 * GET /api/admin/customers/:id
 * Get customer details with purchase history
 */
app.get('/api/admin/customers/:id', async (c) => {
  try {
    const user = getUserFromContext(c);
    const organizationId = await getOwnerOrganizationId(user.id);

    // Validate path params
    const params = adminCustomerIdParamsSchema.parse({ id: c.req.param('id') });

    const service = new AdminCustomerManagementService({
      db: dbHttp,
      environment: c.env.ENVIRONMENT || 'development',
    });

    const details = await service.getCustomerDetails(organizationId, params.id);
    return c.json({ data: details });
  } catch (error) {
    const mapped = mapErrorToResponse(error);
    return c.json(mapped.response, mapped.statusCode);
  }
});

/**
 * POST /api/admin/customers/:customerId/grant-access/:contentId
 * Grant complimentary content access (for refunds/support)
 */
app.post(
  '/api/admin/customers/:customerId/grant-access/:contentId',
  async (c) => {
    const { db, cleanup } = createPerRequestDbClient(c.env);

    try {
      const user = getUserFromContext(c);
      const organizationId = await getOwnerOrganizationId(user.id);

      // Validate path params
      const params = adminGrantAccessParamsSchema.parse({
        customerId: c.req.param('customerId'),
        contentId: c.req.param('contentId'),
      });

      const service = new AdminCustomerManagementService({
        db,
        environment: c.env.ENVIRONMENT || 'development',
      });

      await service.grantContentAccess(
        organizationId,
        params.customerId,
        params.contentId
      );

      return c.json({ success: true });
    } catch (error) {
      const mapped = mapErrorToResponse(error);
      return c.json(mapped.response, mapped.statusCode);
    } finally {
      await cleanup();
    }
  }
);

// ============================================================================
// Status Endpoint (for debugging)
// ============================================================================

app.get('/api/admin/status', (c) => {
  const user = c.get('user');
  return c.json({
    status: 'ok',
    message: 'Admin API is operational',
    user: {
      id: user?.id,
      role: user?.role,
    },
  });
});

export default app;
