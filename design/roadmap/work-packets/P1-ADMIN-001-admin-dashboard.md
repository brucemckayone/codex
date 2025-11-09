# Work Packet: P1-ADMIN-001 - Admin Dashboard Backend

**Status**: 🚧 To Be Implemented
**Priority**: P1 (Important - needed soon)
**Estimated Effort**: 4-5 days
**Branch**: `feature/P1-ADMIN-001-admin-dashboard`

---

## Current State

**✅ Already Implemented:**
- Authentication middleware (`workers/auth/src/middleware/auth.ts`)
- Database client with Drizzle ORM
- Content schema (from P1-CONTENT-001)
- Purchase schema (from P1-ECOM-001)
- Security middleware (rate limiting, headers)

**🚧 Needs Implementation:**
- Platform owner authentication guard (`requirePlatformOwner`)
- Admin analytics service (revenue, customers, content stats)
- Admin content management APIs (list all, publish/unpublish, delete)
- Customer management APIs (list customers, view purchases, manual access grant)
- Tests

---

## Dependencies

### Required Work Packets
- **P1-CONTENT-001** (Content Service) - MUST complete first for content queries
- **P1-ECOM-001** (Stripe Checkout) - MUST complete first for purchase data

### Existing Code
```typescript
// Auth middleware pattern already available
import { requireAuth } from './middleware/auth';

app.get('/api/protected', requireAuth(), async (c) => {
  const user = c.get('user');
  // ...
});
```

### Required Documentation
- [Access Control Patterns](../../core/ACCESS_CONTROL_PATTERNS.md)
- [Multi-Tenant Architecture](../../core/MULTI_TENANT_ARCHITECTURE.md)
- [STANDARDS.md](../STANDARDS.md)

---

## Implementation Steps

### Step 1: Create Platform Owner Auth Guard

**Note**: Users table already has `role` enum with 'platform_owner' value (see `design/features/shared/database-schema.md` lines 65-127). No schema changes needed - middleware checks `user.role === 'platform_owner'`.

**File**: `workers/auth/src/middleware/require-platform-owner.ts`

```typescript
import type { Context, Next } from 'hono';
import type { AuthContext } from './auth';
import { ObservabilityClient } from '@codex/observability';

/**
 * Middleware to require platform owner role
 *
 * Checks user.role === 'platform_owner' (from database-schema.md v2.0)
 * Must be used AFTER requireAuth() middleware
 */
export function requirePlatformOwner() {
  return async (c: Context<AuthContext>, next: Next) => {
    const obs = new ObservabilityClient('auth-middleware', c.env.ENVIRONMENT || 'development');
    const user = c.get('user');

    if (!user) {
      obs.warn('Platform owner check failed - no user context', {
        url: c.req.url,
      });
      return c.json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      }, 401);
    }

    // Check role enum (not boolean flag)
    if (user.role !== 'platform_owner') {
      obs.warn('Platform owner check failed - user not platform owner', {
        userId: user.id,
        userRole: user.role,
        url: c.req.url,
      });
      return c.json({
        error: {
          code: 'FORBIDDEN',
          message: 'Platform owner access required',
        },
      }, 403);
    }

    obs.info('Platform owner check passed', {
      userId: user.id,
      userRole: user.role,
    });

    await next();
  };
}
```

### Step 2: Create Admin Analytics Service

**File**: `packages/admin/src/analytics-service.ts`

```typescript
import { sql, eq, and, gte, desc, count } from 'drizzle-orm';
import type { DrizzleClient } from '@codex/database';
import { content, contentPurchases, users } from '@codex/database/schema';
import { ObservabilityClient } from '@codex/observability';

export interface AdminAnalyticsServiceConfig {
  db: DrizzleClient;
  obs: ObservabilityClient;
  organizationId: string;
}

export class AdminAnalyticsService {
  constructor(private config: AdminAnalyticsServiceConfig) {}

  /**
   * Get revenue analytics
   */
  async getRevenueStats(params: {
    startDate?: Date;
    endDate?: Date;
  }): Promise<{
    totalRevenueCents: number;
    totalPurchases: number;
    averageOrderValueCents: number;
    revenueByDay: Array<{ date: string; revenueCents: number; count: number }>;
  }> {
    const { db, obs, organizationId } = this.config;

    obs.info('Getting revenue stats', {
      startDate: params.startDate?.toISOString(),
      endDate: params.endDate?.toISOString(),
    });

    const conditions = [
      eq(contentPurchases.organizationId, organizationId),
      eq(contentPurchases.status, 'completed'),
    ];

    if (params.startDate) {
      conditions.push(gte(contentPurchases.createdAt, params.startDate));
    }
    if (params.endDate) {
      conditions.push(lte(contentPurchases.createdAt, params.endDate));
    }

    // Get total revenue and count
    const totals = await db
      .select({
        totalRevenueCents: sql<number>`COALESCE(SUM(${contentPurchases.priceCents}), 0)`,
        totalPurchases: count(contentPurchases.id),
      })
      .from(contentPurchases)
      .where(and(...conditions));

    const { totalRevenueCents, totalPurchases } = totals[0];
    const averageOrderValueCents = totalPurchases > 0 ? Math.round(totalRevenueCents / totalPurchases) : 0;

    // Get revenue by day
    const revenueByDay = await db
      .select({
        date: sql<string>`DATE(${contentPurchases.createdAt})`,
        revenueCents: sql<number>`SUM(${contentPurchases.priceCents})`,
        count: count(contentPurchases.id),
      })
      .from(contentPurchases)
      .where(and(...conditions))
      .groupBy(sql`DATE(${contentPurchases.createdAt})`)
      .orderBy(sql`DATE(${contentPurchases.createdAt}) DESC`)
      .limit(30); // Last 30 days

    return {
      totalRevenueCents,
      totalPurchases,
      averageOrderValueCents,
      revenueByDay: revenueByDay.map(row => ({
        date: row.date,
        revenueCents: Number(row.revenueCents),
        count: Number(row.count),
      })),
    };
  }

  /**
   * Get customer analytics
   */
  async getCustomerStats(): Promise<{
    totalCustomers: number;
    totalPurchasingCustomers: number;
    newCustomersLast30Days: number;
  }> {
    const { db, obs, organizationId } = this.config;

    obs.info('Getting customer stats');

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Total customers (users in this organization)
    const totalCustomersResult = await db
      .select({ count: count(users.id) })
      .from(users)
      .where(eq(users.organizationId, organizationId));

    const totalCustomers = totalCustomersResult[0]?.count || 0;

    // Total purchasing customers (distinct customers with completed purchases)
    const purchasingCustomersResult = await db
      .select({ count: sql<number>`COUNT(DISTINCT ${contentPurchases.customerId})` })
      .from(contentPurchases)
      .where(and(
        eq(contentPurchases.organizationId, organizationId),
        eq(contentPurchases.status, 'completed')
      ));

    const totalPurchasingCustomers = Number(purchasingCustomersResult[0]?.count || 0);

    // New customers in last 30 days
    const newCustomersResult = await db
      .select({ count: count(users.id) })
      .from(users)
      .where(and(
        eq(users.organizationId, organizationId),
        gte(users.createdAt, thirtyDaysAgo)
      ));

    const newCustomersLast30Days = newCustomersResult[0]?.count || 0;

    return {
      totalCustomers,
      totalPurchasingCustomers,
      newCustomersLast30Days,
    };
  }

  /**
   * Get top performing content
   */
  async getTopContent(limit: number = 10): Promise<Array<{
    contentId: string;
    title: string;
    totalRevenueCents: number;
    totalPurchases: number;
  }>> {
    const { db, obs, organizationId } = this.config;

    obs.info('Getting top content', { limit });

    const topContent = await db
      .select({
        contentId: contentPurchases.contentId,
        title: content.title,
        totalRevenueCents: sql<number>`SUM(${contentPurchases.priceCents})`,
        totalPurchases: count(contentPurchases.id),
      })
      .from(contentPurchases)
      .innerJoin(content, eq(contentPurchases.contentId, content.id))
      .where(and(
        eq(contentPurchases.organizationId, organizationId),
        eq(contentPurchases.status, 'completed')
      ))
      .groupBy(contentPurchases.contentId, content.title)
      .orderBy(desc(sql`SUM(${contentPurchases.priceCents})`))
      .limit(limit);

    return topContent.map(row => ({
      contentId: row.contentId,
      title: row.title,
      totalRevenueCents: Number(row.totalRevenueCents),
      totalPurchases: Number(row.totalPurchases),
    }));
  }
}

/**
 * Factory function for dependency injection
 */
export function getAdminAnalyticsService(env: {
  DATABASE_URL: string;
  ENVIRONMENT: string;
  ORGANIZATION_ID: string;
}): AdminAnalyticsService {
  const db = getDbClient(env.DATABASE_URL);
  const obs = new ObservabilityClient('admin-analytics-service', env.ENVIRONMENT);

  return new AdminAnalyticsService({
    db,
    obs,
    organizationId: env.ORGANIZATION_ID,
  });
}
```

### Step 3: Create Admin Content Management Service

**File**: `packages/admin/src/content-management-service.ts`

```typescript
import { eq, and, desc, isNull } from 'drizzle-orm';
import type { DrizzleClient } from '@codex/database';
import { content } from '@codex/database/schema';
import { ObservabilityClient } from '@codex/observability';

export interface AdminContentManagementServiceConfig {
  db: DrizzleClient;
  obs: ObservabilityClient;
  organizationId: string;
}

export class AdminContentManagementService {
  constructor(private config: AdminContentManagementServiceConfig) {}

  /**
   * List all content (including drafts and archived)
   */
  async listAllContent(params: {
    page: number;
    limit: number;
    status?: 'draft' | 'published' | 'archived' | 'all';
  }): Promise<{
    items: Array<{
      id: string;
      title: string;
      slug: string;
      status: string;
      priceCents: number;
      publishedAt: Date | null;
      createdAt: Date;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
    };
  }> {
    const { db, obs, organizationId } = this.config;

    obs.info('Listing all content', { page: params.page, status: params.status });

    const conditions = [
      eq(content.organizationId, organizationId),
      isNull(content.deletedAt), // Don't show soft-deleted
    ];

    if (params.status && params.status !== 'all') {
      conditions.push(eq(content.status, params.status));
    }

    const offset = (params.page - 1) * params.limit;

    const items = await db.query.content.findMany({
      where: and(...conditions),
      orderBy: [desc(content.createdAt)],
      limit: params.limit,
      offset,
      columns: {
        id: true,
        title: true,
        slug: true,
        status: true,
        priceCents: true,
        publishedAt: true,
        createdAt: true,
      },
    });

    // Get total count (simplified - in production use separate count query)
    const totalResult = await db
      .select({ count: count(content.id) })
      .from(content)
      .where(and(...conditions));

    const total = totalResult[0]?.count || 0;

    return {
      items,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
      },
    };
  }

  /**
   * Publish content (change status from draft to published)
   */
  async publishContent(contentId: string): Promise<void> {
    const { db, obs, organizationId } = this.config;

    obs.info('Publishing content', { contentId });

    await db
      .update(content)
      .set({
        status: 'published',
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(content.id, contentId),
        eq(content.organizationId, organizationId)
      ));

    obs.info('Content published', { contentId });
  }

  /**
   * Unpublish content (change status to draft)
   */
  async unpublishContent(contentId: string): Promise<void> {
    const { db, obs, organizationId } = this.config;

    obs.info('Unpublishing content', { contentId });

    await db
      .update(content)
      .set({
        status: 'draft',
        updatedAt: new Date(),
      })
      .where(and(
        eq(content.id, contentId),
        eq(content.organizationId, organizationId)
      ));

    obs.info('Content unpublished', { contentId });
  }

  /**
   * Soft delete content
   */
  async deleteContent(contentId: string): Promise<void> {
    const { db, obs, organizationId } = this.config;

    obs.info('Deleting content', { contentId });

    await db
      .update(content)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(content.id, contentId),
        eq(content.organizationId, organizationId)
      ));

    obs.info('Content deleted (soft)', { contentId });
  }
}
```

### Step 4: Create Admin Customer Management Service

**File**: `packages/admin/src/customer-management-service.ts`

```typescript
import { eq, and, desc } from 'drizzle-orm';
import type { DrizzleClient } from '@codex/database';
import { users, contentPurchases, content } from '@codex/database/schema';
import { ObservabilityClient } from '@codex/observability';

export interface AdminCustomerManagementServiceConfig {
  db: DrizzleClient;
  obs: ObservabilityClient;
  organizationId: string;
}

export class AdminCustomerManagementService {
  constructor(private config: AdminCustomerManagementServiceConfig) {}

  /**
   * List all customers with purchase stats
   */
  async listCustomers(params: {
    page: number;
    limit: number;
  }): Promise<{
    items: Array<{
      id: string;
      name: string;
      email: string;
      createdAt: Date;
      totalPurchases: number;
      totalSpentCents: number;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
    };
  }> {
    const { db, obs, organizationId } = this.config;

    obs.info('Listing customers', { page: params.page });

    const offset = (params.page - 1) * params.limit;

    // Get users with purchase stats (aggregated)
    const customers = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        createdAt: users.createdAt,
        totalPurchases: sql<number>`COALESCE(COUNT(${contentPurchases.id}), 0)`,
        totalSpentCents: sql<number>`COALESCE(SUM(${contentPurchases.priceCents}), 0)`,
      })
      .from(users)
      .leftJoin(
        contentPurchases,
        and(
          eq(users.id, contentPurchases.customerId),
          eq(contentPurchases.status, 'completed')
        )
      )
      .where(eq(users.organizationId, organizationId))
      .groupBy(users.id, users.name, users.email, users.createdAt)
      .orderBy(desc(users.createdAt))
      .limit(params.limit)
      .offset(offset);

    // Get total count
    const totalResult = await db
      .select({ count: count(users.id) })
      .from(users)
      .where(eq(users.organizationId, organizationId));

    const total = totalResult[0]?.count || 0;

    return {
      items: customers.map(c => ({
        id: c.id,
        name: c.name,
        email: c.email,
        createdAt: c.createdAt,
        totalPurchases: Number(c.totalPurchases),
        totalSpentCents: Number(c.totalSpentCents),
      })),
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
      },
    };
  }

  /**
   * Get customer details with purchase history
   */
  async getCustomerDetails(customerId: string): Promise<{
    customer: {
      id: string;
      name: string;
      email: string;
      createdAt: Date;
    };
    purchases: Array<{
      id: string;
      contentTitle: string;
      priceCents: number;
      purchasedAt: Date;
      status: string;
    }>;
    stats: {
      totalPurchases: number;
      totalSpentCents: number;
    };
  }> {
    const { db, obs, organizationId } = this.config;

    obs.info('Getting customer details', { customerId });

    // Get customer
    const customer = await db.query.users.findFirst({
      where: and(
        eq(users.id, customerId),
        eq(users.organizationId, organizationId)
      ),
    });

    if (!customer) {
      throw new Error('CUSTOMER_NOT_FOUND');
    }

    // Get purchases
    const purchases = await db.query.contentPurchases.findMany({
      where: eq(contentPurchases.customerId, customerId),
      with: {
        content: {
          columns: {
            title: true,
          },
        },
      },
      orderBy: [desc(contentPurchases.createdAt)],
    });

    // Calculate stats
    const completedPurchases = purchases.filter(p => p.status === 'completed');
    const totalPurchases = completedPurchases.length;
    const totalSpentCents = completedPurchases.reduce((sum, p) => sum + p.priceCents, 0);

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        createdAt: customer.createdAt,
      },
      purchases: purchases.map(p => ({
        id: p.id,
        contentTitle: p.content.title,
        priceCents: p.priceCents,
        purchasedAt: p.createdAt,
        status: p.status,
      })),
      stats: {
        totalPurchases,
        totalSpentCents,
      },
    };
  }

  /**
   * Manually grant access to content (for support/refunds)
   */
  async grantContentAccess(customerId: string, contentId: string): Promise<void> {
    const { db, obs, organizationId } = this.config;

    obs.info('Manually granting content access', { customerId, contentId });

    // Verify customer exists
    const customer = await db.query.users.findFirst({
      where: and(
        eq(users.id, customerId),
        eq(users.organizationId, organizationId)
      ),
    });

    if (!customer) {
      throw new Error('CUSTOMER_NOT_FOUND');
    }

    // Verify content exists
    const contentRecord = await db.query.content.findFirst({
      where: and(
        eq(content.id, contentId),
        eq(content.organizationId, organizationId)
      ),
    });

    if (!contentRecord) {
      throw new Error('CONTENT_NOT_FOUND');
    }

    // Check if purchase already exists
    const existingPurchase = await db.query.contentPurchases.findFirst({
      where: and(
        eq(contentPurchases.customerId, customerId),
        eq(contentPurchases.contentId, contentId)
      ),
    });

    if (existingPurchase) {
      obs.warn('Purchase already exists', { customerId, contentId });
      throw new Error('PURCHASE_ALREADY_EXISTS');
    }

    // Create completed purchase (manual grant = $0)
    await db.insert(contentPurchases).values({
      id: crypto.randomUUID(),
      customerId,
      contentId,
      organizationId,
      priceCents: 0, // Manual grant
      status: 'completed',
      stripeCheckoutSessionId: null, // No Stripe session
      stripePaymentIntentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    obs.info('Content access granted manually', { customerId, contentId });
  }
}
```

### Step 5: Create Admin API Endpoints

**File**: `workers/auth/src/routes/admin.ts`

```typescript
import { Hono } from 'hono';
import type { AuthContext } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { requirePlatformOwner } from '../middleware/require-platform-owner';
import {
  getAdminAnalyticsService,
  getAdminContentManagementService,
  getAdminCustomerManagementService,
} from '@codex/admin';
import { ObservabilityClient } from '@codex/observability';

const app = new Hono<AuthContext>();

// All routes require platform owner
app.use('*', requireAuth());
app.use('*', requirePlatformOwner());

/**
 * GET /api/admin/analytics/revenue
 * Get revenue statistics
 */
app.get('/api/admin/analytics/revenue', async (c) => {
  const obs = new ObservabilityClient('admin-api', c.env.ENVIRONMENT);
  const user = c.get('user');

  try {
    const service = getAdminAnalyticsService({
      ...c.env,
      ORGANIZATION_ID: user.organizationId,
    });

    const startDate = c.req.query('startDate') ? new Date(c.req.query('startDate')!) : undefined;
    const endDate = c.req.query('endDate') ? new Date(c.req.query('endDate')!) : undefined;

    const stats = await service.getRevenueStats({ startDate, endDate });

    return c.json(stats);
  } catch (err) {
    obs.trackError(err as Error, { userId: user.id });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get revenue stats' } }, 500);
  }
});

/**
 * GET /api/admin/analytics/customers
 * Get customer statistics
 */
app.get('/api/admin/analytics/customers', async (c) => {
  const obs = new ObservabilityClient('admin-api', c.env.ENVIRONMENT);
  const user = c.get('user');

  try {
    const service = getAdminAnalyticsService({
      ...c.env,
      ORGANIZATION_ID: user.organizationId,
    });

    const stats = await service.getCustomerStats();

    return c.json(stats);
  } catch (err) {
    obs.trackError(err as Error, { userId: user.id });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get customer stats' } }, 500);
  }
});

/**
 * GET /api/admin/analytics/top-content
 * Get top performing content
 */
app.get('/api/admin/analytics/top-content', async (c) => {
  const obs = new ObservabilityClient('admin-api', c.env.ENVIRONMENT);
  const user = c.get('user');

  try {
    const service = getAdminAnalyticsService({
      ...c.env,
      ORGANIZATION_ID: user.organizationId,
    });

    const limit = Number(c.req.query('limit')) || 10;
    const topContent = await service.getTopContent(limit);

    return c.json({ items: topContent });
  } catch (err) {
    obs.trackError(err as Error, { userId: user.id });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get top content' } }, 500);
  }
});

/**
 * GET /api/admin/content
 * List all content (including drafts)
 */
app.get('/api/admin/content', async (c) => {
  const obs = new ObservabilityClient('admin-api', c.env.ENVIRONMENT);
  const user = c.get('user');

  try {
    const service = getAdminContentManagementService({
      ...c.env,
      ORGANIZATION_ID: user.organizationId,
    });

    const page = Number(c.req.query('page')) || 1;
    const limit = Number(c.req.query('limit')) || 20;
    const status = c.req.query('status') as 'draft' | 'published' | 'archived' | 'all' | undefined;

    const result = await service.listAllContent({ page, limit, status });

    return c.json(result);
  } catch (err) {
    obs.trackError(err as Error, { userId: user.id });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list content' } }, 500);
  }
});

/**
 * POST /api/admin/content/:id/publish
 * Publish content
 */
app.post('/api/admin/content/:id/publish', async (c) => {
  const obs = new ObservabilityClient('admin-api', c.env.ENVIRONMENT);
  const user = c.get('user');

  try {
    const service = getAdminContentManagementService({
      ...c.env,
      ORGANIZATION_ID: user.organizationId,
    });

    await service.publishContent(c.req.param('id'));

    return c.json({ success: true });
  } catch (err) {
    obs.trackError(err as Error, { userId: user.id, contentId: c.req.param('id') });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to publish content' } }, 500);
  }
});

/**
 * POST /api/admin/content/:id/unpublish
 * Unpublish content
 */
app.post('/api/admin/content/:id/unpublish', async (c) => {
  const obs = new ObservabilityClient('admin-api', c.env.ENVIRONMENT);
  const user = c.get('user');

  try {
    const service = getAdminContentManagementService({
      ...c.env,
      ORGANIZATION_ID: user.organizationId,
    });

    await service.unpublishContent(c.req.param('id'));

    return c.json({ success: true });
  } catch (err) {
    obs.trackError(err as Error, { userId: user.id, contentId: c.req.param('id') });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to unpublish content' } }, 500);
  }
});

/**
 * DELETE /api/admin/content/:id
 * Soft delete content
 */
app.delete('/api/admin/content/:id', async (c) => {
  const obs = new ObservabilityClient('admin-api', c.env.ENVIRONMENT);
  const user = c.get('user');

  try {
    const service = getAdminContentManagementService({
      ...c.env,
      ORGANIZATION_ID: user.organizationId,
    });

    await service.deleteContent(c.req.param('id'));

    return c.json({ success: true });
  } catch (err) {
    obs.trackError(err as Error, { userId: user.id, contentId: c.req.param('id') });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete content' } }, 500);
  }
});

/**
 * GET /api/admin/customers
 * List all customers
 */
app.get('/api/admin/customers', async (c) => {
  const obs = new ObservabilityClient('admin-api', c.env.ENVIRONMENT);
  const user = c.get('user');

  try {
    const service = getAdminCustomerManagementService({
      ...c.env,
      ORGANIZATION_ID: user.organizationId,
    });

    const page = Number(c.req.query('page')) || 1;
    const limit = Number(c.req.query('limit')) || 20;

    const result = await service.listCustomers({ page, limit });

    return c.json(result);
  } catch (err) {
    obs.trackError(err as Error, { userId: user.id });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list customers' } }, 500);
  }
});

/**
 * GET /api/admin/customers/:id
 * Get customer details with purchase history
 */
app.get('/api/admin/customers/:id', async (c) => {
  const obs = new ObservabilityClient('admin-api', c.env.ENVIRONMENT);
  const user = c.get('user');

  try {
    const service = getAdminCustomerManagementService({
      ...c.env,
      ORGANIZATION_ID: user.organizationId,
    });

    const details = await service.getCustomerDetails(c.req.param('id'));

    return c.json(details);
  } catch (err) {
    if ((err as Error).message === 'CUSTOMER_NOT_FOUND') {
      return c.json({ error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' } }, 404);
    }
    obs.trackError(err as Error, { userId: user.id, customerId: c.req.param('id') });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get customer details' } }, 500);
  }
});

/**
 * POST /api/admin/customers/:customerId/grant-access/:contentId
 * Manually grant content access
 */
app.post('/api/admin/customers/:customerId/grant-access/:contentId', async (c) => {
  const obs = new ObservabilityClient('admin-api', c.env.ENVIRONMENT);
  const user = c.get('user');

  try {
    const service = getAdminCustomerManagementService({
      ...c.env,
      ORGANIZATION_ID: user.organizationId,
    });

    await service.grantContentAccess(
      c.req.param('customerId'),
      c.req.param('contentId')
    );

    return c.json({ success: true });
  } catch (err) {
    const message = (err as Error).message;
    if (message === 'CUSTOMER_NOT_FOUND') {
      return c.json({ error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' } }, 404);
    }
    if (message === 'CONTENT_NOT_FOUND') {
      return c.json({ error: { code: 'CONTENT_NOT_FOUND', message: 'Content not found' } }, 404);
    }
    if (message === 'PURCHASE_ALREADY_EXISTS') {
      return c.json({ error: { code: 'PURCHASE_ALREADY_EXISTS', message: 'Customer already has access' } }, 409);
    }
    obs.trackError(err as Error, {
      userId: user.id,
      customerId: c.req.param('customerId'),
      contentId: c.req.param('contentId'),
    });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to grant access' } }, 500);
  }
});

export default app;
```

---

## Testing Strategy

**Test Specifications**: See `design/roadmap/testing/admin-testing-definition.md` for comprehensive test patterns, including:
- Platform owner middleware tests
- Analytics service tests (revenue, customers, top content)
- Content management service tests (list, publish, unpublish, delete)
- Customer management service tests (list, details, grant access)
- API integration tests (authorization, validation, error handling)
- Common testing patterns and mocking strategies

**To Run Tests**:
```bash
# Unit tests (services with mocked DB)
pnpm --filter @codex/admin test

# Integration tests (API with test DB)
pnpm --filter @codex/workers-auth test:integration
```

---

## Definition of Done

### Code Implementation
- [ ] `requirePlatformOwner()` middleware implemented (checks `user.role === 'platform_owner'`)
- [ ] Admin analytics service implemented with all methods
  - [ ] `getRevenueStats()` with date filtering
  - [ ] `getCustomerStats()` with 30-day new customers
  - [ ] `getTopContent()` with revenue ranking
- [ ] Admin content management service implemented
  - [ ] `listAllContent()` with pagination and status filtering
  - [ ] `publishContent()` with timestamp update
  - [ ] `unpublishContent()` with status revert
  - [ ] `deleteContent()` with soft delete
- [ ] Admin customer management service implemented
  - [ ] `listCustomers()` with purchase aggregation
  - [ ] `getCustomerDetails()` with purchase history
  - [ ] `grantContentAccess()` with validation
- [ ] Admin API endpoints created and wired
  - [ ] Analytics endpoints (`/api/admin/analytics/*`)
  - [ ] Content management endpoints (`/api/admin/content/*`)
  - [ ] Customer management endpoints (`/api/admin/customers/*`)

### Testing
- [ ] Unit tests for all services (mocked DB)
  - [ ] Analytics service tests
  - [ ] Content management service tests
  - [ ] Customer management service tests
- [ ] Integration tests for API
  - [ ] Platform owner authorization checks (403 for non-platform-owner)
  - [ ] All endpoints with valid inputs
  - [ ] Error cases (not found, validation errors)
- [ ] Manual testing checklist completed
  - [ ] View analytics dashboard
  - [ ] Publish/unpublish content
  - [ ] Manually grant access

### Quality & Security
- [ ] Error handling comprehensive (all error codes documented)
- [ ] Observability logging complete (all operations logged)
- [ ] Organization scoping enforced on ALL queries
- [ ] Input validation with Zod schemas
- [ ] TypeScript types exported from services
- [ ] No sensitive data in logs
- [ ] Soft delete used (no hard deletes)

### Documentation
- [ ] API endpoints documented
- [ ] Error codes documented
- [ ] Service interfaces documented
- [ ] Integration points documented

### DevOps
- [ ] CI passing (tests + typecheck + lint)
- [ ] No new ESLint warnings
- [ ] No new TypeScript errors
- [ ] Branch deployed to staging
- [ ] Admin routes accessible at `/api/admin/*`

---

## Interfaces & Integration Points

### Upstream Dependencies (What This Work Packet Needs)

#### P1-CONTENT-001 (Content Service)

**Tables Used**:
- `content` - List all content, publish/unpublish, soft delete
  - Fields: `id`, `title`, `slug`, `status`, `price_cents`, `published_at`, `created_at`, `deleted_at`, `organization_id`
  - Where clauses:
    - List all: `organization_id = X AND deleted_at IS NULL`
    - Status filter: `status IN ('draft', 'published', 'archived')`
  - Updates: `status`, `published_at`, `deleted_at`, `updated_at`

- `media_items` - Display media details in content listings
  - Fields: `id`, `media_type`, `duration_seconds`, `thumbnail_url`, `creator_id`

**Example Query**:
```typescript
const allContent = await db.query.content.findMany({
  where: and(
    eq(content.organizationId, organizationId),
    isNull(content.deletedAt),
    params.status !== 'all' ? eq(content.status, params.status) : undefined
  ),
  with: { mediaItem: true },
  orderBy: [desc(content.createdAt)],
  limit: params.limit,
  offset: (params.page - 1) * params.limit,
});
```

#### P1-ECOM-001 (Stripe Checkout)

**Tables Used**:
- `purchases` - Revenue analytics, customer purchase history
  - Fields: `id`, `user_id`, `content_id`, `price_cents`, `status`, `created_at`, `organization_id`
  - Where clauses: `status = 'completed' AND organization_id = X`
  - Aggregations: `SUM(price_cents)`, `COUNT(*)`, `GROUP BY DATE(created_at)`

- `content_access` - Manual access grants, verify existing access
  - Fields: `id`, `user_id`, `content_id`, `access_type`, `created_at`
  - Insert: Manual grants create `access_type = 'purchased'` with `price_cents = 0`

**Example Query**:
```typescript
const revenueStats = await db
  .select({
    totalRevenueCents: sql<number>`SUM(${purchases.priceCents})`,
    totalPurchases: count(purchases.id),
  })
  .from(purchases)
  .where(and(
    eq(purchases.organizationId, organizationId),
    eq(purchases.status, 'completed')
  ));
```

#### Auth Middleware (Existing)

**Exports Used**:
- `requireAuth()` - Validates JWT, adds user to context
  - Returns: `c.get('user')` with `{ id, email, role, organizationId }`
- `requirePlatformOwner()` - NEW middleware from this work packet
  - Checks: `user.role === 'platform_owner'`
  - Returns: 403 if not platform owner

**Middleware Chain**:
```typescript
app.use('*', requireAuth());           // Step 1: Validate JWT
app.use('*', requirePlatformOwner());  // Step 2: Check platform_owner role
```

### Downstream Consumers (What Uses This Work Packet)

#### Admin Dashboard Frontend (Future)

**Endpoints Called**:

**Analytics Tab**:
- `GET /api/admin/analytics/revenue?startDate=...&endDate=...` - Revenue charts
- `GET /api/admin/analytics/customers` - Customer metrics
- `GET /api/admin/analytics/top-content?limit=10` - Top performers

**Content Management Tab**:
- `GET /api/admin/content?page=1&limit=20&status=all` - Content list with filters
- `POST /api/admin/content/:id/publish` - Publish button
- `POST /api/admin/content/:id/unpublish` - Unpublish button
- `DELETE /api/admin/content/:id` - Delete button (soft delete)

**Customer Support Tab**:
- `GET /api/admin/customers?page=1&limit=20` - Customer list
- `GET /api/admin/customers/:id` - Customer detail page
- `POST /api/admin/customers/:customerId/grant-access/:contentId` - Grant access button

**Response Formats**:
```typescript
// GET /api/admin/analytics/revenue
{
  totalRevenueCents: 50000,
  totalPurchases: 25,
  averageOrderValueCents: 2000,
  revenueByDay: [
    { date: '2025-11-09', revenueCents: 5000, count: 3 },
    // ... last 30 days
  ]
}

// GET /api/admin/content
{
  items: [
    {
      id: 'uuid',
      title: 'Video Title',
      slug: 'video-title',
      status: 'published',
      priceCents: 1999,
      publishedAt: '2025-11-01T00:00:00Z',
      createdAt: '2025-10-30T00:00:00Z'
    },
    // ...
  ],
  pagination: {
    page: 1,
    limit: 20,
    total: 50
  }
}

// GET /api/admin/customers/:id
{
  customer: {
    id: 'uuid',
    name: 'John Doe',
    email: 'john@example.com',
    createdAt: '2025-10-01T00:00:00Z'
  },
  purchases: [
    {
      id: 'uuid',
      contentTitle: 'Video Title',
      priceCents: 1999,
      purchasedAt: '2025-11-01T00:00:00Z',
      status: 'completed'
    },
    // ...
  ],
  stats: {
    totalPurchases: 5,
    totalSpentCents: 9995
  }
}
```

#### Error Propagation

All admin endpoints follow consistent error format:

| Error Code | HTTP Status | Meaning | Frontend Action |
|------------|-------------|---------|-----------------|
| `UNAUTHORIZED` | 401 | No JWT or invalid JWT | Redirect to login |
| `FORBIDDEN` | 403 | Not a platform owner | Show "Access denied" message |
| `CUSTOMER_NOT_FOUND` | 404 | Customer doesn't exist | Show "Customer not found" |
| `CONTENT_NOT_FOUND` | 404 | Content doesn't exist | Show "Content not found" |
| `PURCHASE_ALREADY_EXISTS` | 409 | Access already granted | Show "Already has access" |
| `VALIDATION_ERROR` | 400 | Invalid input parameters | Show validation errors |
| `INTERNAL_ERROR` | 500 | Unexpected server error | Show generic error, retry |

**Error Response Format**:
```typescript
{
  error: {
    code: 'FORBIDDEN',
    message: 'Platform owner access required'
  }
}
```

### Integration With Other Work Packets

#### Integrates With (Existing Code)
- **Auth Worker**: `workers/auth/src/index.ts` - Hosts admin routes
- **Auth Middleware**: `workers/auth/src/middleware/auth.ts` - JWT validation
- **Database Client**: `@codex/database` - Drizzle ORM queries
- **Observability**: `@codex/observability` - Logging and error tracking

#### Enables (Future Work Packets)
- **Admin Dashboard Frontend** (Future) - Consumes all admin APIs
- **P1-SETTINGS-001** (Settings Service) - May use admin analytics patterns
- **P1-NOTIFY-001** (Email Service) - May email analytics reports to platform owner

### Business Rules

1. **Platform Owner Only**: ALL admin endpoints require `user.role === 'platform_owner'`
   - No exceptions - even read-only analytics
   - 403 response for non-platform-owner users

2. **Organization Scoping**: ALL queries MUST filter by `organizationId`
   - Get `organizationId` from authenticated user context
   - Never allow cross-organization data access
   - Critical for multi-tenant security (even in Phase 1 single-org)

3. **Soft Delete**: Content deletion uses `deleted_at` timestamp
   - Preserves purchase history and analytics
   - Deleted content excluded from listings
   - Can be restored by setting `deleted_at = NULL`

4. **Manual Access Grants**: Support/refund workflow
   - Creates $0 purchase with `status = 'completed'`
   - No Stripe session IDs (manual grant, not payment)
   - Prevents duplicate grants (409 if already exists)
   - Validates customer and content exist

5. **Analytics Date Filtering**: Revenue stats support date ranges
   - Default: All time
   - `startDate` and `endDate` query params (ISO 8601)
   - Daily breakdown limited to last 30 days

### Data Flow Example

**Scenario**: Platform owner manually grants access to refund customer

```
1. Admin Frontend
   ↓ POST /api/admin/customers/:customerId/grant-access/:contentId

2. Admin API Endpoint (admin.ts)
   ↓ requireAuth() middleware validates JWT
   ↓ requirePlatformOwner() checks user.role === 'platform_owner'
   ↓ Extract customerId, contentId from URL params

3. AdminCustomerManagementService.grantContentAccess()
   ↓ Query users table: Verify customer exists in organization
   ↓ Query content table: Verify content exists in organization
   ↓ Query content_access table: Check for existing access (409 if exists)
   ↓ Insert into content_access: Create access grant with price_cents = 0
   ↓ Log success to ObservabilityClient

4. Admin API Response
   ↓ { success: true }

5. Admin Frontend
   ↓ Show success toast "Access granted to John Doe"
```

---

## Business Context

### Why This Matters

The admin dashboard backend provides platform owners with essential tools to:
1. **Monitor Revenue**: Track sales, average order value, and revenue trends
2. **Manage Content**: Publish/unpublish/delete content across the platform
3. **Support Customers**: View purchase history and manually grant access for refunds

Phase 1 has a single organization, but admin features are scoped by `organizationId` to prepare for multi-tenant Phase 2+.

### User Personas

**Platform Owner** (Super Admin):
- Developer/business operator who runs the Codex platform
- NOT a content creator (different from organization owner)
- Has `user.role = 'platform_owner'` in database
- Full access to admin dashboard (analytics, content, customers)
- Example: Site administrator monitoring overall platform health

**Organization Owner** (Future Phase 2):
- Business owner who creates content
- Has `user.role = 'creator'` and `organization_memberships.role = 'owner'`
- NO access to admin dashboard in Phase 1
- Example: Content creator who uploads videos

### Business Rules

1. **Platform Owner Exclusivity**: Only platform owners can access admin features
   - Enforced by `requirePlatformOwner()` middleware
   - 403 response for all other users (including org owners)

2. **Organization Scoping**: All data queries filtered by `organizationId`
   - Prevents cross-organization data leaks
   - Critical for multi-tenant security (Phase 2+)

3. **Analytics Accuracy**: Revenue calculations use only `completed` purchases
   - Exclude `pending`, `failed`, `refunded` statuses
   - Money stored as integer cents (ACID-compliant)

4. **Customer Support Workflow**: Manual access grants for refunds/support
   - Creates $0 purchase with no Stripe session
   - Validates customer and content exist
   - Prevents duplicate grants (409 error)

---

## Security Considerations

### Authentication & Authorization

1. **Two-Layer Auth Check**:
   ```typescript
   app.use('*', requireAuth());           // Step 1: Valid JWT required
   app.use('*', requirePlatformOwner());  // Step 2: role = 'platform_owner' required
   ```
   - `requireAuth()` validates JWT, adds user to context
   - `requirePlatformOwner()` checks `user.role === 'platform_owner'`
   - 401 if no auth, 403 if not platform owner

2. **Role-Based Access Control (RBAC)**:
   - Users table has `role` enum: `'platform_owner' | 'creator' | 'customer'`
   - Platform owner role check: `user.role === 'platform_owner'`
   - NO boolean flags - single source of truth

3. **JWT Token Validation**:
   - JWT contains: `{ userId, email, role, organizationId }`
   - Validated by existing `requireAuth()` middleware
   - Tokens expire (configured in auth service)

### Data Access Controls

1. **Organization Scoping (Critical)**:
   - ALL queries MUST include `WHERE organization_id = X`
   - Get `organizationId` from authenticated user context
   - NEVER trust client-provided `organizationId`
   - Example:
     ```typescript
     const user = c.get('user');
     const stats = await service.getRevenueStats({
       ...c.env,
       ORGANIZATION_ID: user.organizationId, // ← From JWT, not query param
     });
     ```

2. **Soft Delete Protection**:
   - Deleted content has `deleted_at IS NOT NULL`
   - Listings filter: `WHERE deleted_at IS NULL`
   - Preserves referential integrity with purchases
   - Can be restored by setting `deleted_at = NULL`

3. **SQL Injection Prevention**:
   - Use Drizzle ORM (parameterized queries)
   - NEVER concatenate user input into SQL
   - Validate all inputs with Zod schemas

### Sensitive Data Handling

1. **No PII in Logs**:
   - Log `userId`, NOT email or name
   - Log aggregate stats, NOT individual customer data
   - Example:
     ```typescript
     obs.info('Revenue stats calculated', {
       totalRevenueCents: stats.totalRevenueCents, // ✅ OK
       // email: customer.email, // ❌ NO - PII in logs
     });
     ```

2. **Error Messages**:
   - Generic errors to client: `"Internal server error"`
   - Detailed errors in logs only
   - No database schema details in responses

3. **HTTPS Only**:
   - All admin endpoints require HTTPS
   - Handled by Cloudflare Workers (automatic)

### Threat Scenarios

| Threat | Mitigation |
|--------|------------|
| Non-platform-owner accessing admin | `requirePlatformOwner()` middleware (403) |
| Cross-org data access | Organization scoping on ALL queries |
| SQL injection | Drizzle ORM parameterized queries |
| Privilege escalation | Role stored in database, validated on every request |
| Data leak via logs | No PII in logs, only user IDs |
| Brute force | Rate limiting (existing security middleware) |

---

## Performance Considerations

### Database Query Optimization

1. **Indexes Required**:
   ```sql
   -- Revenue analytics (GROUP BY DATE)
   CREATE INDEX idx_purchases_org_created ON purchases(organization_id, created_at);
   CREATE INDEX idx_purchases_status ON purchases(status);

   -- Customer aggregation
   CREATE INDEX idx_users_org ON users(organization_id);

   -- Content filtering
   CREATE INDEX idx_content_org_status ON content(organization_id, status);
   CREATE INDEX idx_content_deleted_at ON content(deleted_at);
   ```

2. **Aggregation Queries**:
   - Revenue stats use `SUM()`, `COUNT()`, `GROUP BY` in database
   - NOT in application code (efficient for large datasets)
   - Limited to 30-day breakdown (prevents massive result sets)

3. **Pagination**:
   - All listings paginated (default 20 items)
   - Use `LIMIT` and `OFFSET` in queries
   - Include total count for pagination UI

### Expected Load

| Endpoint | Frequency | Query Time | Optimization |
|----------|-----------|------------|--------------|
| `GET /api/admin/analytics/revenue` | Once per page load | ~100ms | Indexed on org_id + created_at |
| `GET /api/admin/content` | Once per page load | ~50ms | Indexed on org_id + status |
| `GET /api/admin/customers` | Once per page load | ~100ms | JOIN with purchase aggregation |
| `POST /api/admin/content/:id/publish` | Rare | ~20ms | Single row update |

**Phase 1**: Single org, low traffic (< 10 admin requests/minute)
**Phase 2+**: Multi-org, moderate traffic (< 100 admin requests/minute)

### Caching Strategy

**Phase 1**: No caching needed (low traffic, real-time data preferred)

**Phase 2+ (Future)**:
- Cache analytics stats (5-minute TTL)
- Invalidate on purchase webhooks
- Cache key: `analytics:revenue:${organizationId}:${date}`

---

## Monitoring & Observability

### Logging Strategy

All services use `ObservabilityClient` for structured logging:

```typescript
const obs = new ObservabilityClient('admin-analytics-service', env.ENVIRONMENT);

// Info level: Successful operations
obs.info('Revenue stats calculated', {
  organizationId: config.organizationId,
  totalRevenueCents: result.totalRevenueCents,
  totalPurchases: result.totalPurchases,
});

// Warn level: Unusual but not errors
obs.warn('Manual access grant - customer already has access', {
  userId: platformOwnerId,
  customerId,
  contentId,
});

// Error level: Failures
obs.trackError(err as Error, {
  userId: user.id,
  operation: 'getRevenueStats',
});
```

### Key Metrics to Track

1. **Admin Activity Metrics**:
   - Platform owner logins
   - Content publish/unpublish operations
   - Manual access grants (support actions)
   - Failed authorization attempts (403s)

2. **Performance Metrics**:
   - API endpoint response times (p50, p95, p99)
   - Database query durations
   - Error rates by endpoint

3. **Business Metrics**:
   - Total revenue (tracked by analytics endpoint)
   - Daily active customers
   - Content publish rate

### Alerts

**Critical** (Immediate Action):
- Admin API error rate > 10% for 5 minutes
- Database connection failures
- Authentication service down

**Warning** (Monitor):
- Analytics queries > 1 second (performance degradation)
- Multiple failed auth attempts (potential brute force)

### Dashboards

**Admin Health Dashboard** (Future):
- Request volume by endpoint
- Error rates by endpoint
- Average response times
- Platform owner activity log

---

## Rollout Plan

### Pre-Deployment Checklist

1. **Database Preparation**:
   - [ ] Verify `users.role` enum includes 'platform_owner'
   - [ ] Create indexes on `purchases`, `content`, `users` tables
   - [ ] Seed initial platform owner user: `UPDATE users SET role = 'platform_owner' WHERE email = 'admin@example.com'`

2. **Environment Variables**:
   - [ ] `ORGANIZATION_ID` set in worker env (Phase 1 single org)
   - [ ] `DATABASE_URL` configured
   - [ ] `ENVIRONMENT` set (development/staging/production)

3. **Integration Testing**:
   - [ ] Test platform owner login → admin dashboard flow
   - [ ] Test non-platform-owner → 403 response
   - [ ] Test revenue analytics with real purchase data
   - [ ] Test manual access grant end-to-end

### Deployment Steps

1. **Deploy Services** (packages/admin):
   ```bash
   pnpm --filter @codex/admin build
   pnpm --filter @codex/admin test
   ```

2. **Deploy Middleware** (workers/auth):
   ```bash
   pnpm --filter @codex/workers-auth deploy:staging
   ```

3. **Smoke Tests** (Staging):
   ```bash
   curl https://staging.codex.com/api/admin/analytics/revenue \
     -H "Authorization: Bearer $PLATFORM_OWNER_JWT"
   # Expected: 200 with revenue stats
   ```

4. **Production Deployment**:
   ```bash
   pnpm --filter @codex/workers-auth deploy:production
   ```

### Rollback Plan

If issues detected:
1. Revert worker deployment: `wrangler rollback --worker auth`
2. Admin frontend shows error, but rest of platform unaffected
3. Investigate logs, fix issues, redeploy

---

## Known Limitations

### Phase 1 Constraints

1. **Single Organization Only**:
   - Admin dashboard shows data for one organization
   - Multi-org UI not built (database ready)
   - Platform owner sees only their organization's data

2. **No Fine-Grained Permissions**:
   - All-or-nothing platform owner access
   - No "read-only admin" or "support agent" roles
   - Future: Add role-based permissions (Phase 2+)

3. **Manual Access Grants**:
   - Creates $0 purchase (not ideal)
   - No audit trail of who granted access
   - Future: Add separate `manual_grants` table with `granted_by` field

4. **Analytics Limited to 30 Days**:
   - Daily breakdown limited to prevent large result sets
   - No year-over-year comparison
   - Future: Add aggregated monthly/yearly stats

### Technical Debt

1. **No Caching**:
   - All queries hit database
   - OK for Phase 1 (low traffic)
   - Future: Add Redis caching for analytics

2. **No Batch Operations**:
   - Publish/delete one content item at a time
   - Future: Add bulk operations API

3. **Basic Error Handling**:
   - Generic "Internal error" responses
   - Future: Add detailed error codes and recovery suggestions

---

## Questions & Clarifications

### Resolved Questions

**Q**: Should organization owners have admin access?
**A**: No. Platform owners only (super admins). Organization owners are content creators.

**Q**: Use `is_platform_owner` boolean or `role` enum?
**A**: Use `role` enum (database-schema.md v2.0). Check `user.role === 'platform_owner'`.

**Q**: Hard delete or soft delete content?
**A**: Soft delete (`deleted_at` timestamp). Preserves purchase history.

### Open Questions

**Q**: Should we track who granted manual access?
**A**: Not in Phase 1 (adds complexity). Consider for Phase 2 with `granted_by` field.

**Q**: Should analytics show refunded purchases?
**A**: Phase 1 only tracks `completed` purchases. Refunds added in Phase 2 webhooks.

**Q**: Should platform owners see cross-org data in Phase 2+?
**A**: TBD. Requires org selector UI in admin dashboard.

---

## Success Criteria

### Functional Requirements

- [ ] Platform owners can log in and access admin dashboard
- [ ] Non-platform-owners receive 403 when accessing admin endpoints
- [ ] Revenue analytics show accurate totals and daily breakdown
- [ ] Customer stats show total customers and purchase counts
- [ ] Top content shows ranked list by revenue
- [ ] Content list shows all statuses (draft, published, archived)
- [ ] Publish/unpublish changes content status correctly
- [ ] Delete soft-deletes content (preserves purchase history)
- [ ] Customer list shows all customers with purchase aggregation
- [ ] Customer detail shows purchase history
- [ ] Manual access grant creates access without payment
- [ ] Manual access grant prevents duplicates (409 error)

### Non-Functional Requirements

- [ ] All admin endpoints respond in < 500ms (p95)
- [ ] All endpoints require platform owner role (no unauthorized access)
- [ ] All queries scoped by `organizationId` (multi-tenant safe)
- [ ] Error messages consistent (JSON format with `error.code`)
- [ ] Observability logging complete (all operations logged)
- [ ] No PII in logs (only user IDs, not emails)
- [ ] Tests achieve > 80% code coverage

### Business Goals

- [ ] Platform owners can monitor revenue without manual DB queries
- [ ] Platform owners can manage content without technical knowledge
- [ ] Support team can grant access for refunds without developer help

---

## Related Documentation

### Database Schema References

**Primary Schema** (`design/features/shared/database-schema.md`):
- Lines 65-127: `users` table with `role` enum ('platform_owner', 'creator', 'customer')
- Lines 251-339: `content` table (publish/unpublish, soft delete)
- Lines 611-692: `purchases` table (revenue analytics queries)
- Lines 694-729: `content_access` table (manual access grants)
- Lines 1348-1952: Row-Level Security (RLS) strategy (application-level enforcement in Phase 1)

**Schema Revision History** (`design/features/shared/DATABASE_SCHEMA_REVISION.md`):
- Lines 1-50: v2.0 changes summary (ACID compliance, role enum, organization scoping)

### Architecture References

**Auth Evolution** (`design/features/auth/EVOLUTION.md`):
- Lines 50-150: User types and roles (platform_owner vs organization_owner distinction)
- Lines 200-280: Phase 1 authentication patterns (JWT, middleware)

**Architecture Update Summary** (`design/ARCHITECTURE_UPDATE_SUMMARY.md`):
- Lines 39-49: Phase 1 roles clarification (platform owner ≠ organization owner)
- Lines 293-302: Q&A on platform owner role

### Feature Specifications

**Admin Dashboard TDD** (`design/features/admin-dashboard/ttd-dphase-1.md`):
- Feature requirements and user stories for admin dashboard UI

**E-Commerce PRD** (`design/features/e-commerce/pdr-phase-1.md`):
- Purchase flow and revenue tracking (context for analytics)

### Testing References

**Admin Testing Definition** (`design/roadmap/testing/admin-testing-definition.md`):
- Lines 1-692: Complete test specifications
  - Platform owner middleware tests
  - Analytics service tests (revenue, customers, top content)
  - Content management service tests
  - Customer management service tests
  - API integration tests
  - Common testing patterns

### Standards & Patterns

**STANDARDS.md** (`design/roadmap/STANDARDS.md`):
- § 4 Security: Authentication, authorization, data protection
- § 6 Observability: Logging patterns, error tracking
- § 7 Testing: Test coverage requirements

**Access Control Patterns** (`design/core/ACCESS_CONTROL_PATTERNS.md`):
- Role-based access control (RBAC) patterns
- Organization scoping patterns

**Multi-Tenant Architecture** (`design/core/MULTI_TENANT_ARCHITECTURE.md`):
- Organization isolation patterns
- Phase 1 single-org vs Phase 2+ multi-org

### Code Examples

**Existing Middleware** (`workers/auth/src/middleware/auth.ts`):
- `requireAuth()` implementation (JWT validation pattern)
- User context injection pattern
- Error response format

---

## Notes for LLM Developer

### Critical Implementation Rules

1. **MUST Complete P1-CONTENT-001 and P1-ECOM-001 First**: Depends on content and purchase schemas
2. **Use Role Enum, NOT Boolean Flag**: Check `user.role === 'platform_owner'` (from database-schema.md v2.0 lines 75)
3. **Organization Scoping**: CRITICAL - all admin queries must filter by `organizationId` from user context
4. **Soft Delete**: Use `deleted_at` timestamp for content deletion (don't hard delete)
5. **Manual Access Grant**: Creates $0 purchase with `status = 'completed'` - no Stripe session IDs
6. **Analytics Queries**: Use SQL aggregations for performance (SUM, COUNT, GROUP BY in database, not app code)
7. **Security**: All endpoints require both `requireAuth()` AND `requirePlatformOwner()` middleware

### Common Pitfalls

❌ **Don't**:
- Add `is_platform_owner` boolean field (use `role` enum instead)
- Forget organization scoping on queries (security risk!)
- Hard delete content (breaks purchase history)
- Aggregate analytics in application code (performance issue)
- Trust client-provided `organizationId` (get from JWT)
- Log PII (emails, names) in observability

✅ **Do**:
- Check `user.role === 'platform_owner'` in middleware
- Always filter queries by `user.organizationId` from context
- Use soft delete: `UPDATE content SET deleted_at = NOW()`
- Use database aggregations: `SELECT SUM(price_cents) FROM purchases`
- Get org ID from JWT: `const user = c.get('user'); user.organizationId`
- Log user IDs only: `obs.info('Revenue calculated', { userId: user.id })`

### Quick Reference: Key Tables

```typescript
// users table (lines 65-127)
role: 'platform_owner' | 'creator' | 'customer'

// content table (lines 251-339)
status: 'draft' | 'published' | 'archived'
deleted_at: TIMESTAMP (soft delete)
organization_id: UUID (scoping)

// purchases table (lines 611-692)
status: 'completed' | 'pending' | 'failed' | 'refunded'
price_cents: INTEGER (ACID-compliant)

// content_access table (lines 694-729)
access_type: 'purchased' | 'manual_grant'
```

### Debugging Tips

**403 Forbidden Error**:
- Check `user.role === 'platform_owner'` in database
- Verify JWT contains correct role
- Check middleware order: `requireAuth()` → `requirePlatformOwner()`

**Empty Analytics Results**:
- Verify `organizationId` matches in queries
- Check for `status = 'completed'` filter on purchases
- Verify date range filters (if provided)

**Manual Grant Fails**:
- Verify customer exists: `SELECT * FROM users WHERE id = ?`
- Verify content exists: `SELECT * FROM content WHERE id = ?`
- Check for duplicate: `SELECT * FROM content_access WHERE user_id = ? AND content_id = ?`

**If Stuck**: Check [CONTEXT_MAP.md](../CONTEXT_MAP.md) for more architecture context.

---

**Last Updated**: 2025-11-09
**Schema Version**: v2.0 (database-schema.md)
