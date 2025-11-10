# Work Packet: P1-ACCESS-001 - Content Access & Playback

**Status**: 🚧 To Be Implemented
**Priority**: P0 (Critical - content delivery)
**Estimated Effort**: 3-4 days
**Branch**: `feature/P1-ACCESS-001-content-access`
**Last Updated**: 2025-11-08

---

## Overview

This work packet implements the content access control system that verifies user permissions and generates signed R2 URLs for streaming media content. It also provides playback progress tracking for video content, enabling "continue watching" functionality.

### Key Responsibilities

1. **Access Verification**: Check if user has purchased content or if content is free
2. **Signed URL Generation**: Create time-limited R2 URLs for media streaming
3. **Playback Tracking**: Save and retrieve video playback progress
4. **User Library**: List purchased content with progress indicators

### Business Context

This is the gateway between customers and content. Every content access request flows through this service:
- Free content → Generate signed URL immediately
- Paid content → Verify purchase exists → Generate signed URL
- Video playback → Track progress every 30 seconds → Enable resume watching

---

## Current State

### ✅ Already Implemented

- **R2 Client**: Signed URL generation available at `packages/cloudflare-clients/src/r2/client.ts`
- **Content Schema**: From P1-CONTENT-001 (`content`, `media_items` tables)
- **Purchase Schema**: From P1-ECOM-001 (`purchases`, `content_access` tables)
- **Authentication Middleware**: User context available in all routes

### 🚧 Needs Implementation

- `video_playback` table and migration
- `ContentAccessService` class with business logic
- Access validation schemas (Zod)
- API endpoints in auth worker:
  - `GET /api/content/:id/stream` - Get streaming URL
  - `POST /api/content/:id/progress` - Save playback progress
  - `GET /api/content/:id/progress` - Get playback progress
  - `GET /api/user/library` - List purchased content
- Unit tests for service and validation
- Integration tests for API endpoints

---

## Dependencies

### Required Work Packets (Must Complete First)

| Work Packet | Dependency | What We Need |
|-------------|------------|--------------|
| **P1-CONTENT-001** | Hard | `content` and `media_items` tables, content service for querying |
| **P1-ECOM-001** | Hard | `purchases` table with `status='completed'` records |

### Existing Infrastructure

- **Database**: Neon Postgres with Drizzle ORM
- **R2 Storage**: Cloudflare R2 buckets (see R2BucketStructure.md)
- **Auth Worker**: Hono-based API with `requireAuth()` middleware
- **Observability**: ObservabilityClient for logging and error tracking

---

## Database Schema

### Video Playback Table

**File**: `packages/database/src/schema/playback.ts`

This schema is aligned with `design/features/shared/database-schema.md` lines 465-497.

```typescript
import { pgTable, uuid, integer, boolean, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { content } from './content';
import { users } from './users';

/**
 * Tracks video playback progress for resume functionality
 *
 * Design decisions:
 * - Composite unique key (user_id + content_id) for upsert pattern
 * - Progress in seconds (not percentage) for accuracy
 * - completed flag set when user watches >= 95% of video
 * - Aligned with database-schema.md v2.0 (lines 465-497)
 *
 * Business rules:
 * - Update every 30 seconds during playback (frontend responsibility)
 * - Auto-complete when position >= 95% of duration
 * - No cleanup (historical record useful for analytics)
 */
export const videoPlayback = pgTable('video_playback', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  contentId: uuid('content_id').notNull().references(() => content.id, { onDelete: 'cascade' }),

  // Playback state
  positionSeconds: integer('position_seconds').notNull().default(0),
  durationSeconds: integer('duration_seconds').notNull(),
  completed: boolean('completed').notNull().default(false), // Watched >= 95%

  // Timestamps
  updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  // One playback record per user per video
  userContentUnique: unique().on(table.userId, table.contentId),

  // Indexes for common queries
  userIdIdx: index('idx_video_playback_user_id').on(table.userId),
  contentIdIdx: index('idx_video_playback_content_id').on(table.contentId),
}));

export const videoPlaybackRelations = relations(videoPlayback, ({ one }) => ({
  user: one(users, {
    fields: [videoPlayback.userId],
    references: [users.id],
  }),
  content: one(content, {
    fields: [videoPlayback.contentId],
    references: [content.id],
  }),
}));

export type VideoPlayback = typeof videoPlayback.$inferSelect;
export type NewVideoPlayback = typeof videoPlayback.$inferInsert;
```

### Migration File

**File**: `packages/database/migrations/XXXX_create_video_playback.sql`

```sql
-- Create video_playback table for tracking playback progress
-- Aligned with design/features/shared/database-schema.md v2.0

CREATE TABLE video_playback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,

  position_seconds INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT video_playback_user_content_unique UNIQUE (user_id, content_id)
);

-- Indexes for efficient queries
CREATE INDEX idx_video_playback_user_id ON video_playback(user_id);
CREATE INDEX idx_video_playback_content_id ON video_playback(content_id);

-- Comments
COMMENT ON TABLE video_playback IS 'Tracks video playback progress for resume functionality';
COMMENT ON COLUMN video_playback.position_seconds IS 'Current playback position in seconds';
COMMENT ON COLUMN video_playback.completed IS 'True if user watched >= 95% of video';
```

---

## Validation Schemas

**File**: `packages/validation/src/schemas/access.ts`

```typescript
import { z } from 'zod';

/**
 * Validation schemas for content access endpoints
 *
 * Design principles:
 * - Pure validation (no DB dependency)
 * - Clear error messages for API responses
 * - Sensible defaults (1 hour expiry, page 1, limit 20)
 * - Bounds checking (expiry: 5 minutes to 24 hours)
 */

export const getStreamingUrlSchema = z.object({
  contentId: z.string().uuid('Invalid content ID format'),
  expirySeconds: z.number()
    .int('Expiry must be an integer')
    .min(300, 'Minimum expiry is 5 minutes (300 seconds)')
    .max(86400, 'Maximum expiry is 24 hours (86400 seconds)')
    .optional()
    .default(3600), // 1 hour default
});

export const savePlaybackProgressSchema = z.object({
  contentId: z.string().uuid('Invalid content ID format'),
  positionSeconds: z.number()
    .int('Position must be an integer')
    .min(0, 'Position cannot be negative'),
  durationSeconds: z.number()
    .int('Duration must be an integer')
    .min(1, 'Duration must be at least 1 second'),
  completed: z.boolean().optional().default(false),
});

export const getPlaybackProgressSchema = z.object({
  contentId: z.string().uuid('Invalid content ID format'),
});

export const listUserLibrarySchema = z.object({
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(100).optional().default(20),
  filter: z.enum(['all', 'in-progress', 'completed']).optional().default('all'),
  sortBy: z.enum(['recent', 'title', 'duration']).optional().default('recent'),
});

// Type exports
export type GetStreamingUrlInput = z.infer<typeof getStreamingUrlSchema>;
export type SavePlaybackProgressInput = z.infer<typeof savePlaybackProgressSchema>;
export type GetPlaybackProgressInput = z.infer<typeof getPlaybackProgressSchema>;
export type ListUserLibraryInput = z.infer<typeof listUserLibrarySchema>;
```

---

## Service Implementation

**File**: `packages/content-access/src/service.ts`

```typescript
import { eq, and, desc, isNull, inArray } from 'drizzle-orm';
import type { DrizzleClient } from '@codex/database';
import { content, purchases, videoPlayback, mediaItems, contentAccess } from '@codex/database/schema';
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
}

/**
 * Content Access Service
 *
 * Responsibilities:
 * 1. Verify user has access to content (purchase or free)
 * 2. Generate time-limited signed R2 URLs for streaming
 * 3. Track video playback progress for resume functionality
 * 4. List user's content library with progress
 *
 * Security:
 * - All methods require authenticated userId
 * - Purchase verification before generating signed URLs
 * - Only published, non-deleted content is accessible
 * - Row-level security enforced via user_id filters
 *
 * Integration points:
 * - P1-CONTENT-001: Queries content and media_items tables
 * - P1-ECOM-001: Verifies purchases table for access
 * - R2 Service: Generates presigned URLs via AWS SDK
 */
export class ContentAccessService {
  constructor(private config: ContentAccessServiceConfig) {}

  /**
   * Generate signed streaming URL for content
   *
   * Access control flow:
   * 1. Verify content exists and is published
   * 2. Check if content is free (price_cents = 0)
   * 3. If paid, verify user has completed purchase
   * 4. Generate time-limited signed R2 URL
   *
   * Error codes:
   * - CONTENT_NOT_FOUND: Content doesn't exist, is draft, or is deleted
   * - ACCESS_DENIED: User hasn't purchased paid content
   * - R2_ERROR: Failed to generate signed URL
   *
   * @param userId - Authenticated user ID
   * @param input - Content ID and optional expiry
   * @returns Streaming URL and expiration timestamp
   * @throws Error with specific code for error handling
   */
  async getStreamingUrl(
    userId: string,
    input: GetStreamingUrlInput
  ): Promise<{ streamingUrl: string; expiresAt: Date; contentType: 'video' | 'audio' }> {
    const { db, r2, obs } = this.config;

    obs.info('Getting streaming URL', {
      userId,
      contentId: input.contentId,
      expirySeconds: input.expirySeconds,
    });

    // Step 1: Get content with media details
    const contentRecord = await db.query.content.findFirst({
      where: and(
        eq(content.id, input.contentId),
        eq(content.status, 'published'),
        isNull(content.deletedAt)
      ),
      with: {
        mediaItem: true, // Includes r2_key, content_type, duration
      },
    });

    if (!contentRecord || !contentRecord.mediaItem) {
      obs.warn('Content not found or not accessible', {
        contentId: input.contentId,
        found: !!contentRecord,
        hasMedia: !!contentRecord?.mediaItem,
      });
      throw new Error('CONTENT_NOT_FOUND');
    }

    // Step 2: Check access (free content or purchased)
    if (contentRecord.priceCents > 0) {
      // Paid content - verify purchase or content_access
      const hasAccess = await db.query.contentAccess.findFirst({
        where: and(
          eq(contentAccess.userId, userId),
          eq(contentAccess.contentId, input.contentId),
          eq(contentAccess.accessType, 'purchased'), // Phase 1: Only purchased access
          // Phase 2+: Also check subscription, complimentary
        ),
      });

      if (!hasAccess) {
        obs.warn('Access denied - no purchase found', {
          userId,
          contentId: input.contentId,
          priceCents: contentRecord.priceCents,
        });
        throw new Error('ACCESS_DENIED');
      }
    } else {
      obs.info('Free content - skipping purchase check', {
        contentId: input.contentId,
      });
    }

    // Step 3: Generate signed R2 URL
    // R2 key format: {creatorId}/hls/{mediaId}/master.m3u8 (for video)
    //                {creatorId}/audio/{mediaId}/audio.mp3 (for audio)
    const r2Key = contentRecord.mediaItem.r2Key;

    if (!r2Key) {
      obs.error('Media item missing R2 key', {
        contentId: input.contentId,
        mediaItemId: contentRecord.mediaItem.id,
      });
      throw new Error('R2_ERROR');
    }

    try {
      const streamingUrl = await r2.generateSignedUrl(r2Key, input.expirySeconds);
      const expiresAt = new Date(Date.now() + input.expirySeconds * 1000);

      obs.info('Streaming URL generated successfully', {
        userId,
        contentId: input.contentId,
        contentType: contentRecord.mediaItem.contentType,
        expiresAt: expiresAt.toISOString(),
      });

      return {
        streamingUrl,
        expiresAt,
        contentType: contentRecord.mediaItem.contentType as 'video' | 'audio',
      };
    } catch (err) {
      obs.error('Failed to generate signed R2 URL', {
        error: err,
        userId,
        contentId: input.contentId,
        r2Key,
      });
      throw new Error('R2_ERROR');
    }
  }

  /**
   * Save playback progress (upsert pattern)
   *
   * Uses unique constraint on (user_id, content_id) for automatic upsert.
   * Updates lastWatchedAt timestamp on every save.
   * Auto-completes if positionSeconds >= 95% of durationSeconds.
   *
   * Called by frontend:
   * - Every 30 seconds during playback
   * - On pause
   * - On seek
   * - On video end
   *
   * @param userId - Authenticated user ID
   * @param input - Content ID, position, duration, completed flag
   */
  async savePlaybackProgress(
    userId: string,
    input: SavePlaybackProgressInput
  ): Promise<void> {
    const { db, obs } = this.config;

    // Auto-complete if watched >= 95%
    const completionThreshold = input.durationSeconds * 0.95;
    const isCompleted = input.positionSeconds >= completionThreshold;

    obs.info('Saving playback progress', {
      userId,
      contentId: input.contentId,
      positionSeconds: input.positionSeconds,
      durationSeconds: input.durationSeconds,
      completed: isCompleted,
    });

    // Upsert using unique constraint
    await db.insert(videoPlayback).values({
      userId,
      contentId: input.contentId,
      positionSeconds: input.positionSeconds,
      durationSeconds: input.durationSeconds,
      completed: isCompleted || input.completed,
    }).onConflictDoUpdate({
      target: [videoPlayback.userId, videoPlayback.contentId],
      set: {
        positionSeconds: input.positionSeconds,
        durationSeconds: input.durationSeconds,
        completed: isCompleted || input.completed,
        updatedAt: new Date(),
      },
    });

    obs.info('Playback progress saved', {
      userId,
      contentId: input.contentId,
      completed: isCompleted,
    });
  }

  /**
   * Get playback progress for specific content
   *
   * Returns null if no progress exists (user hasn't started watching).
   * Used by frontend to resume playback at saved position.
   *
   * @param userId - Authenticated user ID
   * @param input - Content ID
   * @returns Progress object or null
   */
  async getPlaybackProgress(
    userId: string,
    input: GetPlaybackProgressInput
  ): Promise<{
    positionSeconds: number;
    durationSeconds: number;
    completed: boolean;
    updatedAt: Date;
  } | null> {
    const { db } = this.config;

    const progress = await db.query.videoPlayback.findFirst({
      where: and(
        eq(videoPlayback.userId, userId),
        eq(videoPlayback.contentId, input.contentId)
      ),
    });

    if (!progress) {
      return null;
    }

    return {
      positionSeconds: progress.positionSeconds,
      durationSeconds: progress.durationSeconds,
      completed: progress.completed,
      updatedAt: progress.updatedAt,
    };
  }

  /**
   * List user's purchased content library with playback progress
   *
   * Query flow:
   * 1. Get all purchases for user (status='completed')
   * 2. Join with content and media_items for details
   * 3. Get playback progress for all content in batch
   * 4. Combine results and apply filters
   * 5. Sort and paginate
   *
   * Filters:
   * - 'all': All purchased content
   * - 'in-progress': Started but not completed
   * - 'completed': Watched >= 95%
   *
   * @param userId - Authenticated user ID
   * @param input - Pagination, filter, sort options
   * @returns Paginated list of content with progress
   */
  async listUserLibrary(
    userId: string,
    input: ListUserLibraryInput
  ): Promise<{
    items: Array<{
      content: {
        id: string;
        title: string;
        description: string | null;
        thumbnailUrl: string | null;
        contentType: 'video' | 'audio';
        durationSeconds: number | null;
      };
      purchase: {
        purchasedAt: Date;
        priceCents: number;
      };
      progress: {
        positionSeconds: number;
        durationSeconds: number;
        completed: boolean;
        percentComplete: number;
        updatedAt: Date;
      } | null;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      hasMore: boolean;
    };
  }> {
    const { db, obs } = this.config;

    obs.info('Listing user library', {
      userId,
      page: input.page,
      filter: input.filter,
      sortBy: input.sortBy,
    });

    const offset = (input.page - 1) * input.limit;

    // Step 1: Get purchases with content and media details
    const purchaseRecords = await db.query.purchases.findMany({
      where: and(
        eq(purchases.customerId, userId),
        eq(purchases.status, 'completed')
      ),
      with: {
        content: {
          with: {
            mediaItem: true,
          },
        },
      },
      orderBy: [desc(purchases.createdAt)],
      limit: input.limit + 1, // Fetch one extra to check if there's more
      offset,
    });

    // Check if there are more pages
    const hasMore = purchaseRecords.length > input.limit;
    const purchases = hasMore ? purchaseRecords.slice(0, input.limit) : purchaseRecords;

    // Step 2: Get playback progress for all content in batch
    const contentIds = purchases.map(p => p.contentId);
    const progressRecords = await db.query.videoPlayback.findMany({
      where: and(
        eq(videoPlayback.userId, userId),
        inArray(videoPlayback.contentId, contentIds)
      ),
    });

    const progressMap = new Map(
      progressRecords.map(p => [p.contentId, p])
    );

    // Step 3: Build response items
    let items = purchases.map(purchase => {
      const progress = progressMap.get(purchase.contentId);

      return {
        content: {
          id: purchase.content.id,
          title: purchase.content.title,
          description: purchase.content.description,
          thumbnailUrl: purchase.content.mediaItem?.thumbnailUrl ?? null,
          contentType: purchase.content.mediaItem?.contentType as 'video' | 'audio',
          durationSeconds: purchase.content.mediaItem?.durationSeconds ?? null,
        },
        purchase: {
          purchasedAt: purchase.createdAt,
          priceCents: purchase.amountPaidCents,
        },
        progress: progress ? {
          positionSeconds: progress.positionSeconds,
          durationSeconds: progress.durationSeconds,
          completed: progress.completed,
          percentComplete: Math.round((progress.positionSeconds / progress.durationSeconds) * 100),
          updatedAt: progress.updatedAt,
        } : null,
      };
    });

    // Step 4: Apply filter
    items = items.filter(item => {
      if (input.filter === 'in-progress') {
        return item.progress && !item.progress.completed;
      }
      if (input.filter === 'completed') {
        return item.progress?.completed === true;
      }
      return true; // 'all'
    });

    // Step 5: Apply sort (after filter for accuracy)
    if (input.sortBy === 'title') {
      items.sort((a, b) => a.content.title.localeCompare(b.content.title));
    } else if (input.sortBy === 'duration') {
      items.sort((a, b) => (b.content.durationSeconds ?? 0) - (a.content.durationSeconds ?? 0));
    }
    // 'recent' is already sorted by purchase.createdAt DESC

    return {
      items,
      pagination: {
        page: input.page,
        limit: input.limit,
        total: items.length, // Note: This is filtered total, not total purchases
        hasMore,
      },
    };
  }
}

/**
 * Factory function for dependency injection
 *
 * Used in API endpoints to create service instance with environment config.
 */
export function createContentAccessService(env: {
  DATABASE_URL: string;
  R2_BUCKET: R2Bucket;
  ENVIRONMENT: string;
}): ContentAccessService {
  const db = getDbClient(env.DATABASE_URL);
  const r2 = new R2Service(env.R2_BUCKET);
  const obs = new ObservabilityClient('content-access-service', env.ENVIRONMENT);

  return new ContentAccessService({ db, r2, obs });
}
```

---

## API Endpoints

**File**: `workers/auth/src/routes/content-access.ts`

```typescript
import { Hono } from 'hono';
import type { AuthContext } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { createContentAccessService } from '@codex/content-access';
import {
  getStreamingUrlSchema,
  savePlaybackProgressSchema,
  getPlaybackProgressSchema,
  listUserLibrarySchema,
} from '@codex/validation/schemas/access';
import { ObservabilityClient } from '@codex/observability';
import { ZodError } from 'zod';

const app = new Hono<AuthContext>();

// All routes require authentication
app.use('*', requireAuth());

/**
 * GET /api/content/:id/stream
 *
 * Generate signed streaming URL for content.
 *
 * Query params:
 * - expiry (optional): Expiry time in seconds (default: 3600)
 *
 * Response:
 * - 200: { streamingUrl: string, expiresAt: ISO8601, contentType: 'video'|'audio' }
 * - 403: { error: { code: 'ACCESS_DENIED', message: 'Purchase required' } }
 * - 404: { error: { code: 'CONTENT_NOT_FOUND', message: 'Content not found' } }
 * - 500: { error: { code: 'INTERNAL_ERROR', message: '...' } }
 */
app.get('/api/content/:id/stream', async (c) => {
  const obs = new ObservabilityClient('content-access-api', c.env.ENVIRONMENT);
  const user = c.get('user');

  try {
    const input = getStreamingUrlSchema.parse({
      contentId: c.req.param('id'),
      expirySeconds: c.req.query('expiry') ? Number(c.req.query('expiry')) : undefined,
    });

    const service = createContentAccessService(c.env);
    const result = await service.getStreamingUrl(user.id, input);

    return c.json({
      streamingUrl: result.streamingUrl,
      expiresAt: result.expiresAt.toISOString(),
      contentType: result.contentType,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      obs.warn('Validation error', { errors: err.errors });
      return c.json({ error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }, 400);
    }

    if ((err as Error).message === 'CONTENT_NOT_FOUND') {
      return c.json({ error: { code: 'CONTENT_NOT_FOUND', message: 'Content not found or not accessible' } }, 404);
    }

    if ((err as Error).message === 'ACCESS_DENIED') {
      return c.json({ error: { code: 'ACCESS_DENIED', message: 'Purchase required to access this content' } }, 403);
    }

    obs.trackError(err as Error, { userId: user.id, contentId: c.req.param('id') });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to generate streaming URL' } }, 500);
  }
});

/**
 * POST /api/content/:id/progress
 *
 * Save playback progress for video content.
 *
 * Body:
 * {
 *   positionSeconds: number,
 *   durationSeconds: number,
 *   completed?: boolean
 * }
 *
 * Response:
 * - 200: { success: true }
 * - 400: { error: { code: 'VALIDATION_ERROR', message: '...' } }
 * - 500: { error: { code: 'INTERNAL_ERROR', message: '...' } }
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

    const service = createContentAccessService(c.env);
    await service.savePlaybackProgress(user.id, input);

    return c.json({ success: true });
  } catch (err) {
    if (err instanceof ZodError) {
      obs.warn('Validation error', { errors: err.errors });
      return c.json({ error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }, 400);
    }

    obs.trackError(err as Error, { userId: user.id, contentId: c.req.param('id') });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to save playback progress' } }, 500);
  }
});

/**
 * GET /api/content/:id/progress
 *
 * Get playback progress for video content.
 *
 * Response:
 * - 200: { progress: { positionSeconds, durationSeconds, completed, updatedAt } | null }
 * - 500: { error: { code: 'INTERNAL_ERROR', message: '...' } }
 */
app.get('/api/content/:id/progress', async (c) => {
  const obs = new ObservabilityClient('content-access-api', c.env.ENVIRONMENT);
  const user = c.get('user');

  try {
    const input = getPlaybackProgressSchema.parse({
      contentId: c.req.param('id'),
    });

    const service = createContentAccessService(c.env);
    const progress = await service.getPlaybackProgress(user.id, input);

    if (!progress) {
      return c.json({ progress: null });
    }

    return c.json({
      progress: {
        positionSeconds: progress.positionSeconds,
        durationSeconds: progress.durationSeconds,
        completed: progress.completed,
        updatedAt: progress.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    obs.trackError(err as Error, { userId: user.id, contentId: c.req.param('id') });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get playback progress' } }, 500);
  }
});

/**
 * GET /api/user/library
 *
 * List user's purchased content with playback progress.
 *
 * Query params:
 * - page (optional): Page number (default: 1)
 * - limit (optional): Items per page (default: 20, max: 100)
 * - filter (optional): 'all' | 'in-progress' | 'completed' (default: 'all')
 * - sortBy (optional): 'recent' | 'title' | 'duration' (default: 'recent')
 *
 * Response:
 * - 200: { items: [...], pagination: { page, limit, total, hasMore } }
 * - 500: { error: { code: 'INTERNAL_ERROR', message: '...' } }
 */
app.get('/api/user/library', async (c) => {
  const obs = new ObservabilityClient('content-access-api', c.env.ENVIRONMENT);
  const user = c.get('user');

  try {
    const input = listUserLibrarySchema.parse({
      page: c.req.query('page') ? Number(c.req.query('page')) : undefined,
      limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
      filter: c.req.query('filter'),
      sortBy: c.req.query('sortBy'),
    });

    const service = createContentAccessService(c.env);
    const result = await service.listUserLibrary(user.id, input);

    return c.json(result);
  } catch (err) {
    if (err instanceof ZodError) {
      obs.warn('Validation error', { errors: err.errors });
      return c.json({ error: { code: 'VALIDATION_ERROR', message: err.errors[0].message } }, 400);
    }

    obs.trackError(err as Error, { userId: user.id });
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list library' } }, 500);
  }
});

export default app;
```

### Wire Up Routes

**File**: `workers/auth/src/index.ts` (add to existing)

```typescript
import contentAccessRoutes from './routes/content-access';

// ... existing imports and setup ...

// Mount content access routes
app.route('/', contentAccessRoutes);

export default app;
```

---

## Interfaces & Integration Points

### Upstream Dependencies (What This Work Packet Needs)

#### P1-CONTENT-001 (Content Service)

**Tables Used**:
- `content` - Query for published content, check pricing
  - Fields: `id`, `status`, `price_cents`, `deleted_at`
  - Where clause: `status='published' AND deleted_at IS NULL`
- `media_items` - Get R2 key for signed URL generation
  - Fields: `id`, `r2_key`, `content_type`, `duration_seconds`, `thumbnail_url`

**Service Methods Called**:
- None (direct database queries for efficiency)

**Example Query**:
```typescript
const content = await db.query.content.findFirst({
  where: and(
    eq(content.id, contentId),
    eq(content.status, 'published'),
    isNull(content.deletedAt)
  ),
  with: {
    mediaItem: true, // Join to get R2 key
  },
});
```

#### P1-ECOM-001 (Stripe Checkout)

**Tables Used**:
- `purchases` - Verify completed purchases
  - Fields: `customer_id`, `content_id`, `status`, `amount_paid_cents`, `created_at`
  - Where clause: `customer_id={userId} AND content_id={contentId} AND status='completed'`
- `content_access` - Check access grants (Phase 1: only purchased access)
  - Fields: `user_id`, `content_id`, `access_type`
  - Where clause: `user_id={userId} AND content_id={contentId} AND access_type='purchased'`

**Business Rule**:
- Free content (price_cents = 0): No purchase check required
- Paid content (price_cents > 0): Must have content_access record with access_type='purchased'

**Example Query**:
```typescript
if (content.priceCents > 0) {
  const hasAccess = await db.query.contentAccess.findFirst({
    where: and(
      eq(contentAccess.userId, userId),
      eq(contentAccess.contentId, contentId),
      eq(contentAccess.accessType, 'purchased')
    ),
  });

  if (!hasAccess) throw new Error('ACCESS_DENIED');
}
```

#### Infrastructure: R2 Service

**Package**: `@codex/cloudflare-clients/r2`

**Method Used**: `generateSignedUrl(key: string, expirySeconds: number): Promise<string>`

**R2 Key Format** (from R2BucketStructure.md):
- Video HLS: `{creatorId}/hls/{mediaId}/master.m3u8`
- Audio: `{creatorId}/audio/{mediaId}/audio.mp3`

**Bucket**: `codex-media-production` (or staging/dev variants)

**Documentation**: `design/infrastructure/R2BucketStructure.md`

---

### Downstream Consumers (What Uses This Work Packet)

#### Frontend Video Player

**Endpoints Called**:
1. `GET /api/content/:id/stream` - Get streaming URL when user clicks play
2. `POST /api/content/:id/progress` - Save progress every 30 seconds during playback
3. `GET /api/content/:id/progress` - Resume playback at saved position

**Example Frontend Flow**:
```typescript
// User clicks play on video
const { streamingUrl } = await fetch(`/api/content/${contentId}/stream`).then(r => r.json());

// Load video in player
videoPlayer.src = streamingUrl;

// On initial load, check for saved progress
const { progress } = await fetch(`/api/content/${contentId}/progress`).then(r => r.json());
if (progress) {
  videoPlayer.currentTime = progress.positionSeconds;
}

// During playback, save progress every 30 seconds
setInterval(async () => {
  if (!videoPlayer.paused) {
    await fetch(`/api/content/${contentId}/progress`, {
      method: 'POST',
      body: JSON.stringify({
        positionSeconds: Math.floor(videoPlayer.currentTime),
        durationSeconds: Math.floor(videoPlayer.duration),
      }),
    });
  }
}, 30000);
```

#### User Library Page

**Endpoint Called**:
- `GET /api/user/library?page=1&limit=20&filter=in-progress`

**Use Cases**:
- Display all purchased content
- Show "Continue Watching" section (filter=in-progress)
- Show completed content (filter=completed)
- Sort by recent purchases, title, or duration

---

### Error Propagation

| Error Code | HTTP Status | Meaning | Frontend Action |
|------------|-------------|---------|-----------------|
| `CONTENT_NOT_FOUND` | 404 | Content doesn't exist or is not published | Show "Content not available" message |
| `ACCESS_DENIED` | 403 | User hasn't purchased paid content | Redirect to purchase page |
| `VALIDATION_ERROR` | 400 | Invalid input parameters | Show error message |
| `R2_ERROR` | 500 | Failed to generate signed URL | Retry or show error |
| `INTERNAL_ERROR` | 500 | Unexpected server error | Show generic error, log to Sentry |

---

## Testing Strategy

**Full testing specifications**: See `design/roadmap/testing/access-testing-definition.md`

### Testing Categories

1. **Validation Tests** (`packages/validation/src/schemas/access.test.ts`)
   - Test Zod schemas in isolation
   - No database dependencies
   - Fast unit tests

2. **Service Tests** (`packages/content-access/src/service.test.ts`)
   - Mock database and R2 client
   - Test business logic
   - Coverage: access control, URL generation, progress tracking

3. **Integration Tests** (`workers/auth/src/routes/content-access.integration.test.ts`)
   - Test full API endpoints
   - Mock database with test data
   - Verify HTTP responses and error codes

### Key Test Scenarios

- ✅ Free content accessible without purchase
- ✅ Paid content requires completed purchase
- ✅ Unpublished content returns 404
- ✅ Deleted content returns 404
- ✅ Playback progress upserts correctly
- ✅ Library filters work (all, in-progress, completed)
- ✅ Signed URLs have correct expiry
- ✅ Pagination works correctly

**Run Tests**:
```bash
# Validation tests
pnpm --filter @codex/validation test

# Service tests
pnpm --filter @codex/content-access test

# Integration tests
pnpm --filter auth-worker test:integration
```

---

## Implementation Steps

### Step 1: Database Schema (0.5 days)

1. Create `packages/database/src/schema/playback.ts` with video_playback table
2. Create migration file
3. Run migration: `pnpm db:migrate`
4. Verify schema: `pnpm db:studio`

**Verification**: Table exists, can manually insert/query records

---

### Step 2: Validation Schemas (0.25 days)

1. Create `packages/validation/src/schemas/access.ts`
2. Implement Zod schemas with proper defaults and bounds
3. Write unit tests
4. Verify 100% test coverage

**Verification**: `pnpm --filter @codex/validation test --coverage`

---

### Step 3: Content Access Service (1.5 days)

1. Create `packages/content-access/src/service.ts`
2. Implement `getStreamingUrl()` with access control
3. Implement `savePlaybackProgress()` with upsert
4. Implement `getPlaybackProgress()`
5. Implement `listUserLibrary()` with filters
6. Add comprehensive logging with ObservabilityClient
7. Write service tests with mocked DB and R2

**Verification**: All service tests pass, 100% coverage

---

### Step 4: API Endpoints (1 day)

1. Create `workers/auth/src/routes/content-access.ts`
2. Implement GET /api/content/:id/stream
3. Implement POST /api/content/:id/progress
4. Implement GET /api/content/:id/progress
5. Implement GET /api/user/library
6. Add error handling for all error codes
7. Wire up routes in main worker
8. Write integration tests

**Verification**: Integration tests pass, manual testing with curl/Postman

---

### Step 5: Documentation & Review (0.25 days)

1. Update API documentation
2. Add JSDoc comments to all public methods
3. Create example frontend integration code
4. Code review with team

---

## Definition of Done

### Functionality
- [ ] `video_playback` table created and migrated
- [ ] Access validation schemas implemented with Zod
- [ ] `ContentAccessService` class complete with all methods
- [ ] All 4 API endpoints implemented and working
- [ ] Free content accessible without purchase check
- [ ] Paid content requires purchase verification
- [ ] Signed URLs generated with correct expiry
- [ ] Playback progress upserts correctly
- [ ] User library returns purchased content with progress

### Code Quality
- [ ] TypeScript strict mode (no `any` types)
- [ ] All public methods have JSDoc comments
- [ ] Error codes standardized and documented
- [ ] Observability logging on all operations
- [ ] Input validation with clear error messages

### Testing
- [ ] Validation tests: 100% coverage
- [ ] Service tests: 100% coverage
- [ ] Integration tests for all endpoints
- [ ] Tests verify access control rules
- [ ] Tests verify error handling

### Integration
- [ ] Routes registered in auth worker
- [ ] R2 client configured correctly
- [ ] Database queries optimized (indexes used)
- [ ] Environment variables documented

### CI/CD
- [ ] All tests passing in CI
- [ ] TypeScript compilation successful
- [ ] Linting passing
- [ ] No security vulnerabilities

---

## Documentation References

### Must Read Before Implementation

1. **Database Schema v2.0** (CRITICAL)
   - File: `design/features/shared/database-schema.md`
   - Sections: Lines 465-497 (video_playback), Lines 367-417 (content_access)
   - Reason: Schema must match exactly

2. **R2 Bucket Structure** (CRITICAL)
   - File: `design/infrastructure/R2BucketStructure.md`
   - Sections: Lines 372-444 (Access Patterns, Signed URLs)
   - Reason: R2 key format and signed URL generation

3. **Testing Definition** (CRITICAL)
   - File: `design/roadmap/testing/access-testing-definition.md`
   - Sections: All
   - Reason: Test specifications and patterns

4. **Content Access PRD**
   - File: `design/features/content-access/pdr-phase-1.md`
   - Reason: Business requirements and user stories

5. **Content Access TDD**
   - File: `design/features/content-access/ttd-dphase-1.md`
   - Reason: Technical architecture and decisions

### Reference During Implementation

- **P1-CONTENT-001 Work Packet**: Content and media_items schema
- **P1-ECOM-001 Work Packet**: Purchase and content_access schema
- **STANDARDS.md**: Validation separation, error handling patterns
- **Row-Level Security Strategy**: database-schema.md lines 1348-1952

### Code Examples

- **R2 Client**: `packages/cloudflare-clients/src/r2/client.ts`
- **Auth Middleware**: `workers/auth/src/middleware/auth.ts`
- **Existing Service Pattern**: P1-CONTENT-001 content service

---

## Security Considerations

### Row-Level Security (RLS)

Per `database-schema.md` lines 1348-1952, this service enforces:

**Customers can access**:
- Content they've purchased (via content_access table)
- Their own playback progress (WHERE user_id = current_user)
- Their own library (WHERE customer_id = current_user)

**Customers cannot access**:
- Other users' purchase history
- Other users' playback progress
- Content they haven't purchased (paid content)

**Enforcement**:
- Application-level: All queries filter by authenticated userId
- Database-level (Phase 2+): RLS policies enforce same rules

### Signed URL Security

- **Expiry**: Default 1 hour, max 24 hours
- **One-time use**: No (URL can be reused until expiry)
- **Scope**: Single file (master.m3u8 or audio.mp3)
- **HLS Segments**: Browser requests additional signed URLs for .ts files
  - Frontend must request new signed URLs for segments (or configure CORS)
  - Phase 2: Implement token-based access for all HLS segments

### Attack Vectors

**URL Sharing**: Users could share signed URLs before expiry
- Mitigation (Phase 1): Short expiry (1 hour), acceptable risk
- Mitigation (Phase 2): Token-based authentication, device fingerprinting

**Replay Attacks**: Users could replay API calls
- Mitigation: Rate limiting on progress saves (max 1 per 10 seconds)

**Enumeration**: Users could enumerate content IDs
- Mitigation: UUIDs (not sequential IDs), 404 for unauthorized access

---

## Performance Considerations

### Database Queries

**Optimized Queries**:
- `getStreamingUrl`: 2 queries (content + purchase), uses indexes
- `savePlaybackProgress`: 1 query (upsert), no round-trip
- `listUserLibrary`: 2 queries (purchases + progress batch), uses indexes

**Indexes Required** (already in schema):
- `content`: (id, status, deleted_at)
- `content_access`: (user_id, content_id, access_type)
- `video_playback`: (user_id, content_id) - unique constraint serves as index
- `purchases`: (customer_id, status)

### Caching Strategy (Phase 2+)

**Content Metadata**: Cache for 5 minutes
```typescript
const cacheKey = `content:${contentId}`;
const cached = await redis.get(cacheKey);
if (cached) return JSON.parse(cached);
```

**Purchase Verification**: Cache for 1 hour
```typescript
const cacheKey = `access:${userId}:${contentId}`;
```

**Playback Progress**: No caching (realtime updates)

### R2 Performance

- **Signed URL Generation**: ~10ms (AWS SDK call)
- **Video Streaming**: Handled by R2 (no worker involved)
- **HLS Segment Requests**: Direct to R2 (bypass worker)

---

## Monitoring & Observability

### Key Metrics

**Success Metrics**:
- Streaming URL generation success rate
- Average playback progress save time
- Library load time (P95)

**Error Metrics**:
- ACCESS_DENIED rate (indicates purchase flow issues)
- CONTENT_NOT_FOUND rate (indicates broken links)
- R2_ERROR rate (indicates R2 issues)

**Business Metrics**:
- Content views per day
- Average watch completion rate
- Resume rate (users continuing where they left off)

### Logging

All operations logged with ObservabilityClient:
- `info`: Successful operations with key parameters
- `warn`: Access denied, content not found (expected errors)
- `error`: R2 failures, database errors (unexpected)

### Alerts

**Critical**:
- R2_ERROR rate > 5% (5 minutes)
- Database connection failures

**Warning**:
- ACCESS_DENIED rate spike (>50 in 1 minute)
- High latency on library endpoint (P95 > 500ms)

---

## Rollout Plan

### Phase 1: Core Implementation (This Work Packet)

- ✅ Basic access control (free vs paid)
- ✅ Signed URL generation
- ✅ Playback progress tracking
- ✅ User library with filters

### Phase 2: Enhanced Features

- Token-based HLS segment access (no URL sharing)
- Purchase verification caching (Redis)
- Advanced library filters (by category, creator)
- Watchlist functionality

### Phase 3: Analytics & Optimization

- View analytics (most watched content)
- Completion rate tracking
- A/B test different expiry times
- CDN integration for HLS delivery

---

## Known Limitations & Future Work

### Current Limitations

1. **HLS Segment Access**: Segments require additional signed URLs
   - Current: Frontend must request signed URLs for each segment
   - Future: Implement token-based authentication for all segments

2. **Concurrent Device Playback**: No device limit enforcement
   - Current: User can play on multiple devices simultaneously
   - Future: Enforce device limits per purchase

3. **Offline Viewing**: Not supported
   - Current: Requires internet connection for signed URLs
   - Future: Implement DRM with offline capability

4. **Preview Clips**: Not implemented
   - Current: All content requires purchase (or is free)
   - Future: Generate 30-second preview clips (see P1-TRANSCODE-001)

### Technical Debt

None (new implementation)

### Migration Path

No migration needed (new tables)

---

## Questions & Clarifications

**Q: Should we support subscription-based access in Phase 1?**
A: No. Phase 1 only supports:
- Free content (price_cents = 0)
- Purchased content (content_access.access_type = 'purchased')

Subscription access (content_access.access_type = 'subscription') is Phase 2.

**Q: How do we handle HLS segment requests?**
A: Phase 1 approach:
- Generate signed URL for master.m3u8
- Browser requests segments, R2 serves them
- CORS configured to allow segment requests

Phase 2: Token-based authentication for all segments.

**Q: Should we track audio playback progress?**
A: Yes. The same video_playback table handles both video and audio. Field name is historical.

**Q: What happens if user purchases content while watching preview?**
A: Frontend must refresh streaming URL with new access rights. Preview URLs expire quickly (5 minutes).

---

## Success Criteria

This work packet is successful when:

1. ✅ Users can watch free content without purchase
2. ✅ Users must purchase paid content before accessing
3. ✅ Video playback resumes from last saved position
4. ✅ User library shows all purchased content with progress
5. ✅ Signed URLs work for 1 hour without interruption
6. ✅ All tests pass with 100% coverage
7. ✅ No security vulnerabilities in access control
8. ✅ Performance meets targets (P95 < 200ms for URL generation)

---

## Step 7: Public API & Package Exports

**Package Configuration**:

**File**: `packages/content-access/package.json`

```json
{
  "name": "@codex/content-access",
  "version": "1.0.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./service": "./src/service.ts"
  },
  "dependencies": {
    "@codex/database": "workspace:*",
    "@codex/cloudflare-clients": "workspace:*",
    "@codex/observability": "workspace:*",
    "@codex/validation": "workspace:*",
    "drizzle-orm": "^0.29.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "vitest": "^1.0.0"
  }
}
```

**Public Interface**:

**File**: `packages/content-access/src/index.ts`

```typescript
/**
 * @codex/content-access
 *
 * Content access control and playback tracking for Codex platform.
 *
 * Core Responsibilities:
 * - Verify user access to content (free vs purchased)
 * - Generate time-limited signed R2 URLs for streaming
 * - Track video/audio playback progress for resume functionality
 * - Provide user content library with watch history
 *
 * Integration Points:
 * - Used by: Auth worker (streaming URLs), Admin dashboard (analytics)
 * - Depends on: @codex/database (content, purchases), @codex/cloudflare-clients (R2)
 *
 * Security Model:
 * - All operations require authenticated user ID (from JWT)
 * - Row-level security: Users can only access their own data
 * - Access control: Paid content requires purchase verification
 */

export { ContentAccessService, createContentAccessService } from './service';
export type { ContentAccessServiceConfig } from './service';

// Re-export validation schemas for convenience
export {
  getStreamingUrlSchema,
  savePlaybackProgressSchema,
  getPlaybackProgressSchema,
  listUserLibrarySchema,
  type GetStreamingUrlInput,
  type SavePlaybackProgressInput,
  type GetPlaybackProgressInput,
  type ListUserLibraryInput,
} from '@codex/validation/schemas/access';
```

**Usage Examples**:

```typescript
// Example 1: Generate streaming URL in auth worker
import { createContentAccessService } from '@codex/content-access';

const service = createContentAccessService({
  DATABASE_URL: env.DATABASE_URL,
  R2_BUCKET: env.R2_BUCKET,
  ENVIRONMENT: env.ENVIRONMENT,
});

const { streamingUrl, expiresAt } = await service.getStreamingUrl(userId, {
  contentId: 'uuid-here',
  expirySeconds: 3600, // 1 hour
});

// Example 2: Save playback progress
await service.savePlaybackProgress(userId, {
  contentId: 'uuid-here',
  positionSeconds: 120, // 2 minutes in
  durationSeconds: 600, // 10 minute video
});

// Example 3: Get user's library
const { items, pagination } = await service.listUserLibrary(userId, {
  page: 1,
  limit: 20,
  filter: 'in-progress', // Only videos user started
  sortBy: 'recent',
});
```

---

## Step 8: Local Development Setup

### Docker Compose Integration

The content access service works seamlessly with the existing local development setup. No additional containers needed - R2 and database are already configured.

**Existing Services Used**:

1. **Neon Postgres** (`infrastructure/neon/docker-compose.dev.local.yml`):
   - Already provides local PostgreSQL for content, purchases, video_playback tables
   - No changes needed

2. **R2 Local Storage**:
   - Development uses Cloudflare R2 test bucket or local MinIO
   - Configure via `.dev.vars` in auth worker

**Environment Configuration**:

**File**: `workers/auth/.dev.vars`

```bash
# Database (uses local Neon proxy)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/main

# R2 Storage (use R2 dev bucket or local MinIO)
R2_BUCKET_NAME=codex-media-dev
R2_ACCESS_KEY_ID=your-dev-access-key
R2_SECRET_ACCESS_KEY=your-dev-secret-key
R2_ENDPOINT=http://localhost:9000 # MinIO local or R2 dev endpoint

# Environment
ENVIRONMENT=development
```

### Local Testing Flow

**Step 1: Start Database**:
```bash
cd infrastructure/neon
docker-compose -f docker-compose.dev.local.yml up -d
```

**Step 2: Run Migrations**:
```bash
pnpm --filter @codex/database db:migrate
```

**Step 3: Seed Test Data** (optional):
```bash
# Create test content
pnpm --filter @codex/database db:seed
```

**Step 4: Start Auth Worker**:
```bash
pnpm --filter auth-worker dev
# Worker runs on http://localhost:8787
```

**Step 5: Test API**:
```bash
# Get streaming URL (requires auth token)
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  "http://localhost:8787/api/content/UUID/stream?expiry=3600"

# Save playback progress
curl -X POST \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"positionSeconds": 120, "durationSeconds": 600}' \
  "http://localhost:8787/api/content/UUID/progress"
```

### Development Workflow

**Typical Developer Day**:

1. Start local database (one-time)
2. Work on content-access package in isolation:
   ```bash
   # Run tests in watch mode
   pnpm --filter @codex/content-access test --watch

   # Type check
   pnpm --filter @codex/content-access typecheck
   ```
3. Test integration with auth worker:
   ```bash
   pnpm --filter auth-worker dev
   # Make changes, worker auto-reloads
   ```
4. Run full test suite before committing:
   ```bash
   pnpm test
   ```

**No External Services Required**:
- R2: Use local MinIO or R2 dev bucket
- Database: Local PostgreSQL via Docker
- Auth: Local JWT signing (no external auth provider needed)

---

## Step 9: CI/CD Integration

### CI Pipeline

Content access tests run automatically when:
- Any file in `packages/content-access/**` changes
- Any file in `packages/validation/src/schemas/access.ts` changes
- Any file in `workers/auth/src/routes/content-access.ts` changes

**GitHub Actions Workflow** (already configured in `.github/workflows/test.yml`):

```yaml
# Path-based test filtering (already in place)
- name: Run content access tests
  if: contains(github.event.head_commit.message, 'content-access') ||
      contains(github.event.modified_files, 'packages/content-access') ||
      contains(github.event.modified_files, 'workers/auth/src/routes/content-access')
  run: |
    # Validation tests (fast, no DB)
    pnpm --filter @codex/validation test -- access.test.ts

    # Service tests (mocked DB, mocked R2)
    pnpm --filter @codex/content-access test

    # Integration tests (test DB, real R2 dev)
    pnpm --filter auth-worker test:integration -- content-access
```

### Test Environment Setup

**CI Environment Variables** (GitHub Secrets):
```bash
# Test Database (Neon branch created per PR)
TEST_DATABASE_URL=postgresql://...

# R2 Test Bucket
R2_TEST_BUCKET_NAME=codex-media-test
R2_TEST_ACCESS_KEY_ID=***
R2_TEST_SECRET_ACCESS_KEY=***

# Environment
ENVIRONMENT=test
```

**Neon Database Branching** (per design/infrastructure/CICD.md):
```bash
# Create test branch from main
neon branches create --name "test-pr-${PR_NUMBER}" --parent main

# Run migrations
DATABASE_URL=$TEST_DATABASE_URL pnpm db:migrate

# Run tests
DATABASE_URL=$TEST_DATABASE_URL pnpm test

# Cleanup: Delete branch after tests
neon branches delete "test-pr-${PR_NUMBER}"
```

### Deployment Pipeline

**Staging Deployment** (on push to `main`):
```yaml
- name: Deploy auth worker to staging
  run: |
    cd workers/auth
    wrangler deploy --env staging

    # Smoke test
    curl -f https://staging-auth.codex.app/health || exit 1
```

**Production Deployment** (on tag `v*`):
```yaml
- name: Deploy auth worker to production
  run: |
    cd workers/auth
    wrangler deploy --env production

    # Smoke test
    curl -f https://auth.codex.app/health || exit 1
```

### Integration Test Strategy

**Test Data Isolation**:
- Each test creates its own user, content, and purchase records
- Tests use deterministic UUIDs for repeatability
- Cleanup after each test (or use Neon branches)

**R2 Test Bucket**:
- Separate bucket for CI: `codex-media-test`
- Pre-populated with test media files
- Signed URLs generated against test bucket

**Example Integration Test**:
```typescript
// workers/auth/src/routes/content-access.integration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';

describe('Content Access API', () => {
  beforeEach(async () => {
    // Seed test data: user, content, purchase
    await seedTestData();
  });

  it('should generate streaming URL for purchased content', async () => {
    const response = await fetch('http://localhost:8787/api/content/test-content-uuid/stream', {
      headers: { 'Authorization': `Bearer ${testJWT}` },
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.streamingUrl).toContain('r2.cloudflarestorage.com');
    expect(data.contentType).toBe('video');
  });

  it('should deny access to unpurchased paid content', async () => {
    const response = await fetch('http://localhost:8787/api/content/paid-content-uuid/stream', {
      headers: { 'Authorization': `Bearer ${testJWT}` },
    });

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error.code).toBe('ACCESS_DENIED');
  });
});
```

### Monitoring in CI/CD

**Test Coverage Requirements**:
- Validation tests: 100% coverage (enforced)
- Service tests: 100% coverage (enforced)
- Integration tests: No coverage requirement (end-to-end)

**Performance Benchmarks**:
- Streaming URL generation: < 200ms (P95)
- Playback progress save: < 100ms (P95)
- Library load: < 500ms (P95)

**CI Fails If**:
- Any test fails
- Coverage below threshold
- TypeScript errors
- Linting errors
- Performance benchmarks exceeded

---

## Integration Points Summary

### Package Dependencies

```
@codex/content-access
├── @codex/database (content, purchases, video_playback tables)
├── @codex/cloudflare-clients (R2 signed URLs)
├── @codex/observability (logging, metrics)
└── @codex/validation (Zod schemas)
```

### Used By

**1. Auth Worker** (`workers/auth`):
- Routes: `/api/content/:id/stream`, `/api/content/:id/progress`, `/api/user/library`
- Purpose: Frontend API for content access

**2. Admin Dashboard** (Future):
- Purpose: Analytics on content views, completion rates
- Query: video_playback table for aggregated stats

**3. Content Player** (Frontend):
- Purpose: Stream video/audio, save progress, resume playback
- Integration: Calls auth worker APIs

### Upstream Dependencies

**1. P1-CONTENT-001** (Content Service):
- Tables: `content`, `media_items`
- Fields: `status`, `price_cents`, `deleted_at`, `r2_key`

**2. P1-ECOM-001** (Stripe Checkout):
- Tables: `purchases`, `content_access`
- Fields: `customer_id`, `content_id`, `status`, `access_type`

**3. Infrastructure**:
- R2 Bucket: `codex-media-production` (or dev/staging)
- Database: Neon PostgreSQL

### Data Flow Diagram

```
Frontend Player
    |
    | 1. GET /api/content/:id/stream
    |
Auth Worker
    |
    | 2. Verify user purchased content
    |
@codex/content-access
    |
    ├─> @codex/database (check purchases)
    └─> @codex/cloudflare-clients (generate R2 signed URL)
    |
    | 3. Return signed URL
    |
Frontend Player
    |
    | 4. Stream video from R2
    |
R2 Bucket
```

---

**Document Status**: ✅ Ready for Implementation
**Last Updated**: 2025-11-09
**Version**: 2.1 (Added Steps 7-9 for developer isolation)
