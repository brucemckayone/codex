---
name: testing-patterns
description: >
  Deep reference for testing Codex backend code — test utilities, service unit tests,
  worker integration tests, E2E, factory patterns, Neon branch strategy, and mocking
  external services.
type: reference
---

# Testing Patterns

Tests in Codex fall into three tiers, each with different tooling and scope:

| Tier | Tool | Scope | Runtime |
|------|------|-------|---------|
| Unit / integration | Vitest | Service classes with real DB | Node |
| Worker integration | `@cloudflare/vitest-pool-workers` | Full middleware stack, real handlers | workerd |
| E2E | Playwright | User flows through the web app | Browser + all workers |

This reference covers **when to write which tier**, **how to structure them**, and
**how to share state across CI without blowing up cost**.

Reference implementations:
- `packages/test-utils/src/` — factories, DB setup, mocks
- `packages/organization/src/services/__tests__/organization-service.test.ts` — canonical service test
- `packages/purchase/src/__tests__/purchase-service.test.ts` — Stripe mock example
- `apps/web/e2e/fixtures/auth.ts` — E2E fixture pattern
- `config/vitest/package.config.ts` — shared config helper
- `vitest.setup.ts` — root setup

---

## Tier 1: Service Unit / Integration Tests

These are the workhorse. Real database, real service methods, mocked external
services. They run fast enough to run on every save.

### File placement

```
packages/<domain>/
  src/
    services/
      content-service.ts
      __tests__/
        content-service.test.ts   ← test here
```

One test file per service class. Filename mirrors the class file.

### The canonical shape

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServiceTestContext, createUniqueSlug } from '@codex/test-utils';
import { ContentService } from '../content-service';
import { NotFoundError, ConflictError } from '@codex/service-errors';

const getContext = createServiceTestContext(
  (db) => new ContentService({ db, environment: 'test' }),
  2 // How many test users to seed
);

describe('ContentService', () => {
  describe('create', () => {
    it('creates content with default values', async () => {
      const { service, creatorId } = getContext();
      const content = await service.create(
        {
          title: 'Test Content',
          slug: createUniqueSlug('content'),
          contentType: 'video',
          visibility: 'public',
        },
        creatorId
      );
      expect(content.id).toBeDefined();
      expect(content.creatorId).toBe(creatorId);
    });

    it('throws ConflictError on duplicate slug', async () => {
      const { service, creatorId } = getContext();
      const slug = createUniqueSlug('content');
      await service.create({ title: 'First', slug, ... }, creatorId);
      await expect(
        service.create({ title: 'Second', slug, ... }, creatorId)
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('getById', () => {
    it('enforces scoping — returns NotFoundError for other creator', async () => {
      const { service, creatorId, otherCreatorId } = getContext();
      const content = await service.create({ ... }, creatorId);
      await expect(
        service.getById(content.id, otherCreatorId)
      ).rejects.toThrow(NotFoundError);
    });
  });
});
```

### Why `createServiceTestContext`

It handles the boilerplate:
1. Calls `setupTestDatabase()` in `beforeAll` (connects to Neon branch / local PG)
2. Calls `seedTestUsers(n)` — creates N test users, returns `{ creatorId, otherCreatorId, ... }`
3. Instantiates the service via your factory
4. Returns a getter function so tests can grab fresh state
5. Calls `teardownTestDatabase()` in `afterAll`

Without the helper you'd repeat 15 lines of setup in every file. With it, each
test gets `db`, `service(s)`, and seeded user IDs.

### Testing multiple services at once

```typescript
const getContext = createIntegrationTestContext(
  (db) => ({
    content: new ContentService({ db, environment: 'test' }),
    media: new MediaItemService({ db, environment: 'test' }),
    purchase: new PurchaseService({ db, environment: 'test' }, mockStripe),
  }),
  2
);

it('can purchase content with media', async () => {
  const { services, creatorId } = getContext();
  const media = await services.media.create(..., creatorId);
  const content = await services.content.create(..., creatorId);
  const purchase = await services.purchase.create(..., creatorId);
});
```

Use this when a flow crosses service boundaries. Don't over-use — most tests should
be single-service.

### The `createUniqueSlug` rule

Every field with a unique constraint must use `createUniqueSlug('<prefix>')` in
tests. Why: tests share a DB in CI (see below). Hardcoded slugs collide between
test runs and test files.

```typescript
// WRONG — collides if another test already created "my-content"
slug: 'my-content'

// CORRECT — unique per run
slug: createUniqueSlug('my-content')  // → "my-content-1729363452-a3f2"
```

Emails, usernames, slugs, org handles — anything with a unique constraint.

### Transaction isolation (optional)

For tests that should leave no trace:

```typescript
await withTransaction(db, async (tx) => {
  const content = await tx.insert(...).values(...).returning();
  expect(content.length).toBe(1);
  // Transaction auto-rolls back when the callback returns
});
```

Use when a test inserts data you don't want persisting. Most tests don't need
this — `createUniqueSlug` gives you per-test uniqueness, and the shared DB is
reset daily anyway.

---

## Mocking External Services

The rule: **mock at the boundary, not the interior**.

- **Mock** Stripe SDK, R2, Resend, RunPod — services you don't control
- **Don't mock** the database, other Codex services, Zod schemas — you want the real thing to catch integration bugs

### Stripe

```typescript
import { createMockStripe } from '@codex/test-utils';

const stripe = createMockStripe();
const service = new TierService({ db, environment: 'test' }, stripe);

it('creates tier with monthly and annual prices', async () => {
  stripe.products.create.mockResolvedValueOnce({ id: 'prod_123' });
  stripe.prices.create.mockResolvedValueOnce({ id: 'price_monthly' });
  stripe.prices.create.mockResolvedValueOnce({ id: 'price_annual' });

  const tier = await service.createTier(orgId, { name: 'Pro', priceMonthly: 999, priceAnnual: 9990 });

  expect(stripe.products.create).toHaveBeenCalledOnce();
  expect(stripe.prices.create).toHaveBeenCalledTimes(2);
});
```

The mock is `vi.fn()` all the way down. You override per-test with `mockResolvedValueOnce`
to control what Stripe "returns". Assert against call counts and arguments.

### R2, KV, Observability

```typescript
import { createMockR2, createMockKV, createMockObservability } from '@codex/test-utils';

const r2 = createMockR2();          // in-memory put/get/delete
const kv = createMockKV();          // in-memory key-value
const { obs, logs } = createMockObservability();  // logs array for assertions
```

After a test, inspect `logs` to assert logging behavior:

```typescript
expect(logs).toContainEqual(
  expect.objectContaining({ level: 'info', message: 'Content published' })
);
```

---

## Tier 2: Worker Integration Tests

These run the actual worker — middleware chain, procedure() pipeline, real
service registry. Closer to prod, slower than unit tests.

### File placement

```
workers/<worker>/
  src/
    index.ts
    routes/
      content.ts
      content.test.ts    ← test here
```

### The pattern

```typescript
import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';

describe('POST /content', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await SELF.fetch('http://localhost/content', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', ... }),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(401);
  });

  it('creates content with valid session', async () => {
    const cookie = await createTestSession(env, userId);
    const response = await SELF.fetch('http://localhost/content', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test', ... }),
      headers: {
        'content-type': 'application/json',
        cookie: `CODEX_SESSION=${cookie}`,
      },
    });
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.data.title).toBe('Test');
  });
});
```

- `SELF` = the worker's own fetch handler
- `env` = Cloudflare bindings (KV, R2, D1 — all the real thing)
- Full middleware stack runs — auth, rate limiting, Zod validation, error mapping

### When to use worker tests vs service tests

| Aspect | Service test | Worker test |
|--------|-------------|-------------|
| Tests | Business logic | Full request lifecycle |
| Auth | Assumed (pass userId) | Real session validation |
| Rate limiting | N/A | Actually enforced |
| Error mapping | N/A | 4xx/5xx shape verified |
| Zod validation | Bypassed | Actual Zod errors |
| Speed | Fast | Slower (workerd startup) |

Rule of thumb: **every service has unit tests. Endpoints get worker tests only
when the thing being tested is the HTTP surface** (auth, rate limiting, response
shape, multipart, webhook signature).

Don't duplicate — if you've tested `ContentService.create` at the service level,
the worker test for `POST /content` only needs to verify auth enforcement and
response envelope, not the business logic.

---

## Tier 3: E2E Tests (Playwright)

Full-stack user flows: register → log in → browse → purchase → play. These run
against a live local stack (all workers + web app).

### File placement

```
apps/web/
  e2e/
    fixtures/
      auth.ts
    studio/
      content.spec.ts   ← test here
```

Note `.spec.ts` for Playwright (Vitest uses `.test.ts`).

### Auth fixture pattern

```typescript
// apps/web/e2e/fixtures/auth.ts
import { test as base } from '@playwright/test';
import { authFixture } from '@codex/test-utils/e2e';

export const test = base.extend<AuthFixtures>({
  authenticateAsUser: async ({ page }, use) => {
    const user = await authFixture.registerUser({
      email: `e2e-${Date.now()}@test.codex`,
      password: 'Test123!@#',
    });
    const cookies = parseCookieString(user.cookie);
    await page.context().addCookies(cookies);
    await use();
  },
});
```

### Using the fixture

```typescript
import { test } from '../fixtures/auth';
import { expect } from '@playwright/test';

test('creator can publish content', async ({ page, authenticateAsUser }) => {
  await authenticateAsUser();
  await page.goto('/studio/content/new');
  await page.getByLabel('Title').fill('Test Content');
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published')).toBeVisible();
});
```

### Selectors — roles over CSS

Prefer `getByRole`, `getByLabel`, `getByText`. Reserve CSS selectors for cases
where semantics aren't enough. This keeps tests resilient to design changes and
accessible-by-default.

### When E2E vs worker test

E2E when:
- The flow crosses the web app (server load + component interactivity)
- You're testing subdomain routing or the reroute hook
- You're testing localStorage / TanStack DB collection behavior
- You're testing Stripe redirect flows (use Stripe test mode)

Worker test when:
- Single endpoint behavior
- Auth enforcement on specific routes
- Webhook signature verification

---

## Database Strategy

### Local development

Default: shared local Postgres via `DB_METHOD=LOCAL_PROXY`. Fast, no provisioning,
but shared across test runs. This is why `createUniqueSlug` is mandatory.

Environment: `.env.test` at repo root. Not committed. Each dev configures once.

### CI — Neon branch per test domain

Not per-file, not per-run. **Per-domain.** Seven branches:

| Branch | Tests |
|--------|-------|
| `ci-unit-tests` | All `packages/*/src/**/*.test.ts` |
| `ci-auth-tests` | `workers/auth/**/*.test.ts` |
| `ci-content-api-tests` | `workers/content-api/**/*.test.ts` |
| `ci-identity-api-tests` | `workers/identity-api/**/*.test.ts` |
| `ci-ecom-api-tests` | `workers/ecom-api/**/*.test.ts` |
| `ci-e2e-api-tests` | Repo-level API E2E |
| `ci-e2e-web-tests` | `apps/web/e2e/**/*.spec.ts` |

Why not per-file: Neon branches have creation overhead. 100 files × creation time
× cleanup = expensive. Per-domain means ~7 branches × workflow runs.

Why the per-domain split: unit tests share a branch (they're isolated by unique
slugs), but auth/content/ecom have per-worker migration differences worth
isolating.

**Estimated cost savings: ~97% vs per-file branches.**

### Cleanup strategy

Between tests: **none**. Tests are idempotent via `createUniqueSlug` + soft deletes.

Between workflow runs: Neon branches are deleted at workflow end.

Between days: branches reset daily as a cleanup sweep (handled by CI).

### When to manually clean

Rarely. If you need to:

```typescript
import { cleanupDatabase, cleanupDatabaseComplete } from '@codex/test-utils';

afterAll(async () => {
  // Delete content, orgs, media — keeps users
  await cleanupDatabase(db);

  // Or delete everything including users
  await cleanupDatabaseComplete(db);
});
```

---

## Vitest Configuration

### Per-package config

```typescript
// packages/content/vitest.config.content.ts
import { packageVitestConfig } from '../../config/vitest/package.config';

export default packageVitestConfig({
  packageName: 'content',
  setupFiles: ['../../vitest.setup.ts', './vitest.setup.ts'],  // optional
  testTimeout: 60000,
  sequentialTests: true,  // if tests share DB state
});
```

`packageVitestConfig` provides the shared scaffolding (aliases, coverage, default
timeouts). Set `sequentialTests: true` for anything that mutates shared tables
extensively.

### Worker package config

Workers use a different pool:

```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
});
```

### Running tests

```bash
pnpm test                              # all packages
pnpm test --project @codex/content     # one package
pnpm test content-service.test         # one file (match by name)
pnpm test --watch                      # watch mode
pnpm test:coverage                     # with coverage
pnpm test:e2e                          # Playwright E2E
```

---

## Test Coverage Areas

Per service, at minimum:

1. **Creation** — happy path, minimal data, all optional fields, conflicts
2. **Retrieval** — by ID, scoping (user A can't read user B's), 404 for missing
3. **Update** — fields, partial updates, state transitions
4. **Deletion** — soft delete (verify `deletedAt` set, row still exists)
5. **Listing** — pagination, filters, sorting, empty results
6. **Errors** — all thrown `ServiceError` subclasses, DB constraint violations
7. **Scoping** — the big one. Every "can user X see/modify user Y's data" case.

A good service test file is 20–50 test cases. If it's 5, you're missing coverage.

---

## Anti-Patterns

| Anti-pattern | Why it breaks | Fix |
|--------------|---------------|-----|
| Hardcoded slugs/emails | Collision on parallel runs or repeat runs | `createUniqueSlug('prefix')` |
| Mocking the database | Tests pass but prod fails | Use real DB via `setupTestDatabase` |
| Mocking another Codex service | Tests a fiction, not reality | Use `createIntegrationTestContext` |
| Using `dbHttp` in tests | Transactions fail | `dbWs` via `setupTestDatabase` |
| No `afterAll` teardown | Connections leak | `teardownTestDatabase()` |
| Deeply nested `describe` (4+ levels) | Hard to read output | Keep to 2-3 levels |
| Testing implementation details (private methods) | Brittle, refactoring breaks tests | Test public API |
| Testing identical paths at multiple tiers | Duplication, slow CI | Unit test business logic; worker test HTTP surface; E2E user flows |
| Real HTTP calls to Stripe in tests | Flaky, slow, costs money | `createMockStripe()` |
| Real emails from `NotificationsService` in tests | Spam your inbox, leak test data | Mock the service |
| `expect(service).toBeDefined()` | Tautological | Test behavior, not existence |
| Assertion with no message | Hard to debug failures | Use `.toEqual(expected, 'explains why')` when non-obvious |
| Test order dependency | Flaky, hard to parallelize | Each test creates its own data |
| `console.log` for debugging in committed tests | Log noise | Use `expect().toMatchInlineSnapshot()` or remove |

---

## Debugging Tests

1. **Test hangs forever** — `teardownTestDatabase()` missing, connection not closed.
2. **Works locally, fails in CI** — probably test-order dependency, or stale Neon branch data. Check `createUniqueSlug` usage.
3. **Rate limit hit in worker test** — KV counter persists. Use a unique IP header per test.
4. **"Cannot find module 'cloudflare:test'"** — wrong vitest pool. Check `vitest.config.ts` uses `@cloudflare/vitest-pool-workers`.
5. **`env` undefined in worker test** — wrangler config path wrong in `poolOptions.workers.wrangler`.
6. **Stripe mock returns undefined for a method** — didn't `mockResolvedValueOnce` for that call. Default is `undefined`.
7. **E2E auth fixture not working** — subdomain cookie not set for current origin. Use `page.context().addCookies()` with full cookie shape including domain.
8. **Flaky E2E test** — probably real timing issue. Add `await expect(locator).toBeVisible()` before assertions.

---

## Adding Tests to a New Service

1. Create `src/services/__tests__/<name>-service.test.ts`
2. Import `createServiceTestContext`, `createUniqueSlug`, factories from `@codex/test-utils`
3. Import typed errors from `@codex/service-errors`
4. Write `describe('<ServiceName>')` as the outer block
5. One `describe` per method, `it` per scenario
6. Cover: create (success, conflict), get (success, scoping, 404), update, delete (soft), list (paginated, filtered)
7. Mock externals with `createMockStripe/R2/KV/Observability`
8. Add per-package `vitest.config.<name>.ts` if not already present
9. Run `pnpm test --project @codex/<name>` and fix failures

---

## When to Re-Verify This Reference

Re-read this doc against current code if you see changes in:

- `packages/test-utils/src/` (factories, setup helpers, mocks)
- `config/vitest/package.config.ts` (shared config)
- `vitest.setup.ts` root
- CI workflow files (`.github/workflows/*.yml`) for Neon branch config
- `packages/test-utils/CLAUDE.md`

Particularly worth re-verifying: the list of CI Neon branches and which tests
they cover. That's the kind of detail that drifts when the repo grows.
