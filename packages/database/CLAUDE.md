# @codex/database

Drizzle ORM + Neon PostgreSQL access layer.

## Clients

| Client | Transport | Use Case | Transactions |
|---|---|---|---|
| **`dbHttp`** | HTTP (stateless) | Module-level singleton for simple queries | No |
| **`dbWs`** | WebSocket (stateful) | Module-level singleton for transactions (tests/dev) | Yes |
| **`createDbClient(env)`** | HTTP | Per-request HTTP client (inject env at runtime) | No |
| **`createPerRequestDbClient(env)`** | WebSocket | Per-request WS client with `cleanup()` — required in Workers | Yes |

**In Cloudflare Workers**: always use `createDbClient(env)` for HTTP or `createPerRequestDbClient(env)` for transactions — the module-level singletons don't have access to runtime env bindings.

```ts
// Simple query in a Worker
const db = createDbClient(c.env);
const items = await db.query.content.findMany({ where: scopedNotDeleted(schema.content, userId) });

// Transaction in a Worker
const { db, cleanup } = createPerRequestDbClient(c.env);
await db.transaction(async (tx) => {
  const [item] = await tx.insert(schema.content).values(data).returning();
  await tx.insert(schema.mediaItems).values({ contentId: item.id });
});
ctx.waitUntil(cleanup()); // MUST close pool — use waitUntil so it runs after response
```

## Schema (Key Tables)

| Domain | Tables |
|---|---|
| **Auth** | `sessions`, `accounts`, `verificationTokens` |
| **Users** | `users` |
| **Organization** | `organizations`, `organizationMemberships` |
| **Content** | `content`, `mediaItems` |
| **Ecommerce** | `purchases`, `contentAccess`, `platformFeeConfig` |
| **Playback** | `videoPlayback` |
| **Notifications** | `emailAuditLogs` |
| **Settings** | `platformSettings` (branding, features, contact) |
| **Storage** | orphaned entity/image tracking |
| **Subscriptions** | `subscriptions`, `subscriptionPlans` |
| **Followers** | `followers` |

Import: `import * as schema from '@codex/database'` (re-exported as namespace).

## Query Helpers

Import from `@codex/database` (re-exported from `utils`):

| Helper | Signature | Purpose |
|---|---|---|
| `whereNotDeleted(table)` | `(T) → SQL` | Soft delete filter: `isNull(table.deletedAt)` |
| `withCreatorScope(table, creatorId)` | `(T, string) → SQL` | Creator ownership: `eq(table.creatorId, id)` |
| `withOrgScope(table, orgId)` | `(T, string) → SQL` | Org isolation: `eq(table.organizationId, id)` |
| `scopedNotDeleted(table, creatorId)` | `(T, string) → SQL` | `whereNotDeleted` + `withCreatorScope` combined |
| `orgScopedNotDeleted(table, orgId)` | `(T, string) → SQL` | `whereNotDeleted` + `withOrgScope` combined |
| `withPagination({ page, limit })` | `({page,limit}) → {limit,offset}` | Page → offset conversion (1-indexed pages) |
| `isUniqueViolation(error)` | `(unknown) → boolean` | Detects Postgres 23505 (also unwraps Drizzle cause) |
| `isForeignKeyViolation(error)` | `(unknown) → boolean` | Detects Postgres 23503 |
| `isNotNullViolation(error)` | `(unknown) → boolean` | Detects Postgres 23502 |
| `getConstraintName(error)` | `(unknown) → string\|null` | Extracts constraint name from Postgres error |

Drizzle operators (`and`, `eq`, `or`, `desc`, `asc`, `count`, `sql`, etc.) are also re-exported directly from `@codex/database`.

```ts
// Most common pattern: fetch one item scoped to creator
const item = await db.query.content.findFirst({
  where: and(
    eq(schema.content.id, id),
    scopedNotDeleted(schema.content, creatorId)
  )
});
if (!item) throw new NotFoundError('Content not found', { contentId: id });

// Org-scoped public query
const items = await db.query.content.findMany({
  where: orgScopedNotDeleted(schema.content, orgId),
  ...withPagination({ page, limit }),
  orderBy: [desc(schema.content.publishedAt)]
});
```

## Strict Rules

### Security Scoping (MANDATORY)
- **MUST** scope EVERY query with `scopedNotDeleted` or `orgScopedNotDeleted` — querying by ID alone is a data exposure vulnerability
- **NEVER** use bare `eq(table.id, id)` without a creator/org scope filter

### Soft Deletes
- **MUST** delete by setting `deletedAt: new Date()` via `db.update().set({ deletedAt: new Date() })`
- **NEVER** use `db.delete()` — hard deletes break audit trails

### Transactions
- **MUST** use `createPerRequestDbClient(env)` (not `dbWs`) in Cloudflare Workers for transactions
- **MUST** call `cleanup()` after every `createPerRequestDbClient` usage — use `ctx.waitUntil(cleanup())`
- **MUST** let errors propagate inside transactions for auto-rollback — NEVER catch inside unless you want partial commit
- `dbWs` (module-level) is for tests only

## Type Exports

```ts
import type { Database, DatabaseWs } from '@codex/database';
// Database = HTTP client type (for service constructors)
// DatabaseWs = WS client type
```

## Migrations

- Generate: `pnpm db:generate`
- Apply: `pnpm db:migrate`
- Files: `packages/database/src/migrations/`

## Reference Files

- `packages/database/src/schema/` — all table definitions
- `packages/database/src/utils/query-helpers.ts` — `scopedNotDeleted`, `withPagination`, etc.
- `packages/database/src/utils/db-errors.ts` — `isUniqueViolation`, `isForeignKeyViolation`
- `packages/database/src/client.ts` — client factories and exports
