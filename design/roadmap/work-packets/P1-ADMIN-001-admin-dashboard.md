# P1-ADMIN-001: Admin Dashboard

**Priority**: P1
**Status**: 🚧 Not Started
**Estimated Effort**: 4-5 days

---

## Table of Contents

- [Overview](#overview)
- [System Context](#system-context)
- [Database Schema](#database-schema)
- [Service Architecture](#service-architecture)
- [Implementation Patterns](#implementation-patterns)
- [API Integration](#api-integration)
- [Available Patterns & Utilities](#available-patterns--utilities)
- [Dependencies](#dependencies)
- [Implementation Checklist](#implementation-checklist)
- [Testing Strategy](#testing-strategy)
- [Notes](#notes)

---

## Overview

The Admin Dashboard provides platform owners with comprehensive administrative tools to monitor revenue, manage content across all creators, and provide customer support. This is a critical operational interface that enables non-technical business owners to run the platform without developer intervention.

Platform owners (users with `role = 'platform_owner'`) can view revenue analytics with time-series breakdowns, see customer statistics and purchase histories, control content publishing status across all creators, and manually grant content access for refunds or promotional purposes. Unlike content creators who only see their own content, platform owners have organization-wide visibility.

This service integrates with the content management system (P1-CONTENT-001) for content operations, the e-commerce system (P1-ECOM-001) for revenue data, and the authentication system for role-based access control. It's designed with multi-tenancy in mind from day one—all queries are scoped by `organizationId` even though Phase 1 has a single organization.

The admin dashboard fills a critical operational gap: enabling business owners to answer questions like "How much revenue did we make this month?", "Which content is performing best?", and "Can you give this customer access as a refund?" without writing SQL queries or deploying code.

---

## System Context

### Upstream Dependencies

- **Auth Worker** (`workers/auth`): Provides `requireAuth()` middleware that validates JWTs and adds user context. Also requires the new `requirePlatformOwner()` middleware to enforce `user.role === 'platform_owner'`.

- **P1-CONTENT-001** (Content Service): Provides the `content` table schema for publishing/unpublishing content and the `media_items` table for media details. Admin uses these for cross-creator content management.

- **P1-ECOM-001** (Stripe Checkout): Provides the `purchases` table for revenue analytics and the `content_access` table for manual access grants. Critical dependency—cannot calculate revenue without purchase data.

### Downstream Consumers

- **Admin Dashboard Frontend** (Future): Web UI that calls admin endpoints to display analytics charts, content management tables, and customer support tools. Expects standardized JSON responses with error codes.

- **P1-NOTIFY-001** (Email Service - Future): May use admin analytics to send weekly revenue reports or performance summaries to platform owners via email.

### External Services

- **Neon PostgreSQL**: All admin queries hit the database for real-time data. No caching in Phase 1 (acceptable for low admin traffic).

- **Cloudflare KV**: Session validation cache used by `requireAuth()` middleware (inherited from auth worker).

### Integration Flow

```
Platform Owner Web UI
    ↓ GET /api/admin/analytics/revenue (JWT with role=platform_owner)
Auth Worker Middleware
    ↓ requireAuth() → validates JWT → adds user to context
    ↓ requirePlatformOwner() → checks user.role === 'platform_owner' → 403 if not
Admin Dashboard Worker
    ↓ Create AdminAnalyticsService(db, organizationId)
    ↓ service.getRevenueStats({ startDate, endDate })
AdminAnalyticsService
    ↓ SELECT SUM(price_cents) FROM purchases WHERE organization_id = ? AND status = 'completed'
Neon PostgreSQL
    ↓ { totalRevenueCents, purchaseCount, revenueByDay: [...] }
Platform Owner Web UI
```

---

## Database Schema

The admin dashboard does **not add new tables**. It reads from existing tables established by P1-CONTENT-001 and P1-ECOM-001.

### Tables Used

#### `users` (from database schema v2.0)

**Purpose**: Platform owner role verification

```typescript
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: text('role').notNull().default('customer'), // 'platform_owner' | 'creator' | 'customer'
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

**Critical Column**:
- `role`: Enum ('platform_owner', 'creator', 'customer'). Admin middleware checks `user.role === 'platform_owner'` to authorize access.

**Queries**:
- Customer list: `SELECT * FROM users WHERE organization_id = ? ORDER BY created_at DESC`
- Customer stats: `SELECT COUNT(*) FROM users WHERE organization_id = ?`

---

#### `content` (from P1-CONTENT-001)

**Purpose**: Cross-creator content management (publish/unpublish/delete)

**Key Columns**:
- `id`: Primary key
- `title`, `slug`: Content identification
- `status`: Enum ('draft', 'published', 'archived')
- `priceCents`: Integer pricing
- `publishedAt`: Timestamp (NULL for drafts)
- `deletedAt`: Soft delete timestamp (NULL = active)
- `organizationId`: Multi-tenant scoping
- `creatorId`: Content ownership

**Queries**:
- List all content: `SELECT * FROM content WHERE organization_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?`
- Publish: `UPDATE content SET status = 'published', published_at = NOW() WHERE id = ? AND organization_id = ?`
- Unpublish: `UPDATE content SET status = 'draft' WHERE id = ? AND organization_id = ?`
- Soft delete: `UPDATE content SET deleted_at = NOW() WHERE id = ? AND organization_id = ?`

---

#### `purchases` (from P1-ECOM-001)

**Purpose**: Revenue analytics, purchase tracking

**Key Columns**:
- `id`: Primary key
- `customerId`: References `users.id`
- `contentId`: References `content.id`
- `priceCents`: Integer (ACID-compliant)
- `status`: Enum ('completed', 'pending', 'failed', 'refunded')
- `stripePaymentIntentId`: Stripe reference (NULL for manual grants)
- `stripeCheckoutSessionId`: Stripe reference (NULL for manual grants)
- `organizationId`: Multi-tenant scoping
- `createdAt`: Purchase timestamp

**Queries**:
- Total revenue: `SELECT SUM(price_cents), COUNT(*) FROM purchases WHERE organization_id = ? AND status = 'completed'`
- Daily breakdown: `SELECT DATE(created_at) AS date, SUM(price_cents), COUNT(*) FROM purchases WHERE organization_id = ? AND status = 'completed' GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30`
- Top content: `SELECT content_id, SUM(price_cents), COUNT(*) FROM purchases WHERE organization_id = ? AND status = 'completed' GROUP BY content_id ORDER BY SUM(price_cents) DESC LIMIT 10`

**Indexes Required**:
```sql
CREATE INDEX idx_purchases_org_created ON purchases(organization_id, created_at);
CREATE INDEX idx_purchases_status ON purchases(status);
CREATE INDEX idx_purchases_content ON purchases(content_id);
```

---

### Relationships

```
users 1---N purchases
  └─ Foreign key: purchases.customer_id → users.id
  └─ Business rule: Revenue analytics aggregate by customer

content 1---N purchases
  └─ Foreign key: purchases.content_id → content.id
  └─ Business rule: Top content ranked by revenue

organizations 1---N users
  └─ Foreign key: users.organization_id → organizations.id
  └─ Business rule: Platform owner sees only their organization's data
```

---

## Service Architecture

### Service Responsibilities

**AdminAnalyticsService** (extends `BaseService`):
- **Primary Responsibility**: Calculate revenue metrics, customer statistics, and content performance rankings for platform owners
- **Key Operations**:
  - `getRevenueStats({ startDate?, endDate? })`: Aggregate revenue with optional date filtering. Returns total revenue, purchase count, average order value, and daily breakdown (last 30 days).
  - `getCustomerStats()`: Count total customers, purchasing customers, and new customers in last 30 days.
  - `getTopContent(limit)`: Rank content by total revenue with purchase counts.

**AdminContentManagementService** (extends `BaseService`):
- **Primary Responsibility**: Cross-creator content lifecycle management for platform owners
- **Key Operations**:
  - `listAllContent({ page, limit, status? })`: Paginated content list with optional status filtering ('draft', 'published', 'archived', 'all').
  - `publishContent(contentId)`: Change status to 'published', set `publishedAt` timestamp.
  - `unpublishContent(contentId)`: Change status to 'draft', clear `publishedAt`.
  - `deleteContent(contentId)`: Soft delete (set `deletedAt` timestamp).

**AdminCustomerManagementService** (extends `BaseService`):
- **Primary Responsibility**: Customer support operations (view purchase history, grant manual access)
- **Key Operations**:
  - `listCustomers({ page, limit })`: Paginated customer list with aggregated purchase stats (total spent, purchase count).
  - `getCustomerDetails(customerId)`: Customer profile with complete purchase history.
  - `grantContentAccess(customerId, contentId)`: Manual access grant for refunds/support (creates $0 purchase, prevents duplicates).

---

### Key Business Rules

**Platform Owner Exclusivity**:
- ALL admin endpoints require `user.role === 'platform_owner'`
- Content creators (`role = 'creator'`) and customers (`role = 'customer'`) receive 403 Forbidden
- No exceptions—even read-only analytics require platform owner role
- Enforced by `requirePlatformOwner()` middleware on ALL admin routes

**Organization Scoping** (Critical for Multi-Tenancy):
- ALL queries MUST filter by `organizationId` from authenticated user context
- NEVER trust client-provided `organizationId` (get from JWT)
- Even in Phase 1 with single organization, scoping prevents future bugs
- Example: `WHERE organization_id = user.organizationId` on every query

**Revenue Calculation Rules**:
- Only `status = 'completed'` purchases count toward revenue
- Exclude `pending` (incomplete payment), `failed` (payment failed), `refunded` (refunded payment)
- Daily breakdown limited to last 30 days (prevents massive result sets)
- Aggregate in database using SQL `SUM()` and `GROUP BY` (not in application code)

**Soft Delete Pattern**:
- Content deletion sets `deletedAt` timestamp (never hard delete)
- Preserves referential integrity with `purchases` table (revenue history)
- Deleted content excluded from listings: `WHERE deleted_at IS NULL`
- Can be restored by setting `deletedAt = NULL`

**Manual Access Grant Rules** (Support/Refund Workflow):
- Creates $0 purchase with `status = 'completed'`
- No Stripe session IDs (manual grant, not payment)
- Validates customer and content exist in organization
- Prevents duplicate grants (409 Conflict if already has access)

---

### Error Handling Approach

**Custom Error Classes** (extend `@codex/service-errors`):

None needed—reuse existing error classes:
- `NotFoundError`: Customer not found, content not found
- `ConflictError`: Duplicate access grant
- `ForbiddenError`: Non-platform-owner attempting admin operation
- `ValidationError`: Invalid input parameters

**Error Mapping** (worker layer):
```typescript
import { mapErrorToResponse } from '@codex/service-errors';

try {
  await service.grantContentAccess(customerId, contentId);
  return c.json({ success: true });
} catch (err) {
  return mapErrorToResponse(err); // Auto-maps to HTTP status codes
}
```

**Error Recovery**:
- No retry logic needed (admin operations are user-initiated)
- Failed queries logged with `ObservabilityClient.trackError()`
- Generic error messages to client, detailed errors in logs only

---

### Transaction Boundaries

**No Transactions Required**:
- All admin operations are single-query operations (no multi-step atomicity needs)
- `publishContent()`: Single UPDATE statement
- `grantContentAccess()`: Single INSERT statement (idempotency via unique constraint)
- Revenue analytics: Read-only aggregation queries

**Future Transaction Use Case** (Not in Phase 1):
- Bulk content publish/delete operations would require `db.transaction()` for atomicity

---

## Implementation Patterns

### Pattern 1: Role-Based Middleware Composition

Platform owner access requires two-layer authorization: JWT validation + role check.

**BaseService Extension** (all admin services extend this):
```typescript
import { BaseService } from '@codex/service-errors';
import type { ServiceConfig } from '@codex/service-errors';

export class AdminAnalyticsService extends BaseService {
  constructor(config: ServiceConfig) {
    super(config); // Provides this.db, this.userId, this.environment
  }

  async getRevenueStats(organizationId: string, params: { startDate?: Date; endDate?: Date }) {
    // Business logic here...
    // this.db available from BaseService
    // organizationId from authenticated user context (NOT trusted from client)
  }
}
```

**Middleware Chain** (two-step authorization):
```typescript
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { requirePlatformOwner } from '../middleware/require-platform-owner';

const app = new Hono<AuthContext>();

// Step 1: Validate JWT, add user to context
app.use('*', requireAuth());

// Step 2: Check user.role === 'platform_owner' (403 if not)
app.use('*', requirePlatformOwner());

// All routes now guaranteed to have platform owner user
app.get('/api/admin/analytics/revenue', async (c) => {
  const user = c.get('user'); // Guaranteed: user.role === 'platform_owner'
  const organizationId = user.organizationId; // From JWT, trusted
  // ...
});
```

**requirePlatformOwner() Implementation**:
```typescript
import type { Context, Next } from 'hono';
import type { AuthContext } from './auth';

export function requirePlatformOwner() {
  return async (c: Context<AuthContext>, next: Next) => {
    const user = c.get('user');

    if (!user) {
      return c.json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      }, 401);
    }

    // Check role enum (not boolean flag)
    if (user.role !== 'platform_owner') {
      return c.json({
        error: {
          code: 'FORBIDDEN',
          message: 'Platform owner access required',
        },
      }, 403);
    }

    await next(); // User is platform owner, continue
  };
}
```

**Key Benefits**:
- Single source of truth for role: `users.role` column (no boolean flags)
- Middleware composition: `requireAuth()` → `requirePlatformOwner()` → route handler
- 403 response for non-platform-owners (clear authorization failure)
- Organization scoping automatic: `user.organizationId` from JWT

---

### Pattern 2: Database Aggregation (Not Application Code)

Revenue analytics use SQL aggregations for performance and correctness.

**❌ BAD: Application-Level Aggregation** (slow, error-prone):
```typescript
async getRevenueStats(organizationId: string) {
  // Fetch ALL purchases into memory (OOM risk for large datasets)
  const allPurchases = await this.db.query.purchases.findMany({
    where: and(
      eq(purchases.organizationId, organizationId),
      eq(purchases.status, 'completed')
    ),
  });

  // Calculate in JavaScript (slow, inefficient)
  let totalRevenueCents = 0;
  for (const purchase of allPurchases) {
    totalRevenueCents += purchase.priceCents; // Integer overflow risk at scale
  }

  const purchaseCount = allPurchases.length;
  const averageOrderValue = totalRevenueCents / purchaseCount;

  return { totalRevenueCents, purchaseCount, averageOrderValue };
}
```

**✅ GOOD: Database Aggregation** (fast, scalable):
```typescript
import { sql, eq, and, gte, lte, desc, count } from 'drizzle-orm';
import { dbHttp, purchases } from '@codex/database';

async getRevenueStats(organizationId: string, params: { startDate?: Date; endDate?: Date }) {
  const conditions = [
    eq(purchases.organizationId, organizationId),
    eq(purchases.status, 'completed'),
  ];

  if (params.startDate) {
    conditions.push(gte(purchases.createdAt, params.startDate));
  }
  if (params.endDate) {
    conditions.push(lte(purchases.createdAt, params.endDate));
  }

  // Aggregate in database (single query, fast)
  const totals = await this.db
    .select({
      totalRevenueCents: sql<number>`COALESCE(SUM(${purchases.priceCents}), 0)`,
      totalPurchases: count(purchases.id),
    })
    .from(purchases)
    .where(and(...conditions));

  const { totalRevenueCents, totalPurchases } = totals[0];
  const averageOrderValueCents = totalPurchases > 0
    ? Math.round(totalRevenueCents / totalPurchases)
    : 0;

  // Daily breakdown (GROUP BY in database)
  const revenueByDay = await this.db
    .select({
      date: sql<string>`DATE(${purchases.createdAt})`,
      revenueCents: sql<number>`SUM(${purchases.priceCents})`,
      count: count(purchases.id),
    })
    .from(purchases)
    .where(and(...conditions))
    .groupBy(sql`DATE(${purchases.createdAt})`)
    .orderBy(sql`DATE(${purchases.createdAt}) DESC`)
    .limit(30); // Last 30 days

  return {
    totalRevenueCents: Number(totalRevenueCents),
    totalPurchases: Number(totalPurchases),
    averageOrderValueCents,
    revenueByDay: revenueByDay.map(row => ({
      date: row.date,
      revenueCents: Number(row.revenueCents),
      count: Number(row.count),
    })),
  };
}
```

**Key Benefits**:
- Database aggregation: `SUM()`, `COUNT()`, `GROUP BY` in PostgreSQL (optimized, indexed)
- Single query vs thousands of objects in memory
- COALESCE handles zero-purchase case (no division by zero)
- Type-safe: Drizzle ORM `sql` template literals with type annotations

---

### Pattern 3: Idempotent Manual Access Grant

Manual access grants use unique constraints to prevent duplicates.

**Problem**: Platform owner clicks "Grant Access" button twice → duplicate purchases

**Solution**: Idempotency via database unique constraint + pre-check

```typescript
import { eq, and } from 'drizzle-orm';
import { NotFoundError, ConflictError } from '@codex/service-errors';
import { dbHttp, users, content, purchases } from '@codex/database';

async grantContentAccess(
  organizationId: string,
  customerId: string,
  contentId: string
): Promise<void> {
  // Step 1: Validate customer exists in organization
  const customer = await this.db.query.users.findFirst({
    where: and(
      eq(users.id, customerId),
      eq(users.organizationId, organizationId)
    ),
  });

  if (!customer) {
    throw new NotFoundError('Customer not found');
  }

  // Step 2: Validate content exists in organization
  const contentRecord = await this.db.query.content.findFirst({
    where: and(
      eq(content.id, contentId),
      eq(content.organizationId, organizationId)
    ),
  });

  if (!contentRecord) {
    throw new NotFoundError('Content not found');
  }

  // Step 3: Check for existing purchase (idempotency)
  const existingPurchase = await this.db.query.purchases.findFirst({
    where: and(
      eq(purchases.customerId, customerId),
      eq(purchases.contentId, contentId)
    ),
  });

  if (existingPurchase) {
    throw new ConflictError('Customer already has access to this content');
  }

  // Step 4: Create manual grant ($0 purchase, no Stripe references)
  await this.db.insert(purchases).values({
    id: crypto.randomUUID(),
    customerId,
    contentId,
    organizationId,
    priceCents: 0, // Manual grant = free
    status: 'completed',
    stripeCheckoutSessionId: null, // Not a Stripe payment
    stripePaymentIntentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Step 5: Log for audit trail
  this.obs.info('Manual content access granted', {
    customerId,
    contentId,
    grantedBy: this.userId, // Platform owner ID
  });
}
```

**Database Constraint** (prevents race conditions):
```sql
-- purchases table unique constraint
ALTER TABLE purchases
ADD CONSTRAINT unique_customer_content UNIQUE (customer_id, content_id);
```

**Key Benefits**:
- Idempotent: Duplicate clicks return 409 Conflict (safe, no duplicate grants)
- Validation: Ensures customer and content exist before grant
- Audit trail: Logs `grantedBy` (platform owner who granted access)
- No Stripe references: `stripePaymentIntentId = null` distinguishes manual grants

---

### Pattern 4: Organization-Scoped Query Helper

Create reusable helper for organization scoping to prevent bugs.

**Helper Function** (in `@codex/database`):
```typescript
import { eq, and, isNull } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

/**
 * Scope query by organizationId and exclude soft-deleted records
 *
 * @param table - Drizzle table (must have organizationId and deletedAt columns)
 * @param organizationId - Organization to scope to
 * @returns WHERE condition for organization + not deleted
 */
export function orgScopedNotDeleted<T extends PgTable>(
  table: T,
  organizationId: string
) {
  return and(
    eq(table.organizationId, organizationId),
    isNull(table.deletedAt)
  );
}
```

**Usage in Admin Services**:
```typescript
import { orgScopedNotDeleted } from '@codex/database';

async listAllContent(
  organizationId: string,
  params: { page: number; limit: number; status?: string }
) {
  const conditions = [orgScopedNotDeleted(content, organizationId)];

  if (params.status && params.status !== 'all') {
    conditions.push(eq(content.status, params.status));
  }

  const offset = (params.page - 1) * params.limit;

  const items = await this.db.query.content.findMany({
    where: and(...conditions),
    orderBy: [desc(content.createdAt)],
    limit: params.limit,
    offset,
  });

  // Get total count
  const totalResult = await this.db
    .select({ count: count(content.id) })
    .from(content)
    .where(and(...conditions));

  return {
    items,
    pagination: {
      page: params.page,
      limit: params.limit,
      total: totalResult[0]?.count || 0,
    },
  };
}
```

**Key Benefits**:
- DRY: Single function for organization scoping + soft delete filtering
- Type-safe: TypeScript ensures table has `organizationId` and `deletedAt` columns
- Bug prevention: Impossible to forget organization scoping or soft delete check

---

## Pseudocode for Key Operations

### Pseudocode: getRevenueStats()

```
FUNCTION getRevenueStats(organizationId, { startDate?, endDate? }):
  // Step 1: Build query conditions
  conditions = [
    purchases.organizationId = organizationId,
    purchases.status = 'completed'
  ]

  IF startDate is provided:
    conditions.push(purchases.createdAt >= startDate)

  IF endDate is provided:
    conditions.push(purchases.createdAt <= endDate)

  // Step 2: Aggregate total revenue and count
  totals = DATABASE_QUERY:
    SELECT
      COALESCE(SUM(price_cents), 0) AS totalRevenueCents,
      COUNT(*) AS totalPurchases
    FROM purchases
    WHERE conditions

  totalRevenueCents = totals[0].totalRevenueCents
  totalPurchases = totals[0].totalPurchases
  averageOrderValueCents = totalPurchases > 0
    ? ROUND(totalRevenueCents / totalPurchases)
    : 0

  // Step 3: Get daily breakdown (last 30 days)
  revenueByDay = DATABASE_QUERY:
    SELECT
      DATE(created_at) AS date,
      SUM(price_cents) AS revenueCents,
      COUNT(*) AS count
    FROM purchases
    WHERE conditions
    GROUP BY DATE(created_at)
    ORDER BY DATE(created_at) DESC
    LIMIT 30

  // Step 4: Return aggregated stats
  RETURN {
    totalRevenueCents,
    totalPurchases,
    averageOrderValueCents,
    revenueByDay: revenueByDay.map(row => ({
      date: row.date,
      revenueCents: row.revenueCents,
      count: row.count
    }))
  }
END FUNCTION
```

---

### Pseudocode: grantContentAccess()

```
FUNCTION grantContentAccess(organizationId, customerId, contentId):
  // Step 1: Validate customer exists in organization
  customer = DATABASE_QUERY:
    SELECT * FROM users
    WHERE id = customerId
    AND organization_id = organizationId

  IF customer is NULL:
    THROW NotFoundError('Customer not found')

  // Step 2: Validate content exists in organization
  content = DATABASE_QUERY:
    SELECT * FROM content
    WHERE id = contentId
    AND organization_id = organizationId

  IF content is NULL:
    THROW NotFoundError('Content not found')

  // Step 3: Check for existing purchase (idempotency)
  existingPurchase = DATABASE_QUERY:
    SELECT * FROM purchases
    WHERE customer_id = customerId
    AND content_id = contentId

  IF existingPurchase is NOT NULL:
    THROW ConflictError('Customer already has access to this content')

  // Step 4: Create manual grant ($0 purchase)
  DATABASE_INSERT:
    INSERT INTO purchases (
      id,
      customer_id,
      content_id,
      organization_id,
      price_cents,
      status,
      stripe_checkout_session_id,
      stripe_payment_intent_id,
      created_at,
      updated_at
    )
    VALUES (
      generate_uuid(),
      customerId,
      contentId,
      organizationId,
      0,                    -- Manual grant = free
      'completed',
      NULL,                 -- No Stripe session
      NULL,                 -- No Stripe payment intent
      NOW(),
      NOW()
    )

  // Step 5: Log for audit trail
  LOG_INFO('Manual content access granted', {
    customerId,
    contentId,
    grantedBy: platformOwnerUserId
  })

  RETURN success
END FUNCTION
```

---

### Pseudocode: listCustomers()

```
FUNCTION listCustomers(organizationId, { page, limit }):
  offset = (page - 1) * limit

  // Step 1: Get customers with aggregated purchase stats
  customers = DATABASE_QUERY:
    SELECT
      users.id,
      users.name,
      users.email,
      users.created_at,
      COALESCE(COUNT(purchases.id), 0) AS totalPurchases,
      COALESCE(SUM(purchases.price_cents), 0) AS totalSpentCents
    FROM users
    LEFT JOIN purchases ON (
      users.id = purchases.customer_id
      AND purchases.status = 'completed'
    )
    WHERE users.organization_id = organizationId
    GROUP BY users.id, users.name, users.email, users.created_at
    ORDER BY users.created_at DESC
    LIMIT limit
    OFFSET offset

  // Step 2: Get total customer count for pagination
  totalResult = DATABASE_QUERY:
    SELECT COUNT(*) AS count
    FROM users
    WHERE organization_id = organizationId

  total = totalResult[0].count

  // Step 3: Return paginated list
  RETURN {
    items: customers.map(c => ({
      id: c.id,
      name: c.name,
      email: c.email,
      createdAt: c.createdAt,
      totalPurchases: c.totalPurchases,
      totalSpentCents: c.totalSpentCents
    })),
    pagination: {
      page,
      limit,
      total
    }
  }
END FUNCTION
```

---

## API Integration

### Endpoints

| Method | Path | Purpose | Security Policy |
|--------|------|---------|-----------------|
| GET | `/api/admin/analytics/revenue` | Get revenue statistics | `requirePlatformOwner()` |
| GET | `/api/admin/analytics/customers` | Get customer statistics | `requirePlatformOwner()` |
| GET | `/api/admin/analytics/top-content` | Get top performing content | `requirePlatformOwner()` |
| GET | `/api/admin/content` | List all content (all creators) | `requirePlatformOwner()` |
| POST | `/api/admin/content/:id/publish` | Publish content | `requirePlatformOwner()` |
| POST | `/api/admin/content/:id/unpublish` | Unpublish content | `requirePlatformOwner()` |
| DELETE | `/api/admin/content/:id` | Soft delete content | `requirePlatformOwner()` |
| GET | `/api/admin/customers` | List all customers | `requirePlatformOwner()` |
| GET | `/api/admin/customers/:id` | Get customer details | `requirePlatformOwner()` |
| POST | `/api/admin/customers/:customerId/grant-access/:contentId` | Manually grant access | `requirePlatformOwner()` |

---

### Standard Pattern

All admin endpoints follow this pattern from `@codex/worker-utils`:

```typescript
import { Hono } from 'hono';
import type { AuthContext } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { requirePlatformOwner } from '../middleware/require-platform-owner';
import { mapErrorToResponse } from '@codex/service-errors';
import { AdminAnalyticsService } from '@codex/admin';

const app = new Hono<AuthContext>();

// All routes require platform owner
app.use('*', requireAuth());
app.use('*', requirePlatformOwner());

app.get('/api/admin/analytics/revenue', async (c) => {
  const user = c.get('user'); // Guaranteed platform owner

  try {
    const service = new AdminAnalyticsService({
      db: c.env.DB,
      userId: user.id,
      environment: c.env.ENVIRONMENT,
    });

    // Get query params
    const startDate = c.req.query('startDate')
      ? new Date(c.req.query('startDate')!)
      : undefined;
    const endDate = c.req.query('endDate')
      ? new Date(c.req.query('endDate')!)
      : undefined;

    const stats = await service.getRevenueStats(user.organizationId, {
      startDate,
      endDate,
    });

    return c.json({ data: stats });
  } catch (err) {
    return mapErrorToResponse(err); // Auto HTTP status codes
  }
});
```

---

### Security Policies

- **`requireAuth()`**: Validates JWT, adds user to context (inherited from auth worker)
- **`requirePlatformOwner()`**: Checks `user.role === 'platform_owner'` (NEW in this work packet)
  - 403 Forbidden for non-platform-owners
  - Must be chained AFTER `requireAuth()` (requires user context)

**Middleware Chain**:
```typescript
app.use('*', requireAuth());           // Step 1: JWT validation
app.use('*', requirePlatformOwner());  // Step 2: Role check (platform_owner only)
```

---

### Response Format

All endpoints return standardized responses from `@codex/shared-types`:

```typescript
// Success (revenue stats)
{
  "data": {
    "totalRevenueCents": 50000,
    "totalPurchases": 25,
    "averageOrderValueCents": 2000,
    "revenueByDay": [
      { "date": "2025-11-24", "revenueCents": 5000, "count": 3 },
      { "date": "2025-11-23", "revenueCents": 3000, "count": 2 }
    ]
  }
}

// Success (paginated customers)
{
  "data": {
    "items": [
      {
        "id": "uuid",
        "name": "John Doe",
        "email": "john@example.com",
        "createdAt": "2025-11-01T00:00:00Z",
        "totalPurchases": 5,
        "totalSpentCents": 10000
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100
    }
  }
}

// Error (403 Forbidden)
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Platform owner access required"
  }
}

// Error (404 Not Found)
{
  "error": {
    "code": "CUSTOMER_NOT_FOUND",
    "message": "Customer not found"
  }
}
```

---

## Available Patterns & Utilities

### Foundation Packages

#### `@codex/database`
- **Query Helpers**:
  - `scopedNotDeleted(table, userId)`: Combines creator scoping + soft delete filtering
  - `orgScope(table, organizationId)`: Filter by organization
  - `withPagination(query, page, pageSize)`: Standardized pagination

- **Aggregation Helpers**:
  - Use Drizzle ORM `sql` templates for `SUM()`, `COUNT()`, `GROUP BY`
  - Type-safe: `sql<number>\`SUM(${table.column})\`` with type annotations

- **Error Detection**:
  - `isUniqueViolation(error)`: Check for unique constraint violations (idempotency)

**When to use**: All admin services use these for database access

---

#### `@codex/service-errors`
- **BaseService**: Extend this for all admin service classes
  - Provides: `this.db`, `this.userId`, `this.environment`, `this.obs`
  - Constructor: `constructor(config: ServiceConfig)`

- **Error Classes**:
  - `NotFoundError(message)`: 404 responses (customer not found, content not found)
  - `ConflictError(message)`: 409 responses (duplicate access grant)
  - `ForbiddenError(message)`: 403 responses (non-platform-owner)

- **Error Mapping**:
  - `mapErrorToResponse(error)`: Converts service errors to HTTP responses

**When to use**: Every admin service extends BaseService, every worker catches with mapErrorToResponse

---

#### `@codex/validation`
- **Schema Pattern**:
  - Define Zod schemas for all admin inputs
  - Type inference: `type T = z.infer<typeof schema>`
  - Query param validation: `startDate`, `endDate`, `page`, `limit`

**When to use**: Define schemas for all API inputs (query params, path params)

---

#### `@codex/security`
- **Middleware**:
  - `requireAuth()`: Session validation (inherited from auth worker)
  - `requirePlatformOwner()`: NEW middleware for role check

**When to use**: Applied in worker setup, ALL admin routes require both

---

### Utility Packages

#### `@codex/worker-utils`
- **Worker Setup**:
  - `createWorker(config)`: Fully configured Hono app with middleware
  - Returns app with security headers, CORS, logging, error handling

- **Route Handlers**:
  - Use standard Hono handlers (no `createAuthenticatedHandler` wrapper for admin)
  - Middleware chain handles auth: `requireAuth()` → `requirePlatformOwner()`

**When to use**: Every worker uses createWorker()

---

#### `@codex/observability`
- **Logging**:
  - `ObservabilityClient.info(message, metadata)`: Info logs
  - `ObservabilityClient.error(message, error)`: Error logs with stack traces
  - Structured logging with request context

**When to use**: All admin services and workers for monitoring and debugging

---

## Dependencies

### Required (Blocking)

| Dependency | Status | Description |
|------------|--------|-------------|
| P1-CONTENT-001 | ✅ Complete | `content` table for publish/unpublish operations |
| P1-ECOM-001 | ❌ Not Started | `purchases` table for revenue analytics (BLOCKING) |
| Auth Worker | ✅ Available | `requireAuth()` middleware for JWT validation |

### Optional (Nice to Have)

| Dependency | Status | Description |
|------------|--------|-------------|
| P1-NOTIFY-001 | 🚧 Future | Would enable weekly revenue report emails to platform owners |

### Infrastructure Ready

- ✅ Database schema tooling (Drizzle ORM)
- ✅ Worker deployment pipeline (Cloudflare Workers)
- ✅ Auth middleware (`requireAuth()`)
- ✅ Security middleware (rate limiting, headers)

---

## Implementation Checklist

- [ ] **Middleware**
  - [ ] Create `requirePlatformOwner()` middleware in `workers/auth/src/middleware/`
  - [ ] Test 403 response for non-platform-owners
  - [ ] Test platform owner passes through

- [ ] **Admin Analytics Service**
  - [ ] Create `packages/admin/src/analytics-service.ts`
  - [ ] Implement `AdminAnalyticsService` extending `BaseService`
  - [ ] Implement `getRevenueStats()` with SQL aggregations
  - [ ] Implement `getCustomerStats()` with 30-day new customer count
  - [ ] Implement `getTopContent()` with revenue ranking
  - [ ] Add unit tests (mocked DB)

- [ ] **Admin Content Management Service**
  - [ ] Create `packages/admin/src/content-management-service.ts`
  - [ ] Implement `AdminContentManagementService` extending `BaseService`
  - [ ] Implement `listAllContent()` with pagination and status filtering
  - [ ] Implement `publishContent()` with timestamp update
  - [ ] Implement `unpublishContent()` with status revert
  - [ ] Implement `deleteContent()` with soft delete
  - [ ] Add unit tests

- [ ] **Admin Customer Management Service**
  - [ ] Create `packages/admin/src/customer-management-service.ts`
  - [ ] Implement `AdminCustomerManagementService` extending `BaseService`
  - [ ] Implement `listCustomers()` with purchase aggregation
  - [ ] Implement `getCustomerDetails()` with purchase history
  - [ ] Implement `grantContentAccess()` with idempotency
  - [ ] Add unit tests

- [ ] **API Endpoints**
  - [ ] Create admin routes in `workers/auth/src/routes/admin.ts`
  - [ ] Wire analytics endpoints
  - [ ] Wire content management endpoints
  - [ ] Wire customer management endpoints
  - [ ] Apply `requireAuth()` + `requirePlatformOwner()` middleware to all routes
  - [ ] Add integration tests

- [ ] **Database Indexes**
  - [ ] Create indexes on `purchases(organization_id, created_at)`
  - [ ] Create indexes on `purchases(status)`
  - [ ] Create indexes on `purchases(content_id)`
  - [ ] Create indexes on `content(organization_id, status)`

- [ ] **Deployment**
  - [ ] Update wrangler.jsonc with bindings
  - [ ] Test in preview environment
  - [ ] Deploy to production

---

## Testing Strategy

### Unit Tests
- **Admin Services**: Test business logic in isolation
  - Mock database with test fixtures
  - Verify SQL aggregations (revenue calculations)
  - Test error handling (NotFoundError, ConflictError)
  - Test idempotency (duplicate access grants)

### Integration Tests
- **API Endpoints**: Test full request-response cycle
  - Use `@codex/test-utils` for database setup
  - Test platform owner authentication (valid JWT with `role = 'platform_owner'`)
  - Test non-platform-owner authorization (403 responses)
  - Verify response formats match `@codex/shared-types`
  - Test error responses (404, 409, 500)

### Database Tests
- **Schema Validation**:
  - Test organization scoping (queries filtered by `organizationId`)
  - Verify soft delete behavior (`deletedAt` filtering)
  - Test unique constraint on `purchases(customer_id, content_id)` for idempotency

### E2E Scenarios
- **Revenue Analytics Flow**: Platform owner logs in → views analytics dashboard → sees revenue stats
- **Manual Access Grant Flow**: Platform owner → customer support page → grants access to refund customer → customer can stream content

### Local Development Testing
- **Tools**:
  - `pnpm test`: Run all tests
  - `pnpm --filter @codex/admin test --watch`: Watch mode for service tests
  - `pnpm dev`: Local worker development
  - PostgreSQL via Docker Compose

---

## Notes

### Architectural Decisions

**Why No Caching?**
- Phase 1 has low admin traffic (< 10 requests/minute)
- Real-time data preferred for admin operations
- Future: Add Redis caching with 5-minute TTL for analytics

**Why BaseService Extension?**
- Consistent service architecture across all packages
- Provides `this.db`, `this.userId`, `this.environment`, `this.obs`
- Error handling patterns inherited

**Why Organization Scoping in Phase 1?**
- Single organization in Phase 1, but multi-tenant ready
- Prevents bugs when Phase 2 adds multi-org support
- Security best practice: scope ALL queries by default

### Security Considerations

**Platform Owner Role Check**:
- Use `user.role === 'platform_owner'` (NOT boolean flag)
- Single source of truth: `users.role` column
- Middleware enforces on ALL admin routes (no bypass)

**Organization Scoping Critical**:
- Get `organizationId` from JWT (NEVER trust client input)
- ALL queries MUST filter by `organizationId`
- Prevents cross-organization data leaks

**No PII in Logs**:
- Log user IDs, NOT emails or names
- Log aggregate stats, NOT individual customer data
- Example: `{ userId: 'uuid', totalRevenueCents: 5000 }` ✅

### Performance Notes

**Expected Query Times** (with indexes):
- Revenue stats: ~100ms (SUM + COUNT aggregation)
- Customer list: ~100ms (JOIN with purchase aggregation)
- Content list: ~50ms (simple SELECT with pagination)
- Manual access grant: ~20ms (single INSERT)

**Indexes Required**:
```sql
CREATE INDEX idx_purchases_org_created ON purchases(organization_id, created_at);
CREATE INDEX idx_purchases_status ON purchases(status);
CREATE INDEX idx_purchases_content ON purchases(content_id);
CREATE INDEX idx_content_org_status ON content(organization_id, status);
```

### Future Enhancements

**Phase 2+**:
- Multi-organization selector in admin UI
- Fine-grained permissions (read-only admin, support agent roles)
- Audit trail table for manual access grants (`granted_by` field)
- Year-over-year revenue comparison
- Bulk content operations (publish/delete multiple items)
- Redis caching for analytics (5-minute TTL)

---

**Last Updated**: 2025-11-24
**Template Version**: 1.0
