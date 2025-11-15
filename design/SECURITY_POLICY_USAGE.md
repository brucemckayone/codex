# Security Policy Usage Analysis

## Overview

The `withPolicy()` middleware provides declarative security policies for routes. This document analyzes where and how it should be used across the application.

## Current State

### ✅ What's Working
- `withPolicy()` middleware is fully implemented with comprehensive tests (47 tests passing)
- Policy presets are available: `public`, `authenticated`, `creator`, `admin`, `internal`, `sensitive`
- Features implemented:
  - Authentication levels (none, optional, required, worker)
  - Role-based access control (RBAC)
  - IP whitelisting
  - Rate limiting presets

### ❌ What's Not Used
- `withPolicy()` is **NOT currently applied to any routes**
- Routes are using global middleware instead of route-level policies
- Organization membership checking is not implemented (placeholder exists)

## Recommended Usage

### Pattern 1: Content Creation (Creator-Only)

**Current:**
```typescript
app.post(
  '/',
  createAuthenticatedHandler({
    schema: { body: createContentSchema },
    handler: async (c, ctx) => {
      return service.create(ctx.validated.body, ctx.user.id);
    },
    successStatus: 201,
  })
);
```

**Recommended:**
```typescript
app.post(
  '/',
  withPolicy(POLICY_PRESETS.creator()),  // Enforces creator/admin role
  createAuthenticatedHandler({
    schema: { body: createContentSchema },
    handler: async (c, ctx) => {
      return service.create(ctx.validated.body, ctx.user.id);
    },
    successStatus: 201,
  })
);
```

### Pattern 2: Public Content Retrieval

**Current:**
```typescript
app.get('/:slug', async (c) => {
  const { slug } = c.req.param();
  const content = await service.getBySlug(slug);
  return c.json({ data: content });
});
```

**Recommended:**
```typescript
app.get(
  '/:slug',
  withPolicy(POLICY_PRESETS.public()),  // No auth, higher rate limit
  async (c) => {
    const { slug } = c.req.param();
    const content = await service.getBySlug(slug);
    return c.json({ data: content });
  }
);
```

### Pattern 3: Sensitive Operations

**Current:**
```typescript
app.delete(
  '/:id',
  createAuthenticatedGetHandler({
    schema: { params: createIdParamsSchema() },
    handler: async (_c, ctx) => {
      await service.delete(ctx.validated.params.id, ctx.user.id);
      return null;
    },
    successStatus: 204,
  })
);
```

**Recommended:**
```typescript
app.delete(
  '/:id',
  withPolicy({
    auth: 'required',
    roles: ['creator', 'admin'],  // Only creators/admins can delete
    rateLimit: 'auth',  // Stricter rate limit (5 req/15min)
  }),
  createAuthenticatedGetHandler({
    schema: { params: createIdParamsSchema() },
    handler: async (_c, ctx) => {
      await service.delete(ctx.validated.params.id, ctx.user.id);
      return null;
    },
    successStatus: 204,
  })
);
```

### Pattern 4: Internal Worker Routes

**Current:**
```typescript
app.post('/internal/webhook', async (c) => {
  // Process webhook
});
```

**Recommended:**
```typescript
app.post(
  '/internal/webhook',
  withPolicy(POLICY_PRESETS.internal()),  // Worker-to-worker auth
  async (c) => {
    // Process webhook
  }
);
```

### Pattern 5: IP-Restricted Routes

**For internal APIs or admin panels:**
```typescript
app.post(
  '/api/admin/system-config',
  withPolicy({
    auth: 'required',
    roles: ['admin'],
    allowedIPs: [
      '10.0.0.0/8',  // Internal network
      '192.168.1.100',  // Admin workstation
    ],
    rateLimit: 'auth',
  }),
  createAuthenticatedHandler({
    schema: { body: systemConfigSchema },
    handler: async (c, ctx) => {
      // Update system config
    },
  })
);
```

## Routes That Should Use `withPolicy`

### Content API Routes

| Route | Current | Recommended Policy |
|-------|---------|-------------------|
| `POST /api/content` | Global auth | `POLICY_PRESETS.creator()` |
| `GET /api/content/:id` | Global auth | `{ auth: 'optional' }` (public if published) |
| `PATCH /api/content/:id` | Global auth | `POLICY_PRESETS.creator()` |
| `DELETE /api/content/:id` | Global auth | `{ roles: ['creator', 'admin'], rateLimit: 'auth' }` |
| `POST /api/content/:id/publish` | Global auth | `POLICY_PRESETS.creator()` |
| `POST /api/media` | Global auth | `POLICY_PRESETS.creator()` |
| `DELETE /api/media/:id` | Global auth | `{ roles: ['creator', 'admin'], rateLimit: 'auth' }` |

### Identity API Routes

| Route | Current | Recommended Policy |
|-------|---------|-------------------|
| `POST /api/organizations` | Global auth | `POLICY_PRESETS.authenticated()` |
| `GET /api/organizations/:id` | Global auth | `{ auth: 'required', requireOrgMembership: true }` |
| `PATCH /api/organizations/:id` | Global auth | `{ auth: 'required', requireOrgMembership: true, roles: ['admin'] }` |
| `DELETE /api/organizations/:id` | Global auth | `{ auth: 'required', requireOrgMembership: true, roles: ['admin'], rateLimit: 'auth' }` |

### Stripe Webhook Handler

| Route | Current | Recommended Policy |
|-------|---------|-------------------|
| `POST /webhooks/stripe/*` | Signature verification | `{ allowedIPs: [...stripe_ips], rateLimit: 'webhook' }` |

## Implementation Roadmap

### Phase 1: Creator-Only Routes ✅ Ready
Apply `withPolicy(POLICY_PRESETS.creator())` to:
- Content creation endpoints
- Media upload endpoints
- Publishing endpoints

**Benefit:** Prevents regular users from creating content

### Phase 2: Public Routes ✅ Ready
Apply `withPolicy(POLICY_PRESETS.public())` to:
- Health check endpoints
- Public content retrieval
- Public profile pages

**Benefit:** Better rate limiting for public endpoints

### Phase 3: Sensitive Operations ✅ Ready
Apply stricter policies to:
- Delete operations
- Account changes
- Payment operations

**Benefit:** Reduced attack surface with stricter rate limits

### Phase 4: Organization Scoping 🚧 Needs Implementation
Implement `requireOrgMembership` check:
1. Extract organizationId from request
2. Query organization_members table
3. Cache results in KV (5min TTL)
4. Set in context for downstream handlers

**Benefit:** Multi-tenant data isolation

### Phase 5: IP Whitelisting ✅ Ready
Apply IP restrictions to:
- Admin endpoints
- Internal worker communication
- Partner integrations

**Benefit:** Network-level security

## Benefits of Using `withPolicy`

### 1. **Declarative Security**
- Security configuration is visible at route definition
- Easy to audit which routes have which protections
- Self-documenting code

### 2. **Granular Control**
- Different rate limits per route
- Role-based access at route level
- IP restrictions for sensitive endpoints

### 3. **DRY Principle**
- Reusable policy presets
- No need to repeat auth checks in handlers
- Consistent security across routes

### 4. **Better Testing**
- Policies are unit tested separately
- Route handlers can focus on business logic
- Easy to verify security requirements

## Migration Strategy

### Step 1: Add to New Routes
All new routes should use `withPolicy()` from the start.

### Step 2: Gradual Migration
Migrate existing routes incrementally:
1. Start with creator-only routes (low risk)
2. Then public routes (improves rate limiting)
3. Finally sensitive operations (critical)

### Step 3: Remove Global Middleware
Once all routes have policies, we can remove the blanket `/api/*` auth middleware and rely entirely on route-level policies.

## Example: Complete Route with Policy

```typescript
/**
 * Create new content
 *
 * Security:
 * - Requires creator or admin role
 * - Moderate rate limiting (100 req/min)
 * - Validates content schema
 */
app.post(
  '/',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    schema: {
      body: createContentSchema,
    },
    handler: async (c, ctx) => {
      const service = createContentService({
        db: dbHttp,
        environment: ctx.env.ENVIRONMENT || 'development',
      });

      return service.create(ctx.validated.body, ctx.user.id);
    },
    successStatus: 201,
  })
);
```

## Open Questions

1. **Should we enforce policies globally or per-route?**
   - Current: Global `/api/*` auth middleware
   - Proposed: Per-route policies
   - Decision: Per-route for granular control

2. **How to handle organization scoping?**
   - Option A: Middleware extracts from params
   - Option B: Handler extracts explicitly
   - Decision: Middleware for consistency (see TODO in security-policy.ts)

3. **IP whitelisting for Stripe webhooks?**
   - Need to maintain list of Stripe IPs
   - Alternative: Just rely on signature verification
   - Decision: TBD

## Next Steps

1. ✅ Document this analysis
2. ⏳ Implement organization membership checking
3. ⏳ Apply policies to content-api routes
4. ⏳ Apply policies to identity-api routes
5. ⏳ Update tests to verify policies
6. ⏳ Remove global auth middleware where policies are applied

## Related Files

- `packages/worker-utils/src/security-policy.ts` - Policy implementation
- `packages/worker-utils/src/__tests__/security-policy.test.ts` - Policy tests
- `workers/content-api/src/routes/content.ts` - Routes needing policies
- `workers/content-api/src/routes/media.ts` - Routes needing policies
- `workers/identity-api/src/routes/organizations.ts` - Routes needing policies
