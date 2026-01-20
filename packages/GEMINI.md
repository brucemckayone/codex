# Codex Packages Index

Master navigation guide for the Codex platform package layer. This document provides a comprehensive overview of all 18 packages, their relationships, and how to use them to build and extend the platform.

**Status**: Complete - All 18 packages documented and indexed
**Last Updated**: 2024-11-23

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Package Overview](#package-overview)
3. [Foundation Layer](#foundation-layer)
4. [Service Layer](#service-layer)
5. [Utility Packages](#utility-packages)
6. [Architecture Diagram](#architecture-diagram)
7. [Common Integration Patterns](#common-integration-patterns)
8. [Dependencies at a Glance](#dependencies-at-a-glance)
9. [Quick Reference](#quick-reference)
10. [Package Directory Structure](#package-directory-structure)

---

## Quick Start

**New to Codex?** Start here:

1. **Understanding the architecture**: Read [Architecture Diagram](#architecture-diagram) to see how packages connect
2. **Finding what you need**: Use [Quick Reference](#quick-reference) to locate the package for your use case
3. **Deep dive**: Click on any package name to read its full README.clog

**Common Tasks**:

| Task | Start Here |
|------|-----------|
| Create/manage content | @codex/content |
| Add user identity/org support | @codex/identity |
| Control who can access content | @codex/access |
| Build an API worker | @codex/worker-utils |
| Store/retrieve database data | @codex/database |
| Validate user input | @codex/validation |
| Handle errors consistently | @codex/service-errors |
| Add security (auth, rate limits) | @codex/security |
| Upload/stream media via R2 | @codex/cloudflare-clients |

---

## Package Overview

Codex organizes all business logic into **18 packages** across three architectural layers:

- **Foundation Layer** (5 packages): Core infrastructure depended on by everything else
- **Service Layer** (3 packages): Domain-specific business logic services
- **Utility Packages** (4 packages): Cross-cutting concerns and helpers

### Quick Navigation Table

| What You Need | Package | Key Exports |
|---------------|---------|-------------|
| **Data access** | @codex/database | dbHttp, dbWs, schema, query helpers |
| **Type safety** | @codex/shared-types | HonoEnv, response types, auth context |
| **Input validation** | @codex/validation | Zod schemas for all inputs |
| **Consistent errors** | @codex/service-errors | ServiceError, BaseService, error mapping |
| **Authentication/CORS** | @codex/security | requireAuth, securityHeaders, rateLimit |
| **Content management** | @codex/content | ContentService, MediaItemService |
| **Identity/orgs** | @codex/identity | OrganizationService |
| **Access control** | @codex/access | ContentAccessService |
| **Purchase management** | @codex/purchase | PurchaseService, Stripe client factory |
| **Worker setup** | @codex/worker-utils | createWorker, middleware factories |
| **R2 storage** | @codex/cloudflare-clients | R2Service, R2SigningClient |
| **Observability** | @codex/observability | Logging and monitoring |
| **Shared Constants** | @codex/constants | Platform fees, limits, MIME types || **Test setup** | @codex/test-utils | Database helpers, test utilities |

---

## Foundation Layer

Foundation packages provide core infrastructure. These are depended on by service and utility packages, and ultimately by all workers and applications.

### @codex/database

**Purpose**: Type-safe PostgreSQL/Neon data access layer with dual connection modes and query utilities.

**When to use**: Whenever you need to read/write data

**Key exports**:
- `dbHttp` - Stateless HTTP client (production workers)
- `dbWs` - Stateful WebSocket client with transactions (tests, local dev)
- `schema` - Complete database schema (users, content, organizations, etc.)
- Query helpers: `scopedNotDeleted()`, `withPagination()`, `whereNotDeleted()`
- Error detection: `isUniqueViolation()`, `isForeignKeyViolation()`

**Status tables**: users, accounts, sessions, organizations, organizationMemberships, content, mediaItems, contentAccess, purchases, videoPlayback

**Read full docs**: [packages/database/README.clog](packages/database/README.clog)

---

### @codex/shared-types

**Purpose**: TypeScript type definitions for worker environments, API responses, and authentication contexts.

**When to use**: Building workers, services, and client code that needs type-safe contracts

**Key exports**:
- `HonoEnv` - Hono environment with bindings and variables
- `Bindings` - Cloudflare resources (KV, R2, database)
- `Variables` - Context variables (user, session, requestId)
- Response types: `SingleItemResponse<T>`, `PaginatedListResponse<T>`, `ErrorResponse`
- Auth contexts: `AuthenticatedContext`, `EnrichedAuthContext`

**Key concept**: Zero runtime overhead - purely type definitions for compile-time safety

**Read full docs**: [packages/shared-types/README.clog](packages/shared-types/README.clog)

---

### @codex/service-errors

**Purpose**: Standardized error handling framework with consistent HTTP status mapping.

**When to use**: Creating services, mapping errors to HTTP responses, implementing consistent error handling across all packages

**Key exports**:
- `BaseService` - Abstract base class all domain services extend
- Error classes: `NotFoundError`, `ValidationError`, `ForbiddenError`, `ConflictError`, `BusinessLogicError`, `InternalServiceError`
- `mapErrorToResponse()` - Convert any error to standardized HTTP response

**Error-to-HTTP mapping**:
- 404: NotFoundError
- 400: ValidationError
- 403: ForbiddenError
- 409: ConflictError
- 422: BusinessLogicError
- 500: InternalServiceError

**Read full docs**: [packages/service-errors/README.clog](packages/service-errors/README.clog)

---

### @codex/security

**Purpose**: Complete security layer including headers, rate limiting, session auth, and worker-to-worker HMAC.

**When to use**: Building workers that need authentication, rate limiting, or CORS

**Key exports**:
- `securityHeaders()` - CSP, X-Frame-Options, HSTS, etc.
- `rateLimit()` - Distributed rate limiting with KV storage
- `requireAuth()`, `optionalAuth()` - Session validation from cookies
- `workerAuth()` - HMAC-based worker-to-worker authentication
- `generateWorkerSignature()`, `workerFetch()` - Service-to-service calls

**Key concept**: Defense in depth - multiple overlapping security mechanisms

**Read full docs**: [packages/security/README.clog](packages/security/README.clog)

---

### @codex/validation

**Purpose**: Centralized Zod schema library for request validation and type inference.

**When to use**: Validating user input, route parameters, query strings, request bodies

**Key exports**:
- Content schemas: `createContentSchema`, `updateContentSchema`, `contentQuerySchema`
- Media schemas: `createMediaItemSchema`, `updateMediaItemSchema`
- Organization schemas: `createOrganizationSchema`, `updateOrganizationSchema`
- Access schemas: `getStreamingUrlSchema`, `savePlaybackProgressSchema`, `listUserLibrarySchema`
- Primitives: `uuidSchema`, `emailSchema`, `urlSchema`, `priceCentsSchema`, slug helpers

**Key concept**: Type inference via `z.infer<typeof schema>` - single source of truth for validation and types

**Security features**: Prevents XSS (URL validation), path traversal (R2 key validation), injection attacks

**Read full docs**: [packages/validation/README.clog](packages/validation/README.clog)

---

## Service Layer

Service packages implement domain-specific business logic. They extend BaseService and use the foundation layer for data access and error handling.

### @codex/content

**Purpose**: Content and media item lifecycle management (draft → published → deleted).

**When to use**: Creating, updating, publishing, or deleting content; uploading and tracking media through transcoding pipeline

**Key exports**:
- `ContentService` - Create, publish, list content with full lifecycle management
- `MediaItemService` - Upload media, track transcoding status, mark ready
- Error classes: `ContentNotFoundError`, `MediaNotFoundError`, `MediaNotReadyError`, `SlugConflictError`

**Content lifecycle**:
```
create(draft) → update(metadata) → [media transcodes] → publish(live) → unpublish(draft) → delete(soft)
```

**Media lifecycle**:
```
create(uploading) → uploaded → transcoding → ready/failed
```

**Key concept**: Atomic transactions ensure consistency; soft deletes preserve data for analytics

**Read full docs**: [packages/content/README.clog](packages/content/README.clog)

---

### @codex/identity

**Purpose**: Organization and user identity management with unique slug validation.

**When to use**: Creating organizations, managing organization metadata, checking slug availability

**Key exports**:
- `OrganizationService` - Create, read, update, delete organizations with slug uniqueness
- Types: `Organization`, `CreateOrganizationInput`, `UpdateOrganizationInput`
- Error classes: `OrganizationNotFoundError` (404), `ConflictError` (409 on duplicate slug)

**Key concept**: Organizations are fundamental scoping mechanism for multi-tenancy; slugs must be globally unique

**Read full docs**: [packages/identity/README.clog](packages/identity/README.clog)

---

### @codex/access

**Purpose**: Content access control verification and streaming URL generation with playback tracking.

**When to use**: Generating presigned streaming URLs, checking user access, tracking video playback progress

**Key exports**:
- `ContentAccessService` - Verify access, generate signed URLs, track playback
- `createContentAccessService()` - Factory from environment variables
- Error classes: `AccessDeniedError` (403), `R2SigningError` (500)

**Access control logic**:
- Free content: Any authenticated user
- Paid content: User must have purchase (via @codex/purchase) OR be org member
- Org-scoped: Content belongs to organization

**Streaming**: Generates R2 presigned URLs (time-limited, cryptographically signed)

**Playback**: Tracks position/duration; auto-completes at 95%; prevents backwards overwrites

**Read full docs**: [packages/access/README.clog](packages/access/README.clog)

---

### @codex/purchase

**Purpose**: Stripe Checkout integration and purchase management with revenue split calculation.

**When to use**: Creating checkout sessions, recording purchases from webhooks, verifying ownership for access control

**Key exports**:
- `PurchaseService` - Purchase lifecycle, Stripe integration
- `createStripeClient()` - Stripe SDK factory with pinned API version
- `verifyWebhookSignature()` - HMAC-SHA256 signature verification
- `calculateRevenueSplit()` - Fee distribution calculator
- Error classes: `AlreadyPurchasedError` (409), `ContentNotPurchasableError` (400), `PaymentProcessingError` (502)

**Key methods**:
- `createCheckoutSession()` - Create Stripe checkout for paid content
- `completePurchase()` - Record purchase from webhook (idempotent)
- `verifyPurchase()` - Check customer owns content
- `getPurchaseHistory()` - Query purchases with pagination

**Business logic**:
- Supports one-time purchases (not subscriptions yet)
- Revenue split: Default 10% platform / 90% creator (configurable)
- Idempotency via stripePaymentIntentId unique constraint
- Integrates with @codex/access for access verification

**Read full docs**: [packages/purchase/README.clog](packages/purchase/README.clog)

---

## Utility Packages

Utility packages provide cross-cutting concerns, helpers, and infrastructure. Used by services and workers.

### @codex/worker-utils

**Purpose**: Factory functions and middleware for standardized Cloudflare Workers setup.

**When to use**: Building any API worker (content-api, identity-api, auth, ecom-api)

**Key exports**:
- `createWorker()` - Create fully configured Hono app with standard middleware
- `procedure()` - tRPC-style handler with policy, validation, services, and error handling
- `createServiceRegistry()` - Service registry factory for lazy-loaded services
- Middleware factories: `createRequestTrackingMiddleware()`, `createCorsMiddleware()`, `createSecurityHeadersMiddleware()`
- Test utilities: `createTestUser()`, `createAuthenticatedRequest()`

**Middleware chain** (in order):
1. Request Tracking (requestId, clientIP, userAgent)
2. Logging
3. CORS
4. Security Headers
5. Health Check route
6. Internal routes auth
7. API routes auth

**Read full docs**: [packages/worker-utils/README.clog](packages/worker-utils/README.clog)

---

### @codex/cloudflare-clients

**Purpose**: S3-compatible R2 object storage client with automatic retries and presigned URL generation.

**When to use**: Uploading media, generating streaming URLs, listing/deleting objects in R2

**Key exports**:
- `R2Service` - R2 operations with exponential backoff retry logic (Workers runtime)
- `R2SigningClient` - Standalone presigned URL generation (tests, scripts, Node.js)
- `createR2SigningClientFromEnv()` - Factory from environment variables

**R2Service methods**: `put()`, `get()`, `delete()`, `list()`, `putJson()`, `generateSignedUrl()`, multipart upload

**Key concept**: Presigned URLs provide temporary, cryptographically-signed access without exposing credentials

**Read full docs**: [packages/cloudflare-clients/README.clog](packages/cloudflare-clients/README.clog)

---

### @codex/observability
| **Shared Constants** | @codex/constants | Platform fees, limits, MIME types |
**Purpose**: Logging and monitoring infrastructure (documentation in separate file).

**When to use**: Logging events, tracking errors, measuring performance

**Key exports**:
- `ObservabilityClient` - Structured logging and error tracking
- Methods: `info()`, `warn()`, `error()`, `trackError()`

---

### @codex/test-utils

**Purpose**: Test database setup, user seeding, and integration testing helpers.

**When to use**: Integration tests, test database initialization, creating test data

**Key exports**:
- `setupTestDatabase()` - Initialize test database connection
- `teardownTestDatabase()` - Clean up test database
- `seedTestUsers()` - Create test users in database
- `withNeonTestBranch()` - Enable ephemeral Neon branch per test file

---

## Architecture Diagram

### Layered Architecture

```
WORKERS (API Endpoints)
├── workers/auth - Authentication/sessions
├── workers/content-api - Content CRUD, streaming, access control
├── workers/identity-api - Organization management
└── workers/ecom-api - Stripe checkout, purchase webhooks
    |
    v
SERVICE LAYER (Business Logic)
├── @codex/content - Content/media lifecycle
├── @codex/identity - Organization management
├── @codex/access - Access control & streaming (uses @codex/purchase)
└── @codex/purchase - Stripe integration, purchases, revenue splits
    |
    v
UTILITY PACKAGES (Cross-cutting Concerns)
├── @codex/worker-utils - Worker factories & middleware
├── @codex/cloudflare-clients - R2 storage operations
├── @codex/observability - Logging & monitoring
| **Shared Constants** | @codex/constants | Platform fees, limits, MIME types |└── @codex/test-utils - Test infrastructure
    |
    v
FOUNDATION LAYER (Core Infrastructure)
├── @codex/database - PostgreSQL/Neon data access
├── @codex/shared-types - Type definitions
├── @codex/service-errors - Error handling
├── @codex/security - Auth, rate limiting, CORS
└── @codex/validation - Input validation schemas
    |
    v
EXTERNAL SERVICES
├── Neon - PostgreSQL serverless database
├── Cloudflare R2 - Object storage
├── Cloudflare KV - Key-value cache
└── Stripe - Payment processing
```

### Dependency Flow

```
Foundation ← Service ← Utility ← Workers

Example: Content creation flow
1. User makes request to workers/content-api
2. Route handler uses @codex/worker-utils (procedure)
3. Calls @codex/content (ContentService.create)
4. Service extends @codex/service-errors (BaseService)
5. Service uses @codex/validation (createContentSchema)
6. Service uses @codex/database (dbHttp)
7. Database returns typed data using @codex/shared-types
8. Service throws typed errors from @codex/service-errors
9. Worker middleware catches errors using mapErrorToResponse
10. Response follows @codex/shared-types response envelope
```

### Critical Scoping Rules

```
User Access Model:
creator/owner ID → Controls content ownership
    ↓
Organization ID → Multi-tenant scoping (optional)
    ↓
Role-based access → Creator, admin, member, etc.
    ↓
Purchase/membership → Access to paid/org content

Example: Can user access content?
1. Is content published? (deleted=null, status='published')
2. Is content free? (priceCents=0) → YES
3. Did user purchase? (contentAccess exists) → YES
4. Is user org member? (organizationMemberships exists) → YES
5. Otherwise → NO (AccessDeniedError)
```

---

## Common Integration Patterns

### Pattern 1: Add a New API Endpoint

**Scenario**: Create a new endpoint to list user's content library.

**Files to touch**:
1. **@codex/validation** - Create `listUserLibrarySchema` if not exists
2. **@codex/access** - Add `listUserLibrary()` method to ContentAccessService
3. **@codex/database** - Write query to fetch purchases with progress
4. **workers/content-api** - Create route handler using createAuthenticatedHandler
5. **@codex/shared-types** - Define `UserLibraryResponse` type

**Step-by-step**:

```typescript
// 1. Define validation schema (already done)
import { listUserLibrarySchema } from '@codex/validation';

// 2. Implement service method
class ContentAccessService extends BaseService {
  async listUserLibrary(userId: string, input: ListUserLibraryInput) {
    // Query database (ContentService, then fetch progress)
    // Return UserLibraryResponse with items + pagination
  }
}

// 3. Create route handler
app.get('/api/user/library',
  procedure({
    policy: { auth: 'required' },
    input: { query: listUserLibrarySchema },
    handler: async (ctx) => {
      return await ctx.services.contentAccess.listUserLibrary(ctx.user.id, ctx.input.query);
    },
  })
);

// 4. Return matches @codex/shared-types UserLibraryResponse
```

**Key dependencies**:
- @codex/database - Read purchases, content, progress
- @codex/validation - Validate query parameters
- @codex/service-errors - Handle errors (inherits from BaseService)
- @codex/worker-utils - procedure
- @codex/shared-types - Type-safe response shape

---

### Pattern 2: Extend Content Functionality

**Scenario**: Add ability to add custom metadata tags to content.

**Files to touch**:
1. **@codex/database** - Add `tags` column to content table (migration)
2. **@codex/validation** - Update `createContentSchema` and `updateContentSchema`
3. **@codex/content** - Update ContentService.create/update methods
4. **workers/content-api** - Update route handlers (no code change, just updated schema validation)

**Step-by-step**:

```typescript
// 1. Database migration (Drizzle)
export const content = pgTable('content', {
  // ... existing columns
  tags: jsonb('tags').array().default(sql`ARRAY[]::jsonb[]`),
});

// 2. Update validation
const createContentSchema = z.object({
  // ... existing fields
  tags: z.array(z.string().max(50)).max(20).default([]),
});

// 3. Update service method signature
async create(input: CreateContentInput, creatorId: string) {
  // input.tags now available and validated
  const [content] = await this.db.insert(schema.content)
    .values({ ...input, creatorId })
    .returning();
  return content;
}

// 4. Route handler automatically works (schema validation applies)
```

**Key insight**: Service methods take pre-validated input from schemas - no manual validation needed

---

### Pattern 3: Test New Features

**Scenario**: Test that user can list their purchased content with filters.

**Files to touch**:
1. **packages/test files** - Create tests using @codex/test-utils

**Step-by-step**:

```typescript
import { setupTestDatabase, seedTestUsers, withNeonTestBranch } from '@codex/test-utils';
import { ContentAccessService } from '@codex/access';

// Enable ephemeral Neon branch per test file
withNeonTestBranch();

describe('User Library', () => {
  let db, service, userId;

  beforeAll(async () => {
    // Setup test database and create test user
    db = setupTestDatabase();
    const [user] = await seedTestUsers(db, 1);
    userId = user.id;
    service = new ContentAccessService({ db, /* mocked deps */ });
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('should list user purchased content', async () => {
    // Create purchase in database
    // Call service
    const result = await service.listUserLibrary(userId, {
      page: 1, limit: 20,
    });
    // Assert result matches UserLibraryResponse type
  });
});
```

**Key pattern**: Tests use real database (ephemeral branch) for integration testing

---

## Dependencies at a Glance

### Foundation Packages

```
@codex/database
  ├─ depends: drizzle-orm, @neon-sql/serverless
  └─ used by: [all service packages], [all workers]

@codex/shared-types
  ├─ depends: typescript (types only)
  └─ used by: [@codex/worker-utils], [all workers], [all services]

@codex/service-errors
  ├─ depends: @codex/database
  └─ used by: [@codex/content, @codex/identity, @codex/access, @codex/worker-utils]

@codex/security
  ├─ depends: hono, @codex/database
  └─ used by: [@codex/worker-utils], [all workers]

@codex/validation
  ├─ depends: zod
  └─ used by: [@codex/content, @codex/identity, @codex/access, @codex/worker-utils]
```

### Service Packages

```
@codex/content
  ├─ depends: @codex/database, @codex/validation, @codex/service-errors
  └─ used by: [workers/content-api], [@codex/access]

@codex/identity
  ├─ depends: @codex/database, @codex/validation, @codex/service-errors
  └─ used by: [workers/identity-api]

@codex/access
  ├─ depends: @codex/database, @codex/validation, @codex/service-errors, @codex/cloudflare-clients, @codex/purchase
  └─ used by: [workers/content-api]

@codex/purchase
  ├─ depends: @codex/database, @codex/validation, @codex/service-errors, stripe
  └─ used by: [workers/ecom-api], [@codex/access]
```

### Utility Packages

```
@codex/worker-utils
  ├─ depends: @codex/security, @codex/shared-types, @codex/service-errors, hono, zod
  └─ used by: [all workers]

@codex/cloudflare-clients
  ├─ depends: @aws-sdk/client-s3, @aws-sdk/s3-request-presigner
  └─ used by: [@codex/access], [workers/content-api]

@codex/observability
| **Shared Constants** | @codex/constants | Platform fees, limits, MIME types |  ├─ depends: (minimal, self-contained)
  └─ used by: [@codex/worker-utils], [all workers]

@codex/test-utils
  ├─ depends: @codex/database, neon-testing
  └─ used by: [all test suites]
```

---

## Quick Reference

### "I need to..." → Package to use

| Need | Package | Key Exports |
|------|---------|-------------|
| Read/write data | @codex/database | dbHttp, dbWs, schema |
| Validate user input | @codex/validation | Zod schemas for all domains |
| Handle errors consistently | @codex/service-errors | BaseService, error classes, mapErrorToResponse |
| Create content/media | @codex/content | ContentService, MediaItemService |
| Manage organizations | @codex/identity | OrganizationService |
| Control access to content | @codex/access | ContentAccessService |
| Handle purchases & Stripe | @codex/purchase | PurchaseService, createStripeClient, verifyWebhookSignature |
| Build an API worker | @codex/worker-utils | createWorker, procedure |
| Upload media to R2 | @codex/cloudflare-clients | R2Service, R2SigningClient |
| Generate streaming URLs | @codex/cloudflare-clients | R2Service.generateSignedUrl() |
| Add authentication | @codex/security | requireAuth, optionalAuth |
| Add rate limiting | @codex/security | rateLimit with RATE_LIMIT_PRESETS |
| Add security headers | @codex/security | securityHeaders |
| Type-safe response envelopes | @codex/shared-types | SingleItemResponse, PaginatedListResponse |
| Set up tests | @codex/test-utils | setupTestDatabase, seedTestUsers |
| Track errors/logs | @codex/observability | ObservabilityClient |
| **Shared Constants** | @codex/constants | Platform fees, limits, MIME types |
### Import Patterns by Use Case

**Building a service**:
```typescript
import { BaseService, type ServiceConfig } from '@codex/service-errors';
import { dbHttp } from '@codex/database';
import { createMySchema } from '@codex/validation';

export class MyService extends BaseService {
  async create(input: CreateMyInput) {
    const validated = createMySchema.parse(input);
    // use this.db (inherited)
  }
}
```

**Building a worker route**:
```typescript
import { createWorker, procedure } from '@codex/worker-utils';
import { myServiceSchema } from '@codex/validation';
import type { HonoEnv } from '@codex/shared-types';

const app = createWorker({ serviceName: 'my-api' });

app.post('/api/my-resource',
  procedure({
    policy: { auth: 'required' },
    input: { body: myServiceSchema },
    successStatus: 201,
    handler: async (ctx) => {
      return await ctx.services.myService.create(ctx.input.body, ctx.user.id);
    },
  })
);
```

**Querying the database**:
```typescript
import { dbHttp, schema, scopedNotDeleted, withPagination } from '@codex/database';
import { eq } from 'drizzle-orm';

const pagination = withPagination({ page: 1, limit: 20 });
const items = await dbHttp.query.content.findMany({
  where: scopedNotDeleted(schema.content, userId),
  limit: pagination.limit,
  offset: pagination.offset,
});
```

---

## Package Directory Structure

```
packages/
├── database/                    # PostgreSQL/Neon data access layer
│   ├── src/
│   │   ├── schema/             # Drizzle ORM table definitions
│   │   ├── migrations/         # Database schema migrations
│   │   ├── clients/            # dbHttp, dbWs initialization
│   │   ├── query-helpers/      # scopedNotDeleted, withPagination, etc.
│   │   └── index.ts            # Main exports
│   └── README.clog
│
├── shared-types/                # TypeScript type definitions
│   ├── src/
│   │   ├── worker-types.ts     # HonoEnv, Bindings, Variables
│   │   ├── api-responses.ts    # Response envelope types
│   │   └── index.ts            # Main exports
│   └── README.clog
│
├── service-errors/              # Error handling framework
│   ├── src/
│   │   ├── base-errors.ts      # Error class hierarchy
│   │   ├── base-service.ts     # BaseService abstract class
│   │   ├── error-mapper.ts     # mapErrorToResponse function
│   │   └── index.ts            # Main exports
│   └── README.clog
│
├── security/                    # Authentication, rate limiting, CORS
│   ├── src/
│   │   ├── middleware/         # Security middleware
│   │   ├── auth/               # Session validation
│   │   ├── rate-limit/         # Rate limiting logic
│   │   ├── headers/            # Security headers
│   │   └── index.ts            # Main exports
│   └── README.clog
│
├── validation/                  # Zod schema definitions
│   ├── src/
│   │   ├── primitives.ts       # UUID, email, slug, URL validators
│   │   ├── content/            # Content, media, organization schemas
│   │   ├── identity/           # User schemas
│   │   ├── schemas/            # Access, streaming schemas
│   │   └── index.ts            # Main exports
│   └── README.clog
│
├── content/                     # Content & media lifecycle
│   ├── src/
│   │   ├── services/           # ContentService, MediaItemService
│   │   ├── errors.ts           # Domain-specific error classes
│   │   └── index.ts            # Main exports
│   └── README.clog
│
├── identity/                    # Organization management
│   ├── src/
│   │   ├── services/           # OrganizationService
│   │   ├── errors.ts           # Domain-specific error classes
│   │   └── index.ts            # Main exports
│   └── README.clog
│
├── access/                      # Access control & streaming
│   ├── src/
│   │   ├── services/           # ContentAccessService
│   │   ├── errors.ts           # Domain-specific error classes
│   │   └── index.ts            # Main exports
│   └── README.clog
│
├── purchase/                    # Purchases & Stripe integration
│   ├── src/
│   │   ├── services/           # PurchaseService, revenue calculator
│   │   ├── stripe-client.ts    # Centralized Stripe client factory
│   │   ├── errors.ts           # Domain-specific error classes
│   │   ├── types.ts            # Purchase record types
│   │   └── index.ts            # Main exports
│   └── README.clog
│
├── worker-utils/                # Worker factories & middleware
│   ├── src/
│   │   ├── factory/            # createWorker function
│   │   ├── middleware/         # Middleware factories
│   │   ├── routes/             # Route helpers
│   │   ├── security/           # Security policies
│   │   ├── test-utils/         # createTestUser, etc.
│   │   └── index.ts            # Main exports
│   └── README.clog
│
├── cloudflare-clients/          # R2 storage operations
│   ├── src/
│   │   ├── r2/
│   │   │   ├── r2-service.ts       # R2Service class
│   │   │   ├── r2-signing-client.ts # R2SigningClient class
│   │   │   └── index.ts            # Main exports
│   │   └── kv/
│   │       └── placeholder.ts      # KV placeholder
│   └── README.clog
│
├── observability/               # Logging & monitoring
│   ├── src/
│   │   ├── client.ts           # ObservabilityClient class
│   │   └── index.ts            # Main exports
│   └── README.md               # Separate documentation
│
└── test-utils/                  # Test infrastructure
    ├── src/
    │   ├── database.ts         # setupTestDatabase, seedTestUsers
    │   ├── neon-branch.ts      # withNeonTestBranch
    │   ├── users.ts            # Test user creation
    │   └── index.ts            # Main exports
    └── README.clog
```

---

## Key Principles

### 1. Scoping & Access Control

**Creator Scoping**: All queries filtered by `creatorId` to prevent cross-user access
**Organization Scoping**: Content can belong to organization (multi-tenant) or creator (personal)
**Soft Deletes**: Deleted records marked with `deletedAt` timestamp, excluded from queries automatically

### 2. Type Safety

All schemas in @codex/validation enable automatic type inference:
```typescript
type Input = z.infer<typeof createContentSchema>;
```

All responses use @codex/shared-types envelopes for compile-time verification:
```typescript
const response: CreateContentResponse = { data: content };
```

### 3. Error Handling

Consistent error model across all packages:
- Services throw specific error classes (@codex/service-errors)
- Workers catch errors and map to HTTP responses (mapErrorToResponse)
- Clients receive standardized @codex/shared-types ErrorResponse

### 4. Database Transactions

Multi-step operations use transactions for atomicity:
```typescript
await db.transaction(async (tx) => {
  // All operations succeed together or all fail together
});
```

### 5. Middleware Chaining

Workers use composable middleware in strict order:
1. Request Tracking
2. Logging
3. CORS
4. Security Headers
5. Authentication
6. Route Handler
7. Error Handling

---

## Package Versions & Compatibility

| Package | Version | Stability | Node/Workers |
|---------|---------|-----------|--------------|
| @codex/database | 0.1.0 | Foundation | Node 18+, Workers |
| @codex/shared-types | 0.1.0 | Stable | Node 18+, TypeScript |
| @codex/service-errors | 0.1.0 | Stable | Node 18+, Workers |
| @codex/security | 0.1.0 | Stable | Workers |
| @codex/validation | 0.1.0 | Stable | Node 18+, Workers |
| @codex/content | 0.1.0 | Active | Node 18+, Workers |
| @codex/identity | 0.1.0 | Active | Node 18+, Workers |
| @codex/access | 0.1.0 | Active | Node 18+, Workers |
| @codex/worker-utils | 0.1.0 | Stable | Workers |
| @codex/cloudflare-clients | 0.1.0 | Stable | Node 18+, Workers |
| @codex/observability | 0.1.0 | Active | Node 18+, Workers |
| **Shared Constants** | @codex/constants | Platform fees, limits, MIME types || @codex/test-utils | 0.1.0 | Testing | Node 18+ |

---

## Getting Help

**Stuck?** Follow this flow:

1. **Look up the package** in [Quick Reference](#quick-reference)
2. **Read the full documentation** by clicking the package link
3. **Find the pattern** in [Common Integration Patterns](#common-integration-patterns)
4. **Copy the example** and adapt to your use case
5. **Check related packages** in [Dependencies at a Glance](#dependencies-at-a-glance)

**Common issues**:

| Problem | Solution |
|---------|----------|
| "Type is not assignable" | Check @codex/shared-types response envelope |
| "Resource not found when I know it exists" | Add `whereNotDeleted()` to query |
| "Different results in test vs production" | Verify scoping (creatorId, organizationId) |
| "Validation error on input" | Check @codex/validation schema matches request |
| "Can't generate signed URL" | Verify R2 credentials in @codex/cloudflare-clients config |
| "Middleware order issue" | Check createWorker middleware chain order |

---

**Last Updated**: 2024-11-23
**Version**: 1.0
**Maintained by**: Codex Documentation Team
