# Admin API Worker

Platform admin dashboard API for platform owners. Provides revenue analytics, content management, and customer management with complete platform overview capabilities.

**Deployment Target**: `admin-api.revelations.studio` (production), local port 42072 (development)

**Primary Responsibility**: Admin operations - analytics, content oversight, customer support

**Status**: Active

---

## Overview

Provides comprehensive admin endpoints for platform owners to:
- View revenue statistics and customer analytics
- List and manage all content across the platform
- Grant refund/complimentary access for support cases
- Monitor customer purchase history
- Publish/unpublish content as admin override

**Security**: All endpoints require platform owner role verification via session validation + admin role check.

---

## Endpoints

All endpoints require:
1. Valid session (authenticated user)
2. User role = `platform_owner`
3. Organization membership (platform owner's organization)

### Analytics Endpoints

#### GET /api/admin/analytics/revenue

Revenue statistics for organization (date range optional).

**Query Parameters**:
```
startDate?: ISO 8601 date (default: 30 days ago)
endDate?: ISO 8601 date (default: today)
```

**Response** (200):
```typescript
{
  data: {
    totalRevenue: number;        // Total in cents
    totalCustomers: number;      // Unique purchasers
    averageOrderValue: number;   // Cents
    revenueByDate: Array<{
      date: string;              // YYYY-MM-DD
      revenue: number;            // Cents
      orders: number;             // Count
    }>;
    topProducts: Array<{
      id: string;
      title: string;
      revenue: number;           // Cents
      unitsSold: number;
    }>;
  }
}
```

**Errors**:
- 401 Unauthorized - Invalid session
- 403 Forbidden - Not platform owner
- 400 Bad Request - Invalid date range

---

#### GET /api/admin/analytics/customers

Customer statistics (total customers, repeat purchase rate, etc).

**Response** (200):
```typescript
{
  data: {
    totalCustomers: number;
    newCustomersThisMonth: number;
    repeatCustomers: number;      // 2+ purchases
    repeatRate: number;            // Percentage (0-100)
    averageLTV: number;            // Lifetime value in cents
    customersByCountry: Array<{
      country: string;
      count: number;
    }>;
  }
}
```

---

#### GET /api/admin/analytics/top-content

Top performing content by revenue (paginated).

**Query Parameters**:
```
limit?: number (default: 10, max: 100)
```

**Response** (200):
```typescript
{
  data: Array<{
    id: string;
    title: string;
    creator: {
      id: string;
      name: string;
      email: string;
    };
    revenue: number;           // Total in cents
    unitsSold: number;
    avgPrice: number;          // Cents
    datePublished: string;     // ISO 8601
  }>
}
```

---

### Content Management Endpoints

#### GET /api/admin/content

List all content in platform owner's organization (with status filtering).

**Query Parameters**:
```
page?: number (default: 1)
limit?: number (default: 20, max: 100)
status?: "all" | "draft" | "published" | "archived" (default: "all")
```

**Response** (200):
```typescript
{
  data: Array<{
    id: string;
    title: string;
    slug: string;
    creator: {
      id: string;
      name: string;
      email: string;
    };
    status: "draft" | "published" | "archived";
    visibility: "public" | "members_only" | "purchased_only";
    priceCents: number | null;
    contentType: "video" | "audio" | "document";
    mediaStatus: "uploading" | "uploaded" | "transcoding" | "ready" | "failed";
    createdAt: string;         // ISO 8601
    publishedAt: string | null;
    updatedAt: string;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  }
}
```

---

#### POST /api/admin/content/:id/publish

Force publish content (admin override, no media validation).

**Path Parameters**:
```
id: string (UUID)
```

**Response** (200):
```typescript
{
  data: {
    id: string;
    title: string;
    status: "published";
    publishedAt: string;       // Current timestamp
  }
}
```

**Errors**:
- 404 Not Found - Content doesn't exist
- 409 Conflict - Already published

---

#### POST /api/admin/content/:id/unpublish

Unpublish content (reverts to draft status).

**Path Parameters**:
```
id: string (UUID)
```

**Response** (200):
```typescript
{
  data: {
    id: string;
    title: string;
    status: "draft";
  }
}
```

**Errors**:
- 404 Not Found - Content doesn't exist
- 409 Conflict - Already unpublished

---

#### DELETE /api/admin/content/:id

Soft delete content (marks as deleted, doesn't remove from database).

**Path Parameters**:
```
id: string (UUID)
```

**Response** (204): No content

**Errors**:
- 404 Not Found - Content doesn't exist

---

### Customer Management Endpoints

#### GET /api/admin/customers

List customers who purchased from organization.

**Query Parameters**:
```
page?: number (default: 1)
limit?: number (default: 20, max: 100)
```

**Response** (200):
```typescript
{
  data: Array<{
    id: string;
    email: string;
    name: string;
    purchaseCount: number;
    totalSpent: number;       // Cents
    lastPurchaseAt: string;   // ISO 8601
    joinedAt: string;         // First purchase date
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  }
}
```

---

#### GET /api/admin/customers/:id

Get customer details with complete purchase history.

**Path Parameters**:
```
id: string (UUID - customer user ID)
```

**Response** (200):
```typescript
{
  data: {
    id: string;
    email: string;
    name: string;
    joinedAt: string;
    purchases: Array<{
      id: string;
      contentId: string;
      contentTitle: string;
      priceCents: number;
      purchasedAt: string;
      hasAccess: boolean;      // Check against contentAccess
    }>;
    stats: {
      totalPurchases: number;
      totalSpent: number;      // Cents
      avgOrderValue: number;   // Cents
      lastPurchaseAt: string;
    };
  }
}
```

**Errors**:
- 404 Not Found - Customer doesn't exist

---

#### POST /api/admin/customers/:customerId/grant-access/:contentId

Grant complimentary content access (for refunds, support cases).

**Path Parameters**:
```
customerId: string (UUID - customer user ID)
contentId: string (UUID)
```

**Response** (200):
```typescript
{
  success: true
}
```

**Notes**:
- Idempotent - calling multiple times is safe (no duplicates)
- Creates contentAccess record with `priceCents = 0`
- Logs admin grant in audit trail
- Does not create purchase record (marked as grant, not purchase)

**Errors**:
- 404 Not Found - Customer or content doesn't exist
- 409 Conflict - Access already granted (idempotent, still returns success)

---

### Status Endpoint

#### GET /api/admin/status

Check admin API health and current user role (debugging).

**Response** (200):
```typescript
{
  status: "ok";
  message: "Admin API is operational";
  user: {
    id: string;
    role: "platform_owner" | "creator" | "user";
  }
}
```

---

## Authentication & Authorization

### Session Validation

All requests validate session via middleware:

```
Request → Extract codex-session cookie
         → requirePlatformOwner() middleware
         → Verify user.role = 'platform_owner'
         → Fetch platform owner's organization
         → Scope all queries to organization
```

### Organization Scoping

Platform owners can only see data for their organization:

```typescript
// Middleware fetches user's primary organization
const membership = await db.query.organizationMemberships.findFirst({
  where: eq(organizationMemberships.userId, user.id),
  columns: { organizationId: true },
});

c.set('organizationId', membership.organizationId);

// All service calls scoped to organizationId
```

---

## Data Models

### Admin Analytics Response

```typescript
interface RevenueStats {
  totalRevenue: number;        // Total in cents
  totalCustomers: number;
  averageOrderValue: number;   // Cents
  revenueByDate: Array<{
    date: string;
    revenue: number;
    orders: number;
  }>;
  topProducts: Array<{
    id: string;
    title: string;
    revenue: number;           // Cents
    unitsSold: number;
  }>;
}
```

### Admin Content Response

```typescript
interface AdminContent {
  id: string;
  title: string;
  slug: string;
  creator: {
    id: string;
    name: string;
    email: string;
  };
  status: "draft" | "published" | "archived";
  visibility: "public" | "members_only" | "purchased_only";
  priceCents: number | null;
  contentType: "video" | "audio" | "document";
  mediaStatus: "uploading" | "uploaded" | "transcoding" | "ready" | "failed";
  createdAt: string;
  publishedAt: string | null;
  updatedAt: string;
}
```

---

## Error Handling

### Standard Error Response

```typescript
{
  error: {
    code: "ERROR_CODE",
    message: "Human-readable message"
  },
  requestId: "uuid",
  timestamp: "ISO 8601"
}
```

### Common Errors

| Status | Code | When |
|--------|------|------|
| 400 | INVALID_INPUT | Validation fails (bad query params, etc) |
| 401 | UNAUTHORIZED | Invalid/expired session |
| 403 | FORBIDDEN | User not platform owner or wrong org |
| 404 | NOT_FOUND | Resource doesn't exist |
| 409 | CONFLICT | Resource already in desired state |
| 500 | INTERNAL_ERROR | Database or service error |
| 503 | SERVICE_UNAVAILABLE | Database/KV unavailable |

---

## Security Features

### Rate Limiting

All API endpoints: **100 requests/minute** per user (via @codex/security rate limiter)

### Input Validation

All parameters validated with Zod schemas:
- Query parameters (`adminRevenueQuerySchema`, `adminContentListQuerySchema`, etc)
- Path parameters (UUID format)
- No request bodies (all data in query/path params)

### Authorization Checks

1. Session validation → requirePlatformOwner() middleware
2. Organization membership verification
3. Role-based access (platform_owner only)
4. Multi-tenancy enforcement (all queries scoped to user's organization)

### Request Tracking

All requests include:
- Unique request ID (`x-request-id` header)
- User ID in logs
- Timestamp
- IP address (for security audits)

---

## Usage Examples

### Get Revenue Stats (Last 30 Days)

```bash
curl -X GET \
  'http://localhost:42072/api/admin/analytics/revenue' \
  -H 'Cookie: codex-session=<session-token>'

# Response
{
  "data": {
    "totalRevenue": 150000,      # $1500.00
    "totalCustomers": 42,
    "averageOrderValue": 3571,   # $35.71
    "revenueByDate": [
      { "date": "2025-01-20", "revenue": 5000, "orders": 2 },
      { "date": "2025-01-21", "revenue": 8500, "orders": 3 },
      ...
    ],
    "topProducts": [
      {
        "id": "content-123",
        "title": "Advanced Techniques",
        "revenue": 45000,
        "unitsSold": 15
      },
      ...
    ]
  }
}
```

### List All Content (Published Only)

```bash
curl -X GET \
  'http://localhost:42072/api/admin/content?status=published&limit=20' \
  -H 'Cookie: codex-session=<session-token>'

# Response
{
  "data": [
    {
      "id": "content-123",
      "title": "Advanced Techniques",
      "status": "published",
      "creator": {
        "id": "user-456",
        "name": "John Creator",
        "email": "john@example.com"
      },
      "priceCents": 2999,
      "mediaStatus": "ready",
      "publishedAt": "2025-01-15T10:30:00Z",
      ...
    },
    ...
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 156,
    "pages": 8
  }
}
```

### Grant Refund Access

```bash
curl -X POST \
  'http://localhost:42072/api/admin/customers/user-789/grant-access/content-123' \
  -H 'Cookie: codex-session=<session-token>'

# Response
{ "success": true }
```

---

## Integration

### With @codex/admin Package

Delegates to admin-specific services:
- `AdminAnalyticsService` - Revenue, customer, content analytics
- `AdminContentManagementService` - Content publish/unpublish/delete
- `AdminCustomerManagementService` - Customer lookup, access grants

### With @codex/database

Uses HTTP database client (`createDbClient`) for:
- Revenue aggregation queries
- Content listing with filters
- Customer purchase history

### With @codex/security

Uses `requirePlatformOwner()` middleware for:
- Session validation
- Platform owner role verification
- KV-backed session caching

---

## Development

### Local Setup

```bash
# Terminal
cd workers/admin-api
pnpm dev  # Starts on http://localhost:42072

# In another terminal, start auth worker for sessions
cd workers/auth
pnpm dev  # Starts on http://localhost:42069
```

### Test Endpoints

```bash
# 1. Login to get session
curl -X POST http://localhost:42069/api/auth/email/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"Test123!@#"}' \
  -c cookies.txt

# 2. Get revenue stats
curl http://localhost:42072/api/admin/analytics/revenue \
  -b cookies.txt

# 3. List content
curl 'http://localhost:42072/api/admin/content?status=all' \
  -b cookies.txt

# 4. Grant refund access
curl -X POST \
  'http://localhost:42072/api/admin/customers/user-id/grant-access/content-id' \
  -b cookies.txt
```

### Testing

```bash
# Run tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage
```

---

## Deployment

### Staging

```bash
pnpm deploy:staging
# Deploys to admin-api-staging.revelations.studio
```

### Production

```bash
pnpm deploy:production
# Deploys to admin-api.revelations.studio
# Requires: all tests pass, PR approval, staging verification
```

---

## Performance Considerations

### Query Optimization

- Revenue queries use database aggregation (not in-app)
- Pagination limits prevent large result sets (max 100 per page)
- Organization scoping prevents cross-org data leakage
- Indexes on (organizationId, status) for fast content filtering

### Caching Opportunities

- Customer stats are relatively static (cache 1-5 minutes)
- Top content changes infrequently (cache daily)
- Revenue stats can be computed once per day

### Rate Limiting

- 100 req/min per user keeps system stable
- Burst queries (large date ranges) stay within limits
- Prevents DOS via excessive admin requests

---

## Monitoring

### Health Check

```bash
curl http://localhost:42072/health
# Returns service health + database/KV status
```

### Key Metrics to Monitor

- Revenue endpoint response time (should be < 1s)
- Admin dashboard page load time
- Rate limit hit rate (high = suspicious activity)
- Customer search response time (pagination helps)

---

## Related Documentation

- **@codex/admin** - Admin service implementations
- **workers/auth** - Session validation
- **@codex/security** - Rate limiting, authorization
- **@codex/database** - Query patterns
- **@codex/validation** - Input schemas

---

**Last Updated**: 2025-01-22
**Version**: 1.0.0
