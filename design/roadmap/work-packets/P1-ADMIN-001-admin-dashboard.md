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

### Step 1: Add Platform Owner Check to User Schema

**File**: `packages/database/src/schema/auth.ts` (modify existing)

```typescript
/**
 * Add isPlatformOwner field to users table
 *
 * Design: Boolean flag for platform owner role (simple RBAC for Phase 1)
 */
export const users = pgTable('users', {
  // ... existing fields ...
  isPlatformOwner: boolean('is_platform_owner').notNull().default(false),
});
```

**Migration**: `packages/database/migrations/XXXX_add_platform_owner_flag.sql`

```sql
ALTER TABLE users ADD COLUMN is_platform_owner BOOLEAN NOT NULL DEFAULT false;

-- Create index for platform owner queries (optimize admin checks)
CREATE INDEX idx_users_platform_owner ON users(is_platform_owner) WHERE is_platform_owner = true;

-- Set first user as platform owner (or use seed script)
-- UPDATE users SET is_platform_owner = true WHERE email = 'admin@example.com';
```

### Step 2: Create Platform Owner Auth Guard

**File**: `workers/auth/src/middleware/require-platform-owner.ts`

```typescript
import type { Context, Next } from 'hono';
import type { AuthContext } from './auth';
import { ObservabilityClient } from '@codex/observability';

/**
 * Middleware to require platform owner role
 *
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

    if (!user.isPlatformOwner) {
      obs.warn('Platform owner check failed - user not platform owner', {
        userId: user.id,
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
    });

    await next();
  };
}
```

### Step 3: Create Admin Analytics Service

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

### Step 4: Create Admin Content Management Service

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

### Step 5: Create Admin Customer Management Service

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

### Step 6: Create Admin API Endpoints

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

## Test Specifications

### Unit Tests (Services)
- `AdminAnalyticsService.getRevenueStats` - Calculates totals, daily breakdown
- `AdminAnalyticsService.getCustomerStats` - Customer counts
- `AdminAnalyticsService.getTopContent` - Top performers by revenue
- `AdminContentManagementService.listAllContent` - Pagination, status filtering
- `AdminContentManagementService.publishContent` - Updates status
- `AdminCustomerManagementService.listCustomers` - With purchase aggregation
- `AdminCustomerManagementService.grantContentAccess` - Manual grant, validations

### Integration Tests (API)
- `GET /api/admin/*` - 403 for non-platform-owner
- `GET /api/admin/analytics/revenue` - Returns stats
- `GET /api/admin/content` - Returns all content including drafts
- `POST /api/admin/content/:id/publish` - Publishes content
- `GET /api/admin/customers/:id` - Returns customer details
- `POST /api/admin/customers/:id/grant-access/:contentId` - Grants access

---

## Definition of Done

- [ ] Platform owner flag added to users schema with migration
- [ ] `requirePlatformOwner()` middleware implemented
- [ ] Admin analytics service implemented
- [ ] Admin content management service implemented
- [ ] Admin customer management service implemented
- [ ] Admin API endpoints created
- [ ] Unit tests for all services (mocked DB)
- [ ] Integration tests for API (platform owner checks)
- [ ] Error handling comprehensive
- [ ] Observability logging complete
- [ ] Organization scoping enforced on all queries
- [ ] CI passing (tests + typecheck + lint)

---

## Integration Points

### Depends On
- **P1-CONTENT-001**: Content schema and queries
- **P1-ECOM-001**: Purchase schema and data

### Integrates With
- Existing auth worker: `workers/auth/src/index.ts`
- Auth middleware: `workers/auth/src/middleware/auth.ts`

### Enables
- Admin dashboard frontend (analytics, content management, customer support)

---

## Related Documentation

**Must Read**:
- [Admin Dashboard TDD](../../features/admin-dashboard/ttd-dphase-1.md) - Feature specification
- [Access Control Patterns](../../core/ACCESS_CONTROL_PATTERNS.md)
- [Multi-Tenant Architecture](../../core/MULTI_TENANT_ARCHITECTURE.md)
- [STANDARDS.md](../STANDARDS.md) - § 4 Security

**Reference**:
- [Testing Strategy](../../infrastructure/Testing.md)
- [Database Schema Design](../../infrastructure/DATABASE_SCHEMA_DESIGN.md)

**Code Examples**:
- Auth middleware: `workers/auth/src/middleware/auth.ts`

---

## Notes for LLM Developer

1. **MUST Complete P1-CONTENT-001 and P1-ECOM-001 First**: Depends on content and purchase schemas
2. **Platform Owner Flag**: Simple RBAC for Phase 1 - single boolean flag
3. **Organization Scoping**: CRITICAL - all admin queries must filter by `organizationId`
4. **Soft Delete**: Use `deletedAt` for content deletion (don't hard delete)
5. **Manual Access Grant**: Creates $0 purchase for support/refunds - no Stripe session
6. **Analytics Queries**: Use SQL aggregations for performance (SUM, COUNT, GROUP BY)
7. **Security**: All endpoints require both auth AND platform owner check

**Common Pitfalls**:
- Don't forget organization scoping on ALL queries
- Always check platform owner flag before admin operations
- Use soft delete, not hard delete
- Manual grants should have $0 price and no Stripe IDs

**If Stuck**: Check [CONTEXT_MAP.md](../CONTEXT_MAP.md) or existing auth middleware.

---

**Last Updated**: 2025-11-05
