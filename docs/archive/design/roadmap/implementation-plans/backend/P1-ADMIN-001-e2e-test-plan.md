# P1-ADMIN-001: Admin Dashboard E2E Test Plan

**Status**: Implementation Complete - Pending Test Execution
**Dependencies**: admin-api worker, @codex/admin services, auth worker
**Created**: 2025-12-15

---

## Overview

End-to-end tests for admin-api worker validating the complete admin dashboard flow including authentication, authorization (platform_owner role), analytics, content management, and customer support operations.

## Test Infrastructure

### Worker URLs
```typescript
admin: process.env.ADMIN_URL || 'http://localhost:42073'
```

Already configured in `e2e/helpers/worker-urls.ts` and `e2e/helpers/worker-manager.ts`.

### Required Fixtures

**1. Admin Fixture** (`e2e/fixtures/admin.fixture.ts`)

Platform owner user setup and admin API helpers:

```typescript
export const adminFixture = {
  // Create platform owner user with org
  async createPlatformOwner(request, data): Promise<PlatformOwnerContext>

  // Analytics API helpers
  async getRevenueStats(request, cookie, params?): Promise<RevenueStats>
  async getCustomerStats(request, cookie): Promise<CustomerStats>
  async getTopContent(request, cookie, limit?): Promise<TopContentItem[]>

  // Content management API helpers
  async listAllContent(request, cookie, params?): Promise<PaginatedResponse>
  async publishContent(request, cookie, contentId): Promise<Content>
  async unpublishContent(request, cookie, contentId): Promise<Content>
  async deleteContent(request, cookie, contentId): Promise<boolean>

  // Customer management API helpers
  async listCustomers(request, cookie, params?): Promise<PaginatedResponse>
  async getCustomerDetails(request, cookie, customerId): Promise<CustomerDetails>
  async grantContentAccess(request, cookie, customerId, contentId): Promise<boolean>
}
```

**2. Platform Owner Context Type**
```typescript
interface PlatformOwnerContext {
  user: User;
  session: Session;
  cookie: string;
  organization: Organization;
}
```

---

## Test File: `e2e/tests/06-admin-dashboard.spec.ts`

### Test Scenarios

#### 1. Authentication & Authorization

| Test | Description | Expected |
|------|-------------|----------|
| `should reject unauthenticated requests` | Call admin endpoints without cookie | 401 Unauthorized |
| `should reject non-platform-owner users` | Call with creator/customer role | 403 Forbidden |
| `should accept platform_owner user` | Call with platform_owner role | 200 OK |

#### 2. Revenue Analytics

| Test | Description | Expected |
|------|-------------|----------|
| `should return zero stats for new org` | Fresh org with no purchases | All zeros, empty revenueByDay |
| `should calculate revenue from completed purchases` | After purchase flow | Correct totals, revenue split |
| `should filter by date range` | Query with startDate/endDate | Only matching purchases |
| `should scope to platform owner's org only` | Two orgs, query each | Isolated data |

#### 3. Customer Analytics

| Test | Description | Expected |
|------|-------------|----------|
| `should count distinct customers` | Multiple purchases by same user | Count = 1 |
| `should identify new customers in last 30 days` | Recent first purchase | Correct newCustomers count |

#### 4. Top Content

| Test | Description | Expected |
|------|-------------|----------|
| `should rank content by revenue` | Multiple content with purchases | Correct ordering |
| `should respect limit parameter` | limit=3 | Max 3 items returned |

#### 5. Content Management

| Test | Description | Expected |
|------|-------------|----------|
| `should list all org content with pagination` | Multiple content items | Paginated response |
| `should filter content by status` | status=published | Only published |
| `should publish draft content` | Draft content | Status becomes published |
| `should unpublish published content` | Published content | Status becomes draft |
| `should soft delete content` | Any content | deletedAt set, excluded from list |
| `should reject cross-org content operations` | Content from other org | 404 Not Found |

#### 6. Customer Management

| Test | Description | Expected |
|------|-------------|----------|
| `should list customers with aggregated stats` | Customers with purchases | totalPurchases, totalSpentCents |
| `should get customer details with purchase history` | Specific customer | Purchase history array |
| `should grant complimentary access` | Customer + content | contentAccess record created |
| `should handle duplicate access grant (idempotent)` | Grant twice | Success both times, one record |
| `should reject grant for non-customer` | User with no org relationship | 404 Not Found |

---

## Test Data Setup Pattern

Each test follows the established E2E pattern:

```typescript
test.describe('Admin Dashboard', () => {
  test('should complete admin workflow', async ({ request }) => {
    // Extend timeout for multi-step tests
    test.setTimeout(120000);

    // ========================================
    // Step 1: Setup platform owner
    // ========================================
    const platformOwner = await adminFixture.createPlatformOwner(request, {
      email: `admin-${Date.now()}@example.com`,
      password: 'SecurePassword123!',
      name: 'Platform Admin',
      orgName: `Test Org ${Date.now()}`,
      orgSlug: `test-org-${Date.now()}`,
    });

    // ========================================
    // Step 2: Create test data (content, purchases)
    // ========================================
    // ... use existing fixtures ...

    // ========================================
    // Step 3: Execute admin operations
    // ========================================
    const stats = await adminFixture.getRevenueStats(
      request,
      platformOwner.cookie
    );

    // ========================================
    // Step 4: Verify results
    // ========================================
    expect(stats.totalRevenueCents).toBe(expectedRevenue);
  });
});
```

---

## Database Verification Pattern

Use dbHttp for direct database verification (following existing E2E patterns):

```typescript
import { dbHttp, schema } from '@codex/database';
import { and, eq } from 'drizzle-orm';

// Verify contentAccess record created
const accessRecords = await dbHttp
  .select()
  .from(schema.contentAccess)
  .where(
    and(
      eq(schema.contentAccess.userId, customerId),
      eq(schema.contentAccess.contentId, contentId)
    )
  );

expect(accessRecords).toHaveLength(1);
expect(accessRecords[0].accessType).toBe('complimentary');
```

---

## Critical Test Scenarios

### Full Admin Workflow (Integration)

```typescript
test('should complete full admin dashboard workflow', async ({ request }) => {
  test.setTimeout(180000); // 3 minutes

  // 1. Create platform owner with organization
  const admin = await adminFixture.createPlatformOwner(request, {...});

  // 2. Create creator and publish paid content
  const creator = await authFixture.registerUser(request, { role: 'creator' });
  const content = await createAndPublishPaidContent(request, creator, admin.organization);

  // 3. Create buyer and complete purchase
  const buyer = await authFixture.registerUser(request, { role: 'customer' });
  await completePurchase(request, buyer, content);

  // 4. Verify analytics show purchase
  const revenue = await adminFixture.getRevenueStats(request, admin.cookie);
  expect(revenue.totalPurchases).toBe(1);
  expect(revenue.totalRevenueCents).toBe(content.priceCents);

  // 5. Verify customer appears in list
  const customers = await adminFixture.listCustomers(request, admin.cookie);
  expect(customers.items).toHaveLength(1);
  expect(customers.items[0].userId).toBe(buyer.user.id);

  // 6. Get customer details
  const details = await adminFixture.getCustomerDetails(
    request, admin.cookie, buyer.user.id
  );
  expect(details.purchaseHistory).toHaveLength(1);

  // 7. Grant complimentary access to new content
  const newContent = await createAndPublishPaidContent(request, creator, admin.organization);
  await adminFixture.grantContentAccess(
    request, admin.cookie, buyer.user.id, newContent.id
  );

  // 8. Verify access granted (buyer can stream new content)
  const streamResponse = await request.get(
    `${WORKER_URLS.content}/api/access/content/${newContent.id}/stream`,
    { headers: { Cookie: buyer.cookie } }
  );
  expect(streamResponse.ok()).toBeTruthy();

  // 9. Admin unpublishes content
  await adminFixture.unpublishContent(request, admin.cookie, content.id);

  // 10. Admin deletes content
  await adminFixture.deleteContent(request, admin.cookie, content.id);

  // 11. Verify content no longer in list
  const contentList = await adminFixture.listAllContent(request, admin.cookie);
  expect(contentList.items.find(c => c.id === content.id)).toBeUndefined();
});
```

### Authorization Boundary Tests

```typescript
test('should enforce platform_owner role requirement', async ({ request }) => {
  // Create creator (NOT platform owner)
  const creator = await authFixture.registerUser(request, {
    email: `creator-${Date.now()}@example.com`,
    password: 'SecurePassword123!',
    role: 'creator',
  });

  // Try to access admin analytics - should fail
  const response = await request.get(
    `${WORKER_URLS.admin}/api/admin/analytics/revenue`,
    { headers: { Cookie: creator.cookie } }
  );

  expect(response.status()).toBe(403);
  await expectForbidden(response);
});
```

### Organization Scoping Tests

```typescript
test('should scope data to platform owner org only', async ({ request }) => {
  // Create two platform owners with different orgs
  const admin1 = await adminFixture.createPlatformOwner(request, {...});
  const admin2 = await adminFixture.createPlatformOwner(request, {...});

  // Create purchase in admin1's org
  // ...

  // Admin1 should see the purchase
  const admin1Stats = await adminFixture.getRevenueStats(request, admin1.cookie);
  expect(admin1Stats.totalPurchases).toBe(1);

  // Admin2 should NOT see admin1's purchase
  const admin2Stats = await adminFixture.getRevenueStats(request, admin2.cookie);
  expect(admin2Stats.totalPurchases).toBe(0);
});
```

---

## File Structure

```
e2e/
├── fixtures/
│   ├── admin.fixture.ts     [NEW] Platform owner setup + admin API helpers
│   ├── auth.fixture.ts      [UPDATED] Uses shared cookies helper
│   ├── database.fixture.ts  [EXISTING] DB setup/cleanup
│   └── index.ts             [UPDATED] Export adminFixture
│
├── helpers/
│   ├── cookies.ts           [NEW] Shared extractSessionCookie helper
│   ├── index.ts             [UPDATED] Export cookies helper
│   ├── types.ts             [UPDATED] Re-exports from @codex/admin
│   └── worker-urls.ts       [EXISTS] Already has admin URL
│
└── tests/
    └── 06-admin-dashboard.spec.ts  [NEW] Admin E2E tests
```

---

## Implementation Order

1. [x] **Create admin.fixture.ts** - Platform owner setup, admin API helpers
2. [x] **Update fixtures/index.ts** - Export adminFixture
3. [x] **Update helpers/types.ts** - Re-exports from @codex/admin + PlatformOwnerContext
4. [x] **Create 06-admin-dashboard.spec.ts** - All test scenarios
5. [ ] **Run tests** - Verify against local workers

**Also created**: `e2e/helpers/cookies.ts` - Extracted shared `extractSessionCookie` helper

---

## Test Execution

```bash
# Run all E2E tests
pnpm --filter e2e test

# Run only admin dashboard tests
pnpm --filter e2e test -- --grep "Admin Dashboard"

# Run with debug output
DEBUG=pw:api pnpm --filter e2e test
```

---

## Success Criteria

- [ ] All authentication/authorization tests pass
- [ ] Revenue analytics tests pass with correct calculations
- [ ] Customer analytics tests pass
- [ ] Content management operations work correctly
- [ ] Customer management + complimentary access tests pass
- [ ] Organization scoping is verified
- [ ] Idempotency is verified for access grants
- [ ] Full workflow integration test passes

---

**Created**: 2025-12-15
**Status**: Implementation complete - pending test execution
**Next Step**: Run `pnpm --filter e2e test -- --grep "Admin Dashboard"` to verify all tests pass
