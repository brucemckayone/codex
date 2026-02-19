# Testing Planning Agent Specification

## Domain
Test quality, test patterns, factory usage, coverage, test isolation, unit tests, integration tests.

## Purpose
Generate implementation plans for test coverage ensuring compliance with the Testing PR review agent. Focus on factory usage, test organization, and coverage of critical paths.

## File Patterns to Review
- `**/__tests__/**/*.test.ts` - Test files
- `**/*.test.ts` - Test files
- `**/*.spec.ts` - Spec files
- `packages/test-utils/src/**/*.ts` - Test utilities

## Compliance Standards (PR Review Agents)

Your plans must comply with:
- **Testing Agent**: `.claude/skills/pr-review-agent-team/agents/testing.md`

## Checklist

### Test Organization (CRITICAL)

- [WARN] Test files co-located with source (`__tests__/` subdir)
- [WARN] `describe` blocks organize tests by method
- [WARN] Setup/teardown in `beforeAll`/`afterAll` or `beforeEach`/`afterEach`
- [INFO] Test files named `*.test.ts` matching source file
- [INFO] Integration tests in separate `__tests__` directory

### Test Quality (CRITICAL)

- [WARN] Tests use factories from `@codex/test-utils`
- [WARN] Each test creates own data (idempotent)
- [CRITICAL] Critical paths covered (create, read, update, delete, errors)
- [WARN] Both success and error paths tested
- [WARN] Tests are deterministic (no random data that affects assertions)
- [INFO] Edge cases tested

### Database Testing (CRITICAL)

- [WARN] Use `setupTestDatabase()` for DB setup
- [WARN] Use `dbWs` for test transactions
- [INFO] Test isolation (each test independent)
- [WARN] Clean up test data in `afterEach` or use transactions
- [INFO] Use test database branches in CI

### Factory Usage (CRITICAL)

- [WARN] Use `createTestContent()`, `createTestUser()` etc.
- [INFO] Factories create valid data by default
- [WARN] Custom data via overrides parameter
- [INFO] Factories respect relationships

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

## Plan Output Format

```markdown
## Testing Plan

### Applicable PR Review Agents (Compliance Standards)
- Testing Agent: `.claude/skills/pr-review-agent-team/agents/testing.md`

---

## Unit Tests (Testing Agent Compliance)

### File to Create
- `packages/[domain]/src/services/__tests__/[service]-service.test.ts`

### Implementation Instructions
**Read this pattern first**:
- `packages/content/src/services/__tests__/content-service.test.ts`

**Testing Agent Requirements** (CRITICAL):
- Use factories from `@codex/test-utils`
- Use `setupTestDatabase()` for DB setup
- Test both success and error paths
- Clean up test data in `afterEach`

**Test Structure**:
```typescript
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { setupTestDatabase, createTestUser, createTest[Entity] } from '@codex/test-utils';
import { [Service] } from '../[service]-service';
import { NotFoundError, ConflictError } from '@codex/service-errors';

describe('[Service]', () => {
  let db;
  let service;
  let testUser;

  beforeAll(async () => {
    db = await setupTestDatabase();
    service = new [Service]({ db, environment: 'test' });
    testUser = await createTestUser(db);
  });

  afterEach(async () => {
    // Clean up test data
  });

  describe('[methodName]', () => {
    it('should [success case]', async () => {
      // Test implementation
    });

    it('should throw NotFoundError for [condition]', async () => {
      // Error path test
    });
  });
});
```

**Acceptance Criteria**:
- [ ] Success path tested
- [ ] Error paths tested (404, 403, etc.)
- [ ] Uses factories
- [ ] Tests are isolated

---

## Integration Tests

### File to Create
- `workers/[worker]/src/__tests__/[route]-routes.test.ts`

### Implementation Instructions
**Read this pattern first**:
- `workers/content-api/src/__tests__/content-routes.test.ts`

**Requirements**:
- Test all HTTP methods
- Test auth requirements
- Test validation errors
- Test success responses

**Acceptance Criteria**:
- [ ] POST returns 201 on success
- [ ] Returns 401 without auth
- [ ] Returns 422 with invalid data
- [ ] Uses test helpers for setup

---

## Deep Dive References
- Test factories: `packages/test-utils/src/factories.ts`
- Test database setup: `packages/test-utils/src/database.ts`
- Test auth helpers: `packages/test-utils/src/auth.ts`
- Service test example: `packages/content/src/services/__tests__/content-service.test.ts`
- Integration test example: `workers/content-api/src/__tests__/content-routes.test.ts`
```

## Handoff Instructions

| Finding | Send To |
|---------|---------|
| Tests missing for critical paths | Note in plan as required |
| Integration tests missing for routes | Add to plan |
| Database tests not using factories | Note to use factories |
| Edge cases not covered | Suggest additional tests |

## Critical File References

- `packages/test-utils/src/factories.ts` - Test data factories
- `packages/test-utils/src/database.ts` - `setupTestDatabase()`
- `packages/test-utils/src/auth.ts` - Test auth helpers
- `packages/content/src/services/__tests__/content-service.test.ts` - Service test patterns
- `packages/organization/src/services/__tests__/organization-service.test.ts` - More test patterns
- `vitest.config.ts` - Test configuration
- `playwright.config.ts` - E2E test configuration
