---
name: database-patterns
description: >
  Deep reference for Drizzle ORM usage in Codex — HTTP vs WebSocket clients, scoping
  helpers, soft deletes, pagination, unique constraint handling, and migrations.
type: reference
---

# Database Patterns

Codex uses Drizzle ORM against Neon PostgreSQL. The patterns here enforce two things
above all: **data isolation** (scoping) and **data integrity** (soft deletes, transactions).

Reference implementations:
- `packages/database/CLAUDE.md` — authoritative rules
- `packages/database/src/utils/query-helpers.ts` — scoping helpers
- `packages/database/src/client.ts` — client factories
- `packages/database/src/schema/` — all table definitions

---

## Two Clients, Two Transports

Codex has two database clients because Neon exposes two protocols:

| Client | Transport | Stateful? | Transactions | Use in Workers |
|--------|-----------|-----------|--------------|----------------|
| `dbHttp` | HTTP | No | No | Module-level tests only |
| `dbWs` | WebSocket | Yes | Yes | Module-level tests only |
| `createDbClient(env)` | HTTP | No | No | Per-request reads |
| `createPerRequestDbClient(env)` | WebSocket | Yes | Yes | Per-request transactions |

**The rule:** in a worker, never use the module-level singletons (`dbHttp`, `dbWs`).
They don't see the runtime `env` bindings. Always use the factories that take `env`.

**Why WebSocket for transactions:** an HTTP request per statement cannot hold a
transaction session on Neon's side. The WebSocket stays open for the transaction's
lifetime, then closes.

### Service lifecycle (what `procedure()` does for you)

```typescript
// Inside procedure() — you do NOT write this yourself
const { db, cleanup } = createPerRequestDbClient(env);
// ... run handler with services that share this db ...
executionCtx.waitUntil(cleanup());  // Closes the WebSocket
```

The service registry (see `02-service-layer.md`) gives every service the *same*
`db` instance via `getSharedDb()`. That's why multiple services can take part in
one transaction — they share the connection.

---

## Scoping — The Single Biggest Rule

Every query against tenant data must include a scope filter. There is no
"admin mode" that bypasses this at the service layer. Admin endpoints that need
cross-tenant reads use explicit queries in the admin service, not scope bypasses.

### The helpers

```typescript
// Soft-delete filter alone
whereNotDeleted(table)
  // → isNull(table.deletedAt)

// Creator scope alone
withCreatorScope(table, creatorId)
  // → eq(table.creatorId, creatorId)

// Org scope alone
withOrgScope(table, orgId)
  // → eq(table.organizationId, orgId)

// Combined — these are the ones you'll use most
scopedNotDeleted(table, creatorId)
  // → and(eq(creatorId, ...), isNull(deletedAt))

orgScopedNotDeleted(table, orgId)
  // → and(eq(organizationId, ...), isNull(deletedAt))
```

### Canonical read pattern

```typescript
const item = await this.db.query.content.findFirst({
  where: and(
    eq(schema.content.id, id),
    scopedNotDeleted(schema.content, creatorId)
  ),
});
if (!item) throw new NotFoundError('Content not found', { contentId: id });
```

Two filters, one helper. If the row exists but belongs to a different creator,
the `findFirst` returns undefined — user gets a 404, not a 403. This is intentional:
404 leaks less information than 403. Don't "improve" it to a 403.

### When to use which helper

| Scenario | Helper |
|----------|--------|
| User-owned resource (content, media, profile) | `scopedNotDeleted` |
| Org-owned resource (tiers, branding, members) | `orgScopedNotDeleted` |
| Public endpoint returning published content | `orgScopedNotDeleted` + `eq(status, 'published')` + `lte(publishedAt, now())` |
| Cross-tenant admin query | Explicit query, with `platform_owner` policy upstream |

---

## Soft Delete Convention

Every table that stores user/org data has a `deletedAt timestamptz` column.

```typescript
// Delete
await this.db.update(schema.content)
  .set({ deletedAt: new Date(), updatedAt: new Date() })
  .where(and(
    eq(schema.content.id, id),
    withCreatorScope(schema.content, creatorId),  // Still scoped!
  ));

// Read — always filter deleted
where: scopedNotDeleted(schema.content, creatorId)
```

**Never** use `db.delete(...)` on user-owned tables. It hard-deletes rows, breaks
FK audit chains, and makes recovery impossible.

Exceptions (hard delete OK):
- Test cleanup (`@codex/test-utils` helpers)
- Truly transient tables (rate-limit KV entries, session tokens expired by DB hook)
- Housekeeping jobs explicitly designed for purging (orphaned file reconciliation)

---

## Pagination

```typescript
import { withPagination } from '@codex/database';

const { limit, offset } = withPagination({ page, limit });
// Pages are 1-indexed: page=1, limit=20 → offset=0
// page=2, limit=20 → offset=20
```

Always pair the query with a count for `pagination.total`:

```typescript
const [items, countResult] = await Promise.all([
  this.db.query.content.findMany({
    where: scopedNotDeleted(schema.content, creatorId),
    limit,
    offset,
    orderBy: [desc(schema.content.createdAt)],
  }),
  this.db.select({ count: sql<number>`count(*)` })
    .from(schema.content)
    .where(scopedNotDeleted(schema.content, creatorId)),
]);

const total = Number(countResult[0].count);
return {
  items,
  pagination: {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  },
};
```

The route handler wraps this in `new PaginatedResult(items, pagination)` (see
`01-procedure-patterns.md`).

---

## Transactions

```typescript
return await this.db.transaction(async (tx) => {
  const [org] = await tx.insert(schema.organizations).values(...).returning();
  await tx.insert(schema.organizationMemberships).values({
    organizationId: org.id,
    userId,
    role: 'owner',
  });
  return org;
});
```

**Invariants:**

- `this.db` must be the `dbWs` / per-request WS client — transactions cannot run on HTTP.
- Use `tx` inside the callback, not `this.db`. The outer connection doesn't know about the transaction.
- Throwing anywhere inside rolls back.
- Never catch inside the callback unless you want partial commit.
- Catching the *outer* error (after `await this.db.transaction(...)`) is fine — the transaction has already rolled back before your catch runs.

**Canonical unique-violation pattern:**

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

## Postgres Error Detection

Drizzle surfaces `postgres` driver errors with their native codes. Use the helpers
from `@codex/database`:

| Helper | Postgres code | Typical mapping |
|--------|---------------|-----------------|
| `isUniqueViolation(err)` | 23505 | `ConflictError` |
| `isForeignKeyViolation(err)` | 23503 | Usually a bug — wrap as `BusinessLogicError` |
| `isNotNullViolation(err)` | 23502 | Usually a bug — wrap as `InternalServiceError` via `handleError()` |
| `getConstraintName(err)` | — | Useful for distinguishing multiple unique constraints on one table |

```typescript
catch (error) {
  if (isUniqueViolation(error)) {
    const constraint = getConstraintName(error);
    if (constraint === 'organizations_slug_unique') {
      throw new ConflictError('Slug already exists', { slug: input.slug });
    }
    if (constraint === 'organizations_name_unique') {
      throw new ConflictError('Name already exists', { name: input.name });
    }
  }
  this.handleError(error, 'create');
}
```

---

## Query Patterns

### Single row with relations

```typescript
const org = await this.db.query.organizations.findFirst({
  where: and(eq(schema.organizations.id, id), whereNotDeleted(schema.organizations)),
  with: {
    memberships: true,
    settings: true,
  },
});
```

### List with filters

```typescript
const conditions: SQL[] = [
  scopedNotDeleted(schema.content, creatorId),
  eq(schema.content.status, 'published'),
];
if (query.search) {
  conditions.push(ilike(schema.content.title, `%${query.search}%`));
}
if (query.contentType) {
  conditions.push(eq(schema.content.contentType, query.contentType));
}

const items = await this.db.query.content.findMany({
  where: and(...conditions),
  limit,
  offset,
  orderBy: [desc(schema.content.publishedAt)],
});
```

### Upsert (PostgreSQL `ON CONFLICT`)

```typescript
await this.db.insert(schema.videoPlayback).values({
  userId,
  contentId,
  positionSeconds,
  durationSeconds,
  updatedAt: new Date(),
}).onConflictDoUpdate({
  target: [schema.videoPlayback.userId, schema.videoPlayback.contentId],
  set: {
    positionSeconds,
    durationSeconds,
    updatedAt: new Date(),
  },
});
```

### Atomic state-guarded update (race-free transitions)

For state transitions driven by webhooks or concurrent callers, put the expected
state in the WHERE clause — not in an earlier SELECT. Detect no-op via
`.returning().length`:

```typescript
const updated = await this.db
  .update(schema.mediaItems)
  .set({ status: 'ready', updatedAt: new Date() })
  .where(and(
    eq(schema.mediaItems.id, mediaId),
    eq(schema.mediaItems.status, 'transcoding'),  // state check in WHERE
    isNull(schema.mediaItems.deletedAt),          // soft-delete guard on writes
  ))
  .returning();

if (updated.length === 0) {
  // Row either doesn't exist, was already moved to 'ready', or was deleted.
  // Webhook redelivery — return success, don't throw.
  return { alreadyTransitioned: true };
}
```

The race this avoids: two concurrent webhook deliveries both SELECT `status =
'transcoding'`, both decide to update, both write `status = 'ready'`. Harmless
here, but if the UPDATE has side-effects (insert into audit log, invalidate
cache), you'd double-do them.

Reference implementation: `packages/transcoding/src/services/transcoding-service.ts:369-411`.

### Atomic count increment

```typescript
await this.db.update(schema.content)
  .set({
    viewCount: sql`${schema.content.viewCount} + 1`,
    updatedAt: new Date(),
  })
  .where(eq(schema.content.id, id));
```

---

## Migrations

Drizzle owns the migration snapshot-plus-SQL pair. Never hand-write migration SQL.

| Command | What |
|---------|------|
| `pnpm db:generate` | Diff schema → create new migration |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:studio` | Drizzle Studio (local dev) |

Migrations live at `packages/database/src/migrations/`. Every migration is a
`.sql` file plus a snapshot `.json` — both must be committed together.

**Migration review checklist:**

1. Generated SQL looks reasonable (no drops you didn't ask for)
2. Column additions are `NULLABLE` or have a default — non-null additions break prod
3. Indexes match production query patterns
4. No `DROP CONSTRAINT` without a plan to handle existing violations
5. Added columns: backfill plan if needed

---

## Anti-Patterns

| Anti-pattern | Why it breaks | Fix |
|--------------|---------------|-----|
| `where: eq(entity.id, id)` | Cross-tenant data leak | `scopedNotDeleted(entity, creatorId)` |
| `db.delete(...)` on user data | Audit trail lost, unrecoverable | `db.update().set({ deletedAt: new Date() })` |
| Hand-written SQL in migrations | Schema drift, snapshot becomes a lie | `pnpm db:generate` |
| Module-level `dbHttp`/`dbWs` in a worker | No runtime env bindings | `createDbClient(env)` / `createPerRequestDbClient(env)` |
| Missing `cleanup()` after `createPerRequestDbClient` | Connection leak; worker crashes | `ctx.executionCtx.waitUntil(cleanup())` |
| `try { ... } catch { rollback }` inside transaction | Prevents auto-rollback | Let errors propagate |
| `try { ... } catch (err) { throw err }` | Pointless; loses stack | Remove the try/catch |
| Using `tx` as `this.db.transaction((tx) => this.db.someOperation(...))` | Not in transaction | `tx.someOperation(...)` — use the tx, not `this.db` |
| Unbounded `.findMany()` on user-facing lists | Can return 10k+ rows, blows memory | Always use `limit`/`offset` |
| Forgetting `orderBy` on paginated lists | Non-deterministic pagination (page 2 can duplicate page 1) | Always order by a stable column, usually `createdAt DESC` |
| Counting with `.findMany().length` | Full table scan | `select({ count: sql<number>`count(*)` })` |
| Using `new Date().toISOString()` in column values | Drizzle accepts `Date` directly for timestamptz | Pass the `Date` object |
| `update(table).where(eq(id, x))` on a soft-deletable row | Mutates deleted rows; breaks soft-delete invariants | Always include `isNull(table.deletedAt)` in the WHERE of updates too |
| `SELECT`-then-`UPDATE` for state transitions | TOCTOU race between concurrent webhooks | Put state check in UPDATE's WHERE; use `.returning()` length to detect no-op |

---

## Debugging Queries

1. **Query returns nothing but row exists?** — scope is filtering it out. Check `creatorId`, `organizationId`, and `deletedAt`.
2. **Transaction committed half?** — you caught inside. Remove the catch.
3. **`isUniqueViolation` never true?** — check the error is the raw driver error, not a wrapped `InternalServiceError`. The helper unwraps Drizzle's `cause`, but if it's been through `handleError()` first, it's too late.
4. **Count doesn't match items?** — conditions drift between the two queries. Factor them into a shared array or use the same `where:` reference.
5. **Worker crashes with `Cannot access WebSocket after close`** — missing `cleanup()` or cleanup ran before a slow service call. Wrap in `waitUntil`.

---

## When to Re-Verify This Reference

Re-read this doc against current code if you see changes in:

- `packages/database/src/utils/query-helpers.ts` (scoping helpers)
- `packages/database/src/client.ts` (client factories)
- `packages/database/src/utils/db-errors.ts` (postgres code detection)
- Any new helper added to `packages/database/CLAUDE.md`
