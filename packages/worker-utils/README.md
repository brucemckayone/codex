# @codex/worker-utils

Standardized utilities and middleware for Cloudflare Workers using the Hono framework.

## Overview

This package provides battle-tested middleware, route helpers, and worker factory functions to build secure, observable, and maintainable Cloudflare Workers. It eliminates boilerplate and enforces security best practices across all workers.

## Features

### 🔒 Security First
- **Declarative Security Policies** - Route-level security with `withPolicy()`
- **Request Tracking** - UUID request IDs, IP tracking, user agent capture
- **Authentication Middleware** - Session-based auth with role-based access control
- **IP Whitelisting** - Network-level security for internal APIs
- **Security Headers** - CSP, XFO, HSTS, and more

### 🎯 Developer Experience
- **Worker Factory** - One-line worker creation with sensible defaults
- **Type-Safe Route Handlers** - Automatic validation and type inference
- **Enriched Context** - Request metadata available in all handlers
- **Error Handling** - Standardized error responses across workers

### 📊 Observability
- **Request Tracking** - Every request gets a unique ID
- **Structured Logging** - Consistent log format across workers
- **Error Tracking** - Automatic error capture and reporting

## Installation

```bash
pnpm add @codex/worker-utils
```

## Quick Start

### Basic Worker

```typescript
import { createWorker } from '@codex/worker-utils';

const app = createWorker({
  serviceName: 'my-api',
  version: '1.0.0',
  enableRequestTracking: true,
  enableLogging: true,
  enableCors: true,
  enableSecurityHeaders: true,
});

// Mount your routes
app.route('/api/content', contentRoutes);

export default app;
```

This gives you:
- ✅ Health check at `/health`
- ✅ Request tracking (UUID IDs, IP, user agent)
- ✅ CORS with environment-based origins
- ✅ Security headers (CSP, XFO, etc.)
- ✅ Authentication on `/api/*` routes
- ✅ Error handling (404, 500)

### Route Handlers

#### Standard Authenticated Route

```typescript
import { createAuthenticatedHandler } from '@codex/worker-utils';
import { z } from 'zod';

app.post(
  '/api/content',
  createAuthenticatedHandler({
    schema: {
      body: z.object({
        title: z.string().min(1),
        content: z.string(),
      }),
    },
    handler: async (_c, ctx) => {
      // ctx.user is guaranteed to exist
      // ctx.validated.body is type-safe
      return service.create(ctx.validated.body, ctx.user.id);
    },
    successStatus: 201,
  })
);
```

#### GET Route with Params

```typescript
import { createIdParamsSchema } from '@codex/validation';

app.get(
  '/api/content/:id',
  createAuthenticatedHandler({
    schema: {
      params: createIdParamsSchema(),
    },
    handler: async (_c, ctx) => {
      return service.get(ctx.validated.params.id, ctx.user.id);
    },
  })
);
```

#### Enriched Context (with Request Metadata)

```typescript
app.post(
  '/api/action',
  createAuthenticatedHandler({
    schema: {
      body: actionSchema,
    },
    useEnrichedContext: true,
    handler: async (_c, ctx) => {
      // ctx now includes:
      // - requestId: UUID v4
      // - clientIP: Client IP from Cloudflare
      // - userAgent: User agent string
      // - permissions: ['user', 'creator']
      // - organizationId?: string

      console.log(`Request ${ctx.requestId} from ${ctx.clientIP}`);
      return service.process(ctx.validated.body, ctx);
    },
  })
);
```

### Security Policies

#### Using Policy Presets

```typescript
import { withPolicy, POLICY_PRESETS } from '@codex/worker-utils';

// Creator-only endpoint
app.post(
  '/api/content',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    schema: { body: createContentSchema },
    handler: async (c, ctx) => {
      return service.create(ctx.validated.body, ctx.user.id);
    },
  })
);

// Public endpoint (no auth)
app.get(
  '/api/content/:slug',
  withPolicy(POLICY_PRESETS.public()),
  async (c) => {
    const { slug } = c.req.param();
    return c.json({ data: await service.getBySlug(slug) });
  }
);

// Admin-only endpoint
app.delete(
  '/api/content/:id',
  withPolicy(POLICY_PRESETS.admin()),
  createAuthenticatedHandler({
    schema: { params: createIdParamsSchema() },
    handler: async (_c, ctx) => {
      await service.delete(ctx.validated.params.id, ctx.user.id);
      return null;
    },
    successStatus: 204,
  })
);
```

#### Custom Policies

```typescript
// IP-restricted internal API
app.post(
  '/api/admin/config',
  withPolicy({
    auth: 'required',
    roles: ['admin'],
    allowedIPs: ['10.0.0.0/8', '192.168.1.100'],
    rateLimit: 'auth', // Strict: 5 req/15min
  }),
  createAuthenticatedHandler({
    schema: { body: configSchema },
    handler: async (_c, ctx) => {
      return service.updateConfig(ctx.validated.body);
    },
  })
);
```

### Available Policy Presets

```typescript
POLICY_PRESETS.public()       // No auth, web rate limit (300/min)
POLICY_PRESETS.authenticated() // Auth required, api rate limit (100/min)
POLICY_PRESETS.creator()       // Creator/admin only, api rate limit
POLICY_PRESETS.admin()         // Admin only, strict rate limit (5/15min)
POLICY_PRESETS.internal()      // Worker-to-worker auth, webhook rate limit
POLICY_PRESETS.sensitive()     // Auth required, strict rate limit
```

## API Reference

### `createWorker(config)`

Creates a fully configured Hono app with standard middleware.

**Config Options:**
```typescript
{
  serviceName: string;           // Required: Service identifier
  version?: string;              // Default: '1.0.0'
  enableRequestTracking?: boolean; // Default: true
  enableLogging?: boolean;       // Default: true
  enableCors?: boolean;          // Default: true
  enableSecurityHeaders?: boolean; // Default: true
  publicRoutes?: string[];       // Default: ['/health']
  internalRoutePrefix?: string;  // Default: '/internal'
  workerSharedSecret?: string;   // For worker-to-worker auth
  allowedWorkerOrigins?: string[]; // IP whitelist for internal routes
  cors?: CORSConfig;             // Custom CORS config
}
```

**Returns:** `Hono<HonoEnv>` - Configured Hono app

### `createAuthenticatedHandler(options)`

Creates a type-safe route handler with automatic validation and authentication.

**Options:**
```typescript
{
  schema: {
    params?: ZodSchema;
    query?: ZodSchema;
    body?: ZodSchema;
  };
  handler: (c: Context, ctx: ValidatedContext) => Promise<TOutput>;
  successStatus?: 200 | 201 | 204; // Default: 200
  useEnrichedContext?: boolean;    // Default: false
}
```

**Features:**
- Auto-detects body parsing (only if `body` schema provided)
- Type-safe `ctx.validated` with full inference
- Automatic auth check (returns 401 if not authenticated)
- Validation errors return 400 with details
- Enriched context includes requestId, clientIP, userAgent, permissions

### `withPolicy(policy)`

Declarative security policy middleware.

**Policy Options:**
```typescript
{
  auth?: 'none' | 'optional' | 'required' | 'worker';
  roles?: Array<'user' | 'creator' | 'admin' | 'system'>;
  requireOrgMembership?: boolean; // TODO: Not yet implemented
  rateLimit?: 'api' | 'auth' | 'webhook' | 'web';
  allowedOrigins?: string[];
  allowedIPs?: string[];
}
```

**Enforcement Order:**
1. IP whitelist check
2. Authentication check
3. Role-based access control
4. Organization membership (future)

### Middleware Functions

```typescript
// Request tracking (UUID IDs, IP, user agent)
createRequestTrackingMiddleware()

// Standard request logging
createLoggerMiddleware()

// CORS with environment-based origins
createCorsMiddleware()

// Security headers (CSP, XFO, HSTS, etc.)
createSecurityHeadersMiddleware()

// Session-based authentication
createAuthMiddleware()

// Health check handler
createHealthCheckHandler(serviceName, version)

// 404 handler
createNotFoundHandler()

// Error handler
createErrorHandler(environment)

// Observability client
createObservabilityMiddleware(serviceName)

// Middleware sequencing
sequence(...handlers)
```

## Testing

### Unit Testing Route Handlers

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createAuthenticatedHandler } from '@codex/worker-utils';

describe('My Route', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();

    // Mock authentication
    app.use('*', async (c, next) => {
      c.set('user', {
        id: 'user-1',
        email: 'test@example.com',
        role: 'creator',
        emailVerified: true,
        createdAt: new Date(),
      });
      await next();
    });
  });

  it('should create content', async () => {
    app.post(
      '/',
      createAuthenticatedHandler({
        schema: {
          body: z.object({ title: z.string() }),
        },
        handler: async (_c, ctx) => ({
          id: '123',
          title: ctx.validated.body.title,
        }),
        successStatus: 201,
      })
    );

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test' }),
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({
      data: { id: '123', title: 'Test' },
    });
  });
});
```

## Architecture Decisions

### Why Route-Level Policies?

Instead of global middleware, we use route-level policies for:
- **Granular Control** - Different routes have different requirements
- **Self-Documentation** - Security requirements are visible at route definition
- **Flexibility** - Easy to add stricter policies to sensitive endpoints

### Why Auto-Detect Body Parsing?

The handler auto-detects if body parsing is needed based on schema:
- **Performance** - Don't parse body for GET requests
- **Developer Experience** - No need to remember which handler to use
- **Type Safety** - TypeScript knows if body is available

### Why Enriched Context is Optional?

Request metadata (IP, user agent, etc.) has a small performance cost:
- **Default (false)** - Most routes don't need it
- **Opt-in (true)** - Enable for analytics, security, or logging needs

## Future Enhancements

### 🚧 Organization Scoping (Planned)

```typescript
app.post(
  '/api/organizations/:organizationId/content',
  withPolicy({
    auth: 'required',
    requireOrgMembership: true, // Will check user is member
  }),
  createAuthenticatedHandler({
    schema: { body: createContentSchema },
    handler: async (_c, ctx) => {
      // ctx.organizationId guaranteed to be valid
      // ctx.organizationRole available
      return service.create(ctx.validated.body, ctx);
    },
  })
);
```

See detailed implementation plan in:
- `packages/worker-utils/src/security-policy.ts` (line 262-313)
- `design/SECURITY_POLICY_USAGE.md`

## Related Documentation

- [Security Policy Usage Analysis](../../design/SECURITY_POLICY_USAGE.md)
- [Worker Factory Tests](./src/__tests__/worker-factory.test.ts)
- [Security Policy Tests](./src/__tests__/security-policy.test.ts)
- [Route Helpers Tests](./src/__tests__/route-helpers.test.ts)

## Related Packages

- `@codex/security` - Auth middleware, rate limiting, security headers
- `@codex/validation` - Zod schemas and validation helpers
- `@codex/shared-types` - TypeScript types for Hono environment
- `@codex/observability` - Logging and metrics client

## License

Proprietary - Internal use only
