---
name: plan
description: Enforce Codex architectural patterns when planning beads tasks. Use when starting work, planning implementation, or ensuring architectural consistency.
disable-model-invocation: true
---

# Codex Architecture Planning Skill

**Purpose**: Enforce Codex architectural patterns when planning beads tasks. This skill ensures all development adheres to established conventions across backend, frontend, data layer, security, and testing.

**Usage**: Invoke this skill at the start of any beads task to understand the architecture patterns that must be followed.

---

# Codex Platform Architecture

## High-Level Structure

```
Codex Platform
├── Workers (Cloudflare)      → API Endpoints
│   ├── auth (42069)
│   ├── content-api (4001)
│   ├── organization-api (42075)
│   ├── ecom-api (42072)
│   └── admin-api (42073)
├── Packages
│   ├── Foundation
│   │   ├── @codex/database      → Drizzle ORM, Neon DB
│   │   ├── @codex/shared-types  → TypeScript contracts
│   │   ├── @codex/service-errors→ BaseService, Error classes
│   │   ├── @codex/security      → Auth, Rate Limit, Headers
│   │   └── @codex/validation    → Zod schemas
│   ├── Services
│   │   ├── @codex/content       → Content/Media lifecycle
│   │   ├── @codex/organization  → Org management
│   │   ├── @codex/access        → Access control, Signed URLs
│   │   └── @codex/purchase      → Stripe integration
│   └── Utilities
│       ├── @codex/worker-utils  → Worker factory, procedure()
│       ├── @codex/cloudflare-clients → R2, KV wrappers
│       └── @codex/test-utils    → Factories, test setup
└── Frontend (apps/web)
    ├── lib/collections/         → TanStack DB (local-first)
    ├── lib/remote/              → SvelteKit remote functions
    └── routes/                  → SvelteKit file-based routing
```

---

## Phase 1: Task Analysis

Before implementing, answer these questions:

### 1. Layer Identification
Which layers are affected?
- [ ] Worker (API endpoint needed?)
- [ ] Service (business logic needed?)
- [ ] Database (schema changes needed?)
- [ ] Validation (new input schemas needed?)
- [ ] Frontend (UI components, data fetching?)

### 2. Domain Identification
Which domain owns this feature?
- [ ] Content (@codex/content, content-api worker)
- [ ] Organization (@codex/organization, organization-api worker)
- [ ] Authentication/Purchase (@codex/purchase, auth/ecom workers)
- [ ] Admin (@codex/admin, admin-api worker)
- [ ] Media/Transcoding (@codex/transcoding, media-api worker)

### 3. Security Requirements
- [ ] Needs authentication? (auth: 'required')
- [ ] Role-based access? (roles: ['creator', 'admin'])
- [ ] Organization membership check? (requireOrgMembership: true)
- [ ] Public endpoint? (auth: 'none')
- [ ] Worker-to-worker auth? (auth: 'worker')

---

## Phase 2: Backend Implementation Patterns

### 2.1 Adding a New API Endpoint

**Step 1: Define Validation Schema** → `packages/validation/src/[domain].ts`

```typescript
// packages/validation/src/content.ts
import { z } from 'zod';
import { uuidSchema, slugSchema } from './primitives';

export const createMyResourceSchema = z.object({
  title: z.string().min(1).max(255),
  slug: slugSchema,
  description: z.string().optional(),
  // Use existing primitives when possible
  organizationId: uuidSchema.optional(),
});

export type CreateMyResourceInput = z.infer<typeof createMyResourceSchema>;
```

**Step 2: Add Service Method** → `packages/[service]/src/services/*.service.ts`

```typescript
// packages/content/src/services/my-resource-service.ts
import { BaseService } from '@codex/service-errors';
import { scopedNotDeleted, withCreatorScope } from '@codex/database';
import { myResources } from '@codex/database/schema';
import { NotFoundError } from '../errors';
import type { CreateMyResourceInput } from '@codex/validation';

export class MyResourceService extends BaseService {
  /**
   * Create new resource
   * Security: Validates input, scopes to creator, uses transaction
   */
  async create(input: CreateMyResourceInput, creatorId: string) {
    // ALWAYS validate input
    const validated = createMyResourceSchema.parse(input);

    try {
      return await this.db.transaction(async (tx) => {
        const [newResource] = await tx
          .insert(myResources)
          .values({
            creatorId,
            ...validated,
          })
          .returning();

        return newResource;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('Resource already exists');
      }
      throw this.wrapError(error, { creatorId, input: validated });
    }
  }

  /**
   * Get resource by ID
   * Security: SCOPED to creator, excludes soft-deleted
   */
  async get(id: string, creatorId: string) {
    const result = await this.db.query.myResources.findFirst({
      where: and(
        eq(myResources.id, id),
        scopedNotDeleted(myResources, creatorId)  // MANDATORY SCOPING
      ),
    });

    return result || null;
  }

  /**
   * Update resource
   * Security: Verifies ownership before update
   */
  async update(id: string, input: Partial<CreateMyResourceInput>, creatorId: string) {
    const validated = createMyResourceSchema.partial().parse(input);

    return await this.db.transaction(async (tx) => {
      // Verify exists and belongs to creator
      const existing = await tx.query.myResources.findFirst({
        where: and(eq(myResources.id, id), scopedNotDeleted(myResources, creatorId)),
      });

      if (!existing) {
        throw new NotFoundError('Resource not found', { resourceId: id });
      }

      const [updated] = await tx
        .update(myResources)
        .set({ ...validated, updatedAt: new Date() })
        .where(and(eq(myResources.id, id), withCreatorScope(myResources, creatorId)))
        .returning();

      return updated;
    });
  }

  /**
   * Soft delete resource
   * Security: Sets deletedAt instead of physical deletion
   */
  async delete(id: string, creatorId: string) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(myResources)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(myResources.id, id), withCreatorScope(myResources, creatorId)));
    });
  }
}
```

**Step 3: Add Worker Route** → `workers/[worker]/src/routes/*.ts`

```typescript
// workers/content-api/src/routes/my-resources.ts
import { procedure } from '@codex/worker-utils';
import { createMyResourceSchema } from '@codex/validation';
import { z } from 'zod';

// GET /api/my-resources/:id
app.get('/api/my-resources/:id',
  procedure({
    policy: { auth: 'required' },
    input: {
      params: z.object({ id: z.string().uuid() }),
    },
    handler: async (ctx) => {
      return await ctx.services.myResource.get(
        ctx.input.params.id,
        ctx.user.id
      );
    },
  })
);

// POST /api/my-resources
app.post('/api/my-resources',
  procedure({
    policy: { auth: 'required', roles: ['creator'] },
    input: { body: createMyResourceSchema },
    successStatus: 201,
    handler: async (ctx) => {
      return await ctx.services.myResource.create(
        ctx.input.body,
        ctx.user.id
      );
    },
  })
);

// PATCH /api/my-resources/:id
app.patch('/api/my-resources/:id',
  procedure({
    policy: { auth: 'required' },
    input: {
      params: z.object({ id: z.string().uuid() }),
      body: createMyResourceSchema.partial(),
    },
    handler: async (ctx) => {
      return await ctx.services.myResource.update(
        ctx.input.params.id,
        ctx.input.body,
        ctx.user.id
      );
    },
  })
);

// DELETE /api/my-resources/:id
app.delete('/api/my-resources/:id',
  procedure({
    policy: { auth: 'required' },
    input: {
      params: z.object({ id: z.string().uuid() }),
    },
    successStatus: 204,
    handler: async (ctx) => {
      await ctx.services.myResource.delete(
        ctx.input.params.id,
        ctx.user.id
      );
      return null;
    },
  })
);
```

---

### 2.2 Database Patterns

#### Schema Definition → `packages/database/src/schema/*.ts`

```typescript
// packages/database/src/schema/my-resources.ts
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from './columns';

export const myResources = pgTable('my_resources', {
  id: uuid('id').defaultRandom().primaryKey(),
  creatorId: text('creator_id').notNull(),  // ALWAYS include for scoping
  organizationId: text('organization_id'), // Optional org scoping

  title: text('title').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),

  status: text('status').notNull().default('draft'),
  isActive: boolean('is_active').notNull().default(true),

  deletedAt: timestamp('deleted_at'),  // SOFT DELETE column
  ...createdAt,
  ...updatedAt,
});

// Types are auto-generated - don't create manually
export type MyResource = typeof myResources.$inferSelect;
export type NewMyResource = typeof myResources.$inferInsert;
```

#### Query Patterns

```typescript
import { scopedNotDeleted, orgScopedNotDeleted, whereNotDeleted } from '@codex/database';

// CORRECT: Scoped to creator
const resource = await db.query.myResources.findFirst({
  where: and(
    eq(myResources.id, id),
    scopedNotDeleted(myResources, creatorId)  // MANDATORY
  ),
});

// CORRECT: Scoped to organization
const orgResources = await db.query.myResources.findMany({
  where: and(
    orgScopedNotDeleted(myResources, organizationId)
  ),
});

// WRONG: No scoping - security vulnerability!
const resource = await db.query.myResources.findFirst({
  where: eq(myResources.id, id),
});
```

#### Transaction Pattern

```typescript
// Use dbWs for transactions (tests/dev)
await dbWs.transaction(async (tx) => {
  // Multi-step atomic operation
  await tx.insert(table1).values({...});
  await tx.insert(table2).values({...});
  // Both succeed or both rollback
});
```

---

### 2.3 Security Patterns

#### Policy Enforcement in procedure()

```typescript
// Public endpoint (no auth)
policy: { auth: 'none' }

// Authenticated endpoint
policy: { auth: 'required' }

// Role-based access
policy: { auth: 'required', roles: ['creator', 'admin'] }

// Organization membership required
policy: {
  auth: 'required',
  requireOrgMembership: true,
  roles: ['admin'],  // Within the org
}

// Worker-to-worker auth (HMAC)
policy: { auth: 'worker' }

// Rate limiting
policy: {
  auth: 'required',
  rateLimit: 'api',  // 'auth', 'api', 'webhook', 'streaming'
}
```

#### Error Handling

```typescript
// packages/[service]/src/errors.ts
import {
  NotFoundError as BaseNotFound,
  ForbiddenError as BaseForbidden,
  BusinessLogicError as BaseBusinessLogic,
} from '@codex/service-errors';

export class MyResourceNotFoundError extends BaseNotFound {
  constructor(id: string) {
    super('MyResource not found', { resourceId: id });
  }
}

export class InvalidMyResourceStateError extends BaseBusinessLogic {
  constructor(currentState: string) {
    super('Invalid resource state for this operation', { currentState });
  }
}
```

---

## Phase 3: Frontend Implementation Patterns

### 3.1 Data Fetching with Remote Functions

**Create Remote Function** → `apps/web/src/lib/remote/[domain].remote.ts`

```typescript
// apps/web/src/lib/remote/my-resources.remote.ts
import { z } from 'zod';
import { query } from '$app/server';
import { createServerApi } from '$lib/server/api';

/**
 * List my resources with pagination
 * Usage: {#await listMyResources({ page: 1 }) as result}
 */
export const listMyResources = query(
  z.object({
    page: z.number().optional(),
    limit: z.number().optional(),
    status: z.enum(['draft', 'published']).optional(),
  }).optional(),
  async (params) => {
    const { platform, cookies } = getRequestEvent();
    const api = createServerApi(platform, cookies);

    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.status) searchParams.set('status', params.status);

    return api.myResources.list(searchParams.toString() || undefined);
  }
);

/**
 * Get single resource by ID
 */
export const getMyResource = query(z.string().uuid(), async (id) => {
  const { platform, cookies } = getRequestEvent();
  const api = createServerApi(platform, cookies);
  return api.myResources.get(id);
});
```

### 3.2 Local-First Collections (TanStack DB)

**Create Collection** → `apps/web/src/lib/collections/my-resources.ts`

```typescript
// apps/web/src/lib/collections/my-resources.ts
import { createCollection } from '@tanstack/db';
import { queryCollectionOptions } from '@tanstack/query-db-collection';
import { listMyResources } from '$lib/remote/my-resources.remote';
import { queryClient } from './query-client';

export const myResourcesCollection = queryClient
  ? createCollection<MyResource, string>(
      queryCollectionOptions({
        queryKey: ['my-resources'],
        queryFn: async () => {
          const result = await listMyResources();
          return result?.items ?? [];
        },
        queryClient,
        getKey: (item) => item.id,
      })
    )
  : undefined;
```

**Use in Component** → `apps/web/src/routes/**/*.svelte`

```svelte
<script>
  import { useLiveQuery, myResourcesCollection, eq } from '$lib/collections';

  // Reactive query over local collection
  const { data: publishedResources } = useLiveQuery((q) =>
    q.from({ myResources: myResourcesCollection })
     .where(({ myResources }) => eq(myResources.status, 'published'))
  );
</script>

{#each publishedResources as resource}
  <ResourceCard {resource} />
{/each}
```

### 3.3 Component Patterns

**Follow existing UI component structure** → `apps/web/src/lib/components/ui/`

```svelte
<!-- MyComponent.svelte -->
<script lang="ts">
  import { Button } from '$lib/components/ui/Button';
  import { Card } from '$lib/components/ui/Card';

  export let resource: MyResource;
  export let onSave: (data: UpdateData) => Promise<void>;

  let isSaving = false;

  async function handleSave() {
    isSaving = true;
    try {
      await onSave({ /* data */ });
    } finally {
      isSaving = false;
    }
  }
</script>

<Card>
  <h2>{resource.title}</h2>
  <Button onclick={handleSave} disabled={isSaving}>
    {isSaving ? 'Saving...' : 'Save'}
  </Button>
</Card>
```

---

## Phase 4: Testing Patterns

### 4.1 Service Testing

**Use Test Utilities** → `packages/[service]/src/services/__tests__/*.test.ts`

```typescript
// packages/content/src/services/__tests__/my-resource-service.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '@codex/test-utils';
import { createTestMyResourceInput } from '@codex/test-utils/factories';
import { MyResourceService } from '../my-resource-service';

describe('MyResourceService', () => {
  let db;
  let service: MyResourceService;

  beforeAll(async () => {
    db = await setupTestDatabase();
    service = new MyResourceService({ db, environment: 'test' });
  });

  afterAll(async () => {
    await teardownTestDatabase(db);
  });

  it('should create resource', async () => {
    const input = createTestMyResourceInput('test-creator-id');
    const result = await service.create(input, 'test-creator-id');

    expect(result).toHaveProperty('id');
    expect(result.title).toBe(input.title);
  });

  it('should scope resources to creator', async () => {
    const creator1 = 'creator-1';
    const creator2 = 'creator-2';

    await service.create(createTestMyResourceInput(creator1), creator1);
    await service.create(createTestMyResourceInput(creator2), creator2);

    const creator1Resources = await service.list(creator1);
    const creator2Resources = await service.list(creator2);

    expect(creator1Resources.items).toHaveLength(1);
    expect(creator2Resources.items).toHaveLength(1);
    expect(creator1Resources.items[0].creatorId).toBe(creator1);
  });
});
```

### 4.2 Factory Patterns

**Use Existing Factories** → `packages/test-utils/src/factories.ts`

```typescript
// Add new factory for your domain
export function createTestMyResourceInput(
  creatorId: string,
  overrides: Partial<NewMyResource> = {}
): NewMyResource {
  return {
    creatorId,
    title: `Test Resource ${Date.now()}`,
    slug: `test-resource-${Date.now()}`,
    description: 'Test description',
    status: 'draft',
    ...overrides,
  };
}
```

---

## Phase 5: Implementation Checklist

Before considering a task complete, verify:

### Backend
- [ ] Validation schema defined in `packages/validation/src/`
- [ ] Service method extends `BaseService`
- [ ] All queries use `scopedNotDeleted()` or `orgScopedNotDeleted()`
- [ ] Transactions used for multi-step operations
- [ ] Typed errors thrown (extends base error classes)
- [ ] Worker route uses `procedure()` handler
- [ ] Correct HTTP status codes (201 for POST, 204 for DELETE)
- [ ] Policy configured (auth, roles, rateLimit)

### Database
- [ ] Schema includes `creatorId` or `organizationId`
- [ ] Soft delete column `deletedAt` included
- [ ] Timestamp columns `createdAt`, `updatedAt` included
- [ ] Unique constraints on slug + orgId
- [ ] Migration created

### Security
- [ ] No PII in logs/error context
- [ ] Input validated before processing
- [ ] Ownership verified before mutations
- [ ] XSS protection for user-generated content (sanitizeSvgContent)
- [ ] URL validation (HTTP/HTTPS only)

### Frontend
- [ ] Remote function in `lib/remote/`
- [ ] Collection updated if data displayed
- [ ] Loading states handled
- [ ] Error states handled
- [ ] No `any` types

### Testing
- [ ] Unit tests for service methods
- [ ] Integration tests for worker routes
- [ ] Tests use factories from `@codex/test-utils`
- [ ] Both success and error paths tested

---

## Common Pitfalls to Avoid

1. **Missing Scoping**: Never query by ID alone - always include creatorId/orgId
2. **Hard Deletes**: Never use `db.delete()` - use soft delete (set deletedAt)
3. **Any Types**: Never use `any` - use proper TypeScript types from schema
4. **Manual Auth**: Never manually check auth - use procedure() policy
5. **Skipping Validation**: Never trust input - always validate with Zod
6. **Transactions without dbWs**: Only dbWs supports transactions
7. **Logging Secrets**: Never log passwords, tokens, or PII
8. **Direct DB Access in Workers**: Workers should call services, not access db directly

---

## File Path Quick Reference

| Purpose | Path |
|---------|------|
| Worker Routes | `workers/[worker]/src/routes/*.ts` |
| Service Logic | `packages/[service]/src/services/*.ts` |
| Validation Schemas | `packages/validation/src/*.ts` |
| Database Schema | `packages/database/src/schema/*.ts` |
| Migrations | `packages/database/src/drizzle/*.sql` |
| Frontend Collections | `apps/web/src/lib/collections/*.ts` |
| Frontend Remotes | `apps/web/src/lib/remote/*.remote.ts` |
| UI Components | `apps/web/src/lib/components/ui/*/` |
| Test Factories | `packages/test-utils/src/factories.ts` |
| Error Classes | `packages/[service]/src/errors.ts` |

---

## Next Steps

After reviewing this guide:

1. **Identify the domain** for your task (content, organization, etc.)
2. **Find similar implementations** in existing codebase
3. **Follow the step-by-step patterns** above
4. **Run through the checklist** before considering it done
5. **Ask for clarification** if any pattern is unclear

**Remember**: The existing codebase is the best reference. When in doubt, find a similar feature and follow its patterns exactly.
