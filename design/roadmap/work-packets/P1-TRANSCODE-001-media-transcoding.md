# Work Packet: P1-TRANSCODE-001 - Media Transcoding Service

**Status**: 🚧 To Be Implemented
**Priority**: P1 (High - enables streaming)
**Estimated Effort**: 5-7 days
**Branch**: `feature/P1-TRANSCODE-001-media-transcoding`

---

## Current State

**✅ Already Implemented:**
- R2 client for file storage (`packages/cloudflare-clients/src/r2/client.ts`)
- Database client with Drizzle ORM (`packages/database/src/client.ts`)
- Content schema with `media_items` table (from P1-CONTENT-001)
- Observability package for logging
- Security middleware (headers, rate limiting)
- Validation package with Zod schemas

**🚧 Needs Implementation:**
- Extended media_items schema (transcoding fields)
- Transcoding service (trigger jobs, handle webhooks)
- Transcoding API endpoints (webhook, retry)
- RunPod integration (GPU transcoding)
- Tests (unit + integration)

---

## Dependencies

### Required Work Packets
- **P1-CONTENT-001** (Content Service) - MUST complete first for `media_items` schema

### Required External Services
- **RunPod**: Serverless GPU endpoint with custom Docker image (FFmpeg + audiowaveform)
- **Cloudflare R2**: Storage for input/output media files

### Required Packages (Already Available)
```typescript
import { db } from '@codex/database';
import { R2Service } from '@codex/cloudflare-clients/r2';
import { ObservabilityClient } from '@codex/observability';
import { z } from 'zod';
```

### Required Documentation
- [Media Transcoding PRD](../../features/media-transcoding/pdr-phase-1.md)
- [Media Transcoding TDD](../../features/media-transcoding/ttd-dphase-1.md)
- [Database Schema](../../features/shared/database-schema.md) - Lines 130-183 (media_items)
- [STANDARDS.md](../STANDARDS.md)

---

## System Architecture

```
┌─────────────────┐       ┌──────────────────┐       ┌─────────────────┐
│  Content Upload │──────>│ Transcoding      │──────>│  RunPod GPU     │
│   (Completes)   │ Call  │    Service       │ HTTP  │  Serverless     │
└─────────────────┘       │ .triggerJob()    │ POST  │                 │
                          └──────────────────┘       │  - FFmpeg       │
                                                      │  - HLS transcode│
                                                      │  - Preview gen  │
                                                      │  - Waveform gen │
                                                      └─────────────────┘
                                                               │
                                                               │ Webhook callback
                                                               ▼
┌─────────────────┐       ┌──────────────────┐       ┌─────────────────┐
│ Update DB Status│<──────│  Webhook Handler │<──────│  RunPod Result  │
│ media_items     │       │  POST /api/      │       │  (Success/Fail) │
└─────────────────┘       │   transcode/     │       └─────────────────┘
                          │   webhook        │
                          └──────────────────┘
```

**Key Flows:**

1. **Upload Complete** → Content service calls `TranscodingService.triggerJob(mediaId)`
2. **Trigger Job** → Service calls RunPod API with media details → Status: `transcoding`
3. **RunPod Processing** → GPU transcodes video (HLS + preview + thumbnail)
4. **Webhook Callback** → RunPod calls `/api/transcoding/webhook` with results
5. **Update Status** → Webhook updates `media_items` → Status: `ready` or `failed`
6. **Retry Logic** → On failure, allow manual retry (1 attempt max)

**No Queues**: Direct HTTP calls to RunPod API, webhook callbacks for results.

---

## Implementation Steps

### Step 1: Extend Media Items Schema for Transcoding

**File**: `packages/database/src/schema/content.ts` (modify existing)

Add transcoding-specific fields to `mediaItems` table:

```typescript
export const mediaItems = pgTable('media_items', {
  // ... existing fields from P1-CONTENT-001 ...

  // Status already exists in base schema:
  // status: varchar('status', { length: 50 }).default('uploading').notNull(),
  // Enum: 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed'

  // HLS output keys (populated after transcoding)
  hlsMasterPlaylistKey: varchar('hls_master_playlist_key', { length: 500 }),
  // e.g., "{creator_id}/hls/{media_id}/master.m3u8"

  hlsPreviewKey: varchar('hls_preview_key', { length: 500 }),
  // e.g., "{creator_id}/hls/{media_id}/preview/preview.m3u8" (30-second preview)

  // Thumbnails (already in base schema, clarify usage)
  thumbnailKey: varchar('thumbnail_key', { length: 500 }),
  // e.g., "{creator_id}/thumbnails/media/{media_id}/auto-generated.jpg"
  // Auto-generated at 10% mark for videos

  // Audio-specific
  waveformKey: varchar('waveform_key', { length: 500 }),
  // e.g., "{creator_id}/waveforms/{media_id}/waveform.json"
  // Only populated for audio media_type

  // Metadata (already in base schema: duration_seconds, width, height)
  // These are populated after transcoding completes

  // Error tracking
  transcodingError: text('transcoding_error'),
  // Error message if status = 'failed'

  transcodingAttempts: integer('transcoding_attempts').default(0).notNull(),
  // Track retry attempts (max 1 retry)

  runpodJobId: varchar('runpod_job_id', { length: 255 }),
  // RunPod job ID for tracking/debugging

  // ... existing timestamps ...
});
```

**Migration**:
```bash
pnpm --filter @codex/database db:gen:drizzle
pnpm --filter @codex/database db:migrate
```

**Alignment**: This schema aligns with `design/features/shared/database-schema.md` lines 130-183 (MediaItems table).

---

### Step 2: Create Transcoding Service

**File**: `packages/web/src/lib/server/transcoding/service.ts`

```typescript
import { db } from '@codex/database';
import { mediaItems } from '@codex/database/schema';
import { eq } from 'drizzle-orm';
import { ObservabilityClient } from '@codex/observability';

export interface RunPodJobInput {
  mediaId: string;
  type: 'video' | 'audio';
  creatorId: string;
  inputKey: string; // R2 key: "{creator_id}/originals/{media_id}/file.mp4"
  webhookUrl: string; // Where RunPod should send results
}

export interface RunPodWebhookPayload {
  jobId: string;
  status: 'completed' | 'failed';
  output?: {
    mediaId: string;
    type: 'video' | 'audio';

    // Video/Audio outputs
    hlsMasterKey?: string; // "{creator_id}/hls/{media_id}/master.m3u8"
    hlsPreviewKey?: string; // "{creator_id}/hls/{media_id}/preview/preview.m3u8" (30s)
    thumbnailKey?: string; // "{creator_id}/thumbnails/media/{media_id}/auto-generated.jpg"
    durationSeconds?: number;
    width?: number;
    height?: number;

    // Audio-specific
    waveformKey?: string; // "{creator_id}/waveforms/{media_id}/waveform.json"
  };
  error?: string;
}

export class TranscodingService {
  private logger: ObservabilityClient;

  constructor(
    private runpodApiKey: string,
    private runpodEndpointId: string,
    private webhookBaseUrl: string // e.g., "https://yourapp.com"
  ) {
    this.logger = new ObservabilityClient('TranscodingService');
  }

  /**
   * Trigger transcoding job (called after media upload completes)
   */
  async triggerJob(mediaId: string, creatorId: string): Promise<void> {
    this.logger.info('Triggering transcoding job', { mediaId, creatorId });

    // Fetch media item
    const media = await db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, mediaId),
    });

    if (!media) {
      throw new Error(`Media item not found: ${mediaId}`);
    }

    if (media.status !== 'uploaded') {
      throw new Error(`Media item not in uploaded state: ${media.status}`);
    }

    // Build RunPod job input
    const jobInput: RunPodJobInput = {
      mediaId,
      type: media.mediaType as 'video' | 'audio',
      creatorId,
      inputKey: media.r2Key,
      webhookUrl: `${this.webhookBaseUrl}/api/transcoding/webhook`,
    };

    // Update status to transcoding
    await db
      .update(mediaItems)
      .set({
        status: 'transcoding',
        transcodingAttempts: media.transcodingAttempts + 1,
      })
      .where(eq(mediaItems.id, mediaId));

    // Call RunPod API
    try {
      const response = await fetch(
        `https://api.runpod.ai/v2/${this.runpodEndpointId}/run`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.runpodApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ input: jobInput }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`RunPod API error: ${response.status} - ${error}`);
      }

      const result = await response.json();

      // Store RunPod job ID for tracking
      await db
        .update(mediaItems)
        .set({ runpodJobId: result.id })
        .where(eq(mediaItems.id, mediaId));

      this.logger.info('RunPod job started', { mediaId, runpodJobId: result.id });
    } catch (error) {
      this.logger.error('Failed to trigger RunPod job', { mediaId, error });

      // Mark as failed
      await db
        .update(mediaItems)
        .set({
          status: 'failed',
          transcodingError: error instanceof Error ? error.message : 'Unknown error',
        })
        .where(eq(mediaItems.id, mediaId));

      throw error;
    }
  }

  /**
   * Handle webhook callback from RunPod
   */
  async handleWebhook(payload: RunPodWebhookPayload): Promise<void> {
    this.logger.info('Received RunPod webhook', { jobId: payload.jobId, status: payload.status });

    const { status, output, error } = payload;

    if (!output?.mediaId) {
      this.logger.error('Webhook missing mediaId', { payload });
      return;
    }

    const mediaId = output.mediaId;

    if (status === 'completed' && output) {
      // Success - update media item with transcoded outputs
      await db
        .update(mediaItems)
        .set({
          status: 'ready',
          hlsMasterPlaylistKey: output.hlsMasterKey,
          hlsPreviewKey: output.hlsPreviewKey,
          thumbnailKey: output.thumbnailKey,
          waveformKey: output.waveformKey,
          durationSeconds: output.durationSeconds,
          width: output.width,
          height: output.height,
          transcodingError: null, // Clear any previous errors
        })
        .where(eq(mediaItems.id, mediaId));

      this.logger.info('Media transcoding completed', { mediaId });
    } else {
      // Failure - mark as failed
      const media = await db.query.mediaItems.findFirst({
        where: eq(mediaItems.id, mediaId),
      });

      if (!media) {
        this.logger.error('Media item not found for failed job', { mediaId });
        return;
      }

      await db
        .update(mediaItems)
        .set({
          status: 'failed',
          transcodingError: error || 'Unknown transcoding error',
        })
        .where(eq(mediaItems.id, mediaId));

      this.logger.error('Media transcoding failed', { mediaId, error });
    }
  }

  /**
   * Manual retry (creator triggers from UI)
   * Only allowed if status = 'failed' and attempts < 2
   */
  async retryTranscoding(mediaId: string, creatorId: string): Promise<void> {
    const media = await db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, mediaId),
    });

    if (!media || media.creatorId !== creatorId) {
      throw new Error('Media item not found or unauthorized');
    }

    if (media.status !== 'failed') {
      throw new Error('Can only retry failed transcoding jobs');
    }

    if (media.transcodingAttempts >= 2) {
      throw new Error('Maximum retry attempts exceeded (2 max)');
    }

    // Reset to uploaded state and retry
    await db
      .update(mediaItems)
      .set({
        status: 'uploaded',
        transcodingError: null,
        runpodJobId: null,
      })
      .where(eq(mediaItems.id, mediaId));

    await this.triggerJob(mediaId, creatorId);

    this.logger.info('Transcoding retry triggered', { mediaId, attempt: media.transcodingAttempts + 1 });
  }

  /**
   * Get transcoding status for a media item
   */
  async getStatus(mediaId: string, creatorId: string) {
    const media = await db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, mediaId),
    });

    if (!media || media.creatorId !== creatorId) {
      throw new Error('Media item not found or unauthorized');
    }

    return {
      status: media.status,
      error: media.transcodingError,
      attempts: media.transcodingAttempts,
      runpodJobId: media.runpodJobId,
      outputs: {
        hlsMasterPlaylistKey: media.hlsMasterPlaylistKey,
        hlsPreviewKey: media.hlsPreviewKey,
        thumbnailKey: media.thumbnailKey,
        waveformKey: media.waveformKey,
      },
    };
  }
}
```

**Tests**: `packages/web/src/lib/server/transcoding/service.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TranscodingService } from './service';
import { db } from '@codex/database';
import { mediaItems } from '@codex/database/schema';
import { eq } from 'drizzle-orm';

describe('TranscodingService', () => {
  let service: TranscodingService;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    service = new TranscodingService(
      'test-api-key',
      'test-endpoint-id',
      'https://test.com'
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('triggerJob', () => {
    it('should trigger RunPod job and update status to transcoding', async () => {
      // Arrange
      const mediaId = 'test-media-id';
      const creatorId = 'test-creator-id';

      // Mock database query
      vi.spyOn(db.query.mediaItems, 'findFirst').mockResolvedValue({
        id: mediaId,
        creatorId,
        mediaType: 'video',
        status: 'uploaded',
        r2Key: 'originals/test/video.mp4',
        transcodingAttempts: 0,
      } as any);

      // Mock database update
      const updateSpy = vi.spyOn(db, 'update').mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      } as any);

      // Mock RunPod API response
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'runpod-job-123', status: 'IN_QUEUE' }),
      });

      // Act
      await service.triggerJob(mediaId, creatorId);

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.runpod.ai/v2/test-endpoint-id/run',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
          }),
        })
      );

      expect(updateSpy).toHaveBeenCalled();
    });

    it('should throw error if media item not in uploaded state', async () => {
      vi.spyOn(db.query.mediaItems, 'findFirst').mockResolvedValue({
        id: 'test-media-id',
        status: 'ready', // Already processed
      } as any);

      await expect(
        service.triggerJob('test-media-id', 'creator-id')
      ).rejects.toThrow('not in uploaded state');
    });

    it('should mark as failed if RunPod API call fails', async () => {
      vi.spyOn(db.query.mediaItems, 'findFirst').mockResolvedValue({
        id: 'test-media-id',
        creatorId: 'creator-id',
        mediaType: 'video',
        status: 'uploaded',
        r2Key: 'test.mp4',
        transcodingAttempts: 0,
      } as any);

      const updateSpy = vi.spyOn(db, 'update').mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      } as any);

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(
        service.triggerJob('test-media-id', 'creator-id')
      ).rejects.toThrow('RunPod API error');

      // Should update to failed status
      expect(updateSpy).toHaveBeenCalled();
    });
  });

  describe('handleWebhook', () => {
    it('should update media item on successful completion', async () => {
      const payload = {
        jobId: 'runpod-job-123',
        status: 'completed' as const,
        output: {
          mediaId: 'test-media-id',
          type: 'video' as const,
          hlsMasterKey: '{creator_id}/hls/test/master.m3u8',
          hlsPreviewKey: '{creator_id}/hls/test/preview/preview.m3u8',
          thumbnailKey: '{creator_id}/thumbnails/test.jpg',
          durationSeconds: 300,
          width: 1920,
          height: 1080,
        },
      };

      const updateSpy = vi.spyOn(db, 'update').mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      } as any);

      await service.handleWebhook(payload);

      expect(updateSpy).toHaveBeenCalled();
      const setCall = (updateSpy.mock.results[0].value as any).set.mock.calls[0][0];
      expect(setCall.status).toBe('ready');
      expect(setCall.hlsMasterPlaylistKey).toBe(payload.output.hlsMasterKey);
    });

    it('should mark as failed on error status', async () => {
      vi.spyOn(db.query.mediaItems, 'findFirst').mockResolvedValue({
        id: 'test-media-id',
      } as any);

      const updateSpy = vi.spyOn(db, 'update').mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      } as any);

      const payload = {
        jobId: 'runpod-job-123',
        status: 'failed' as const,
        output: { mediaId: 'test-media-id', type: 'video' as const },
        error: 'FFmpeg encoding failed',
      };

      await service.handleWebhook(payload);

      const setCall = (updateSpy.mock.results[0].value as any).set.mock.calls[0][0];
      expect(setCall.status).toBe('failed');
      expect(setCall.transcodingError).toBe('FFmpeg encoding failed');
    });
  });

  describe('retryTranscoding', () => {
    it('should allow retry for failed transcoding', async () => {
      vi.spyOn(db.query.mediaItems, 'findFirst').mockResolvedValue({
        id: 'test-media-id',
        creatorId: 'creator-id',
        mediaType: 'video',
        status: 'failed',
        r2Key: 'test.mp4',
        transcodingAttempts: 1,
      } as any);

      const updateSpy = vi.spyOn(db, 'update').mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      } as any);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'runpod-job-456' }),
      });

      await service.retryTranscoding('test-media-id', 'creator-id');

      expect(updateSpy).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should reject retry if max attempts exceeded', async () => {
      vi.spyOn(db.query.mediaItems, 'findFirst').mockResolvedValue({
        id: 'test-media-id',
        creatorId: 'creator-id',
        status: 'failed',
        transcodingAttempts: 2, // Already tried twice
      } as any);

      await expect(
        service.retryTranscoding('test-media-id', 'creator-id')
      ).rejects.toThrow('Maximum retry attempts exceeded');
    });

    it('should reject retry if status is not failed', async () => {
      vi.spyOn(db.query.mediaItems, 'findFirst').mockResolvedValue({
        id: 'test-media-id',
        creatorId: 'creator-id',
        status: 'ready',
        transcodingAttempts: 0,
      } as any);

      await expect(
        service.retryTranscoding('test-media-id', 'creator-id')
      ).rejects.toThrow('Can only retry failed transcoding jobs');
    });
  });

  describe('getStatus', () => {
    it('should return transcoding status and outputs', async () => {
      vi.spyOn(db.query.mediaItems, 'findFirst').mockResolvedValue({
        id: 'test-media-id',
        creatorId: 'creator-id',
        status: 'ready',
        transcodingError: null,
        transcodingAttempts: 1,
        runpodJobId: 'runpod-job-123',
        hlsMasterPlaylistKey: 'hls/test/master.m3u8',
        hlsPreviewKey: 'hls/test/preview/preview.m3u8',
        thumbnailKey: 'thumbnails/test.jpg',
        waveformKey: null,
      } as any);

      const result = await service.getStatus('test-media-id', 'creator-id');

      expect(result.status).toBe('ready');
      expect(result.attempts).toBe(1);
      expect(result.outputs.hlsMasterPlaylistKey).toBe('hls/test/master.m3u8');
    });
  });
});
```

---

### Step 3: Create API Endpoints

#### Webhook Endpoint

**File**: `apps/web/src/routes/api/transcoding/webhook/+server.ts`

```typescript
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TranscodingService } from '$lib/server/transcoding/service';
import type { RunPodWebhookPayload } from '$lib/server/transcoding/service';
import { ObservabilityClient } from '@codex/observability';

const logger = new ObservabilityClient('TranscodingWebhook');

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    const payload: RunPodWebhookPayload = await request.json();

    logger.info('Received transcoding webhook', { jobId: payload.jobId, status: payload.status });

    // Verify webhook signature (if RunPod supports it)
    // const signature = request.headers.get('x-runpod-signature');
    // if (!verifySignature(signature, payload)) {
    //   logger.error('Invalid webhook signature');
    //   throw error(401, 'Invalid signature');
    // }

    const service = new TranscodingService(
      platform?.env.RUNPOD_API_KEY || process.env.RUNPOD_API_KEY!,
      platform?.env.RUNPOD_ENDPOINT_ID || process.env.RUNPOD_ENDPOINT_ID!,
      platform?.env.PUBLIC_APP_URL || process.env.PUBLIC_APP_URL!
    );

    await service.handleWebhook(payload);

    logger.info('Webhook processed successfully', { jobId: payload.jobId });

    return json({ success: true });
  } catch (err) {
    logger.error('Webhook processing error', { error: err });
    throw error(500, 'Webhook processing failed');
  }
};
```

#### Retry Endpoint

**File**: `apps/web/src/routes/api/transcoding/retry/+server.ts`

```typescript
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TranscodingService } from '$lib/server/transcoding/service';
import { getUserFromSession } from '$lib/server/auth/session';
import { ObservabilityClient } from '@codex/observability';
import { z } from 'zod';

const logger = new ObservabilityClient('TranscodingRetry');

const retrySchema = z.object({
  mediaId: z.string().uuid(),
});

export const POST: RequestHandler = async ({ request, platform, cookies }) => {
  try {
    // Authenticate user
    const user = await getUserFromSession(cookies);
    if (!user) {
      throw error(401, 'Unauthorized');
    }

    // Validate input
    const body = await request.json();
    const { mediaId } = retrySchema.parse(body);

    logger.info('Retry transcoding requested', { mediaId, userId: user.id });

    const service = new TranscodingService(
      platform?.env.RUNPOD_API_KEY || process.env.RUNPOD_API_KEY!,
      platform?.env.RUNPOD_ENDPOINT_ID || process.env.RUNPOD_ENDPOINT_ID!,
      platform?.env.PUBLIC_APP_URL || process.env.PUBLIC_APP_URL!
    );

    await service.retryTranscoding(mediaId, user.id);

    logger.info('Retry successful', { mediaId });

    return json({ success: true, message: 'Transcoding retry triggered' });
  } catch (err) {
    logger.error('Retry failed', { error: err });

    if (err instanceof z.ZodError) {
      throw error(400, 'Invalid request');
    }

    if (err instanceof Error && err.message.includes('unauthorized')) {
      throw error(403, 'Access denied');
    }

    if (err instanceof Error && err.message.includes('Maximum retry attempts')) {
      throw error(400, err.message);
    }

    throw error(500, 'Failed to retry transcoding');
  }
};
```

#### Status Endpoint

**File**: `apps/web/src/routes/api/transcoding/status/[mediaId]/+server.ts`

```typescript
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TranscodingService } from '$lib/server/transcoding/service';
import { getUserFromSession } from '$lib/server/auth/session';
import { ObservabilityClient } from '@codex/observability';

const logger = new ObservabilityClient('TranscodingStatus');

export const GET: RequestHandler = async ({ params, platform, cookies }) => {
  try {
    // Authenticate user
    const user = await getUserFromSession(cookies);
    if (!user) {
      throw error(401, 'Unauthorized');
    }

    const mediaId = params.mediaId;
    if (!mediaId) {
      throw error(400, 'Missing mediaId parameter');
    }

    const service = new TranscodingService(
      platform?.env.RUNPOD_API_KEY || process.env.RUNPOD_API_KEY!,
      platform?.env.RUNPOD_ENDPOINT_ID || process.env.RUNPOD_ENDPOINT_ID!,
      platform?.env.PUBLIC_APP_URL || process.env.PUBLIC_APP_URL!
    );

    const status = await service.getStatus(mediaId, user.id);

    return json(status);
  } catch (err) {
    logger.error('Status check failed', { error: err });

    if (err instanceof Error && err.message.includes('unauthorized')) {
      throw error(403, 'Access denied');
    }

    throw error(500, 'Failed to get transcoding status');
  }
};
```

---

### Step 4: Integration with Content Service

**File**: `packages/web/src/lib/server/content/service.ts` (modify existing from P1-CONTENT-001)

After successful upload, trigger transcoding:

```typescript
import { TranscodingService } from '../transcoding/service';

export class ContentService {
  // ... existing methods ...

  async completeUpload(
    mediaId: string,
    creatorId: string,
    platform: App.Platform
  ): Promise<void> {
    // Mark upload as complete
    await db
      .update(mediaItems)
      .set({ status: 'uploaded' })
      .where(eq(mediaItems.id, mediaId));

    // Trigger transcoding
    const transcodingService = new TranscodingService(
      platform.env.RUNPOD_API_KEY,
      platform.env.RUNPOD_ENDPOINT_ID,
      platform.env.PUBLIC_APP_URL
    );

    try {
      await transcodingService.triggerJob(mediaId, creatorId);
    } catch (error) {
      // Log error but don't fail upload
      // User can manually retry from UI
      console.error('Failed to trigger transcoding:', error);
    }
  }
}
```

---

### Step 5: RunPod Docker Image (FFmpeg + Preview Generation)

**File**: `infrastructure/runpod/Dockerfile`

```dockerfile
FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04

# Install FFmpeg with NVIDIA hardware acceleration
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    audiowaveform \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies for S3/R2 uploads
RUN pip3 install boto3 requests

# Copy transcoding script
COPY transcode.py /app/transcode.py
WORKDIR /app

CMD ["python3", "transcode.py"]
```

**File**: `infrastructure/runpod/transcode.py`

```python
import os
import sys
import json
import subprocess
import boto3
import requests
from pathlib import Path

def transcode_video(media_id, creator_id, input_key, webhook_url):
    """
    Transcode video to HLS with multiple quality variants + 30-second preview
    """

    # Download input from R2
    s3_client = boto3.client(
        's3',
        endpoint_url=os.environ['R2_ENDPOINT'],
        aws_access_key_id=os.environ['R2_ACCESS_KEY'],
        aws_secret_access_key=os.environ['R2_SECRET_KEY']
    )

    bucket_name = os.environ['R2_BUCKET'] # 'codex-media'
    input_file = f"/tmp/{media_id}_input.mp4"
    s3_client.download_file(bucket_name, input_key, input_file)

    # Create output directory
    output_dir = Path(f"/tmp/{media_id}")
    output_dir.mkdir(exist_ok=True)

    # --- Full HLS Transcoding ---

    # Generate HLS master playlist with 4 quality variants
    variants = [
        {'name': '1080p', 'scale': '1920:1080', 'bitrate_v': '5000k', 'bitrate_a': '128k'},
        {'name': '720p', 'scale': '1280:720', 'bitrate_v': '2500k', 'bitrate_a': '128k'},
        {'name': '480p', 'scale': '854:480', 'bitrate_v': '1000k', 'bitrate_a': '128k'},
        {'name': '360p', 'scale': '640:360', 'bitrate_v': '500k', 'bitrate_a': '64k'},
    ]

    for variant in variants:
        ffmpeg_cmd = [
            'ffmpeg', '-i', input_file,
            '-vf', f'scale={variant["scale"]}',
            '-c:v', 'h264_nvenc', '-b:v', variant['bitrate_v'],
            '-c:a', 'aac', '-b:a', variant['bitrate_a'],
            '-f', 'hls', '-hls_time', '6',
            '-hls_playlist_type', 'vod',
            '-hls_segment_filename', f'{output_dir}/{variant["name"]}_%03d.ts',
            f'{output_dir}/{variant["name"]}.m3u8'
        ]
        subprocess.run(ffmpeg_cmd, check=True)

    # Create master playlist
    master_playlist = """#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480
480p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360
360p.m3u8
"""

    with open(f'{output_dir}/master.m3u8', 'w') as f:
        f.write(master_playlist)

    # --- 30-Second Preview HLS ---

    preview_dir = Path(f"/tmp/{media_id}/preview")
    preview_dir.mkdir(exist_ok=True)

    preview_cmd = [
        'ffmpeg', '-i', input_file, '-t', '30',  # First 30 seconds
        '-vf', 'scale=1280:720', '-c:v', 'h264_nvenc', '-b:v', '2500k',
        '-c:a', 'aac', '-b:a', '128k', '-f', 'hls', '-hls_time', '6',
        '-hls_playlist_type', 'vod', '-hls_segment_filename',
        f'{preview_dir}/preview_%03d.ts', f'{preview_dir}/preview.m3u8'
    ]
    subprocess.run(preview_cmd, check=True)

    # --- Extract Thumbnail (10% mark) ---

    # Get video duration
    probe_cmd = [
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', input_file
    ]
    duration = float(subprocess.check_output(probe_cmd).decode().strip())
    thumbnail_time = duration * 0.1  # 10% mark

    thumbnail_path = f'/tmp/{media_id}_thumbnail.jpg'
    thumbnail_cmd = [
        'ffmpeg', '-ss', str(thumbnail_time), '-i', input_file,
        '-vframes', '1', '-vf', 'scale=1280:720', thumbnail_path
    ]
    subprocess.run(thumbnail_cmd, check=True)

    # --- Upload to R2 ---

    # Upload HLS files
    for file in output_dir.rglob('*'):
        if file.is_file():
            relative_path = file.relative_to(output_dir)
            s3_key = f'{creator_id}/hls/{media_id}/{relative_path}'
            s3_client.upload_file(str(file), bucket_name, s3_key)

    # Upload preview files
    for file in preview_dir.rglob('*'):
        if file.is_file():
            relative_path = file.relative_to(preview_dir)
            s3_key = f'{creator_id}/hls/{media_id}/preview/{relative_path}'
            s3_client.upload_file(str(file), bucket_name, s3_key)

    # Upload thumbnail
    thumbnail_key = f'{creator_id}/thumbnails/media/{media_id}/auto-generated.jpg'
    s3_client.upload_file(thumbnail_path, bucket_name, thumbnail_key)

    # --- Get video metadata ---

    probe_cmd = [
        'ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height', '-of', 'json', input_file
    ]
    metadata = json.loads(subprocess.check_output(probe_cmd).decode())
    width = metadata['streams'][0]['width']
    height = metadata['streams'][0]['height']

    # --- Send webhook callback ---

    result = {
        'jobId': os.environ.get('RUNPOD_JOB_ID'),
        'status': 'completed',
        'output': {
            'mediaId': media_id,
            'type': 'video',
            'hlsMasterKey': f'{creator_id}/hls/{media_id}/master.m3u8',
            'hlsPreviewKey': f'{creator_id}/hls/{media_id}/preview/preview.m3u8',
            'thumbnailKey': thumbnail_key,
            'durationSeconds': int(duration),
            'width': width,
            'height': height,
        }
    }

    # Send to webhook
    requests.post(webhook_url, json=result)

    return result

def transcode_audio(media_id, creator_id, input_key, webhook_url):
    """
    Transcode audio to HLS + generate waveform
    """

    s3_client = boto3.client(
        's3',
        endpoint_url=os.environ['R2_ENDPOINT'],
        aws_access_key_id=os.environ['R2_ACCESS_KEY'],
        aws_secret_access_key=os.environ['R2_SECRET_KEY']
    )

    bucket_name = os.environ['R2_BUCKET']
    input_file = f"/tmp/{media_id}_input.mp3"
    s3_client.download_file(bucket_name, input_key, input_file)

    output_dir = Path(f"/tmp/{media_id}")
    output_dir.mkdir(exist_ok=True)

    # --- HLS Audio Transcoding (2 quality variants) ---

    variants = [
        {'name': '128k', 'bitrate': '128k'},
        {'name': '64k', 'bitrate': '64k'},
    ]

    for variant in variants:
        ffmpeg_cmd = [
            'ffmpeg', '-i', input_file,
            '-c:a', 'aac', '-b:a', variant['bitrate'],
            '-f', 'hls', '-hls_time', '6',
            '-hls_playlist_type', 'vod',
            '-hls_segment_filename', f'{output_dir}/{variant["name"]}_%03d.ts',
            f'{output_dir}/{variant["name"]}.m3u8'
        ]
        subprocess.run(ffmpeg_cmd, check=True)

    # Create master playlist
    master_playlist = """#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=128000
128k.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=64000
64k.m3u8
"""

    with open(f'{output_dir}/master.m3u8', 'w') as f:
        f.write(master_playlist)

    # --- 30-Second Preview ---

    preview_dir = Path(f"/tmp/{media_id}/preview")
    preview_dir.mkdir(exist_ok=True)

    preview_cmd = [
        'ffmpeg', '-i', input_file, '-t', '30',
        '-c:a', 'aac', '-b:a', '128k',
        '-f', 'hls', '-hls_time', '6',
        '-hls_playlist_type', 'vod',
        '-hls_segment_filename', f'{preview_dir}/preview_%03d.ts',
        f'{preview_dir}/preview.m3u8'
    ]
    subprocess.run(preview_cmd, check=True)

    # --- Generate Waveform JSON ---

    waveform_file = f'/tmp/{media_id}_waveform.json'
    waveform_cmd = [
        'audiowaveform', '-i', input_file,
        '-o', waveform_file, '--output-format', 'json',
        '--pixels-per-second', '20', '--bits', '8'
    ]
    subprocess.run(waveform_cmd, check=True)

    # --- Get audio duration ---

    probe_cmd = [
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', input_file
    ]
    duration = float(subprocess.check_output(probe_cmd).decode().strip())

    # --- Upload to R2 ---

    # Upload HLS files
    for file in output_dir.rglob('*'):
        if file.is_file():
            relative_path = file.relative_to(output_dir)
            s3_key = f'{creator_id}/hls/{media_id}/{relative_path}'
            s3_client.upload_file(str(file), bucket_name, s3_key)

    # Upload preview
    for file in preview_dir.rglob('*'):
        if file.is_file():
            relative_path = file.relative_to(preview_dir)
            s3_key = f'{creator_id}/hls/{media_id}/preview/{relative_path}'
            s3_client.upload_file(str(file), bucket_name, s3_key)

    # Upload waveform
    waveform_key = f'{creator_id}/waveforms/{media_id}/waveform.json'
    s3_client.upload_file(waveform_file, bucket_name, waveform_key)

    # --- Send webhook callback ---

    result = {
        'jobId': os.environ.get('RUNPOD_JOB_ID'),
        'status': 'completed',
        'output': {
            'mediaId': media_id,
            'type': 'audio',
            'hlsMasterKey': f'{creator_id}/hls/{media_id}/master.m3u8',
            'hlsPreviewKey': f'{creator_id}/hls/{media_id}/preview/preview.m3u8',
            'waveformKey': waveform_key,
            'durationSeconds': int(duration),
        }
    }

    requests.post(webhook_url, json=result)

    return result

if __name__ == '__main__':
    job_input = json.loads(sys.stdin.read())

    try:
        if job_input['type'] == 'video':
            transcode_video(
                job_input['mediaId'],
                job_input['creatorId'],
                job_input['inputKey'],
                job_input['webhookUrl']
            )
        else:
            transcode_audio(
                job_input['mediaId'],
                job_input['creatorId'],
                job_input['inputKey'],
                job_input['webhookUrl']
            )
    except Exception as e:
        # Send failure webhook
        result = {
            'jobId': os.environ.get('RUNPOD_JOB_ID'),
            'status': 'failed',
            'output': {
                'mediaId': job_input.get('mediaId'),
                'type': job_input.get('type'),
            },
            'error': str(e),
        }
        requests.post(job_input['webhookUrl'], json=result)
        raise
```

**Deployment**:
```bash
# Build and push Docker image
cd infrastructure/runpod
docker build -t codex-transcoding:latest .
docker tag codex-transcoding:latest your-registry/codex-transcoding:latest
docker push your-registry/codex-transcoding:latest

# Create RunPod serverless endpoint
# 1. Go to RunPod dashboard
# 2. Create new serverless endpoint
# 3. Use Docker image: your-registry/codex-transcoding:latest
# 4. Set environment variables:
#    - R2_ENDPOINT
#    - R2_ACCESS_KEY
#    - R2_SECRET_KEY
#    - R2_BUCKET
# 5. Copy endpoint ID for use in RUNPOD_ENDPOINT_ID secret
```

---

## Definition of Done

### Functional Requirements
- [ ] Schema extended with transcoding fields (`hls_preview_key`, `waveform_key`, `transcoding_error`, etc.)
- [ ] Media items auto-transcode after upload via direct RunPod API call
- [ ] Video → HLS with 4 quality variants (1080p, 720p, 480p, 360p)
- [ ] Video → 30-second preview HLS playlist
- [ ] Video → Auto-generated thumbnail (10% mark)
- [ ] Audio → HLS with 2 quality variants (128kbps, 64kbps)
- [ ] Audio → 30-second preview HLS playlist
- [ ] Audio → Waveform JSON generation
- [ ] Status tracking: `uploaded` → `transcoding` → `ready` / `failed`
- [ ] Webhook handles success and failure callbacks
- [ ] Manual retry endpoint (max 1 retry)
- [ ] Status endpoint for frontend polling

### Testing Requirements
- [ ] Unit tests for `TranscodingService` (all methods)
  - [ ] triggerJob (success, failure, invalid state)
  - [ ] handleWebhook (success, failure)
  - [ ] retryTranscoding (success, max attempts, wrong status)
  - [ ] getStatus (success, unauthorized)
- [ ] Integration test: Full video transcoding flow (mock RunPod)
- [ ] Integration test: Audio transcoding + waveform (mock RunPod)
- [ ] Integration test: Webhook callback handling
- [ ] Integration test: Retry logic
- [ ] All tests pass in CI

### Infrastructure Requirements
- [ ] RunPod serverless endpoint configured
- [ ] RunPod Docker image built and deployed
- [ ] Environment variables configured:
  - [ ] `RUNPOD_API_KEY`
  - [ ] `RUNPOD_ENDPOINT_ID`
  - [ ] `PUBLIC_APP_URL`
- [ ] Webhook URL accessible from RunPod (public endpoint)

### Documentation Requirements
- [ ] Schema migration documented
- [ ] RunPod setup process documented
- [ ] Transcoding troubleshooting guide
- [ ] API endpoints documented (webhook, retry, status)

---

## Related Documentation

- **PRD**: [Media Transcoding PRD](../../features/media-transcoding/pdr-phase-1.md)
- **TDD**: [Media Transcoding TDD](../../features/media-transcoding/ttd-dphase-1.md)
- **Schema**: [Database Schema](../../features/shared/database-schema.md) - Lines 130-183
- **Dependencies**: [Cross-Feature Dependencies](../../cross-feature-dependencies.md#6-media-transcoding)
- **Standards**: [STANDARDS.md](../STANDARDS.md)

---

## Notes

### Why No Queues?

**Decision**: Use direct HTTP calls instead of Cloudflare Queues because:

1. **Simplicity**: No need for separate queue consumer worker
2. **Immediate Feedback**: RunPod API returns job ID immediately for tracking
3. **Webhooks Handle Async**: RunPod calls our webhook when done (no polling needed)
4. **Cost**: Avoids queue storage costs
5. **Alignment**: Matches pattern used in other work packets (direct service calls)

### Why 30-Second Previews?

- **Marketing**: Let customers sample content before purchasing
- **Engagement**: Video previews drive higher conversion than text descriptions
- **No Configuration (Phase 1)**: Always first 30 seconds for simplicity
- **Future (Phase 2+)**: Let creators configure preview start time and duration

### R2 Storage Structure

```
codex-media/
└── {creator_id}/
    ├── originals/
    │   └── {media_id}/
    │       └── video.mp4
    ├── hls/
    │   └── {media_id}/
    │       ├── master.m3u8          # Full video master playlist
    │       ├── 1080p.m3u8
    │       ├── 720p.m3u8
    │       ├── 480p.m3u8
    │       ├── 360p.m3u8
    │       ├── 1080p_000.ts
    │       ├── ...
    │       └── preview/
    │           ├── preview.m3u8     # 30-second preview
    │           ├── preview_000.ts
    │           └── ...
    ├── thumbnails/
    │   └── media/
    │       └── {media_id}/
    │           └── auto-generated.jpg
    └── waveforms/
        └── {media_id}/
            └── waveform.json
```

### Cost Estimates (RunPod GPU)

- **1GB video (1080p, 10 min)**: ~2 minutes GPU time = $0.02
- **Preview generation**: +10 seconds = +$0.002
- **100MB audio + waveform**: ~30 seconds = $0.005
- **Daily estimate (10 videos, 20 audio)**: ~$0.30/day = $9/month

### Retry Strategy

- **Single Retry**: Allow manual retry if transcoding fails (max 1 attempt)
- **Why Manual?**: Serverless failures are usually deterministic (corrupted file, unsupported codec)
- **No Auto-Retry**: Avoids wasting money on files that will never succeed
- **UI Control**: Creator sees failure reason and decides whether to retry or re-upload

---

**Document Version**: 2.0
**Last Updated**: 2025-11-09
**Status**: Ready for Implementation
