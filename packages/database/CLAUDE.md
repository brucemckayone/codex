# @codex/database

Drizzle ORM + Neon PostgreSQL access layer.

## Clients

| Client | Transport | Use Case | Transactions |
|---|---|---|---|
| **`dbHttp`** | HTTP (stateless) | Production workers, simple queries | No |
| **`dbWs`** | WebSocket (stateful) | Tests, dev, multi-step mutations | Yes |

**Factories:**
- `createDbClient(env)` → HTTP client for production
- `createPerRequestDbClient(env)` → WebSocket client with cleanup (for transactions)

## Schema (Key Tables)

| Domain | Tables |
|---|---|
| **Identity** | `users`, `sessions`, `accounts`, `verificationTokens` |
| **Organization** | `organizations`, `organizationMemberships` |
| **Content** | `content`, `mediaItems` |
| **Ecommerce** | `purchases`, `contentAccess` (entitlements), `platformFeeConfig` |
| **Tracking** | `videoPlayback`, `emailAuditLogs` |

## Query Helpers

| Helper | Purpose | Usage |
|---|---|---|
| `whereNotDeleted(table)` | Soft delete filter | `where: whereNotDeleted(content)` |
| `withCreatorScope(table, creatorId)` | Creator ownership filter | `where: withCreatorScope(content, userId)` |
| `scopedNotDeleted(table, creatorId)` | Combined scope + soft delete (most common) | `where: scopedNotDeleted(content, userId)` |
| `withPagination({ page, limit })` | Page → offset conversion | Returns `{ limit, offset }` |

**Error Detection:**
- `isUniqueViolation(error)` → detects duplicate key errors (use for slug conflicts, etc.)
- `isForeignKeyViolation(error)` → detects FK constraint failures

## Usage

```ts
// Production (HTTP, no transactions)
const db = createDbClient(env);
const items = await db.query.content.findMany({
  where: scopedNotDeleted(content, creatorId),
});

// Transactions (WebSocket only)
const db = createPerRequestDbClient(env);
await db.transaction(async (tx) => {
  const [item] = await tx.insert(content).values(data).returning();
  await tx.insert(mediaItems).values({ contentId: item.id, ... });
  // If any throw, both operations rollback
});
```

## Strict Rules

### Security Scoping (MANDATORY)

- **MUST** scope EVERY query with `scopedNotDeleted(table, creatorId)` or `withCreatorScope()` — unscoped queries are a data exposure vulnerability
- **NEVER** query by ID alone without a scoping filter

```ts
// WRONG — data exposure vulnerability
const item = await db.query.content.findFirst({
  where: eq(content.id, id)
});

// CORRECT — always scope
const item = await db.query.content.findFirst({
  where: and(
    eq(content.id, id),
    scopedNotDeleted(content, creatorId)
  )
});
```

### Soft Deletes

- **MUST** use `whereNotDeleted(table)` in all queries (or `scopedNotDeleted` which includes it)
- **MUST** delete by setting `deletedAt: new Date()` — NEVER hard-delete rows
- **NEVER** use `db.delete()` — use `db.update().set({ deletedAt: new Date() })`

### Transactions

- **MUST** use `db.transaction()` for multi-step mutations (create + update, state transitions)
- **MUST** use `dbWs` (WebSocket client) for transactions — `dbHttp` does NOT support them
- **MUST** let errors propagate inside transactions for auto-rollback — NEVER catch inside unless you want partial commit
- **DO NOT** use transactions for single-row inserts/updates or read-only queries

### Assertions

- **MUST** use `invariant()` for precondition checks and state validation in services
- Example: `invariant(media.status === 'ready', 'Media must be ready to publish')`

## Migrations

- Generate: `pnpm db:generate`
- Apply: `pnpm db:migrate`
- Migration files: `packages/database/src/migrations/`
- Journal: `packages/database/src/migrations/meta/_journal.json`

## Integration

- **Depends on**: Drizzle ORM, Neon serverless driver
- **Used by**: All service packages (`@codex/content`, `@codex/organization`, `@codex/purchase`, etc.)

## Reference Files

- `packages/database/src/schema/` — all table definitions
- `packages/database/src/utils/query-helpers.ts` — `scopedNotDeleted`, `whereNotDeleted`, `withPagination`
- `packages/database/src/index.ts` — client factories
