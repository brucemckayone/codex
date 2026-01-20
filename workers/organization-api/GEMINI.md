# Organization-API Worker

RESTful API for organization management and settings configuration. Provides endpoints for organization CRUD operations, slug-based lookups, and multi-tenant settings management (branding, contact info, feature toggles).

**Deployment Target**: `organization-api.revelations.studio` (production), local port 42071 (development)

**Primary Responsibility**: Organization lifecycle management + organization platform settings

**Status**: Active

---

## Overview

Organization-API handles two distinct API domains:

1. **Organization Management** - Create, read, update, delete organizations with slug validation and multi-tenant scoping
2. **Organization Settings** - Branding (logo, color), contact information, feature toggles

All endpoints require session authentication. Settings endpoints require organization management permission (user must be organization member).

**Architecture Pattern**: Cloudflare Worker using Hono framework, decorated route handlers with `procedure()`, dependency injection of services via context.

---

## Public API

### Organization Endpoints

#### POST /api/organizations

Create new organization.

**Authentication**: Required (authenticated user)

**Rate Limit**: 100 req/min (standard API tier)

**Request Body**:
```typescript
{
  name: string;                 // 1-255 characters, required
  slug: string;                 // Lowercase alphanumeric + hyphen, 1-255 chars, must be globally unique
  description?: string;         // Optional, 0-5000 characters
  logoUrl?: string;             // Optional, valid HTTP/HTTPS URL
  websiteUrl?: string;          // Optional, valid HTTP/HTTPS URL
}
```

**Success Response** (201 Created):
```typescript
{
  data: {
    id: string;                 // UUID v4
    name: string;
    slug: string;
    description: string | null;
    logoUrl: string | null;
    websiteUrl: string | null;
    creatorId: string;          // Authenticated user ID
    createdAt: string;          // ISO 8601 timestamp
    updatedAt: string;          // ISO 8601 timestamp
    deletedAt: null;
  }
}
```

**Error Responses**:
- **400 Bad Request** - Validation failed (invalid slug format, name too long, URL invalid)
- **401 Unauthorized** - No valid session
- **409 Conflict** - Slug already exists (must be globally unique across all orgs)
- **422 Unprocessable Entity** - Invalid input (business rule violation)

**Behavior**:
- CreatorId automatically set to authenticated user
- Slug uniqueness enforced at database level via unique constraint
- Organization initially soft-deleted=false (active)

**Example**:
```bash
curl -X POST http://localhost:42071/api/organizations \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=<session-token>" \
  -d '{
    "name": "Tech Content Hub",
    "slug": "tech-hub",
    "description": "Technology tutorials and courses",
    "websiteUrl": "https://techhub.example.com"
  }'

# Response (201)
{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Tech Content Hub",
    "slug": "tech-hub",
    "description": "Technology tutorials and courses",
    "logoUrl": null,
    "websiteUrl": "https://techhub.example.com",
    "creatorId": "user-123",
    "createdAt": "2025-01-22T10:30:00Z",
    "updatedAt": "2025-01-22T10:30:00Z"
  }
}
```

---

#### GET /api/organizations/:id

Get organization by ID.

**Authentication**: Required

**Rate Limit**: 100 req/min

**Path Parameters**:
```
id: string (UUID v4)
```

**Success Response** (200):
```typescript
{
  data: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logoUrl: string | null;
    websiteUrl: string | null;
    creatorId: string;
    createdAt: string;
    updatedAt: string;
  }
}
```

**Error Responses**:
- **401 Unauthorized** - No valid session
- **404 Not Found** - Organization ID not found or soft-deleted

**Behavior**:
- Returns only non-deleted organizations (deletedAt IS NULL)
- No access control enforced; any authenticated user can read any org

**Example**:
```bash
curl http://localhost:42071/api/organizations/550e8400-e29b-41d4-a716-446655440000 \
  -H "Cookie: codex-session=<session-token>"
```

---

#### GET /api/organizations/slug/:slug

Get organization by slug (friendly lookup).

**Authentication**: Required

**Rate Limit**: 100 req/min

**Path Parameters**:
```
slug: string (lowercase alphanumeric + hyphen)
```

**Success Response** (200): Same as GET /:id

**Error Responses**:
- **401 Unauthorized** - No valid session
- **404 Not Found** - Organization with slug not found or soft-deleted
- **400 Bad Request** - Invalid slug format

**Behavior**:
- Case-insensitive slug matching
- Returns only non-deleted organizations

**Example**:
```bash
curl http://localhost:42071/api/organizations/slug/tech-hub \
  -H "Cookie: codex-session=<session-token>"
```

---

#### GET /api/organizations/check-slug/:slug

Check if slug is available (before creating organization).

**Authentication**: Required

**Rate Limit**: 100 req/min

**Path Parameters**:
```
slug: string
```

**Success Response** (200):
```typescript
{
  available: boolean
}
```

**Error Responses**:
- **401 Unauthorized** - No valid session
- **400 Bad Request** - Invalid slug format

**Behavior**:
- Returns true if slug is available (no non-deleted org with this slug)
- Returns false if slug taken
- Used by frontend to provide real-time slug validation before form submission
- Prevents 409 Conflict responses on creation

**Example**:
```bash
curl http://localhost:42071/api/organizations/check-slug/my-new-org \
  -H "Cookie: codex-session=<session-token>"

# Response
{ "available": true }

curl http://localhost:42071/api/organizations/check-slug/tech-hub \
  -H "Cookie: codex-session=<session-token>"

# Response
{ "available": false }
```

---

#### GET /api/organizations

List organizations with filtering, search, and pagination.

**Authentication**: Required

**Rate Limit**: 100 req/min

**Query Parameters**:
```typescript
search?: string;                // Full-text search on name/slug (partial match)
sortBy?: "name" | "createdAt" | "updatedAt";  // Default: "createdAt"
sortOrder?: "asc" | "desc";     // Default: "desc"
page?: number;                  // 1-indexed, default: 1
limit?: number;                 // 1-100, default: 20, max: 100
```

**Success Response** (200):
```typescript
{
  data: Array<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    creatorId: string;
    createdAt: string;
    updatedAt: string;
  }>;
  pagination: {
    page: number;               // Current page number
    limit: number;              // Items per page
    total: number;              // Total matching organizations
    pages: number;              // Total pages available
  }
}
```

**Error Responses**:
- **401 Unauthorized** - No valid session
- **400 Bad Request** - Invalid page/limit values

**Behavior**:
- Only returns non-deleted organizations
- Search is case-insensitive partial match
- sortBy=createdAt with sortOrder=desc shows newest first
- Returns limited fields (no logoUrl, websiteUrl) for list efficiency

**Example**:
```bash
curl "http://localhost:42071/api/organizations?search=tech&page=1&limit=10&sortBy=name&sortOrder=asc" \
  -H "Cookie: codex-session=<session-token>"

# Response
{
  "data": [
    {
      "id": "org-123",
      "name": "Tech Hub",
      "slug": "tech-hub",
      "creatorId": "user-456",
      "createdAt": "2025-01-20T08:00:00Z",
      "updatedAt": "2025-01-22T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 15,
    "pages": 2
  }
}
```

---

#### PATCH /api/organizations/:id

Update organization (organization member only).

**Authentication**: Required

**Rate Limit**: 100 req/min

**Authorization**: User must have organization management permission

**Path Parameters**:
```
id: string (UUID)
```

**Request Body** (all fields optional):
```typescript
{
  name?: string;                 // 1-255 characters
  slug?: string;                 // Changing slug re-validates uniqueness
  description?: string;          // 0-5000 characters
  logoUrl?: string;              // Valid HTTP/HTTPS URL
  websiteUrl?: string;           // Valid HTTP/HTTPS URL
}
```

**Success Response** (200):
```typescript
{
  data: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logoUrl: string | null;
    websiteUrl: string | null;
    creatorId: string;
    createdAt: string;
    updatedAt: string;           // Updated to current timestamp
  }
}
```

**Error Responses**:
- **401 Unauthorized** - No valid session
- **403 Forbidden** - User not organization member
- **404 Not Found** - Organization doesn't exist
- **409 Conflict** - New slug already taken by another org
- **400 Bad Request** - Validation failed

**Behavior**:
- updatedAt timestamp automatically set to current time
- Only provided fields are updated (partial update)
- If slug changed, uniqueness re-validated

**Example**:
```bash
curl -X PATCH http://localhost:42071/api/organizations/org-123 \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=<session-token>" \
  -d '{
    "name": "Tech Hub 2.0",
    "websiteUrl": "https://newsite.example.com"
  }'
```

---

#### DELETE /api/organizations/:id

Soft delete organization (organization member only).

**Authentication**: Required

**Rate Limit**: 5 req/15min (strict, prevents accidental deletions)

**Authorization**: User must have organization management permission

**Path Parameters**:
```
id: string (UUID)
```

**Success Response** (200):
```typescript
{
  success: true;
  message: "Organization deleted successfully"
}
```

**Error Responses**:
- **401 Unauthorized** - No valid session
- **403 Forbidden** - User not organization member
- **404 Not Found** - Organization doesn't exist
- **429 Too Many Requests** - Rate limit exceeded

**Behavior**:
- Performs soft delete (sets deletedAt timestamp, doesn't remove record)
- Organization still exists in database but appears deleted to queries
- Content/settings associated with org also marked as deleted
- Strict rate limit (5/15min) prevents accidental bulk deletions

**Example**:
```bash
curl -X DELETE http://localhost:42071/api/organizations/org-123 \
  -H "Cookie: codex-session=<session-token>"

# Response (200)
{
  "success": true,
  "message": "Organization deleted successfully"
}
```

---

### Settings Endpoints

**Base Path**: `/api/organizations/:id/settings`

Settings are scoped per organization and require organization management permission on all routes.

---

#### GET /api/organizations/:id/settings

Get all settings (branding, contact, features) in parallel.

**Authentication**: Required

**Authorization**: Organization member

**Rate Limit**: 100 req/min

**Path Parameters**:
```
id: string (organization UUID)
```

**Success Response** (200):
```typescript
{
  branding: {
    logoUrl: string | null;
    primaryColorHex: string;          // 6-digit hex format #RRGGBB
  };
  contact: {
    platformName: string;             // Display name for platform
    supportEmail: string;             // Support contact email
    contactUrl: string | null;        // Contact/feedback URL
    timezone: string;                 // IANA timezone name
  };
  features: {
    enableSignups: boolean;           // Allow new user registration
    enablePurchases: boolean;         // Allow content purchases
  }
}
```

**Error Responses**:
- **401 Unauthorized** - No valid session
- **403 Forbidden** - User not organization member
- **404 Not Found** - Organization doesn't exist

**Behavior**:
- Fetches all 3 settings categories in parallel (Promise.all)
- Returns defaults if settings don't exist in database
- Provides single endpoint for frontend to load all org configuration

**Example**:
```bash
curl http://localhost:42071/api/organizations/org-123/settings \
  -H "Cookie: codex-session=<session-token>"

# Response
{
  "branding": {
    "logoUrl": "https://bucket.r2.cloudflarestorage.com/logos/org-123/logo.png",
    "primaryColorHex": "#3B82F6"
  },
  "contact": {
    "platformName": "Tech Hub",
    "supportEmail": "support@techhub.example.com",
    "contactUrl": "https://techhub.example.com/contact",
    "timezone": "America/New_York"
  },
  "features": {
    "enableSignups": true,
    "enablePurchases": true
  }
}
```

---

#### GET /api/organizations/:id/settings/branding

Get branding settings (logo, primary color).

**Authentication**: Required

**Authorization**: Organization member

**Rate Limit**: 100 req/min

**Success Response** (200):
```typescript
{
  logoUrl: string | null;             // R2 URL or null if no logo
  primaryColorHex: string;            // Hex color #RRGGBB
}
```

**Default Values** (if not set):
```typescript
{
  logoUrl: null,
  primaryColorHex: "#3B82F6"          // Codex blue
}
```

---

#### PUT /api/organizations/:id/settings/branding

Update branding settings (color only; use POST /logo for logo).

**Authentication**: Required

**Authorization**: Organization member

**Rate Limit**: 100 req/min

**Request Body** (all fields optional):
```typescript
{
  primaryColorHex?: string;           // Hex color #RRGGBB, 6 characters
}
```

**Success Response** (200): Updated branding settings

**Error Responses**:
- **400 Bad Request** - Invalid hex color format
- **401 Unauthorized** - No valid session
- **403 Forbidden** - User not organization member

**Validation**:
- Hex color must match pattern: `^#[0-9A-Fa-f]{6}$`
- Case insensitive (both #FF0000 and #ff0000 valid)

**Example**:
```bash
curl -X PUT http://localhost:42071/api/organizations/org-123/settings/branding \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=<session-token>" \
  -d '{ "primaryColorHex": "#FF5733" }'

# Response (200)
{
  "logoUrl": "https://bucket.r2.cloudflarestorage.com/logos/org-123/logo.png",
  "primaryColorHex": "#FF5733"
}
```

---

#### POST /api/organizations/:id/settings/branding/logo

Upload organization logo file.

**Authentication**: Required

**Authorization**: Organization member

**Rate Limit**: 100 req/min

**Request**: multipart/form-data

**Form Fields**:
```
logo: File                        // Required, single file field
```

**Allowed MIME Types**:
- `image/png`
- `image/jpeg`
- `image/webp`

**Constraints**:
- Max file size: 5 MB (5,242,880 bytes)

**Success Response** (200):
```typescript
{
  data: {
    logoUrl: string;              // New R2 public URL
    primaryColorHex: string;      // Current primary color
  }
}
```

**Error Responses**:
- **400 Bad Request** - Missing file, invalid MIME type, or file size > 5MB
- **401 Unauthorized** - No valid session
- **403 Forbidden** - User not organization member
- **503 Service Unavailable** - R2 bucket not configured

**Behavior**:
- File uploaded to R2 at path: `logos/{organizationId}/logo.{extension}`
- Replaces previous logo if one exists
- Returns public URL for immediate use
- Uses standard R2 caching headers (1 year immutable)

**Storage Details**:
- R2 bucket: `MEDIA_BUCKET` environment variable
- Path pattern: `logos/{orgId}/logo.{ext}` (auto-determined from MIME type)
- Public URL format: `https://{bucket-domain}/logos/{orgId}/logo.{ext}`
- File extension determined by MIME type (png/jpeg/webp)

**Implementation Note**: This endpoint uses manual Hono handler (not `procedure()`) because multipart form-data requires raw Request.formData() access which procedure() doesn't provide. Error handling still uses standard mapErrorToResponse() for consistency.

**Example**:
```bash
curl -X POST http://localhost:42071/api/organizations/org-123/settings/branding/logo \
  -H "Cookie: codex-session=<session-token>" \
  -F "logo=@/path/to/logo.png"

# Response (200)
{
  "data": {
    "logoUrl": "https://bucket.r2.cloudflarestorage.com/logos/org-123/logo.png",
    "primaryColorHex": "#FF5733"
  }
}
```

---

#### DELETE /api/organizations/:id/settings/branding/logo

Delete organization logo.

**Authentication**: Required

**Authorization**: Organization member

**Rate Limit**: 100 req/min

**Success Response** (200):
```typescript
{
  logoUrl: null;
  primaryColorHex: string;
}
```

**Error Responses**:
- **401 Unauthorized** - No valid session
- **403 Forbidden** - User not organization member
- **503 Service Unavailable** - R2 bucket not configured

**Behavior**:
- Removes logo from R2 storage
- Sets logoUrl to null in database
- Preserves primary color

**Example**:
```bash
curl -X DELETE http://localhost:42071/api/organizations/org-123/settings/branding/logo \
  -H "Cookie: codex-session=<session-token>"

# Response (200)
{
  "logoUrl": null,
  "primaryColorHex": "#FF5733"
}
```

---

#### GET /api/organizations/:id/settings/contact

Get contact settings.

**Authentication**: Required

**Authorization**: Organization member

**Rate Limit**: 100 req/min

**Success Response** (200):
```typescript
{
  platformName: string;               // Display name
  supportEmail: string;               // Support email address
  contactUrl: string | null;          // URL to contact/feedback form
  timezone: string;                   // IANA timezone
}
```

**Default Values**:
```typescript
{
  platformName: "Codex Platform",
  supportEmail: "support@example.com",
  contactUrl: null,
  timezone: "UTC"
}
```

---

#### PUT /api/organizations/:id/settings/contact

Update contact settings.

**Authentication**: Required

**Authorization**: Organization member

**Rate Limit**: 100 req/min

**Request Body** (all fields optional):
```typescript
{
  platformName?: string;              // 1-255 characters
  supportEmail?: string;              // RFC 5322 email format
  contactUrl?: string | null;         // Valid HTTP/HTTPS URL or null
  timezone?: string;                  // IANA timezone name (e.g., America/New_York)
}
```

**Success Response** (200): Updated contact settings

**Error Responses**:
- **400 Bad Request** - Invalid email format, invalid URL, or invalid timezone
- **401 Unauthorized** - No valid session
- **403 Forbidden** - User not organization member

**Validation**:
- Email: Must be valid RFC 5322 format
- URL: Must start with http:// or https://
- Timezone: Must be valid IANA timezone (e.g., America/New_York, Europe/London, Asia/Tokyo)
- platformName: 1-255 characters

**Example**:
```bash
curl -X PUT http://localhost:42071/api/organizations/org-123/settings/contact \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=<session-token>" \
  -d '{
    "platformName": "Tech Hub Premium",
    "supportEmail": "help@techhub.example.com",
    "contactUrl": "https://techhub.example.com/contact",
    "timezone": "America/New_York"
  }'

# Response (200)
{
  "platformName": "Tech Hub Premium",
  "supportEmail": "help@techhub.example.com",
  "contactUrl": "https://techhub.example.com/contact",
  "timezone": "America/New_York"
}
```

---

#### GET /api/organizations/:id/settings/features

Get feature settings.

**Authentication**: Required

**Authorization**: Organization member

**Rate Limit**: 100 req/min

**Success Response** (200):
```typescript
{
  enableSignups: boolean;             // Allow new user registration
  enablePurchases: boolean;           // Allow content purchases
}
```

**Default Values**:
```typescript
{
  enableSignups: true,
  enablePurchases: true
}
```

---

#### PUT /api/organizations/:id/settings/features

Update feature flags.

**Authentication**: Required

**Authorization**: Organization member

**Rate Limit**: 100 req/min

**Request Body** (all fields optional):
```typescript
{
  enableSignups?: boolean;
  enablePurchases?: boolean;
}
```

**Success Response** (200): Updated feature settings

**Error Responses**:
- **400 Bad Request** - Invalid input type
- **401 Unauthorized** - No valid session
- **403 Forbidden** - User not organization member

**Behavior**:
- Each flag is independent; can update one without affecting the other
- Frontend checks these flags to show/hide signup forms and purchase UI
- Flags affect user-facing features (filters available content, hides forms)

**Example**:
```bash
curl -X PUT http://localhost:42071/api/organizations/org-123/settings/features \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=<session-token>" \
  -d '{ "enableSignups": false }'

# Response (200)
{
  "enableSignups": false,
  "enablePurchases": true
}
```

---

## Architecture

### Request Processing Pipeline

```
HTTP Request
    ↓
createWorker() middleware chain
  ├─ Request tracking (x-request-id generation)
  ├─ Security headers middleware
  ├─ CORS middleware
  ├─ Environment validation (DATABASE_URL, RATE_LIMIT_KV)
  └─ Global error handling
    ↓
Route matching (Hono)
    ↓
procedure() decorator
  ├─ Policy enforcement (auth required, org membership)
  ├─ Input validation (Zod schemas)
  ├─ Rate limiting check (KV-based)
  ├─ Service instantiation (injected into context)
  └─ Handler execution
    ↓
Service layer
  ├─ OrganizationService for org endpoints
  ├─ PlatformSettingsFacade for settings endpoints
  └─ Database operations via dbHttp
    ↓
Error handling
  └─ mapErrorToResponse() converts errors to HTTP responses
    ↓
HTTP Response (JSON + headers)
```

### Middleware Chain

**Applied to All Routes** (via `createWorker()`):
1. **Request Tracking**: Generates x-request-id UUID, captures IP, user agent
2. **Environment Validation**: Checks required env vars on first request
3. **Security Headers**: Adds CSP, X-Frame-Options, HSTS, etc.
4. **CORS**: Enables cross-origin requests with proper headers
5. **Global Error Handler**: Catches unhandled errors, returns 500

**Applied Per-Route** (via `procedure()`):
1. **Rate Limiting**: Checks KV for request count, enforces per-minute limits
2. **Authentication**: Validates session cookie, retrieves user context
3. **Authorization**: Checks organization membership if required
4. **Input Validation**: Validates request body/params against Zod schema
5. **Service Injection**: Creates services and injects into handler context

### Service Layer

**OrganizationService** (`@codex/identity`):
- `create(input: CreateOrganizationInput, creatorId: string)` - Insert new org
- `get(id: string)` - Fetch org by ID
- `getBySlug(slug: string)` - Fetch org by slug
- `isSlugAvailable(slug: string)` - Check slug uniqueness
- `update(id: string, input: UpdateOrganizationInput)` - Update org fields
- `delete(id: string)` - Soft delete org
- `list(filters, pagination)` - List with search/sort/pagination

**PlatformSettingsFacade** (`@codex/platform-settings`):
- `getAllSettings()` - Parallel fetch of all setting categories
- `getBranding()`, `updateBranding()`, `uploadLogo()`, `deleteLogo()`
- `getContact()`, `updateContact()`
- `getFeatures()`, `updateFeatures()`

### Database Access

**HTTP Client** (`@codex/database`):
- All database operations via dbHttp (Cloudflare Worker HTTP fetch pooling)
- Queries parameterized via Drizzle ORM (prevents SQL injection)
- Transaction support for multi-step operations
- Soft delete filtering via `whereNotDeleted()` helper

**Tables**:
- `organizations` - Org metadata (name, slug, branding URLs, etc.)
- `platformSettings` - Org-specific settings (branding, contact, features)
- (Implicit foreign keys via organizationId field)

---

## Integration Points

### @codex/identity

**Used for**: Organization CRUD operations

**Service**: OrganizationService

**Methods Called**:
```typescript
// Route: POST /api/organizations
await service.create(input, creatorId);

// Route: GET /api/organizations/:id
await service.get(id);

// Route: GET /api/organizations/slug/:slug
await service.getBySlug(slug);

// Route: GET /api/organizations/check-slug/:slug
await service.isSlugAvailable(slug);

// Route: PATCH /api/organizations/:id
await service.update(id, input);

// Route: DELETE /api/organizations/:id
await service.delete(id);

// Route: GET /api/organizations
await service.list(filters, pagination);
```

**Dependencies**: dbHttp, validation schemas

---

### @codex/platform-settings

**Used for**: Organization settings management (branding, contact, features)

**Service**: PlatformSettingsFacade

**Instantiation** (manual in routes):
```typescript
const facade = new PlatformSettingsFacade({
  db: ctx.env.DATABASE_URL,
  environment: ctx.env.ENVIRONMENT,
  organizationId: organizationId,
  r2: new R2Service(ctx.env.MEDIA_BUCKET),
  r2PublicUrlBase: ctx.env.R2_PUBLIC_URL_BASE,
});

// Then call methods
const settings = await facade.getAllSettings();
```

**Methods**:
```typescript
// Branding
await facade.getBranding();
await facade.updateBranding({ primaryColorHex?: string });
await facade.uploadLogo({ buffer, mimeType, size });
await facade.deleteLogo();

// Contact
await facade.getContact();
await facade.updateContact({ platformName?, supportEmail?, contactUrl?, timezone? });

// Features
await facade.getFeatures();
await facade.updateFeatures({ enableSignups?, enablePurchases? });

// All at once
await facade.getAllSettings();
```

---

### @codex/worker-utils

**Used for**: Worker setup, route decoration, health checks

**Exports Used**:
```typescript
// Worker setup
createWorker({ serviceName, version, healthCheck, ... });

// Route decoration
procedure({ policy, input, handler, ... });

// Health checks
standardDatabaseCheck;
createKvCheck(['RATE_LIMIT_KV', 'AUTH_SESSION_KV']);

// Environment validation
createEnvValidationMiddleware({ required, optional });
```

---

### @codex/validation

**Used for**: Input validation schemas

**Schemas Used**:
```typescript
createOrganizationSchema        // POST body validation
updateOrganizationSchema        // PATCH body validation
organizationQuerySchema         // GET query params validation
uuidSchema                      // UUID param validation
createSlugSchema(maxLength)     // Slug validation
updateBrandingSchema            // Branding update validation
updateContactSchema             // Contact update validation
updateFeaturesSchema            // Features update validation
```

---

### @codex/database

**Used for**: Database connection pooling, query execution

**Exports Used**:
```typescript
dbHttp              // HTTP client for Neon PostgreSQL (production)
schema              // Drizzle ORM schema definitions
createPerRequestDbClient()  // Per-request db client for logo upload
```

---

### @codex/security

**Used for**: Authentication, authorization, rate limiting

**Middleware Provided** (via createWorker):
```typescript
securityHeaders()           // CSP, X-Frame-Options, HSTS
createRateLimiter()         // KV-based rate limiting
```

**Used Implicitly** (via procedure):
```typescript
policy: { auth: 'required' }                    // Session validation
policy: { auth: 'required', requireOrgManagement: true }  // Membership check
```

---

### @codex/shared-types

**Used for**: Type definitions, response contracts

**Types Used**:
```typescript
HonoEnv                         // Worker environment type
CreateOrganizationResponse      // Response type contracts
OrganizationBySlugResponse
OrganizationListResponse
UpdateOrganizationResponse
DeleteOrganizationResponse
CheckSlugResponse
```

---

### @codex/cloudflare-clients

**Used for**: R2 storage operations (logo uploads/deletions)

**Service**: R2Service

**Used In**: Logo upload endpoint

```typescript
const r2 = new R2Service(ctx.env.MEDIA_BUCKET);
await facade.uploadLogo({ buffer, mimeType, size });  // Uses R2 internally
```

---

## Security Model

### Authentication

**Session Validation**:
- All routes require valid `codex-session` cookie
- Cookie validated via Auth Worker (GET /api/auth/session)
- Session context available as `ctx.get('user')` in handlers
- Sessions cached in KV for 5 minutes (performance optimization)

**Unauthenticated Requests**:
- Return 401 Unauthorized
- No response body details (prevents user enumeration)

### Authorization

**Organization Management Check** (`requireOrgMembership: true`):
- User must be member of organization
- Enforced on update, delete, and settings endpoints
- Checked via organization membership policy
- If user not member: returns 403 Forbidden

**Resource Ownership**:
- Creator (user who created org) is the implicit owner
- Future membership system will extend access control
- Currently: single creator has all management rights

### Rate Limiting

**Per-Endpoint Limits**:
| Endpoint Group | Limit | Key |
|---|---|---|
| Organization CRUD | 100/min | Authenticated user ID |
| Settings (all) | 100/min | Authenticated user ID |
| Organization deletion | 5/15min | Authenticated user ID |

**Behavior**:
- Returns 429 Too Many Requests when exceeded
- Limit reset after time window expires
- Stored in RATE_LIMIT_KV (Cloudflare KV namespace)

### Input Validation

**All Inputs Validated** with Zod:
- Organization name: 1-255 characters, no HTML/JS
- Slug: lowercase alphanumeric + hyphen, 1-255 chars, unique constraint
- Email: RFC 5322 format validation
- URLs: Must be http/https valid URLs
- Hex colors: `^#[0-9A-Fa-f]{6}$` pattern
- Timezone: Validated against IANA timezone database
- File uploads: MIME type and size validation

**Returns 400 Bad Request** on validation failure with error details.

### PII Protection

**Data Handling**:
- No passwords in organization data
- Support emails stored plaintext (necessary for contact)
- Not included in error messages
- Logs do not include PII (request/response bodies redacted)

**Multi-Tenancy**:
- Organization data isolated per org
- Settings scoped per organization
- Logo storage isolated (logos/{orgId}/...)
- No cross-org data leakage possible

---

## Error Handling

### Standard Error Response Format

```typescript
{
  error: {
    code: string;               // Machine-readable error code
    message: string;            // Human-readable message
    details?: object;           // Optional error context
  };
  requestId: string;            // x-request-id for tracing
  timestamp: string;            // ISO 8601 timestamp
}
```

### Common Errors

| Status | Code | Condition |
|---|---|---|
| 400 | INVALID_INPUT | Validation fails (bad format, constraints violated) |
| 401 | UNAUTHORIZED | Missing or expired session |
| 403 | FORBIDDEN | User lacks org management permission |
| 404 | NOT_FOUND | Organization or resource doesn't exist |
| 409 | CONFLICT | Slug already exists for another org |
| 422 | UNPROCESSABLE_ENTITY | Business rule violation (e.g., invalid timezone) |
| 429 | TOO_MANY_REQUESTS | Rate limit exceeded |
| 503 | SERVICE_UNAVAILABLE | R2 bucket or database unavailable |

### Error Handling Pattern

**In Route Handlers**:
```typescript
procedure({
  handler: async (ctx) => {
    try {
      // Service call that may throw
      const result = await ctx.services.organization.get(id);
      if (!result) {
        throw new NotFoundError('Organization not found');
      }
      return result;
    } catch (err) {
      // Caught by procedure() wrapper
      // Automatically converted to HTTP response via mapErrorToResponse()
      throw err;
    }
  },
})
```

**Error Conversion**:
- `NotFoundError` → 404
- `ConflictError` → 409
- `ValidationError` → 400
- `ForbiddenError` → 403
- Other errors → 500

---

## Data Models

### Organization

```typescript
interface Organization {
  id: string;                    // UUID v4
  name: string;                  // 1-255 characters
  slug: string;                  // Lowercase alphanumeric + hyphen, globally unique
  description: string | null;
  logoUrl: string | null;        // Branding logo (org-specific, not settings.branding.logoUrl)
  websiteUrl: string | null;     // Organization website
  creatorId: string;             // User who created org (UUID)
  createdAt: string;             // ISO 8601 timestamp
  updatedAt: string;             // ISO 8601 timestamp
  deletedAt: string | null;      // Soft delete timestamp (null = active)
}
```

**Table**: `organizations`

**Constraints**:
- Primary key: `id`
- Unique constraint: `(slug, deletedAt IS NULL)` - Only one non-deleted org per slug
- Foreign key: `creatorId → users.id`
- Index: `(slug, deletedAt)` for fast lookup

---

### Settings

Settings are organized into three categories:

**BrandingSettings**:
```typescript
interface BrandingSettings {
  organizationId: string;        // Reference to organization
  logoUrl: string | null;        // R2 public URL or null
  primaryColorHex: string;       // Hex format #RRGGBB (default: #3B82F6)
}
```

**ContactSettings**:
```typescript
interface ContactSettings {
  organizationId: string;
  platformName: string;          // Default: "Codex Platform"
  supportEmail: string;          // Default: "support@example.com"
  contactUrl: string | null;     // URL to contact form (nullable)
  timezone: string;              // IANA timezone (default: "UTC")
}
```

**FeatureSettings**:
```typescript
interface FeatureSettings {
  organizationId: string;
  enableSignups: boolean;        // Default: true
  enablePurchases: boolean;      // Default: true
}
```

**Tables**:
- `platformSettingsBranding` - Logo + color per org
- `platformSettingsContact` - Contact info per org
- `platformSettingsFeatures` - Feature flags per org

**Design**:
- Separate tables allow independent updates
- Defaults applied at service layer if no record exists
- Upsert pattern used (insert or update on conflict)
- All scoped by organizationId

---

## Testing

### Test Files

**Unit Tests**: `/src/index.test.ts`
- Health check endpoint
- Security headers presence
- Authentication requirement
- Error handling
- Environment bindings

**Integration Tests**: `/src/__tests__/settings.test.ts`
- Settings endpoints (9 total)
- Auth requirement on all routes
- Validation errors (bad input)
- File type/size errors
- Service facade mocking

### Running Tests

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# With UI
pnpm test:ui

# Coverage report
pnpm test:coverage
```

### Testing Strategy

**Uses**: Vitest with `@cloudflare/vitest-pool-workers` (runs in actual Cloudflare Workers runtime)

**Approach**:
- Tests run in workerd runtime (same as production)
- Mock external services (database, R2)
- Use real KV namespace bindings from wrangler.jsonc
- Storage isolated between tests

**Key Test Patterns**:
```typescript
// Health check test
const response = await SELF.fetch('http://localhost/health');
expect([200, 503]).toContain(response.status);

// Auth test
const response = await SELF.fetch('http://localhost/api/organizations');
expect(response.status).toBe(401);

// Settings test (mocked facade)
mockFacade.getBranding.mockResolvedValueOnce(DEFAULT_BRANDING);
const result = await mockFacade.getBranding();
expect(result.primaryColorHex).toBe('#3B82F6');
```

### Local Testing Steps

```bash
# 1. Start worker in dev mode
pnpm dev

# 2. Test health check
curl http://localhost:42071/health

# 3. Create test user session (requires Auth Worker running)
# See workers/auth documentation for session setup

# 4. Test organization endpoints
curl -X POST http://localhost:42071/api/organizations \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=<token>" \
  -d '{"name":"Test","slug":"test"}'

# 5. Test settings endpoints
curl http://localhost:42071/api/organizations/:id/settings \
  -H "Cookie: codex-session=<token>"

# 6. Run automated tests
pnpm test
```

---

## Development Workflow

### Local Setup

```bash
# Install dependencies
pnpm install

# Create .env.local (if needed for local development)
ENVIRONMENT=development
DATABASE_URL=postgresql://...
RATE_LIMIT_KV=rate-limit-kv
```

### Starting the Worker

```bash
cd /Users/brucemckay/development/component-definition/workers/organization-api
pnpm dev

# Starts on http://localhost:42071
# Auto-reloads on file changes
# Includes debugging support on port 9234
```

### Code Structure

```
/Users/brucemckay/development/component-definition/workers/organization-api/
├── src/
│   ├── index.ts                 # Main worker app setup
│   ├── routes/
│   │   ├── organizations.ts     # Organization CRUD endpoints
│   │   └── settings.ts          # Settings management endpoints
│   ├── index.test.ts            # Unit tests
│   └── __tests__/
│       └── settings.test.ts     # Settings integration tests
├── package.json
├── vite.config.ts
├── vitest.config.ts
├── tsconfig.json
├── CLAUDE.md                    # This file
└── wrangler.jsonc
```

### Development Guidelines

**Route Organization**:
- `/routes/organizations.ts` - All org endpoints (POST, GET, PATCH, DELETE)
- `/routes/settings.ts` - All settings endpoints (nested under /api/organizations/:id/settings)

**Pattern for New Endpoints**:
```typescript
import { procedure } from '@codex/worker-utils';

app.post('/path',
  procedure({
    policy: { auth: 'required', requireOrgManagement: true },
    input: {
      params: z.object({ id: uuidSchema }),
      body: updateSchema
    },
    handler: async (ctx) => {
      // ctx.services injected automatically
      // ctx.input.body, ctx.input.params available
      // ctx.user contains authenticated user
      return await ctx.services.organization.update(
        ctx.input.params.id,
        ctx.input.body
      );
    },
  })
);
```

**Error Handling**:
- Throw specific errors (NotFoundError, ConflictError, etc.)
- procedure() catches and converts to HTTP responses
- No try-catch needed (automatic conversion)

---

## Deployment

### Staging Deployment

```bash
cd /Users/brucemckay/development/component-definition/workers/organization-api
pnpm deploy:staging

# Deploys to organization-api-staging.revelations.studio
```

### Production Deployment

```bash
cd /Users/brucemckay/development/component-definition/workers/organization-api
pnpm deploy:production

# Deploys to organization-api.revelations.studio
# Requires: All tests passing, PR approved, staging verified
```

### Deployment Checklist

- [ ] All tests passing (`pnpm test`)
- [ ] Code reviewed and approved
- [ ] Staging deployment tested
- [ ] No breaking API changes
- [ ] Environment variables configured in Cloudflare
- [ ] Database migrations applied (if needed)
- [ ] Rate limit settings appropriate for load

### Environment Variables

**Required**:
- `DATABASE_URL` - Neon PostgreSQL connection string
- `RATE_LIMIT_KV` - Cloudflare KV namespace binding name

**Optional**:
- `ENVIRONMENT` - Set to "production" or "staging" (affects logging)
- `WEB_APP_URL` - Frontend URL for CORS
- `API_URL` - API base URL
- `MEDIA_BUCKET` - R2 bucket name for logo uploads

---

## Performance

### Query Optimization

**Single Org Lookup** (GET /:id):
- Indexed on ID (primary key)
- Database query: ~1ms
- Response time: ~10ms (with network)

**Slug Lookup** (GET /slug/:slug):
- Indexed on (slug, deletedAt)
- Database query: ~1ms
- Response time: ~10ms

**List Organizations** (GET /):
- Full-text search on name/slug
- Pagination limits result set
- Database query: ~5-10ms for 20 items
- Response time: ~20ms

**Settings Fetch** (GET /settings):
- 3 parallel queries (Promise.all)
- All use indexed lookups on organizationId
- Database query: ~3-5ms total
- Response time: ~15ms

### Caching Strategy

**Opportunities**:
- Organization metadata: Cache 5-10 minutes (rarely changes)
- Settings: Cache 5-10 minutes (relatively static)
- Logo URLs: Cache 1 year via R2 (immutable)

**Current Approach**: No caching layer (all queries hit database)

### Rate Limiting Impact

- Prevents spike attacks (limits to 100 req/min per user)
- KV lookup < 1ms (minimal latency)
- Failed checks returned immediately (429)

---

## Monitoring

### Health Check Endpoint

```bash
GET /health
```

**Response** (200):
```json
{
  "status": "healthy",
  "service": "organization-api",
  "version": "1.0.0",
  "timestamp": "2025-01-22T10:30:00Z",
  "checks": {
    "database": "healthy",
    "kv_rate_limit": "healthy"
  }
}
```

**Response** (503):
```json
{
  "status": "unhealthy",
  "service": "organization-api",
  "checks": {
    "database": "unhealthy",
    "kv_rate_limit": "unhealthy"
  }
}
```

### Key Metrics to Monitor

- **Org Creation Success Rate** - Should be 95%+ (excluding validation errors)
- **Slug Conflict Rate** - Should be < 1% (good UX validation)
- **Settings Update Response Time** - Should be < 50ms
- **Logo Upload Success Rate** - Should be 95%+ (excluding validation errors)
- **Rate Limit Hit Rate** - Should be < 1% (indicates abuse or too-low limits)
- **Error Rate** - 4xx: 5-10%, 5xx: < 0.1%

### Logging

**Request Logs** (auto-generated):
- Method, path, status code, response time
- User ID (if authenticated)
- Request ID for tracing
- IP address

**Error Logs** (sanitized):
- Error type and message (no stack traces in production)
- Request context (ID, user, endpoint)
- No PII exposed

---

## Related Documentation

- **@codex/identity** - OrganizationService (org CRUD)
- **@codex/platform-settings** - PlatformSettingsFacade (settings management)
- **@codex/database** - Drizzle ORM, schema, query helpers
- **@codex/validation** - Zod schemas for all inputs
- **@codex/worker-utils** - Worker setup, procedure(), error handling
- **@codex/security** - Authentication, authorization, rate limiting
- **workers/CLAUDE.md** - Worker architecture overview
- **workers/auth/CLAUDE.md** - Session validation reference

---

## Critical Files

| File | Purpose |
|------|---------|
| `/src/index.ts` | Worker setup, middleware, route mounting |
| `/src/routes/organizations.ts` | Organization CRUD endpoints |
| `/src/routes/settings.ts` | Settings management endpoints |
| `/src/index.test.ts` | Unit tests (health, auth, errors) |
| `/src/__tests__/settings.test.ts` | Integration tests for settings |
| `/package.json` | Dependencies, scripts, configuration |
| `/wrangler.jsonc` | Cloudflare Worker configuration |
| `/CLAUDE.md` | This documentation |

---

## Unresolved Questions / Future Work

- How should multi-user organization membership be modeled? Currently creator has all rights.
- Should settings have versioning/rollback capability?
- Need multipart/form-data validation support in procedure() to avoid manual handling
- Rate limit per endpoint vs per route group?
- Should deleted organizations/settings be recoverable (soft delete recovery)?
- Logo optimization (resize, compression) on upload?
- Settings inheritance from platform defaults?

---

**Last Updated**: 2025-01-22

**Version**: 1.0.0

**Status**: Production Ready
