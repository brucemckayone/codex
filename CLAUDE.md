# Codex Platform - Complete Documentation Index

## Quick Reference

- **Concision**: Be extremely concise. Sacrifice grammar for brevity.
- **Plans**: End with unresolved questions (concise, no grammar).

---

## Project Structure Overview

Codex is a serverless content streaming platform built on Cloudflare Workers. It's organized into three main layers:

```
Workers (API Endpoints)
    ↓
Service Layer (Business Logic)
    ↓
Foundation Layer (Infrastructure)
    ↓
External Services (Neon PostgreSQL, R2, KV, Stripe)
```

**8 Workers** → **18 Packages** → **Foundation Layer**

---

## Master Navigation Guide

### Start Here Based on Your Task

| Task | Where to Go |
|------|-------------|
| **Understand full project structure** | [packages/CLAUDE.md](packages/CLAUDE.md) + [workers/CLAUDE.md](workers/CLAUDE.md) |
| **Build new API endpoint** | [workers/CLAUDE.md](workers/CLAUDE.md#common-integration-patterns) |
| **Add new service/business logic** | [packages/CLAUDE.md](packages/CLAUDE.md#architecture-diagram) |
| **Debug database issue** | [packages/database/CLAUDE.md](packages/database/CLAUDE.md) |
| **Fix validation error** | [packages/validation/CLAUDE.md](packages/validation/CLAUDE.md) |
| **Add security features** | [packages/security/CLAUDE.md](packages/security/CLAUDE.md) |
| **Handle errors consistently** | [packages/service-errors/CLAUDE.md](packages/service-errors/CLAUDE.md) |
| **Set up new worker** | [packages/worker-utils/CLAUDE.md](packages/worker-utils/CLAUDE.md) |
| **Manage R2 storage** | [packages/cloudflare-clients/CLAUDE.md](packages/cloudflare-clients/CLAUDE.md) |
| **Control content access** | [packages/access/CLAUDE.md](packages/access/CLAUDE.md) |
| **Understand types/contracts** | [packages/shared-types/CLAUDE.md](packages/shared-types/CLAUDE.md) |

---

## The 8 Workers

All workers are Cloudflare Workers deployments that follow a consistent middleware pattern.

### 1. Auth Worker (Port 42069)
**File**: [workers/auth/CLAUDE.md](workers/auth/CLAUDE.md)

Handles user authentication, session management, email verification, and password reset.
- Uses BetterAuth framework
- Session storage in PostgreSQL + KV cache
- Rate limiting on login attempts

**Key Endpoints**:
- POST /api/auth/email/register
- POST /api/auth/email/login
- GET /api/auth/session
- POST /api/auth/sign-out

---

### 2. Content-API Worker (Port 4001)
**File**: [workers/content-api/CLAUDE.md](workers/content-api/CLAUDE.md)

REST API for content lifecycle (create, publish, delete), media management, and streaming.
- Content CRUD with draft → published workflow
- Media transcoding pipeline tracking
- Presigned R2 URLs for streaming
- Playback progress tracking

**Key Endpoints**:
- POST /api/content
- PATCH /api/content/:id
- POST /api/content/:id/publish
- POST /api/media
- GET /api/access/streaming-url/:id

---

### 3. Identity-API Worker (Port 42074)
**File**: [workers/identity-api/CLAUDE.md](workers/identity-api/CLAUDE.md)

Placeholder worker reserved for future user identity management (profiles, preferences, account settings). Currently provides only a health check endpoint.
- **Status**: Placeholder / Maintenance Mode
- **Current Endpoint**: GET /health

---

### 4. Ecom-API Worker (Port 42072)
**File**: [workers/ecom-api/CLAUDE.md](workers/ecom-api/CLAUDE.md)

E-commerce API for Stripe Checkout integration and payment webhook processing. Handles checkout session creation, webhook event processing with signature verification, and idempotent purchase recording. Acts as bridge between Stripe payment system and Codex purchase records.

**Key Endpoints**:
- POST /checkout/create - Create Stripe Checkout session for paid content
- POST /webhooks/stripe/booking - Checkout session completed events (creates purchases)
- POST /webhooks/stripe/payment - Payment intent events (for future phases)
- POST /webhooks/stripe/subscription - Subscription events (for future phases)
- POST /webhooks/stripe/customer - Customer account events (for future phases)

**Key Features**:
- Stripe Checkout session creation with content pricing
- Webhook signature verification (HMAC-SHA256)
- Idempotent purchase recording (prevents duplicates)
- Revenue split calculation (10% platform/90% creator)
- ContentAccess grant for verified purchases

**Note**: Uses shared Bindings for Stripe credentials (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET_BOOKING) following the same pattern as R2 credentials.

---

### 5. Admin-API Worker (Port 42073)
**File**: [workers/admin-api/CLAUDE.md](workers/admin-api/CLAUDE.md)

Admin dashboard API for platform owners. Provides analytics, customer management, and cross-creator content administration.
- Revenue metrics and customer statistics
- Customer data access and support operations
- Content management with publish controls

---

### 6. Notifications-API Worker (Port 42074)
**File**: [workers/notifications-api/CLAUDE.md](workers/notifications-api/CLAUDE.md)

Email notification service for Codex platform. Manages email templates and sending via Resend.
- Email template management (global, organization, creator scopes)
- Resend integration for delivery
- MailHog support for local development

---

### 7. Organization-API Worker (Port 42075)
**File**: [workers/organization-api/CLAUDE.md](workers/organization-api/CLAUDE.md)

Organization and user identity management.
- Organization CRUD with unique slugs
- Multi-tenant scoping
- User membership management

---

### 8. Media-API Worker (Port 42076)
**File**: [workers/media-api/CLAUDE.md](workers/media-api/CLAUDE.md)

Media transcoding and streaming API. Manages the complete transcoding pipeline via RunPod GPU workers.
- Transcoding job submission and status tracking
- HLS streaming playlist generation
- Adaptive bitrate delivery for video and audio

---

## The 18 Packages

All packages live in `packages/`. They're organized into three architectural layers:

### Foundation Layer (Depended on by everything)

| Package | Purpose | Docs |
|---------|---------|------|
| **@codex/database** | PostgreSQL/Neon ORM, schema, query helpers | [database/CLAUDE.md](packages/database/CLAUDE.md) |
| **@codex/shared-types** | TypeScript type definitions for contracts | [shared-types/CLAUDE.md](packages/shared-types/CLAUDE.md) |
| **@codex/service-errors** | Error classes, BaseService, error mapping | [service-errors/CLAUDE.md](packages/service-errors/CLAUDE.md) |
| **@codex/security** | Auth, rate limiting, security headers, HMAC | [security/CLAUDE.md](packages/security/CLAUDE.md) |
| **@codex/validation** | Zod schemas for all input validation | [validation/CLAUDE.md](packages/validation/CLAUDE.md) |
| **Shared Constants** | @codex/constants | PLATFORM_FEE_BPS, limits, MIME types |
**Key Concept**: Everything depends on these 5 packages. They provide the infrastructure that services and workers build on.

---

### Service Layer (Business logic, extends BaseService)

| Package | Purpose | Docs |
|---------|---------|------|
| **@codex/content** | Content & media lifecycle management | [content/CLAUDE.md](packages/content/CLAUDE.md) |
| **@codex/organization** | Organization management | [organization/CLAUDE.md](packages/organization/CLAUDE.md) |
| **@codex/access** | Content access control, streaming URLs, playback tracking | [access/CLAUDE.md](packages/access/CLAUDE.md) |
| **@codex/purchase** | Stripe Checkout integration, purchase management, revenue splits | [purchase/CLAUDE.md](packages/purchase/CLAUDE.md) |
| **@codex/notifications** | Email template management and sending, multi-scope templates | [notifications/CLAUDE.md](packages/notifications/CLAUDE.md) |
| **@codex/admin** | Admin dashboard services, analytics, customer management | [admin/CLAUDE.md](packages/admin/CLAUDE.md) |
| **@codex/transcoding** | Media transcoding pipeline, RunPod integration, HLS generation | [transcoding/CLAUDE.md](packages/transcoding/CLAUDE.md) |

**Key Concept**: Service layer implements domain business logic. Each service extends BaseService and throws domain-specific errors.

---

### Utility Packages (Cross-cutting concerns)

| Package | Purpose | Docs |
|---------|---------|------|
| **@codex/worker-utils** | Worker factory, middleware, route handlers | [worker-utils/CLAUDE.md](packages/worker-utils/CLAUDE.md) |
| **@codex/cloudflare-clients** | R2 storage service, presigned URLs | [cloudflare-clients/CLAUDE.md](packages/cloudflare-clients/CLAUDE.md) |
| **@codex/observability** | Logging and monitoring | [observability/CLAUDE.md](packages/observability/CLAUDE.md) |
| **@codex/test-utils** | Database setup, test helpers | [test-utils/CLAUDE.md](packages/test-utils/CLAUDE.md) |
| **@codex/platform-settings** | Platform branding, feature toggles, organization settings | [platform-settings/CLAUDE.md](packages/platform-settings/CLAUDE.md) |

**Key Concept**: Utilities provide helpers for workers, services, and tests without implementing business logic.

---

## Detailed Package Documentation

### Foundation Packages

**@codex/database** [Read Full Docs](packages/database/CLAUDE.md)
- Type-safe PostgreSQL access via Drizzle ORM
- Two clients: dbHttp (production) and dbWs (transactions/tests)
- Complete schema with users, organizations, content, media items, purchases, playback
- Query helpers: scopedNotDeleted(), withPagination(), creatorScope(), orgScope()
- Error detection: isUniqueViolation(), isForeignKeyViolation()

**@codex/shared-types** [Read Full Docs](packages/shared-types/CLAUDE.md)
- HonoEnv for worker type safety
- Bindings (database, R2, KV, Stripe)
- Variables (session, user, requestId, clientIP)
- Response types (SingleItemResponse, PaginatedListResponse, ErrorResponse)
- AuthenticatedContext, EnrichedAuthContext for route handlers

**@codex/service-errors** [Read Full Docs](packages/service-errors/CLAUDE.md)
- BaseService abstract class (foundation for all services)
- Error classes: NotFoundError, ValidationError, ForbiddenError, ConflictError, BusinessLogicError, InternalServiceError
- mapErrorToResponse() converts all error types to standardized HTTP responses
- Type guards: isServiceError(), wrapError()

**@codex/security** [Read Full Docs](packages/security/CLAUDE.md)
- securityHeaders() - CSP, X-Frame-Options, HSTS
- rateLimit() - KV-backed rate limiting with presets (auth, api, strict, streaming, webhook)
- requireAuth(), optionalAuth() - Session validation with KV caching
- workerAuth() - HMAC-based worker-to-worker authentication

**@codex/validation** [Read Full Docs](packages/validation/CLAUDE.md)
| **Shared Constants** | @codex/constants | PLATFORM_FEE_BPS, limits, MIME types |- Centralized Zod schemas for all input types
- Content schemas: createContentSchema, updateContentSchema, contentQuerySchema
- Media schemas: createMediaItemSchema, updateMediaItemSchema
- Organization schemas: createOrganizationSchema
- Access schemas: getStreamingUrlSchema, savePlaybackProgressSchema
- Security-focused: prevents XSS, path traversal, injection attacks
- Enums align with database CHECK constraints

---

### Service Packages

**@codex/content** [Read Full Docs](packages/content/CLAUDE.md)
- ContentService: create, get, update, publish, unpublish, delete content
- MediaItemService: upload tracking, transcoding status management
- Error classes: ContentNotFoundError, MediaNotFoundError, MediaNotReadyError, SlugConflictError
- Content lifecycle: draft → published → deleted (soft delete)
- Media lifecycle: uploading → uploaded → transcoding → ready/failed

**@codex/organization** [Read Full Docs](packages/organization/CLAUDE.md)
- OrganizationService: create, get, update, delete organizations
- Slug uniqueness validation
- Organization metadata: name, description, logo, website
- Error classes: OrganizationNotFoundError, ConflictError

**@codex/access** [Read Full Docs](packages/access/CLAUDE.md)
- ContentAccessService: verify access, generate streaming URLs, track playback
- Access control logic: free content vs purchased vs members_only
- Presigned R2 URLs with time-limited expiration
- Playback progress tracking with resume functionality
- Integrates with @codex/purchase for purchase verification
- Error classes: AccessDeniedError, R2SigningError

**@codex/purchase** [Read Full Docs](packages/purchase/CLAUDE.md)
- PurchaseService: Stripe Checkout integration, purchase management
- createCheckoutSession() - Create Stripe checkout for paid content
- completePurchase() - Record completed purchases from webhooks (idempotent)
- verifyPurchase() - Check customer ownership for access control
- Revenue split calculation (configurable platform/org/creator fees)
- Centralized Stripe client factory with pinned API version
- Error classes: AlreadyPurchasedError, ContentNotPurchasableError, PaymentProcessingError

---

### Utility Packages

**@codex/worker-utils** [Read Full Docs](packages/worker-utils/CLAUDE.md)
- createWorker(config) - Fully configured Hono app with middleware
- Middleware factories: auth, CORS, security headers, request tracking, logging
- procedure() - tRPC-style handler combining policy, validation, services, and error handling
- Health checks (database, KV, R2)
- Test helpers: createTestUser(), createAuthenticatedRequest()

**@codex/cloudflare-clients** [Read Full Docs](packages/cloudflare-clients/CLAUDE.md)
- R2Service: put(), get(), delete(), list(), putJson()
- R2SigningClient: standalone presigned URL generation
- Automatic retry logic with exponential backoff
- generateSignedUrl() for time-limited streaming

**@codex/observability** [Read Full Docs](packages/observability/CLAUDE.md)
- ObservabilityClient: info(), warn(), error(), trackError()
- Structured logging with request context
- Integrates with all workers and services

**@codex/test-utils** [Read Full Docs](packages/test-utils/CLAUDE.md)
- setupTestDatabase(), teardownTestDatabase()
- seedTestUsers() - Create test user fixtures
- withNeonTestBranch() - Ephemeral test branches per test file
- Database transaction support via dbWs

---

## Common Patterns

### Pattern: Add New API Endpoint

1. **Validation** - Add schema to @codex/validation
| **Shared Constants** | @codex/constants | PLATFORM_FEE_BPS, limits, MIME types |2. **Service** - Add method to service (@codex/content, @codex/identity, or @codex/access)
3. **Worker** - Create route in appropriate worker using procedure()
4. **Types** - Return types from @codex/shared-types

Example: New endpoint to list user's content library
- Schema: listUserLibrarySchema in @codex/validation
| **Shared Constants** | @codex/constants | PLATFORM_FEE_BPS, limits, MIME types |- Service: ContentAccessService.listUserLibrary() in @codex/access
- Worker: Route in workers/content-api
- Response: UserLibraryResponse from @codex/shared-types

See [packages/CLAUDE.md - Common Integration Patterns](packages/CLAUDE.md#common-integration-patterns) for full examples.

---

### Pattern: Extend Service Layer

Services always:
1. Extend BaseService from @codex/service-errors
2. Receive ServiceConfig (db, environment) in constructor
3. Throw specific error classes (NotFoundError, ConflictError, etc.)
4. Use database query helpers (scopedNotDeleted, withPagination)
5. Return types from @codex/shared-types

See [packages/service-errors/CLAUDE.md](packages/service-errors/CLAUDE.md) for error handling patterns.

---

### Pattern: Build New Worker

All workers:
1. Use createWorker() from @codex/worker-utils
2. Use procedure() for routes with policy, validation, and error handling
3. Return standardized responses from @codex/shared-types

See [packages/worker-utils/CLAUDE.md](packages/worker-utils/CLAUDE.md) for worker setup examples.

---

## Quick Reference: What to Import

### For Services
```typescript
import { BaseService, NotFoundError, ConflictError } from '@codex/service-errors';
import { dbHttp, schema, scopedNotDeleted } from '@codex/database';
import { createContentSchema } from '@codex/validation';
| **Shared Constants** | @codex/constants | PLATFORM_FEE_BPS, limits, MIME types |import type { ServiceConfig } from '@codex/service-errors';
```

### For Workers
```typescript
import { createWorker, procedure } from '@codex/worker-utils';
import { createContentSchema } from '@codex/validation';
| **Shared Constants** | @codex/constants | PLATFORM_FEE_BPS, limits, MIME types |import type { HonoEnv } from '@codex/shared-types';
```

### For Tests
```typescript
import { dbWs, closeDbPool, schema } from '@codex/database';
import { setupTestDatabase, seedTestUsers } from '@codex/test-utils';
```

---

## Critical Skills for This Codebase

1. **Transaction Safety** - Multi-step operations use db.transaction()
2. **Scoping** - All queries filtered by creatorId or organizationId
3. **Soft Deletes** - Use whereNotDeleted() helper
4. **Error Handling** - Throw specific error classes, let worker layer map to HTTP
5. **Type Inference** - Zod schemas automatically generate types
6. **Middleware Composition** - Workers apply middleware in specific order
7. **Database Constraints** - Enums in validation match CHECK constraints

---

## Helpful Commands

```bash
# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Build all packages
pnpm build

# Type check
pnpm typecheck

# Lint
pnpm lint

# Format
pnpm format

# Start workers locally
cd workers/auth && pnpm dev
cd workers/content-api && pnpm dev
cd workers/identity-api && pnpm dev
cd workers/ecom-api && pnpm dev

# Database migrations
pnpm db:gen:drizzle
pnpm db:migrate
pnpm db:studio
```

---

## Architecture Diagrams

### Request Flow (Simplified)
```
Client Request
    ↓
Worker Middleware Chain
  ├─ Request Tracking
  ├─ Security Headers
  ├─ CORS
  ├─ Authentication
  └─ Rate Limiting
    ↓
procedure() Handler
  ├─ Enforce policy (auth, roles)
  ├─ Validate input (Zod)
  ├─ Inject services
  └─ Call handler with context
    ↓
Service Layer
  ├─ Load from database (dbHttp)
  ├─ Apply business logic
  ├─ Throw specific errors
  └─ Return typed response
    ↓
procedure() Error Handler
  ├─ mapErrorToResponse()
  └─ Return standardized error
    ↓
HTTP Response (with correct status code)
```

### Package Dependencies
```
Workers
  ├─ @codex/worker-utils
  ├─ @codex/content
  ├─ @codex/identity
  ├─ @codex/access
  └─ @codex/cloudflare-clients

Service Packages (@codex/content, identity, access)
  ├─ @codex/service-errors
  ├─ @codex/database
  ├─ @codex/validation
| **Shared Constants** | @codex/constants | PLATFORM_FEE_BPS, limits, MIME types |  └─ @codex/security

Foundation Packages
  ├─ @codex/database
  ├─ @codex/shared-types
  ├─ @codex/service-errors
  ├─ @codex/security
  ├─ @codex/validation
| **Shared Constants** | @codex/constants | PLATFORM_FEE_BPS, limits, MIME types |  ├─ @codex/observability
  └─ @codex/test-utils
```

---

## Where to Find Specific Things

| What | Location |
|------|----------|
| Content service methods | packages/content/CLAUDE.md |
| Organization management | packages/identity/CLAUDE.md |
| Access control & streaming | packages/access/CLAUDE.md |
| Purchases & Stripe integration | packages/purchase/CLAUDE.md |
| Database schema | packages/database/CLAUDE.md |
| Error classes | packages/service-errors/CLAUDE.md |
| Security middleware | packages/security/CLAUDE.md |
| Input validation | packages/validation/CLAUDE.md |
| Type definitions | packages/shared-types/CLAUDE.md |
| Environment bindings (R2, Stripe) | packages/shared-types/CLAUDE.md |
| Worker middleware | packages/worker-utils/CLAUDE.md |
| R2 operations | packages/cloudflare-clients/CLAUDE.md |
| Worker endpoints | workers/{name}/CLAUDE.md |
| Deployment info | workers/CLAUDE.md |

---

## Key Files in Each Package

```
packages/{name}/
  ├── src/
  │   ├── index.ts (main exports)
  │   ├── services/ (business logic)
  │   ├── errors.ts (domain-specific errors)
  │   └── __tests__/ (unit tests)
  ├── CLAUDE.md (THIS DOCUMENTATION)
  └── package.json
```

---

## Getting Started

### I'm New to This Project
1. Read this file (overview)
2. Read [packages/CLAUDE.md](packages/CLAUDE.md) (architecture)
3. Read [workers/CLAUDE.md](workers/CLAUDE.md) (worker layer)
4. Pick a package you'll work with and read its CLAUDE.md

### I Need to Build Something
1. Identify which worker/service you need
2. Go to that package's CLAUDE.md
3. Follow the examples and patterns
4. Cross-reference foundation packages as needed

### I'm Debugging Something
1. Determine the layer (worker, service, or foundation)
2. Go to relevant CLAUDE.md
3. Search for the error or behavior
4. Follow the code patterns

---

## Important Notes

- **Grammar**: Be concise. Sacrifice grammar in documentation for brevity.
- **Scoping**: All queries include creator or organization scope for multi-tenancy
- **Soft Deletes**: Deleted records remain in database (deletedAt IS NOT NULL)
- **Transactions**: Multi-step operations must be atomic via db.transaction()
- **Type Safety**: Let Zod infer types; don't define types manually
- **Error Handling**: Services throw specific errors; workers map to HTTP
- **Security First**: Validate all input, scope all queries, sign all URLs
- **Shared Bindings**: All external service credentials (R2, Stripe) in @codex/shared-types Bindings, not per-worker custom types

---

**Last Updated**: 2025-11-23
**Documentation Version**: 1.0
