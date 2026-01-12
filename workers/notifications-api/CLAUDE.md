# notifications-api Worker

Cloudflare Worker for email template management, storage, and sending. Provides REST API for creating/updating email templates across three scopes (global, organization, creator), template preview/testing, and integration with @codex/notifications for Resend-based email delivery.

## Overview

The notifications-api worker is a specialized Cloudflare Workers deployment that centralizes email template management for the Codex platform. It enables:

- **Template CRUD**: Create, read, update, delete email templates with soft-delete support
- **Three-Scope System**: Global templates (platform owner), organization templates (org admins), creator templates (individual creators)
- **Template Rendering**: Preview templates with test data to verify branding/token substitution
- **Test Sending**: Send test emails to verify templates work end-to-end
- **Brand Integration**: Automatic brand token injection from platform settings

**Deployment Target**: `notifications-api.revelations.studio` (production), local port 42075 (dev)

**Primary Responsibility**: Email template management, template lifecycle, template testing, integration with @codex/notifications service layer

**Key Packages**:
- `@codex/notifications` - TemplateService, NotificationsService, template rendering, error classes
- `@codex/database` - PostgreSQL storage (emailTemplates, emailAuditLogs tables)
- `@codex/validation` - Zod schemas for template inputs
- `@codex/worker-utils` - Worker setup, procedure() handler factory, middleware
- `@codex/security` - Rate limiting, security headers
- `@codex/platform-settings` - Brand settings integration for token resolution

---

## Architecture

```
┌────────────────────────────────────────────────┐
│     notifications-api Worker (Port 42075)      │
├────────────────────────────────────────────────┤
│ HTTP Request → Middleware Chain                │
│ ├─ Request Tracking (uuid, IP, User-Agent)    │
│ ├─ Logging                                      │
│ ├─ CORS                                         │
│ ├─ Security Headers                            │
│ └─ Authentication (session validation)         │
├────────────────────────────────────────────────┤
│ Route Handlers (procedure + validation)        │
│ ├─ Template CRUD (/api/templates/*)            │
│ ├─ Preview & Test-Send (/api/templates/:id/*) │
│ └─ Health Check (/health)                      │
├────────────────────────────────────────────────┤
│ Service Layer (@codex/notifications)           │
│ ├─ TemplateService - Template management      │
│ ├─ NotificationsService - Email sending       │
│ └─ TemplateRepository - Database access       │
├────────────────────────────────────────────────┤
│ Database (@codex/database)                    │
│ ├─ emailTemplates - Template storage          │
│ ├─ emailAuditLogs - Email sending audit       │
│ └─ Soft deletes (deletedAt timestamp)         │
├────────────────────────────────────────────────┤
│ Email Providers                                 │
│ ├─ ResendProvider (production)                │
│ ├─ ConsoleProvider (development)              │
│ ├─ InMemoryEmailProvider (testing)            │
│ └─ MailHogHttpProvider (integration tests)    │
└────────────────────────────────────────────────┘
```

### Data Flow

**Template Creation**:
```
1. POST /api/templates/{scope} (JSON)
   ↓ Middleware chain (auth, CORS, security headers)
   ↓ procedure() validates input (Zod schema)
   ↓ TemplateService.create{Scope}Template()
   ↓ TemplateRepository inserts into emailTemplates table
   ↓ Return 201 Created with template metadata
```

**Template Preview**:
```
1. POST /api/templates/:id/preview (with test data)
   ↓ Middleware chain (rate limit: 'strict')
   ↓ procedure() validates input + auth
   ↓ TemplateService.previewTemplateById()
   ↓ Check access (user owns or admin of org/creator)
   ↓ NotificationsService.renderTemplate()
   ↓ Substitute {{tokens}} with test data + brand defaults
   ↓ Return rendered subject/html/text without sending
```

**Test Send**:
```
1. POST /api/templates/:id/test-send (with recipient email + data)
   ↓ Middleware chain (rate limit: 'strict')
   ↓ procedure() validates input + auth
   ↓ TemplateService.checkTemplateAccess()
   ↓ Access check passes
   ↓ NotificationsService.sendEmail()
   ↓ Resolve template + brand tokens
   ↓ Render (subject, html, text)
   ↓ Send via email provider (Resend/Console/MailHog)
   ↓ Log to emailAuditLogs table
   ↓ Return SendResult with email ID/provider details
```

---

## Public API

### Template Management Endpoints

All template endpoints use `procedure()` for auth, validation, and error handling. Authentication enforced via session cookie (`codex-session`).

#### Global Templates (Platform Owner Only)

**GET /api/templates/global**
- List all global templates (platform-wide, created by platform owner)
- Policy: `auth: 'platform_owner'` - Only platform owner can list
- Query Parameters:
  - `page?: number` (default: 1) - Page number for pagination
  - `limit?: number` (default: 20, max: 100) - Items per page
  - `status?: 'active' | 'archived'` - Filter by status
  - `search?: string` - Search template name
  - `sortBy?: 'createdAt' | 'updatedAt' | 'name'` - Sort field
  - `sortOrder?: 'asc' | 'desc'` - Sort direction
- Response (200):
  ```typescript
  {
    data: {
      items: EmailTemplate[],
      pagination: {
        page: number,
        limit: number,
        total: number,
        totalPages: number
      }
    }
  }
  ```
- Errors:
  - 401 Unauthorized - Not authenticated or not platform owner
  - 400 Bad Request - Invalid query parameters

**POST /api/templates/global**
- Create a new global template (available to all users)
- Policy: `auth: 'platform_owner'` - Only platform owner can create
- Request Body:
  ```typescript
  {
    name: string;              // kebab-case, unique within scope (required)
    subject: string;           // Email subject line with {{tokens}} (required)
    htmlBody: string;          // HTML email body with {{tokens}} (required)
    textBody: string;          // Plain text fallback (required)
    description?: string;      // Optional template description
    tags?: string[];          // Optional search tags
  }
  ```
- Response (201 Created):
  ```typescript
  {
    data: {
      id: string;                        // UUID
      name: string;
      subject: string;
      htmlBody: string;
      textBody: string;
      scope: 'global';                  // Template scope
      createdBy: string;                // User ID who created
      createdAt: Date;
      updatedAt: Date;
      deletedAt: null;
    }
  }
  ```
- Errors:
  - 400 Bad Request - Schema validation failed (invalid name format, missing required fields)
  - 401 Unauthorized - Not authenticated or not platform owner
  - 409 Conflict - Template name already exists in scope

**GET /api/templates/global/:id**
- Get specific global template details
- Policy: `auth: 'platform_owner'`
- Parameters:
  - `id: string` (UUID) - Template ID
- Response (200):
  ```typescript
  {
    data: {
      id: string;
      name: string;
      subject: string;
      htmlBody: string;
      textBody: string;
      scope: 'global';
      createdBy: string;
      createdAt: Date;
      updatedAt: Date;
      description?: string;
      tags?: string[];
    }
  }
  ```
- Errors:
  - 400 Bad Request - Invalid UUID format
  - 401 Unauthorized - Not authenticated or not platform owner
  - 404 Not Found - Template deleted or doesn't exist

**PATCH /api/templates/global/:id**
- Update global template (subject, body, description, tags)
- Policy: `auth: 'platform_owner'`
- Parameters:
  - `id: string` (UUID) - Template ID
- Request Body (all optional, partial update):
  ```typescript
  {
    subject?: string;
    htmlBody?: string;
    textBody?: string;
    description?: string;
    tags?: string[];
  }
  ```
- Response (200):
  ```typescript
  {
    data: { /* Updated template */ }
  }
  ```
- Errors:
  - 400 Bad Request - Invalid UUID or schema validation failed
  - 401 Unauthorized - Not authenticated or not platform owner
  - 404 Not Found - Template doesn't exist

**DELETE /api/templates/global/:id**
- Soft delete global template (sets deletedAt timestamp)
- Policy: `auth: 'platform_owner'`
- Parameters:
  - `id: string` (UUID) - Template ID
- Response: 204 No Content (no body)
- Errors:
  - 400 Bad Request - Invalid UUID
  - 401 Unauthorized - Not authenticated or not platform owner
  - 404 Not Found - Template already deleted or doesn't exist

#### Organization Templates

**GET /api/templates/organizations/:orgId**
- List templates for organization (admin/creator only)
- Policy: `auth: 'required'` - Any authenticated user (service checks org membership)
- Parameters:
  - `orgId: string` (UUID) - Organization ID
- Query Parameters:
  - `page?: number`, `limit?: number`, `status?`, `search?`, `sortBy?`, `sortOrder?` (same as global)
- Response (200): Same paginated template list structure
- Authorization: Caller must be org member or admin (checked in service layer)
- Errors:
  - 400 Bad Request - Invalid UUID
  - 401 Unauthorized - Not authenticated
  - 403 Forbidden - Not org member
  - 404 Not Found - Organization doesn't exist

**POST /api/templates/organizations/:orgId**
- Create template for organization (org admins only)
- Policy: `auth: 'required'` - Caller must be org admin
- Parameters:
  - `orgId: string` (UUID) - Organization ID
- Request Body:
  ```typescript
  {
    name: string;
    subject: string;
    htmlBody: string;
    textBody: string;
    description?: string;
    tags?: string[];
  }
  ```
- Response (201 Created): Same as global template creation
- Authorization: Caller must be org admin
- Errors:
  - 400 Bad Request - Schema validation failed
  - 401 Unauthorized - Not authenticated
  - 403 Forbidden - Not org admin
  - 409 Conflict - Template name already exists for org

**PATCH /api/templates/organizations/:orgId/:id**
- Update organization template
- Policy: `auth: 'required'` - Org admin only
- Parameters:
  - `orgId: string` (UUID)
  - `id: string` (UUID) - Template ID
- Request Body: Same as global PATCH (all optional)
- Response (200): Updated template
- Errors:
  - 400 Bad Request - Invalid UUID or schema validation failed
  - 401 Unauthorized - Not authenticated
  - 403 Forbidden - Not org admin
  - 404 Not Found - Template or org doesn't exist

**DELETE /api/templates/organizations/:orgId/:id**
- Soft delete organization template
- Policy: `auth: 'required'` - Org admin only
- Parameters:
  - `orgId: string` (UUID)
  - `id: string` (UUID) - Template ID
- Response: 204 No Content
- Errors:
  - 400 Bad Request - Invalid UUID
  - 401 Unauthorized - Not authenticated
  - 403 Forbidden - Not org admin
  - 404 Not Found - Template doesn't exist

#### Creator Templates

**GET /api/templates/creator**
- List all templates owned by current user
- Policy: `auth: 'required', roles: ['creator']` - Authenticated creator only
- Query Parameters:
  - `page?: number`, `limit?: number`, `status?`, `search?`, `sortBy?`, `sortOrder?` (same as global)
- Response (200): Paginated template list (creator-scoped)
- Errors:
  - 401 Unauthorized - Not authenticated or not a creator
  - 400 Bad Request - Invalid query parameters

**POST /api/templates/creator**
- Create template owned by current user
- Policy: `auth: 'required', roles: ['creator']`
- Request Body:
  ```typescript
  {
    name: string;              // Unique per creator
    subject: string;
    htmlBody: string;
    textBody: string;
    description?: string;
    tags?: string[];
  }
  ```
- Response (201 Created): Created template with creator ID
- Errors:
  - 400 Bad Request - Schema validation failed
  - 401 Unauthorized - Not authenticated or not a creator
  - 409 Conflict - Template name already exists for creator

**PATCH /api/templates/creator/:id**
- Update creator's template
- Policy: `auth: 'required', roles: ['creator']`
- Parameters:
  - `id: string` (UUID) - Template ID
- Request Body: All optional (subject, htmlBody, textBody, description, tags)
- Response (200): Updated template
- Errors:
  - 400 Bad Request - Invalid UUID or schema validation
  - 401 Unauthorized - Not authenticated
  - 403 Forbidden - Not template owner
  - 404 Not Found - Template doesn't exist

**DELETE /api/templates/creator/:id**
- Soft delete creator's template
- Policy: `auth: 'required', roles: ['creator']`
- Parameters:
  - `id: string` (UUID) - Template ID
- Response: 204 No Content
- Errors:
  - 400 Bad Request - Invalid UUID
  - 401 Unauthorized - Not authenticated
  - 403 Forbidden - Not template owner
  - 404 Not Found - Template doesn't exist

### Template Preview & Test Endpoints

#### Preview Template

**POST /api/templates/:id/preview**
- Render template with test data WITHOUT sending email
- Use case: Verify template appears correctly before test-sending
- Policy: `auth: 'required', rateLimit: 'strict'` (20 requests/minute per user)
- Parameters:
  - `id: string` (UUID) - Template ID
- Request Body:
  ```typescript
  {
    data: {
      [tokenKey: string]: string | number | boolean | null
    }
  }
  ```
  Example:
  ```json
  {
    "data": {
      "userName": "Alice Johnson",
      "verificationUrl": "https://codex.io/verify?token=abc123",
      "expiryMinutes": 15
    }
  }
  ```
- Response (200):
  ```typescript
  {
    data: {
      subject: string;       // Rendered subject (tokens replaced)
      html: string;          // Rendered HTML (with brand colors, logos injected)
      text: string;          // Rendered plaintext
    }
  }
  ```
  Example:
  ```json
  {
    "data": {
      "subject": "Verify your email - Codex",
      "html": "<html><body><p>Hi Alice Johnson, <a href=\"https://codex.io/verify?token=abc123\">verify your email</a></p></body></html>",
      "text": "Hi Alice Johnson, verify at https://codex.io/verify?token=abc123"
    }
  }
  ```
- Authorization: User must own template (creator) OR be admin of template's org OR be platform owner (if global)
- Special Features:
  - Brand tokens auto-injected: `{{platformName}}`, `{{logoUrl}}`, `{{primaryColor}}`, `{{supportEmail}}`
  - XSS protection: HTML escaped in body, tags stripped from subject
  - No email sent; for visualization only
- Errors:
  - 400 Bad Request - Invalid UUID or invalid token keys (mismatch with template allowed tokens)
  - 401 Unauthorized - Not authenticated
  - 403 Forbidden - No access to template
  - 404 Not Found - Template doesn't exist
  - 422 Unprocessable Entity - Template data validation failed (missing required tokens, invalid types)
  - 429 Too Many Requests - Rate limit exceeded (20/min per user)

#### Test Send Email

**POST /api/templates/:id/test-send**
- Send test email using template (for verifying end-to-end delivery)
- Use case: Verify email sends correctly through provider (Resend/Console/MailHog)
- Policy: `auth: 'required', rateLimit: 'strict'` (20 requests/minute per user)
- Parameters:
  - `id: string` (UUID) - Template ID
- Request Body:
  ```typescript
  {
    recipientEmail: string;        // Email address to send test to (required)
    data: {                         // Template tokens (required)
      [tokenKey: string]: string | number | boolean | null
    }
  }
  ```
  Example:
  ```json
  {
    "recipientEmail": "alice@example.com",
    "data": {
      "userName": "Alice",
      "verificationUrl": "https://codex.io/verify?token=abc"
    }
  }
  ```
- Response (200):
  ```typescript
  {
    data: {
      messageId: string;           // Email message ID (from provider)
      provider: string;            // Provider used ('resend', 'console', etc.)
      status: 'pending' | 'success' | 'failed';
      sentAt: Date;
      recipientEmail: string;
    }
  }
  ```
- Authorization: Same as preview (user must own template)
- Special Features:
  - Full email render + send cycle (preview + send)
  - Brand tokens auto-injected from platform settings
  - Audit logged in emailAuditLogs table
  - Retry logic: Up to 2 retries on transient failures
  - Provider routing: Respects USE_MOCK_EMAIL, RESEND_API_KEY env vars
- Errors:
  - 400 Bad Request - Invalid email format or schema validation failed
  - 401 Unauthorized - Not authenticated
  - 403 Forbidden - No access to template
  - 404 Not Found - Template doesn't exist
  - 422 Unprocessable Entity - Template data validation failed
  - 429 Too Many Requests - Rate limit exceeded
  - 502 Bad Gateway - Email provider error (Resend API failure)
  - 503 Service Unavailable - Transient provider failure (after retries)

#### Health Check

**GET /health**
- Service health check (public endpoint)
- Response (200 or 503):
  ```typescript
  {
    status: 'healthy' | 'degraded' | 'unhealthy',
    service: 'notifications-api',
    version: '1.0.0',
    timestamp: ISO 8601 string,
    checks: {
      database: 'healthy' | 'unhealthy',
      kv_rate_limit: 'healthy' | 'unhealthy'
    }
  }
  ```
- Notes: Returns 503 if database or KV unreachable

---

## Template Management

### Template Scopes & Resolution

Templates exist in three scopes with priority resolution when sending emails:

| Scope | Owner | Visibility | Created By | Access Control |
|-------|-------|-----------|------------|-----------------|
| Global | Platform | All users | Platform owner | Platform owner only |
| Organization | Organization | Org members | Org admin/creator | Org members (read), admin (write) |
| Creator | User | User + org | Specific user | Creator (read/write) |

**Resolution Priority** (for `sendEmail(templateName, organizationId?, creatorId?)`):
1. Creator template (if `creatorId` provided and exists)
2. Organization template (if `organizationId` provided and exists)
3. Global template (if no org/creator match found)
4. NotFoundError if none exist

**Example**: Sending password reset email:
```typescript
const result = await notificationsService.sendEmail({
  templateName: 'password-reset',
  to: 'user@example.com',
  data: { resetUrl: '...' },
  organizationId: 'org-456',  // Check org templates first
  creatorId: 'user-123',      // Check creator templates second
  // Falls back to global 'password-reset' if not found in org/creator
});
```

### Template Naming

Template names must be:
- Lowercase alphanumeric + hyphens (kebab-case): `email-verification`, `password-reset`, `weekly-digest`
- 3-50 characters
- Unique within scope (cannot have two `password-reset` templates as creator, but can have one as creator and one as org)
- Used as lookup key for sending emails

### Template Tokens

Templates support variable substitution via `{{tokenName}}` syntax:

**User-Provided Tokens** (passed in sendEmail/preview `data` param):
```typescript
{
  "userName": "Alice",           // string
  "accountAge": 30,             // number
  "isPremium": true,            // boolean
  "metadata": null              // null
}
```

**Auto-Injected Brand Tokens** (resolved from platform-settings):
```typescript
{
  "platformName": "Codex",       // From defaults
  "logoUrl": "https://...",      // From org branding settings
  "primaryColor": "#0066FF",     // From org branding settings
  "supportEmail": "help@codex.io" // From org contact settings
}
```

**Security**:
- Token values HTML-escaped in rendered HTML (XSS protection)
- Subject line HTML tags stripped (subject cannot contain HTML)
- Plain text tokens not escaped (suitable for text-only emails)
- Undefined tokens are left as `{{tokenName}}` (not an error)

### Email Template Structure

Each template stores three body variants:

| Field | Purpose | Format | Rendering |
|-------|---------|--------|-----------|
| `subject` | Email subject line | Plain text with {{tokens}} | HTML tags stripped, tokens replaced |
| `htmlBody` | Full HTML email | HTML with {{tokens}} | Tokens HTML-escaped, full markup preserved |
| `textBody` | Plain text fallback | Text with {{tokens}} | Tokens not escaped, for text-only clients |

Example template:
```
name: password-reset
subject: Reset your {{platformName}} password
htmlBody: <html><body>
  <h1>Password Reset</h1>
  <p>Hi {{userName}},</p>
  <p><a href="{{resetUrl}}">Click here to reset your password</a></p>
  <p>This link expires in {{expiryMinutes}} minutes.</p>
</body></html>
textBody: Password Reset
Hi {{userName}},
Reset your password at {{resetUrl}}
This link expires in {{expiryMinutes}} minutes.
```

---

## Error Handling

All errors follow @codex/service-errors pattern with standardized HTTP mapping:

### Error Classes & HTTP Status Codes

| Error Class | HTTP Status | When Thrown | Recovery |
|------------|----------|------------|----------|
| `ValidationError` | 400 | Schema validation failed (invalid UUID, missing field, wrong type) | Fix request payload and retry |
| `NotFoundError` | 404 | Template doesn't exist or soft-deleted | Verify template exists and not archived |
| `ForbiddenError` (TemplateAccessDeniedError) | 403 | User lacks permission (not creator, not org admin, etc.) | Request access or use allowed template |
| `ConflictError` (TemplateConflictError) | 409 | Template name already exists in scope | Choose different name or update existing |
| `BusinessLogicError` | 422 | Template data validation failed (missing required tokens, invalid token types) | Provide all required tokens with correct types |
| `InternalServiceError` | 500 | Database/provider error not caused by request | Retry request; may indicate service issue |

### Error Response Format

All errors return consistent JSON structure:

```typescript
{
  "error": {
    "code": string;              // "VALIDATION_ERROR", "NOT_FOUND", etc.
    "message": string;           // Human-readable explanation
    "details": {
      [key: string]: any        // Error-specific details
    }
  },
  "requestId": string;           // Unique request ID for support
  "timestamp": ISO 8601 string
}
```

**Example**: Invalid template name
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Schema validation failed",
    "details": {
      "errors": [
        {
          "path": ["name"],
          "message": "Must be lowercase alphanumeric with hyphens",
          "code": "invalid_string"
        }
      ]
    }
  },
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-01-11T15:30:45Z"
}
```

### Common Scenarios

**Scenario: User tries to create duplicate template name**
```
POST /api/templates/creator
{ "name": "welcome-email", ... }

Response 409 Conflict:
{
  "error": {
    "code": "CONFLICT_ERROR",
    "message": "Email template name already exists in scope",
    "details": { "name": "welcome-email" }
  }
}
```

**Scenario: Invalid email in test-send**
```
POST /api/templates/abc123/test-send
{ "recipientEmail": "not-an-email", "data": {...} }

Response 400 Bad Request:
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Schema validation failed",
    "details": {
      "errors": [
        {
          "path": ["recipientEmail"],
          "message": "Invalid email",
          "code": "invalid_string"
        }
      ]
    }
  }
}
```

**Scenario: User lacks permission for template**
```
GET /api/templates/global/xyz789

Response 403 Forbidden:
{
  "error": {
    "code": "FORBIDDEN_ERROR",
    "message": "Access denied for email template",
    "details": { "templateId": "xyz789" }
  }
}
```

---

## Integration Points

### Dependencies (What This Worker Uses)

#### @codex/notifications
- **TemplateService** - Template CRUD operations with scope/access control
  - `listGlobalTemplates()`, `createGlobalTemplate()`, `getGlobalTemplate()`, `updateGlobalTemplate()`, `deleteGlobalTemplate()`
  - `listOrgTemplates()`, `createOrgTemplate()`, `updateOrgTemplate()`, `deleteOrgTemplate()`
  - `listCreatorTemplates()`, `createCreatorTemplate()`, `updateCreatorTemplate()`, `deleteCreatorTemplate()`
  - `previewTemplateById()` - Template rendering with test data
  - `checkTemplateAccess()` - Authorization check
- **NotificationsService** - Email sending
  - `sendEmail()` - Render and send email via provider
- **Error Classes** - Domain-specific errors
  - `TemplateNotFoundError`, `TemplateAccessDeniedError`, `TemplateConflictError`
- **Rendering** - Template token substitution
  - `renderTemplate()` - Token replacement with XSS protection

#### @codex/database
- **dbHttp** - HTTP client for PostgreSQL (production workers)
- **schema** - Database table definitions
  - `emailTemplates` - Template storage (id, name, subject, htmlBody, textBody, scope, creatorId, organizationId, createdBy, createdAt, updatedAt, deletedAt)
  - `emailAuditLogs` - Email sending audit log (templateName, recipientEmail, status, organizationId, creatorId, sentAt, metadata)
- **Query Helpers** - Data access patterns
  - `whereNotDeleted()` - Exclude soft-deleted records
  - `withPagination()` - Pagination helpers

#### @codex/worker-utils
- **createWorker()** - Standardized Hono app setup with middleware chain
  - Includes request tracking, CORS, security headers, health checks
- **procedure()** - tRPC-style route handler factory
  - Combines auth policy, input validation, service execution, error handling
  - Automatic error-to-HTTP mapping

#### @codex/validation
- Zod schemas for request validation
  - `createGlobalTemplateSchema`, `createOrgTemplateSchema`, `createCreatorTemplateSchema`
  - `updateTemplateSchema` - Shared update schema (partial fields)
  - `listTemplatesQuerySchema` - Pagination + filtering
  - `previewTemplateSchema` - Test data validation
  - `testSendTemplateSchema` - Email + test data validation
  - `createIdParamsSchema()` - UUID parameter validation

#### @codex/security
- **rate limiting** - KV-backed request rate limiting
  - 'strict' preset: 20 requests/minute per user (for preview/test-send)
  - 'api' preset: 100 requests/minute per user (for CRUD)
- **securityHeaders()** - Security headers middleware
  - CSP, X-Frame-Options, X-Content-Type-Options, HSTS
- **requireAuth()** - Session validation from cookies

#### @codex/platform-settings
- **BrandingSettingsService** - Organization branding resolution
  - `get()` - Fetch org branding (colors, logos)
- **ContactSettingsService** - Organization contact settings
  - `get()` - Fetch support email, contact info

### Dependents (What Uses This Worker)

The notifications-api worker is used by:

1. **Frontend Applications** (via HTTP)
   - Template management UI (for admins/creators)
   - Template preview UI (before sending)
   - Notification system settings

2. **Other Workers** (via worker-to-worker calls or HTTP)
   - Auth Worker - Verification emails
   - Content-API Worker - Content notifications
   - Identity-API Worker - Org notifications

3. **Admin Dashboards**
   - Email template administration
   - Template testing

### Data Flow Examples

**Example 1: Platform Owner Creates Verification Email Template**
```
Frontend POST /api/templates/global
├─ Payload: { name: 'email-verification', subject: '...', htmlBody: '...', textBody: '...' }
├─ Middleware: Auth (platform_owner check), CORS, security headers
├─ procedure() validates schema
├─ TemplateService.createGlobalTemplate(input, userId)
├─ Insert into emailTemplates table (scope='global', organizationId=null, creatorId=null)
└─ Response 201 Created with template metadata

Later: Service needs to send verification email
├─ Auth Worker calls: await notificationsService.sendEmail({
│   templateName: 'email-verification',
│   to: 'newuser@example.com',
│   data: { verificationUrl: '...' }
│ })
├─ NotificationsService resolves global 'email-verification' template
├─ Renders with brand tokens injected
├─ Sends via Resend provider
└─ Logs to emailAuditLogs table
```

**Example 2: Creator Creates Org-Specific Confirmation Template**
```
Frontend POST /api/templates/organizations/org-789
├─ Payload: { name: 'purchase-confirmation', subject: '...', ... }
├─ Middleware: Auth (org member check), CORS, security headers, rate limit
├─ procedure() validates schema
├─ TemplateService.createOrgTemplate(orgId, userId, input)
├─ Service checks org membership (caller must be member)
├─ Insert into emailTemplates (scope='organization', organizationId='org-789')
└─ Response 201 Created

Later: When purchase made in that org
├─ ContentAccessService calls: await notificationsService.sendEmail({
│   templateName: 'purchase-confirmation',
│   to: customer@example.com',
│   data: { purchaseTitle: '...', amount: '...' },
│   organizationId: 'org-789'
│ })
├─ NotificationsService searches org templates first
├─ Finds 'purchase-confirmation' for org-789
├─ Resolves org branding (colors, logo, support email)
├─ Renders with org colors + customer data
├─ Sends via Resend
└─ Audit logged with organizationId='org-789'
```

**Example 3: Template Preview (No Send)**
```
Frontend POST /api/templates/abc123/preview
├─ Payload: { data: { userName: 'Test User', resetUrl: '...' } }
├─ Middleware: Auth (creator check), rate limit (strict)
├─ procedure() validates input
├─ TemplateService.previewTemplateById(templateId, userId, role, data, notificationsService)
├─ Service checks user owns template or is admin
├─ NotificationsService.renderTemplate() (no send)
├─ Returns rendered subject/html/text
└─ Response 200 with preview (for UI to display)
```

---

## Security Model

### Authentication

All endpoints except `/health` require session authentication via HTTP-only cookie `codex-session`.

**Session Flow**:
1. User logs in via Auth Worker (returns session cookie)
2. Browser stores `codex-session` cookie (HttpOnly, Secure, SameSite=Strict)
3. Client makes request to notifications-api with cookie
4. middleware checks session validity via Auth Worker's GET /api/auth/session
5. Session cached in AUTH_SESSION_KV (5min TTL) to reduce lookups
6. Route proceeds with authenticated user context

### Authorization

Each template endpoint enforces role-based access control:

| Endpoint | Policy | Check |
|----------|--------|-------|
| Global CRUD | `auth: 'platform_owner'` | Caller.role === 'platform_owner' |
| Org CRUD | `auth: 'required'` | Caller is org member (for read), org admin (for write) |
| Creator CRUD | `auth: 'required', roles: ['creator']` | Caller.role.includes('creator') |
| Preview/Test | `auth: 'required'` | Caller owns template OR is org admin OR is platform owner |

**Template Ownership Check**:
```typescript
// Creator template: creator_id === user.id
// Org template: org members can read, org admins can write
// Global template: platform owner only
```

### Rate Limiting

Rate limits enforced by Cloudflare KV:

| Endpoint | Limit | Key | Purpose |
|----------|-------|-----|---------|
| /api/templates/* (CRUD) | 100/min | User ID | Fair usage for management |
| /api/templates/:id/preview | 20/min | User ID | Prevent preview abuse |
| /api/templates/:id/test-send | 20/min | User ID | Prevent spam via test emails |

Returns `429 Too Many Requests` when exceeded.

### Input Validation

All inputs validated via Zod schemas before reaching service layer:

**Template Name Validation**:
- Lowercase alphanumeric + hyphens (kebab-case)
- 3-50 characters
- Prevents SQL injection, XSS via naming

**Email Validation**:
- RFC 5322 compliant email format
- Prevents invalid emails from being sent

**Template Body Validation**:
- Subject: Plain text (HTML tags stripped on render)
- HTML Body: Any HTML allowed (tokens escaped on render)
- Text Body: Plain text (tokens not escaped)
- Prevents script injection via token substitution

**Template Data Validation**:
- User-provided tokens validated for required keys
- Values must be string, number, boolean, or null
- Prevents type coercion attacks

### PII Handling

**What's Protected**:
- Email addresses - Not logged in request/response bodies (redacted in logs)
- User names - Only returned to authenticated user viewing their own templates
- Template content - Treated as sensitive (not exposed to unauthorized users)

**What's Logged**:
- Template operations (CRUD actions, user who created/updated)
- Email sending audit log (template name, recipient email in plaintext, status, timestamp)
- Error details (without request bodies)

**Audit Log Retention**:
- All email sends logged to `emailAuditLogs` table
- Retention policy: Configurable (typically 90 days)
- Used for compliance, troubleshooting, spam detection

### CORS & Security Headers

Applied to all responses:

| Header | Value | Purpose |
|--------|-------|---------|
| Access-Control-Allow-Origin | Configured domain | CORS origin control |
| X-Content-Type-Options | nosniff | Prevent MIME sniffing |
| X-Frame-Options | SAMEORIGIN | Prevent clickjacking |
| Referrer-Policy | strict-origin-when-cross-origin | Referrer leak prevention |
| Content-Security-Policy | Configured | Script execution control |
| Strict-Transport-Security | max-age=31536000 (prod) | Force HTTPS in production |

---

## Testing

### Unit & Integration Tests

Test files use Cloudflare Workers runtime via `cloudflare:test` module.

**Test Setup** (`src/index.test.ts`):
```typescript
import { SELF } from 'cloudflare:test';

describe('Notifications API Worker', () => {
  it('should return health check response', async () => {
    const response = await SELF.fetch('http://localhost/health');
    expect([200, 503]).toContain(response.status);
  });

  it('should include security headers', async () => {
    const response = await SELF.fetch('http://localhost/health');
    expect(response.headers.get('x-content-type-options')).toBeDefined();
  });
});
```

**Route Tests** (`src/routes/__tests__/templates.test.ts`):
```typescript
describe('Template Routes', () => {
  it('GET /api/templates/global requires authentication', async () => {
    const response = await SELF.fetch('http://localhost/api/templates/global');
    expect([401, 500]).toContain(response.status);
  });

  it('rejects invalid template name format', async () => {
    const response = await SELF.fetch(
      'http://localhost/api/templates/global',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'invalid name!',  // Invalid format
          subject: 'Test',
          htmlBody: '<p>Test</p>',
          textBody: 'Test'
        })
      }
    );
    expect([400, 401, 500]).toContain(response.status);
  });
});
```

### Running Tests

```bash
# Run all tests once
pnpm test

# Run in watch mode (re-run on file changes)
pnpm test:watch

# Run with UI
pnpm test:ui

# Run specific test file
pnpm test -- templates.test.ts

# Run with coverage
pnpm test:coverage
```

### Testing Patterns

**Pattern 1: Test Unauthenticated Requests**
```typescript
it('should return 401 for unauthenticated request', async () => {
  const response = await SELF.fetch('http://localhost/api/templates/creator');
  expect(response.status).toBe(401);
});
```

**Pattern 2: Test Schema Validation**
```typescript
it('should reject invalid UUID in params', async () => {
  const response = await SELF.fetch(
    'http://localhost/api/templates/not-a-uuid/preview',
    { method: 'POST', body: JSON.stringify({ data: {} }) }
  );
  expect([400, 401, 500]).toContain(response.status);
});
```

**Pattern 3: Test Missing Required Fields**
```typescript
it('should reject missing required fields', async () => {
  const response = await SELF.fetch(
    'http://localhost/api/templates/global',
    {
      method: 'POST',
      body: JSON.stringify({ name: 'test' }) // Missing subject, htmlBody, textBody
    }
  );
  expect([400, 401, 500]).toContain(response.status);
});
```

### Integration Testing with @codex/notifications

For testing template sending (requires @codex/notifications):

```typescript
import { InMemoryEmailProvider } from '@codex/notifications';

const emailProvider = new InMemoryEmailProvider();
const service = new NotificationsService({ db, emailProvider, ... });

// Send test email
await service.sendEmail({
  templateName: 'welcome',
  to: 'test@example.com',
  data: { userName: 'Test User' }
});

// Assert email was sent
expect(emailProvider.count).toBe(1);
expect(emailProvider.getLastEmail()?.message.to).toBe('test@example.com');
```

---

## Development & Deployment

### Local Development

**Start Worker** (port 42075):
```bash
cd workers/notifications-api
pnpm install      # First time only
pnpm dev          # Starts on http://localhost:42075
```

**Environment Variables** (`.env.local` or `.dev.vars`):
```
ENVIRONMENT=development
DATABASE_URL=postgresql://user:pass@localhost:5432/codex_dev
FROM_EMAIL=noreply@localhost
FROM_NAME=Codex Dev
USE_MOCK_EMAIL=true           # Log emails to console instead of sending
AUTH_SESSION_KV=<test-namespace>
RATE_LIMIT_KV=<test-namespace>
```

### Testing Locally

**List Templates**:
```bash
curl -H "Cookie: codex-session=<session-token>" \
  http://localhost:42075/api/templates/creator
```

**Create Template**:
```bash
curl -X POST http://localhost:42075/api/templates/creator \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=<session-token>" \
  -d '{
    "name": "welcome-email",
    "subject": "Welcome to {{platformName}}, {{userName}}!",
    "htmlBody": "<p>Hi {{userName}}, welcome!</p>",
    "textBody": "Hi {{userName}}, welcome!"
  }'
```

**Preview Template**:
```bash
curl -X POST http://localhost:42075/api/templates/abc123/preview \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=<session-token>" \
  -d '{
    "data": {
      "userName": "Alice",
      "platformName": "Codex"
    }
  }'
```

**Test Send Email**:
```bash
curl -X POST http://localhost:42075/api/templates/abc123/test-send \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=<session-token>" \
  -d '{
    "recipientEmail": "test@example.com",
    "data": {
      "userName": "Alice"
    }
  }'
```

### Staging Deployment

```bash
# Deploy to staging
wrangler deploy --env staging

# Verify staging endpoint
curl -H "Cookie: codex-session=<token>" \
  https://notifications-api-staging.revelations.studio/api/templates/creator
```

### Production Deployment

```bash
# Requires all tests passing + code review
pnpm test  # Verify tests pass

# Deploy to production
wrangler deploy --env production

# Verify production endpoint
curl -H "Cookie: codex-session=<token>" \
  https://notifications-api.revelations.studio/api/templates/creator

# Monitor health
curl https://notifications-api.revelations.studio/health
```

### Environment Variables by Stage

**Development** (`.env.local`):
```
ENVIRONMENT=development
DATABASE_URL=postgresql://localhost:5432/codex_dev
USE_MOCK_EMAIL=true
FROM_EMAIL=dev@localhost
FROM_NAME=Codex Dev
RATE_LIMIT_KV=test-kv
AUTH_SESSION_KV=test-kv
```

**Staging** (wrangler.jsonc + secrets):
```
ENVIRONMENT=staging
DATABASE_URL=<neon-staging-url>  # Secret
RESEND_API_KEY=re_test_...       # Secret
FROM_EMAIL=noreply@codex-staging.io
FROM_NAME=Codex Staging
RATE_LIMIT_KV=rate-limit-staging
AUTH_SESSION_KV=auth-session-staging
```

**Production** (wrangler.jsonc + secrets):
```
ENVIRONMENT=production
DATABASE_URL=<neon-prod-url>  # Secret
RESEND_API_KEY=re_live_...    # Secret
FROM_EMAIL=noreply@codex.io
FROM_NAME=Codex
RATE_LIMIT_KV=rate-limit-prod
AUTH_SESSION_KV=auth-session-prod
```

---

## Critical Implementation Details

### Multi-Scope Template Resolution

Templates can exist in multiple scopes. When sending an email, resolution follows priority order:

```typescript
async sendEmail(params: SendEmailParams) {
  const { templateName, organizationId, creatorId } = params;

  // 1. Check creator scope (highest priority)
  if (creatorId) {
    const template = await this.findCreatorTemplate(templateName, creatorId);
    if (template) return this.send(template);
  }

  // 2. Check organization scope
  if (organizationId) {
    const template = await this.findOrgTemplate(templateName, organizationId);
    if (template) return this.send(template);
  }

  // 3. Check global scope (fallback)
  const template = await this.findGlobalTemplate(templateName);
  if (template) return this.send(template);

  // 4. Not found
  throw new TemplateNotFoundError(templateName);
}
```

This enables organizations to override global templates with custom versions.

### Brand Token Injection

Organization branding automatically injected into emails:

```typescript
// 1. Load organization settings (cached, 5min TTL)
const brandingService = new BrandingSettingsService({
  organizationId: 'org-123'
});
const branding = await brandingService.get();

// 2. Merge with brand defaults
const brandTokens = {
  platformName: 'Codex',
  primaryColor: branding.primaryColorHex || '#000000',
  logoUrl: branding.logoUrl || '',
  supportEmail: branding.supportEmail || 'support@codex.io'
};

// 3. Merge with user data
const allTokens = { ...brandTokens, ...userData };

// 4. Render (tokens escaped to prevent XSS)
const html = renderTemplate(template.htmlBody, allTokens);
```

### Email Provider Abstraction

Worker uses pluggable email providers:

| Provider | Environment | Use Case |
|----------|-------------|----------|
| ResendProvider | Production | Real email sending via Resend API |
| ConsoleProvider | Development | Logs emails to console (stdout) |
| InMemoryEmailProvider | Testing | Stores emails in memory for assertions |
| MailHogHttpProvider | Integration Tests | HTTP stub (not implemented yet) |

Provider selected via environment variables:
```typescript
const emailProvider = createEmailProvider({
  useMock: env.USE_MOCK_EMAIL === 'true',
  resendApiKey: env.RESEND_API_KEY
});
```

### Audit Logging

All email sends logged to database for compliance:

```typescript
INSERT INTO emailAuditLogs (
  templateName,
  recipientEmail,
  organizationId,
  creatorId,
  status,        // 'pending' | 'success' | 'failed'
  metadata,      // Template tokens (JSON)
  sentAt
)
```

Used for:
- Compliance/legal holds
- Debugging delivery issues
- Spam/abuse detection
- Cost tracking (emails sent per org)

### Retry Logic

Email sends retry up to 2 times on transient failures:

```typescript
async sendWithRetry(message, retryConfig = DEFAULT_RETRY_CONFIG) {
  let lastError;
  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      return await this.emailProvider.send(message);
    } catch (error) {
      lastError = error;
      if (attempt < retryConfig.maxRetries) {
        const backoffMs = retryConfig.initialBackoffMs * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }
  throw lastError;
}
```

Prevents temporary provider outages from blocking email sends.

---

## File Structure

```
workers/notifications-api/
├── src/
│   ├── index.ts                 # Main worker setup + middleware
│   ├── index.test.ts            # Health check tests
│   ├── routes/
│   │   ├── templates.ts         # Template CRUD routes
│   │   ├── preview.ts           # Preview & test-send routes
│   │   └── __tests__/
│   │       └── templates.test.ts # Route tests
│   ├── tsconfig.json
│   └── ...config files
├── package.json                 # Port 42075, dependencies
├── wrangler.jsonc              # Cloudflare Worker config
├── vite.config.ts              # Build config
├── vitest.config.ts            # Test config
└── CLAUDE.md                   # THIS FILE

Critical Source Files:

packages/notifications/
├── src/
│   ├── services/
│   │   ├── template-service.ts     # Template CRUD logic + scoping
│   │   ├── notifications-service.ts # Email sending + rendering
│   │   └── branding-cache.ts       # Brand token caching
│   ├── repositories/
│   │   └── template-repository.ts  # Database queries
│   ├── templates/
│   │   └── renderer.ts             # Token substitution + XSS protection
│   ├── providers/
│   │   ├── resend-provider.ts      # Resend API integration
│   │   ├── console-provider.ts     # Console logging
│   │   ├── in-memory-provider.ts   # Testing
│   │   └── types.ts                # Email interfaces
│   ├── errors.ts                   # Domain-specific errors
│   ├── types.ts                    # Type definitions
│   └── index.ts                    # Public exports
└── CLAUDE.md
```

---

## Summary

The notifications-api worker provides centralized email template management for the Codex platform with:

- **Three-scope template system**: Global (platform), Organization (team), Creator (personal)
- **Safe email rendering**: XSS protection, token substitution, brand injection
- **Provider abstraction**: Resend (production), Console (dev), InMemory (tests)
- **Complete REST API**: CRUD for all scopes, preview without sending, test sends
- **Security**: Session auth, role-based access control, rate limiting, audit logging
- **Reliability**: Retry logic, transaction safety, error handling

Key architectural patterns:
1. **procedure()** unifies auth → validation → service → error handling
2. **TemplateService** handles all scope-specific logic and access control
3. **NotificationsService** orchestrates rendering, branding, and sending
4. **Multi-scope resolution** enables org/creator overrides of global templates
5. **Audit logging** for compliance and troubleshooting

Critical files:
- `/workers/notifications-api/src/index.ts` - Worker setup
- `/workers/notifications-api/src/routes/templates.ts` - Template CRUD endpoints
- `/workers/notifications-api/src/routes/preview.ts` - Preview/test-send endpoints
- `/packages/notifications/src/services/template-service.ts` - Template business logic
- `/packages/notifications/src/services/notifications-service.ts` - Email sending logic
