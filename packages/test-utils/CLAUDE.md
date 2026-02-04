# @codex/test-utils

Integration testing helpers.

## API
- **DB Setup**: `setupTestDatabase()`, `teardownTestDatabase()`.
- **Factories**: `createTestUser` (creates DB user+session), `createTestContent`, `createTestOrg`.
- **Context**: `createServiceTestContext` (DB + Service + Users).
- **Assertions**: `expectContentEqual`, `expectDraft`, `expectContentServiceError`.
- **Cleanup**: `cleanupDatabase()` (keeps users), `cleanupTables()`.

## Pattern
```ts
const { service, creatorId } = createServiceTestContext(
  db => new MyService({ db, ... })
)();

await service.create(..., creatorId);
```
**Strategy**: CI uses 1 Neon branch per test domain. Local uses shared DB.

## Standards
- **Assert**: Use `invariant()` for internal consistency.
- **Types**: Strict TS. Single Source of Truth.
- **Pure**: No side-effects or business logic.
