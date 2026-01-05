# P1-SERVICE-MIDDLEWARE-CONSOLIDATION Implementation Plan

## Overview

**Objective**: Eliminate repetitive service initialization patterns across workers by creating service middleware that automatically injects services into Hono context.

**Current State**: The `@codex/worker-utils` package has established a service middleware pattern with `withContentService()`, `withMediaItemService()`, `withContentAccessService()`, and `withPerRequestDb()`. However, `ecom-api` and `admin-api` workers still have repetitive service initialization code in each route handler.

**Target State**: All workers use consistent service middleware patterns, eliminating boilerplate and ensuring automatic cleanup of database connections.

**Estimated Scope**:
- New middleware functions: 4
- Files to modify: ~6
- Tests to add/update: ~4

---

## Problem Statement

### Repetitive Pattern in ecom-api

The `ecom-api` worker has this pattern repeated in 3 handlers:

```typescript
// Repeated in checkout.ts, purchases.ts (2 handlers)
const stripe = createStripeClient(getStripeKey(ctx.env));
const purchaseService = new PurchaseService(
  {
    db: createDbClient(ctx.env),  // or dbHttp
    environment: ctx.env.ENVIRONMENT || 'development',
  },
  stripe
);
```

**Issues**:
1. Boilerplate repeated in every handler
2. Stripe client created per-request (should be shared)
3. No automatic cleanup pattern
4. Inconsistent db client usage (dbHttp vs createDbClient)

### Repetitive Pattern in admin-api

The `admin-api` worker has this pattern repeated in 9 handlers:

```typescript
// Analytics handlers (3 occurrences)
const service = new AdminAnalyticsService({
  db: createDbClient(c.env),
  environment: c.env.ENVIRONMENT || 'development',
});

// Content management handlers (3 occurrences)
const service = new AdminContentManagementService({
  db,  // from getPerRequestDb()
  environment: c.env.ENVIRONMENT || 'development',
});

// Customer management handlers (3 occurrences)
const service = new AdminCustomerManagementService({
  db: createDbClient(c.env),  // or perRequestDb
  environment: c.env.ENVIRONMENT || 'development',
});
```

**Issues**:
1. 9 instances of nearly identical service initialization
2. Inconsistent db client usage (HTTP vs WebSocket)
3. Environment fallback repeated everywhere

---

## Solution Architecture

### Existing Pattern (Reference)

The established pattern in `@codex/worker-utils/src/service-middleware.ts`:

```typescript
export function withContentService(): MiddlewareHandler<HonoEnv> {
  return createServiceMiddleware<ContentServiceType>({
    create: (env) => {
      const { db, cleanup } = createPerRequestDbClient(env);
      const service = new ContentService({
        db,
        environment: env.ENVIRONMENT || 'development',
      });
      return { service, cleanup };
    },
    contextKey: 'contentService',
  })();
}
```

**Key Features**:
1. Service instantiated once per request
2. Injected into Hono context via `c.set()`
3. Retrieved via `c.get('serviceName')`
4. Automatic cleanup via `c.executionCtx.waitUntil(cleanup())`
5. Type-safe via module augmentation on Variables interface

### New Middleware to Create

#### 1. `withPurchaseService()` for ecom-api

```typescript
// packages/worker-utils/src/service-middleware.ts (or new file)

import { createStripeClient, PurchaseService } from '@codex/purchase';
import type { PurchaseService as PurchaseServiceType } from '@codex/purchase';

declare module '@codex/shared-types' {
  interface Variables {
    purchaseService?: PurchaseServiceType;
  }
}

export function withPurchaseService(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    // Get Stripe key - throw if not configured
    const stripeKey = c.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      throw new InternalServiceError('STRIPE_SECRET_KEY not configured');
    }

    // Create Stripe client and service
    const stripe = createStripeClient(stripeKey);
    const service = new PurchaseService(
      {
        db: dbHttp,  // HTTP client - no cleanup needed
        environment: c.env.ENVIRONMENT || 'development',
      },
      stripe
    );

    c.set('purchaseService', service);
    await next();
  };
}
```

**Note**: Uses `dbHttp` (HTTP client) which doesn't require cleanup. If WebSocket/transaction support is needed, use `withPurchaseServiceWithDb()` variant.

#### 2. `withPurchaseServiceWithDb()` for webhook handlers

For webhook handlers that need transaction support:

```typescript
export function withPurchaseServiceWithDb(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const stripeKey = c.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      throw new InternalServiceError('STRIPE_SECRET_KEY not configured');
    }

    const { db, cleanup } = createPerRequestDbClient(c.env);
    const stripe = createStripeClient(stripeKey);
    const service = new PurchaseService(
      {
        db,
        environment: c.env.ENVIRONMENT || 'development',
      },
      stripe
    );

    try {
      c.set('purchaseService', service);
      c.set('perRequestDb', db);  // Also expose db for direct access
      await next();
    } finally {
      c.executionCtx.waitUntil(cleanup());
    }
  };
}
```

#### 3. `withAdminAnalyticsService()` for admin-api

```typescript
import { AdminAnalyticsService } from '@codex/admin';
import type { AdminAnalyticsService as AdminAnalyticsServiceType } from '@codex/admin';

declare module '@codex/shared-types' {
  interface Variables {
    adminAnalyticsService?: AdminAnalyticsServiceType;
  }
}

export function withAdminAnalyticsService(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const service = new AdminAnalyticsService({
      db: dbHttp,  // HTTP client for read-only analytics
      environment: c.env.ENVIRONMENT || 'development',
    });

    c.set('adminAnalyticsService', service);
    await next();
  };
}
```

#### 4. `withAdminContentManagementService()` for admin-api

This service needs transaction support (publish/unpublish/delete):

```typescript
import { AdminContentManagementService } from '@codex/admin';
import type { AdminContentManagementService as AdminContentManagementServiceType } from '@codex/admin';

declare module '@codex/shared-types' {
  interface Variables {
    adminContentManagementService?: AdminContentManagementServiceType;
  }
}

export function withAdminContentManagementService(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const { db, cleanup } = createPerRequestDbClient(c.env);
    const service = new AdminContentManagementService({
      db,
      environment: c.env.ENVIRONMENT || 'development',
    });

    try {
      c.set('adminContentManagementService', service);
      await next();
    } finally {
      c.executionCtx.waitUntil(cleanup());
    }
  };
}
```

#### 5. `withAdminCustomerManagementService()` for admin-api

```typescript
import { AdminCustomerManagementService } from '@codex/admin';
import type { AdminCustomerManagementService as AdminCustomerManagementServiceType } from '@codex/admin';

declare module '@codex/shared-types' {
  interface Variables {
    adminCustomerManagementService?: AdminCustomerManagementServiceType;
  }
}

export function withAdminCustomerManagementService(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const { db, cleanup } = createPerRequestDbClient(c.env);
    const service = new AdminCustomerManagementService({
      db,
      environment: c.env.ENVIRONMENT || 'development',
    });

    try {
      c.set('adminCustomerManagementService', service);
      await next();
    } finally {
      c.executionCtx.waitUntil(cleanup());
    }
  };
}
```

---

## Implementation Plan

### Phase 1: Create ecom-api Service Middleware

**Task 1.1: Create withPurchaseService() middleware**

File: `packages/worker-utils/src/service-middleware.ts`

Steps:
1. Add import for `@codex/purchase` types
2. Add module augmentation for `purchaseService` in Variables
3. Implement `withPurchaseService()` function
4. Export from `packages/worker-utils/src/index.ts`

**Task 1.2: Add @codex/purchase dependency to worker-utils**

File: `packages/worker-utils/package.json`

Add:
```json
"dependencies": {
  "@codex/purchase": "workspace:*"
}
```

Run: `pnpm install`

**Task 1.3: Refactor ecom-api routes to use middleware**

File: `workers/ecom-api/src/routes/checkout.ts`

Before:
```typescript
checkout.post('/create',
  withPolicy({ auth: 'required', rateLimit: 'auth' }),
  createAuthenticatedHandler({
    schema: { body: createCheckoutSchema },
    handler: async (_c, ctx) => {
      const stripeSecretKey = ctx.env.STRIPE_SECRET_KEY;
      if (!stripeSecretKey) {
        throw new PaymentProcessingError('STRIPE_SECRET_KEY not configured');
      }
      const stripe = createStripeClient(stripeSecretKey);
      const purchaseService = new PurchaseService(
        { db: dbHttp, environment: ctx.env.ENVIRONMENT || 'development' },
        stripe
      );
      // ... handler code
    }
  })
);
```

After:
```typescript
import { withPurchaseService } from '@codex/worker-utils';

const checkout = new Hono<HonoEnv>();
checkout.use('/*', withPurchaseService());

// Helper to get service with type narrowing
function getPurchaseService(c: Context<HonoEnv>): PurchaseServiceType {
  const service = c.get('purchaseService');
  if (!service) {
    throw new InternalServiceError('PurchaseService not initialized');
  }
  return service;
}

checkout.post('/create',
  withPolicy({ auth: 'required', rateLimit: 'auth' }),
  createAuthenticatedHandler({
    schema: { body: createCheckoutSchema },
    handler: async (c, ctx) => {
      const service = getPurchaseService(c);
      // ... handler code using service
    }
  })
);
```

File: `workers/ecom-api/src/routes/purchases.ts`

Apply same pattern - remove inline service creation, use middleware.

**Task 1.4: Update webhook handler for transaction support**

File: `workers/ecom-api/src/handlers/checkout.ts`

The webhook handler needs `createPerRequestDbClient` for transactions. Options:
1. Create `withPurchaseServiceWithDb()` middleware for webhooks
2. Keep inline creation for this one case (acceptable since it's a single handler)

Recommended: Keep inline for webhook handler since it's a single location with special requirements (transaction support, different db client).

**Task 1.5: Run tests and verify**

```bash
pnpm --filter ecom-api test
pnpm --filter ecom-api typecheck
```

---

### Phase 2: Create admin-api Service Middleware

**Task 2.1: Create admin service middleware functions**

File: `packages/worker-utils/src/admin-service-middleware.ts` (new file)

```typescript
/**
 * Admin Service Middleware
 *
 * Service middleware for admin-api worker.
 * Provides automatic service instantiation and cleanup.
 */

import {
  AdminAnalyticsService,
  AdminContentManagementService,
  AdminCustomerManagementService,
} from '@codex/admin';
import type {
  AdminAnalyticsService as AdminAnalyticsServiceType,
  AdminContentManagementService as AdminContentManagementServiceType,
  AdminCustomerManagementService as AdminCustomerManagementServiceType,
} from '@codex/admin';
import { createDbClient, createPerRequestDbClient } from '@codex/database';
import type { HonoEnv } from '@codex/shared-types';
import type { MiddlewareHandler } from 'hono';

// Module augmentation
declare module '@codex/shared-types' {
  interface Variables {
    adminAnalyticsService?: AdminAnalyticsServiceType;
    adminContentManagementService?: AdminContentManagementServiceType;
    adminCustomerManagementService?: AdminCustomerManagementServiceType;
  }
}

export function withAdminAnalyticsService(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const service = new AdminAnalyticsService({
      db: createDbClient(c.env),
      environment: c.env.ENVIRONMENT || 'development',
    });
    c.set('adminAnalyticsService', service);
    await next();
  };
}

export function withAdminContentManagementService(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const { db, cleanup } = createPerRequestDbClient(c.env);
    const service = new AdminContentManagementService({
      db,
      environment: c.env.ENVIRONMENT || 'development',
    });
    try {
      c.set('adminContentManagementService', service);
      await next();
    } finally {
      c.executionCtx.waitUntil(cleanup());
    }
  };
}

export function withAdminCustomerManagementService(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const { db, cleanup } = createPerRequestDbClient(c.env);
    const service = new AdminCustomerManagementService({
      db,
      environment: c.env.ENVIRONMENT || 'development',
    });
    try {
      c.set('adminCustomerManagementService', service);
      await next();
    } finally {
      c.executionCtx.waitUntil(cleanup());
    }
  };
}
```

**Task 2.2: Add @codex/admin dependency to worker-utils**

File: `packages/worker-utils/package.json`

Add:
```json
"dependencies": {
  "@codex/admin": "workspace:*"
}
```

Run: `pnpm install`

**Task 2.3: Export admin middleware from worker-utils**

File: `packages/worker-utils/src/index.ts`

Add:
```typescript
export {
  withAdminAnalyticsService,
  withAdminContentManagementService,
  withAdminCustomerManagementService,
} from './admin-service-middleware';
```

**Task 2.4: Refactor admin-api index.ts**

File: `workers/admin-api/src/index.ts`

Current structure:
- 3 analytics endpoints (GET)
- 3 content management endpoints (POST/DELETE)
- 3 customer management endpoints (GET/POST)

Strategy:
1. Create separate route files for each domain
2. Apply service middleware per-route-group
3. Use helper functions for type-safe service access

**Option A: Route-level middleware (Recommended)**

```typescript
// workers/admin-api/src/index.ts

import {
  withAdminAnalyticsService,
  withAdminContentManagementService,
  withAdminCustomerManagementService,
} from '@codex/worker-utils';

// Analytics routes - use HTTP db (read-only)
app.get('/api/admin/analytics/revenue', withAdminAnalyticsService(), async (c) => {
  const service = getAdminAnalyticsService(c);
  // ... handler
});

// Content management routes - use per-request db (transactions)
app.post('/api/admin/content/:id/publish', withAdminContentManagementService(), async (c) => {
  const service = getAdminContentManagementService(c);
  // ... handler
});

// Customer management routes - mixed (reads use HTTP, writes use per-request)
app.get('/api/admin/customers', withAdminAnalyticsService(), async (c) => {
  // CustomerManagement GET endpoints could use HTTP client
});
app.post('/api/admin/customers/:customerId/grant-access/:contentId',
  withAdminCustomerManagementService(),
  async (c) => {
    // Write endpoint uses per-request db
  }
);
```

**Option B: Grouped routes with shared middleware**

```typescript
// workers/admin-api/src/routes/analytics.ts
const analytics = new Hono<AdminApiEnv>();
analytics.use('/*', withAdminAnalyticsService());

analytics.get('/revenue', async (c) => { /* ... */ });
analytics.get('/customers', async (c) => { /* ... */ });
analytics.get('/top-content', async (c) => { /* ... */ });

export default analytics;

// workers/admin-api/src/index.ts
app.route('/api/admin/analytics', analytics);
```

**Task 2.5: Create helper functions**

File: `workers/admin-api/src/helpers.ts`

```typescript
import { InternalServiceError } from '@codex/service-errors';
import type { Context } from 'hono';
import type { AdminApiEnv } from './types';

export function getAdminAnalyticsService(c: Context<AdminApiEnv>) {
  const service = c.get('adminAnalyticsService');
  if (!service) {
    throw new InternalServiceError('AdminAnalyticsService not initialized');
  }
  return service;
}

export function getAdminContentManagementService(c: Context<AdminApiEnv>) {
  const service = c.get('adminContentManagementService');
  if (!service) {
    throw new InternalServiceError('AdminContentManagementService not initialized');
  }
  return service;
}

export function getAdminCustomerManagementService(c: Context<AdminApiEnv>) {
  const service = c.get('adminCustomerManagementService');
  if (!service) {
    throw new InternalServiceError('AdminCustomerManagementService not initialized');
  }
  return service;
}
```

**Task 2.6: Update admin-api types**

File: `workers/admin-api/src/types.ts`

```typescript
import type { DatabaseWs } from '@codex/database';
import type { Bindings, Variables } from '@codex/shared-types';

export interface AdminVariables extends Variables {
  organizationId: string;
  perRequestDb?: DatabaseWs;
  // Note: adminAnalyticsService, adminContentManagementService,
  // adminCustomerManagementService are added via module augmentation
}

export type AdminApiEnv = {
  Bindings: Bindings;
  Variables: AdminVariables;
};
```

**Task 2.7: Run tests and verify**

```bash
pnpm --filter admin-api test
pnpm --filter admin-api typecheck
pnpm --filter @codex/worker-utils test
pnpm --filter @codex/worker-utils typecheck
```

---

### Phase 3: Testing and Verification

**Task 3.1: Update/add unit tests for new middleware**

File: `packages/worker-utils/src/__tests__/service-middleware.test.ts`

Add tests for:
- `withPurchaseService()` - verifies service is injected
- `withAdminAnalyticsService()` - verifies service is injected
- `withAdminContentManagementService()` - verifies cleanup is called
- `withAdminCustomerManagementService()` - verifies cleanup is called

**Task 3.2: Run full test suite**

```bash
# From project root
pnpm test
pnpm typecheck
pnpm lint
```

**Task 3.3: Manual integration testing**

```bash
# Start ecom-api
cd workers/ecom-api && pnpm dev

# Test checkout endpoint (requires valid session)
curl -X POST http://localhost:42072/checkout/create \
  -H "Cookie: codex-session=..." \
  -H "Content-Type: application/json" \
  -d '{"contentId":"...","successUrl":"...","cancelUrl":"..."}'

# Start admin-api
cd workers/admin-api && pnpm dev

# Test analytics endpoint (requires platform owner session)
curl http://localhost:42073/api/admin/analytics/revenue \
  -H "Cookie: codex-session=..."
```

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `packages/worker-utils/src/admin-service-middleware.ts` | Admin service middleware functions |

### Modified Files

| File | Changes |
|------|---------|
| `packages/worker-utils/src/service-middleware.ts` | Add `withPurchaseService()` |
| `packages/worker-utils/src/index.ts` | Export new middleware |
| `packages/worker-utils/package.json` | Add `@codex/purchase`, `@codex/admin` deps |
| `workers/ecom-api/src/routes/checkout.ts` | Use `withPurchaseService()` middleware |
| `workers/ecom-api/src/routes/purchases.ts` | Use `withPurchaseService()` middleware |
| `workers/admin-api/src/index.ts` | Use admin service middleware |
| `workers/admin-api/src/types.ts` | Update Variables interface (if needed) |

### Test Files

| File | Changes |
|------|---------|
| `packages/worker-utils/src/__tests__/service-middleware.test.ts` | Add tests for new middleware |

---

## Acceptance Criteria

1. **No repetitive service initialization** - Each service is initialized once per request via middleware
2. **Type-safe access** - `c.get('serviceName')` returns properly typed service
3. **Automatic cleanup** - Database connections are cleaned up automatically
4. **All tests pass** - No regression in existing functionality
5. **TypeScript compiles** - No type errors
6. **Consistent patterns** - All workers follow the same middleware pattern

---

## Rollback Plan

If issues are discovered after deployment:

1. Revert the commit with `git revert <commit-sha>`
2. The previous inline service initialization pattern still works
3. No database schema changes - purely code refactoring

---

## Dependencies

- `@codex/purchase` must export `PurchaseService` type (already does)
- `@codex/admin` must export service types (verify before starting)
- `@codex/database` must export `createPerRequestDbClient` (already does)
- `@codex/shared-types` must support module augmentation for Variables (already does)

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Circular dependency between worker-utils and service packages | Service packages have no dependency on worker-utils - safe |
| Type augmentation conflicts | Each middleware uses unique key in Variables |
| Cleanup not called on errors | try/finally pattern ensures cleanup always runs |
| Performance regression | Middleware overhead is minimal (function call + context set) |

---

## Open Questions

1. **Should webhook handlers use middleware?**
   - Current recommendation: No, keep inline for transaction-specific requirements
   - Alternative: Create `withPurchaseServiceWithDb()` variant

2. **Should admin services be in worker-utils or in admin-api?**
   - Current recommendation: In worker-utils for consistency
   - Alternative: In admin-api as worker-specific middleware

3. **Should we create a factory function for service middleware?**
   - Current pattern is explicit per-service functions
   - Could abstract further but may reduce clarity

---

## Implementation Checklist

- [ ] Phase 1.1: Create `withPurchaseService()` in service-middleware.ts
- [ ] Phase 1.2: Add @codex/purchase dependency to worker-utils
- [ ] Phase 1.3: Refactor ecom-api/routes/checkout.ts
- [ ] Phase 1.3: Refactor ecom-api/routes/purchases.ts
- [ ] Phase 1.4: Verify webhook handler (keep inline or create variant)
- [ ] Phase 1.5: Run ecom-api tests and typecheck

- [ ] Phase 2.1: Create admin-service-middleware.ts
- [ ] Phase 2.2: Add @codex/admin dependency to worker-utils
- [ ] Phase 2.3: Export admin middleware from index.ts
- [ ] Phase 2.4: Refactor admin-api index.ts
- [ ] Phase 2.5: Create helper functions in admin-api
- [ ] Phase 2.6: Update admin-api types.ts (if needed)
- [ ] Phase 2.7: Run admin-api tests and typecheck

- [ ] Phase 3.1: Add unit tests for new middleware
- [ ] Phase 3.2: Run full test suite
- [ ] Phase 3.3: Manual integration testing

---

## References

- [Existing service middleware pattern](../../../packages/worker-utils/src/service-middleware.ts)
- [ecom-api CLAUDE.md](../../../workers/ecom-api/CLAUDE.md)
- [admin-api current implementation](../../../workers/admin-api/src/index.ts)
- [Hono middleware documentation](https://hono.dev/docs/guides/middleware)
