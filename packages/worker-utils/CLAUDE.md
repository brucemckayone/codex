# @codex/worker-utils

Factory functions and middleware for standardized Cloudflare Workers setup. Eliminates boilerplate across all API workers by providing composable utilities for authentication, CORS, security headers, request tracking, route handlers, and health checks.

**Primary purpose**: Reduce repetitive setup code and ensure consistency across auth, content-api, identity-api, and ecom-api workers.

**Core responsibility**: Worker configuration, middleware composition, procedure-based route handlers, and handler utilities.

## Overview

@codex/worker-utils is a utility package that sits at the intersection of Hono web framework capabilities and Codex domain requirements. It provides:

1. **Worker Factory** - createWorker() creates fully configured Hono app with production-ready middleware
2. **Middleware Factories** - Composable middleware for auth, CORS, security headers, health checks, request tracking
3. **Procedure Handler** - procedure() combines policy enforcement, validation, service injection, and error handling
4. **Health Checks** - Standardized health check endpoints with optional dependency checks
5. **Test Utilities** - Real session creation for integration testing without mocks
6. **Middleware Chaining** - Builder utilities for custom middleware chains

Used by all four Codex workers (auth, content-api, identity-api, ecom-api) and directly imported by integration tests.

---

## Public API

### Worker Factory

| Export | Type | Purpose |
|--------|------|---------|
| **createWorker(config)** | Function | Create fully configured Hono app with standard middleware |
| **WorkerConfig** | Interface | Configuration for createWorker() |
| **CORSConfig** | Interface | CORS configuration options |
| **HealthCheckOptions** | Interface | Health check configuration |

### Middleware Factories

| Export | Type | Purpose |
|--------|------|---------|
| **createRequestTrackingMiddleware()** | Function | UUID, IP, user agent extraction |
| **createCorsMiddleware()** | Function | CORS validation and headers |
| **createSecurityHeadersMiddleware()** | Function | CSP, X-Frame-Options, HSTS, etc. |
| **createAuthMiddleware()** | Function | Session-based user authentication |
| **createLoggerMiddleware()** | Function | Request/response logging |
| **createHealthCheckHandler()** | Function | Health check endpoint handler |
| **createNotFoundHandler()** | Function | Standard 404 handler |
| **createErrorHandler()** | Function | Global error handler |
| **createObservabilityMiddleware()** | Function | Request timing and error tracking |
| **createObservabilityErrorHandler()** | Function | Error handler with observability |
| **createRateLimitWrapper()** | Function | Apply rate limiting to routes |
| **createSecurityHeadersWrapper()** | Function | Apply security headers to routes |
| **createErrorResponse()** | Function | Standardized error response builder |
| **sequence()** | Function | Chain multiple middleware handlers |
| **ERROR_CODES** | Constant | Standard error code enum |
| **MiddlewareConfig** | Interface | Configuration for middleware factories |

### Health Check Utilities

| Export | Type | Purpose |
|--------|------|---------|
| **standardDatabaseCheck()** | Function | Reusable database connectivity check |
| **createKvCheck()** | Function | Create KV namespace health checks |
| **createR2Check()** | Function | Create R2 bucket health checks |
| **HealthCheckResult** | Interface | Health check result structure |

### Middleware Chain Builders

| Export | Type | Purpose |
|--------|------|---------|
| **createStandardMiddlewareChain()** | Function | Create array of standard middleware |
| **applyMiddlewareChain()** | Function | Apply middleware chain to specific routes |
| **createMiddlewareChainBuilder()** | Function | Create reusable chain builder |
| **MiddlewareChainOptions** | Interface | Options for middleware chains |
| **ApplyMiddlewareChainOptions** | Interface | Options for applying chains to routes |

### Procedure Pattern

| Export | Type | Purpose |
|--------|------|---------|
| **procedure()** | Function | tRPC-style procedure handler with policy, validation, services |
| **createServiceRegistry()** | Function | Service registry factory for lazy-loaded services |
| **ProcedureConfig** | Interface | Configuration for procedure() |
| **ProcedureContext** | Interface | Context provided to procedure handlers |
| **ProcedurePolicy** | Interface | Security policy configuration |
| **InputSchema** | Interface | Input schema definition (params/query/body) |
| **InferInput** | Type | Infer validated input types from schema |
| **ServiceRegistry** | Interface | All available services (lazy-loaded) |

### Response Types

| Export | Type | Purpose |
|--------|------|---------|
| **HealthCheckResponse** | Interface | Standard health check response format |
| **ErrorResponse** | Interface | Standard error response structure |
| **SuccessResponse<T>** | Interface | Standard success response wrapper |

### Test Utilities

| Export | Type | Purpose |
|--------|------|---------|
| **createTestUser()** | Function | Create real test user and session |
| **cleanupTestUser()** | Function | Remove test user from database |
| **createAuthenticatedRequest()** | Function | Create Request with auth cookie |
| **TestUser** | Interface | Test user data structure |

---

## Core Services & Utilities

### createWorker(config)

Creates fully configured Hono application with production-ready middleware stack and routing.

**Function signature**:

```typescript
function createWorker(config: WorkerConfig): Hono<HonoEnv>
```

**Configuration (WorkerConfig)**:

```typescript
interface WorkerConfig extends MiddlewareConfig {
  serviceName: string;           // Required: Service identifier
  version?: string;              // Service version for health endpoint (default: '1.0.0')
  environment?: 'development' | 'staging' | 'production';
  enableLogging?: boolean;       // Default: true
  enableCors?: boolean;          // Default: true
  enableSecurityHeaders?: boolean; // Default: true
  enableRequestTracking?: boolean; // Default: true
  enableGlobalAuth?: boolean;    // Default: true (auto-auth on /api/*)
  publicRoutes?: string[];       // Routes bypassing auth (default: ['/health'])
  internalRoutePrefix?: string;  // Prefix for worker-to-worker (default: '/internal')
  workerSharedSecret?: string;   // HMAC secret for internal routes
  allowedWorkerOrigins?: string[]; // IP whitelist for internal routes
  cors?: CORSConfig;             // Custom CORS configuration
  healthCheck?: HealthCheckOptions; // Database, KV, R2 checks
}
```

**What it does**:

1. Creates Hono<HonoEnv> instance
2. Applies middleware in order: tracking -> logging -> CORS -> security headers
3. Registers /health endpoint (always public, no auth required)
4. Sets up internal routes with HMAC authentication if secret provided
5. Sets up API routes with session-based authentication
6. Registers 404 and 500 error handlers
7. Returns configured app ready for route mounting

**Middleware execution order**:

1. Request Tracking (requestId, clientIP, userAgent)
2. Logging (request/response logs)
3. CORS (origin validation, CORS headers)
4. Security Headers (CSP, X-Frame-Options, etc.)
5. Route Matching:
   - GET /health -> No auth required
   - /internal/* -> HMAC authentication
   - /api/* -> Session authentication
   - Other routes -> No auth by default

**What each middleware sets in context**:

- `requestId` - UUID v4 for request correlation
- `clientIP` - Client IP from CF-Connecting-IP, X-Real-IP, X-Forwarded-For
- `user` - Authenticated user object (from session)
- `session` - Session data (from database)
- `organizationId` - Organization ID (if applicable)
- `obs` - ObservabilityClient instance (if observability enabled)

**Basic usage**:

```typescript
import { createWorker } from '@codex/worker-utils';

const app = createWorker({
  serviceName: 'content-api',
  version: '1.0.0',
  environment: 'production',
});

// Mount your routes
app.route('/api/content', contentRoutes);
app.route('/api/media', mediaRoutes);

export default app;
```

**With health checks**:

```typescript
import {
  createWorker,
  standardDatabaseCheck,
  createKvCheck,
  createR2Check
} from '@codex/worker-utils';

const app = createWorker({
  serviceName: 'content-api',
  healthCheck: {
    checkDatabase: standardDatabaseCheck,
    checkKV: createKvCheck(['RATE_LIMIT_KV', 'SESSIONS_KV']),
    checkR2: createR2Check(['MEDIA_BUCKET']),
  },
});
```

**With internal routes (worker-to-worker HMAC auth)**:

```typescript
const app = createWorker({
  serviceName: 'ecom-api',
  internalRoutePrefix: '/internal',
  workerSharedSecret: c.env.WORKER_SHARED_SECRET,
  allowedWorkerOrigins: ['https://stripe.com', '10.0.0.0/8'],
});

// Mount internal routes (HMAC authenticated, no user session required)
app.route('/internal/webhooks', webhookRoutes);
```

**With custom CORS**:

```typescript
const app = createWorker({
  serviceName: 'public-api',
  cors: {
    allowedOrigins: [
      'https://partner.example.com',
      'https://app.example.com'
    ],
    allowCredentials: false,
    allowMethods: ['GET', 'POST'],
    maxAge: 3600, // 1 hour
  },
});
```

**Returns**: Hono<HonoEnv> application ready for route mounting and export as Cloudflare Worker default handler.

---

### procedure()

tRPC-style procedure handler that combines policy enforcement, input validation, service injection, error handling, and response envelope into a single declarative function.

**Function signature**:

```typescript
function procedure<
  TPolicy extends ProcedurePolicy = { auth: 'required' },
  TInput extends InputSchema | undefined = undefined,
  TOutput = unknown,
>(config: ProcedureConfig<TPolicy, TInput, TOutput>): ProcedureHandler
```

**Configuration (ProcedureConfig)**:

```typescript
interface ProcedureConfig<TPolicy, TInput, TOutput> {
  // Security policy configuration (default: { auth: 'required' })
  policy?: TPolicy;

  // Input validation schemas (optional)
  input?: TInput;

  // Handler function with fully typed context
  handler: (ctx: ProcedureContext<TPolicy, TInput>) => Promise<TOutput>;

  // Success HTTP status code (default: 200)
  successStatus?: 200 | 201 | 204;
}
```

**Policy options (ProcedurePolicy)**:

```typescript
interface ProcedurePolicy {
  // Authentication requirement
  auth?: 'none' | 'optional' | 'required' | 'worker' | 'platform_owner';

  // Role-based access control
  roles?: Array<'user' | 'creator' | 'admin' | 'system'>;

  // Require organization membership
  requireOrgMembership?: boolean;

  // Require organization management privileges (owner/admin)
  requireOrgManagement?: boolean;

  // Rate limiting preset
  rateLimit?: 'api' | 'auth' | 'strict' | 'public' | 'webhook' | 'streaming';

  // IP whitelist
  allowedIPs?: string[];
}
```

**Auth levels**:

- `'none'` - Public endpoint, no authentication required
- `'optional'` - Authentication attempted but not required (user may be undefined)
- `'required'` - Must have authenticated user (default)
- `'worker'` - Worker-to-worker HMAC authentication
- `'platform_owner'` - Must be platform owner role

**Input schema (InputSchema)**:

```typescript
interface InputSchema {
  params?: ZodSchema;  // URL path parameters
  query?: ZodSchema;   // Query string parameters
  body?: ZodSchema;    // Request body
}
```

**Context provided to handler (ProcedureContext)**:

```typescript
interface ProcedureContext<TPolicy, TInput> {
  // Auth context - type depends on policy.auth
  user: UserForAuth<TPolicy['auth']>;      // UserData, UserData | undefined, or undefined
  session: SessionForAuth<TPolicy['auth']>;

  // Validated input from schema
  input: InferInput<TInput>;  // Type-safe validated data

  // Request metadata
  requestId: string;
  clientIP: string;
  userAgent: string;

  // Organization context
  organizationId: string | undefined;
  organizationRole: string | undefined;

  // Environment bindings
  env: Bindings;

  // Observability client
  obs: ObservabilityClient | undefined;

  // Service registry (lazy-loaded)
  services: ServiceRegistry;
}
```

**Service registry**:

Services are lazy-loaded on first access to avoid creating unused instances:

```typescript
interface ServiceRegistry {
  content: ContentService;
  media: MediaItemService;
  access: ContentAccessService;
  organization: OrganizationService;
  settings: PlatformSettingsFacade;
  purchase: PurchaseService;
  adminAnalytics: AdminAnalyticsService;
  adminContent: AdminContentManagementService;
  adminCustomer: AdminCustomerManagementService;
}
```

**Features**:

- Automatic policy enforcement (auth, RBAC, IP whitelist, org membership)
- Type-safe validated data from params, query, body via Zod
- Automatic 400 response on validation error with field details
- Automatic 401/403 responses for auth/permission failures
- Automatic error mapping from service layer to HTTP responses
- Automatic response envelope wrapping (`{ data: T }`)
- Lazy-loaded services via `ctx.services`
- Automatic service cleanup via `c.executionCtx.waitUntil(cleanup())`

**GET example** (no body parsing):

```typescript
import { z } from 'zod';
import { procedure } from '@codex/worker-utils';

app.get('/api/content/:id',
  procedure({
    policy: { auth: 'required' },
    input: {
      params: z.object({ id: z.string().uuid() }),
    },
    handler: async (ctx) => {
      return await ctx.services.content.getById(ctx.input.params.id, ctx.user.id);
    },
  })
);
```

**POST example** (with body parsing, 201 status):

```typescript
const createContentSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(100),
  contentType: z.enum(['video', 'audio', 'document']),
  description: z.string().optional(),
  priceCents: z.number().int().min(0).optional(),
});

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

**PATCH example** (params and body):

```typescript
app.patch('/api/content/:id',
  procedure({
    policy: { auth: 'required' },
    input: {
      params: z.object({ id: z.string().uuid() }),
      body: z.object({
        title: z.string().optional(),
        description: z.string().optional(),
      }),
    },
    handler: async (ctx) => {
      return await ctx.services.content.update(
        ctx.input.params.id,
        ctx.input.body,
        ctx.user.id
      );
    },
  })
);
```

**DELETE example** (204 No Content response):

```typescript
app.delete('/api/content/:id',
  procedure({
    policy: { auth: 'required' },
    input: {
      params: z.object({ id: z.string().uuid() }),
    },
    successStatus: 204,
    handler: async (ctx) => {
      await ctx.services.content.delete(ctx.input.params.id, ctx.user.id);
      return null; // Response body ignored for 204
    },
  })
);
```

**Public endpoint example**:

```typescript
app.get('/api/content/featured',
  procedure({
    policy: { auth: 'none' },
    handler: async (ctx) => {
      return await ctx.services.content.getFeatured();
    },
  })
);
```

**Organization-scoped example**:

```typescript
app.patch('/api/org/settings',
  procedure({
    policy: { auth: 'required', requireOrgMembership: true },
    input: {
      body: z.object({
        name: z.string().optional(),
        description: z.string().optional(),
      }),
    },
    handler: async (ctx) => {
      // organizationId is guaranteed to exist when requireOrgMembership: true
      return await ctx.services.organization.updateSettings(
        ctx.organizationId,
        ctx.input.body
      );
    },
  })
);
```

**Error handling** (automatic):

- Invalid JSON -> 400 with INVALID_JSON code
- Validation failed -> 400 with VALIDATION_ERROR + field errors
- No authentication -> 401 with UNAUTHORIZED code
- Insufficient permissions -> 403 with FORBIDDEN code
- Service NotFoundError -> 404 with NOT_FOUND code
- Service ValidationError -> 400 with validation details
- Service ForbiddenError -> 403 with FORBIDDEN code
- Service ConflictError -> 409 with conflict details
- Service BusinessLogicError -> 422 with business logic message
- Service InternalServiceError -> 500 with error message
- Any other error -> 500 with INTERNAL_ERROR code

All service errors automatically mapped via mapErrorToResponse() from @codex/service-errors.

---

### createRequestTrackingMiddleware()

Injects request metadata into context for correlation and debugging.

**Function signature**:

```typescript
function createRequestTrackingMiddleware(): MiddlewareHandler<HonoEnv>
```

**Sets in context**:

- `requestId` - UUID v4 for request correlation across logs
- `clientIP` - Client IP from CF-Connecting-IP, X-Real-IP, X-Forwarded-For
- `userAgent` - User agent string from User-Agent header

**Also sets**: X-Request-ID response header for client-side correlation

**Extraction order** (for client IP):

1. CF-Connecting-IP (Cloudflare provided)
2. X-Real-IP (proxy header)
3. X-Forwarded-For (proxy chain, takes first)
4. 'unknown' (fallback)

**When to use**: Applied automatically by createWorker(), or apply manually to custom middleware chains.

**Example**:

```typescript
app.use('*', createRequestTrackingMiddleware());

app.get('/api/content/:id', (c) => {
  const requestId = c.get('requestId');
  const clientIP = c.get('clientIP');
  console.log(`Request ${requestId} from ${clientIP}`);
  return c.json({ ok: true });
});
```

---

### createHealthCheckHandler()

Creates handler for /health endpoint with optional dependency checks.

**Function signature**:

```typescript
function createHealthCheckHandler(
  serviceName: string,
  version?: string,
  options?: {
    checkDatabase?: (c: Context) => Promise<{status: 'ok'|'error'; message?: string}>;
    checkKV?: (c: Context) => Promise<{status: 'ok'|'error'; message?: string; details?: unknown}>;
    checkR2?: (c: Context) => Promise<{status: 'ok'|'error'; message?: string; details?: unknown}>;
  }
): MiddlewareHandler
```

**Response format**:

```json
{
  "status": "healthy|degraded|unhealthy",
  "service": "content-api",
  "version": "1.0.0",
  "timestamp": 1705329000000,
  "checks": {
    "database": { "status": "ok" },
    "kv": { "status": "ok" },
    "r2": { "status": "error", "message": "Bucket not accessible" }
  }
}
```

**HTTP status**:

- 200 OK if all checks pass or healthy
- 503 Service Unavailable if any check fails

**When to use**: Applied automatically by createWorker() to GET /health. Always public, no authentication.

**Example with checks**:

```typescript
import { createHealthCheckHandler, standardDatabaseCheck } from '@codex/worker-utils';

const handler = createHealthCheckHandler('content-api', '1.0.0', {
  checkDatabase: standardDatabaseCheck,
  checkKV: async (c) => {
    try {
      const kv = c.env.RATE_LIMIT_KV;
      await kv.put('health-check', Date.now().toString(), { expirationTtl: 1 });
      return { status: 'ok' };
    } catch (error) {
      return { status: 'error', message: 'KV write failed' };
    }
  },
});

app.get('/health', handler);
```

---

### createTestUser()

Create real test user and session in test database for integration testing.

**Function signature**:

```typescript
async function createTestUser(email?: string): Promise<{
  user: UserData;
  session: SessionData;
  sessionToken: string;
}>
```

**What it does**:

1. Creates user record in database with unique email
2. Creates valid session with 24-hour expiration
3. Returns session token for use in authenticated test requests

**When to use**: Integration tests that need real authenticated sessions instead of mocks.

**Important**: Only use in test files. Creates real records in test database. Always cleanup with cleanupTestUser() after tests.

**Returns**: TestUser object:

```typescript
interface TestUser {
  user: UserData;           // User object from database
  session: SessionData;     // Session object with expiry
  sessionToken: string;     // Session token for use in requests
}
```

**Example**:

```typescript
import { createTestUser, cleanupTestUser } from '@codex/worker-utils';

describe('Content API', () => {
  let testUser;

  beforeAll(async () => {
    testUser = await createTestUser();
  });

  afterAll(async () => {
    await cleanupTestUser(testUser.user.id);
  });

  it('should create content with valid auth', async () => {
    const req = new Request('http://localhost/api/content', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `codex-session=${testUser.sessionToken}`,
      },
      body: JSON.stringify({
        title: 'Test Article',
        slug: 'test-article',
        contentType: 'document',
      }),
    });

    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.data.title).toBe('Test Article');
  });

  it('should reject unauthenticated requests', async () => {
    const req = new Request('http://localhost/api/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test' }),
    });

    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(401);
  });
});
```

---

### cleanupTestUser()

Remove test user and all associated sessions from database.

**Function signature**:

```typescript
async function cleanupTestUser(userId: string): Promise<void>
```

**Cleanup cascade**: Deleting user automatically removes all associated sessions via foreign key cascade.

**When to use**: In afterAll() or afterEach() to clean up test data and prevent database pollution.

**Example**:

```typescript
afterAll(async () => {
  await cleanupTestUser(testUser.user.id);
});
```

---

### createAuthenticatedRequest()

Helper to create Request object with authentication cookie.

**Function signature**:

```typescript
function createAuthenticatedRequest(
  url: string,
  sessionToken: string,
  options?: RequestInit
): Request
```

**What it does**: Creates Request with 'codex-session' cookie set to sessionToken.

**Example**:

```typescript
const testUser = await createTestUser();

const req = createAuthenticatedRequest(
  'http://localhost/api/content/:id',
  testUser.sessionToken,
  {
    method: 'DELETE',
  }
);

const res = await app.fetch(req, testEnv);
expect(res.status).toBe(204);
```

---

## Usage Examples

### Basic Worker Setup

```typescript
import { createWorker, procedure, standardDatabaseCheck } from '@codex/worker-utils';
import { z } from 'zod';

const app = createWorker({
  serviceName: 'content-api',
  version: '1.0.0',
  environment: 'production',
  enableGlobalAuth: true,
  healthCheck: {
    checkDatabase: standardDatabaseCheck,
  },
});

// Public endpoint - no auth required
app.get('/api/content/featured',
  procedure({
    policy: { auth: 'none' },
    handler: async (ctx) => {
      return await ctx.services.content.getFeatured();
    },
  })
);

// Authenticated endpoint - any user
app.get('/api/content/:id',
  procedure({
    policy: { auth: 'required' },
    input: {
      params: z.object({ id: z.string().uuid() }),
    },
    handler: async (ctx) => {
      return await ctx.services.content.getById(ctx.input.params.id, ctx.user.id);
    },
  })
);

// Creator-only - must have creator role
app.post('/api/content',
  procedure({
    policy: { auth: 'required', roles: ['creator'] },
    input: {
      body: z.object({
        title: z.string().min(1),
        slug: z.string().min(1),
        contentType: z.enum(['video', 'audio', 'document']),
      }),
    },
    successStatus: 201,
    handler: async (ctx) => {
      return await ctx.services.content.create(ctx.input.body, ctx.user.id);
    },
  })
);

// Admin-only - delete resource
app.delete('/api/content/:id',
  procedure({
    policy: { auth: 'required', roles: ['admin'] },
    input: {
      params: z.object({ id: z.string().uuid() }),
    },
    successStatus: 204,
    handler: async (ctx) => {
      await ctx.services.content.delete(ctx.input.params.id);
      return null;
    },
  })
);

export default app;
```

### With Observability

```typescript
app.post('/api/content',
  procedure({
    policy: { auth: 'required', roles: ['creator'] },
    input: { body: createContentSchema },
    handler: async (ctx) => {
      // Access request metadata
      console.log(`Request ${ctx.requestId} from ${ctx.clientIP}`);

      // Get observability client
      if (ctx.obs) {
        ctx.obs.info('Creating content', {
          userId: ctx.user.id,
          requestId: ctx.requestId,
        });
      }

      return await ctx.services.content.create(ctx.input.body, ctx.user.id);
    },
  })
);
```

### Organization-Scoped Routes

```typescript
app.patch('/api/org/settings',
  procedure({
    policy: { auth: 'required', requireOrgMembership: true },
    input: {
      body: z.object({
        name: z.string().optional(),
        slug: z.string().optional(),
      }),
    },
    handler: async (ctx) => {
      // organizationId is guaranteed when requireOrgMembership: true
      return await ctx.services.organization.updateSettings(
        ctx.organizationId,
        ctx.input.body
      );
    },
  })
);
```

### Internal Worker Routes

```typescript
import { createWorker, procedure } from '@codex/worker-utils';

const app = createWorker({
  serviceName: 'ecom-api',
  internalRoutePrefix: '/internal',
  workerSharedSecret: env.WORKER_SHARED_SECRET,
  allowedWorkerOrigins: ['https://stripe.com'],
});

// Internal webhook (worker-to-worker auth only)
app.post('/internal/webhook',
  procedure({
    policy: { auth: 'worker' },
    input: {
      body: z.object({
        type: z.string(),
        data: z.object({}).passthrough(),
      }),
    },
    handler: async (ctx) => {
      return await ctx.services.purchase.processWebhook(ctx.input.body);
    },
  })
);

export default app;
```

### Custom Middleware Chain

```typescript
import {
  createStandardMiddlewareChain,
  applyMiddlewareChain
} from '@codex/worker-utils';

const app = new Hono<HonoEnv>();

// Apply standard middleware with observability
applyMiddlewareChain(app, '/api/*', {
  serviceName: 'my-api',
  enableObservability: true,
  rateLimitPreset: 'api',
});

// Apply stricter rate limiting to auth routes
applyMiddlewareChain(app, '/api/auth/*', {
  serviceName: 'my-api',
  rateLimitPreset: 'auth',
});

// Mount your routes
app.route('/api/content', contentRoutes);
```

---

## Integration Points

### Dependencies

| Package | Why Used | Key Exports |
|---------|----------|-------------|
| **@codex/security** | Auth middleware, rate limiting, security headers | requireAuth, securityHeaders, rateLimit, workerAuth, RATE_LIMIT_PRESETS |
| **@codex/database** | User/session lookups, organization checks | dbHttp, schema, query helpers |
| **@codex/shared-types** | Type definitions | HonoEnv, AuthenticatedContext, EnrichedAuthContext |
| **@codex/service-errors** | Error mapping | mapErrorToResponse |
| **@codex/observability** | Request tracking, logging | ObservabilityClient, createRequestTimer |
| **hono** | Web framework | Hono, Context, MiddlewareHandler, cors, logger |
| **zod** | Input validation | z.object, z.string, z.enum, etc. |

### Dependents

This package is imported by:

- **workers/auth** - Authentication service
- **workers/content-api** - Content management
- **workers/identity-api** - User identity management
- **workers/ecom-api** - E-commerce webhooks
- **All integration tests** - createTestUser, createAuthenticatedRequest

### Data Flow

```
Request
  |
createWorker() - Factory creates Hono<HonoEnv>
  |-> Request Tracking Middleware [requestId, clientIP, userAgent]
  |-> Logging Middleware [request/response logs]
  |-> CORS Middleware [origin validation, CORS headers]
  |-> Security Headers Middleware [CSP, X-Frame-Options, etc.]
  |-> Route Matching:
  |   |-> GET /health [createHealthCheckHandler - no auth]
  |   |-> /internal/* [HMAC auth via workerAuth]
  |   |-> /api/* [Session auth via requireAuth]
  |-> Your Routes:
        |-> procedure() [policy + validation + services + error handling]
        |-> Handler:
              |-> ctx.services (lazy-loaded)
              |-> Service Layer [@codex/content, @codex/identity, etc.]
              |-> Database Layer [@codex/database]
              |-> Error Mapping [@codex/service-errors]
  |
Response
  |-> Standard format: { data: T } or { error: {...} }
  |-> HTTP status from handler (200, 201, 204, 4xx, 5xx)
  |-> Standard headers from middleware
```

---

## Error Handling

### Error Response Format

All errors follow standardized structure:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": { /* additional context */ },
    "stack": [ /* stack trace in development */ ]
  }
}
```

### Common Scenarios

| Scenario | Handler | Status | Code |
|----------|---------|--------|------|
| Malformed JSON | procedure | 400 | INVALID_JSON |
| Validation failed | procedure | 400 | VALIDATION_ERROR |
| IP not whitelisted | procedure | 403 | FORBIDDEN |
| Missing authentication | procedure | 401 | UNAUTHORIZED |
| Insufficient permissions | procedure | 403 | FORBIDDEN |
| Service: Resource not found | mapErrorToResponse | 404 | NOT_FOUND |
| Service: Business logic error | mapErrorToResponse | 422 | BUSINESS_LOGIC_ERROR |
| Service: Conflict | mapErrorToResponse | 409 | CONFLICT |
| Service: Unexpected error | mapErrorToResponse | 500 | INTERNAL_ERROR |
| Route not found | createNotFoundHandler | 404 | NOT_FOUND |
| Unhandled exception | createErrorHandler | 500 | INTERNAL_ERROR |

### Automatic Error Mapping

Service layer errors from @codex/service-errors are automatically mapped to HTTP responses:

```typescript
// In procedure() - automatic error handling
try {
  const result = await handler(ctx);
  return c.json({ data: result }, successStatus);
} catch (error) {
  const { statusCode, response } = mapErrorToResponse(error, { obs });
  return c.json(response, statusCode);
}
```

Mapping rules:

- NotFoundError -> 404
- ValidationError -> 400
- ForbiddenError -> 403
- ConflictError -> 409
- BusinessLogicError -> 422
- InternalServiceError -> 500

---

## Performance Notes

### Middleware Overhead

- **Request Tracking**: ~0.1ms (UUID generation, header extraction)
- **CORS**: ~0.5ms (regex pattern matching)
- **Security Headers**: <0.1ms (header injection)
- **Logging**: <1ms (I/O dependent)
- **Total middleware**: Typically <2ms for full chain

### Optimization Tips

1. **Early failure**: procedure() policy enforcement runs before handler, fails fast on auth/IP violations
2. **Body parsing**: Only when schema requires it (auto-detected from input.body presence)
3. **Lazy services**: Services are only instantiated when first accessed via ctx.services
4. **Automatic cleanup**: Service cleanup registered via c.executionCtx.waitUntil()

### Rate Limiting

- KV-backed distributed rate limiting (@codex/security)
- Presets optimized for common scenarios
- Burst allowances built in for legitimate traffic spikes

---

## Testing

### Integration Test Pattern

```typescript
import { createTestUser, cleanupTestUser, createAuthenticatedRequest } from '@codex/worker-utils';

describe('Content API', () => {
  let testUser;
  let app;

  beforeAll(() => {
    app = createWorker({ serviceName: 'content-api' });
  });

  beforeAll(async () => {
    testUser = await createTestUser();
  });

  afterAll(async () => {
    await cleanupTestUser(testUser.user.id);
  });

  it('should create content with authentication', async () => {
    const req = createAuthenticatedRequest(
      'http://localhost/api/content',
      testUser.sessionToken,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Test Article',
          slug: 'test-article',
          contentType: 'document',
        }),
      }
    );

    const res = await app.fetch(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.data.title).toBe('Test Article');
  });

  it('should reject unauthenticated requests', async () => {
    const req = new Request('http://localhost/api/content', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Test' }),
    });

    const res = await app.fetch(req);
    expect(res.status).toBe(401);
  });

  it('should return 404 for missing routes', async () => {
    const req = createAuthenticatedRequest(
      'http://localhost/api/nonexistent',
      testUser.sessionToken
    );

    const res = await app.fetch(req);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error.code).toBe('NOT_FOUND');
  });
});
```

### Unit Test Pattern

```typescript
describe('procedure', () => {
  it('should validate schema before calling handler', async () => {
    const app = new Hono();

    app.post('/test',
      procedure({
        policy: { auth: 'none' },
        input: {
          body: z.object({ email: z.string().email() }),
        },
        handler: async (ctx) => {
          throw new Error('Should not reach here');
        },
      })
    );

    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invalid' }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });
});
```

---

## Deployment

### Environment Variables

All workers using @codex/worker-utils require:

```bash
ENVIRONMENT=production|staging|development
WEB_APP_URL=https://app.example.com
API_URL=https://api.example.com
WORKER_SHARED_SECRET=<random-secret-for-hmac>  # if using internal routes
DATABASE_URL=<database-connection-string>
```

### Cloudflare Bindings (wrangler.toml)

```toml
[env.production]
vars = { ENVIRONMENT = "production" }

[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "production-rate-limit-id"

[[kv_namespaces]]
binding = "SESSIONS_KV"
id = "production-sessions-id"

[[r2_buckets]]
binding = "MEDIA_BUCKET"
bucket_name = "production-media"

[[d1_databases]]
binding = "DB"
database_name = "production-db"
```

### Health Check Verification

```bash
# Public health endpoint (no auth required)
curl https://api.example.com/health

# Response:
{
  "status": "healthy",
  "service": "content-api",
  "version": "1.0.0",
  "timestamp": 1705329000000,
  "checks": {
    "database": { "status": "ok" },
    "kv": { "status": "ok" },
    "r2": { "status": "ok" }
  }
}
```

---

## Critical Design Decisions

### 1. procedure() Pattern

The procedure() function replaces the old withPolicy() + createAuthenticatedHandler() pattern. Key benefits:

- Single function combines all concerns
- Type-safe context based on policy (user is guaranteed when auth: 'required')
- Lazy-loaded services avoid instantiating unused dependencies
- Automatic cleanup via waitUntil()

```typescript
// OLD (deprecated):
app.post('/api/content',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    schema: { body: createContentSchema },
    handler: async (c, ctx) => {
      return await contentService.create(ctx.validated.body, ctx.user.id);
    },
  })
);

// NEW:
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

Key differences:
- `policy: { auth: 'required' }` replaces `withPolicy(POLICY_PRESETS.authenticated())`
- `policy: { auth: 'none' }` replaces `withPolicy(POLICY_PRESETS.public())`
- `policy: { auth: 'required', roles: ['creator'] }` replaces `withPolicy(POLICY_PRESETS.creator())`
- `input:` replaces `schema:`
- `ctx.input` replaces `ctx.validated`
- Handler gets just `(ctx)` not `(c, ctx)`
- Services accessed via `ctx.services.content`, `ctx.services.media`, etc.

### 2. Auto Body Parsing Detection

procedure() automatically detects whether to parse JSON body based on presence of `body` in input schema. This reduces boilerplate and prevents accidental body parsing for GET requests.

```typescript
// No body parsing (GET, HEAD, DELETE without body)
input: { params: z.object({...}) }

// Body parsing (POST, PATCH, PUT)
input: { body: z.object({...}) }
```

### 3. Middleware Execution Order

Middleware order is carefully optimized:

1. Request tracking first (generates requestId for logging)
2. Logging second (uses requestId)
3. CORS before security headers (header order matters)
4. Health check and internal routes are excluded from auth

### 4. Secure by Default

- Default policy requires auth (`{ auth: 'required' }`)
- Public routes explicitly marked with `policy: { auth: 'none' }`
- HMAC auth for internal routes prevents accidental exposure

### 5. Organization Subdomain Mapping

requireOrgMembership: true extracts organization from subdomain:

- `acme.revelations.studio` -> organization slug "acme"
- Prevents clashes with infrastructure subdomains (api, auth, etc.)
- Falls back gracefully for localhost development

---

## Troubleshooting

### "User not authenticated" on public routes

**Problem**: Public route returning 401 when it shouldn't need auth.

**Solution**: Set policy.auth to 'none':

```typescript
app.get('/api/featured',
  procedure({
    policy: { auth: 'none' },
    handler: async (ctx) => {...},
  })
);
```

### "Cannot read property 'id' of undefined" on ctx.user

**Problem**: User object is undefined in handler.

**Solution**: Ensure policy requires auth:

```typescript
// This fails - no auth check (user can be undefined)
procedure({
  policy: { auth: 'optional' },
  handler: async (ctx) => {
    // ctx.user may be undefined!
  },
});

// This works - auth required (user is guaranteed)
procedure({
  policy: { auth: 'required' },
  handler: async (ctx) => {
    // ctx.user is guaranteed to exist
  },
});
```

### Validation errors not showing field details

**Problem**: Error response doesn't list which field failed.

**Solution**: Ensure schema uses Zod with custom messages:

```typescript
input: {
  body: z.object({
    title: z.string().min(1, 'Title required'),
    email: z.string().email('Invalid email'),
  })
}

// Response on error:
{
  "error": {
    "code": "VALIDATION_ERROR",
    "details": [
      { "path": "body.title", "message": "Title required" },
      { "path": "body.email", "message": "Invalid email" }
    ]
  }
}
```

### CORS errors in development

**Problem**: "Access denied by CORS policy" in browser.

**Solution**: createCorsMiddleware() supports localhost ports:

```
Supported: localhost:3000, 5173, 8787-8789, 4001-4002
Supported patterns: *-preview-*.revelations.studio, *-staging.revelations.studio
```

Custom CORS:

```typescript
const app = createWorker({
  cors: {
    allowedOrigins: ['http://localhost:3000'],
    allowCredentials: true,
  }
});
```

### Organization membership check always fails

**Problem**: requireOrgMembership: true returning 403 for valid members.

**Solution**: Verify organization lookup from subdomain works:

```bash
# Hostname must be organization-slug.revelations.studio
# Not: api.revelations.studio (infrastructure subdomain)
# Not: localhost:3000 (local development)
```

Local testing requires either:
- Custom CORS + direct organizationId in context
- Or disable requireOrgMembership for local tests

---

**Last Updated**: 2025-12-30
**Version**: 2.0.0
**Maintained by**: Codex Documentation Team
