# Database Integration Testing with neon-testing

This guide covers how to write database integration tests using the **neon-testing** library for ephemeral Neon branch isolation.

## Table of Contents

- [Overview](#overview)
- [Cost Optimization: Hybrid Strategy](#cost-optimization-hybrid-strategy)
- [How neon-testing Works](#how-neon-testing-works)
- [Quick Start](#quick-start)
- [Writing Tests](#writing-tests)
- [Best Practices](#best-practices)
- [Migration Guide](#migration-guide)
- [Troubleshooting](#troubleshooting)

## Overview

### Why neon-testing?

Traditional database testing approaches have challenges:
- **Shared database** - Tests interfere with each other
- **Manual cleanup** - Timing issues, race conditions, incomplete cleanup
- **Mock databases** - Don't catch real database constraint violations

**neon-testing solves these problems** by:
- ✅ **Complete isolation** - Each test file gets its own ephemeral Neon branch
- ✅ **Zero manual cleanup** - Branches are automatically deleted after tests
- ✅ **Real database** - Full production schema, real constraints, real behavior
- ✅ **Fast** - Neon branches provision in ~2 seconds
- ✅ **Automatic** - DATABASE_URL is provisioned automatically per test file

### Key Benefits

1. **Eliminates flaky tests** - No more timing issues from cleanup retries
2. **True isolation** - Test files cannot interfere with each other
3. **Simplified test code** - No complex cleanup logic needed
4. **Real constraints** - Tests validate actual database behavior
5. **Works everywhere** - Same setup for local dev and CI/CD

## Cost Optimization: Hybrid Strategy

**IMPORTANT**: This project uses a **hybrid testing approach** to minimize costs while maximizing reliability.

### The Strategy

**Local Development** (FREE):
- Tests use `DB_METHOD=LOCAL_PROXY` from `.env.dev`
- NO ephemeral branch creation
- NO API costs
- Unlimited test runs
- Fast execution (no branch provisioning delay)

**CI/CD** (Isolated):
- Tests use neon-testing with ephemeral branches
- Complete isolation between test files
- Real database constraints validated
- Automatic branch lifecycle management

### How It Works

The neon-testing plugin is **only activated in CI environments**:

```typescript
// config/vitest/package.config.ts
const shouldUseNeonTesting = enableNeonTesting && process.env.CI === 'true';
const plugins = shouldUseNeonTesting ? [neonTesting()] : [];
```

### Cost Comparison

| Environment | Test Runs/Day | Branch Creations | Cost |
|------------|---------------|------------------|------|
| **Local Dev** | 50 runs × 4 test files | 0 | **FREE** |
| **CI/CD** | 5 runs × 4 test files | 20 | Minimal |

**Estimated Savings**: **200+ branch creations per day** avoided during local development!

### Benefits of Hybrid Approach

✅ **Local Development**:
- FREE unlimited testing
- Fast feedback loop
- No API rate limits
- Same test code as CI

✅ **CI/CD**:
- Complete isolation
- Catches real constraint violations
- Reliable, reproducible results
- Worth the minimal cost

### Setup Requirements

**Local Development**:
```bash
# .env.dev
DB_METHOD=LOCAL_PROXY
DATABASE_URL=postgresql://your-local-proxy-url
# No NEON_API_KEY needed!
```

**CI/CD** (Already Configured):
- `NEON_API_KEY` from GitHub Secrets
- `NEON_PROJECT_ID` from GitHub Variables
- `CI=true` (automatic in GitHub Actions)

## How neon-testing Works

### Architecture

```
Test File 1                    Test File 2                    Test File 3
    │                              │                              │
    ├─ withNeonTestBranch()       ├─ withNeonTestBranch()       ├─ withNeonTestBranch()
    │                              │                              │
    ▼                              ▼                              ▼
Neon Branch A                  Neon Branch B                  Neon Branch C
(Auto-created)                 (Auto-created)                 (Auto-created)
(Auto-deleted)                 (Auto-deleted)                 (Auto-deleted)
```

### Lifecycle

1. **Before test file runs**: neon-testing creates ephemeral branch
2. **During tests**: All tests in file use that branch's DATABASE_URL
3. **After test file completes**: neon-testing deletes the branch

### Isolation Model

- **Between test files**: Complete isolation (different branches)
- **Within test file**: Shared database (same branch, sequential execution)

## Quick Start

### 1. Install Dependencies

Already installed in this project:

```json
{
  "devDependencies": {
    "neon-testing": "^2.2.0"
  }
}
```

### 2. Configure Vitest

Enable neon-testing in your package's vitest config:

```typescript
// packages/my-package/vitest.config.my-package.ts
import { packageVitestConfig } from '../../config/vitest/package.config';

export default packageVitestConfig({
  packageName: 'my-package',
  setupFiles: ['../../vitest.setup.ts'],
  testTimeout: 60000,
  hookTimeout: 60000,
  enableNeonTesting: true, // Enable ephemeral Neon branches
});
```

### 3. Set Environment Variables

Add to your `.env.dev`:

```bash
# Neon Testing Configuration
NEON_API_KEY=your_neon_api_key_here
NEON_PROJECT_ID=your_neon_project_id_here
```

In CI/CD, these are provided via GitHub Secrets and Variables.

### 4. Write Your First Test

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withNeonTestBranch } from '../../config/vitest/test-setup';
import { setupTestDatabase, teardownTestDatabase, seedTestUsers } from '@codex/test-utils';
import type { Database } from '@codex/database';
import { MyService } from '../my-service';

// Enable ephemeral Neon branch for this test file
withNeonTestBranch();

describe('MyService', () => {
  let db: Database;
  let service: MyService;
  let userId: string;

  beforeAll(async () => {
    // Setup database - DATABASE_URL already set by neon-testing
    db = setupTestDatabase();

    // Seed test users (persisted for all tests in this file)
    const [testUserId] = await seedTestUsers(db, 1);
    userId = testUserId;

    service = new MyService({ db, environment: 'test' });
  });

  afterAll(async () => {
    // Close database connections
    await teardownTestDatabase();
  });

  it('should create entity with valid data', async () => {
    // Each test creates its own data (idempotent)
    const result = await service.create({
      name: 'Test Entity',
      userId,
    });

    expect(result.id).toBeDefined();
    expect(result.name).toBe('Test Entity');
  });
});
```

## Writing Tests

### Test File Structure

```typescript
// 1. Imports
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withNeonTestBranch } from '../../config/vitest/test-setup';
import { setupTestDatabase, teardownTestDatabase, seedTestUsers } from '@codex/test-utils';

// 2. Enable neon-testing (MUST be at top level)
withNeonTestBranch();

// 3. Describe block
describe('MyService', () => {
  // 4. Test setup
  let db: Database;
  let service: MyService;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new MyService({ db, environment: 'test' });
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  // 5. Tests (each creates its own data)
  it('should do something', async () => {
    // Arrange - create test data
    const testData = await createTestData(db);

    // Act - execute behavior
    const result = await service.doSomething(testData);

    // Assert - verify outcome
    expect(result).toMatchObject({ /* expected */ });
  });
});
```

### Idempotent Test Design

**❌ Bad: Relying on shared state**

```typescript
describe('list', () => {
  beforeEach(async () => {
    // All tests share this data - causes hard-coded expectations
    for (let i = 0; i < 5; i++) {
      await service.create({ name: `Item ${i}` });
    }
  });

  it('should list all items', async () => {
    const result = await service.list();
    expect(result.items).toHaveLength(5); // ❌ Hard-coded, fragile
  });
});
```

**✅ Good: Each test creates its own data**

```typescript
describe('list', () => {
  it('should list all items', async () => {
    // This test owns its data
    const item1 = await service.create({ name: 'Item 1' });
    const item2 = await service.create({ name: 'Item 2' });
    const item3 = await service.create({ name: 'Item 3' });

    const result = await service.list();

    // Verify based on what WE created
    expect(result.items.length).toBeGreaterThanOrEqual(3);
    expect(result.items).toContainEqual(expect.objectContaining({ id: item1.id }));
    expect(result.items).toContainEqual(expect.objectContaining({ id: item2.id }));
    expect(result.items).toContainEqual(expect.objectContaining({ id: item3.id }));
  });

  it('should paginate results', async () => {
    // This test creates exactly what it needs
    for (let i = 0; i < 10; i++) {
      await service.create({ name: `Item ${i}` });
    }

    const page1 = await service.list({}, { page: 1, limit: 5 });
    const page2 = await service.list({}, { page: 2, limit: 5 });

    expect(page1.items).toHaveLength(5);
    expect(page2.items).toHaveLength(5);
    expect(page1.items[0].id).not.toBe(page2.items[0].id);
  });
});
```

### Testing Error Conditions

```typescript
it('should throw error for duplicate slug', async () => {
  const slug = createUniqueSlug('duplicate');

  await service.create({ name: 'First', slug });

  await expect(
    service.create({ name: 'Second', slug }) // Same slug
  ).rejects.toThrow(ConflictError);
});
```

### Testing Database Constraints

```typescript
it('should enforce unique constraint on email', async () => {
  const email = 'test@example.com';

  await service.create({ email });

  // Real database constraint violation
  await expect(
    service.create({ email }) // Duplicate email
  ).rejects.toThrow();
});
```

## Best Practices

### ✅ DO

1. **Call `withNeonTestBranch()` at the top level**
   ```typescript
   withNeonTestBranch(); // Before any describe blocks
   ```

2. **Make tests idempotent**
   - Each test creates its own data
   - Tests don't rely on execution order
   - Tests can run multiple times with same result

3. **Use `createUniqueSlug()` for unique values**
   ```typescript
   const slug = createUniqueSlug('test'); // Creates unique slug
   ```

4. **Close connections in `afterAll`**
   ```typescript
   afterAll(async () => {
     await teardownTestDatabase();
   });
   ```

5. **Test real database behavior**
   - Test constraint violations
   - Test transaction rollbacks
   - Test concurrent operations

### ❌ DON'T

1. **Don't use `beforeEach` cleanup**
   ```typescript
   // ❌ NOT NEEDED with neon-testing
   beforeEach(async () => {
     await cleanupDatabase(db);
   });
   ```

2. **Don't hard-code expectations**
   ```typescript
   // ❌ Bad - assumes exact count
   expect(result.items).toHaveLength(5);

   // ✅ Good - verifies what we created
   expect(result.items).toContainEqual(expect.objectContaining({ id: createdItem.id }));
   ```

3. **Don't share state between tests**
   ```typescript
   // ❌ Bad - tests share `sharedData`
   let sharedData;
   beforeEach(() => {
     sharedData = createData();
   });

   // ✅ Good - each test creates its own data
   it('test 1', async () => {
     const testData = await createData();
     // use testData
   });
   ```

4. **Don't forget `withNeonTestBranch()`**
   - Without it, tests may use wrong DATABASE_URL
   - Without it, no ephemeral branch is created

5. **Don't mock the database**
   - Use real database for integration tests
   - neon-testing makes this fast and isolated

## Migration Guide

### From Old Pattern to neon-testing

**Old Pattern (manual cleanup):**

```typescript
describe('MyService', () => {
  let db: Database;

  beforeAll(async () => {
    db = setupTestDatabase();
  });

  beforeEach(async () => {
    await cleanupDatabase(db); // Manual cleanup with retries
  });

  afterAll(async () => {
    await cleanupDatabase(db);
  });

  // Tests with hard-coded expectations...
});
```

**New Pattern (neon-testing):**

```typescript
import { withNeonTestBranch } from '../../config/vitest/test-setup';

withNeonTestBranch(); // Add this

describe('MyService', () => {
  let db: Database;

  beforeAll(async () => {
    db = setupTestDatabase();
  });

  // Remove beforeEach cleanup - not needed!

  afterAll(async () => {
    await teardownTestDatabase(); // Just close connections
  });

  // Update tests to be idempotent (create their own data)
});
```

### Migration Checklist

- [ ] Add `withNeonTestBranch()` at top of test file
- [ ] Enable `enableNeonTesting: true` in vitest config
- [ ] Remove `beforeEach(cleanupDatabase)` calls
- [ ] Change `afterAll(cleanupDatabase)` to `afterAll(teardownTestDatabase)`
- [ ] Update tests to create their own data (idempotent)
- [ ] Remove hard-coded expectations (e.g., `.toHaveLength(5)`)
- [ ] Set `NEON_API_KEY` and `NEON_PROJECT_ID` in `.env.dev`

## Troubleshooting

### Tests fail with "DATABASE_URL not set"

**Solution**: Ensure `withNeonTestBranch()` is called at the top level:

```typescript
import { withNeonTestBranch } from '../../config/vitest/test-setup';

withNeonTestBranch(); // Must be here, not inside describe()

describe('MyService', () => {
  // tests
});
```

### Tests fail with "NEON_API_KEY is required"

**Solution**: Set environment variables in `.env.dev`:

```bash
NEON_API_KEY=your_key_here
NEON_PROJECT_ID=your_project_id_here
```

### Tests are slow

**Symptoms**: Tests take longer than expected

**Solution**: neon-testing provisions branches quickly (~2s), but:
- Ensure tests are idempotent (don't retry on failures)
- Check network latency to Neon
- Verify tests aren't doing unnecessary database operations

### Hard-coded expectations fail randomly

**Symptoms**: Tests expect `.toHaveLength(5)` but get 6 or 7

**Solution**: Make tests idempotent - create and verify your own data:

```typescript
// ❌ Bad
expect(result.items).toHaveLength(5);

// ✅ Good
const created = [item1, item2, item3];
expect(result.items).toEqual(expect.arrayContaining(
  created.map(item => expect.objectContaining({ id: item.id }))
));
```

### Branch quota exceeded

**Symptoms**: "Maximum number of branches exceeded"

**Solution**:
- Branches are auto-deleted after tests
- Check for hanging test processes
- Manually delete old branches via Neon console
- Contact Neon support to increase quota

## Examples

### Example: Service Tests

See [packages/identity/src/services/__tests__/organization-service.test.ts](../../packages/identity/src/services/__tests__/organization-service.test.ts) for a complete example.

### Example: Integration Tests

See [packages/content/src/__tests__/integration.test.ts](../../packages/content/src/__tests__/integration.test.ts) for cross-service integration tests.

## Additional Resources

- [neon-testing GitHub](https://github.com/starmode-base/neon-testing)
- [Neon Testing Blog Post](https://neon.com/blog/neon-testing-a-vitest-library-for-your-integration-tests)
- [Vitest Documentation](https://vitest.dev)
- [Test Engineer Agent](.claude/agents/test-engineer.md) - Internal testing standards
