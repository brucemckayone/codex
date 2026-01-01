# Codex Workers Architecture & Documentation

## Overview

Codex Workers are Cloudflare Workers-based microservices that form the API layer of the Codex platform. They handle HTTP requests, authenticate users, enforce authorization, validate input, and coordinate with service packages to execute business logic. All workers follow a consistent architecture pattern: request → middleware chain → route handlers → services → database/external services → response.

Workers are organized by business responsibility:
- **Auth Worker** (42069): User authentication, session management, email verification
- **Content-API Worker** (4001): Content CRUD, media lifecycle, access control, streaming
- **Identity-API Worker** (42071): Organizations, user identity management
- **Stripe Webhook Handler** (42072): Payment processing webhook events

## Quick Navigation - By Use Case

| What You Need | Worker | Endpoints | Key Services |
|---|---|---|---|
| **User Registration/Login** | Auth | POST /api/auth/email/register, POST /api/auth/email/login | BetterAuth, session management |
| **Session Validation** | Auth | GET /api/auth/session | BetterAuth session lookup |
| **Create Content** | Content-API | POST /api/content | ContentService |
| **Manage Videos/Audio** | Content-API | POST /api/media, PATCH /api/media/:id | MediaItemService |
| **Generate Streaming URL** | Content-API | GET /api/access/streaming-url/:contentId | ContentAccessService, R2 signed URLs |
| **Create Organization** | Identity-API | POST /api/organizations | OrganizationService |
| **Verify Payment** | Stripe Webhook | POST /webhooks/stripe/payment | Stripe signature verification |
| **Check Health** | Any | GET /health | Database, KV, R2 status |

---

## Workers Overview

### 1. Auth Worker

**Purpose**: Centralized authentication and session management for Codex. Handles user registration, login, email verification, session validation, and password reset. Built on BetterAuth framework with session caching via KV.

**Deployment Target**: `auth.revelations.studio` (production), local port 42069 (dev)

**Primary Responsibility**: User authentication, session lifecycle, email verification, password reset

**Key Endpoints**:
- `POST /api/auth/email/register` - User registration
- `POST /api/auth/email/login` - User login (rate limited: 10/15min per IP)
- `GET /api/auth/session` - Get current authenticated user
- `POST /api/auth/signout` - Invalidate session
- `POST /api/auth/email/verify-email` - Email verification
- `POST /api/auth/email/send-reset-password-email` - Password reset request
- `POST /api/auth/email/reset-password` - Complete password reset

**Key Packages**:
- `@codex/database` - PostgreSQL via Drizzle ORM (user/session/token tables)
- `@codex/security` - Rate limiting, security headers, password hashing
- `@codex/worker-utils` - Health checks, error handling, middleware
- `@codex/shared-types` - SessionData, UserData type definitions

**Database Tables Used**:
- `users` - User accounts with email/password credentials
- `sessions` - Active user sessions with expiry
- `verificationTokens` - Email verification and password reset tokens

**External Services**:
- Neon PostgreSQL (via connection pooling)
- Cloudflare KV (AUTH_SESSION_KV for session caching)
- Cloudflare KV (RATE_LIMIT_KV for login rate limiting)

---

### 2. Content-API Worker

**Purpose**: RESTful API for content lifecycle management, media handling, and access control. Enables creators to manage videos/audio content, track media status (uploading → transcoding → ready), publish/unpublish workflows, and generate time-limited streaming URLs for authenticated users with purchase/membership validation.

**Deployment Target**: `content-api.revelations.studio` (production), local port 4001 (dev)

**Primary Responsibility**: Content CRUD, media lifecycle, access control, streaming URL generation, playback progress tracking

**Key Endpoints**:
- `POST /api/content` - Create content
- `GET /api/content/:id` - Get content details
- `PATCH /api/content/:id` - Update content
- `POST /api/content/:id/publish` - Publish content
- `POST /api/content/:id/unpublish` - Unpublish content
- `DELETE /api/content/:id` - Delete content
- `GET /api/content/:creatorId/list` - List creator's content
- `POST /api/media` - Upload media item
- `GET /api/media/:id` - Get media details
- `PATCH /api/media/:id` - Update media status
- `GET /api/access/streaming-url/:contentId` - Get time-limited R2 streaming URL
- `POST /api/access/playback-progress/:contentId` - Track playback position

**Key Packages**:
- `@codex/content` - ContentService, MediaItemService, ContentAccessService
- `@codex/database` - PostgreSQL (content, mediaItems, contentAccess tables)
- `@codex/security` - Authentication middleware, rate limiting
- `@codex/worker-utils` - Health checks, error handling, middleware
- `@codex/validation` - Zod request body schemas
- `@codex/access` - Authorization/scoping logic for content access

**Database Tables Used**:
- `content` - Content items (metadata, visibility, pricing)
- `mediaItems` - Media files (transcoding status, S3 keys, metadata)
- `contentAccess` - Purchase/access records (tracks who bought/has access)
- `playbackProgress` - User playback position for resume functionality

**External Services**:
- Neon PostgreSQL (content/media/access data)
- Cloudflare R2 (MEDIA_BUCKET for media file storage and streaming)
- Cloudflare KV (RATE_LIMIT_KV for API rate limiting)

---

### 3. Identity-API Worker

**Purpose**: Organization and identity management API. Provides endpoints for creating, reading, updating, and deleting organizations with slug-based lookup, availability checking, and filtering. Supports multi-tenant scoping with secure slug uniqueness validation.

**Deployment Target**: `identity-api.revelations.studio` (production), local port 42071 (dev)

**Primary Responsibility**: Organization management, identity/profile data, multi-tenant isolation

**Key Endpoints**:
- `POST /api/organizations` - Create organization (authenticated)
- `GET /api/organizations/:id` - Get organization by ID
- `GET /api/organizations/slug/:slug` - Get organization by slug
- `GET /api/organizations/check-slug/:slug` - Check slug availability
- `PATCH /api/organizations/:id` - Update organization (authenticated)
- `DELETE /api/organizations/:id` - Delete organization (authenticated)
- `GET /api/organizations` - List organizations with pagination/filtering

**Key Packages**:
- `@codex/identity` - OrganizationService for org management
- `@codex/database` - PostgreSQL (organizations table)
- `@codex/security` - Authentication, rate limiting
- `@codex/worker-utils` - Health checks, error handling, middleware
- `@codex/validation` - Zod schemas for organization data

**Database Tables Used**:
- `organizations` - Organization profiles (name, slug, description, branding)
- `organizationMembers` - User membership in organizations (implicit via content scoping)

**External Services**:
- Neon PostgreSQL (organization data)
- Cloudflare KV (RATE_LIMIT_KV for API rate limiting)

---

### 4. Ecom-API Worker (formerly Stripe Webhook Handler)

**Purpose**: Processes Stripe webhook events with cryptographic signature verification, comprehensive observability, and rate limiting. Acts as entry point for all Stripe payment, subscription, customer, and dispute events. Coordinates with @codex/purchase service for recording purchases. No user authentication required; Stripe HMAC-SHA256 signature verification prevents spoofing.

**Deployment Target**: `ecom-api.revelations.studio` (production), local port 42072 (development)

**Primary Responsibility**: E-commerce API (checkout creation), payment webhook processing, purchase recording, signature verification, event logging

**Key Endpoints**:
- `POST /checkout/create` - Create Stripe Checkout session for paid content (auth required)
- `POST /webhooks/stripe/booking` - Checkout session completed events (creates purchases, idempotent)
- `POST /webhooks/stripe/payment` - Payment intent and charge events (for future phases)
- `POST /webhooks/stripe/subscription` - Subscription lifecycle events (for future phases)
- `POST /webhooks/stripe/customer` - Customer account events (for future phases)
- `POST /webhooks/stripe/connect` - Connect account events (for future phases)
- `POST /webhooks/stripe/dispute` - Dispute and fraud events (for future phases)
- `GET /health` - Service health check

**Key Packages**:
- `@codex/purchase` - PurchaseService for checkout & purchase completion
- `@codex/security` - Stripe signature verification, rate limiting, authentication
- `@codex/observability` - Event logging and observability
- `@codex/worker-utils` - Health checks, error handling, middleware, authenticated handler
- `@codex/database` - PostgreSQL for purchases and webhook logs
- `@codex/validation` - Input validation for checkout requests

**External Services**:
- Stripe API (checkout sessions, payment intents, signature verification via STRIPE_SECRET_KEY & STRIPE_WEBHOOK_SECRET_BOOKING)
- Neon PostgreSQL (purchases table, webhook event logs)
- Cloudflare KV (RATE_LIMIT_KV for rate limiting)

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        External Services                             │
│                                                                       │
│   Stripe              Neon PostgreSQL        Cloudflare R2           │
│   (webhook           (users, content,      (media files,           │
│   events)            media, org data)      streaming)              │
│                                                                       │
└────────┬──────────────────────────┬──────────────────────────┬──────┘
         │                          │                          │
         │                          │                          │
┌────────▼────────────┐   ┌─────────▼──────────────┐   ┌─────▼──────┐
│  Auth Worker        │   │  Content-API Worker    │   │ Identity    │
│  (42069)            │   │  (4001)                │   │ Worker      │
│                     │   │                        │   │ (42071)     │
│ - Register          │   │ - Create content       │   │             │
│ - Login             │   │ - Manage media         │   │ - Orgs CRUD │
│ - Session mgmt      │   │ - Streaming URLs       │   │ - Org lookup│
│ - Email verify      │   │ - Access control       │   │ - Slug check│
│ - Password reset    │   │ - Playback tracking    │   │             │
│                     │   │                        │   │             │
└────────┬────────────┘   └─────────┬──────────────┘   └─────┬───────┘
         │                          │                        │
         │◄─ Session validation ───┤                        │
         │                          │                        │
         │  (GET /api/auth/session)├──────────────────────►│
         │                          │   Get user identity   │
         │                          │                        │
         └──────────────────┬───────┴────────────────────────┘
                            │
                    Cloudflare KV
              (Sessions, rate limits)
                            │
┌───────────────────────────▼─────────────────────────────┐
│            Ecom-API Worker (42072)                      │
│                                                         │
│ Checkout Flow:                                         │
│  - POST /checkout/create                              │
│  - Validate session (Auth Worker)                     │
│  - PurchaseService.createCheckoutSession()            │
│  - Return Stripe checkout URL                         │
│                                                         │
│ Webhook Flow:                                          │
│  - POST /webhooks/stripe/booking                      │
│  - Signature Verification (HMAC-SHA256)               │
│  - Extract checkout.session.completed event           │
│  - PurchaseService.completePurchase()                 │
│  - Create purchase record (idempotent)                │
│  - Grant access via contentAccess table               │
│  - Return 200 OK (prevent Stripe retries)             │
│  ↓                                                      │
│ Event Logs → PostgreSQL                               │
└─────────────────────────────────────────────────────────┘
```

**Data Flow Notes**:
- All workers validate session cookie via Auth Worker's GET /api/auth/session
- Auth Worker caches sessions in KV (5min TTL) to reduce database load
- Content Worker generates signed R2 URLs for streaming (time-limited access)
- Stripe Webhook Handler receives events without user context (verified via signature only)
- All workers apply rate limiting via KV namespace (different limits per endpoint)

---

## Security Model Across Workers

### Authentication

**Layer 1: User Authentication (Auth Worker)**
- Email/password credentials validated via BetterAuth
- Passwords hashed with bcrypt before storage
- Sessions created and stored in PostgreSQL
- Session cookie `codex-session` set with HttpOnly, Secure, SameSite=Strict flags

**Layer 2: Session Validation (Other Workers)**
- Incoming requests extract `codex-session` cookie
- Call Auth Worker's GET /api/auth/session to validate session
- Cached in AUTH_SESSION_KV (5min TTL) to reduce database queries
- Session context variables set in Hono context (c.get('session'), c.get('user'))

**Layer 3: Stripe Webhook Authentication (Webhook Handler)**
- Stripe HMAC-SHA256 signature verification
- Signature in stripe-signature header verified against STRIPE_SECRET_KEY
- No session required; signature acts as authentication

### Authorization

**Creator/Owner Scoping**:
- Content, media, and access records scoped by `creatorId`
- Organization records scoped by `creatorId` (who created org)
- Users can only read/modify resources they own

**Organization Scoping**:
- Content can be owned by organization (organizationId field)
- Only org members can access org-owned content
- Identity Worker enforces org membership

**Access Control Levels** (Content-API):
- `public`: Anyone can view (no purchase/membership required)
- `purchased_only`: User must own purchase record
- `members_only`: User must be org member

### Rate Limiting

**Per-Endpoint Limits** (via Cloudflare KV):
| Endpoint | Limit | Key | Purpose |
|---|---|---|---|
| Auth login | 10/15min | IP address | Prevent brute force |
| Auth register | 10/15min | IP address | Prevent spam |
| API (content, orgs) | 100/min | User ID | Fair usage |
| Stripe webhooks | 1000/min | IP address | High throughput |

**Behavior**: Returns 429 Too Many Requests when exceeded

### Input Validation

**JSON Schema Validation** (Zod):
- All POST/PATCH bodies validated before service instantiation
- Returns 400 Bad Request if schema validation fails
- Returns 422 Unprocessable Entity for business rule violations

**Security Headers** (Applied to all workers):
| Header | Value | Purpose |
|---|---|---|
| X-Content-Type-Options | nosniff | Prevent MIME sniffing |
| X-Frame-Options | SAMEORIGIN | Clickjacking prevention |
| Referrer-Policy | strict-origin-when-cross-origin | Referrer leakage prevention |
| Content-Security-Policy | Varies | Script/resource execution control |
| Strict-Transport-Security | max-age=31536000 | Force HTTPS (production) |

### PII Handling

- **Passwords**: Never logged or exposed. Hashed via bcrypt. Not returned in API responses.
- **Email**: Stored plaintext in database. Not included in error messages. Returned only to authenticated user for their own profile.
- **User Data**: Returned in responses only to authenticated users for resources they own or have access to.
- **Logs**: All PII redacted by observability middleware (request/response bodies stripped).

---

## Data Flow Patterns

### Pattern 1: User Registration and Login

**Flow**:
```
1. Client: POST /api/auth/email/register
   ↓ Auth Worker middleware chain
2. JSON validation (Zod if enabled)
3. BetterAuth: Hash password with bcrypt
4. BetterAuth: Insert user into PostgreSQL users table
5. BetterAuth: Create session → PostgreSQL sessions table
6. Session Cache Middleware: Cache session in AUTH_SESSION_KV (5min TTL)
7. Auth Worker: Return user + session + Set-Cookie header
8. Client: Store codex-session cookie, make authenticated requests
```

**Involved Workers**: Auth Worker only

**Services Used**: BetterAuth (handles full lifecycle)

**Key Databases**: users table, sessions table

---

### Pattern 2: Create Content → Publish → Stream

**Flow**:
```
1. Creator: POST /api/content (with mediaItemId and visibility)
   ↓ Content-API Worker
2. Validate session via Auth Worker GET /api/auth/session
3. ContentService: Validate input, check media item exists
4. ContentService: Insert content → PostgreSQL content table
5. Response: Return content with status=draft

   ↓ Creator: Upload media (file → R2)

6. Creator: PATCH /api/media/:id (update status to ready)
   ↓ Content-API Worker
7. MediaItemService: Update status to 'ready' → PostgreSQL

   ↓ Creator: Publish content

8. Creator: POST /api/content/:id/publish
   ↓ Content-API Worker
9. ContentService: Check media status is 'ready'
10. ContentService: Update content status=published, set publishedAt → PostgreSQL

    ↓ Viewer: Request streaming URL

11. Viewer: GET /api/access/streaming-url/:contentId
    ↓ Content-API Worker
12. Validate session (viewer is authenticated)
13. ContentAccessService: Check content visibility
    - If public: Grant access
    - If purchased_only: Check contentAccess table for purchase record
    - If members_only: Check org membership
14. ContentAccessService: Generate signed R2 URL (time-limited, 1hr expiry)
15. Response: Return streaming URL
16. Viewer: Use URL to fetch video from R2
```

**Involved Workers**: Auth Worker (session validation), Content-API Worker (main logic)

**Services Used**: ContentService, MediaItemService, ContentAccessService

**Key Databases**: content table, mediaItems table, contentAccess table (purchases)

**External Services**: R2 (storage), Auth Worker (session validation)

---

### Pattern 3: User Purchases Content

**Flow**:
```
1. Viewer: Attempts to view purchased-only content
   ↓ Content-API Worker
2. GET /api/access/streaming-url/:contentId
3. ContentAccessService: Check visibility = purchased_only
4. ContentAccessService: Query contentAccess table
   WHERE userId = currentUser.id AND contentId = :contentId
5. No record found → Access denied
6. Return 403 Forbidden

   ↓ Stripe: Payment processing (external to Codex)

7. Viewer completes payment via Stripe Checkout
8. Stripe: Sends charge.succeeded webhook event

   ↓ Stripe Webhook Handler

9. POST /webhooks/stripe/payment (event type: charge.succeeded)
10. Verify Stripe signature (HMAC-SHA256)
11. Log event to PostgreSQL webhook_events table
12. Extract charge metadata (userId, contentId, priceCents)
13. Service: Insert record into contentAccess table
    - userId, contentId, purchaseId, priceCents, purchasedAt
14. Return 200 OK to Stripe

    ↓ Viewer: Retry streaming request

15. GET /api/access/streaming-url/:contentId
16. ContentAccessService: Find contentAccess record → Access granted
17. Generate signed R2 URL
18. Return streaming URL
```

**Involved Workers**: Stripe Webhook Handler, Content-API Worker

**Services Used**: Stripe signature verification, ContentAccessService

**Key Databases**: contentAccess table (purchase records), webhook_events table (logs)

**External Services**: Stripe (payment processing), R2 (streaming)

---

### Pattern 4: Create Organization

**Flow**:
```
1. User: POST /api/organizations (authenticated)
   ↓ Identity-API Worker
2. Validate session via Auth Worker GET /api/auth/session
3. Validate request body (Zod schema)
   - name: 1-255 chars
   - slug: lowercase, alphanumeric + hyphen, unique
   - description: 0-5000 chars
   - logoUrl: valid URL format
   - websiteUrl: valid URL format
4. OrganizationService: Check slug uniqueness
   SELECT * FROM organizations WHERE slug = :slug AND deletedAt IS NULL
5. Slug taken → Return 409 Conflict
6. Slug available → Insert record → PostgreSQL organizations table
   - creatorId = currentUser.id
   - createdAt = now, updatedAt = now
7. Response: Return new organization with status 201 Created

   ↓ User: Add team members (future feature)

8. POST /api/organizations/:id/members
9. OrganizationService: Insert into organizationMembers table

   ↓ User: Create content for organization

10. Content-API: POST /api/content with organizationId
11. ContentService: Insert content with organizationId reference
    - Only org members can access org content
```

**Involved Workers**: Identity-API Worker (main), Auth Worker (session validation)

**Services Used**: OrganizationService

**Key Databases**: organizations table, organizationMembers table (future)

---

## Integration with Packages

### All Workers Use

**@codex/worker-utils**:
- `createWorker()` - Standardized worker setup (middleware chain, health checks, error handling)
- `procedure()` - tRPC-style unified handler with policy, validation, service injection, and error handling
- `createHealthCheckHandler()` - Health endpoint responses
- `createStandardMiddlewareChain()` - Request tracking, security headers
- `createErrorResponse()` - Consistent error response format
- Error handling helpers for graceful error responses

**@codex/security**:
- `securityHeaders()` - CSP, XFO, X-Content-Type-Options middleware
- `createRateLimiter()` - IP-based rate limiting via KV
- `RATE_LIMIT_PRESETS` - Predefined rate limit configs (auth, api, webhook)

**@codex/database**:
- `dbHttp` - HTTP client for PostgreSQL (via Drizzle ORM)
- All schema definitions (users, sessions, content, organizations, etc.)
- Migration utilities for schema management

**@codex/shared-types**:
- Type definitions (UserData, SessionData, ContentItem, Organization, etc.)
- Ensures type consistency across workers

---

### Auth Worker Specific

**@codex/security**:
- Password hashing via bcrypt (integrated with BetterAuth)
- Rate limit presets for auth endpoints

**better-auth**:
- Full authentication framework (email/password plugin)
- Session management (creation, validation, expiry)
- Email verification flow
- Password reset flow

---

### Content-API Worker Specific

**@codex/content**:
- ContentService - Content CRUD operations
- MediaItemService - Media item lifecycle (upload, transcoding, status)
- ContentAccessService - Access verification, streaming URL generation

**@codex/validation**:
- Zod schemas for request validation (ContentCreateInput, MediaItemUpdateInput, etc.)

**@codex/access** (if available):
- Authorization logic for content scoping
- Membership/purchase verification

---

### Identity-API Worker Specific

**@codex/identity**:
- OrganizationService - Org CRUD and lookup operations

**@codex/validation**:
- Zod schemas for organization validation

---

### Stripe Webhook Handler Specific

**@codex/observability**:
- Webhook event logging and tracing
- Request/response logging with error context

**@codex/security**:
- Stripe signature verification (HMAC-SHA256)
- Webhook rate limiting

---

## Development Workflow

### Local Setup

**Prerequisites**:
```bash
# Install dependencies
pnpm install

# Set up environment
# Create .env.local in each worker directory with:
ENVIRONMENT=development
DB_METHOD=LOCAL  # Direct PostgreSQL connection
DATABASE_URL=postgresql://user:pass@localhost:5432/codex_dev
WEB_APP_URL=http://localhost:5173
API_URL=http://localhost:8787
BETTER_AUTH_SECRET=<32+ char random string>
STRIPE_SECRET_KEY=sk_test_...  # For webhook handler
```

### Running Workers Locally

**Terminal 1 - Auth Worker**:
```bash
cd workers/auth
pnpm dev  # Starts on http://localhost:42069
```

**Terminal 2 - Content-API Worker**:
```bash
cd workers/content-api
pnpm dev  # Starts on http://localhost:4001
```

**Terminal 3 - Identity-API Worker**:
```bash
cd workers/identity-api
pnpm dev  # Starts on http://localhost:42071
```

**Terminal 4 - Ecom-API Worker**:
```bash
cd workers/ecom-api
pnpm dev  # Starts on http://localhost:42072
```

### Testing Locally

**Register and Login**:
```bash
# 1. Register
curl -X POST http://localhost:42069/api/auth/email/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@test.com","password":"Test123!@#","name":"Test User"}' \
  -c cookies.txt

# 2. Verify email (check console logs for link)
# Navigate to verification URL or manually call:
curl "http://localhost:42069/api/auth/verify-email?token=<token-from-logs>"

# 3. Login
curl -X POST http://localhost:42069/api/auth/email/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@test.com","password":"Test123!@#"}' \
  -c cookies.txt

# 4. Test session
curl http://localhost:42069/api/auth/session \
  -b cookies.txt
```

**Create Organization**:
```bash
curl -X POST http://localhost:42071/api/organizations \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=<session-token>" \
  -d '{
    "name": "Test Org",
    "slug": "test-org",
    "description": "A test organization"
  }'
```

**Create Content**:
```bash
curl -X POST http://localhost:4001/api/content \
  -H "Content-Type: application/json" \
  -H "Cookie: codex-session=<session-token>" \
  -d '{
    "title": "My Video",
    "slug": "my-video",
    "contentType": "video",
    "mediaItemId": "uuid-of-media",
    "visibility": "public"
  }'
```

**Stripe Webhook Testing**:
```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Start listening to local webhook handler
stripe listen --forward-to http://localhost:42072/webhooks/stripe/payment

# In another terminal, trigger test webhook
stripe trigger payment_intent.succeeded
```

### Running Tests

**In each worker directory**:
```bash
# Run tests once
pnpm test

# Run in watch mode
pnpm test:watch

# Run with coverage
pnpm test:coverage
```

Tests use `vitest` with Cloudflare Workers runtime via `vitest-pool-workers`.

---

## Deployment Strategy

### Staging Deployment

**Prerequisites**:
- Wrangler configured with Cloudflare account
- Staging environment secrets set

**Deploy All Workers**:
```bash
# From project root
pnpm run deploy:staging

# Or individually
cd workers/auth && wrangler deploy --env staging
cd workers/content-api && wrangler deploy --env staging
cd workers/identity-api && wrangler deploy --env staging
cd workers/ecom-api && wrangler deploy --env staging
```

**Staging URLs**:
- Auth: https://auth-staging.revelations.studio
- Content-API: https://content-api-staging.revelations.studio
- Identity-API: https://identity-api-staging.revelations.studio
- Ecom-API: https://ecom-api-staging.revelations.studio

### Production Deployment

**Requires**:
- All tests passing (pnpm test)
- Code review approval
- Staging verification

**Deploy**:
```bash
# From project root
pnpm run deploy:prod

# Or individually (with caution)
cd workers/auth && wrangler deploy --env production
```

**Production URLs**:
- Auth: https://auth.revelations.studio
- Content-API: https://content-api.revelations.studio
- Identity-API: https://identity-api.revelations.studio
- Ecom-API: https://ecom-api.revelations.studio

### Environment Variables per Stage

**Development** (local .env):
```
ENVIRONMENT=development
DB_METHOD=LOCAL
WEB_APP_URL=http://localhost:5173
API_URL=http://localhost:8787
```

**Staging** (wrangler.jsonc + secrets):
```
ENVIRONMENT=staging
DB_METHOD=PRODUCTION  # Neon connection pooling
WEB_APP_URL=https://codex-staging.revelations.studio
API_URL=https://api-staging.revelations.studio
DATABASE_URL=<neon-staging-url>
BETTER_AUTH_SECRET=<staging-secret>
STRIPE_SECRET_KEY=sk_test_...
```

**Production** (wrangler.jsonc + secrets):
```
ENVIRONMENT=production
DB_METHOD=PRODUCTION  # Neon connection pooling
WEB_APP_URL=https://codex.revelations.studio
API_URL=https://api.revelations.studio
DATABASE_URL=<neon-prod-url>
BETTER_AUTH_SECRET=<prod-secret>
STRIPE_SECRET_KEY=sk_live_...
```

### Secrets Management

Three secrets required per environment (set via Wrangler CLI, not in wrangler.jsonc):

```bash
# Staging
wrangler secret put DATABASE_URL --env staging
wrangler secret put BETTER_AUTH_SECRET --env staging
wrangler secret put STRIPE_SECRET_KEY --env staging

# Production
wrangler secret put DATABASE_URL --env production
wrangler secret put BETTER_AUTH_SECRET --env production
wrangler secret put STRIPE_SECRET_KEY --env production
```

---

## Monitoring & Observability

### Health Checks

All workers expose `GET /health` endpoint for monitoring:

**Response** (200 or 503):
```json
{
  "status": "healthy | degraded",
  "service": "auth-worker | content-api | identity-api | ecom-api",
  "version": "1.0.0",
  "timestamp": "2025-11-23T12:34:56Z",
  "checks": {
    "database": "healthy | unhealthy",
    "kv_rate_limit": "healthy | unhealthy",
    "kv_session": "healthy | unhealthy",  // Auth worker only
    "r2_media": "healthy | unhealthy"    // Content-API only
  }
}
```

**Monitoring Setup**:
```bash
# Add to monitoring system (e.g., DataDog, New Relic)
GET https://auth.revelations.studio/health
GET https://content-api.revelations.studio/health
GET https://identity-api.revelations.studio/health
GET https://webhook.stripe.revelations.studio/health

# Alert if status != "healthy" or response time > 5s
```

### Request Tracking

All workers generate unique request IDs for tracing:

**Header**: `x-request-id: <uuid>`

**Usage**:
- Included in all request/response logs
- Can be used to trace request flow across services
- Returned in error responses for support

**Example**:
```bash
curl -v https://auth.revelations.studio/health

# Response headers
x-request-id: 550e8400-e29b-41d4-a716-446655440000
```

### Logging

**What's Logged**:
- Request metadata (method, path, status, duration, IP)
- Response times (for performance monitoring)
- Error details (without PII)
- Authentication events (login, logout, failed attempts)
- Rate limit exceeded events

**What's NOT Logged** (PII Protection):
- Request/response bodies (passwords, email, etc.)
- User names, email addresses
- Payment information
- Full error stack traces (development only)

### Error Monitoring

**Standard Error Response Format**:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  },
  "requestId": "uuid",
  "timestamp": "ISO 8601"
}
```

**Common Errors to Monitor**:
- 401 Unauthorized - High volume may indicate attack
- 429 Too Many Requests - Rate limiting effective or overload
- 500 Internal Server Error - Service issues
- 503 Service Unavailable - Database/KV/R2 connectivity issues

---

## Common Integration Patterns

### Pattern: Authenticated API Endpoint with procedure()

**Use Case**: Create a protected API endpoint with validation

**Code Pattern**:
```typescript
import { procedure } from '@codex/worker-utils';
import { z } from 'zod';

// GET endpoint with params validation
app.get('/api/content/:id',
  procedure({
    policy: { auth: 'required' },
    input: { params: z.object({ id: z.string().uuid() }) },
    handler: async (ctx) => {
      return await ctx.services.content.getById(ctx.input.params.id, ctx.user.id);
    },
  })
);

// POST endpoint with body validation
app.post('/api/content',
  procedure({
    policy: { auth: 'required', roles: ['creator'] },
    input: { body: createContentSchema },
    successStatus: 201,
    handler: async (ctx) => {
      return await ctx.services.content.create(ctx.input.body, ctx.user.id);
    },
  })
);
```

### Pattern: Check Membership/Ownership

**Use Case**: Ensure user owns or has access to a resource

**Code Pattern**:
```typescript
// In ContentService
async function getContent(id: string, userId: string) {
  const content = await db.query.content.findFirst({
    where: (content, { eq, and }) =>
      and(
        eq(content.id, id),
        eq(content.creatorId, userId),  // Ownership check
        isNull(content.deletedAt)        // Not soft-deleted
      ),
  });

  if (!content) {
    throw new NotFoundError('Content not found');
  }

  return content;
}
```

### Pattern: Generate Time-Limited Streaming URL

**Use Case**: Provide secure, time-limited access to R2 content

**Code Pattern**:
```typescript
// Using procedure() for streaming URL endpoint
app.get('/api/access/streaming-url/:contentId',
  procedure({
    policy: { auth: 'required' },
    input: { params: z.object({ contentId: z.string().uuid() }) },
    handler: async (ctx) => {
      // Service handles access verification and URL generation
      return await ctx.services.access.getStreamingUrl(
        ctx.input.params.contentId,
        ctx.user.id
      );
    },
  })
);
```

### Pattern: Handle Stripe Webhook with Signature Verification

**Use Case**: Safely process Stripe events

**Code Pattern**:
```typescript
// Stripe webhooks use custom middleware for signature verification
// instead of procedure() since they don't use session auth
app.post('/webhooks/stripe/payment', verifyStripeSignature, async (c) => {
  // Event already verified by middleware
  const event = c.get('stripeEvent');

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const charge = event.data.object;
      // Process payment
      await paymentService.recordPayment(charge);
      break;
    }
    // ... other event types
  }

  return c.json({ received: true });
});
```

**Note**: Webhooks typically don't use procedure() because they use Stripe signature verification instead of session authentication. The `verifyStripeSignature` middleware handles authentication via HMAC-SHA256.

### Pattern: Organization-Scoped Endpoint

**Use Case**: Endpoint requires organization membership

**Code Pattern**:
```typescript
app.patch('/api/organizations/:id/settings',
  procedure({
    policy: { auth: 'required', requireOrgMembership: true },
    input: {
      params: z.object({ id: z.string().uuid() }),
      body: updateSettingsSchema,
    },
    handler: async (ctx) => {
      // organizationId is guaranteed when requireOrgMembership: true
      return await ctx.services.settings.update(
        ctx.organizationId,
        ctx.input.body
      );
    },
  })
);
```

---

## Troubleshooting Guide

### Issue: "401 Unauthorized" on Protected Endpoint

**Causes & Solutions**:
1. **Missing session cookie**
   - Solution: Include `-b cookies.txt` in curl, or manually set Cookie header

2. **Expired session**
   - Solution: Re-login to get fresh session
   - Sessions expire after 24 hours

3. **Session cache stale** (rare)
   - Solution: Clear AUTH_SESSION_KV in Cloudflare KV store
   - Cache updates every 5 minutes

### Issue: "429 Too Many Requests"

**Causes & Solutions**:
1. **Rate limit exceeded on endpoint**
   - Solution: Wait 15 minutes (default cooldown) before retrying
   - Check rate limit preset for endpoint (100/min for API, 10/15min for auth)

2. **Too many login attempts**
   - Solution: Wait 15 minutes, then try again (anti-brute-force measure)

### Issue: "409 Conflict" on Organization Creation

**Causes & Solutions**:
1. **Slug already exists**
   - Solution: Use different slug, or check availability via GET /api/organizations/check-slug/:slug

2. **Concurrent creation**
   - Solution: Retry after small delay (database race condition)

### Issue: Stripe Webhook Returns 401

**Causes & Solutions**:
1. **Invalid signature**
   - Verify STRIPE_SECRET_KEY is correct
   - Ensure raw request body is passed (not parsed)
   - Check Stripe CLI is configured correctly

2. **Wrong webhook endpoint**
   - Verify Stripe webhook URL points to correct endpoint
   - Verify STRIPE_SECRET_KEY matches Stripe dashboard

### Issue: Media Upload Stuck in "Uploading" Status

**Causes & Solutions**:
1. **Network interruption during upload**
   - Solution: Retry upload from scratch

2. **File too large**
   - Solution: Check max file size limits in MEDIA_BUCKET R2 bucket config

3. **Transcoding service down**
   - Solution: Check external transcoding service status
   - Media status may be manually reset to "uploading" for retry

---

## File Structure

```
workers/
├── auth/                          # Auth Worker (BetterAuth)
│   ├── src/
│   │   ├── middleware/
│   │   │   ├── index.ts
│   │   │   ├── rate-limiter.ts    # Login rate limiting
│   │   │   └── session-cache.ts   # KV session caching
│   │   ├── auth-config.ts         # BetterAuth instance config
│   │   ├── index.ts               # Main handler
│   │   ├── types.ts               # Auth-specific types
│   │   └── __test__/              # Tests
│   ├── package.json               # Port: 42069
│   └── wrangler.jsonc
│
├── content-api/                   # Content API Worker
│   ├── src/
│   │   ├── routes/
│   │   │   ├── content.ts         # Content CRUD
│   │   │   ├── media.ts           # Media management
│   │   │   └── content-access.ts  # Streaming, access control
│   │   ├── index.ts               # Main handler
│   │   └── __test__/              # Tests
│   ├── package.json               # Port: 4001
│   └── wrangler.jsonc
│
├── identity-api/                  # Identity Worker
│   ├── src/
│   │   ├── routes/
│   │   │   └── organizations.ts   # Org CRUD
│   │   ├── index.ts               # Main handler
│   │   └── __test__/              # Tests
│   ├── package.json               # Port: 42071
│   └── wrangler.jsonc
│
└── ecom-api/        # Stripe Webhook Handler
    ├── src/
    │   ├── handlers/
    │   │   ├── payment.ts         # Payment events
    │   │   ├── subscription.ts    # Subscription events
    │   │   ├── customer.ts        # Customer events
    │   │   └── ...                # Other event handlers
    │   ├── index.ts               # Main handler
    │   └── __test__/              # Tests
    ├── package.json               # Port: 42072
    └── wrangler.jsonc
```

---

## Summary

The Codex Workers architecture provides a distributed, resilient API layer built on Cloudflare Workers. Each worker specializes in a specific business domain, uses consistent patterns for security and error handling, and coordinates with foundational packages to implement business logic.

**Key Architectural Principles**:
1. **Separation of Concerns**: Auth, Content, Identity, and Payments each have dedicated workers
2. **Stateless Design**: Workers are ephemeral; state stored in PostgreSQL and KV
3. **Security by Design**: Session validation, rate limiting, input validation on every request
4. **Observability**: Request tracking, health checks, comprehensive logging
5. **Consistency**: All workers follow same middleware pattern, error handling, validation approach

**To Get Started**:
- Run `pnpm install` from project root
- `cd workers/<name> && pnpm dev` to start local workers
- Use provided curl examples to test endpoints
- Refer to individual worker `.clog` files for detailed endpoint documentation

