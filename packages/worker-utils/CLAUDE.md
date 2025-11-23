# @codex/worker-utils

## Overview

Shared utilities and factory functions for Cloudflare Workers that eliminate boilerplate and ensure consistency across all API workers. Provides standardized middleware chains, route handlers, security policies, and health checks used by auth, content-api, identity-api, and stripe-webhook-handler workers.

**Primary purpose**: Reduce repetitive setup code across workers by providing composable, well-tested utilities for common patterns like request tracking, authentication, CORS, security headers, error handling, and health checks.

**Core responsibility**: Worker setup, middleware composition, and route-level security policy enforcement.

## Public API

All exports are organized by domain responsibility:

### Worker Factory
- **createWorker(config)** - Create fully configured Hono app with standard middleware
- **WorkerConfig** - Configuration interface for worker setup
- **CORSConfig** - CORS configuration options
- **HealthCheckOptions** - Health check configuration

### Middleware Factories
- **createAuthMiddleware()** - Session-based user authentication middleware
- **createCorsMiddleware()** - CORS middleware with smart origin matching
- **createSecurityHeadersMiddleware()** - Security headers (CSP, X-Frame-Options, etc.)
- **createRequestTrackingMiddleware()** - UUID generation, IP extraction, user agent tracking
- **createLoggerMiddleware()** - Request logging
- **createHealthCheckHandler(serviceName, version, options)** - Health check endpoint handler
- **createNotFoundHandler()** - Standard 404 error handler
- **createErrorHandler(environment)** - Global error handler with env-specific responses
- **createObservabilityMiddleware(serviceName)** - Request timing and error tracking
- **createObservabilityErrorHandler(serviceName, environment)** - Observability-aware error handler
- **sequence(...handlers)** - Chain multiple middleware handlers

### Health Check Utilities
- **standardDatabaseCheck(context)** - Reusable database connectivity check
- **createKvCheck(bindingNames)** - Create KV namespace health checks
- **createR2Check(bindingNames)** - Create R2 bucket health checks

### Middleware Chain Builders
- **createStandardMiddlewareChain(options)** - Create array of standard middleware
- **applyMiddlewareChain(app, path, options)** - Apply middleware to specific routes
- **createMiddlewareChainBuilder(baseOptions)** - Create reusable chain builder with base config

### Route Helpers
- **createAuthenticatedHandler(options)** - Unified authenticated request handler with auto body parsing
- **withErrorHandling(handler)** - Wrap handlers with error mapping
- **formatValidationError(zodError)** - Format Zod validation errors

### Security Policies
- **withPolicy(policy)** - Route-level security policy middleware
- **POLICY_PRESETS** - Pre-configured policies (public, authenticated, creator, admin, internal, sensitive)
- **DEFAULT_SECURITY_POLICY** - Secure-by-default policy settings

### Response Types
- **createErrorResponse(context, code, message, status)** - Standardized error response creator
- **ERROR_CODES** - Standard error code constants

### Test Utilities
- **createTestUser(email?)** - Create real test user and session in database
- **cleanupTestUser(userId)** - Remove test user and sessions
- **createAuthenticatedRequest(url, sessionToken, options)** - Create authenticated test request

### Shared Types
- **HealthCheckResponse** - Standard health check response format
- **ErrorResponse** - Standard error response structure
- **SuccessResponse<T>** - Standard success response wrapper

## Worker Factory: createWorker()

Creates a fully configured Hono application with production-ready middleware and routing.

### Function Signature

```typescript
function createWorker(config: WorkerConfig): Hono<HonoEnv>
```

### Configuration (WorkerConfig)

```typescript
interface WorkerConfig extends MiddlewareConfig {
  serviceName: string;           // Required: Service name for identification
  version?: string;              // Service version for health check (default: '1.0.0')
  environment?: 'development' | 'staging' | 'production';
  enableLogging?: boolean;       // Default: true
  enableCors?: boolean;          // Default: true
  enableSecurityHeaders?: boolean; // Default: true
  enableRequestTracking?: boolean; // Default: true
  enableGlobalAuth?: boolean;    // Default: true (auth on /api/* routes)
  publicRoutes?: string[];       // Routes bypassing auth (default: ['/health'])
  internalRoutePrefix?: string;  // Prefix for worker-to-worker routes (default: '/internal')
  workerSharedSecret?: string;   // HMAC secret for internal routes
  allowedWorkerOrigins?: string[]; // IP whitelist for internal routes
  cors?: CORSConfig;             // Custom CORS configuration
  healthCheck?: HealthCheckOptions; // Database, KV, R2 health checks
}
```

### Middleware Execution Order

createWorker applies middleware in this specific order:

1. **Request Tracking** - Generates requestId, extracts clientIP, captures userAgent
2. **Logging** - Request/response logging
3. **CORS** - Origin validation and CORS headers
4. **Security Headers** - CSP, X-Frame-Options, X-Content-Type-Options, etc.
5. **Health Check Route** - GET /health (always public, no auth required)
6. **Internal Routes Middleware** - HMAC authentication for /internal/* routes
7. **API Authentication** - Session-based auth for /api/* routes
8. **Error Handlers** - 404 and 500 handlers

### Basic Usage

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

### With Health Checks

```typescript
import {
  createWorker,
  standardDatabaseCheck,
  createKvCheck
} from '@codex/worker-utils';

const app = createWorker({
  serviceName: 'content-api',
  healthCheck: {
    checkDatabase: standardDatabaseCheck,
    checkKV: createKvCheck(['RATE_LIMIT_KV', 'SESSIONS_KV']),
  },
});
```

### With Internal Routes

```typescript
const app = createWorker({
  serviceName: 'stripe-webhook-handler',
  internalRoutePrefix: '/internal',
  workerSharedSecret: c.env.WORKER_SHARED_SECRET,
  allowedWorkerOrigins: ['https://auth.revelations.studio'],
});

// Mount internal routes (HMAC authenticated)
app.route('/internal/webhook', webhookRoutes);
```

### Custom CORS Configuration

```typescript
const app = createWorker({
  serviceName: 'api',
  cors: {
    allowedOrigins: ['https://partner.example.com'],
    allowCredentials: false,
    allowMethods: ['GET', 'POST'],
    maxAge: 3600,
  },
});
```

## Middleware Factories

All middleware factories return MiddlewareHandler compatible with Hono.

### createRequestTrackingMiddleware()

Automatically injects request metadata into context for all handlers.

```typescript
function createRequestTrackingMiddleware(): MiddlewareHandler<HonoEnv>
```

**Sets in context**:
- `requestId` - UUID v4 for correlation across logs
- `clientIP` - Client IP from CF-Connecting-IP, X-Real-IP, or X-Forwarded-For headers
- `userAgent` - User agent string from User-Agent header

**Also sets response header**: `X-Request-ID` for client-side correlation

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

### createCorsMiddleware()

Standard CORS middleware with smart origin matching supporting multiple deployment patterns.

```typescript
function createCorsMiddleware(): MiddlewareHandler<HonoEnv>
```

**Supported origins** (in order of matching):
1. Exact matches: WEB_APP_URL, API_URL from environment
2. Localhost: localhost:3000, localhost:5173, localhost:8787-8789, localhost:4001-4002
3. Pattern-based:
   - Preview deployments: `*-preview-{PR}.revelations.studio`
   - Staging deployments: `*-staging.revelations.studio`
   - Production: `*.revelations.studio`

**Default response headers**:
- `Access-Control-Allow-Methods`: GET, POST, PUT, PATCH, DELETE, OPTIONS
- `Access-Control-Allow-Headers`: Content-Type, Authorization, Cookie
- `Access-Control-Expose-Headers`: Content-Length, X-Request-Id
- `Access-Control-Allow-Credentials`: true
- `Access-Control-Max-Age`: 86400 (24 hours)

**When to use**: Applied automatically by createWorker().

### createSecurityHeadersMiddleware()

Applies production-grade security headers based on environment.

```typescript
function createSecurityHeadersMiddleware(): MiddlewareHandler<HonoEnv>
```

**Headers applied** (environment-specific):
- Content-Security-Policy with inline script restrictions
- X-Frame-Options: DENY or SAMEORIGIN
- X-Content-Type-Options: nosniff
- Referrer-Policy: strict-no-referrer
- X-XSS-Protection: 1; mode=block

**When to use**: Applied automatically by createWorker().

### createAuthMiddleware()

Enforces session-based authentication using cookies.

```typescript
function createAuthMiddleware(): MiddlewareHandler<HonoEnv>
```

**Behavior**:
- Looks for `codex-session` cookie
- Validates session against database
- Sets `user` and `session` in context if valid
- Returns 401 if authentication fails

**When to use**: Applied automatically by createWorker() to /api/* routes. Override with route-level withPolicy(auth: 'none').

**Example** (accessing authenticated user):

```typescript
app.get('/api/content/:id', (c) => {
  const user = c.get('user');     // AuthenticatedContext['user']
  const session = c.get('session'); // AuthenticatedContext['session']
  return c.json({ userId: user.id });
});
```

### createHealthCheckHandler()

Creates handler for /health endpoint with optional dependency checks.

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
  "status": "healthy|unhealthy",
  "service": "content-api",
  "version": "1.0.0",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "checks": {
    "database": { "status": "ok" },
    "kv": { "status": "ok", "details": { ... } }
  }
}
```

**HTTP Status**:
- 200 OK if healthy
- 503 Service Unavailable if unhealthy

**When to use**: Applied automatically by createWorker() to GET /health (no authentication).

### createKvCheck() and createR2Check()

Create reusable health check functions for KV and R2.

```typescript
function createKvCheck(bindingNames: string[]): (c: Context<HonoEnv>) => Promise<{
  status: 'ok' | 'error';
  message: string;
  details?: {name, status, message}[];
}>

function createR2Check(bindingNames: string[]): (c: Context<HonoEnv>) => Promise<{
  status: 'ok' | 'error';
  message: string;
  details?: {name, status, message}[];
}>
```

**Example**:

```typescript
const app = createWorker({
  serviceName: 'content-api',
  healthCheck: {
    checkKV: createKvCheck(['RATE_LIMIT_KV', 'SESSIONS_KV']),
    checkR2: createR2Check(['MEDIA_BUCKET']),
  },
});
```

### createErrorResponse()

Create standardized error response objects.

```typescript
function createErrorResponse(
  c: Context,
  code: string,
  message: string,
  status: number
): Response
```

**Response structure**:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed"
  }
}
```

**Standard error codes** (ERROR_CODES constant):
- `INVALID_JSON` - Malformed request body
- `VALIDATION_ERROR` - Schema validation failed
- `NOT_FOUND` - Resource not found
- `UNAUTHORIZED` - Authentication required
- `FORBIDDEN` - Permission denied
- `INTERNAL_ERROR` - Unexpected server error
- `BAD_REQUEST` - Generic client error

**Example**:

```typescript
import { createErrorResponse, ERROR_CODES } from '@codex/worker-utils';

return createErrorResponse(
  c,
  ERROR_CODES.VALIDATION_ERROR,
  'Invalid email format',
  400
);
```

### createObservabilityMiddleware()

Enables observability tracking with request timing and error logging.

```typescript
function createObservabilityMiddleware<T extends HonoEnv = HonoEnv>(
  serviceName: string
): MiddlewareHandler<T>
```

**Sets in context**:
- `obs` - ObservabilityClient instance with logging methods

**Methods available on context.obs**:
- `info(message, metadata)` - Log info level
- `warn(message, metadata)` - Log warning
- `error(message, metadata)` - Log error
- `trackError(error, metadata)` - Track error with stack trace

**Automatic tracking**:
- Request duration in milliseconds
- Response status code
- Request path and method

**Example**:

```typescript
app.use('*', createObservabilityMiddleware('content-api'));

app.get('/api/content/:id', (c) => {
  const obs = c.get('obs');
  obs.info('Fetching content', { contentId: c.req.param('id') });
  return c.json({ ok: true });
});
```

### sequence()

Chain multiple middleware handlers in order.

```typescript
function sequence(
  ...handlers: ((c: Context, next: Next) => Promise<Response | undefined>)[]
): (c: Context, next: Next) => Promise<Response | undefined>
```

**Behavior**: Executes handlers one after another. If any handler returns a Response, subsequent handlers still execute but response is captured.

**When to use**: Compose multiple middleware into a single handler for complex middleware chains.

**Example**:

```typescript
app.use('/api/*',
  sequence(
    createSecurityHeadersMiddleware(),
    createRateLimitWrapper('api'),
    createAuthMiddleware()
  )
);
```

## Health Checks

### standardDatabaseCheck()

Reusable database connectivity check.

```typescript
async function standardDatabaseCheck(c: Context): Promise<{
  status: 'ok' | 'error';
  message?: string;
}>
```

**Returns**:
- Success: `{status: 'ok', message: 'Database connection is healthy.'}`
- Failure: `{status: 'error', message: 'Database connection failed.'}`

**When to use**: Pass to createWorker() healthCheck option, or use directly in custom health checks.

## Route Helpers

### createAuthenticatedHandler()

Unified handler for authenticated routes with automatic schema validation and body parsing.

```typescript
function createAuthenticatedHandler<TSchema extends RequestSchema>(options: {
  schema: TSchema;  // Object with params, query, body ZodSchemas
  handler: (c: Context, context: ValidatedContext) => Promise<unknown>;
  successStatus?: 200 | 201 | 204;
  useEnrichedContext?: boolean;
}): MiddlewareHandler
```

**Features**:
- Auto-detects body parsing based on schema presence
- Type-safe validated data from params, query, body
- Automatic 400 response on validation error
- Automatic 401 response if unauthenticated
- Supports enriched context with requestId, clientIP, userAgent
- Returns 204 No Content when successStatus is 204

**Context provided to handler**:
- `user` - Authenticated user from session
- `session` - Session data
- `env` - Cloudflare bindings
- `validated` - Validated params/query/body
- (If useEnrichedContext): `requestId`, `clientIP`, `userAgent`, `permissions`, `organizationId`

**GET example** (no body parsing):

```typescript
import { z } from 'zod';
import { createAuthenticatedHandler } from '@codex/worker-utils';

const uuidSchema = z.string().uuid();

app.get('/api/content/:id', createAuthenticatedHandler({
  schema: {
    params: z.object({ id: uuidSchema }),
  },
  handler: async (c, ctx) => {
    const contentId = ctx.validated.params.id;
    const userId = ctx.user.id;
    return await contentService.getById(contentId, userId);
  },
}));
```

**POST example** (with body parsing):

```typescript
const createContentSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  contentType: z.enum(['video', 'audio', 'document']),
});

app.post('/api/content', createAuthenticatedHandler({
  schema: {
    body: createContentSchema,
  },
  successStatus: 201,
  handler: async (c, ctx) => {
    return await contentService.create(ctx.validated.body, ctx.user.id);
  },
}));
```

**PATCH example** (with params and body):

```typescript
app.patch('/api/content/:id', createAuthenticatedHandler({
  schema: {
    params: z.object({ id: uuidSchema }),
    body: z.object({ title: z.string().optional() }),
  },
  handler: async (c, ctx) => {
    return await contentService.update(
      ctx.validated.params.id,
      ctx.validated.body,
      ctx.user.id
    );
  },
}));
```

**With enriched context**:

```typescript
app.post('/api/content', createAuthenticatedHandler({
  schema: { body: createContentSchema },
  useEnrichedContext: true,
  handler: async (c, ctx) => {
    console.log(`Request ${ctx.requestId} from ${ctx.clientIP}`);
    console.log(`User permissions: ${ctx.permissions.join(', ')}`);
    return await contentService.create(ctx.validated.body, ctx.user.id);
  },
}));
```

**Error handling** (automatic):
- Invalid JSON → 400 with INVALID_JSON code
- Validation error → 400 with VALIDATION_ERROR + field errors
- Service errors → Mapped using @codex/service-errors mapErrorToResponse()
- Unauthenticated → 401 with UNAUTHORIZED code

### withErrorHandling()

Wrap handler functions with automatic error mapping.

```typescript
function withErrorHandling<T>(
  handler: (c: Context) => Promise<T>
): (c: Context) => Promise<Response>
```

**When to use**: For simple handlers that don't need full schema validation. Automatically maps service errors to HTTP responses.

**Example**:

```typescript
app.get('/api/simple', withErrorHandling(async (c) => {
  const data = await someService.fetch();
  return c.json({ data });
}));
```

## Security Policies

### withPolicy()

Route-level security policy middleware for declarative access control.

```typescript
function withPolicy(policy: Partial<RouteSecurityPolicy>): MiddlewareHandler<HonoEnv>
```

**When to use**: Apply to individual routes for role-based access, rate limiting, IP restrictions, and organization membership checks.

**Apply before handler**:

```typescript
app.post('/api/content',
  withPolicy({ auth: 'required', roles: ['creator'] }),
  createAuthenticatedHandler({ ... })
);
```

### RouteSecurityPolicy Configuration

```typescript
interface RouteSecurityPolicy {
  auth?: 'none' | 'optional' | 'required' | 'worker';
  roles?: Array<'user' | 'creator' | 'admin' | 'system'>;
  requireOrgMembership?: boolean;
  rateLimit?: keyof typeof RATE_LIMIT_PRESETS;
  allowedOrigins?: string[];
  allowedIPs?: string[];
}
```

**auth levels**:
- `'none'` - Public endpoint, no authentication required
- `'optional'` - Authentication attempted but not required (c.get('user') may be null)
- `'required'` - Must have authenticated user (default)
- `'worker'` - Worker-to-worker HMAC authentication

**roles** - User must have at least one role:
- `'user'` - Basic authenticated user
- `'creator'` - Content creator
- `'admin'` - Administrative access
- `'system'` - System-level operations

**rateLimit presets**:
- `'api'` - 100 req/min (default)
- `'strict'` - 20 req/min (sensitive operations)
- `'auth'` - 10 req/min (login/signup)
- `'public'` - 300 req/min (public content)
- `'webhook'` - 1000 req/min (webhooks)

**Example**: Public endpoint

```typescript
app.get('/api/public-content',
  withPolicy({ auth: 'none', rateLimit: 'public' }),
  createAuthenticatedHandler({ ... })
);
```

**Example**: Creator-only with strict rate limiting

```typescript
app.post('/api/content',
  withPolicy({
    auth: 'required',
    roles: ['creator', 'admin'],
    rateLimit: 'strict',
  }),
  createAuthenticatedHandler({ ... })
);
```

**Example**: Admin-only with IP whitelist

```typescript
app.delete('/api/users/:id',
  withPolicy({
    auth: 'required',
    roles: ['admin'],
    allowedIPs: ['10.0.0.0/8', '203.0.113.42'],
  }),
  createAuthenticatedHandler({ ... })
);
```

**Example**: Organization-scoped access

```typescript
app.patch('/api/org/settings',
  withPolicy({
    auth: 'required',
    requireOrgMembership: true,
  }),
  createAuthenticatedHandler({ ... })
);
```

### POLICY_PRESETS

Pre-configured policies for common scenarios.

```typescript
const POLICY_PRESETS = {
  public(): Partial<RouteSecurityPolicy>,
  authenticated(): Partial<RouteSecurityPolicy>,
  creator(): Partial<RouteSecurityPolicy>,
  admin(): Partial<RouteSecurityPolicy>,
  internal(): Partial<RouteSecurityPolicy>,
  sensitive(): Partial<RouteSecurityPolicy>,
};
```

**Usage**:

```typescript
import { POLICY_PRESETS, withPolicy } from '@codex/worker-utils';

// Public endpoint
app.get('/api/public', withPolicy(POLICY_PRESETS.public()));

// Creator-only
app.post('/api/content', withPolicy(POLICY_PRESETS.creator()));

// Admin-only
app.delete('/api/users/:id', withPolicy(POLICY_PRESETS.admin()));

// Internal worker-to-worker
app.post('/internal/sync', withPolicy(POLICY_PRESETS.internal()));

// Sensitive operation
app.post('/api/auth/login', withPolicy(POLICY_PRESETS.sensitive()));
```

## Middleware Chain Builders

### createStandardMiddlewareChain()

Create array of middleware with fine-grained control.

```typescript
function createStandardMiddlewareChain(options: {
  serviceName: string;
  skipLogging?: boolean;
  skipSecurityHeaders?: boolean;
  skipRequestTracking?: boolean;
  enableObservability?: boolean;
  customMiddleware?: MiddlewareHandler<HonoEnv>[];
}): MiddlewareHandler<HonoEnv>[]
```

**Order of execution**:
1. Request tracking (unless skipRequestTracking)
2. Logging (unless skipLogging)
3. Security headers (unless skipSecurityHeaders)
4. Observability (if enableObservability)
5. Custom middleware (in order provided)

**Example**: Standard chain with observability

```typescript
const middleware = createStandardMiddlewareChain({
  serviceName: 'my-api',
  enableObservability: true,
});

middleware.forEach(m => app.use('*', m));
```

**Example**: Skip certain middleware

```typescript
const middleware = createStandardMiddlewareChain({
  serviceName: 'my-api',
  skipLogging: true,
  skipSecurityHeaders: true,
  customMiddleware: [createCustomMiddleware()],
});
```

### applyMiddlewareChain()

Apply complete middleware chain to specific route pattern.

```typescript
function applyMiddlewareChain<T extends HonoEnv = HonoEnv>(
  app: Hono<T>,
  path: string,
  options: {
    serviceName: string;
    skipLogging?: boolean;
    skipSecurityHeaders?: boolean;
    skipRequestTracking?: boolean;
    enableObservability?: boolean;
    customMiddleware?: MiddlewareHandler<HonoEnv>[];
    rateLimitPreset?: keyof typeof RATE_LIMIT_PRESETS;
    rateLimitConfig?: object;
  }
): void
```

**When to use**: Apply complete middleware chain with optional rate limiting to specific routes.

**Example**: Apply to all routes

```typescript
const app = new Hono();
applyMiddlewareChain(app, '*', {
  serviceName: 'my-api',
  enableObservability: true,
});
```

**Example**: Apply to specific routes with rate limiting

```typescript
const app = new Hono();

applyMiddlewareChain(app, '/api/*', {
  serviceName: 'my-api',
  rateLimitPreset: 'api',
});

applyMiddlewareChain(app, '/webhooks/*', {
  serviceName: 'my-api',
  rateLimitPreset: 'webhook',
});
```

### createMiddlewareChainBuilder()

Create reusable builder with base configuration.

```typescript
function createMiddlewareChainBuilder(
  baseOptions: MiddlewareChainOptions
): <T extends HonoEnv = HonoEnv>(
  app: Hono<T>,
  path: string,
  additionalOptions?: Partial<ApplyMiddlewareChainOptions>
) => void
```

**When to use**: Apply same base configuration to multiple routes with different options.

**Example**:

```typescript
const app = new Hono();

const applyMiddleware = createMiddlewareChainBuilder({
  serviceName: 'my-api',
  enableObservability: true,
});

// Apply to different routes
applyMiddleware(app, '*', {});
applyMiddleware(app, '/api/*', { rateLimitPreset: 'api' });
applyMiddleware(app, '/webhooks/*', { rateLimitPreset: 'webhook' });
applyMiddleware(app, '/admin/*', {
  rateLimitPreset: 'strict',
  customMiddleware: [createAdminCheckMiddleware()],
});
```

## Test Utilities

### createTestUser()

Create real test user and session in test database for integration testing.

```typescript
async function createTestUser(email?: string): Promise<{
  user: UserData;
  session: SessionData;
  sessionToken: string;
}>
```

**What it does**:
1. Creates user record in database with random unique email
2. Creates valid session with 24-hour expiration
3. Returns session token for use in authenticated requests

**When to use**: Integration tests that need real authenticated sessions instead of mocks.

**Important security notes**:
- Only use in test files
- Creates real records in test database
- Always cleanup with cleanupTestUser() after tests
- Do not use in production code

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

  it('should create content', async () => {
    const req = new Request('http://localhost/api/content', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `codex-session=${testUser.sessionToken}`,
      },
      body: JSON.stringify({
        title: 'Test',
        slug: 'test',
        contentType: 'video',
      }),
    });

    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(201);
  });
});
```

### cleanupTestUser()

Remove test user and all associated sessions from database.

```typescript
async function cleanupTestUser(userId: string): Promise<void>
```

**Cleanup cascade**: Deleting user automatically removes all associated sessions.

**When to use**: In afterAll() or afterEach() to clean up test data.

### createAuthenticatedRequest()

Helper to create Request with authentication cookie.

```typescript
function createAuthenticatedRequest(
  url: string,
  sessionToken: string,
  options?: RequestInit
): Request
```

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
```

## Usage Examples

### Complete Worker Setup

```typescript
import { createWorker, POLICY_PRESETS, createAuthenticatedHandler } from '@codex/worker-utils';
import { z } from 'zod';

const app = createWorker({
  serviceName: 'content-api',
  version: '1.0.0',
  environment: 'production',
  enableGlobalAuth: true,
  healthCheck: {
    checkDatabase: standardDatabaseCheck,
    checkKV: createKvCheck(['RATE_LIMIT_KV']),
  },
});

// Public endpoint
app.get('/api/content/featured',
  withPolicy(POLICY_PRESETS.public()),
  createAuthenticatedHandler({
    schema: {},
    handler: async (c, ctx) => {
      return await contentService.getFeatured();
    },
  })
);

// Authenticated endpoint
app.get('/api/content/:id',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedHandler({
    schema: {
      params: z.object({ id: z.string().uuid() }),
    },
    handler: async (c, ctx) => {
      return await contentService.getById(ctx.validated.params.id, ctx.user.id);
    },
  })
);

// Creator-only endpoint
app.post('/api/content',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    schema: {
      body: z.object({
        title: z.string().min(1),
        slug: z.string().min(1),
        contentType: z.enum(['video', 'audio', 'document']),
      }),
    },
    successStatus: 201,
    handler: async (c, ctx) => {
      return await contentService.create(ctx.validated.body, ctx.user.id);
    },
  })
);

// Admin-only endpoint
app.delete('/api/content/:id',
  withPolicy(POLICY_PRESETS.admin()),
  createAuthenticatedHandler({
    schema: {
      params: z.object({ id: z.string().uuid() }),
    },
    handler: async (c, ctx) => {
      await contentService.delete(ctx.validated.params.id);
      return null;
    },
    successStatus: 204,
  })
);

export default app;
```

### With Enriched Context

```typescript
app.post('/api/content',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    schema: {
      body: createContentSchema,
    },
    useEnrichedContext: true,
    handler: async (c, ctx) => {
      // Access rich context metadata
      console.log(`Request ${ctx.requestId} from ${ctx.clientIP}`);
      console.log(`User permissions: ${ctx.permissions.join(', ')}`);

      // Log with request context
      const obs = c.get('obs');
      obs.info('Creating content', {
        contentId: contentId,
        userId: ctx.user.id,
        requestId: ctx.requestId,
      });

      return await contentService.create(ctx.validated.body, ctx.user.id);
    },
  })
);
```

### Organization-Scoped Access

```typescript
app.patch('/api/org/settings',
  withPolicy({
    auth: 'required',
    requireOrgMembership: true,
  }),
  createAuthenticatedHandler({
    schema: {
      body: z.object({
        name: z.string().optional(),
        slug: z.string().optional(),
      }),
    },
    handler: async (c, ctx) => {
      const organizationId = c.get('organizationId');
      return await organizationService.updateSettings(
        organizationId,
        ctx.validated.body
      );
    },
  })
);
```

### Internal Worker Routes

```typescript
import { createWorker, POLICY_PRESETS } from '@codex/worker-utils';

const app = createWorker({
  serviceName: 'stripe-webhook-handler',
  internalRoutePrefix: '/internal',
  workerSharedSecret: env.WORKER_SHARED_SECRET,
  allowedWorkerOrigins: ['https://stripe.com'],
});

// Public health check
app.get('/health', createHealthCheckHandler('stripe-webhook-handler', '1.0.0'));

// Internal webhook (worker-to-worker auth only)
app.post('/internal/webhook',
  withPolicy(POLICY_PRESETS.internal()),
  createAuthenticatedHandler({
    schema: {
      body: z.object({
        type: z.string(),
        data: z.object({}).passthrough(),
      }),
    },
    handler: async (c, ctx) => {
      return await webhookService.process(ctx.validated.body);
    },
  })
);

export default app;
```

## Integration Points

### Dependencies

| Package | Why Used | Key Exports Used |
|---------|----------|------------------|
| **@codex/security** | Authentication & authorization | requireAuth, securityHeaders, rateLimit, workerAuth |
| **@codex/database** | Database connectivity | testDbConnection, schema, dbHttp |
| **@codex/shared-types** | Type definitions | HonoEnv, AuthenticatedContext |
| **@codex/service-errors** | Error mapping | mapErrorToResponse |
| **@codex/observability** | Request tracking | ObservabilityClient, createRequestTimer |
| **hono** | Web framework | Hono, Context, MiddlewareHandler |
| **zod** | Input validation | z.object, z.string, etc. |

### Dependents

This package is imported by:
- **@codex/workers/auth** - Authentication service
- **@codex/workers/content-api** - Content management
- **@codex/workers/identity-api** - User identity management
- **@codex/workers/stripe-webhook-handler** - Webhook processing

### Data Flow

```
Request
  ↓
createWorker() [factory]
  ├─→ Request Tracking Middleware [requestId, clientIP, userAgent]
  ├─→ CORS Middleware [origin validation]
  ├─→ Security Headers Middleware [CSP, X-Frame-Options, etc.]
  ├─→ Health Check Route [GET /health - no auth]
  ├─→ Internal Route Auth [/internal/* - HMAC]
  ├─→ API Route Auth [/api/* - Session]
  └─→ Your Routes
        ├─→ withPolicy() [access control]
        ├─→ createAuthenticatedHandler() [validation, auth, error handling]
        └─→ Your Handler Logic
              └─→ @codex/service-errors [error mapping]
              └─→ @codex/database [data access]
  ↓
Response
```

## Middleware Chain Execution Order

When using createWorker(), middleware executes in this order:

1. **Request Tracking** (requestId, clientIP, userAgent)
2. **Logging** (request/response logs)
3. **CORS** (origin validation, CORS headers)
4. **Security Headers** (CSP, X-Frame-Options, etc.)
5. **Route Matching**:
   - GET /health → createHealthCheckHandler() (no auth)
   - /internal/* → workerAuth (HMAC) → your handler
   - /api/* → requireAuth (session) → your handler
   - Other routes → your handler (no auth by default)

Each middleware can:
- Modify context (set/get values)
- Modify request/response headers
- Terminate request early with Response
- Call next() to proceed to next middleware

## Error Handling

### Error Response Format

All errors follow this structure:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": { ... },
    "stack": [ ... ]
  }
}
```

### Common Error Scenarios

| Scenario | Handler | Status | Code |
|----------|---------|--------|------|
| Invalid JSON | createAuthenticatedHandler | 400 | INVALID_JSON |
| Validation failed | createAuthenticatedHandler | 400 | VALIDATION_ERROR |
| Missing authentication | withPolicy/auth required | 401 | UNAUTHORIZED |
| Insufficient permissions | withPolicy/roles | 403 | FORBIDDEN |
| IP not whitelisted | withPolicy/allowedIPs | 403 | FORBIDDEN |
| Resource not found | Service layer | 404 | NOT_FOUND |
| Unhandled error | createErrorHandler | 500 | INTERNAL_ERROR |

### Automatic Error Mapping

Service errors from @codex/service-errors are automatically mapped to HTTP responses via mapErrorToResponse():

```typescript
try {
  return await contentService.create(data, userId);
} catch (error) {
  // Automatically mapped by createAuthenticatedHandler
  const { statusCode, response } = mapErrorToResponse(error);
  return c.json(response, statusCode);
}
```

## Testing

### Integration Test Pattern

```typescript
import { createTestUser, cleanupTestUser } from '@codex/worker-utils';

describe('Content API', () => {
  let testUser: TestUser;
  let app: Hono;

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

### Unit Test Pattern for Handlers

```typescript
describe('createAuthenticatedHandler', () => {
  it('should validate schema before calling handler', async () => {
    const handler = createAuthenticatedHandler({
      schema: {
        body: z.object({ email: z.string().email() }),
      },
      handler: async (c, ctx) => {
        throw new Error('Should not reach here');
      },
    });

    const c = {
      req: {
        json: async () => ({ email: 'invalid' }),
        param: () => ({}),
        query: () => ({}),
      },
      get: (key) => {
        if (key === 'user') return { id: 'test' };
      },
      json: (data, status) => new Response(JSON.stringify(data), { status }),
    };

    const res = await handler(c);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe('VALIDATION_ERROR');
  });
});
```

### Testing Context Values

```typescript
it('should set request metadata in context', async () => {
  const middleware = createRequestTrackingMiddleware();

  let contextData = {};
  const mockContext = {
    req: {
      header: (key) => {
        if (key === 'User-Agent') return 'test-agent';
        return undefined;
      },
      path: '/test',
      method: 'GET',
    },
    set: (key, value) => {
      contextData[key] = value;
    },
    header: () => {},
  };

  await middleware(mockContext, async () => {});

  expect(contextData.requestId).toBeDefined();
  expect(contextData.clientIP).toBeDefined();
  expect(contextData.userAgent).toBe('test-agent');
});
```

## Performance Considerations

### Request Tracking Overhead
- UUID generation: < 1ms per request
- Header extraction: < 0.1ms per request
- Minimal impact on overall latency

### Middleware Chain Order
- Critical: Request tracking must run first (generates requestId)
- Recommended: CORS before security headers (header order matters)
- Auth checks should run as early as possible to fail fast

### Caching Opportunities
- Organization membership checks can be cached in KV
- Security policies are evaluated per-request (cannot cache)
- CORS patterns are regex-compiled once on worker startup

### Rate Limiting
- Presets optimized for common scenarios
- KV namespace provides distributed rate limit tracking
- Burst allowances built into presets for legitimate spikes

## Deployment

### Environment Variables Required

```
ENVIRONMENT=production|staging|development
WEB_APP_URL=https://app.example.com
API_URL=https://api.example.com
WORKER_SHARED_SECRET=<random-secret-for-hmac>
DATABASE_URL=<database-connection-string>
```

### Cloudflare Bindings Required

```wrangler.toml
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"

[[kv_namespaces]]
binding = "SESSIONS_KV"

[[r2_buckets]]
binding = "MEDIA_BUCKET"

[[d1_databases]]
binding = "DB"
```

### Health Check Verification

```bash
curl https://api.example.com/health
# Expected response:
# {
#   "status": "healthy",
#   "service": "content-api",
#   "version": "1.0.0",
#   "timestamp": "2024-01-15T10:30:00.000Z",
#   "checks": { ... }
# }
```
