# Testing Agent Specification

## Domain
Test quality, test patterns, factory usage, coverage, test isolation.

## File Patterns to Review
- `**/__tests__/**/*.test.ts`
- `**/*.test.ts`
- `**/*.spec.ts`
- `packages/test-utils/src/**/*.ts`
- `vitest.config.ts`
- `playwright.config.ts`

## Checklist

### Test Organization

**CRITICAL** = Blocking issue, **WARN** = Should fix, **INFO** = Suggestion

- [WARN] Test files co-located with source (`__tests__/` subdir)
- [WARN] Describe blocks organize tests by method
- [WARN] Setup/teardown in `beforeAll`/`afterAll` or `beforeEach`/`afterEach`
- [INFO] Test files named `*.test.ts` matching source file
- [INFO] Integration tests in separate `__tests__` directory

### Test Quality

- [WARN] Tests use factories from `@codex/test-utils`
- [WARN] Each test creates own data (idempotent)
- [CRITICAL] Critical paths covered (create, read, update, delete, errors)
- [WARN] Both success and error paths tested
- [WARN] Tests are deterministic (no random data that affects assertions)
- [INFO] Edge cases tested

### Database Testing

- [WARN] Use `setupTestDatabase()` for DB setup
- [WARN] Use `dbWs` for test transactions
- [INFO] Test isolation (each test independent)
- [WARN] Clean up test data in `afterEach` or use transactions
- [INFO] Use test database branches in CI

### Factory Usage

- [WARN] Use `createTestContent()`, `seedTestUsers()` etc.
- [INFO] Factories create valid data by default
- [WARN] Custom data via overrides parameter
- [INFO] Factories respect relationships

### Test Coverage

- [INFO] Critical business logic has tests
- [WARN] New features include tests
- [INFO] Error paths tested
- [INFO] Edge cases considered

### Integration Tests

- [WARN] API endpoints have integration tests
- [INFO] Playwright tests for critical user flows
- [WARN] Mock external APIs (Stripe, RunPod) appropriately
- [INFO] Test environment variables configured

## Code Examples

### Correct: Test Structure with Factories
```typescript
// packages/content/src/services/__tests__/content-service.test.ts
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { setupTestDatabase, createTestContent, createTestUser } from '@codex/test-utils';
import { ContentService } from '../content-service';
import { NotFoundError, ConflictError } from '@codex/service-errors';

describe('ContentService', () => {
  let db;
  let service;
  let testUser;

  beforeAll(async () => {
    db = await setupTestDatabase();
    service = new ContentService({ db, environment: 'test' });
    testUser = await createTestUser(db);
  });

  afterEach(async () => {
    await db.delete(contentTable);
  });

  describe('create', () => {
    it('should create content successfully', async () => {
      const data = {
        title: 'Test Content',
        slug: 'test-content',
        type: 'article'
      };

      const result = await service.create(testUser.id, data);

      expect(result).toMatchObject({
        id: expect.any(String),
        title: data.title,
        slug: data.slug,
        creatorId: testUser.id
      });
    });

    it('should throw ConflictError for duplicate slug', async () => {
      const data = {
        title: 'Test Content',
        slug: 'duplicate-slug',
        type: 'article'
      };

      await service.create(testUser.id, data);

      await expect(
        service.create(testUser.id, data)
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('getById', () => {
    it('should return content for valid ID', async () => {
      const content = await createTestContent(db, { creatorId: testUser.id });

      const result = await service.getById(content.id, testUser.id);

      expect(result.id).toBe(content.id);
    });

    it('should throw NotFoundError for non-existent ID', async () => {
      await expect(
        service.getById('non-existent', testUser.id)
      ).rejects.toThrow(NotFoundError);
    });

    it('should not return content from other creators', async () => {
      const otherUser = await createTestUser(db);
      const content = await createTestContent(db, { creatorId: otherUser.id });

      await expect(
        service.getById(content.id, testUser.id)
      ).rejects.toThrow(NotFoundError);
    });
  });
});
```

### Incorrect: Missing Error Path Tests
```typescript
// ❌ WARN: Only success path tested
describe('ContentService.create', () => {
  it('should create content successfully', async () => {
    const result = await service.create(testUser.id, data);
    expect(result).toHaveProperty('id');
  });
  // Missing: duplicate slug, invalid data, etc.
});
```

### Incorrect: Hardcoded Test Data
```typescript
// ❌ WARN: Should use factories
describe('ContentService', () => {
  it('should create content', async () => {
    const user = await db.insert(usersTable).values({
      id: '123',
      email: 'test@example.com',
      name: 'Test User',
      createdAt: new Date(),
      updatedAt: new Date()
    }).returning();

    const result = await service.create(user[0].id, contentData);
    // ...
  });
});
```

### Correct: Integration Test for API
```typescript
// workers/content-api/src/__tests__/content-routes.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestApp, createTestUser, authenticateTestUser } from '@codex/test-utils';
import { contentRoutes } from '../routes/content';

describe('Content API Routes', () => {
  let app;
  let testUser;
  let sessionCookie;

  beforeAll(async () => {
    app = await createTestApp(contentRoutes);
    testUser = await createTestUser(app.db);
    sessionCookie = await authenticateTestUser(app, testUser);
  });

  describe('POST /content', () => {
    it('should create content and return 201', async () => {
      const response = await app.request('/content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': sessionCookie
        },
        body: JSON.stringify({
          title: 'Test Content',
          slug: 'test-content',
          type: 'article'
        })
      });

      expect(response.status).toBe(201);
      const json = await response.json();
      expect(json.data).toHaveProperty('id');
    });

    it('should return 401 without auth', async () => {
      const response = await app.request('/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test' })
      });

      expect(response.status).toBe(401);
    });
  });
});
```

## Handoff Instructions

| Finding | Send To |
|---------|---------|
| Tests missing for critical paths | `service-reviewer` |
| Integration tests missing for routes | `worker-reviewer` |
| Database tests not using factories | `database-reviewer` |

## Critical File References

- `packages/test-utils/src/factories.ts` - Test data factories
- `packages/test-utils/src/database.ts` - `setupTestDatabase()`
- `packages/test-utils/src/auth.ts` - Test auth helpers
- `packages/content/src/services/__tests__/content-service.test.ts` - Service test patterns
- `packages/organization/src/services/__tests__/organization-service.test.ts` - More test patterns
- `vitest.config.ts` - Test configuration
