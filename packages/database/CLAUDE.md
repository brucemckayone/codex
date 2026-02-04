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

## Standards
- **Assert**: Use `invariant()` for internal consistency.
- **Types**: Strict TS. Single Source of Truth.
- **Pure**: No side-effects or business logic.
