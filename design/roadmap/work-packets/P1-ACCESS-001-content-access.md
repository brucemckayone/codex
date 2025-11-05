# Work Packet: P1-ACCESS-001 - Content Access & Playback

**Status**: 🚧 To Be Implemented
**Priority**: P0 (Critical - content delivery)
**Estimated Effort**: 3-4 days
**Branch**: `feature/P1-ACCESS-001-content-access`

---

## Current State

**✅ Already Implemented:**
- R2 client with signed URL generation (`packages/cloudflare-clients/src/r2/client.ts`)
- Content schema from P1-CONTENT-001
- Purchase schema from P1-ECOM-001
- Authentication middleware (user context available)

**🚧 Needs Implementation:**
- Content access service (check purchase, generate streaming URLs)
- Playback progress tracking schema
- Playback progress API (save/retrieve position)
- User library API (list purchased content)
- Tests

---

## Dependencies

### Required Work Packets
- **P1-CONTENT-001** (Content Service) - MUST complete first for content schema
- **P1-ECOM-001** (Stripe Checkout) - MUST complete first for purchase checking

### Existing Code
```typescript
// Already available in packages/cloudflare-clients/src/r2/client.ts
import { R2Service } from '@codex/cloudflare-clients/r2';

const r2 = new R2Service(env.R2_BUCKET);
const signedUrl = await r2.generateSignedUrl('path/to/video.mp4', 3600); // 1 hour expiry
```

### Required Documentation
- [R2 Storage Patterns](../../core/R2_STORAGE_PATTERNS.md)
- [Access Control Patterns](../../core/ACCESS_CONTROL_PATTERNS.md)
- [Content Access TDD](../../features/content-access/ttd-dphase-1.md)
- [STANDARDS.md](../STANDARDS.md)

---

## Implementation Steps

### Step 1: Create Playback Progress Schema

**File**: `packages/database/src/schema/playback.ts`

```typescript
import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { content } from './content';

/**
 * Tracks playback progress for video/audio content
 *
 * Design decisions:
 * - Composite primary key (customerId + contentId) for upsert pattern
 * - Progress in seconds (not percentage) for accuracy
 * - Duration stored for progress calculation
 * - lastWatchedAt for "continue watching" features
 * - Organization-scoped for multi-tenancy
 */
export const videoPlayback = pgTable('video_playback', {
  customerId: text('customer_id').notNull(),
  contentId: text('content_id').notNull()
    .references(() => content.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').notNull(),

  // Playback state
  currentPositionSeconds: integer('current_position_seconds').notNull().default(0),
  durationSeconds: integer('duration_seconds').notNull(),
  completed: boolean('completed').notNull().default(false),

  // Metadata
  lastWatchedAt: timestamp('last_watched_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => ({
  pk: primaryKey({ columns: [table.customerId, table.contentId] }),
}));

export const videoPlaybackRelations = relations(videoPlayback, ({ one }) => ({
  content: one(content, {
    fields: [videoPlayback.contentId],
    references: [content.id],
  }),
}));
```

**Migration**: `packages/database/migrations/XXXX_create_video_playback.sql`

```sql
CREATE TABLE video_playback (
  customer_id TEXT NOT NULL,
  content_id TEXT NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  current_position_seconds INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  last_watched_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (customer_id, content_id)
);

CREATE INDEX idx_video_playback_customer ON video_playback(customer_id);
CREATE INDEX idx_video_playback_organization ON video_playback(organization_id);
CREATE INDEX idx_video_playback_last_watched ON video_playback(customer_id, last_watched_at DESC);
```

### Step 2: Create Access Validation Schemas

**File**: `packages/validation/src/schemas/access.ts`

```typescript
import { z } from 'zod';

/**
 * ✅ TESTABLE: Pure validation schemas (no DB dependency)
 */

export const getStreamingUrlSchema = z.object({
  contentId: z.string().uuid('Invalid content ID'),
  expirySeconds: z.number()
    .int('Expiry must be integer')
    .min(300, 'Minimum expiry is 5 minutes')
    .max(86400, 'Maximum expiry is 24 hours')
    .optional()
    .default(3600), // 1 hour default
});

export const savePlaybackProgressSchema = z.object({
  contentId: z.string().uuid('Invalid content ID'),
  currentPositionSeconds: z.number()
    .int('Position must be integer')
    .min(0, 'Position cannot be negative'),
  durationSeconds: z.number()
    .int('Duration must be integer')
    .min(1, 'Duration must be at least 1 second'),
  completed: z.boolean().optional().default(false),
});

export const getPlaybackProgressSchema = z.object({
  contentId: z.string().uuid('Invalid content ID'),
});

export const listUserLibrarySchema = z.object({
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(20),
  filter: z.enum(['all', 'in-progress', 'completed']).optional().default('all'),
});

export type GetStreamingUrlInput = z.infer<typeof getStreamingUrlSchema>;
export type SavePlaybackProgressInput = z.infer<typeof savePlaybackProgressSchema>;
export type GetPlaybackProgressInput = z.infer<typeof getPlaybackProgressSchema>;
export type ListUserLibraryInput = z.infer<typeof listUserLibrarySchema>;
```

### Step 3: Create Content Access Service

**File**: `packages/content-access/src/service.ts`

```typescript
import { eq, and, desc } from 'drizzle-orm';
import type { DrizzleClient } from '@codex/database';
import { content, contentPurchases, videoPlayback } from '@codex/database/schema';
import { R2Service } from '@codex/cloudflare-clients/r2';
import { ObservabilityClient } from '@codex/observability';
import type {
  GetStreamingUrlInput,
  SavePlaybackProgressInput,
  GetPlaybackProgressInput,
  ListUserLibraryInput,
} from '@codex/validation/schemas/access';

export interface ContentAccessServiceConfig {
  db: DrizzleClient;
  r2: R2Service;
  obs: ObservabilityClient;
  organizationId: string;
}

export class ContentAccessService {
  constructor(private config: ContentAccessServiceConfig) {}

  /**
   * Check if user has access to content and generate signed streaming URL
   *
   * Business rules:
   * - Free content (price = 0): Anyone can access
   * - Paid content: Must have completed purchase
   *
   * @throws {Error} - 'CONTENT_NOT_FOUND', 'ACCESS_DENIED', 'CONTENT_UNAVAILABLE'
   */
  async getStreamingUrl(
    customerId: string,
    input: GetStreamingUrlInput
  ): Promise<{ streamingUrl: string; expiresAt: Date }> {
    const { db, r2, obs, organizationId } = this.config;

    obs.info('Getting streaming URL', {
      customerId,
      contentId: input.contentId,
    });

    // 1. Get content details
    const contentRecord = await db.query.content.findFirst({
      where: and(
        eq(content.id, input.contentId),
        eq(content.organizationId, organizationId),
        eq(content.status, 'published'),
        isNull(content.deletedAt)
      ),
      with: {
        mediaItem: true, // Get R2 path
      },
    });

    if (!contentRecord) {
      obs.warn('Content not found or not published', {
        contentId: input.contentId,
      });
      throw new Error('CONTENT_NOT_FOUND');
    }

    // 2. Check access (free content or purchased)
    if (contentRecord.priceCents > 0) {
      const purchase = await db.query.contentPurchases.findFirst({
        where: and(
          eq(contentPurchases.customerId, customerId),
          eq(contentPurchases.contentId, input.contentId),
          eq(contentPurchases.status, 'completed')
        ),
      });

      if (!purchase) {
        obs.warn('Access denied - no purchase found', {
          customerId,
          contentId: input.contentId,
        });
        throw new Error('ACCESS_DENIED');
      }
    }

    // 3. Generate signed R2 URL
    const r2Path = contentRecord.mediaItem.r2Path;
    const expiresAt = new Date(Date.now() + input.expirySeconds * 1000);

    const streamingUrl = await r2.generateSignedUrl(r2Path, input.expirySeconds);

    obs.info('Streaming URL generated', {
      customerId,
      contentId: input.contentId,
      expiresAt: expiresAt.toISOString(),
    });

    return { streamingUrl, expiresAt };
  }

  /**
   * Save playback progress (upsert pattern)
   *
   * Uses composite primary key for automatic upsert behavior
   */
  async savePlaybackProgress(
    customerId: string,
    input: SavePlaybackProgressInput
  ): Promise<void> {
    const { db, obs, organizationId } = this.config;

    obs.info('Saving playback progress', {
      customerId,
      contentId: input.contentId,
      position: input.currentPositionSeconds,
    });

    // Upsert pattern with composite primary key
    await db.insert(videoPlayback).values({
      customerId,
      contentId: input.contentId,
      organizationId,
      currentPositionSeconds: input.currentPositionSeconds,
      durationSeconds: input.durationSeconds,
      completed: input.completed,
      lastWatchedAt: new Date(),
    }).onConflictDoUpdate({
      target: [videoPlayback.customerId, videoPlayback.contentId],
      set: {
        currentPositionSeconds: input.currentPositionSeconds,
        durationSeconds: input.durationSeconds,
        completed: input.completed,
        lastWatchedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    obs.info('Playback progress saved', {
      customerId,
      contentId: input.contentId,
    });
  }

  /**
   * Get playback progress for a specific content item
   */
  async getPlaybackProgress(
    customerId: string,
    input: GetPlaybackProgressInput
  ): Promise<{
    currentPositionSeconds: number;
    durationSeconds: number;
    completed: boolean;
    lastWatchedAt: Date;
  } | null> {
    const { db } = this.config;

    const progress = await db.query.videoPlayback.findFirst({
      where: and(
        eq(videoPlayback.customerId, customerId),
        eq(videoPlayback.contentId, input.contentId)
      ),
    });

    if (!progress) {
      return null;
    }

    return {
      currentPositionSeconds: progress.currentPositionSeconds,
      durationSeconds: progress.durationSeconds,
      completed: progress.completed,
      lastWatchedAt: progress.lastWatchedAt,
    };
  }

  /**
   * List user's purchased content library with playback progress
   */
  async listUserLibrary(
    customerId: string,
    input: ListUserLibraryInput
  ): Promise<{
    items: Array<{
      content: {
        id: string;
        title: string;
        description: string;
        thumbnailUrl: string;
      };
      purchase: {
        purchasedAt: Date;
        priceCents: number;
      };
      progress: {
        currentPositionSeconds: number;
        durationSeconds: number;
        completed: boolean;
        lastWatchedAt: Date;
      } | null;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
    };
  }> {
    const { db, obs, organizationId } = this.config;

    obs.info('Listing user library', {
      customerId,
      page: input.page,
      filter: input.filter,
    });

    // Query purchases with content and progress
    const offset = (input.page - 1) * input.limit;

    const purchases = await db.query.contentPurchases.findMany({
      where: and(
        eq(contentPurchases.customerId, customerId),
        eq(contentPurchases.organizationId, organizationId),
        eq(contentPurchases.status, 'completed')
      ),
      with: {
        content: {
          with: {
            mediaItem: true, // For thumbnail
          },
        },
      },
      orderBy: [desc(contentPurchases.createdAt)],
      limit: input.limit,
      offset,
    });

    // Get playback progress for all content items
    const contentIds = purchases.map(p => p.contentId);
    const progressRecords = await db.query.videoPlayback.findMany({
      where: and(
        eq(videoPlayback.customerId, customerId),
        inArray(videoPlayback.contentId, contentIds)
      ),
    });

    const progressMap = new Map(
      progressRecords.map(p => [p.contentId, p])
    );

    // Build response
    const items = purchases.map(purchase => ({
      content: {
        id: purchase.content.id,
        title: purchase.content.title,
        description: purchase.content.description,
        thumbnailUrl: purchase.content.mediaItem.thumbnailUrl,
      },
      purchase: {
        purchasedAt: purchase.createdAt,
        priceCents: purchase.priceCents,
      },
      progress: progressMap.has(purchase.contentId)
        ? {
            currentPositionSeconds: progressMap.get(purchase.contentId)!.currentPositionSeconds,
            durationSeconds: progressMap.get(purchase.contentId)!.durationSeconds,
            completed: progressMap.get(purchase.contentId)!.completed,
            lastWatchedAt: progressMap.get(purchase.contentId)!.lastWatchedAt,
          }
        : null,
    }));

    // Apply filter
    const filteredItems = items.filter(item => {
      if (input.filter === 'in-progress') {
        return item.progress && !item.progress.completed;
      }
      if (input.filter === 'completed') {
        return item.progress?.completed;
      }
      return true; // 'all'
    });

    // Get total count (simplified - in production, use separate count query)
    const total = filteredItems.length;

    return {
      items: filteredItems,
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
      },
    };
  }
}

/**
 * Factory function for dependency injection
 */
export function getContentAccessService(env: {
  DATABASE_URL: string;
  R2_BUCKET: R2Bucket;
  ENVIRONMENT: string;
  ORGANIZATION_ID: string;
}): ContentAccessService {
  const db = getDbClient(env.DATABASE_URL);
  const r2 = new R2Service(env.R2_BUCKET);
  const obs = new ObservabilityClient('content-access-service', env.ENVIRONMENT);

  return new ContentAccessService({
    db,
    r2,
    obs,
    organizationId: env.ORGANIZATION_ID,
  });
}
```

### Step 4: Create API Endpoints

**File**: `workers/auth/src/routes/content-access.ts` (add to existing auth worker)

```typescript
import { Hono } from 'hono';
import type { AuthContext } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { getContentAccessService } from '@codex/content-access';
import {
  getStreamingUrlSchema,
  savePlaybackProgressSchema,
  getPlaybackProgressSchema,
  listUserLibrarySchema,
} from '@codex/validation/schemas/access';
import { ObservabilityClient } from '@codex/observability';

const app = new Hono<AuthContext>();

// All routes require authentication
app.use('*', requireAuth());

/**
 * GET /api/content/:id/stream
 * Generate signed streaming URL for content
 */
app.get('/api/content/:id/stream', async (c) => {
  const obs = new ObservabilityClient('content-access-api', c.env.ENVIRONMENT);
  const user = c.get('user'); // From requireAuth middleware

  try {
    const input = getStreamingUrlSchema.parse({
      contentId: c.req.param('id'),
      expirySeconds: Number(c.req.query('expiry')) || 3600,
    });

    const service = getContentAccessService({
      ...c.env,
      ORGANIZATION_ID: user.organizationId,
    });

    const result = await service.getStreamingUrl(user.id, input);

    return c.json({
      streamingUrl: result.streamingUrl,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (err) {
    if ((err as Error).message === 'CONTENT_NOT_FOUND') {
      return c.json({ error: { code: 'CONTENT_NOT_FOUND', message: 'Content not found' } }, 404);
    }
    if ((err as Error).message === 'ACCESS_DENIED') {
      return c.json({ error: { code: 'ACCESS_DENIED', message: 'Purchase required' } }, 403);
    }
    obs.trackError(err as Error, { userId: user.id, contentId: c.req.param('id') });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to generate streaming URL' } }, 500);
  }
});

/**
 * POST /api/content/:id/progress
 * Save playback progress
 */
app.post('/api/content/:id/progress', async (c) => {
  const obs = new ObservabilityClient('content-access-api', c.env.ENVIRONMENT);
  const user = c.get('user');

  try {
    const body = await c.req.json();
    const input = savePlaybackProgressSchema.parse({
      contentId: c.req.param('id'),
      ...body,
    });

    const service = getContentAccessService({
      ...c.env,
      ORGANIZATION_ID: user.organizationId,
    });

    await service.savePlaybackProgress(user.id, input);

    return c.json({ success: true });
  } catch (err) {
    obs.trackError(err as Error, { userId: user.id, contentId: c.req.param('id') });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to save progress' } }, 500);
  }
});

/**
 * GET /api/content/:id/progress
 * Get playback progress
 */
app.get('/api/content/:id/progress', async (c) => {
  const obs = new ObservabilityClient('content-access-api', c.env.ENVIRONMENT);
  const user = c.get('user');

  try {
    const input = getPlaybackProgressSchema.parse({
      contentId: c.req.param('id'),
    });

    const service = getContentAccessService({
      ...c.env,
      ORGANIZATION_ID: user.organizationId,
    });

    const progress = await service.getPlaybackProgress(user.id, input);

    if (!progress) {
      return c.json({ progress: null });
    }

    return c.json({
      progress: {
        currentPositionSeconds: progress.currentPositionSeconds,
        durationSeconds: progress.durationSeconds,
        completed: progress.completed,
        lastWatchedAt: progress.lastWatchedAt.toISOString(),
      },
    });
  } catch (err) {
    obs.trackError(err as Error, { userId: user.id, contentId: c.req.param('id') });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get progress' } }, 500);
  }
});

/**
 * GET /api/user/library
 * List user's purchased content with progress
 */
app.get('/api/user/library', async (c) => {
  const obs = new ObservabilityClient('content-access-api', c.env.ENVIRONMENT);
  const user = c.get('user');

  try {
    const input = listUserLibrarySchema.parse({
      page: Number(c.req.query('page')) || 1,
      limit: Number(c.req.query('limit')) || 20,
      filter: c.req.query('filter') || 'all',
    });

    const service = getContentAccessService({
      ...c.env,
      ORGANIZATION_ID: user.organizationId,
    });

    const result = await service.listUserLibrary(user.id, input);

    return c.json(result);
  } catch (err) {
    obs.trackError(err as Error, { userId: user.id });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list library' } }, 500);
  }
});

export default app;
```

### Step 5: Wire Up Routes

**File**: `workers/auth/src/index.ts` (modify existing)

```typescript
import contentAccessRoutes from './routes/content-access';

// ... existing routes ...

app.route('/', contentAccessRoutes);
```

### Step 6: Add Tests

**File**: `packages/content-access/src/service.test.ts`

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
        contentPurchases: { findFirst: vi.fn(), findMany: vi.fn() },
        videoPlayback: { findFirst: vi.fn(), findMany: vi.fn() },
      },
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        })),
      })),
    };

    mockR2 = {
      generateSignedUrl: vi.fn().mockResolvedValue('https://r2.example.com/signed-url'),
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
        mediaItem: { r2Path: 'videos/sample.mp4' },
      });

      const result = await service.getStreamingUrl('user-123', {
        contentId: 'content-123',
        expirySeconds: 3600,
      });

      expect(result.streamingUrl).toBe('https://r2.example.com/signed-url');
      expect(mockDb.query.contentPurchases.findFirst).not.toHaveBeenCalled();
    });

    it('should require purchase for paid content', async () => {
      mockDb.query.content.findFirst.mockResolvedValue({
        id: 'content-123',
        priceCents: 999, // Paid content
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

      expect(result.streamingUrl).toBe('https://r2.example.com/signed-url');
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
});
```

**File**: `packages/validation/src/schemas/access.test.ts`

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

      expect(result.contentId).toBe('123e4567-e89b-12d3-a456-426614174000');
      expect(result.expirySeconds).toBe(3600);
    });

    it('should use default expiry', () => {
      const result = getStreamingUrlSchema.parse({
        contentId: '123e4567-e89b-12d3-a456-426614174000',
      });

      expect(result.expirySeconds).toBe(3600); // Default 1 hour
    });

    it('should reject invalid UUID', () => {
      expect(() =>
        getStreamingUrlSchema.parse({
          contentId: 'not-a-uuid',
        })
      ).toThrow();
    });

    it('should enforce expiry bounds', () => {
      expect(() =>
        getStreamingUrlSchema.parse({
          contentId: '123e4567-e89b-12d3-a456-426614174000',
          expirySeconds: 100, // Too short (< 300)
        })
      ).toThrow();

      expect(() =>
        getStreamingUrlSchema.parse({
          contentId: '123e4567-e89b-12d3-a456-426614174000',
          expirySeconds: 100000, // Too long (> 86400)
        })
      ).toThrow();
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

      expect(result).toEqual({
        contentId: '123e4567-e89b-12d3-a456-426614174000',
        currentPositionSeconds: 120,
        durationSeconds: 600,
        completed: false,
      });
    });

    it('should reject negative position', () => {
      expect(() =>
        savePlaybackProgressSchema.parse({
          contentId: '123e4567-e89b-12d3-a456-426614174000',
          currentPositionSeconds: -10,
          durationSeconds: 600,
        })
      ).toThrow();
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

## Test Specifications

### Unit Tests (Validation)
- `getStreamingUrlSchema` - Valid UUID, default expiry, bounds checking
- `savePlaybackProgressSchema` - Valid progress, negative position rejection
- `listUserLibrarySchema` - Pagination, filter enums

### Unit Tests (Service)
- `getStreamingUrl` - Free content (no purchase check)
- `getStreamingUrl` - Paid content with purchase
- `getStreamingUrl` - Paid content without purchase (ACCESS_DENIED)
- `getStreamingUrl` - Content not found
- `savePlaybackProgress` - Upsert behavior
- `getPlaybackProgress` - Returns progress or null
- `listUserLibrary` - Pagination, filtering

### Integration Tests (API)
- `GET /api/content/:id/stream` - Returns signed URL with auth
- `GET /api/content/:id/stream` - 403 for unpurchased paid content
- `GET /api/content/:id/stream` - 401 without auth
- `POST /api/content/:id/progress` - Saves progress
- `GET /api/content/:id/progress` - Returns progress
- `GET /api/user/library` - Returns purchased content with progress

---

## Definition of Done

- [ ] Playback schema created with migration
- [ ] Access validation schemas implemented (Zod)
- [ ] Content access service implemented
- [ ] API endpoints added to auth worker
- [ ] Unit tests for validation (100% coverage)
- [ ] Unit tests for service (mocked DB)
- [ ] Integration tests for API endpoints
- [ ] Error handling comprehensive (CONTENT_NOT_FOUND, ACCESS_DENIED)
- [ ] Observability logging complete
- [ ] R2 signed URL generation working
- [ ] Upsert pattern for playback progress working
- [ ] CI passing (tests + typecheck + lint)

---

## Integration Points

### Depends On
- **P1-CONTENT-001**: Content schema and service
- **P1-ECOM-001**: Purchase schema and checking

### Integrates With
- Existing auth worker: `workers/auth/src/index.ts`
- R2 client: `@codex/cloudflare-clients/r2`
- Database client: `@codex/database`

### Enables
- Frontend video player (signed URLs)
- Continue watching feature (playback progress)
- User library page (purchased content list)

---

## Related Documentation

**Must Read**:
- [R2 Storage Patterns](../../core/R2_STORAGE_PATTERNS.md)
- [Access Control Patterns](../../core/ACCESS_CONTROL_PATTERNS.md)
- [STANDARDS.md](../STANDARDS.md) - § 3 Validation separation

**Reference**:
- [Content Access TDD](../../features/content-access/ttd-dphase-1.md)
- [Testing Strategy](../../infrastructure/Testing.md)

**Code Examples**:
- R2 client: `packages/cloudflare-clients/src/r2/client.ts`
- Auth middleware: `workers/auth/src/middleware/auth.ts`

---

## Notes for LLM Developer

1. **MUST Complete P1-CONTENT-001 and P1-ECOM-001 First**: Depends on content and purchase schemas
2. **Signed URLs**: Use existing R2 client, set appropriate expiry (1 hour default)
3. **Free vs. Paid Content**: Skip purchase check if `priceCents = 0`
4. **Upsert Pattern**: Use composite primary key for automatic upsert behavior
5. **Progress Tracking**: Save on player pause, seek, or every 30 seconds
6. **Security**: All endpoints require authentication via `requireAuth()` middleware
7. **Organization Scope**: All queries must filter by `organizationId` from user context

**Common Pitfalls**:
- Don't forget to check `status = 'published'` and `deletedAt IS NULL`
- Always verify purchase status is `'completed'` before granting access
- Handle R2 signed URL generation errors gracefully

**If Stuck**: Check [CONTEXT_MAP.md](../CONTEXT_MAP.md) or existing R2 client implementation.

---

**Last Updated**: 2025-11-05
