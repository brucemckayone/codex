# Content Access Testing Definition

**Feature**: Content Access & Playback (P1-ACCESS-001)
**Last Updated**: 2025-11-05

---

## Overview

This document defines the testing strategy for content access features, covering access control, signed URLs, and playback progress tracking.

**Key Testing Principles**:
- Mock R2 for unit tests
- Test access control (free vs. paid content)
- Test signed URL expiry
- Test playback progress upsert pattern

---

## Test Categories

### 1. Validation Tests (Pure Functions)

**Location**: `packages/validation/src/schemas/access.test.ts`

**Example Tests**:

```typescript
import { describe, it, expect } from 'vitest';
import {
  getStreamingUrlSchema,
  savePlaybackProgressSchema,
  listUserLibrarySchema,
} from './access';

describe('Access Validation Schemas', () => {
  describe('getStreamingUrlSchema', () => {
    it('should validate valid input', () => {
      const result = getStreamingUrlSchema.parse({
        contentId: '123e4567-e89b-12d3-a456-426614174000',
        expirySeconds: 3600,
      });

      expect(result.expirySeconds).toBe(3600);
    });

    it('should use default expiry', () => {
      const result = getStreamingUrlSchema.parse({
        contentId: '123e4567-e89b-12d3-a456-426614174000',
      });

      expect(result.expirySeconds).toBe(3600); // 1 hour default
    });

    it('should enforce expiry bounds', () => {
      expect(() =>
        getStreamingUrlSchema.parse({
          contentId: '123e4567-e89b-12d3-a456-426614174000',
          expirySeconds: 100, // Too short (< 300)
        })
      ).toThrow(/Minimum expiry is 5 minutes/);

      expect(() =>
        getStreamingUrlSchema.parse({
          contentId: '123e4567-e89b-12d3-a456-426614174000',
          expirySeconds: 100000, // Too long (> 86400)
        })
      ).toThrow(/Maximum expiry is 24 hours/);
    });
  });

  describe('savePlaybackProgressSchema', () => {
    it('should validate valid progress', () => {
      const result = savePlaybackProgressSchema.parse({
        contentId: '123e4567-e89b-12d3-a456-426614174000',
        currentPositionSeconds: 120,
        durationSeconds: 600,
        completed: false,
      });

      expect(result.currentPositionSeconds).toBe(120);
    });

    it('should reject negative position', () => {
      expect(() =>
        savePlaybackProgressSchema.parse({
          contentId: '123e4567-e89b-12d3-a456-426614174000',
          currentPositionSeconds: -10,
          durationSeconds: 600,
        })
      ).toThrow(/Position cannot be negative/);
    });

    it('should default completed to false', () => {
      const result = savePlaybackProgressSchema.parse({
        contentId: '123e4567-e89b-12d3-a456-426614174000',
        currentPositionSeconds: 120,
        durationSeconds: 600,
      });

      expect(result.completed).toBe(false);
    });
  });
});
```

---

### 2. Content Access Service Tests (Mocked R2)

**Location**: `packages/content-access/src/service.test.ts`

**Example Tests**:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentAccessService } from './service';

describe('ContentAccessService', () => {
  let mockDb: any;
  let mockR2: any;
  let mockObs: any;
  let service: ContentAccessService;

  beforeEach(() => {
    mockDb = {
      query: {
        content: { findFirst: vi.fn() },
        contentPurchases: { findFirst: vi.fn() },
        videoPlayback: { findFirst: vi.fn(), findMany: vi.fn() },
      },
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        })),
      })),
    };

    mockR2 = {
      generateSignedUrl: vi.fn().mockResolvedValue('https://r2.example.com/signed-url?sig=abc123'),
    };

    mockObs = {
      info: vi.fn(),
      warn: vi.fn(),
    };

    service = new ContentAccessService({
      db: mockDb,
      r2: mockR2,
      obs: mockObs,
      organizationId: 'org-123',
    });
  });

  describe('getStreamingUrl', () => {
    it('should generate URL for free content without purchase check', async () => {
      mockDb.query.content.findFirst.mockResolvedValue({
        id: 'content-123',
        priceCents: 0, // Free content
        status: 'published',
        deletedAt: null,
        mediaItem: { r2Path: 'videos/sample.mp4' },
      });

      const result = await service.getStreamingUrl('user-123', {
        contentId: 'content-123',
        expirySeconds: 3600,
      });

      expect(result.streamingUrl).toBe('https://r2.example.com/signed-url?sig=abc123');
      expect(mockDb.query.contentPurchases.findFirst).not.toHaveBeenCalled();
      expect(mockR2.generateSignedUrl).toHaveBeenCalledWith('videos/sample.mp4', 3600);
    });

    it('should require purchase for paid content', async () => {
      mockDb.query.content.findFirst.mockResolvedValue({
        id: 'content-123',
        priceCents: 999, // Paid content
        status: 'published',
        deletedAt: null,
        mediaItem: { r2Path: 'videos/sample.mp4' },
      });

      mockDb.query.contentPurchases.findFirst.mockResolvedValue(null); // No purchase

      await expect(
        service.getStreamingUrl('user-123', {
          contentId: 'content-123',
          expirySeconds: 3600,
        })
      ).rejects.toThrow('ACCESS_DENIED');
    });

    it('should generate URL for purchased content', async () => {
      mockDb.query.content.findFirst.mockResolvedValue({
        id: 'content-123',
        priceCents: 999,
        status: 'published',
        deletedAt: null,
        mediaItem: { r2Path: 'videos/sample.mp4' },
      });

      mockDb.query.contentPurchases.findFirst.mockResolvedValue({
        id: 'purchase-123',
        status: 'completed',
      });

      const result = await service.getStreamingUrl('user-123', {
        contentId: 'content-123',
        expirySeconds: 7200,
      });

      expect(result.streamingUrl).toBeDefined();
      expect(mockR2.generateSignedUrl).toHaveBeenCalledWith('videos/sample.mp4', 7200);
    });

    it('should throw CONTENT_NOT_FOUND for missing content', async () => {
      mockDb.query.content.findFirst.mockResolvedValue(null);

      await expect(
        service.getStreamingUrl('user-123', {
          contentId: 'missing-123',
          expirySeconds: 3600,
        })
      ).rejects.toThrow('CONTENT_NOT_FOUND');
    });

    it('should not allow access to unpublished content', async () => {
      mockDb.query.content.findFirst.mockResolvedValue(null); // findFirst filters by status='published'

      await expect(
        service.getStreamingUrl('user-123', {
          contentId: 'draft-content-123',
          expirySeconds: 3600,
        })
      ).rejects.toThrow('CONTENT_NOT_FOUND');
    });

    it('should not allow access to soft-deleted content', async () => {
      mockDb.query.content.findFirst.mockResolvedValue(null); // findFirst filters by deletedAt IS NULL

      await expect(
        service.getStreamingUrl('user-123', {
          contentId: 'deleted-content-123',
          expirySeconds: 3600,
        })
      ).rejects.toThrow('CONTENT_NOT_FOUND');
    });
  });

  describe('savePlaybackProgress', () => {
    it('should upsert playback progress', async () => {
      await service.savePlaybackProgress('user-123', {
        contentId: 'content-123',
        currentPositionSeconds: 120,
        durationSeconds: 600,
        completed: false,
      });

      expect(mockDb.insert).toHaveBeenCalled();

      // Verify upsert pattern (onConflictDoUpdate)
      const insertCall = mockDb.insert.mock.results[0].value;
      expect(insertCall.values).toHaveBeenCalled();
      const valuesResult = insertCall.values.mock.results[0].value;
      expect(valuesResult.onConflictDoUpdate).toHaveBeenCalled();
    });

    it('should include all required fields', async () => {
      await service.savePlaybackProgress('user-123', {
        contentId: 'content-123',
        currentPositionSeconds: 120,
        durationSeconds: 600,
        completed: false,
      });

      const insertCall = mockDb.insert.mock.calls[0];
      const valuesCall = insertCall[0]().values.mock.calls[0];
      const data = valuesCall[0];

      expect(data.customerId).toBe('user-123');
      expect(data.contentId).toBe('content-123');
      expect(data.currentPositionSeconds).toBe(120);
      expect(data.durationSeconds).toBe(600);
      expect(data.completed).toBe(false);
      expect(data.lastWatchedAt).toBeInstanceOf(Date);
    });
  });

  describe('getPlaybackProgress', () => {
    it('should return progress if exists', async () => {
      mockDb.query.videoPlayback.findFirst.mockResolvedValue({
        currentPositionSeconds: 120,
        durationSeconds: 600,
        completed: false,
        lastWatchedAt: new Date('2025-01-01'),
      });

      const progress = await service.getPlaybackProgress('user-123', {
        contentId: 'content-123',
      });

      expect(progress).toEqual({
        currentPositionSeconds: 120,
        durationSeconds: 600,
        completed: false,
        lastWatchedAt: new Date('2025-01-01'),
      });
    });

    it('should return null if no progress exists', async () => {
      mockDb.query.videoPlayback.findFirst.mockResolvedValue(null);

      const progress = await service.getPlaybackProgress('user-123', {
        contentId: 'content-123',
      });

      expect(progress).toBeNull();
    });
  });

  describe('listUserLibrary', () => {
    it('should list purchased content with progress', async () => {
      mockDb.query.contentPurchases.findMany.mockResolvedValue([
        {
          contentId: 'content-1',
          priceCents: 999,
          createdAt: new Date('2025-01-01'),
          content: {
            id: 'content-1',
            title: 'Video 1',
            description: 'Description 1',
            mediaItem: { thumbnailUrl: 'https://example.com/thumb1.jpg' },
          },
        },
      ]);

      mockDb.query.videoPlayback.findMany.mockResolvedValue([
        {
          contentId: 'content-1',
          currentPositionSeconds: 120,
          durationSeconds: 600,
          completed: false,
          lastWatchedAt: new Date('2025-01-02'),
        },
      ]);

      const result = await service.listUserLibrary('user-123', {
        page: 1,
        limit: 20,
        filter: 'all',
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].content.title).toBe('Video 1');
      expect(result.items[0].progress?.currentPositionSeconds).toBe(120);
    });

    it('should handle missing progress gracefully', async () => {
      mockDb.query.contentPurchases.findMany.mockResolvedValue([
        {
          contentId: 'content-1',
          priceCents: 999,
          createdAt: new Date('2025-01-01'),
          content: {
            id: 'content-1',
            title: 'Video 1',
            description: 'Description 1',
            mediaItem: { thumbnailUrl: 'https://example.com/thumb1.jpg' },
          },
        },
      ]);

      mockDb.query.videoPlayback.findMany.mockResolvedValue([]); // No progress

      const result = await service.listUserLibrary('user-123', {
        page: 1,
        limit: 20,
        filter: 'all',
      });

      expect(result.items[0].progress).toBeNull();
    });
  });
});
```

---

### 3. API Integration Tests

**Location**: `workers/auth/src/routes/content-access.integration.test.ts`

**Example Tests**:

```typescript
import { describe, it, expect } from 'vitest';
import app from '../index';

describe('Content Access API Integration', () => {
  it('should return streaming URL for purchased content', async () => {
    const request = new Request('http://localhost/api/content/content-123/stream', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer valid-token',
      },
    });

    const env = {
      DATABASE_URL: process.env.DATABASE_URL,
      R2_BUCKET: mockR2Bucket,
      ENVIRONMENT: 'test',
    };

    const response = await app.fetch(request, env);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.streamingUrl).toContain('r2.example.com');
    expect(body.expiresAt).toBeDefined();
  });

  it('should return 403 for unpurchased paid content', async () => {
    const request = new Request('http://localhost/api/content/unpurchased-123/stream', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer valid-token',
      },
    });

    const env = { /* ... */ };

    const response = await app.fetch(request, env);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe('ACCESS_DENIED');
  });

  it('should require authentication', async () => {
    const request = new Request('http://localhost/api/content/content-123/stream', {
      method: 'GET',
      // No Authorization header
    });

    const env = { /* ... */ };

    const response = await app.fetch(request, env);

    expect(response.status).toBe(401);
  });
});
```

---

## Test Data Factories

**Location**: `packages/test-utils/src/factories/access.ts`

```typescript
import { faker } from '@faker-js/faker';

export function createMockPlaybackProgress(overrides?: Partial<VideoPlayback>): VideoPlayback {
  return {
    customerId: faker.string.uuid(),
    contentId: faker.string.uuid(),
    organizationId: 'test-org',
    currentPositionSeconds: faker.number.int({ min: 0, max: 3600 }),
    durationSeconds: 3600,
    completed: faker.datatype.boolean(),
    lastWatchedAt: faker.date.recent(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
```

---

## Common Testing Patterns

### Pattern 1: Test Free vs. Paid Access

```typescript
it('should allow free content without purchase', async () => {
  mockDb.query.content.findFirst.mockResolvedValue({
    priceCents: 0, // Free
  });

  const result = await service.getStreamingUrl('user-123', {
    contentId: 'free-content-123',
    expirySeconds: 3600,
  });

  expect(result.streamingUrl).toBeDefined();
  expect(mockDb.query.contentPurchases.findFirst).not.toHaveBeenCalled();
});

it('should deny paid content without purchase', async () => {
  mockDb.query.content.findFirst.mockResolvedValue({
    priceCents: 999, // Paid
  });

  mockDb.query.contentPurchases.findFirst.mockResolvedValue(null);

  await expect(
    service.getStreamingUrl('user-123', {
      contentId: 'paid-content-123',
      expirySeconds: 3600,
    })
  ).rejects.toThrow('ACCESS_DENIED');
});
```

### Pattern 2: Test Signed URL Expiry

```typescript
it('should respect expiry parameter', async () => {
  mockDb.query.content.findFirst.mockResolvedValue({
    priceCents: 0,
    mediaItem: { r2Path: 'videos/test.mp4' },
  });

  await service.getStreamingUrl('user-123', {
    contentId: 'content-123',
    expirySeconds: 7200, // 2 hours
  });

  expect(mockR2.generateSignedUrl).toHaveBeenCalledWith('videos/test.mp4', 7200);
});
```

### Pattern 3: Test Upsert Pattern

```typescript
it('should update existing progress', async () => {
  // First save
  await service.savePlaybackProgress('user-123', {
    contentId: 'content-123',
    currentPositionSeconds: 60,
    durationSeconds: 600,
  });

  // Second save (update)
  await service.savePlaybackProgress('user-123', {
    contentId: 'content-123',
    currentPositionSeconds: 120, // Updated position
    durationSeconds: 600,
  });

  // Should use upsert pattern (onConflictDoUpdate)
  const insertCalls = mockDb.insert.mock.calls;
  expect(insertCalls).toHaveLength(2);
});
```

---

## Running Tests

```bash
# Run access validation tests
pnpm --filter @codex/validation test

# Run access service tests
pnpm --filter @codex/content-access test

# Run API integration tests
pnpm --filter auth-worker test:integration
```

---

## Troubleshooting

**Problem**: R2 signed URL generation fails in tests
**Solution**: Mock R2Service.generateSignedUrl() to return test URL

**Problem**: Access denied for free content
**Solution**: Ensure priceCents = 0 check bypasses purchase verification

**Problem**: Playback progress not upserting
**Solution**: Check onConflictDoUpdate target matches composite primary key

---

**Last Updated**: 2025-11-05
