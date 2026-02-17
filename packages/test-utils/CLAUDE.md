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

## Testing Workflows

### Integration Tests (Database Required)
1. Use `setupTestDatabase()` in `beforeAll()` → returns `dbWs` (supports transactions)
2. Use `teardownTestDatabase(db)` in `afterAll()`
3. **CI:** Tests run with `withNeonTestBranch()` (ephemeral Neon branch per workflow)
4. **Local:** Set `LOCAL_PROXY=true` to use WebSocket connection
5. **No cleanup between tests:** Fresh database per test file

### Service Tests
```ts
import { createServiceTestContext, seedTestUsers } from '@codex/test-utils';

beforeAll(async () => {
  db = await setupTestDatabase();
  [testUser] = await seedTestUsers(db, 1);
});

test('service method', async () => {
  const service = new ContentService(createServiceTestContext(db));
  const result = await service.create(input, testUser.id);
  expect(result).toBeDefined();
});
```

### Test Factories
- `seedTestUsers(db, count)` - Create test users with sessions
- `createTestContent(db, creatorId, overrides?)` - Content with media
- `createUniqueSlug(prefix?)` - Timestamp-based uniqueness

### Common Patterns
- **Unique constraints:** Use `createUniqueSlug()` to avoid conflicts
- **Scoping:** All factories create scoped data (creatorId, orgId)
- **Mocking:** Use factories for test data, not raw SQL inserts

### Reference Tests
- Service tests: `/packages/organization/src/services/__tests__/organization-service.test.ts`
- Integration tests: `/packages/content/src/__tests__/integration.test.ts`

## Standards
- **Assert**: Use `invariant()` for internal consistency.
- **Types**: Strict TS. Single Source of Truth.
- **Pure**: No side-effects or business logic.
