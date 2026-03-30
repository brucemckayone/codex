# @codex/test-utils

Integration testing helpers: database setup, test factories, and assertion utilities.

## API

| Export | Purpose |
|---|---|
| `setupTestDatabase()` | Creates `dbWs` connection for tests (supports transactions) |
| `teardownTestDatabase(db)` | Closes connection |
| `seedTestUsers(db, count)` | Create test users with sessions |
| `createTestContent(db, creatorId, overrides?)` | Create content with media |
| `createTestOrg(db, creatorId, overrides?)` | Create organization |
| `createUniqueSlug(prefix?)` | Timestamp-based unique slug |
| `createServiceTestContext(db)` | Returns `{ db, environment }` for service constructors |
| `cleanupDatabase(db)` | Removes test data (keeps users) |
| `cleanupTables(db, ...tables)` | Targeted table cleanup |

## Assertion Helpers

| Export | Purpose |
|---|---|
| `expectContentEqual(actual, expected)` | Deep content comparison |
| `expectDraft(content)` | Assert content is in draft state |
| `expectContentServiceError(fn, errorType)` | Assert service throws specific error |

## Testing Patterns

### Integration Test Setup
```ts
import { setupTestDatabase, teardownTestDatabase, seedTestUsers } from '@codex/test-utils';

let db: ReturnType<typeof setupTestDatabase>;
let testUser: TestUser;

beforeAll(async () => {
  db = await setupTestDatabase();     // Returns dbWs (WebSocket, supports transactions)
  [testUser] = await seedTestUsers(db, 1);
});

afterAll(async () => {
  await teardownTestDatabase(db);
});
```

### Service Test Pattern
```ts
test('creates content', async () => {
  const service = new ContentService(createServiceTestContext(db));
  const result = await service.create(input, testUser.id);
  expect(result).toBeDefined();
  expect(result.creatorId).toBe(testUser.id);  // Always verify scoping
});
```

### Test Isolation

| Environment | Strategy | Notes |
|---|---|---|
| **CI** | `withNeonTestBranch()` — ephemeral Neon branch per workflow | Fully isolated, auto-deleted |
| **Local** | Shared DB via `LOCAL_PROXY=true` (WebSocket) | Use `createUniqueSlug()` to avoid conflicts |

- **No cleanup between tests** within a file — each file gets a fresh context
- Use `createUniqueSlug()` for slug fields to avoid unique constraint violations
- All factories create properly scoped data (creatorId, orgId attached)

### Common Patterns

**Unique constraints**:
```ts
const slug = createUniqueSlug('test-content');  // e.g., 'test-content-1709312456789'
```

**Verifying scoping** (ALWAYS do this in tests):
```ts
// Verify user A can't see user B's content
const otherUser = (await seedTestUsers(db, 1))[0];
await expect(service.get(contentId, otherUser.id)).rejects.toThrow(NotFoundError);
```

## Strict Rules

- **MUST** use `setupTestDatabase()` / `teardownTestDatabase()` — NEVER create DB connections manually in tests
- **MUST** use `createUniqueSlug()` for any field with a unique constraint — prevents flaky tests
- **MUST** verify scoping in tests — test that user A cannot access user B's data
- **MUST** use `dbWs` (WebSocket) for test databases — only WebSocket supports transactions
- **NEVER** use `dbHttp` in tests — it doesn't support transactions and can't be cleaned up properly
- **NEVER** use raw SQL inserts for test data — use factories (`seedTestUsers`, `createTestContent`)

## Integration

- **Depends on**: `@codex/database`
- **Used by**: All service package test suites

## Reference Tests

- `packages/organization/src/services/__tests__/organization-service.test.ts` — exemplary service test
- `packages/content/src/__tests__/integration.test.ts` — integration test example
