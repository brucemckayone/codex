# Database & Data Layer Reviewer

## Domain
Database schema, Drizzle ORM queries, migrations, indexes, caching, client-side data layer (TanStack DB collections).

## File Patterns
- `packages/database/src/schema/**/*.ts`
- `packages/database/src/migrations/**/*.sql`
- `packages/database/src/migrations/meta/_journal.json`
- `packages/database/src/client.ts`
- `packages/cache/src/**/*.ts`
- `apps/web/src/lib/collections/**/*.ts`
- `apps/web/src/lib/remote/**/*.ts`
- All `*.service.ts` files (for query patterns)

## Checklist

### Schema Design
- [CRITICAL] All enum-like columns have CHECK constraints
- [CRITICAL] Financial columns use integer cents (not floats)
- [CRITICAL] Revenue split integrity constraints (sum = total)
- [WARN] All unique constraints exclude soft-deleted rows (`WHERE deleted_at IS NULL`)
- [WARN] FK `onDelete` actions match domain semantics (cascade for sessions, restrict for financial)
- [WARN] Timestamp columns use `{ withTimezone: true }`
- [INFO] Primary key type consistency (uuid vs text for auth tables)

### Query Patterns
- [CRITICAL] Every query scoped by creator/org/customer ID — no bare PK lookups with post-fetch auth
- [CRITICAL] Soft-delete filter on all queries (`isNull(deletedAt)` or `scopedNotDeleted()`)
- [WARN] LIKE/ILIKE patterns escape `%` and `_` wildcards
- [WARN] Paginated lists use `Promise.all([items, count])` — not sequential
- [WARN] `withPagination()` helper used for offset calculation
- [WARN] No N+1 queries in loops — batch with `inArray()`
- [INFO] Raw SQL uses schema references, not hardcoded table names

### Migration Quality
- [CRITICAL] No destructive migrations (DROP TABLE, DROP COLUMN, TRUNCATE, DELETE)
- [WARN] All migration files listed in Drizzle journal (`meta/_journal.json`)
- [WARN] No orphan migration files (on disk but not in journal)
- [WARN] Data migrations handle backfill correctly
- [INFO] Constraint correction chains documented

### Index Coverage
- [WARN] Composite indexes match common query patterns (customer+status, org+status)
- [WARN] Unique indexes used for invariant enforcement (one active subscription per user per org)
- [INFO] Low-cardinality columns use composite indexes, not standalone

### Transaction Safety
- [CRITICAL] Multi-step mutations in `db.transaction()` with `dbWs`
- [CRITICAL] No catch-inside-transaction that loses the rollback
- [WARN] Idempotency checks inside transactions (not check-then-insert with gap)
- [WARN] External API calls outside transactions to avoid holding locks

### Caching (`@codex/cache`)
- [WARN] `VersionedCache` gracefully degrades on KV errors
- [WARN] Cache invalidation after every DB write (fire-and-forget via `waitUntil`)
- [WARN] Cache type parameter used consistently
- [INFO] KV caching planned for settings facade

### Client-Side Data Layer (TanStack DB)
- [WARN] localStorage collections have `browser` guard
- [WARN] SSR-safe `useLiveQuery` wrapper returns static data on server
- [WARN] `loadFromServer()` reconciliation handles upsert + stale removal
- [WARN] Progress sync lifecycle: visibility, beforeunload, interval
- [INFO] `hydrateIfNeeded` no-op on return visits is documented/intentional

### Connection Management
- [WARN] Per-request pools created with explicit `max` (not default 10)
- [WARN] Shared WebSocket pool used across services (not duplicate pools)
- [WARN] All cleanup functions tracked and run via `waitUntil`

## Output Requirements
- Review all schema files, all 42+ migrations, the Drizzle journal
- Check every unique constraint for soft-delete exclusion
- Audit query patterns across ALL service packages
- Report on scoping compliance per service
- Report on transaction usage per service
- Include index coverage analysis for key query paths
