# Content Management Testing Definition

**Feature**: Content Management (P1-CONTENT-001)
**Last Updated**: 2025-11-05

---

## Overview

This document defines the testing strategy for content management features, covering validation, service layer, and API endpoints.

**Key Testing Principles**:
- Validation tests are pure (no DB dependency)
- Service tests use mocked DB for unit testing
- Integration tests use real DB with ephemeral Neon branches (CI only)
- Test data factories for consistent test data

---

## Test Categories

### 1. Validation Tests (Pure Functions)

**Location**: `packages/validation/src/schemas/content.test.ts`

**What to Test**:
- Schema validation success cases
- Schema validation failure cases
- Edge cases (empty strings, max lengths, special characters)
- Type coercion and defaults

**Example Tests**:

```typescript
import { describe, it, expect } from 'vitest';
import { createContentSchema, updateContentSchema } from './content';

describe('Content Validation Schemas', () => {
  describe('createContentSchema', () => {
    it('should validate valid content data', () => {
      const result = createContentSchema.parse({
        title: 'Test Video',
        slug: 'test-video',
        description: 'A test video',
        mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
        categoryId: '123e4567-e89b-12d3-a456-426614174001',
        priceCents: 999,
        status: 'draft',
      });

      expect(result.title).toBe('Test Video');
      expect(result.priceCents).toBe(999);
    });

    it('should reject invalid title', () => {
      expect(() =>
        createContentSchema.parse({
          title: '', // Empty
          slug: 'test',
          description: 'Test',
          mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
          categoryId: '123e4567-e89b-12d3-a456-426614174001',
        })
      ).toThrow(/Title is required/);
    });

    it('should reject negative price', () => {
      expect(() =>
        createContentSchema.parse({
          title: 'Test',
          slug: 'test',
          description: 'Test',
          mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
          categoryId: '123e4567-e89b-12d3-a456-426614174001',
          priceCents: -100, // Negative
        })
      ).toThrow(/Price cannot be negative/);
    });

    it('should validate slug format', () => {
      expect(() =>
        createContentSchema.parse({
          title: 'Test',
          slug: 'Invalid Slug!', // Spaces and special chars
          description: 'Test',
          mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
          categoryId: '123e4567-e89b-12d3-a456-426614174001',
        })
      ).toThrow(/Invalid slug format/);
    });

    it('should default priceCents to 0', () => {
      const result = createContentSchema.parse({
        title: 'Free Content',
        slug: 'free-content',
        description: 'Free',
        mediaItemId: '123e4567-e89b-12d3-a456-426614174000',
        categoryId: '123e4567-e89b-12d3-a456-426614174001',
        // priceCents omitted
      });

      expect(result.priceCents).toBe(0);
    });
  });
});
```

**Coverage Requirements**:
- 100% branch coverage for validation schemas
- Test all validation rules (min, max, regex, enum)
- Test default values
- Test optional fields

---

### 2. Service Tests (Mocked DB)

**Location**: `packages/content/src/service.test.ts`

**What to Test**:
- Business logic in isolation
- Error handling
- Organization scoping
- Observability logging

**Example Tests**:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentService } from './service';

describe('ContentService', () => {
  let mockDb: any;
  let mockR2: any;
  let mockObs: any;
  let service: ContentService;

  beforeEach(() => {
    mockDb = {
      query: {
        content: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
      },
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: 'content-123' }]),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(undefined),
        })),
      })),
    };

    mockR2 = {
      uploadFile: vi.fn().mockResolvedValue(undefined),
    };

    mockObs = {
      info: vi.fn(),
      warn: vi.fn(),
      trackError: vi.fn(),
    };

    service = new ContentService({
      db: mockDb,
      r2: mockR2,
      obs: mockObs,
      organizationId: 'org-123',
    });
  });

  describe('createContent', () => {
    it('should create content with generated ID', async () => {
      const result = await service.createContent({
        title: 'Test Video',
        slug: 'test-video',
        description: 'Test',
        mediaItemId: 'media-123',
        categoryId: 'category-123',
        priceCents: 999,
      });

      expect(mockDb.insert).toHaveBeenCalled();
      expect(result.id).toBe('content-123');
    });

    it('should enforce organization scoping', async () => {
      await service.createContent({
        title: 'Test',
        slug: 'test',
        description: 'Test',
        mediaItemId: 'media-123',
        categoryId: 'category-123',
      });

      // Verify organizationId was included in insert
      const insertCall = mockDb.insert.mock.calls[0];
      const valuesCall = insertCall[0]().values.mock.calls[0];
      expect(valuesCall[0].organizationId).toBe('org-123');
    });

    it('should log creation', async () => {
      await service.createContent({
        title: 'Test',
        slug: 'test',
        description: 'Test',
        mediaItemId: 'media-123',
        categoryId: 'category-123',
      });

      expect(mockObs.info).toHaveBeenCalledWith(
        'Creating content',
        expect.objectContaining({
          title: 'Test',
        })
      );
    });
  });

  describe('publishContent', () => {
    it('should set status to published and set publishedAt', async () => {
      await service.publishContent('content-123');

      expect(mockDb.update).toHaveBeenCalled();
      const setCall = mockDb.update().set.mock.calls[0];
      expect(setCall[0].status).toBe('published');
      expect(setCall[0].publishedAt).toBeInstanceOf(Date);
    });

    it('should enforce organization scoping on update', async () => {
      await service.publishContent('content-123');

      // Verify where clause includes organizationId
      const whereCall = mockDb.update().set().where.mock.calls[0];
      // Check that where clause includes organization check
      expect(mockObs.info).toHaveBeenCalledWith(
        'Publishing content',
        expect.objectContaining({
          contentId: 'content-123',
        })
      );
    });
  });
});
```

**Coverage Requirements**:
- 80% minimum branch coverage for service logic
- Test all public methods
- Test error paths
- Verify organization scoping
- Verify observability logging

---

### 3. Integration Tests (Real DB)

**Location**: `packages/content/src/service.integration.test.ts`

**What to Test**:
- End-to-end database operations
- Foreign key constraints
- Unique constraints
- Soft delete behavior

**Example Tests**:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getContentService } from './service';
import { getDbClient } from '@codex/database';

describe('ContentService Integration', () => {
  let db: any;
  let service: any;
  const testOrgId = 'test-org-123';

  beforeAll(async () => {
    // Use test database URL from environment
    db = getDbClient(process.env.DATABASE_URL!);

    service = getContentService({
      DATABASE_URL: process.env.DATABASE_URL!,
      R2_BUCKET: mockR2Bucket,
      ENVIRONMENT: 'test',
      ORGANIZATION_ID: testOrgId,
    });

    // Clean up test data
    await db.delete(content).where(eq(content.organizationId, testOrgId));
  });

  afterAll(async () => {
    // Clean up
    await db.delete(content).where(eq(content.organizationId, testOrgId));
  });

  it('should create and retrieve content', async () => {
    const created = await service.createContent({
      title: 'Integration Test Video',
      slug: 'integration-test',
      description: 'Test',
      mediaItemId: 'media-123',
      categoryId: 'category-123',
      priceCents: 999,
    });

    expect(created.id).toBeDefined();

    const retrieved = await service.getContent(created.id);
    expect(retrieved.title).toBe('Integration Test Video');
  });

  it('should enforce unique slug per organization', async () => {
    await service.createContent({
      title: 'First',
      slug: 'duplicate-test',
      description: 'Test',
      mediaItemId: 'media-123',
      categoryId: 'category-123',
    });

    await expect(
      service.createContent({
        title: 'Second',
        slug: 'duplicate-test', // Same slug
        description: 'Test',
        mediaItemId: 'media-123',
        categoryId: 'category-123',
      })
    ).rejects.toThrow();
  });
});
```

**Coverage Requirements**:
- Test database constraints
- Test transactions (if applicable)
- Test foreign key relationships
- Clean up test data

---

## Test Data Factories

**Location**: `packages/test-utils/src/factories/content.ts`

**Purpose**: Generate consistent test data

```typescript
import { faker } from '@faker-js/faker';

export function createMockContent(overrides?: Partial<Content>): Content {
  return {
    id: faker.string.uuid(),
    organizationId: 'test-org',
    title: faker.lorem.words(3),
    slug: faker.helpers.slugify(faker.lorem.words(3)).toLowerCase(),
    description: faker.lorem.paragraph(),
    mediaItemId: faker.string.uuid(),
    categoryId: faker.string.uuid(),
    priceCents: faker.number.int({ min: 0, max: 10000 }),
    status: 'draft',
    publishedAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createMockContentInput(overrides?: Partial<CreateContentInput>): CreateContentInput {
  return {
    title: faker.lorem.words(3),
    slug: faker.helpers.slugify(faker.lorem.words(3)).toLowerCase(),
    description: faker.lorem.paragraph(),
    mediaItemId: faker.string.uuid(),
    categoryId: faker.string.uuid(),
    priceCents: faker.number.int({ min: 0, max: 10000 }),
    ...overrides,
  };
}
```

---

## Common Testing Patterns

### Pattern 1: Test Organization Scoping

```typescript
it('should only return content for organization', async () => {
  mockDb.query.content.findMany.mockResolvedValue([
    { id: '1', organizationId: 'org-123' },
    { id: '2', organizationId: 'org-123' },
  ]);

  const result = await service.listContent({ page: 1, limit: 10 });

  // Verify organizationId filter was applied
  expect(mockDb.query.content.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.anything(), // Contains organizationId filter
    })
  );
});
```

### Pattern 2: Test Error Handling

```typescript
it('should throw NOT_FOUND for missing content', async () => {
  mockDb.query.content.findFirst.mockResolvedValue(null);

  await expect(service.getContent('missing-123')).rejects.toThrow('CONTENT_NOT_FOUND');
});
```

### Pattern 3: Test Soft Delete

```typescript
it('should not return soft-deleted content', async () => {
  mockDb.query.content.findMany.mockResolvedValue([
    { id: '1', deletedAt: null },
    // Content with deletedAt should be filtered out
  ]);

  const result = await service.listContent({ page: 1, limit: 10 });

  // Verify query includes deletedAt IS NULL
  expect(mockDb.query.content.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.anything(), // Contains deletedAt IS NULL
    })
  );
});
```

---

## Running Tests

```bash
# Run validation tests (fast, no DB)
pnpm --filter @codex/validation test

# Run service tests (fast, mocked DB)
pnpm --filter @codex/content test

# Run integration tests (slow, real DB)
DATABASE_URL=postgresql://... pnpm --filter @codex/content test:integration

# Run all tests
pnpm test

# Run with coverage
pnpm test --coverage
```

---

## CI Integration

Tests run automatically on push via GitHub Actions:

1. **Path Filtering**: Only run content tests if content packages changed
2. **Neon Ephemeral Branch**: Create temporary DB for integration tests
3. **Parallel Execution**: Run validation and service tests in parallel
4. **Coverage Reports**: Upload to CI artifacts

See [CI/CD Guide](../../infrastructure/CICD.md) for details.

---

## Troubleshooting

**Problem**: Test database not available
**Solution**: Ensure `DATABASE_URL` is set in test environment

**Problem**: Tests failing with "Cannot find module"
**Solution**: Run `pnpm install` to ensure all test dependencies are installed

**Problem**: Integration tests leaving data behind
**Solution**: Use `beforeEach`/`afterEach` hooks to clean up test data

---

**Last Updated**: 2025-11-05
