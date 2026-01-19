# Admin API Worker

Platform owner admin dashboard API providing revenue analytics, content management, and customer support operations. Exclusively for users with `platform_owner` role to oversee entire organization.

**Deployment Target**: `admin-api.revelations.studio` (production), local port 42073 (development)

**Primary Responsibility**: Admin operations - analytics, content oversight, customer support

**Status**: Active - Core Phase 1 complete

---

## Overview

Provides comprehensive admin endpoints for platform owners to:
- View revenue statistics with date range filtering and daily breakdowns
- Analyze customer metrics (unique customers, new customer rate, LTV)
- Monitor content performance (top content by revenue)
- List and manage all content across organization (publish/unpublish/delete overrides)
- View customer profiles with complete purchase history
- Grant complimentary content access for refunds and support cases

**Security Model**: All endpoints require authenticated session with `user.role = 'platform_owner'`. Organization scoping enforced via middleware to prevent cross-organization data leakage.

**Architecture**: Cloudflare Workers + Hono + procedure() pattern with @codex/admin service layer

---

## Public API

### Analytics Endpoints

#### GET /api/admin/analytics/revenue

Revenue statistics for platform owner's organization with optional date range filtering.

**Query Parameters**:
```
startDate? (ISO 8601)  - Earliest purchase date to include (optional)
endDate? (ISO 8601)    - Latest purchase date to include (optional)
```

**Constraints**:
- Date range cannot exceed 365 days (prevents DoS via large data queries)
- startDate must be <= endDate

**Authentication**: Required (platform_owner role)

**Rate Limit**: 100 req/min (standard API limit)

**Response** (200):
```json
{
  "data": {
    "totalRevenueCents": 150000,
    "totalPurchases": 42,
    "averageOrderValueCents": 3571,
    "platformFeeCents": 15000,
    "organizationFeeCents": 0,
    "creatorPayoutCents": 135000,
    "revenueByDay": [
      {
        "date": "2025-01-20",
        "revenueCents": 5000,
        "purchaseCount": 2
      },
      {
        "date": "2025-01-21",
        "revenueCents": 8500,
        "purchaseCount": 3
      }
    ]
  }
}
```

**Error Responses**:
- 401 Unauthorized - Session invalid/expired
- 403 Forbidden - User not platform_owner
- 400 Bad Request - Invalid date format or range exceeds 365 days

**Service Method**: `AdminAnalyticsService.getRevenueStats(organizationId, options)`

---

#### GET /api/admin/analytics/customers

Customer statistics for organization (total customers, new customer rate, etc).

**Query Parameters**: None

**Authentication**: Required (platform_owner role)

**Rate Limit**: 100 req/min

**Response** (200):
```json
{
  "data": {
    "totalCustomers": 156,
    "newCustomersLast30Days": 12
  }
}
```

**Definitions**:
- `totalCustomers` - Unique users with completed purchases from organization
- `newCustomersLast30Days` - Users whose FIRST purchase was within last 30 days

**Service Method**: `AdminAnalyticsService.getCustomerStats(organizationId)`

---

#### GET /api/admin/analytics/top-content

Top performing content by revenue (ranked by total purchase amount).

**Query Parameters**:
```
limit? (number)  - Number of top items to return (default: 10, max: 100)
```

**Authentication**: Required (platform_owner role)

**Rate Limit**: 100 req/min

**Response** (200):
```json
{
  "data": [
    {
      "contentId": "550e8400-e29b-41d4-a716-446655440000",
      "contentTitle": "Advanced Production Techniques",
      "revenueCents": 45000,
      "purchaseCount": 15
    },
    {
      "contentId": "660e8400-e29b-41d4-a716-446655440001",
      "contentTitle": "Mastering Color Grading",
      "revenueCents": 32000,
      "purchaseCount": 12
    }
  ]
}
```

**Ordering**: Descending by revenue (highest revenue first)

**Service Method**: `AdminAnalyticsService.getTopContent(organizationId, limit)`

---

### Content Management Endpoints

#### GET /api/admin/content

List all content in platform owner's organization with pagination and optional status filtering.

**Query Parameters**:
```
page? (number)    - Page number (default: 1, min: 1)
limit? (number)   - Items per page (default: 20, max: 100)
status? (string)  - Filter by status: "all"|"draft"|"published"|"archived" (default: "all")
```

**Authentication**: Required (platform_owner role)

**Rate Limit**: 100 req/min

**Response** (200):
```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Advanced Techniques",
      "slug": "advanced-techniques",
      "status": "published",
      "visibility": "purchased_only",
      "priceCents": 2999,
      "contentType": "video",
      "creator": {
        "id": "user-123",
        "email": "creator@example.com",
        "name": "Jane Creator"
      },
      "mediaStatus": "ready",
      "publishedAt": "2025-01-15T10:30:00Z",
      "createdAt": "2025-01-10T14:22:00Z",
      "updatedAt": "2025-01-15T10:30:00Z",
      "deletedAt": null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 156,
    "totalPages": 8
  }
}
```

**Field Descriptions**:
- `status` - Content state: "draft" (unpublished), "published" (live), "archived" (no longer visible)
- `visibility` - "public" (anyone), "private" (creator only), "members_only" (org members), "purchased_only" (requires purchase)
- `priceCents` - Null = free, >0 = purchase required
- `mediaStatus` - Video/audio transcoding pipeline state (not used for written content)

**Service Method**: `AdminContentManagementService.listAllContent(organizationId, options)`

---

#### POST /api/admin/content/:id/publish

Force publish content (admin override, bypasses media validation).

**Path Parameters**:
```
id (string, UUID)  - Content ID
```

**Request Body**: Empty

**Authentication**: Required (platform_owner role)

**Rate Limit**: 100 req/min

**Response** (200):
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Advanced Techniques",
    "status": "published",
    "publishedAt": "2025-01-22T15:45:00Z"
  }
}
```

**Idempotency**: Safe to call multiple times (returns success if already published)

**Error Responses**:
- 404 Not Found - Content doesn't exist in organization
- 422 Unprocessable Entity - Content missing required media

**Service Method**: `AdminContentManagementService.publishContent(organizationId, contentId)`

---

#### POST /api/admin/content/:id/unpublish

Unpublish content (revert from published to draft status).

**Path Parameters**:
```
id (string, UUID)  - Content ID
```

**Request Body**: Empty

**Authentication**: Required (platform_owner role)

**Rate Limit**: 100 req/min

**Response** (200):
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Advanced Techniques",
    "status": "draft"
  }
}
```

**Idempotency**: Safe to call multiple times (returns success if already draft)

**Error Responses**:
- 404 Not Found - Content doesn't exist

**Service Method**: `AdminContentManagementService.unpublishContent(organizationId, contentId)`

---

#### DELETE /api/admin/content/:id

Soft delete content (marks with deletedAt timestamp, preserves data for analytics).

**Path Parameters**:
```
id (string, UUID)  - Content ID
```

**Request Body**: Empty

**Authentication**: Required (platform_owner role)

**Rate Limit**: 100 req/min

**Response** (204): No content

**Error Responses**:
- 404 Not Found - Content doesn't exist

**Service Method**: `AdminContentManagementService.deleteContent(organizationId, contentId)`

---

### Customer Management Endpoints

#### GET /api/admin/customers

List customers who have made purchases from organization (paginated by spending).

**Query Parameters**:
```
page? (number)   - Page number (default: 1, min: 1)
limit? (number)  - Items per page (default: 20, max: 100)
```

**Authentication**: Required (platform_owner role)

**Rate Limit**: 100 req/min

**Response** (200):
```json
{
  "data": [
    {
      "userId": "user-123",
      "email": "customer@example.com",
      "name": "John Doe",
      "createdAt": "2024-12-01T08:15:00Z",
      "totalPurchases": 5,
      "totalSpentCents": 14950
    },
    {
      "userId": "user-124",
      "email": "another@example.com",
      "name": "Jane Smith",
      "createdAt": "2024-12-15T12:30:00Z",
      "totalPurchases": 2,
      "totalSpentCents": 5998
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 156,
    "totalPages": 8
  }
}
```

**Ordering**: Descending by total spent (highest spenders first)

**Definition**: "Customer" = user with at least one completed purchase

**Service Method**: `AdminCustomerManagementService.listCustomers(organizationId, options)`

---

#### GET /api/admin/customers/:id

Get customer details including full purchase history for organization.

**Path Parameters**:
```
id (string)  - Customer user ID (Better Auth format)
```

**Authentication**: Required (platform_owner role)

**Rate Limit**: 100 req/min

**Response** (200):
```json
{
  "data": {
    "userId": "user-123",
    "email": "customer@example.com",
    "name": "John Doe",
    "createdAt": "2024-12-01T08:15:00Z",
    "totalPurchases": 5,
    "totalSpentCents": 14950,
    "purchaseHistory": [
      {
        "purchaseId": "purchase-456",
        "contentId": "550e8400-e29b-41d4-a716-446655440000",
        "contentTitle": "Advanced Techniques",
        "amountPaidCents": 2999,
        "purchasedAt": "2025-01-20T14:22:00Z"
      },
      {
        "purchaseId": "purchase-457",
        "contentId": "660e8400-e29b-41d4-a716-446655440001",
        "contentTitle": "Mastering Color Grading",
        "amountPaidCents": 2999,
        "purchasedAt": "2025-01-21T09:15:00Z"
      }
    ]
  }
}
```

**Error Responses**:
- 404 Not Found - Customer doesn't exist OR has no purchases from organization

**Service Method**: `AdminCustomerManagementService.getCustomerDetails(organizationId, customerId)`

---

#### POST /api/admin/customers/:customerId/grant-access/:contentId

Grant complimentary content access (for refunds, support cases, or promotions).

**Path Parameters**:
```
customerId (string, user ID)  - Customer to grant access to
contentId (string, UUID)      - Content to grant access to
```

**Request Body**: Empty

**Authentication**: Required (platform_owner role)

**Rate Limit**: 100 req/min

**Response** (200):
```json
{
  "success": true
}
```

**Behavior**:
- Creates `contentAccess` record with `accessType='complimentary'`
- Does NOT create purchase record (revenue analytics remain accurate)
- Idempotent: safe to call multiple times (returns success if access already exists)
- Logs admin action for audit trail

**Error Responses**:
- 404 Not Found - Customer or content doesn't exist, OR customer has no relationship with organization (no purchases/membership)

**Service Method**: `AdminCustomerManagementService.grantContentAccess(organizationId, customerId, contentId)`

---

### Status Endpoint

#### GET /api/admin/status

Check admin API health and current authenticated user role (for debugging).

**Authentication**: Required (platform_owner role)

**Rate Limit**: 100 req/min

**Response** (200):
```json
{
  "status": "ok",
  "message": "Admin API is operational",
  "user": {
    "id": "user-123",
    "role": "platform_owner"
  }
}
```

**Use Case**: Debugging authentication and role verification

---

## Authentication & Authorization

### Access Control Model

All admin endpoints enforce:

1. **Session Validation**
   - Request includes `codex-session` cookie
   - Auth Worker validates session and returns user context
   - Session cached in KV (5min TTL) to reduce database queries

2. **Platform Owner Role Verification**
   - Middleware checks `user.role === 'platform_owner'`
   - Returns 403 Forbidden if role check fails

3. **Organization Scoping**
   - Middleware fetches user's primary organization membership
   - All service calls scoped to `organizationId`
   - Prevents cross-organization data leakage

**Middleware Chain** (in index.ts):
```typescript
// Rate limiting for all API endpoints
app.use('/api/*', (c, next) =>
  rateLimit({
    kv: c.env.RATE_LIMIT_KV,
    ...RATE_LIMIT_PRESETS.api, // 100 req/min per user
  })(c, next)
);

// All routes use procedure() with policy: { auth: 'platform_owner' }
procedure({
  policy: { auth: 'platform_owner' },
  input: { query: adminRevenueQuerySchema },
  handler: async (ctx) => {
    // ctx.user guaranteed platform_owner
    // ctx.organizationId set by middleware
  },
});
```

### Data Visibility Rules

Platform owner can see:
- All content in their organization (any creator)
- All purchases from their organization
- All customers who purchased from their organization
- Revenue aggregates for their organization only

Platform owner cannot see:
- Data from other organizations
- Internal admin operations (logs, audit trails)
- User passwords or sensitive credentials
- Other users' sessions

---

## Data Models

### Response Types

All responses follow standard envelope pattern from @codex/shared-types:

```typescript
// Single item response
{
  data: T
}

// Paginated response
{
  data: T[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

// Error response
{
  error: {
    code: string
    message: string
  }
  requestId: string
  timestamp: string
}
```

### Analytics Data

**RevenueStats** (from AdminAnalyticsService):
```typescript
{
  totalRevenueCents: number;          // Gross revenue from all purchases
  totalPurchases: number;             // Count of completed purchases
  averageOrderValueCents: number;     // Mean price per purchase
  platformFeeCents: number;           // Codex platform fees (10% default)
  organizationFeeCents: number;       // Organization portion of fees
  creatorPayoutCents: number;         // Amount paid to creators (90% default)
  revenueByDay: DailyRevenue[];       // Per-day breakdown for last 30 days
}
```

**DailyRevenue**:
```typescript
{
  date: string;             // ISO date "YYYY-MM-DD"
  revenueCents: number;     // Total for day
  purchaseCount: number;    // Number of purchases that day
}
```

**CustomerStats** (from AdminAnalyticsService):
```typescript
{
  totalCustomers: number;        // Unique purchasers
  newCustomersLast30Days: number; // First-time purchasers in last 30 days
}
```

**TopContentItem**:
```typescript
{
  contentId: string;
  contentTitle: string;
  revenueCents: number;       // Total revenue from purchases
  purchaseCount: number;      // Number of units sold
}
```

### Content Management Data

**AdminContentItem** (extends database Content with creator info):
```typescript
{
  id: string;
  title: string;
  slug: string;
  status: "draft" | "published" | "archived";
  visibility: "public" | "private" | "members_only" | "purchased_only";
  priceCents: number | null;
  contentType: "video" | "audio" | "written";
  organizationId: string | null;
  creator: {
    id: string;
    email: string;
    name: string | null;
  };
  mediaStatus?: "uploading" | "uploaded" | "transcoding" | "ready" | "failed";
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
```

### Customer Management Data

**CustomerWithStats**:
```typescript
{
  userId: string;              // Better Auth user ID
  email: string;
  name: string | null;
  createdAt: Date;             // User account creation date
  totalPurchases: number;      // Purchases from organization
  totalSpentCents: number;     // Total spent (cents)
}
```

**CustomerDetails** (extended with purchase history):
```typescript
{
  userId: string;
  email: string;
  name: string | null;
  createdAt: Date;
  totalPurchases: number;
  totalSpentCents: number;
  purchaseHistory: PurchaseHistoryItem[];
}
```

**PurchaseHistoryItem**:
```typescript
{
  purchaseId: string;
  contentId: string;
  contentTitle: string;
  amountPaidCents: number;
  purchasedAt: Date;
}
```

---

## Error Handling

### Standard Error Response

All errors return standardized format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  },
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-01-22T15:45:30Z"
}
```

### Error Code Reference

| HTTP Status | Code | When | Recovery |
|---|---|---|---|
| 400 | INVALID_INPUT | Query params fail validation (invalid date format, limit > 100) | Check request format |
| 401 | UNAUTHORIZED | Session invalid/expired or missing | Re-login via Auth Worker |
| 403 | FORBIDDEN | User not platform_owner role | Contact platform admin |
| 404 | NOT_FOUND | Content/customer doesn't exist or no relationship | Verify IDs |
| 409 | CONFLICT | Resource already in desired state (e.g., publish already-published) | Idempotent; safe to retry |
| 422 | UNPROCESSABLE_ENTITY | Business rule violation (e.g., publish without media) | Check resource state |
| 500 | INTERNAL_ERROR | Service error (database, R2, etc) | Retry with exponential backoff |
| 503 | SERVICE_UNAVAILABLE | Database/KV unavailable | Check infrastructure status |

### Common Errors by Endpoint

**GET /api/admin/analytics/revenue**:
- 400 - startDate > endDate, date range > 365 days
- 401 - Session invalid
- 403 - Not platform_owner

**GET /api/admin/content/:id/publish**:
- 404 - Content doesn't exist
- 422 - Video/audio without ready media
- 409 - Already published (idempotent success)

**POST /api/admin/customers/:id/grant-access/:contentId**:
- 404 - Customer doesn't exist, OR customer has no purchases from org, OR content doesn't exist
- 409 - Access already granted (idempotent success)

---

## Security Features

### Rate Limiting

All API endpoints: **100 requests/minute** per authenticated user (via @codex/security rate limiter with KV storage).

- Prevents brute-force attacks
- Prevents DoS via excessive analytics queries
- Tracked per user ID (not IP, to allow shared networks)

### Input Validation

All parameters validated with Zod schemas:

**Query Parameters**:
- `adminRevenueQuerySchema` - Date format, range validation
- `adminTopContentQuerySchema` - Limit bounds (1-100)
- `adminContentListQuerySchema` - Pagination, status enum
- `adminCustomerListQuerySchema` - Pagination

**Path Parameters**:
- `adminContentIdParamsSchema` - UUID format
- `adminCustomerIdParamsSchema` - User ID format (alphanumeric)
- `adminGrantAccessParamsSchema` - User ID + UUID format

No request bodies (all data in query/path params).

### Authorization Enforcement

1. **Session Validation**: `requireAuth: 'platform_owner'` in procedure() policy
2. **Role Check**: User.role must equal 'platform_owner'
3. **Organization Scoping**: All queries filtered by organizationId from user context
4. **Soft Delete Protection**: All queries exclude deletedAt IS NOT NULL

### Request Tracking

All requests include:
- Unique request ID (`x-request-id` header for tracing)
- User ID in logs (who made request)
- Timestamp (when executed)
- IP address (for security audits)

### PII Handling

- Passwords: Never logged or exposed
- Email addresses: Returned to admin (necessary for customer support)
- User data: Only returned for customers with org relationship
- Logs: PII redacted by observability middleware

---

## Usage Examples

### Get Revenue Stats (Last 30 Days)

```bash
curl -X GET \
  'http://localhost:42073/api/admin/analytics/revenue' \
  -H 'Cookie: codex-session=<token>'

# Response
{
  "data": {
    "totalRevenueCents": 150000,
    "totalCustomers": 42,
    "averageOrderValueCents": 3571,
    "platformFeeCents": 15000,
    "organizationFeeCents": 0,
    "creatorPayoutCents": 135000,
    "revenueByDay": [
      { "date": "2025-01-20", "revenueCents": 5000, "purchaseCount": 2 },
      { "date": "2025-01-21", "revenueCents": 8500, "purchaseCount": 3 }
    ]
  }
}
```

### Get Revenue for Date Range

```bash
curl -X GET \
  'http://localhost:42073/api/admin/analytics/revenue?startDate=2025-01-01&endDate=2025-01-31' \
  -H 'Cookie: codex-session=<token>'
```

### List All Published Content

```bash
curl -X GET \
  'http://localhost:42073/api/admin/content?status=published&limit=20' \
  -H 'Cookie: codex-session=<token>'

# Response
{
  "data": [
    {
      "id": "550e8400-...",
      "title": "Advanced Techniques",
      "status": "published",
      "creator": {
        "id": "user-456",
        "name": "Jane Creator",
        "email": "jane@example.com"
      },
      "priceCents": 2999,
      "mediaStatus": "ready",
      "publishedAt": "2025-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 156,
    "totalPages": 8
  }
}
```

### List Top Content by Revenue

```bash
curl -X GET \
  'http://localhost:42073/api/admin/analytics/top-content?limit=10' \
  -H 'Cookie: codex-session=<token>'

# Response
{
  "data": [
    {
      "contentId": "550e8400-...",
      "contentTitle": "Advanced Techniques",
      "revenueCents": 45000,
      "purchaseCount": 15
    }
  ]
}
```

### List Customers (Sorted by Spending)

```bash
curl -X GET \
  'http://localhost:42073/api/admin/customers?page=1&limit=20' \
  -H 'Cookie: codex-session=<token>'

# Response
{
  "data": [
    {
      "userId": "user-123",
      "email": "john@example.com",
      "name": "John Doe",
      "totalPurchases": 5,
      "totalSpentCents": 14950
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 156,
    "totalPages": 8
  }
}
```

### Get Customer Details with Purchase History

```bash
curl -X GET \
  'http://localhost:42073/api/admin/customers/user-123' \
  -H 'Cookie: codex-session=<token>'

# Response
{
  "data": {
    "userId": "user-123",
    "email": "john@example.com",
    "name": "John Doe",
    "totalPurchases": 5,
    "totalSpentCents": 14950,
    "purchaseHistory": [
      {
        "purchaseId": "purchase-456",
        "contentId": "550e8400-...",
        "contentTitle": "Advanced Techniques",
        "amountPaidCents": 2999,
        "purchasedAt": "2025-01-20T14:22:00Z"
      }
    ]
  }
}
```

### Grant Refund Access (Complimentary)

```bash
curl -X POST \
  'http://localhost:42073/api/admin/customers/user-123/grant-access/550e8400-...' \
  -H 'Cookie: codex-session=<token>'

# Response
{ "success": true }
```

### Publish Content (Admin Override)

```bash
curl -X POST \
  'http://localhost:42073/api/admin/content/550e8400-.../publish' \
  -H 'Cookie: codex-session=<token>'

# Response
{
  "data": {
    "id": "550e8400-...",
    "title": "Advanced Techniques",
    "status": "published",
    "publishedAt": "2025-01-22T15:45:00Z"
  }
}
```

---

## Integration Points

### With @codex/admin Services

Delegates all business logic to three admin services:

**AdminAnalyticsService**:
- `getRevenueStats(organizationId, options)` - Revenue aggregation with SQL SUM/COUNT
- `getCustomerStats(organizationId)` - Customer counting and new customer detection
- `getTopContent(organizationId, limit)` - Top content ranking by revenue

**AdminContentManagementService**:
- `listAllContent(organizationId, options)` - List with pagination and status filtering
- `publishContent(organizationId, contentId)` - Publish with media validation
- `unpublishContent(organizationId, contentId)` - Revert to draft
- `deleteContent(organizationId, contentId)` - Soft delete with timestamp

**AdminCustomerManagementService**:
- `listCustomers(organizationId, options)` - Paginated customer list
- `getCustomerDetails(organizationId, customerId)` - Full profile with history
- `grantContentAccess(organizationId, customerId, contentId)` - Grant complimentary access (idempotent)

### With @codex/security

Uses authentication and rate limiting:

```typescript
// Session validation via middleware
procedure({
  policy: { auth: 'platform_owner' },
  // Enforces requireAuth() + role verification
});

// Rate limiting
app.use('/api/*', (c, next) =>
  rateLimit({
    kv: c.env.RATE_LIMIT_KV,
    ...RATE_LIMIT_PRESETS.api, // 100 req/min
  })(c, next)
);
```

### With @codex/database

Uses HTTP client for analytics aggregation queries:

```typescript
// SQL aggregation for performance
SELECT SUM(amount_paid_cents), COUNT(*)
FROM purchases
WHERE organization_id = ? AND status = 'completed'
  AND purchased_at >= ? AND purchased_at <= ?
GROUP BY DATE(purchased_at)
```

### With @codex/validation

All parameters validated before service calls:

```typescript
procedure({
  input: { query: adminRevenueQuerySchema }, // Validates dates
  input: { query: adminContentListQuerySchema }, // Validates limit/page
  input: { params: adminGrantAccessParamsSchema }, // Validates IDs
});
```

### With @codex/worker-utils

Uses worker factory and middleware chain:

```typescript
const app = createWorker<AdminApiEnv>({
  serviceName: 'admin-api',
  version: '1.0.0',
  enableGlobalAuth: false, // Custom auth per route
  healthCheck: {
    checkDatabase: standardDatabaseCheck,
    checkKV: createKvCheck(['RATE_LIMIT_KV', 'AUTH_SESSION_KV']),
  },
});
```

---

## Architecture

### Worker Setup

**Initialization** (index.ts):
1. Create Hono app with `createWorker()` factory
2. Apply rate limiting to `/api/*` routes
3. Define routes using `procedure()` pattern
4. Each route specifies policy, validation, and handler

**Route Handler Pattern**:
```typescript
app.get('/api/admin/analytics/revenue',
  procedure({
    policy: { auth: 'platform_owner' },
    input: { query: adminRevenueQuerySchema },
    handler: async (ctx) => {
      // ctx.user - authenticated user (guaranteed platform_owner)
      // ctx.organizationId - platform owner's organization
      // ctx.input.query - validated query params
      // ctx.services.adminAnalytics - injected service
      return await ctx.services.adminAnalytics.getRevenueStats(
        ctx.organizationId,
        ctx.input.query
      );
    },
  })
);
```

**Service Injection**: Services instantiated by procedure() with database client and config.

### Error Handling

All errors caught and mapped to HTTP responses:

```typescript
// Service throws specific errors
throw new NotFoundError('Content not found', { contentId });

// procedure() catches and maps
// 404 + { error: { code: 'NOT_FOUND', message: '...' } }
```

### Middleware Chain

Applied in order:
1. Request Tracking (requestId, clientIP, userAgent)
2. Logging (structured logs)
3. CORS headers
4. Security headers (CSP, X-Frame-Options, HSTS)
5. Rate limiting (100 req/min per user)
6. Health check route (GET /health)
7. API authentication (session validation per route)

---

## Development

### Local Setup

**Prerequisites**:
```bash
# Install dependencies
pnpm install

# Set up environment
# Create .env.local in workers/admin-api with:
ENVIRONMENT=development
DATABASE_URL=postgresql://user:pass@localhost:5432/codex_dev
BETTER_AUTH_SECRET=<32+ char random string>
```

### Running Locally

**Terminal 1 - Start Auth Worker** (for session validation):
```bash
cd workers/auth
pnpm dev  # Port 42069
```

**Terminal 2 - Start Admin API Worker**:
```bash
cd workers/admin-api
pnpm dev  # Port 42073
```

### Testing Locally

**1. Login to get session token**:
```bash
curl -X POST http://localhost:42069/api/auth/email/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"Test123!@#"}' \
  -c cookies.txt
```

**2. Test admin endpoint**:
```bash
curl http://localhost:42073/api/admin/analytics/revenue \
  -b cookies.txt
```

**3. Run tests**:
```bash
pnpm test              # Run once
pnpm test:watch       # Watch mode
pnpm test:coverage    # Coverage report
```

### Test Coverage

Current tests cover:
- Health check endpoint (integration test)
- Authentication validation (401 for unauthenticated)
- 404 handling for unknown routes

Full admin functionality tests will be added in Phase 2 (detailed in design/features/admin-dashboard/ttd-dphase-1.md).

---

## Deployment

### Staging Deployment

```bash
# Build and deploy to staging
cd workers/admin-api
pnpm build
wrangler deploy --env staging

# URL: https://admin-api-staging.revelations.studio
```

### Production Deployment

```bash
# Requires: all tests pass, code review, staging verification
cd workers/admin-api
pnpm build
wrangler deploy --env production

# URL: https://admin-api.revelations.studio
```

### Environment Configuration

**wrangler.jsonc** (committed):
```
name = "admin-api"
type = "service"
main = "dist/index.js"

[env.development]
routes = [{ pattern = "admin-api.local/*" }]

[env.staging]
routes = [{ pattern = "admin-api-staging.revelations.studio/*" }]

[env.production]
routes = [{ pattern = "admin-api.revelations.studio/*" }]
```

**Secrets** (per environment via wrangler CLI):
```bash
wrangler secret put DATABASE_URL --env production
wrangler secret put BETTER_AUTH_SECRET --env production
wrangler secret put STRIPE_SECRET_KEY --env production
```

---

## Monitoring & Observability

### Health Check

All workers expose `GET /health`:

```bash
curl http://localhost:42073/health

# Response (200 or 503)
{
  "status": "healthy | degraded",
  "service": "admin-api",
  "version": "1.0.0",
  "timestamp": "2025-01-22T15:45:30Z",
  "checks": {
    "database": "healthy | unhealthy",
    "kv_rate_limit": "healthy | unhealthy"
  }
}
```

### Request Tracing

Every request includes unique ID (UUID):

```
x-request-id: 550e8400-e29b-41d4-a716-446655440000
```

Use for tracing request flow across services.

### Key Metrics to Monitor

- **Revenue Endpoint Response Time**: Should be < 1s (SQL aggregation)
- **Customer List Response Time**: Should be < 500ms (pagination helps)
- **Rate Limit Hit Rate**: High rate = suspicious activity
- **404 Error Rate**: High rate = bad client requests
- **403 Error Rate**: High rate = auth/role issues
- **Database Connection Pool**: Monitor pool exhaustion

### Error Tracking

@codex/observability logs all errors with:
- Error code and message
- Request ID for correlation
- User ID and IP address
- Full stack trace (dev only)

---

## Performance Notes

### Query Optimization

- **Revenue Stats**: SQL aggregation (SUM, COUNT) at database layer (fast)
- **Top Content**: SQL GROUP BY + ORDER BY with LIMIT (fast)
- **Customer List**: Indexed queries by organization_id + pagination (fast)
- **Customer Details**: Indexed JOIN on user_id (fast)

### Pagination

- Default limit: 20 items/page
- Maximum limit: 100 items/page
- Prevents loading large result sets

### Organization Scoping

- All WHERE clauses include `organization_id = ?`
- Database indexes on (organization_id, status) for content
- Prevents full-table scans

### Caching Opportunities

- Customer stats cache: relatively static (refresh 1-5min)
- Top content cache: changes infrequently (refresh daily)
- Revenue stats: computed on-demand (no cache needed)

---

## File Structure

```
workers/admin-api/
├── src/
│   ├── index.ts         # Main worker routes (analytics, content, customer)
│   ├── types.ts         # Admin-specific types (AdminVariables, AdminApiEnv)
│   └── index.test.ts    # Basic integration tests
├── package.json         # Dependencies (@codex/admin, security, validation, etc)
├── wrangler.jsonc       # Cloudflare Workers config
├── vite.config.ts       # Vite build config
├── tsconfig.json        # TypeScript config
└── README.md            # (Link to CLAUDE.md)
```

**Related files** (in packages/):
- `packages/admin/src/services/` - AdminAnalyticsService, AdminContentManagementService, AdminCustomerManagementService
- `packages/admin/src/types.ts` - Analytics and customer types
- `packages/validation/src/admin/admin-schemas.ts` - All validation schemas
- `packages/security/src/` - Authentication and rate limiting
- `packages/database/src/schema/` - Database tables (purchases, content, users)

---

## Troubleshooting

### Issue: "401 Unauthorized" on Admin Endpoint

**Causes**:
1. Missing session cookie
2. Expired session
3. User logged out

**Solutions**:
- Include `-b cookies.txt` in curl (or manually set Cookie header)
- Re-login to get fresh session
- Check session TTL (24 hours default)

### Issue: "403 Forbidden" on Admin Endpoint

**Cause**: User is not platform_owner role

**Solution**: Verify user.role in Auth Worker response. Only users with role='platform_owner' can access admin endpoints.

### Issue: "400 Bad Request" on Revenue Endpoint

**Causes**:
- Invalid ISO date format
- Date range > 365 days
- startDate > endDate

**Solution**: Check date format (2025-01-22T15:45:30Z) and range (max 1 year)

### Issue: "404 Not Found" on Customer Details

**Cause**: Customer has no purchases from organization OR customer doesn't exist

**Solution**:
- Verify customer has made purchase from org
- Check customer ID is correct (Better Auth format)

### Issue: Slow Revenue Query

**Cause**: Large date range or many purchases

**Solutions**:
- Use narrower date range (< 90 days)
- Check database indexes (organization_id, status)
- Monitor slow query logs

---

## Related Documentation

- **@codex/admin** - Admin service implementations (analytics, content, customer)
- **workers/auth** - Session validation and authentication
- **@codex/security** - Rate limiting, authentication
- **@codex/database** - Query patterns and schema
- **@codex/validation** - Input validation schemas
- **design/features/admin-dashboard/ttd-dphase-1.md** - Admin dashboard design

---

## Summary

The Admin API Worker provides platform owners with:
- Real-time revenue analytics with date filtering
- Customer lifetime value and new customer metrics
- Content performance tracking
- Content management overrides (publish/unpublish/delete)
- Customer support tools (view history, grant refunds)

All endpoints require platform_owner role and are scoped to organization to prevent cross-tenant data leakage. Uses SQL aggregation for efficient analytics queries and pagination for large result sets.

**Current Status**: Phase 1 complete (core endpoints). Phase 2 will add admin-specific features like content moderation, dispute handling, and revenue reports.

---

**Last Updated**: 2025-01-22
**Version**: 1.0.0
**Maintainer**: Codex Documentation Team
