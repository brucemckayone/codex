# Service Layer Reviewer

## Domain
All service packages in `packages/*/src/services/` — business logic, error handling, data scoping, dependency injection, code duplication.

## File Patterns
- `packages/*/src/services/**/*.ts`
- `packages/*/src/errors.ts`
- `packages/*/src/index.ts` (barrel exports)

## Checklist

### BaseService Compliance
- [CRITICAL] All services extend `BaseService` — no manual DI
- [CRITICAL] Error handling uses `this.handleError()` — not `wrapError()` with manual `instanceof` chains
- [CRITICAL] No raw `throw new Error(...)` — must use typed `ServiceError` subclasses
- [WARN] Constructor DI pattern is consistent (extended config interface preferred)
- [WARN] No `setCache()` mutations — cache should be constructor dependency

### Data Scoping
- [CRITICAL] Every query uses `scopedNotDeleted(table, creatorId)` or `withCreatorScope()`
- [CRITICAL] No post-fetch ownership checks — scope in the WHERE clause
- [CRITICAL] Soft deletes only — no `db.delete()` in production code
- [WARN] Admin queries scoped by `organizationId`
- [INFO] Public queries (org lookup) documented as intentionally unscoped

### Transaction Safety
- [CRITICAL] Multi-step mutations use `db.transaction()`
- [CRITICAL] Transactions use `dbWs` (WebSocket), not `dbHttp`
- [CRITICAL] No catch-inside-transaction that causes partial commits
- [WARN] Idempotency checks + inserts in same transaction (TOCTOU prevention)
- [WARN] External API calls (Stripe) NOT inside transaction locks

### Return Type Consistency
- [CRITICAL] Paginated lists return `PaginatedListResponse<T>` from `@codex/shared-types`
- [CRITICAL] Single items return `T | null` (optional) or `T` (required, throws NotFoundError)
- [WARN] Count queries run in parallel via `Promise.all([items, count])`
- [WARN] `withPagination()` helper used for offset calculation

### Code Duplication
- [WARN] Paginated list boilerplate — count how many near-identical implementations exist
- [WARN] Error re-throw patterns — count manual `instanceof` chains
- [WARN] Scope-duplicated CRUD (e.g., 3x list for global/org/creator)
- [INFO] Helper extraction candidates (last-owner guard, username check, etc.)

### Service-to-Service Communication
- [CRITICAL] No circular dependencies
- [WARN] No ad-hoc service instantiation inside methods — use constructor injection
- [WARN] Service registry creates shared instances — no duplicate Stripe/DB clients

## Output Requirements
- Review ALL service packages (content, organization, identity, access, purchase, notifications, admin, transcoding, subscription)
- Report LOC per service, constructor DI pattern used, error handling approach
- Include code duplication matrix
- Include test coverage assessment per service
