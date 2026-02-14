# @codex/database

Drizzle ORM + Neon PostgreSQL access.

## Clients
- **dbHttp**: Stateless (HTTP). For Production/Workers. No txns.
- **dbWs**: Stateful (WebSocket). For Tests/Dev. Supports txns.
- **Factory**: `createDbClient(env)` (HTTP), `createPerRequestDbClient(env)` (WS + cleanup).

## Schema (Key Tables)
- **Identity**: `users`, `sessions`, `accounts`, `verificationTokens`.
- **Org**: `organizations`, `organizationMemberships`.
- **Content**: `content`, `mediaItems`.
- **Ecom**: `purchases`, `contentAccess` (entitlements), `platformFeeConfig`.
- **Tracking**: `videoPlayback`, `emailAuditLogs`.

## Utilities
- **Query**: `whereNotDeleted()`, `scopedNotDeleted(table, creatorId)`, `withPagination()`.
- **Errors**: `isUniqueViolation()`, `isForeignKeyViolation()`.

## Usage
```ts
const db = createDbClient(env);
const users = await db.query.users.findMany(..);
// Txn (WS only)
await dbWs.transaction(async tx => { ... });
```

## Standards & Patterns

### When to Use Transactions
- **Use `db.transaction()`:** Multi-step mutations (create + update), state transitions, atomic operations
- **Don't use:** Single-row inserts/updates, read-only queries
- **Constraints:** Only `dbWs` supports transactions (WebSocket). `dbHttp` is stateless.
- **Reference:** `/packages/content/src/services/content-service.ts:117-160` (publish transaction)

### Security Scoping (MANDATORY)
- **ALWAYS filter by:** `creatorId` or `organizationId` on ALL queries
- **Use helpers:** `scopedNotDeleted(table, creatorId)` or `withCreatorScope(table, creatorId)`
- **Never:** Query by ID alone without scoping filter
- **Violation example:** `db.query.content.findFirst({ where: eq(content.id, id) })` ❌
- **Correct:** `db.query.content.findFirst({ where: and(eq(content.id, id), scopedNotDeleted(content, creatorId)) })` ✅

### Soft Deletes
- **Always:** Use `whereNotDeleted(table)` in queries
- **Delete:** Set `deletedAt: new Date()`, never physically remove
- **Combined:** `scopedNotDeleted(table, creatorId)` = scoping + soft delete filter

### Assertions
- **Use `invariant()`:** Precondition checks, state validation in services
- **Example:** `invariant(media.status === 'ready', 'Media must be ready to publish')`
- **Reference:** `/packages/content/src/services/content-service.ts` (search for invariant)
