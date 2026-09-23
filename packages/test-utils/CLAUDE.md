# @codex/test-utils

Integration testing helpers: database setup, entity factories, mock factories, Stripe event factories, and subscription factories. Used by all service package test suites.

## Key Exports by Module

### `database.ts` — DB Setup

| Export | Purpose |
|---|---|
| `setupTestDatabase()` | Returns the shared `dbWs` (WebSocket) client — supports transactions |
| `teardownTestDatabase()` | Closes the DB pool so the test process exits cleanly |
| `seedTestUsers(db, count)` | Creates N users. Returns a **tuple** for a literal `count` of 1-7, `string[]` otherwise — see below |
| `cleanupDatabase(db)` | Deletes content/media/org/membership rows — KEEPS users |
| `cleanupDatabaseComplete(db)` | Deletes everything including users |
| `cleanupTables(db, tables)` | Delete specific tables (`'content' \| 'mediaItems' \| 'organizations' \| 'users'`) |
| `validateDatabaseConnection(db, retries?, delayMs?)` | Checks DB is reachable (useful in CI) |
| `withTransaction(db, testFn)` | Wraps test in a transaction — auto-rollback on throw |
| `executeRawSQL(db, query)` | Run raw SQL for complex test setup |
| `type Database` | Re-export of `DatabaseWs` type |

#### `seedTestUsers` returns a TUPLE for literal counts (Codex-gghrn)

`noUncheckedIndexedAccess` is on, so destructuring a `string[]` gives
`string | undefined` — which then poisons every fixture built from the id.
Overloads for arities **1-7** return a tuple instead, and indexing a tuple
within bounds is *not* widened:

```ts
const [userId] = await seedTestUsers(db, 1);        // string          ✅
const [a, b]   = await seedTestUsers(db, 2);        // string, string  ✅
const ids      = await seedTestUsers(db, userCount); // string[] — variable count
```

**Do NOT add `as [string, string]` at the call site.** 151 such casts existed
before the overloads landed and were all removed with them; removing the
overloads again puts 289 type errors back. The tuples are sound because the
function pushes exactly `count` rows, inserts with no `ON CONFLICT`, and returns
one id per inserted row — so it yields exactly `count` ids or it throws.

A count above 7, or a variable count, still returns `string[]`; destructure it
and you are back to `string | undefined`, so index it inside a loop or add the
next overload.

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
| `createMockKVNamespace(options?)` | In-memory KV mock |
| `createMockR2Bucket()` | R2 bucket mock |
| `createMockDatabase()` | Drizzle DB mock |

### `stripe-mock.ts` — Stripe Client Mock

| Export | Purpose |
|---|---|
| `createMockStripe()` | Returns a `Stripe`-shaped mock with vi.fn() methods |

## Integration Test Pattern

```ts
import { setupTestDatabase, teardownTestDatabase, seedTestUsers, createTestContentInput, type Database } from '@codex/test-utils';
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
  const result = await service.get(row.id, userId);
  expect(result.creatorId).toBe(userId); // ALWAYS verify scoping
});
```

## CI vs Local

| Environment | DB | Notes |
|---|---|---|
| **Local** | `DATABASE_URL_LOCAL_PROXY` from `.env.test`, `DB_METHOD=LOCAL_PROXY` | Shared DB, use `createUniqueSlug()` to avoid conflicts. **Currently points at the DEV database — see the guard below** |
| **CI** | Workflow-created Neon branch per domain | `DATABASE_URL` injected by GitHub Actions; branch `neondb`, deleted after run |

Note the variable name: under `DB_METHOD=LOCAL_PROXY` the resolver reads
**`DATABASE_URL_LOCAL_PROXY`**, not `DATABASE_URL`
(`packages/database/src/config/env.config.ts`). Both currently hold the same
value, so the distinction is easy to miss until you change one of them.

## The destructive-cleanup guard (Codex-bsbf8)

`cleanupDatabase`, `cleanupDatabaseComplete` and `cleanupTables` issue
**unconditional DELETEs** across ~14 tables including `organizations` and
`users`. Locally `.env.test` has pointed at `db.localtest.me:5432/main` — the
same database `pnpm dev` uses — so `pnpm test` from the repo root deleted the
developer's own seeded orgs, content and entitlements out from under a running
session.

All three helpers now call `assertDestructiveTargetAllowed()` first and
**throw instead of deleting** unless the live connection is attached to a
disposable database:

Rules are evaluated in this order — the refusals come first, so no later
allowance can reach the dev database by another route:

| # | Condition | Verdict |
|---|---|---|
| 1 | `NODE_ENV=production` or `DB_METHOD=PRODUCTION` | **refused**, whatever the database is called |
| 2 | `current_database()` unreadable | **refused** (fails closed) |
| 3 | database is `main` | **refused** — this is the database `pnpm dev` uses |
| 4 | `DB_METHOD=NEON_BRANCH` | allowed — an ephemeral per-run CI branch |
| 5 | database is `main_test` or `neondb` | allowed |
| 6 | anything else | **refused** |

Rule 4 keys on the **mode**, not on the branch's database name, and rule 3
is what makes that safe. The reason is that the name is not knowable from this
repository: the `neondatabase/create-branch-action` step passes no `database`
input, so a CI branch inherits whatever its parent has. Guessing it would put
an unverifiable assumption underneath a gate, and guessing wrong would take
every database-backed CI job red.

### Why it asks the connection, not the URL

The verdict is keyed on `SELECT current_database()`, not on the connection
string. Under `LOCAL_PROXY` the driver is reconfigured to tunnel through a
local Neon HTTP proxy — `neonConfig.fetchEndpoint` and `neonConfig.wsProxy`
rewrite host and port — and that proxy container carries its own hardcoded
`PG_CONNECTION_STRING=…/main`
(`infrastructure/neon/docker-compose.dev.local.yml`).

So there are two connection strings and the one in your environment is not the
one that reaches Postgres. A guard that parsed the URL would be **worse than
none**: edit `.env.test` to say `main_test` while the proxy still routes to
`main`, and the guard would read `main_test`, permit the deletes, and they
would land on `main` anyway.

### Running DB-backed tests locally

Not yet possible, and that is deliberate — the guard refuses rather than
wiping your dev data. Making it possible needs a **disposable `main_test`
database with its own proxy target**, because the Neon proxy binds one
database, so pointing `.env.test` at a different database name is not enough
on its own. Tracked on `Codex-bsbf8`.

Until then, DB-backed package suites run in CI only. The suites that are safe
locally are the ones that do not touch the database at all (for example
`pnpm --filter web test`, `pnpm --filter @codex/validation test`).

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
