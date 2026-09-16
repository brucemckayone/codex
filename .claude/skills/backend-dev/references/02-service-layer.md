---
name: service-layer
description: >
  Deep reference for `BaseService`, the service registry pattern, transactions,
  scoped queries, error handling, and lifecycle management in Codex services.
type: reference
---

# Service Layer

Every piece of business logic in Codex lives in a service class that extends
`BaseService`. This reference explains **why** the service layer is shaped the way
it is — and how to extend it correctly.

Reference implementations:
- `packages/service-errors/src/base-service.ts:62-112` (the class itself)
- `packages/worker-utils/src/procedure/service-registry.ts:85-638` (registry + lifecycle)
- `packages/organization/src/services/organization-service.ts` (canonical service)
- `packages/content/src/services/content-service.ts` (scoping + cache integration)

---

## Why Services Exist

Route handlers should read like English: "when someone POSTs this, call that service
method." If they contain SQL, if-chains over roles, cache invalidation, or Stripe
calls, they're doing too much.

Services own **business logic**. Their API is typed inputs and typed outputs, with
typed errors (`ServiceError` subclasses). They hide the DB schema from callers —
you never pass a Drizzle row to a consumer.

The split is:

| Layer | Job | Does NOT do |
|-------|-----|-------------|
| Route handler (`procedure`) | Validate input, enforce policy, call service, shape response | Business logic, SQL |
| Service (`BaseService`) | Business logic, DB queries, transactions, logging | HTTP concerns, response envelope |
| Foundation (`@codex/database`, `@codex/validation`, etc.) | Primitives | Business logic |

---

## The BaseService Contract

`BaseService` gives every service three things automatically:

```typescript
protected readonly db: ServiceDatabase;      // HTTP or WebSocket client
protected readonly environment: string;      // 'production', 'development', 'test'
protected obs: ObservabilityClient;          // Scoped to this.constructor.name
```

Constructor takes a `ServiceConfig`:

```typescript
{ db: typeof dbHttp | typeof dbWs, environment: string }
```

The `obs` client is auto-scoped to the class name (e.g. `ContentService` logs appear
with `service: "ContentService"`). This is why you write `this.obs.info(...)` and
never `new ObservabilityClient()`.

### Minimum viable service

```typescript
import { BaseService, NotFoundError, type ServiceConfig } from '@codex/service-errors';
import { dbHttp, schema, scopedNotDeleted } from '@codex/database';
import { and, eq } from 'drizzle-orm';

export class FeatureService extends BaseService {
  constructor(config: ServiceConfig) {
    super(config);
  }

  async getById(id: string, creatorId: string) {
    const item = await this.db.query.feature.findFirst({
      where: and(
        eq(schema.feature.id, id),
        scopedNotDeleted(schema.feature, creatorId)
      ),
    });
    if (!item) throw new NotFoundError('Feature not found', { id });
    return item;
  }
}
```

Every read scoped. Every missing row throws a typed error. No `console.log`. No
manual error context.

---

## Error Handling Pattern

There are two shapes of error handling in services:

### Shape 1: throw typed errors for expected failures

```typescript
async delete(id: string, userId: string) {
  const item = await this.getById(id, userId);       // throws NotFoundError
  if (item.status === 'published') {
    throw new BusinessLogicError(
      'Cannot delete published content',
      { id, status: item.status }
    );
  }
  await this.db.update(schema.content)
    .set({ deletedAt: new Date() })
    .where(eq(schema.content.id, id));
}
```

The `procedure()` framework maps each `ServiceError` subclass to its HTTP status
(see `packages/service-errors/CLAUDE.md` for the table). You never write `if (err)
return c.json(...)` — just throw.

### Shape 2: wrap unknown errors with handleError()

For calls into code that can throw anything (DB drivers, external SDKs, unserialisable
JSON), wrap with `this.handleError()`:

```typescript
try {
  await externalApi.call();
} catch (err) {
  this.handleError(err, 'external-api-call');
  // this.handleError always throws — it never returns.
  // If err is a ServiceError, re-throws unchanged.
  // Otherwise wraps as InternalServiceError with context.
}
```

**Never** write `catch { return null }` or `catch { throw new Error(...) }`. Both
destroy information.

### Inside transactions

```typescript
await this.db.transaction(async (tx) => {
  await tx.insert(...).values(...);
  await tx.insert(...).values(...);
  // Throwing anywhere inside rolls the transaction back.
});
```

**Never** catch inside a `db.transaction()` unless you specifically want partial
commit. Throwing is how you roll back. See `packages/organization/src/services/organization-service.ts:77-141`
for a canonical transaction example.

---

## Scoping — The Single Biggest Security Rule

Every query against multi-tenant data must be scoped:

```typescript
// CORRECT — scoped to creator + excludes soft-deleted
where: and(
  eq(schema.content.id, id),
  scopedNotDeleted(schema.content, creatorId)
)

// CORRECT — scoped to org + excludes soft-deleted
where: and(
  eq(schema.content.id, id),
  eq(schema.content.organizationId, orgId),
  whereNotDeleted(schema.content)
)

// WRONG — allows cross-tenant reads (data leak)
where: eq(schema.content.id, id)
```

`scopedNotDeleted(table, creatorId)` is the preferred combined helper. It's two
checks collapsed into one so you can't forget one and not the other.

For org-scoped reads that aren't creator-scoped (e.g. viewing any creator's public
content inside an org), use explicit `organizationId` matching — but still include
`whereNotDeleted`.

**Public endpoints** that don't require auth still scope: they typically filter by
`status = 'published'` and `publishedAt <= now()`, which limits what an anonymous
visitor can see.

---

## Transactions: When and How

Rule: **if more than one row is written atomically, use `db.transaction()`.**

```typescript
return this.db.transaction(async (tx) => {
  const [org] = await tx.insert(schema.organizations).values(...).returning();
  await tx.insert(schema.organizationMemberships).values({
    organizationId: org.id,
    userId,
    role: 'owner',
    status: 'active',
  });
  return org;
});
```

Two hard constraints:

1. **Transactions require `dbWs`** — the WebSocket client. HTTP cannot hold a stateful
   transaction session. See `03-database-patterns.md`.
2. **Service registry shares the WebSocket connection** across all services in one
   request. You don't need to wire this — `getSharedDb()` in the registry does it.

**Unique constraint handling** inside transactions:

```typescript
try {
  return await this.db.transaction(async (tx) => { ... });
} catch (error) {
  if (isUniqueViolation(error)) {
    throw new ConflictError('Slug already exists', { slug });
  }
  this.handleError(error, 'create');
}
```

---

## The Service Registry Pattern

Services are **never** instantiated in route handlers. They're fetched from
`ctx.services.*`, which is a lazy registry created by `procedure()` for each request.

Why lazy? Because:

- A worker handles hundreds of requests per second.
- Each request only uses 1–3 services.
- Constructing all 17+ services eagerly wastes CPU and opens DB connections.
- Cleanup must be per-request, not per-worker-instance.

Reference: `packages/worker-utils/src/procedure/service-registry.ts:85-638`.

### How the registry works

1. `procedure()` calls `createServiceRegistry(env, obs, organizationId)` after auth
2. `createServiceRegistry` returns `{ registry, cleanup }`
3. Each service is a lazy getter: first access constructs it, subsequent access returns the cached instance
4. Services that share a `dbWs` connection via `getSharedDb()` are grouped — the first one opens the connection, all others reuse it
5. After the handler resolves, `ctx.executionCtx.waitUntil(cleanup())` closes the WebSocket in the background

### Shared dependencies

Some resources are shared across services:

| Resource | Shared because | Location |
|----------|----------------|----------|
| `dbWs` | Transactions need a single WebSocket | `getSharedDb()` |
| `Stripe` client | SDK is heavy to construct | `getStripeClient()` |
| `VersionedCache` | KV binding is per-worker-env | Injected into services that need it (e.g. content) |
| `ObservabilityClient` | Scoped per-service by class name | Created in `BaseService` constructor |

### Org-scoped services

Some services need `organizationId` in their constructor:

```typescript
// In service-registry.ts
get settings() {
  if (!_settings) {
    if (!organizationId) {
      throw new Error(
        'organizationId required for settings service. ' +
        'Use policy.requireOrgMembership or extract from request params.'
      );
    }
    _settings = new PlatformSettingsFacade({ db: getSharedDb(), environment: getEnvironment(), organizationId });
  }
  return _settings;
}
```

Calling `ctx.services.settings` without an org policy will throw. Use `policy:
{ requireOrgMembership: true }` to ensure `organizationId` is resolved.

---

## Adding a New Service

When a new domain joins the platform:

1. **Create the package** — `packages/<domain>/` with `"name": "@codex/<domain>"`
2. **Extend `BaseService`** — constructor takes `ServiceConfig`; do not add extra required
   params unless absolutely necessary
3. **Write the service class** — scoped reads, typed errors, `obs` logging
4. **Register in the registry** — add import, private `_instance` variable, lazy getter in
   `packages/worker-utils/src/procedure/service-registry.ts`
5. **Type the registry** — add the service to `ServiceRegistry` in
   `packages/worker-utils/src/procedure/types.ts`
6. **Add `CLAUDE.md`** — follow the template (purpose, exports, key patterns)
7. **Write tests** — see `09-testing-patterns.md`

The lazy getter follows this exact shape:

```typescript
get mythings() {
  if (!_mythings) {
    _mythings = new MyThingService({
      db: getSharedDb(),              // Shared WebSocket
      environment: getEnvironment(),
    });
  }
  return _mythings;
},
```

If the service depends on another (e.g. notifications uses templates):

```typescript
get notifications() {
  if (!_notifications) {
    _notifications = new NotificationsService({
      db: getSharedDb(),
      environment: getEnvironment(),
      templateService: this.templates,  // Composed, not new-d
    });
  }
  return _notifications;
}
```

---

## Method Shape Conventions

Read, list, create, update, delete — these methods have conventional shapes you
should preserve unless there's a strong reason not to.

### getById

```typescript
async getById(id: string, creatorId: string): Promise<Entity> {
  const item = await this.db.query.entity.findFirst({
    where: and(eq(schema.entity.id, id), scopedNotDeleted(schema.entity, creatorId))
  });
  if (!item) throw new NotFoundError('Entity not found', { id });
  return item;
}
```

### list

```typescript
async list(creatorId: string, query: ListQuery): Promise<{ items: Entity[]; pagination: Pagination }> {
  const { limit, offset } = withPagination(query);
  const items = await this.db.query.entity.findMany({
    where: scopedNotDeleted(schema.entity, creatorId),
    limit,
    offset,
    orderBy: [desc(schema.entity.createdAt)],
  });
  const [{ count }] = await this.db.select({ count: sql<number>`count(*)` })
    .from(schema.entity)
    .where(scopedNotDeleted(schema.entity, creatorId));
  return { items, pagination: { page: query.page, limit, total: count, totalPages: Math.ceil(count / limit) } };
}
```

### create

```typescript
async create(input: CreateInput, creatorId: string): Promise<Entity> {
  try {
    const [entity] = await this.db.insert(schema.entity).values({
      ...input,
      creatorId,
    }).returning();
    this.obs.info('Entity created', { entityId: entity.id, creatorId });
    return entity;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('Slug already exists', { slug: input.slug });
    }
    this.handleError(error, 'create');
  }
}
```

### update

```typescript
async update(id: string, creatorId: string, input: UpdateInput): Promise<Entity> {
  const existing = await this.getById(id, creatorId);  // throws 404 if gone or not owned
  const [updated] = await this.db.update(schema.entity)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(schema.entity.id, id), eq(schema.entity.creatorId, creatorId)))
    .returning();
  return updated;
}
```

### delete (soft)

```typescript
async delete(id: string, creatorId: string): Promise<void> {
  await this.getById(id, creatorId);  // 404 if gone or not owned
  await this.db.update(schema.entity)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.entity.id, id), eq(schema.entity.creatorId, creatorId)));
  this.obs.info('Entity deleted', { entityId: id, creatorId });
}
```

---

## Anti-Patterns

| Anti-pattern | Why it breaks | Fix |
|--------------|---------------|-----|
| `new ContentService({ db: createDbClient(env) })` in a route | No cleanup, connection leak | `ctx.services.content` |
| Re-running `schema.parse(input)` inside a service method | Procedure already validated at the edge — wastes CPU, hides source of truth, creates two schemas to keep in sync | Type input as `z.infer<typeof schema>` and trust it |

> **Exception: data from outside `procedure()`.** Webhook bodies, Stripe SDK callbacks, RunPod
> payloads, and anything else that arrives via a non-`procedure()` path have NOT been validated —
> the procedure pipeline didn't touch them. These MUST be Zod-validated at the handler (or at the
> top of the service method that receives them). The "don't re-parse" rule applies to data that
> already came through `procedure()` — not to external inputs.
| `throw new Error('not found')` | Becomes 500, not 404 | `throw new NotFoundError(...)` |
| `throw 'forbidden'` | No stack, no code, no status | Typed error subclass |
| `catch (err) { this.obs.error(err); return null }` | Silent failure | Re-throw via `handleError()` |
| Unscoped read (`where: eq(entity.id, id)`) | Cross-tenant data leak | `scopedNotDeleted(entity, creatorId)` |
| Service method returning raw Drizzle row with internal columns | Schema leaks to client | Select explicit columns or map |
| Hard delete (`db.delete(...)`) | Unrecoverable, breaks FK audit | `db.update(...).set({ deletedAt: new Date() })` |
| Transaction with try/catch inside | Prevents rollback | Let errors propagate |
| `console.log(...)` anywhere in a service | Unstructured, no PII redaction | `this.obs.info/warn/error(...)` |
| Storing `userEmail` in error context | PII in logs | Use `userId` only |

---

## Debugging Services

1. **`this.db` undefined?** — constructor didn't call `super(config)`.
2. **`this.obs` undefined?** — same.
3. **`NotFoundError` thrown for a row that exists?** — check scoping: wrong `creatorId`? soft-deleted? use a DB client directly to check.
4. **Transaction silently committed half?** — you caught an error inside `db.transaction()`. Remove the catch.
5. **Service not in registry?** — check `service-registry.ts` and `types.ts`. Both must be updated.
6. **ConflictError never thrown on duplicate?** — wrap the create in try/catch and use `isUniqueViolation(err)`.

---

## When to Re-Verify This Reference

Re-read this doc against current code if you see changes in:

- `packages/service-errors/src/base-service.ts` (the class)
- `packages/service-errors/src/base-errors.ts` (error subclasses)
- `packages/worker-utils/src/procedure/service-registry.ts` (lifecycle)
- `packages/worker-utils/src/procedure/types.ts` (registry type)
- Any `packages/*/CLAUDE.md` that adds a new service
