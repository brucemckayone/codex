# Architecture Changelog

This document tracks major architectural changes and migrations across work packets.

---

## November 2025: Route-Level Security Policies

**Date**: 2025-11-15
**Status**: ✅ Implemented
**Affected Work Packets**: P1-CONTENT-001, P1-ACCESS-001, and all future API implementations

### Summary

Migrated from global authentication middleware to route-level declarative security policies using `withPolicy()` and `POLICY_PRESETS`.

### What Changed

#### Before (Global Auth Middleware)
```typescript
// workers/content-api/src/index.ts
import { createWorker } from '@codex/worker-utils';

const app = createWorker({
  serviceName: 'content-api',
  enableGlobalAuth: true, // Default
});

// Global rate limiting
app.use('/api/*', (c, next) => {
  return rateLimit({
    kv: c.env.RATE_LIMIT_KV,
    ...RATE_LIMIT_PRESETS.api,
  })(c, next);
});

// Routes
app.route('/api/content', contentRoutes);
```

```typescript
// workers/content-api/src/routes/content.ts
const app = new Hono<HonoEnv>();

// No policy - relies on global auth
app.post('/', createAuthenticatedHandler({
  schema: { body: createContentSchema },
  handler: async (c, ctx) => {
    // Handler logic
  },
}));
```

#### After (Route-Level Policies)
```typescript
// workers/content-api/src/index.ts
import { createWorker } from '@codex/worker-utils';

const app = createWorker({
  serviceName: 'content-api',
  enableGlobalAuth: false, // Using route-level policies
});

// No global rate limiting - handled per-route
app.route('/api/content', contentRoutes);
```

```typescript
// workers/content-api/src/routes/content.ts
import {
  withPolicy,
  POLICY_PRESETS,
  createAuthenticatedHandler,
} from '@codex/worker-utils';

const app = new Hono<HonoEnv>();

/**
 * POST /api/content
 * Security: Creator/Admin only, API rate limit (100 req/min)
 */
app.post(
  '/',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    schema: { body: createContentSchema },
    handler: async (c, ctx) => {
      // Handler logic
    },
  })
);

/**
 * DELETE /api/content/:id
 * Security: Creator/Admin only, Strict rate limit (5 req/15min)
 */
app.delete(
  '/:id',
  withPolicy({
    auth: 'required',
    roles: ['creator', 'admin'],
    rateLimit: 'auth', // Stricter rate limit
  }),
  createAuthenticatedHandler({
    // Handler logic
  })
);
```

### Why This Change?

**Problems with Global Auth:**
1. **Lack of Granularity**: All `/api/*` routes had the same rate limit (100 req/min)
2. **Hidden Security**: Authentication requirements not visible in route definitions
3. **Inflexible**: Hard to apply stricter limits to dangerous operations (DELETE, etc.)
4. **Documentation Gap**: Security policies scattered between worker setup and routes

**Benefits of Route-Level Policies:**
1. **Declarative Security**: Each route explicitly declares auth, roles, and rate limits
2. **Self-Documenting**: Security requirements visible at route definition
3. **Granular Control**: Different rate limits per operation type
4. **Easier Testing**: Can test policy enforcement per-route
5. **Better DX**: Clear what security applies to each endpoint

### Migration Guide

For any work packet that includes API endpoints:

1. **Update Worker Configuration**:
   ```typescript
   const app = createWorker({
     serviceName: 'your-worker',
     enableGlobalAuth: false, // Disable global auth
   });

   // Remove global rate limiting middleware
   ```

2. **Add Policies to Routes**:
   ```typescript
   import { withPolicy, POLICY_PRESETS } from '@codex/worker-utils';

   // For read operations
   app.get('/:id',
     withPolicy(POLICY_PRESETS.authenticated()),
     createAuthenticatedGetHandler({ /* ... */ })
   );

   // For create/update operations (creator/admin only)
   app.post('/',
     withPolicy(POLICY_PRESETS.creator()),
     createAuthenticatedHandler({ /* ... */ })
   );

   // For destructive operations (stricter rate limit)
   app.delete('/:id',
     withPolicy({
       auth: 'required',
       roles: ['creator', 'admin'],
       rateLimit: 'auth', // 5 req/15min instead of 100 req/min
     }),
     createAuthenticatedHandler({ /* ... */ })
   );
   ```

3. **Update Documentation**:
   - Add security comment above each route handler
   - Document the rate limit and required roles

### Available Policy Presets

See `packages/worker-utils/src/security-policy.ts` for complete definitions:

```typescript
POLICY_PRESETS.authenticated() // Any authenticated user, 100 req/min
POLICY_PRESETS.creator()       // Creator/Admin only, 100 req/min
POLICY_PRESETS.admin()         // Admin only, 100 req/min
POLICY_PRESETS.webhook()       // Webhook auth (HMAC), 1000 req/min
```

### Rate Limit Tiers

```typescript
'api'    // 100 requests per minute
'auth'   // 5 requests per 15 minutes (strict)
'webhook' // 1000 requests per minute
'web'    // 300 requests per minute
```

### Affected Files

**Implemented**:
- ✅ `packages/worker-utils/src/worker-factory.ts` - Added `enableGlobalAuth` option
- ✅ `workers/content-api/src/index.ts` - Disabled global auth
- ✅ `workers/content-api/src/routes/content.ts` - Applied policies to 7 endpoints
- ✅ `workers/content-api/src/routes/media.ts` - Applied policies to 5 endpoints
- ✅ `workers/identity-api/src/index.ts` - Disabled global auth
- ✅ `workers/identity-api/src/routes/organizations.ts` - Applied policies to 7 endpoints

**Work Packets Updated**:
- ✅ P1-CONTENT-001 - Updated with complete route-level policy examples
- ✅ P1-ACCESS-001 - Added implementation note to use route-level policies
- 🚧 P1-ADMIN-001 - TBD (review for auth patterns)
- 🚧 P1-ECOM-001 - TBD (review for auth patterns)
- 🚧 P1-SETTINGS-001 - TBD (review for auth patterns)

### Testing

All tests passing after migration:
- ✅ content-api: 8/8 tests
- ✅ identity-api: 6/6 tests
- ✅ auth: 17/17 tests
- ✅ worker-utils: 87/87 tests (1 todo)

### References

- Implementation: `packages/worker-utils/src/security-policy.ts`
- Documentation: `packages/worker-utils/SECURITY_POLICY_USAGE.md`
- Route Helpers: `packages/worker-utils/src/route-helpers.ts`
- Worker Factory: `packages/worker-utils/src/worker-factory.ts`

---

## Future Architectural Changes

Document any future major architectural shifts here.
