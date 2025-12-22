# Organization API Worker

REST API for organization management and settings configuration in Codex. Provides endpoints for creating/managing organizations and configuring platform settings (branding, contact, features) per organization.

**Deployment Target**: `organization-api.revelations.studio` (production), local port 42071 (development)

**Primary Responsibility**: Multi-tenant organization management + organization settings management

**Status**: Active

---

## Overview

Manages two distinct concerns:

1. **Organization CRUD** - Create, read, update, delete organizations with slug-based lookups
2. **Organization Settings** - Branding (logo, colors), contact info, feature toggles

All endpoints require authentication via session validation. Settings endpoints require organization management permissions.

---

## Endpoints

### Organization Management

#### POST /api/organizations

Create new organization.

**Request**:
```typescript
{
  name: string;                // 1-255 chars, required
  slug: string;                // Lowercase alphanumeric + hyphen, unique, required
  description?: string;        // 0-5000 chars
  logoUrl?: string;            // Valid URL
  websiteUrl?: string;         // Valid URL
}
```

**Response** (201):
```typescript
{
  data: {
    id: string;                // UUID
    name: string;
    slug: string;
    description: string | null;
    logoUrl: string | null;
    websiteUrl: string | null;
    creatorId: string;         // User who created org
    createdAt: string;         // ISO 8601
    updatedAt: string;
  }
}
```

**Errors**:
- 400 Bad Request - Validation fails (invalid slug format, etc)
- 401 Unauthorized - Not authenticated
- 409 Conflict - Slug already exists
- 422 Unprocessable Entity - Invalid input data

**Security**: Authenticated users only. Rate limit: 100 req/min

---

#### GET /api/organizations/:id

Get organization by ID.

**Path Parameters**:
```
id: string (UUID)
```

**Response** (200):
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

**Errors**:
- 401 Unauthorized - Not authenticated
- 404 Not Found - Organization doesn't exist

---

#### GET /api/organizations/slug/:slug

Get organization by slug (friendly lookup).

**Path Parameters**:
```
slug: string
```

**Response** (200): Same as GET /:id

**Errors**:
- 401 Unauthorized - Not authenticated
- 404 Not Found - Organization with slug doesn't exist

---

#### GET /api/organizations/check-slug/:slug

Check if slug is available (before creating org).

**Path Parameters**:
```
slug: string
```

**Response** (200):
```typescript
{
  available: boolean
}
```

**Use Case**: Frontend slug availability checking before org creation. Prevents 409 Conflict responses.

---

#### GET /api/organizations

List organizations with advanced filtering.

**Query Parameters**:
```
search?: string           // Search name/slug (full-text search)
sortBy?: "name" | "createdAt" | "updatedAt" (default: "createdAt")
sortOrder?: "asc" | "desc" (default: "desc")
page?: number (default: 1)
limit?: number (default: 20, max: 100)
```

**Response** (200):
```typescript
{
  data: Array<{
    id: string;
    name: string;
    slug: string;
    creatorId: string;
    createdAt: string;
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

#### PATCH /api/organizations/:id

Update organization (owner/admin only).

**Path Parameters**:
```
id: string (UUID)
```

**Request**:
```typescript
{
  name?: string;
  slug?: string;            // Changing slug re-validates uniqueness
  description?: string;
  logoUrl?: string;
  websiteUrl?: string;
}
```

**Response** (200): Updated organization

**Errors**:
- 401 Unauthorized - Not authenticated
- 403 Forbidden - User not organization member
- 404 Not Found - Organization doesn't exist
- 409 Conflict - New slug already taken

**Security**: Requires organization management permission. Rate limit: 100 req/min

---

#### DELETE /api/organizations/:id

Soft delete organization (owner/admin only).

**Path Parameters**:
```
id: string (UUID)
```

**Response** (200):
```typescript
{
  success: true;
  message: "Organization deleted successfully"
}
```

**Errors**:
- 401 Unauthorized - Not authenticated
- 403 Forbidden - User not organization member
- 404 Not Found - Organization doesn't exist

**Security**: Requires organization management permission. Strict rate limit: 5 req/15min

---

### Organization Settings

**Base Path**: `/api/organizations/:id/settings`

Settings are scoped under each organization. All settings endpoints require organization management permission.

---

#### GET /api/organizations/:id/settings

Get all settings (branding, contact, features) in parallel.

**Response** (200):
```typescript
{
  branding: {
    logoUrl: string | null;
    primaryColorHex: string;       // Default: #000000
  };
  contact: {
    platformName: string;          // Default: Organization name
    supportEmail: string;          // Default: support@example.com
    contactUrl: string;            // Default: https://example.com/contact
    timezone: string;              // Default: UTC
  };
  features: {
    enableSignups: boolean;        // Default: true
    enablePurchases: boolean;      // Default: true
  }
}
```

**Security**: Requires organization management permission. Rate limit: 100 req/min

---

#### GET /api/organizations/:id/settings/branding

Get branding settings only.

**Response** (200):
```typescript
{
  logoUrl: string | null;
  primaryColorHex: string;
}
```

---

#### PUT /api/organizations/:id/settings/branding

Update branding settings (color only - use POST /logo for logo).

**Request**:
```typescript
{
  primaryColorHex?: string;  // Hex color code validation
}
```

**Response** (200): Updated branding settings

**Errors**:
- 400 Bad Request - Invalid hex color
- 401 Unauthorized - Not authenticated
- 403 Forbidden - User not organization member

---

#### POST /api/organizations/:id/settings/branding/logo

Upload new logo file.

**Request**: multipart/form-data with 'logo' field

**Form Fields**:
```
logo: File                 // Required, max 5MB
```

**Allowed MIME Types**:
- image/png
- image/jpeg
- image/webp

**Response** (200):
```typescript
{
  data: {
    logoUrl: string;
    primaryColorHex: string;
  }
}
```

**Errors**:
- 400 Bad Request - Invalid file type or size > 5MB
- 401 Unauthorized - Not authenticated
- 403 Forbidden - User not organization member
- 503 Service Unavailable - R2 bucket not configured

**Storage**: Logo uploaded to R2 at `logos/{organizationId}/logo.{ext}`

**Caching**: 1 year (immutable path)

---

#### DELETE /api/organizations/:id/settings/branding/logo

Delete current logo.

**Response** (200):
```typescript
{
  logoUrl: null;
  primaryColorHex: string;
}
```

---

#### GET /api/organizations/:id/settings/contact

Get contact settings.

**Response** (200):
```typescript
{
  platformName: string;
  supportEmail: string;
  contactUrl: string;
  timezone: string;
}
```

---

#### PUT /api/organizations/:id/settings/contact

Update contact settings.

**Request**:
```typescript
{
  platformName?: string;    // 1-255 chars
  supportEmail?: string;    // Valid email
  contactUrl?: string;      // Valid URL
  timezone?: string;        // IANA timezone name
}
```

**Response** (200): Updated contact settings

**Validation**:
- Email format validation
- URL format validation
- Timezone validation against IANA database

---

#### GET /api/organizations/:id/settings/features

Get feature settings.

**Response** (200):
```typescript
{
  enableSignups: boolean;
  enablePurchases: boolean;
}
```

---

#### PUT /api/organizations/:id/settings/features

Update feature toggles.

**Request**:
```typescript
{
  enableSignups?: boolean;
  enablePurchases?: boolean;
}
```

**Response** (200): Updated feature settings

**Usage**: Frontend checks these flags to show/hide signup forms and purchase UI

---

## Authentication & Authorization

### Route Security Levels

**Authenticated Only** (`POLICY_PRESETS.authenticated()`):
- POST /api/organizations (create new org)
- GET /api/organizations
- GET /api/organizations/:id
- GET /api/organizations/slug/:slug
- GET /api/organizations/check-slug/:slug

**Organization Management** (`POLICY_PRESETS.orgManagement()`):
- PATCH /api/organizations/:id (update)
- DELETE /api/organizations/:id (strict rate limit)
- All settings endpoints

### Permission Model

**Create Organization**:
- User must be authenticated
- CreatorId automatically set to current user

**Update Organization**:
- User must have organization management permission
- Checked via middleware

**Settings Management**:
- Only organization members can view/modify settings
- Enforced via route-level policies

---

## Data Models

### Organization

```typescript
interface Organization {
  id: string;                    // UUID
  name: string;                  // 1-255 chars
  slug: string;                  // Unique, lowercase alphanumeric + hyphen
  description: string | null;    // 0-5000 chars
  logoUrl: string | null;        // Organization branding logo URL
  websiteUrl: string | null;     // Organization website URL
  creatorId: string;             // User who created org (UUID)
  createdAt: string;             // ISO 8601
  updatedAt: string;             // ISO 8601
  deletedAt: string | null;      // Soft delete timestamp
}
```

### Settings

```typescript
// Branding Settings
interface BrandingSettings {
  logoUrl: string | null;        // R2 URL or null
  primaryColorHex: string;       // Hex format: #RRGGBB
}

// Contact Settings
interface ContactSettings {
  platformName: string;
  supportEmail: string;
  contactUrl: string;
  timezone: string;             // IANA timezone
}

// Feature Settings
interface FeatureSettings {
  enableSignups: boolean;        // Allow new user signups
  enablePurchases: boolean;      // Allow content purchases
}

// All Settings Combined
interface AllSettings {
  branding: BrandingSettings;
  contact: ContactSettings;
  features: FeatureSettings;
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
| 400 | INVALID_INPUT | Input validation fails |
| 401 | UNAUTHORIZED | Missing/expired session |
| 403 | FORBIDDEN | User lacks permission |
| 404 | NOT_FOUND | Organization/resource doesn't exist |
| 409 | CONFLICT | Slug already exists |
| 422 | UNPROCESSABLE_ENTITY | Business rule violation |
| 503 | SERVICE_UNAVAILABLE | R2 or database unavailable |

---

## Security Features

### Rate Limiting

| Endpoint | Limit |
|----------|-------|
| Organization CRUD | 100/min (authenticated) |
| Organization deletion | 5/15min (strict) |
| Settings get/update | 100/min |

### Input Validation

All inputs validated with Zod schemas:
- **Slug**: lowercase alphanumeric + hyphens, 1-255 chars, globally unique
- **Name**: 1-255 chars
- **Email**: RFC 5322 format
- **URL**: Valid HTTP/HTTPS URL
- **Hex Color**: Valid hex color code (#RRGGBB)
- **Timezone**: IANA timezone database
- **Logo File**: PNG/JPEG/WebP only, max 5MB

### Multi-Tenancy

- Organization scoping enforced at route level via `orgManagement()` policy
- Users can only access organizations they're members of
- Settings isolated per organization
- R2 logos stored per-organization (`logos/{organizationId}/...`)

### PII Protection

- Passwords never logged or exposed
- Settings endpoint doesn't return sensitive business logic
- All error messages sanitized (no internal details)

---

## Usage Examples

### Create Organization

```bash
curl -X POST http://localhost:42071/api/organizations \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=<token>" \
  -d '{
    "name": "Tech Blog",
    "slug": "tech-blog",
    "description": "Latest in technology",
    "websiteUrl": "https://techblog.example.com"
  }'

# Response (201)
{
  "data": {
    "id": "org-123",
    "name": "Tech Blog",
    "slug": "tech-blog",
    "creatorId": "user-456",
    "createdAt": "2025-01-22T10:30:00Z",
    ...
  }
}
```

### Update Branding Color

```bash
curl -X PUT \
  http://localhost:42071/api/organizations/org-123/settings/branding \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=<token>" \
  -d '{ "primaryColorHex": "#FF5733" }'

# Response (200)
{
  "logoUrl": null,
  "primaryColorHex": "#FF5733"
}
```

### Upload Logo

```bash
curl -X POST \
  http://localhost:42071/api/organizations/org-123/settings/branding/logo \
  -H "Cookie: codex-session=<token>" \
  -F "logo=@/path/to/logo.png"

# Response (200)
{
  "data": {
    "logoUrl": "https://bucket.r2.cloudflarestorage.com/logos/org-123/logo.png",
    "primaryColorHex": "#FF5733"
  }
}
```

### Update Contact Settings

```bash
curl -X PUT \
  http://localhost:42071/api/organizations/org-123/settings/contact \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=<token>" \
  -d '{
    "platformName": "Tech Blog",
    "supportEmail": "support@techblog.example.com",
    "timezone": "America/New_York"
  }'

# Response (200)
{
  "platformName": "Tech Blog",
  "supportEmail": "support@techblog.example.com",
  "contactUrl": "https://example.com/contact",
  "timezone": "America/New_York"
}
```

### Get All Settings

```bash
curl http://localhost:42071/api/organizations/org-123/settings \
  -H "Cookie: codex-session=<token>"

# Response (200)
{
  "branding": {
    "logoUrl": "...",
    "primaryColorHex": "#FF5733"
  },
  "contact": {
    "platformName": "Tech Blog",
    "supportEmail": "support@techblog.example.com",
    "contactUrl": "https://example.com/contact",
    "timezone": "America/New_York"
  },
  "features": {
    "enableSignups": true,
    "enablePurchases": true
  }
}
```

### Toggle Feature Flags

```bash
curl -X PUT \
  http://localhost:42071/api/organizations/org-123/settings/features \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=<token>" \
  -d '{ "enableSignups": false }'

# Response (200)
{
  "enableSignups": false,
  "enablePurchases": true
}
```

---

## Integration

### With @codex/identity

`OrganizationService` provides:
- Organization CRUD operations
- Slug uniqueness validation
- Pagination and filtering

### With @codex/platform-settings

`PlatformSettingsFacade` provides:
- Branding management (logo + color)
- Contact information management
- Feature toggle management

### With @codex/database

Uses HTTP client for all database operations:
- Organizations table
- Settings tables (branding, contact, features)

### With @codex/security

Uses `POLICY_PRESETS`:
- `authenticated()` - General authenticated access
- `orgManagement()` - Organization member access

---

## Development

### Local Setup

```bash
cd workers/organization-api
pnpm dev  # Starts on http://localhost:42071
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

### Local Testing Steps

```bash
# 1. Create organization
curl -X POST http://localhost:42071/api/organizations \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=<token>" \
  -d '{"name":"Test","slug":"test-org"}'

# 2. Check slug availability
curl "http://localhost:42071/api/organizations/check-slug/test-org" \
  -H "Cookie: codex-session=<token>"

# 3. Update settings
curl -X PUT \
  "http://localhost:42071/api/organizations/org-id/settings/contact" \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=<token>" \
  -d '{"platformName":"Test Org"}'
```

---

## Deployment

### Staging

```bash
pnpm deploy:staging
# Deploys to organization-api-staging.revelations.studio
```

### Production

```bash
pnpm deploy:production
# Deploys to organization-api.revelations.studio
# Requires: tests pass, PR approval, staging verification
```

---

## Performance

### Query Patterns

- **Get organization**: Single row lookup (indexed on ID)
- **List organizations**: Full-text search with pagination
- **Settings get**: Parallel queries (3 settings tables in Promise.all)
- **Settings update**: Upsert pattern (atomic)

### Caching Opportunities

- Organization metadata could be cached (1-5 min)
- Settings relatively static (cache 5-10 min)
- Logo URLs immutable (cache 1 year via R2)

### Rate Limiting

- 100 req/min for read operations (API tier)
- 5 req/15min for deletion (strict)
- Prevents resource abuse

---

## Monitoring

### Health Check

```bash
curl http://localhost:42071/health
```

### Key Metrics

- Organization creation success rate
- Slug uniqueness constraint violations
- Settings update response time
- Logo upload success rate
- Rate limit hit rate

---

## Related Documentation

- **@codex/identity** - OrganizationService
- **@codex/platform-settings** - Settings management
- **@codex/database** - Query patterns
- **@codex/validation** - Input schemas
- **workers/CLAUDE.md** - Worker architecture

---

**Last Updated**: 2025-01-22
**Version**: 1.0.0
