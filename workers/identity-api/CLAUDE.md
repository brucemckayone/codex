# Identity API Worker

## Overview

Organization and identity management API served via Cloudflare Workers. Provides RESTful endpoints for creating, reading, updating, and deleting organizations with slug-based lookup, availability checking, and advanced filtering/pagination. Supports multi-tenant scoping and secure slug uniqueness validation.

Deployed to: Production (identity-api.revelations.studio), Staging (identity-api-staging.revelations.studio)

Dev Port: 42071 (local development)

## Architecture

### Request Flow

```
Request → Security Headers → CORS → Request Tracking → Route Handler
   ↓
Rate Limiting (via KV) → withPolicy() → createAuthenticatedHandler()
   ↓
Validation (Zod) → OrganizationService → Database (Drizzle ORM)
   ↓
Response Formatting → Error Handling → JSON Response
```

### Route Files

**File**: `/src/routes/organizations.ts`
- Organization management endpoints
- 7 endpoints for CRUD, slug operations, listing, availability checks
- Route-level security policies via `withPolicy()`
- Request validation with Zod schemas
- Response types from `@codex/shared-types`

### Middleware Chain (from createWorker)

1. **Security Headers**: CSP, XFO, X-Content-Type-Options added automatically
2. **CORS**: Enabled (requests from same-origin and configured origins)
3. **Request Tracking**: UUID request IDs, IP tracking, user agent logging
4. **Global Error Handler**: Catches unhandled errors, returns sanitized responses
5. **Route-level Auth**: Each route declares auth requirements via `withPolicy()`
6. **Rate Limiting**: Applied per route via KV namespace, rate limits configurable per endpoint

### Dependency Injection

OrganizationService instantiated per request with:
- `db: dbHttp` (Drizzle ORM client for Neon PostgreSQL)
- `environment: 'production' | 'staging' | 'development'` (from ENVIRONMENT var)

Service instance used for all database operations within handler scope.

## Public Endpoints

### POST /api/organizations

Create new organization.

**Authentication**: Required (session token)

**Rate Limit**: API preset (100 req/min per user)

**Request Body**:
```json
{
  "name": "string (1-255 chars, required)",
  "slug": "string (1-255 chars, lowercase alphanumeric + hyphen, unique, required)",
  "description": "string (0-5000 chars, optional)",
  "logoUrl": "string (valid URL, optional)",
  "websiteUrl": "string (valid URL, optional)"
}
```

**Response (201 Created)**:
```json
{
  "data": {
    "id": "uuid",
    "name": "My Organization",
    "slug": "my-organization",
    "description": "Organization description",
    "logoUrl": "https://example.com/logo.png",
    "websiteUrl": "https://example.com",
    "createdAt": "2025-01-23T10:30:00Z",
    "updatedAt": "2025-01-23T10:30:00Z",
    "deletedAt": null
  }
}
```

**Error Responses**:
- `400 Bad Request`: Invalid request body (name too long, invalid URL format, etc.)
- `401 Unauthorized`: No valid session token
- `409 Conflict`: Slug already exists (ConflictError)
- `422 Unprocessable Entity`: Validation failed (Zod error)
- `503 Service Unavailable`: Database error

**Example**:
```bash
curl -X POST http://localhost:42071/api/organizations \
  -H "Content-Type: application/json" \
  -H "Cookie: session=..." \
  -d '{
    "name": "Acme Corp",
    "slug": "acme-corp",
    "description": "Leading widget manufacturer",
    "websiteUrl": "https://acme.example.com"
  }'
```

---

### GET /api/organizations/check-slug/:slug

Check if slug is available for new organization creation.

**Authentication**: Required (session token)

**Rate Limit**: API preset (100 req/min per user)

**Path Parameters**:
- `slug`: Organization slug to check (1-255 chars)

**Response (200 OK)**:
```json
{
  "available": true
}
```

**Error Responses**:
- `400 Bad Request`: Invalid slug format
- `401 Unauthorized`: No valid session token

**Example**:
```bash
curl http://localhost:42071/api/organizations/check-slug/my-org \
  -H "Cookie: session=..."
```

---

### GET /api/organizations/slug/:slug

Get organization by slug.

**Authentication**: Required (session token)

**Rate Limit**: API preset (100 req/min per user)

**Path Parameters**:
- `slug`: Organization slug (1-255 chars)

**Response (200 OK)**:
```json
{
  "data": {
    "id": "uuid",
    "name": "My Organization",
    "slug": "my-organization",
    "description": "Organization description",
    "logoUrl": "https://example.com/logo.png",
    "websiteUrl": "https://example.com",
    "createdAt": "2025-01-23T10:30:00Z",
    "updatedAt": "2025-01-23T10:30:00Z",
    "deletedAt": null
  }
}
```

**Error Responses**:
- `400 Bad Request`: Invalid slug format
- `401 Unauthorized`: No valid session token
- `404 Not Found`: Organization not found or deleted

**Example**:
```bash
curl http://localhost:42071/api/organizations/slug/my-organization \
  -H "Cookie: session=..."
```

---

### GET /api/organizations/:id

Get organization by ID.

**Authentication**: Required (session token)

**Rate Limit**: API preset (100 req/min per user)

**Path Parameters**:
- `id`: Organization UUID

**Response (200 OK)**:
```json
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "My Organization",
    "slug": "my-organization",
    "description": "Organization description",
    "logoUrl": "https://example.com/logo.png",
    "websiteUrl": "https://example.com",
    "createdAt": "2025-01-23T10:30:00Z",
    "updatedAt": "2025-01-23T10:30:00Z",
    "deletedAt": null
  }
}
```

**Error Responses**:
- `400 Bad Request`: Invalid UUID format
- `401 Unauthorized`: No valid session token
- `404 Not Found`: Organization not found or deleted

**Example**:
```bash
curl http://localhost:42071/api/organizations/550e8400-e29b-41d4-a716-446655440000 \
  -H "Cookie: session=..."
```

---

### PATCH /api/organizations/:id

Update organization (partial update, all fields optional).

**Authentication**: Required (session token)

**Rate Limit**: API preset (100 req/min per user)

**Path Parameters**:
- `id`: Organization UUID

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
    "name": "Updated Organization",
    "slug": "updated-org",
    "description": "Updated description",
    "logoUrl": "https://example.com/new-logo.png",
    "websiteUrl": "https://updated.example.com",
    "createdAt": "2025-01-23T10:30:00Z",
    "updatedAt": "2025-01-23T11:45:00Z",
    "deletedAt": null
  }
}
```

**Error Responses**:
- `400 Bad Request`: Invalid request body
- `401 Unauthorized`: No valid session token
- `404 Not Found`: Organization not found or deleted
- `409 Conflict`: New slug already exists
- `422 Unprocessable Entity`: Validation failed

**Example**:
```bash
curl -X PATCH http://localhost:42071/api/organizations/550e8400-e29b-41d4-a716-446655440000 \
  -H "Content-Type: application/json" \
  -H "Cookie: session=..." \
  -d '{
    "name": "New Name",
    "description": "Updated description"
  }'
```

---

### GET /api/organizations

List organizations with filtering and pagination.

**Authentication**: Required (session token)

**Rate Limit**: API preset (100 req/min per user)

**Query Parameters**:
- `search`: Text search in name and description (optional, max 255 chars)
- `sortBy`: Sort field - `createdAt` or `name` (default: `createdAt`)
- `sortOrder`: Sort direction - `asc` or `desc` (default: `desc`)
- `page`: Page number, 1-indexed (default: 1)
- `limit`: Results per page, 1-100 (default: 20)

**Response (200 OK)**:
```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "First Organization",
      "slug": "first-org",
      "description": "Description",
      "logoUrl": "https://example.com/logo.png",
      "websiteUrl": "https://example.com",
      "createdAt": "2025-01-23T10:30:00Z",
      "updatedAt": "2025-01-23T10:30:00Z",
      "deletedAt": null
    },
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "name": "Second Organization",
      "slug": "second-org",
      "description": null,
      "logoUrl": null,
      "websiteUrl": null,
      "createdAt": "2025-01-22T15:20:00Z",
      "updatedAt": "2025-01-22T15:20:00Z",
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
- `400 Bad Request`: Invalid query parameters
- `401 Unauthorized`: No valid session token
- `422 Unprocessable Entity`: Validation failed

**Example**:
```bash
curl "http://localhost:42071/api/organizations?search=example&sortBy=name&sortOrder=asc&page=1&limit=10" \
  -H "Cookie: session=..."
```

---

### DELETE /api/organizations/:id

Soft delete organization (sets deletedAt timestamp, preserves data).

**Authentication**: Required (session token)

**Rate Limit**: Auth preset - stricter (5 req/15min per user) due to destructive operation

**Path Parameters**:
- `id`: Organization UUID

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "Organization deleted successfully"
}
```

**Error Responses**:
- `400 Bad Request`: Invalid UUID format
- `401 Unauthorized`: No valid session token
- `404 Not Found`: Organization not found or already deleted
- `429 Too Many Requests`: Rate limit exceeded (stricter limit for deletions)

**Example**:
```bash
curl -X DELETE http://localhost:42071/api/organizations/550e8400-e29b-41d4-a716-446655440000 \
  -H "Cookie: session=..."
```

---

### GET /health

Health check endpoint (public, no auth required).

**Response (200 OK when healthy, 503 when unhealthy)**:
```json
{
  "service": "identity-api",
  "version": "1.0.0",
  "status": "healthy",
  "checks": {
    "database": "healthy",
    "kv": "healthy"
  },
  "timestamp": "2025-01-23T10:30:00Z",
  "requestId": "uuid"
}
```

**Example**:
```bash
curl http://localhost:42071/health
```

---

## Security Model

### Authentication

All `/api/*` endpoints require valid session token via HTTP-only cookie or Authorization header.

Session validation performed by `@codex/security` middleware integrated in `createWorker()`.

Missing/invalid session returns `401 Unauthorized`.

### Authorization

No role-based or user-based authorization at worker level. All authenticated users can:
- Create organizations
- Read any organization
- Update any organization
- Delete any organization

Authorization enforcement is application responsibility at higher layer.

### Rate Limiting

Applied via KV namespace (`RATE_LIMIT_KV`).

**Preset Rates**:
- `authenticated()`: 100 req/min per user (standard endpoints)
- `auth`: 5 req/15min per user (destructive operations like DELETE)

Rate exceeded returns `429 Too Many Requests`.

### Input Validation

All request bodies and query parameters validated with Zod schemas:

- `createOrganizationSchema`: POST body validation
- `updateOrganizationSchema`: PATCH body validation (partial)
- `organizationQuerySchema`: GET query parameter validation
- `uuidSchema`: UUID path parameter validation
- `createSlugSchema(255)`: Slug path parameter validation

Validation errors return `400 Bad Request` with error details.

XSS prevention via sanitized string schemas:
- Strings trimmed and validated against allowlist patterns
- URLs validated as valid HTTP/HTTPS URLs
- Slug enforces lowercase alphanumeric + hyphen pattern

### Request Tracking

All requests assigned UUID `requestId` and include IP address tracking, user agent logging for observability.

### Error Sanitization

Worker catches all unhandled errors and returns sanitized `500 Internal Server Error` responses. No internal stack traces or database errors exposed to client.

## Multi-Tenant Support

Organizations table includes `deletedAt` soft-delete column. All queries exclude deleted organizations via `whereNotDeleted()` helper.

Slug uniqueness enforced at database level (UNIQUE constraint on `slug` column, including soft-deleted rows check).

When organization deleted, all content belonging to that organization remains in database with `organizationId` reference, but displays as "deleted organization" in UIs.

## Error Responses

### Standard Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "status": 400,
    "requestId": "uuid",
    "timestamp": "2025-01-23T10:30:00Z"
  }
}
```

### Error Codes and Meanings

| Code | HTTP Status | Cause | Recovery |
|------|-------------|-------|----------|
| `INVALID_REQUEST` | 400 | Malformed JSON or missing required fields | Fix request body, check syntax |
| `VALIDATION_ERROR` | 400 | Zod schema validation failed (name too long, invalid email, etc.) | Correct field values to match schema |
| `NOT_FOUND` | 404 | Organization ID/slug doesn't exist or is deleted | Verify ID exists and not deleted |
| `CONFLICT` | 409 | Slug already in use by another organization | Choose different slug, check availability first |
| `UNAUTHORIZED` | 401 | Missing or invalid session token | Authenticate and provide valid session |
| `FORBIDDEN` | 403 | User lacks permission (not used currently) | Check authorization |
| `TOO_MANY_REQUESTS` | 429 | Rate limit exceeded | Wait before retrying |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected server error | Retry later, contact support if persistent |
| `SERVICE_UNAVAILABLE` | 503 | Database or KV unavailable | Retry later |

### Common Error Examples

**Slug Conflict**:
```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "Organization slug already exists",
    "status": 409,
    "requestId": "uuid"
  }
}
```

**Validation Error (name too long)**:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Organization name must be 255 characters or less",
    "status": 400,
    "requestId": "uuid"
  }
}
```

**Not Found**:
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Organization not found",
    "status": 404,
    "requestId": "uuid"
  }
}
```

---

## Integration Points

### OrganizationService Usage

Service instantiated per request in route handlers:

```typescript
const service = new OrganizationService({
  db: dbHttp,
  environment: ctx.env.ENVIRONMENT || 'development',
});
```

Service methods called with validated input:

```typescript
// Create
const organization = await service.create(ctx.validated.body);

// Get by ID
const organization = await service.get(ctx.validated.params.id);

// Get by slug
const organization = await service.getBySlug(ctx.validated.params.slug);

// Update
const organization = await service.update(
  ctx.validated.params.id,
  ctx.validated.body
);

// Delete (soft)
await service.delete(ctx.validated.params.id);

// List with filters
const result = await service.list(filters, pagination);

// Check slug availability
const available = await service.isSlugAvailable(slug);
```

Service errors mapped to HTTP responses:

- `ConflictError` → 409 Conflict
- `OrganizationNotFoundError` → 404 Not Found
- `ValidationError` → 400 Bad Request
- Other ServiceErrors → 400/500 depending on type
- Unhandled errors → 500 Internal Server Error

### Database Integration

Uses `dbHttp` client from `@codex/database` (HTTP client for Neon PostgreSQL):

```typescript
import { dbHttp } from '@codex/database';
```

Drizzle ORM with schema from `@codex/database/schema`:

```typescript
import { organizations } from '@codex/database/schema';
```

Query helpers for common operations:

```typescript
import {
  isUniqueViolation,
  whereNotDeleted,
  withPagination,
} from '@codex/database';
```

### Type Integration

Response types from `@codex/shared-types`:

```typescript
import type {
  CheckSlugResponse,
  CreateOrganizationResponse,
  DeleteOrganizationResponse,
  OrganizationBySlugResponse,
  OrganizationListResponse,
  OrganizationResponse,
  UpdateOrganizationResponse,
} from '@codex/shared-types';
```

Request validation schemas from `@codex/validation`:

```typescript
import {
  createOrganizationSchema,
  organizationQuerySchema,
  updateOrganizationSchema,
} from '@codex/validation';
import { createSlugSchema, uuidSchema } from '@codex/validation';
```

---

## Dependencies

### Direct Package Dependencies

| Package | Purpose | Usage |
|---------|---------|-------|
| `@codex/database` | Data persistence via Drizzle ORM + Neon PostgreSQL | dbHttp client, schema, query helpers |
| `@codex/identity` | Organization service and error classes | OrganizationService, error handling |
| `@codex/validation` | Zod schemas for request validation | Input validation via schemas |
| `@codex/shared-types` | TypeScript response types | Response type definitions |
| `@codex/worker-utils` | Worker setup, middleware, utilities | createWorker, createAuthenticatedHandler, withPolicy |
| `@codex/security` | Session authentication middleware | Via createWorker |
| `hono` | Web framework for routing and middleware | HTTP routing, request/response handling |
| `zod` | Schema validation | Request validation |

### External Dependencies

| Resource | Purpose | Binding |
|----------|---------|---------|
| Neon PostgreSQL Database | Organization data storage | DATABASE_URL (via @codex/database) |
| Cloudflare KV | Rate limiting state (request counters per user) | RATE_LIMIT_KV |
| Cloudflare Analytics Engine | Request observability (optional) | Via createWorker enableLogging |

### Cloudflare Bindings (wrangler.jsonc)

```
KV_NAMESPACES:
  RATE_LIMIT_KV: cea7153364974737b16870df08f31083

ENVIRONMENT VARIABLES (vars):
  ENVIRONMENT: "production" | "staging" | "development"
  DB_METHOD: "PRODUCTION" (enables HTTP client for Neon)
  WEB_APP_URL: Frontend URL for CORS, redirects
  API_URL: API base URL for frontend requests

SECRETS (via wrangler secret put):
  DATABASE_URL: Neon PostgreSQL connection string
```

---

## Development

### Local Setup

1. Install dependencies:
```bash
cd /Users/brucemckay/development/Codex/workers/identity-api
pnpm install
```

2. Start development server on port 42071:
```bash
pnpm dev
```

Server runs with:
- Hot reloading on file changes
- Source maps for debugging
- Real KV bindings via Wrangler
- Request logging enabled
- Inspector available on port 9234 for Node.js debugging

### Testing

Run unit tests in Cloudflare Workers runtime:
```bash
pnpm test
```

Tests use `cloudflare:test` module for real runtime environment. Test database unavailable by design (no fixtures), so database tests return 503 Service Unavailable or require mocking.

UI for test exploration:
```bash
pnpm test:ui
```

### Type Checking

Generate Cloudflare types:
```bash
pnpm cf-typegen
```

Typecheck without building:
```bash
pnpm typecheck
```

### Code Quality

Format code:
```bash
pnpm format
```

Lint code:
```bash
pnpm lint
```

---

## Deployment

### Build

Build for production:
```bash
pnpm build
```

Outputs compiled JavaScript to `dist/index.js`.

### Deploy

**Staging**:
```bash
pnpm deploy:staging
```

Deploys to `identity-api-staging.revelations.studio`.

**Production**:
```bash
pnorm deploy
```

Deploys to `identity-api.revelations.studio`.

### Environment Configuration

Environment variables set via `wrangler.jsonc`:

**Development (local)**:
```
ENVIRONMENT=development
DB_METHOD=PRODUCTION (for HTTP client)
WEB_APP_URL=http://localhost:3000
API_URL=http://localhost:42071
```

**Staging**:
```
ENVIRONMENT=staging
DB_METHOD=PRODUCTION
WEB_APP_URL=https://codex-staging.revelations.studio
API_URL=https://api-staging.revelations.studio
```

**Production**:
```
ENVIRONMENT=production
DB_METHOD=PRODUCTION
WEB_APP_URL=https://codex.revelations.studio
API_URL=https://api.revelations.studio
```

### Secrets

Database URL stored as secret (not in wrangler.jsonc):

```bash
# Set for staging
wrangler secret put DATABASE_URL --env staging
# Enter: postgresql://user:password@host/database

# Set for production
wrangler secret put DATABASE_URL --env production
# Enter: postgresql://user:password@host/database
```

Database secret accessed via `env.DATABASE_URL` in code (passed to dbHttp client).

### Health Checks

Deployment health checked at `/health` endpoint:

```bash
curl https://identity-api.revelations.studio/health
```

Returns 200 OK with service status only if database and KV are reachable.

### Rollback

To rollback to previous deployment:

1. Check deployment history:
```bash
wrangler deployments list
```

2. Rollback via Cloudflare dashboard or:
```bash
wrangler rollback --message "Rollback reason"
```

### Monitoring

Logs available in Cloudflare dashboard → Workers → identity-api → Real-time logs.

Request tracking includes:
- Request ID (UUID)
- IP address
- User agent
- Method, URL, status code
- Response time
- Error details (if any)

---

## File Structure

```
/Users/brucemckay/development/Codex/workers/identity-api/
├── src/
│   ├── index.ts                 # Worker entry point, routes setup
│   ├── types/
│   │   └── index.ts             # Type re-exports from @codex/shared-types
│   └── routes/
│       └── organizations.ts     # Organization endpoints (CRUD, slug, list)
├── dist/
│   └── index.js                 # Compiled output (generated by build)
├── package.json                 # Dependencies and scripts
├── wrangler.jsonc              # Cloudflare configuration and bindings
├── tsconfig.json               # TypeScript configuration
├── vite.config.ts              # Vite build configuration
├── vitest.config.ts            # Vitest test configuration
└── README.clog                 # This file
```

---

## Common Tasks

### Add New Organization Endpoint

1. Add handler in `/src/routes/organizations.ts`:
```typescript
app.post('/new-action',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedHandler({
    schema: { /* validation */ },
    handler: async (_c, ctx) => { /* logic */ }
  })
);
```

2. Add validation schema in `@codex/validation` if needed

3. Add response type in `@codex/shared-types` if needed

4. Add test in `src/index.test.ts` or new test file

5. Run tests: `pnpm test`

### Increase Rate Limit

1. Edit endpoint's `withPolicy()` call:
```typescript
withPolicy({
  auth: 'required',
  rateLimit: 'custom', // Create custom preset
})
```

2. Or use existing POLICY_PRESETS:
- `authenticated()` - 100 req/min
- `auth` - 5 req/15min (strict)
- Custom object with `rateLimit` key

3. Rate limit stored in KV, checked per request

### Add Organization Field

1. Add column to database schema in `@codex/database/schema/content.ts`
2. Create migration
3. Update `createOrganizationSchema` and `updateOrganizationSchema` in `@codex/validation`
4. Update `Organization` type in database schema exports
5. Update response examples in this README
6. Run tests to ensure compatibility

### Debug Failed Request

1. Check worker logs: `wrangler tail`
2. Inspect request ID in error response
3. Search logs by request ID
4. Check database connection: `curl /health`
5. Check rate limit: Watch RATE_LIMIT_KV in dashboard
6. Enable debug logging: Set `DEBUG_IDENTITY=true` environment variable

---

## Notes

- All timestamps in ISO 8601 format (UTC)
- All UUIDs valid UUID v4 format
- Slug lowercase, alphanumeric + hyphen, 1-255 chars, unique
- Soft deletes preserve data integrity; use `whereNotDeleted()` in queries
- OrganizationService handles transaction safety for multi-step operations
- CORS enabled for authenticated requests from configured origins
- No user-level authorization; all authenticated users can CRUD all organizations
- Database errors wrapped in ServiceError types for consistent error handling

