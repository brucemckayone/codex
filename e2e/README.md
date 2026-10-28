# E2E API Testing for Codex Backend Workers

End-to-end tests for critical user flows across all 4 Codex backend workers.

## Overview

Tests validate complete user journeys across:
- **Auth Worker** (port 42069) - Authentication & sessions
- **Content-API** (port 4001) - Content, media, streaming
- **Identity-API** (port 42071) - Organizations
- **Ecom-API** (port 42072) - Stripe checkout & webhooks

**Important**: These are TRUE e2e tests - no mocks. Tests use real R2, real database, real Stripe test mode.

## Prerequisites

### 1. Environment variables configured

Required in `.env.test`:

```bash
# Database
DATABASE_URL=postgresql://...

# R2 (real test bucket)
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_MEDIA=codex-test-media

# Stripe (test mode keys)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET_BOOKING=whsec_...
# Signs charge.refunded for /webhooks/stripe/payment (test 12)
STRIPE_WEBHOOK_SECRET_PAYMENT=whsec_...
```

Each secret must match the one in `workers/ecom-api/.dev.vars.test`: the
worker checks the signature against its own copy.

### 2. Workers will be started automatically

The test setup (`setup.ts`) automatically starts and stops all 4 workers.

## Running Tests

```bash
# Run all e2e API tests
pnpm test

# Run in watch mode
pnpm test:watch

# Run with Vitest UI (interactive)
pnpm test:ui

# Run specific test file
pnpm test tests/01-auth-flow.test.ts
```

## Test Flows

### 1. Auth Flow (`01-auth-flow.test.ts`)
- Register new user
- Login with credentials
- Validate session
- Logout
- Reject invalid credentials
- Reject duplicate email

### 2. Content Creation (`02-content-creation.test.ts`)
- Create draft content
- Upload media item
- Publish content
- Validate media requirements

### 3. Free Content Access (`03-free-content-access.test.ts`)
- Login as viewer
- Request streaming URL for free content
- Verify presigned R2 URL
- Test actual R2 access (HEAD request)

### 4. Paid Content Purchase (`04-paid-content-purchase.test.ts`)
- Create checkout session
- Simulate Stripe webhook (real signature)
- Verify purchase recorded
- Verify access granted

### 5. Purchase History (`05-purchase-history.test.ts`)
- Verify purchase history retrieval
- Test pagination

### 6. Admin Dashboard (`06-admin-dashboard.test.ts`)
- Admin analytics and management

### 7. Platform Settings (`07-platform-settings.test.ts`)
- Platform configuration management

### 12. Purchase and refund round trips (`12-purchase-refund-round-trip.test.ts`)
Real Stripe test-mode objects, not invented ids (`Codex-2hxff.25`). Tests 04-06
invent `pi_test_*` ids: the webhook's `paymentIntents.retrieve` 404s, the charge
id is null and the payouts ledger is skipped, so they write no payout rows.
- The app opens a Checkout Session; a real PaymentIntent pays it with
  `pm_card_visa`; the signed `checkout.session.completed` records the purchase,
  the entitlement and one payout row per slice, keyed on `latest_charge`
- A full refund and a partial refund, each made in Stripe, each on its own
  purchase, delivered as a signed `charge.refunded` to `/webhooks/stripe/payment`:
  the purchase, the access and every slice's reversal step, to the penny
- The expected amounts come from `docs/payments/` (fees-and-splits.md,
  purchases.md "Refunds"), never from the code
- Every Stripe object is tagged `codex_env: test`, so production, which shares
  the sandbox, ignores its events. The creator's Connect account is real and
  deleted in `afterAll`. Helpers: `helpers/stripe-test-mode.ts`

## Architecture

```
Vitest HTTP Request
    ↓
Real Workers (localhost:42069, 4001, 42071, 42072)
    ↓
Real Services (@codex/content, @codex/identity, @codex/access)
    ↓
Real Database (PostgreSQL/Neon)
Real R2 (test bucket)
Real Stripe (test mode)
```

**No mocks** - tests validate the entire stack end-to-end.

## Fixtures

### Auth Fixture
```typescript
import { authFixture } from '../fixtures';

const user = await authFixture.registerUser({
  email: 'test@example.com',
  password: 'password123',
});
```

### Database Fixture
```typescript
import { setupDatabaseFixture } from '../fixtures';

const { db, contentService, r2Client } = await setupDatabaseFixture();
```

## Helpers

### Assertions
```typescript
import { expectSuccessResponse, expectAuthRequired } from '../helpers/assertions';

await expectSuccessResponse(response, 201);
await expectAuthRequired(response);
```

### HTTP Client
```typescript
import { httpClient } from '../fixtures';

const response = await httpClient.get(url, { headers: { Cookie } });
const response = await httpClient.post(url, { body, headers });
```

## Test Data Management

- **Unique emails**: `test-${Date.now()}-${Math.random()}@example.com`
- **Rows are left behind**: the files do not delete what they create, and test
  09 calls `cleanupDatabase`, which deletes every user, organisation and item
  of content in the database. CI gives the job a fresh service database
- **Database**: never run the suite, or a file that writes payouts (11, 12),
  against a local database other sessions use. Give it a database of its own
  on the local server instead: create it, migrate it with
  `pnpm --filter @codex/database db:migrate` (with `DB_METHOD`,
  `DATABASE_URL` and `DATABASE_URL_LOCAL_PROXY` set to it), and drop it after.
  Point both sides at it. The test process reads `.env.test`, and outside CI
  `worker-manager.ts` reloads it over your environment (`override: true`), so
  run with `CI=true` and the variables set. The workers read their
  `.dev.vars.test` unless `wrangler dev` is given `--env-file`, which replaces
  it, so start them yourself with copies that name the database. Set
  `SKIP_WORKER_<NAME>=true` for each one (`SKIP_WORKER_CONTENT_API`, and so
  on). A worker the suite finds down, for example one reloading after a
  package rebuild, is otherwise killed with whatever else holds its port, the
  test runner included, and restarted on `.dev.vars.test`
- **R2**: Test bucket configured via environment variables

## Debugging

### Workers not running
```bash
# Check if all workers are healthy
curl http://localhost:42069/api/health
curl http://localhost:4001/api/health
curl http://localhost:42071/api/health
curl http://localhost:42072/api/health
```

### Database connection issues
```bash
# Verify DATABASE_URL is set
echo $DATABASE_URL

# Test database connection
pnpm db:studio
```

### R2 access issues
- Verify R2 credentials in `.env.test`
- Check bucket exists and is accessible
- Ensure test bucket is separate from production

### Stripe webhook issues
- Use Stripe test mode keys
- Verify webhook secret matches
- Check ecom-api logs for webhook processing

## CI Integration

E2E tests can run in CI with:
1. Workers started automatically via setup
2. Ephemeral Neon branch for database
3. Test R2 bucket
4. Stripe test mode

See `.github/workflows/` for CI configuration.

## Adding New Tests

1. Create test file in `tests/` with `.test.ts` extension
2. Import fixtures from `../fixtures/`
3. Use `authFixture` for user sessions
4. Use `setupDatabaseFixture` for services
5. Use helpers from `../helpers/`

Example:
```typescript
import { describe, expect, test } from 'vitest';
import { authFixture, httpClient, setupDatabaseFixture } from '../fixtures';
import { expectSuccessResponse } from '../helpers/assertions';
import { WORKER_URLS } from '../helpers/worker-urls';

describe('My New Flow', () => {
  test('should do something', async () => {
    const { db, contentService } = await setupDatabaseFixture();

    const user = await authFixture.registerUser({
      email: `test-${Date.now()}@example.com`,
      password: 'password123',
    });

    const response = await httpClient.get(`${WORKER_URLS.content}/api/content`, {
      headers: { Cookie: user.cookie },
    });

    await expectSuccessResponse(response);
  });
});
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Port conflicts | Update `helpers/worker-urls.ts` with correct ports |
| Slow tests | Check worker logs for performance issues |
| Flaky tests | Add retry or waitFor helpers for async operations |
| Auth failures | Restart workers, check session handling |

## Resources

- [Vitest Docs](https://vitest.dev/)
- [@codex/test-utils](../packages/test-utils/README.md)
