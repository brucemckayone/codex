# @codex/test-utils

Integration testing helpers: database setup, entity factories, mock factories, Stripe event factories, and subscription factories. Used by all service package test suites.

## Key Exports by Module

### `database.ts` — DB Setup

| Export | Purpose |
|---|---|
| `setupTestDatabase()` | Returns the shared `dbWs` (WebSocket) client — supports transactions |
| `teardownTestDatabase()` | Closes the DB pool so the test process exits cleanly |
| `seedTestUsers(db, count)` | Creates N users, returns array of user IDs |
| `cleanupDatabase(db)` | Deletes content/media/org/membership rows — KEEPS users |
| `cleanupDatabaseComplete(db)` | Deletes everything including users |
| `cleanupTables(db, tables)` | Delete specific tables (`'content' \| 'mediaItems' \| 'organizations' \| 'users'`) |
| `validateDatabaseConnection(db, retries?, delayMs?)` | Checks DB is reachable (useful in CI) |
| `withTransaction(db, testFn)` | Wraps test in a transaction — auto-rollback on throw |
| `executeRawSQL(db, query)` | Run raw SQL for complex test setup |
| `withNeonTestBranch()` | DEPRECATED no-op — Neon branching is now at workflow level |
| `type Database` | Re-export of `DatabaseWs` type |

### `factories.ts` — Entity Factories

Factories come in two flavours: `Input` (for DB insert, `New*` types) and plain (mock entity with ID + timestamps).

| Export | Signature | Notes |
|---|---|---|
| `createUniqueSlug(prefix?)` | `() => string` | Timestamp + random suffix; use for all unique-constrained fields |
| `createTestOrganizationInput(overrides?)` | `NewOrganization` | For `db.insert()` |
| `createTestOrganization(overrides?)` | `Organization` | Mock entity with id + timestamps |
| `createTestMembershipInput(orgId, userId, overrides?)` | `NewOrganizationMembership` | Default role: `'member'`, status: `'active'` |
| `createTestMediaItemInput(creatorId, overrides?)` | `NewMediaItem` | Sets ready-state fields automatically when `status: 'ready'` |
| `createTestMediaItem(overrides?)` | `MediaItem` | Default: VIDEO, READY status, 1920×1080 |
| `createTestContentInput(creatorId, overrides?)` | `NewContent` | Default: VIDEO, DRAFT, FREE access |
| `createTestContent(overrides?)` | `Content` | Mock entity |
| `createTestContentWorkflow(options?)` | `{ creatorId, organization?, mediaItem, content }` | Full workflow: org + media + content |
| `createTestUserId()` | `string` | UUID |
| `createTestOrganizations(count, overrides?)` | `Organization[]` | Batch |
| `createTestMediaItems(count, overrides?)` | `MediaItem[]` | Batch |
| `createTestContentItems(count, overrides?)` | `Content[]` | Batch |

Auth factories:

| Export | Purpose |
|---|---|
| `createMockUser(overrides?)` | `MockUserData` — for auth testing |
| `createMockSession(userId?, overrides?)` | `MockSessionData` — 24h expiry |
| `createMockCachedSession(overrides?)` | `{ session, user }` — KV session format |

Stripe event factories:

| Export | Purpose |
|---|---|
| `createMockStripeCheckoutEvent(options?)` | `checkout.session.completed` event payload |
| `createMockStripePaymentIntentEvent(options?)` | `payment_intent.succeeded` event payload |

### `subscription-factories.ts` — Subscription Entities

| Export | Purpose |
|---|---|
| `createTestTierInput(orgId, overrides?)` | `NewSubscriptionTier` — with Stripe product/price IDs |
| `createTestSubscriptionInput(userId, orgId, tierId, overrides?)` | `NewSubscription` |
| `createTestConnectAccountInput(...)` | `NewStripeConnectAccount` |

### `mocks.ts` — Unit Test Mocks

| Export | Purpose |
|---|---|
| `createMockObservability()` | Returns `{ obs: MockObservability, logs: MockLogEntry[] }` |
| `createMockHonoContext(options?)` | Hono `Context` mock with spied methods |
| `createMockKV()` | In-memory KV mock |
| `createMockR2()` | R2 bucket mock |
| `createMockDb()` | Drizzle DB mock |

### `stripe-mock.ts` — Stripe Client Mock

| Export | Purpose |
|---|---|
| `createMockStripe()` | Returns a `Stripe`-shaped mock with vi.fn() methods |

## Integration Test Pattern

```ts
import { setupTestDatabase, teardownTestDatabase, seedTestUsers, createTestContentInput } from '@codex/test-utils';
import * as schema from '@codex/database/schema';

let db: Database;
let userId: string;

beforeAll(async () => {
  db = setupTestDatabase();           // shared dbWs — supports transactions
  [userId] = await seedTestUsers(db, 1);
});

afterAll(async () => {
  await cleanupDatabase(db);          // leaves users for reuse
  await teardownTestDatabase();       // closes pool
});

test('creates content', async () => {
  const service = new ContentService({ db, environment: 'test' });
  const input = createTestContentInput(userId, { title: 'Test Video' });
  const [row] = await db.insert(schema.content).values(input).returning();
  const result = await service.getById(row.id, userId);
  expect(result.creatorId).toBe(userId); // ALWAYS verify scoping
});
```

## CI vs Local

| Environment | DB | Notes |
|---|---|---|
| **Local** | `DATABASE_URL` from `.env.test`, `DB_METHOD=LOCAL_PROXY` | Shared DB, use `createUniqueSlug()` to avoid conflicts |
| **CI** | Workflow-created Neon branch per domain | `DATABASE_URL` injected by GitHub Actions; branch deleted after run |

`withNeonTestBranch()` is a deprecated no-op — remove calls to it.

## Strict Rules

- **MUST** use `setupTestDatabase()` / `teardownTestDatabase()` — NEVER create DB connections manually
- **MUST** use `createUniqueSlug()` for any field with a unique constraint
- **MUST** verify scoping in tests: confirm user A cannot access user B's data
- **MUST** use `dbWs` (WebSocket) — `dbHttp` does not support transactions
- **NEVER** hard-code test data strings that could collide (email, slug, name)
- **NEVER** use raw SQL inserts for test data — use factories

## Reference Tests

- `packages/organization/src/services/__tests__/organization-service.test.ts`
- `packages/content/src/__tests__/integration.test.ts`
