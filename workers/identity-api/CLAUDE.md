# Identity API Worker - Complete Documentation

## Overview

The Identity API Worker provides RESTful endpoints for organization management in the Codex platform. It handles organization CRUD operations, slug-based lookups, availability checking, and advanced filtering with pagination. All endpoints require authentication via session tokens and enforce consistent rate limiting and input validation.

**Deployment Target**: `identity-api.revelations.studio` (production), local port 42071 (development)

**Primary Business Responsibility**: Multi-tenant organization identity management and scoping

**Key Features**:
- Full organization CRUD lifecycle (create, read, update, delete via soft deletes)
- Slug-based lookups with uniqueness guarantee
- Real-time slug availability checking (useful for frontend validation)
- Advanced listing with full-text search, sorting, and pagination
- Transaction safety for atomic multi-step operations
- Consistent error handling with domain-specific error codes

**Authentication Model**: All endpoints protected by session-based authentication (except `/health`). Session validation via `@codex/security` middleware verifies user identity before route execution.

**Rate Limiting**: Stricter limits on destructive operations (DELETE), standard API limits on read/write operations to prevent abuse.

---

## Architecture

### Request Flow Diagram

```
Request → Security Middleware Chain
   ↓
1. Request Tracking (UUID request ID, IP address, user agent)
2. Security Headers (CSP, X-Frame-Options, HSTS, etc.)
3. CORS Handling (same-origin + configured origins)
4. Global Error Handler (catches unhandled exceptions)
5. Route-level Authentication (withPolicy)
   ↓
Route Handler (createAuthenticatedHandler)
   ├─ Zod Input Validation (body, params, query)
   ├─ OrganizationService Instantiation
   └─ Service Method Call with validated input
   ↓
Business Logic Layer
   ├─ OrganizationService (extends BaseService)
   ├─ Database Query via Drizzle ORM
   └─ Error handling with custom error classes
   ↓
Response Formatting
   ├─ Success: Standardized response envelope
   ├─ Error: Sanitized error response
   └─ Status Code mapping
   ↓
HTTP Response → Client
```

### Worker Setup (index.ts)

The worker uses `createWorker()` from `@codex/worker-utils` for standardized configuration:

**Enabled Features**:
- `enableRequestTracking`: UUID request IDs for distributed tracing
- `enableLogging`: Structured logging with request context
- `enableCors`: CORS headers for authenticated requests
- `enableSecurityHeaders`: CSP, X-Frame-Options, HSTS, etc.
- `enableGlobalAuth: false`: Uses route-level `withPolicy()` instead of global middleware

**Health Checks**:
- `standardDatabaseCheck`: Validates Neon PostgreSQL connectivity
- `createKvCheck(['RATE_LIMIT_KV'])`: Validates Cloudflare KV namespace

**Middleware Chain** (applied in order):
1. **Request Tracking**: Assigns UUID `requestId`, captures IP address, user agent
2. **Error Handler**: Global catch-all for unhandled errors
3. **CORS**: Allows authenticated requests from configured origins
4. **Security Headers**: Content-Security-Policy, X-Frame-Options, Strict-Transport-Security
5. **Health Check Route**: `GET /health` returns service status
6. **Rate Limiting**: Per-endpoint KV-backed rate limiting with user ID scoping
7. **Route Handler**: Service instantiation and business logic

### Route Organization (routes/organizations.ts)

Single route file handles all organization endpoints:

**Route Structure**:
- `POST   /api/organizations`           - Create (authenticated, API rate limit)
- `GET    /api/organizations/:id`       - Get by ID (authenticated, API rate limit)
- `GET    /api/organizations/slug/:slug` - Get by slug (authenticated, API rate limit)
- `PATCH  /api/organizations/:id`       - Update (authenticated, API rate limit)
- `GET    /api/organizations`           - List with filters (authenticated, API rate limit)
- `DELETE /api/organizations/:id`       - Soft delete (authenticated, stricter rate limit)
- `GET    /api/organizations/check-slug/:slug` - Check availability (authenticated, API rate limit)

**Security Policies**:
- Most endpoints: `withPolicy(POLICY_PRESETS.authenticated())` - Standard API rate limit (100 req/min per user)
- DELETE endpoint: `withPolicy({ auth: 'required', rateLimit: 'auth' })` - Stricter rate limit (5 req/15min per user)

### Middleware Chain Details

**createWorker() Configuration**:
```typescript
const app = createWorker({
  serviceName: 'identity-api',          // Service identifier for logs
  version: '1.0.0',                      // API version
  enableRequestTracking: true,           // UUID request IDs
  enableLogging: true,                   // Structured logging
  enableCors: true,                      // CORS for authenticated requests
  enableSecurityHeaders: true,           // CSP, XFO, HSTS headers
  enableGlobalAuth: false,               // Route-level auth via withPolicy()
  healthCheck: {
    checkDatabase: standardDatabaseCheck,
    checkKV: createKvCheck(['RATE_LIMIT_KV']),
  },
});
```

**Environment Validation Middleware**:
```typescript
app.use('*', createEnvValidationMiddleware());
```
Validates required environment variables once per worker instance. Fails fast (500 error) if critical variables missing (DATABASE_URL, RATE_LIMIT_KV).

### Dependency Injection Pattern

OrganizationService instantiated per-request with dependencies:

```typescript
const service = new OrganizationService({
  db: dbHttp,                                    // Drizzle ORM HTTP client
  environment: ctx.env.ENVIRONMENT || 'development', // Deployment environment
});
```

Service instance scoped to request lifetime. New instance created per request ensures clean state and thread-safe database access.

---

## Public API Reference

### Endpoint Listing

| Method | Path | Purpose | Auth | Rate Limit | Status |
|--------|------|---------|------|-----------|--------|
| POST | `/api/organizations` | Create organization | Required | 100/min | 201 |
| GET | `/api/organizations/:id` | Get by ID | Required | 100/min | 200 |
| GET | `/api/organizations/slug/:slug` | Get by slug | Required | 100/min | 200 |
| PATCH | `/api/organizations/:id` | Update org | Required | 100/min | 200 |
| GET | `/api/organizations` | List with filters | Required | 100/min | 200 |
| DELETE | `/api/organizations/:id` | Soft delete | Required | 5/15min | 200 |
| GET | `/api/organizations/check-slug/:slug` | Check availability | Required | 100/min | 200 |
| GET | `/health` | Health check | None | None | 200/503 |

---

## Detailed Endpoint Specifications

### POST /api/organizations

**Create a new organization with unique slug validation.**

**Authentication**: Required (HTTP-only session cookie)

**Rate Limit**: API preset (100 requests/min per authenticated user)

**Request Headers**:
```
Content-Type: application/json
Cookie: codex-session=<session-token>
```

**Request Body**:
```json
{
  "name": "string (1-255 chars, required)",
  "slug": "string (1-255 chars, lowercase alphanumeric+hyphen, unique, required)",
  "description": "string (0-5000 chars, optional)",
  "logoUrl": "string (valid URL format, optional)",
  "websiteUrl": "string (valid URL format, optional)"
}
```

**Validation Rules**:
- `name`: Required, trimmed, 1-255 characters (validates non-empty after trim)
- `slug`: Required, lowercase, alphanumeric + hyphen only, globally unique, 1-255 chars
- `description`: Optional, max 5000 characters, trimmed
- `logoUrl`: Optional, validated as absolute HTTP/HTTPS URL
- `websiteUrl`: Optional, validated as absolute HTTP/HTTPS URL

**Response (201 Created)**:
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Acme Corporation",
    "slug": "acme-corp",
    "description": "Leading widget manufacturer",
    "logoUrl": "https://example.com/logo.png",
    "websiteUrl": "https://acme.example.com",
    "createdAt": "2025-01-23T10:30:00.000Z",
    "updatedAt": "2025-01-23T10:30:00.000Z",
    "deletedAt": null
  }
}
```

**Error Responses**:

| Status | Code | Message | Cause |
|--------|------|---------|-------|
| 400 | INVALID_REQUEST | Invalid JSON or missing required fields | Malformed request body |
| 400 | VALIDATION_ERROR | Field validation failed | Name/slug too long, invalid URL format |
| 401 | UNAUTHORIZED | No valid session token | Missing/expired session |
| 409 | CONFLICT | Organization slug already exists | Duplicate slug (unique constraint) |
| 422 | VALIDATION_ERROR | Business rule violation | Zod schema validation failure |
| 503 | SERVICE_UNAVAILABLE | Database unavailable | Connection pooling exhausted |

**Example Request**:
```bash
curl -X POST http://localhost:42071/api/organizations \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "name": "Acme Corp",
    "slug": "acme-corp",
    "description": "Widget manufacturer",
    "websiteUrl": "https://acme.example.com"
  }'
```

**Example Response**:
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Acme Corp",
    "slug": "acme-corp",
    "description": "Widget manufacturer",
    "logoUrl": null,
    "websiteUrl": "https://acme.example.com",
    "createdAt": "2025-01-23T10:30:00.000Z",
    "updatedAt": "2025-01-23T10:30:00.000Z",
    "deletedAt": null
  }
}
```

---

### GET /api/organizations/:id

**Retrieve organization by UUID identifier.**

**Authentication**: Required (HTTP-only session cookie)

**Rate Limit**: API preset (100 requests/min per user)

**Path Parameters**:
- `id` (UUID string): Organization ID to retrieve. Must be valid UUID v4 format.

**Response (200 OK)**:
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Acme Corporation",
    "slug": "acme-corp",
    "description": "Leading widget manufacturer",
    "logoUrl": "https://example.com/logo.png",
    "websiteUrl": "https://acme.example.com",
    "createdAt": "2025-01-23T10:30:00.000Z",
    "updatedAt": "2025-01-23T10:30:00.000Z",
    "deletedAt": null
  }
}
```

**Error Responses**:

| Status | Code | Message | Cause |
|--------|------|---------|-------|
| 400 | VALIDATION_ERROR | Invalid UUID format | Malformed path parameter |
| 401 | UNAUTHORIZED | No valid session | Missing/expired session |
| 404 | NOT_FOUND | Organization not found | ID doesn't exist or soft-deleted |
| 503 | SERVICE_UNAVAILABLE | Database unavailable | Connection issue |

**Example Request**:
```bash
curl http://localhost:42071/api/organizations/550e8400-e29b-41d4-a716-446655440000 \
  -H "Cookie: codex-session=..."
```

---

### GET /api/organizations/slug/:slug

**Retrieve organization by slug (case-insensitive).**

**Authentication**: Required (HTTP-only session cookie)

**Rate Limit**: API preset (100 requests/min per user)

**Path Parameters**:
- `slug` (string, 1-255 chars): Organization slug. Case-insensitive for lookup.

**Response (200 OK)**:
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Acme Corporation",
    "slug": "acme-corp",
    "description": "Leading widget manufacturer",
    "logoUrl": "https://example.com/logo.png",
    "websiteUrl": "https://acme.example.com",
    "createdAt": "2025-01-23T10:30:00.000Z",
    "updatedAt": "2025-01-23T10:30:00.000Z",
    "deletedAt": null
  }
}
```

**Error Responses**:

| Status | Code | Message | Cause |
|--------|------|---------|-------|
| 400 | VALIDATION_ERROR | Invalid slug format | Malformed path parameter |
| 401 | UNAUTHORIZED | No valid session | Missing/expired session |
| 404 | NOT_FOUND | Organization not found | Slug doesn't exist or soft-deleted |
| 503 | SERVICE_UNAVAILABLE | Database unavailable | Connection issue |

**Example Request**:
```bash
curl http://localhost:42071/api/organizations/slug/acme-corp \
  -H "Cookie: codex-session=..."
```

**Use Case**: Frontend widgets for organization profile pages (load by slug from URL).

---

### GET /api/organizations/check-slug/:slug

**Check if slug is available for new organization creation. Real-time validation endpoint.**

**Authentication**: Required (HTTP-only session cookie)

**Rate Limit**: API preset (100 requests/min per user)

**Path Parameters**:
- `slug` (string, 1-255 chars): Slug to check availability

**Response (200 OK)**:
```json
{
  "available": true
}
```

**Response (200 OK - Taken)**:
```json
{
  "available": false
}
```

**Error Responses**:

| Status | Code | Message | Cause |
|--------|------|---------|-------|
| 400 | VALIDATION_ERROR | Invalid slug format | Doesn't match slug pattern |
| 401 | UNAUTHORIZED | No valid session | Missing/expired session |
| 503 | SERVICE_UNAVAILABLE | Database unavailable | Connection issue |

**Example Request**:
```bash
curl http://localhost:42071/api/organizations/check-slug/my-new-org \
  -H "Cookie: codex-session=..."
```

**Response**:
```json
{
  "available": true
}
```

**Use Case**: Frontend slug input field validation (show "available" / "taken" in real-time).

---

### PATCH /api/organizations/:id

**Update organization with partial data. All fields optional.**

**Authentication**: Required (HTTP-only session cookie)

**Rate Limit**: API preset (100 requests/min per user)

**Path Parameters**:
- `id` (UUID string): Organization ID to update

**Request Body** (all fields optional):
```json
{
  "name": "string (1-255 chars, optional)",
  "slug": "string (1-255 chars, optional)",
  "description": "string (0-5000 chars, optional)",
  "logoUrl": "string (valid URL, optional)",
  "websiteUrl": "string (valid URL, optional)"
}
```

**Response (200 OK)**:
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Updated Acme",
    "slug": "updated-acme",
    "description": "Updated description",
    "logoUrl": "https://example.com/new-logo.png",
    "websiteUrl": "https://updated.acme.example.com",
    "createdAt": "2025-01-23T10:30:00.000Z",
    "updatedAt": "2025-01-23T11:45:00.000Z",
    "deletedAt": null
  }
}
```

**Error Responses**:

| Status | Code | Message | Cause |
|--------|------|---------|-------|
| 400 | VALIDATION_ERROR | Field validation failed | Name too long, invalid URL, etc. |
| 401 | UNAUTHORIZED | No valid session | Missing/expired session |
| 404 | NOT_FOUND | Organization not found | ID doesn't exist |
| 409 | CONFLICT | Slug already in use | New slug conflicts with existing org |
| 422 | VALIDATION_ERROR | Business rule violation | Zod schema failure |
| 503 | SERVICE_UNAVAILABLE | Database unavailable | Connection issue |

**Example Request**:
```bash
curl -X PATCH http://localhost:42071/api/organizations/550e8400-e29b-41d4-a716-446655440000 \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=..." \
  -d '{
    "description": "New description",
    "logoUrl": "https://example.com/new-logo.png"
  }'
```

---

### GET /api/organizations

**List organizations with full-text search, filtering, sorting, and pagination.**

**Authentication**: Required (HTTP-only session cookie)

**Rate Limit**: API preset (100 requests/min per user)

**Query Parameters**:
- `search` (string, max 255, optional): Text search in organization name and description (case-insensitive LIKE). If provided, filters results.
- `sortBy` (enum: 'createdAt' | 'name', default: 'createdAt'): Column to sort results by
- `sortOrder` (enum: 'asc' | 'desc', default: 'desc'): Sort direction
- `page` (integer, min 1, default 1): Page number (1-indexed)
- `limit` (integer, min 1, max 100, default 20): Results per page

**Response (200 OK)**:
```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Acme Corporation",
      "slug": "acme-corp",
      "description": "Leading widget manufacturer",
      "logoUrl": "https://example.com/logo.png",
      "websiteUrl": "https://acme.example.com",
      "createdAt": "2025-01-23T10:30:00.000Z",
      "updatedAt": "2025-01-23T10:30:00.000Z",
      "deletedAt": null
    },
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "name": "TechStart Inc",
      "slug": "techstart-inc",
      "description": "Early-stage tech startup",
      "logoUrl": null,
      "websiteUrl": "https://techstart.example.com",
      "createdAt": "2025-01-22T15:20:00.000Z",
      "updatedAt": "2025-01-22T15:20:00.000Z",
      "deletedAt": null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3
  }
}
```

**Error Responses**:

| Status | Code | Message | Cause |
|--------|------|---------|-------|
| 400 | VALIDATION_ERROR | Invalid query parameters | Page < 1, limit > 100, etc. |
| 401 | UNAUTHORIZED | No valid session | Missing/expired session |
| 422 | VALIDATION_ERROR | Schema validation failure | Invalid sortBy value |
| 503 | SERVICE_UNAVAILABLE | Database unavailable | Connection issue |

**Pagination Behavior**:
- `total`: Total number of organizations matching filters
- `totalPages`: Calculated as `ceil(total / limit)`
- Returns empty items array if page > totalPages
- Default 20 results per page

**Example Requests**:

Basic list (first 20, newest first):
```bash
curl "http://localhost:42071/api/organizations" \
  -H "Cookie: codex-session=..."
```

Search with pagination:
```bash
curl "http://localhost:42071/api/organizations?search=acme&page=1&limit=10&sortBy=name&sortOrder=asc" \
  -H "Cookie: codex-session=..."
```

---

### DELETE /api/organizations/:id

**Soft-delete organization by setting deletedAt timestamp. Data preserved in database.**

**Authentication**: Required (HTTP-only session cookie)

**Rate Limit**: Auth preset - stricter (5 requests/15 minutes per user) due to destructive operation

**Path Parameters**:
- `id` (UUID string): Organization ID to delete

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "Organization deleted successfully"
}
```

**Error Responses**:

| Status | Code | Message | Cause |
|--------|------|---------|-------|
| 400 | VALIDATION_ERROR | Invalid UUID format | Malformed path parameter |
| 401 | UNAUTHORIZED | No valid session | Missing/expired session |
| 404 | NOT_FOUND | Organization not found | ID doesn't exist |
| 429 | TOO_MANY_REQUESTS | Rate limit exceeded | Stricter rate limit (5/15min) |
| 503 | SERVICE_UNAVAILABLE | Database unavailable | Connection issue |

**Important Notes**:
- Soft delete: Organization record remains in database with `deletedAt` set
- Related content: Media items and content owned by org remain in database with org reference
- No cascade delete: Related data is not deleted
- Reversible: Soft-deleted orgs can theoretically be restored (future feature)

**Example Request**:
```bash
curl -X DELETE http://localhost:42071/api/organizations/550e8400-e29b-41d4-a716-446655440000 \
  -H "Cookie: codex-session=..."
```

---

### GET /health

**Health check endpoint for monitoring and load balancing. Public endpoint, no authentication required.**

**Response (200 OK - Healthy)**:
```json
{
  "service": "identity-api",
  "version": "1.0.0",
  "status": "healthy",
  "checks": {
    "database": "healthy",
    "kv": "healthy"
  },
  "timestamp": "2025-01-23T10:30:00.000Z",
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response (503 Service Unavailable - Unhealthy)**:
```json
{
  "service": "identity-api",
  "version": "1.0.0",
  "status": "unhealthy",
  "checks": {
    "database": "unhealthy",
    "kv": "healthy"
  },
  "timestamp": "2025-01-23T10:30:00.000Z",
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Check Details**:
- `database`: Neon PostgreSQL connectivity via `standardDatabaseCheck`
- `kv`: Cloudflare KV namespace (RATE_LIMIT_KV) availability

**Example Request**:
```bash
curl http://localhost:42071/health
```

---

## Core Services Integration

### OrganizationService

All business logic delegated to `@codex/identity` package's `OrganizationService` class.

**Service Instantiation** (per-request):
```typescript
const service = new OrganizationService({
  db: dbHttp,
  environment: ctx.env.ENVIRONMENT || 'development',
});
```

**Methods Used in Routes**:

| Route | Service Method | Input | Output | Errors |
|-------|---|---|---|---|
| POST / | `create()` | `CreateOrganizationInput` | `Organization` | ConflictError, ValidationError |
| GET /:id | `get()` | organization ID | `Organization \| null` | InternalServiceError |
| GET /slug/:slug | `getBySlug()` | slug | `Organization \| null` | InternalServiceError |
| PATCH /:id | `update()` | ID + `UpdateOrganizationInput` | `Organization` | OrganizationNotFoundError, ConflictError |
| DELETE /:id | `delete()` | organization ID | void | OrganizationNotFoundError |
| GET / | `list()` | filters + pagination | `PaginatedResponse<Organization>` | InternalServiceError |
| GET /check-slug/:slug | `isSlugAvailable()` | slug | boolean | InternalServiceError |

**Service Error Handling** (auto-mapped by worker):
- Service throws specific error classes from `@codex/service-errors`
- Worker catches via `mapErrorToResponse()` middleware
- Errors converted to standardized HTTP responses with appropriate status codes

---

## Usage Examples

### Complete Create Organization Workflow

```bash
# 1. Check if slug is available
curl "http://localhost:42071/api/organizations/check-slug/my-startup" \
  -H "Cookie: codex-session=$SESSION_TOKEN"
# Response: { "available": true }

# 2. Create organization
curl -X POST http://localhost:42071/api/organizations \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=$SESSION_TOKEN" \
  -d '{
    "name": "My Startup",
    "slug": "my-startup",
    "description": "A revolutionary company",
    "websiteUrl": "https://mystartup.example.com"
  }'
# Response: { "data": { "id": "uuid", ... } }

# 3. Retrieve organization by slug
curl "http://localhost:42071/api/organizations/slug/my-startup" \
  -H "Cookie: codex-session=$SESSION_TOKEN"
```

### List Organizations with Search

```bash
# Search for tech-related organizations, sorted by name
curl "http://localhost:42071/api/organizations?search=tech&sortBy=name&sortOrder=asc&limit=10" \
  -H "Cookie: codex-session=$SESSION_TOKEN"
```

### Update Organization Metadata

```bash
curl -X PATCH "http://localhost:42071/api/organizations/550e8400-e29b-41d4-a716-446655440000" \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=$SESSION_TOKEN" \
  -d '{
    "description": "Updated company description",
    "logoUrl": "https://example.com/new-logo.png"
  }'
```

### Error Handling Examples

**Handle Duplicate Slug**:
```typescript
try {
  const org = await fetch('POST /api/organizations', {
    body: { slug: 'taken-slug' }
  });
  if (org.status === 409) {
    console.error('Slug already in use. Try another.');
  }
} catch (error) {
  console.error('Network error:', error);
}
```

**Check Availability Before Submission**:
```typescript
const slug = 'my-org';
const available = await fetch(`/api/organizations/check-slug/${slug}`);
const { available: isAvailable } = await available.json();

if (!isAvailable) {
  // Suggest alternative
  suggestAlternativeSlug(slug);
}
```

---

## Integration Points

### Upstream Dependencies (What This Worker Uses)

| Package | Purpose | Usage |
|---------|---------|-------|
| **@codex/identity** | Organization service layer | `OrganizationService` class for CRUD operations |
| **@codex/database** | PostgreSQL data access | `dbHttp` client, `organizations` table schema |
| **@codex/validation** | Input validation schemas | `createOrganizationSchema`, `updateOrganizationSchema`, `organizationQuerySchema`, `uuidSchema`, `createSlugSchema` |
| **@codex/shared-types** | Response type definitions | Organization response envelopes, pagination types |
| **@codex/worker-utils** | Worker setup & middleware | `createWorker`, `createAuthenticatedHandler`, `withPolicy`, `POLICY_PRESETS` |
| **@codex/security** | Authentication & rate limiting | Session validation, rate limit KV checks (via createWorker) |
| **hono** | HTTP framework | Request routing, context management |
| **zod** | Schema validation | Runtime validation of request inputs |

### Downstream Dependents (Packages/Systems Using This Worker)

| Component | Usage | Integration Points |
|-----------|-------|---|
| **Frontend** (Codex Web App) | Organization management UI | Calls all CRUD endpoints, uses check-slug for real-time validation |
| **@codex/content** | Content scoping | Content references organizationId for multi-tenant isolation |
| **@codex/access** | Access control | Org membership verification (future) |
| **Future: @codex/users** | User-org membership | Will use org IDs for scoping user memberships |

### External Service Dependencies

| Service | Purpose | Binding |
|---------|---------|---------|
| **Neon PostgreSQL** | Organization data persistence | `DATABASE_URL` (via @codex/database HTTP client) |
| **Cloudflare KV** | Rate limit tracking | `RATE_LIMIT_KV` namespace |
| **Auth Worker** | Session validation | Implicitly used by middleware for session cookie verification |

---

## Data Models

### Organizations Table

Database: `organizations` table in Neon PostgreSQL

**Schema** (from @codex/database):

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| `id` | UUID | PRIMARY KEY, auto-generated | Unique organization identifier (v4) |
| `name` | VARCHAR(255) | NOT NULL | Display name (1-255 chars) |
| `slug` | VARCHAR(255) | NOT NULL, UNIQUE | URL-friendly identifier (1-255 chars, lowercase alphanumeric+hyphen) |
| `description` | TEXT | nullable | Optional organization description (0-5000 chars) |
| `logoUrl` | TEXT | nullable | Optional logo image URL (validated URL format) |
| `websiteUrl` | TEXT | nullable | Optional organization website (validated URL format) |
| `createdAt` | TIMESTAMP | NOT NULL, default CURRENT_TIMESTAMP | Record creation timestamp (UTC) |
| `updatedAt` | TIMESTAMP | NOT NULL, default CURRENT_TIMESTAMP | Last modification timestamp (UTC) |
| `deletedAt` | TIMESTAMP | nullable | Soft delete marker (NULL = active) |

**Indexes**:
- `idx_organizations_slug`: On `(slug)` for O(1) slug lookups
- `idx_organizations_deleted_at`: Implicit for `whereNotDeleted()` filtering

**Key Characteristics**:
- **Soft Deletes**: `deletedAt IS NULL` implies active; `deleteAt IS NOT NULL` implies deleted
- **Slug Uniqueness**: Enforced at database constraint level (includes soft-deleted records to prevent reuse)
- **Multi-Tenant Scoping**: Organizations are fundamental scoping unit (content belongs to organizations)
- **No User Scoping**: Organizations are not directly scoped by creator/user (future enhancement with memberships)

**Related Tables**:
- `content` table: Has optional `organizationId` foreign key
- `mediaItems` table: Has optional `organizationId` foreign key
- `organizationMemberships` table (future): Will link users to organizations with roles

---

## Error Handling Reference

### Error Response Format

All errors follow standardized response envelope:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "status": 400,
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": "2025-01-23T10:30:00.000Z"
  }
}
```

### Error Codes and HTTP Status Mapping

| HTTP | Code | Meaning | Recovery |
|------|------|---------|----------|
| 400 | INVALID_REQUEST | Malformed JSON or missing required fields | Check request syntax |
| 400 | VALIDATION_ERROR | Zod schema validation failed (field validation) | Fix field values, retry |
| 401 | UNAUTHORIZED | Missing/expired session token | Re-authenticate, provide valid session |
| 404 | NOT_FOUND | Organization doesn't exist or is soft-deleted | Verify ID exists |
| 409 | CONFLICT | Slug already exists (unique constraint) | Check availability, use different slug |
| 422 | VALIDATION_ERROR | Business logic violation (Zod parse failure) | Correct input values |
| 429 | TOO_MANY_REQUESTS | Rate limit exceeded | Wait before retrying |
| 500 | INTERNAL_SERVER_ERROR | Unhandled server error | Retry later, contact support |
| 503 | SERVICE_UNAVAILABLE | Database/KV unavailable | Wait for service recovery |

### Common Error Scenarios and Recovery

**Duplicate Slug (409 Conflict)**:
```typescript
try {
  const org = await service.create({ slug: 'taken-slug' });
} catch (error) {
  if (error.status === 409) {
    const available = await service.isSlugAvailable('new-slug');
    if (available) {
      const org = await service.create({ slug: 'new-slug' });
    }
  }
}
```

**Organization Not Found (404 Not Found)**:
```typescript
const org = await service.get(unknownId);
if (!org) {
  // Organization doesn't exist or is soft-deleted
  // Show 404 to user or redirect to list
}
```

**Validation Error (400 Bad Request)**:
```typescript
try {
  const org = await service.create({ name: '' }); // Too short
} catch (error) {
  if (error.status === 400) {
    // Show validation error to user with field-specific messages
    displayValidationErrors(error.details);
  }
}
```

**Rate Limited (429 Too Many Requests)**:
```typescript
const response = await fetch('/api/organizations', { method: 'DELETE' });
if (response.status === 429) {
  // Stricter rate limit (5/15min) on DELETE endpoints
  showMessage('Too many deletions. Try again in 15 minutes.');
}
```

### Service-Level Error Classes

Errors thrown by OrganizationService and mapped by worker:

| Error Class | HTTP Status | When Thrown | Handling |
|-------------|-------------|-------------|----------|
| `ConflictError` | 409 | Slug already exists on create/update | Check availability before creation |
| `OrganizationNotFoundError` | 404 | Org doesn't exist on get/update/delete | Verify ID and refresh data |
| `ValidationError` | 422 | Input fails Zod schema | Fix field values and retry |
| `InternalServiceError` | 500 | Database errors, transaction failures | Retry with exponential backoff |

---

## Security Model

### Authentication

**Mechanism**: Session-based authentication via HTTP-only cookies

**Session Validation Flow**:
1. Client includes `codex-session` cookie in request headers
2. Worker middleware calls `@codex/security` session validator
3. Session token validated against PostgreSQL (cached in KV for 5min TTL)
4. Valid session: Request proceeds with user context in `ctx.user`
5. Invalid/missing session: Returns `401 Unauthorized`

**Session Storage**:
- Primary: PostgreSQL `sessions` table (persistent storage)
- Cache: Cloudflare KV (AUTH_SESSION_KV, 5-minute TTL for performance)

**Session Expiry**:
- Default 24 hours
- Checked on every protected request
- KV cache refreshed every 5 minutes

### Authorization

**Current Model**: All authenticated users can perform all CRUD operations

**No User-Based Scoping** (currently):
- Any authenticated user can create organizations
- Any authenticated user can read/update/delete any organization
- No role-based access control (planned)

**Future Model** (planned):
- Organization membership with roles (owner, admin, creator, member)
- Content scoped to organization members
- Permissions tied to roles (e.g., only admins can delete org)

### Input Validation

All request inputs validated with Zod schemas before service execution:

**Validation Points**:
1. **Request Body**: `createOrganizationSchema`, `updateOrganizationSchema`
2. **Path Parameters**: `uuidSchema` for org IDs, `createSlugSchema()` for slugs
3. **Query Parameters**: `organizationQuerySchema` for list filters

**Security Features**:
- URL validation prevents XSS (validates HTTP/HTTPS URLs only)
- Slug validation prevents path traversal (alphanumeric + hyphen only)
- String trimming prevents leading/trailing whitespace exploits
- Length limits prevent buffer overflow/DoS

**Failed Validation Response** (400 Bad Request):
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "status": 400
  }
}
```

### Rate Limiting

**KV-Backed Rate Limiting** (Cloudflare KV `RATE_LIMIT_KV`):

| Endpoint Group | Limit | Window | Scope |
|---|---|---|---|
| Standard API (GET list, POST create, PATCH update) | 100 requests | 1 minute | Per authenticated user ID |
| Destructive (DELETE) | 5 requests | 15 minutes | Per authenticated user ID |
| Check Slug (GET availability) | 100 requests | 1 minute | Per authenticated user ID |

**Rate Limit Exceeded Response** (429 Too Many Requests):
```json
{
  "error": {
    "code": "TOO_MANY_REQUESTS",
    "message": "Rate limit exceeded",
    "status": 429,
    "retryAfter": 60
  }
}
```

**Retry Strategy**:
- Client should wait before retrying
- Check `Retry-After` header for guidance
- Stricter limits on DELETE (5/15min) encourage careful deletions

### Security Headers

Applied by `createWorker()` middleware:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevent MIME type sniffing attacks |
| `X-Frame-Options` | `SAMEORIGIN` | Clickjacking protection |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Referrer leakage prevention |
| `Strict-Transport-Security` | `max-age=31536000` | Force HTTPS (production only) |
| `Content-Security-Policy` | Varies per env | Script execution control |

### PII Handling

**What's Collected**:
- Organization metadata (name, slug, description, URLs)
- Request metadata (IP address, user agent, request ID)

**What's Not Collected**:
- User identities (authentication handled by Auth Worker)
- Email addresses (not stored in organization records)
- Credit card data (payment handled by Stripe)

**PII Protection**:
- All request/response bodies stripped from logs
- IP addresses logged but never exposed in API responses
- User IDs never included in organization responses
- Error messages sanitized (no internal details exposed)

---

## Performance Notes

### Database Query Optimization

**Slug Lookups** (O(1) via index):
```typescript
// Fast: Uses idx_organizations_slug index
const org = await service.getBySlug('acme-corp');
```

**List with Search** (O(n log n)):
```typescript
// Uses database-level LIKE search on name/description
// Results sorted and paginated in database (not in memory)
const result = await service.list({ search: 'tech' });
```

**Soft Delete Filtering**:
```typescript
// whereNotDeleted() adds simple IS NULL condition (index-friendly)
// SELECT * FROM organizations WHERE deletedAt IS NULL
```

### Pagination Optimization

**Pagination Strategy**:
- LIMIT/OFFSET approach (standard)
- Default 20 results per page (configurable 1-100)
- Total count calculated separately for page metadata

**Avoid**:
```typescript
// Bad: Loading all organizations into memory
const allOrgs = await db.query.organizations.findMany();
```

**Do**:
```typescript
// Good: Database-level pagination
const page1 = await service.list({}, { page: 1, limit: 20 });
```

### Caching Strategy

Worker does not implement caching. Optimization recommendations:

**Client-Side Caching**:
- Cache organization metadata for user's session (5-10 min)
- Refresh on user navigation or explicit refresh

**Application-Level Caching**:
```typescript
// Simple request-scoped cache
const cache = new Map<string, Organization>();

async function getCachedOrg(id: string) {
  if (cache.has(id)) return cache.get(id);
  const org = await service.get(id);
  if (org) cache.set(id, org);
  return org;
}
```

**Redis/KV Caching** (future):
- Cache frequently accessed organizations in Cloudflare KV
- 5-minute TTL for organization metadata
- Invalidate on update

### Rate Limit Performance

Rate limiting is KV-backed (distributed, low-latency):
- Increments counter on each request
- O(1) KV lookup/write operation
- No database round-trip

**Performance Impact**:
- ~5ms per request for rate limit check
- Negligible compared to database query latency

---

## Testing

### Test Structure

Tests use Vitest with Cloudflare Workers test runtime (`cloudflare:test` module):

**File**: `/src/index.test.ts`

**Test Categories**:
1. **Health Check**: Service availability and status
2. **Security**: Headers, authentication requirements
3. **Error Handling**: 404s, malformed requests, edge cases
4. **Environment**: Required bindings present

### Running Tests

**Local Test Execution**:
```bash
cd /Users/brucemckay/development/Codex/workers/identity-api

# Run once
pnpm test

# Watch mode (re-run on file change)
pnpm test:watch

# Coverage report
pnpm test:coverage

# UI dashboard
pnpm test:ui
```

### Test Database

**Note**: Tests use real Cloudflare Workers runtime but database is unavailable by design. This prevents:
- Accidental data modifications
- Test flakiness from database state

**Expected Behavior**:
- Health check returns 503 (database unavailable in test environment)
- Authentication tests check headers (don't require database session validation)
- Route tests verify middleware chain (don't test service layer)

### Writing Integration Tests

Full integration tests would require real database. Pattern:

```typescript
import { setupTestDatabase, seedTestUsers, withNeonTestBranch } from '@codex/test-utils';
import { OrganizationService } from '@codex/identity';

withNeonTestBranch();

describe('Organization Management', () => {
  let db: Database;
  let service: OrganizationService;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new OrganizationService({ db, environment: 'test' });
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('should create and retrieve organization', async () => {
    const created = await service.create({
      name: 'Test Org',
      slug: 'test-org-unique',
    });

    const retrieved = await service.get(created.id);
    expect(retrieved?.name).toBe('Test Org');
  });

  it('should reject duplicate slug', async () => {
    const slug = 'unique-slug';
    await service.create({ name: 'First', slug });

    await expect(
      service.create({ name: 'Second', slug })
    ).rejects.toThrow(ConflictError);
  });
});
```

---

## Development & Deployment

### Local Development Setup

**Prerequisites**:
```bash
cd /Users/brucemckay/development/Codex/workers/identity-api
pnpm install
```

**Environment Configuration** (create `.dev.vars`):
```
ENVIRONMENT=development
DB_METHOD=LOCAL_PROXY
WEB_APP_URL=http://localhost:3000
API_URL=http://localhost:8787
DATABASE_URL=postgresql://user:password@localhost:5432/codex_dev
```

**Start Development Server**:
```bash
pnpm dev
```

Server runs on http://localhost:42071 with:
- Hot module reloading
- Source maps for debugging
- Real KV and R2 bindings via Wrangler
- Inspector available on port 9234

### Building for Production

**Build**:
```bash
pnpm build
```

Outputs compiled JavaScript to `dist/index.js` (consumed by Wrangler).

**Type Checking**:
```bash
pnpm typecheck
```

Validates TypeScript without emitting code.

**Code Quality**:
```bash
pnpm lint      # Lint with Biome
pnpm format    # Format with Biome
pnpm test      # Run tests
```

### Deployment Process

**Staging Deployment**:
```bash
pnpm deploy:staging
```

Deploys to `identity-api-staging.revelations.studio`

**Production Deployment**:
```bash
pnpm deploy
```

Deploys to `identity-api.revelations.studio`

### Environment Configuration

**Development** (local .dev.vars):
```
ENVIRONMENT=development
DB_METHOD=LOCAL_PROXY
WEB_APP_URL=http://localhost:3000
API_URL=http://localhost:8787
```

**Staging** (wrangler.jsonc + secrets):
```
ENVIRONMENT=staging
DB_METHOD=PRODUCTION
WEB_APP_URL=https://codex-staging.revelations.studio
API_URL=https://api-staging.revelations.studio
```

**Production** (wrangler.jsonc + secrets):
```
ENVIRONMENT=production
DB_METHOD=PRODUCTION
WEB_APP_URL=https://codex.revelations.studio
API_URL=https://api.revelations.studio
```

### Secrets Management

Database URL stored as secret (not in wrangler.jsonc):

```bash
# Set DATABASE_URL for staging
wrangler secret put DATABASE_URL --env staging
# Paste: postgresql://user:password@host:port/database

# Set DATABASE_URL for production
wrangler secret put DATABASE_URL --env production
# Paste: postgresql://user:password@host:port/database
```

### Health Monitoring

**Health Endpoint**:
```bash
# Local
curl http://localhost:42071/health

# Production
curl https://identity-api.revelations.studio/health
```

**Monitoring Setup** (recommended):
- Poll `/health` every 30 seconds
- Alert if status != "healthy" or response time > 5 seconds
- Check both `database` and `kv` sub-checks
- Use request ID for tracing failures

### Rollback Strategy

**To Rollback**:
```bash
# Check deployment history
wrangler deployments list

# Rollback via dashboard or CLI
wrangler rollback --message "Rollback reason"
```

---

## File Structure

```
/Users/brucemckay/development/Codex/workers/identity-api/
├── src/
│   ├── index.ts                  # Worker setup, route mounting
│   ├── index.test.ts             # Unit tests
│   ├── routes/
│   │   └── organizations.ts      # All organization endpoints
│   ├── utils/
│   │   └── validate-env.ts       # Environment variable validation
│   └── types/
│       └── (implicit via shared-types)
│
├── dist/
│   └── index.js                  # Compiled output (generated by build)
│
├── package.json                  # Dependencies, scripts
├── wrangler.jsonc               # Cloudflare Worker config
├── wrangler-defaults.json       # Default env vars
├── tsconfig.json                # TypeScript configuration
├── vitest.config.ts             # Test configuration
├── vite.config.ts               # Build configuration
│
├── CLAUDE.md                    # This documentation
└── .env.example                 # Example environment variables
```

---

## Common Tasks

### Add New Organization Endpoint

**Step-by-Step**:

1. **Add Validation Schema** (if needed):
   ```typescript
   // In @codex/validation/src/...
   export const newActionSchema = z.object({
     // Define validation rules
   });
   ```

2. **Add Response Type** (if needed):
   ```typescript
   // In @codex/shared-types/src/...
   export interface NewActionResponse {
     data: SomeType;
   }
   ```

3. **Create Route Handler** (in `routes/organizations.ts`):
   ```typescript
   app.post(
     '/new-action',
     withPolicy(POLICY_PRESETS.authenticated()),
     createAuthenticatedHandler({
       schema: { body: newActionSchema },
       handler: async (_c, ctx): Promise<NewActionResponse> => {
         const service = new OrganizationService({
           db: dbHttp,
           environment: ctx.env.ENVIRONMENT || 'development',
         });
         const result = await service.someMethod(ctx.validated.body);
         return { data: result };
       },
     })
   );
   ```

4. **Test** (create test in `index.test.ts`):
   ```typescript
   it('should handle new action', async () => {
     const response = await SELF.fetch(
       'http://localhost/new-action',
       { method: 'POST', body: JSON.stringify({...}) }
     );
     expect(response.status).toBe(200);
   });
   ```

5. **Document** (add to Public API Reference above)

### Modify Rate Limiting

**Increase Limit for Endpoint**:
```typescript
// Change from authenticated() preset to custom
withPolicy({
  auth: 'required',
  rateLimit: 'api',  // Use api preset (100/min)
})
```

**Available Presets** (from @codex/worker-utils):
- `public` - No rate limit
- `api` - 100 req/min per user
- `auth` - 5 req/15min per user (stricter)
- `strict` - 1 req/min per user
- `webhook` - 1000 req/min (for webhook handlers)

### Adjust Pagination Defaults

**Current defaults** (in routes/organizations.ts):
- Default limit: 20 items per page
- Max limit: 100 items per page
- Minimum limit: 1 item per page

**To change**:
```typescript
// In organizationQuerySchema (from @codex/validation)
limit: z.number().int().min(1).max(100).default(20),
```

### Debug a Failed Request

1. **Check Worker Logs**:
   ```bash
   wrangler tail
   ```

2. **Identify Request ID** (in error response):
   ```json
   { "error": { "requestId": "550e8400-..." } }
   ```

3. **Search Logs by Request ID**:
   ```bash
   wrangler tail | grep "550e8400-e29b-41d4-a716-446655440000"
   ```

4. **Check Health Status**:
   ```bash
   curl http://localhost:42071/health
   ```

5. **Verify Database Connectivity**:
   ```bash
   # Test DATABASE_URL
   psql $DATABASE_URL -c "SELECT 1"
   ```

6. **Check Rate Limit State** (if 429):
   - View RATE_LIMIT_KV in Cloudflare dashboard
   - Verify user ID and request count

---

## Summary

The Identity API Worker provides production-ready organization management endpoints following Codex platform standards. All requests follow consistent middleware chain patterns, input validation, error handling, and security practices. The worker delegates all business logic to the `@codex/identity` service layer, maintaining separation of concerns between HTTP handling and domain logic.

**Key Architectural Principles**:
1. **Stateless Workers**: All state stored in PostgreSQL and KV
2. **Type Safety**: Zod schemas for validation, TypeScript for compile-time checks
3. **Consistent Error Handling**: Domain errors mapped to HTTP responses
4. **Security First**: Authentication required, rate limiting enforced, input validated
5. **Observability**: Request tracking, health checks, structured logging

**For Developers**:
- Start with usage examples above
- Refer to endpoint specs when building clients
- Follow error handling patterns for robust integrations
- Use local development setup for faster iteration

**For AI Agents**:
- All method signatures fully documented with parameter types
- All error conditions explicitly listed with recovery strategies
- Database schema and constraints precisely specified
- Integration points clearly mapped to upstream/downstream components
