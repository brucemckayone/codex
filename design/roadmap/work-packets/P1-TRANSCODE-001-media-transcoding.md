# P1-TRANSCODE-001: Media Transcoding Service

**Priority**: P1 (High - enables streaming)
**Status**: 📋 Ready for Implementation
**Estimated Effort**: 5-7 days

> **Implementation Plan**: See [`P1-TRANSCODE-001-implementation-plan.md`](../implementation-plans/P1-TRANSCODE-001-implementation-plan.md) for complete technical details, Python handler code, FFmpeg commands, Dockerfile, and all contracts.

---

## Table of Contents

- [Overview](#overview)
- [System Context](#system-context)
- [Database Schema](#database-schema)
- [Service Architecture](#service-architecture)
- [Implementation Patterns](#implementation-patterns)
- [API Integration](#api-integration)
- [Available Patterns & Utilities](#available-patterns--utilities)
- [Dependencies](#dependencies)
- [Implementation Checklist](#implementation-checklist)
- [Testing Strategy](#testing-strategy)
- [Notes](#notes)

---

## Overview

Media Transcoding Service converts uploaded video and audio files into streamable HLS format using GPU-accelerated transcoding via RunPod. This service bridges the gap between content upload and content delivery, transforming raw media into optimized streaming assets.

The transcoding pipeline processes uploaded media through multiple stages: triggering GPU jobs on RunPod, monitoring job progress, receiving webhook callbacks, and updating media status. For videos, it generates multi-quality HLS streams, preview clips, and thumbnails. For audio, it creates HLS audio streams and visual waveforms.

Key capabilities:
- **GPU Transcoding**: Serverless GPU processing via RunPod for fast video/audio encoding
- **HLS Generation**: Multi-quality adaptive bitrate streaming (1080p, 720p, 480p, 360p)
- **Preview Clips**: 30-second video previews for content discovery
- **Thumbnail Extraction**: Auto-generated thumbnails at 10% mark
- **Audio Waveforms**: Visual waveform data for audio playback UI
- **Webhook Integration**: Asynchronous job completion via RunPod callbacks
- **Retry Logic**: One manual retry allowed for failed jobs

This service is consumed by:
- **Content Service** (P1-CONTENT-001): Triggers transcoding after upload completion
- **Access Service** (P1-ACCESS-001): Reads HLS keys for streaming URL generation
- **Frontend**: Displays transcoding status and allows manual retries

---

## System Context

### Upstream Dependencies

**Content Service** (P1-CONTENT-001) (✅ Complete):
- Calls `TranscodingService.triggerJob()` after media upload
- Reads media status to prevent publishing un-transcoded content
- Integration: Content service waits for `status = 'ready'` before allowing publish

**R2 Storage** (✅ Available via `@codex/cloudflare-clients`):
- Stores original uploaded files (input for transcoding)
- Stores transcoded HLS outputs, previews, thumbnails, waveforms
- Integration: R2Service provides upload/download/delete operations

**RunPod API** (External Service):
- GPU-accelerated transcoding service
- Receives job requests via REST API
- Sends results via webhook callback
- Integration: HTTP POST to RunPod endpoint, webhook receiver for results

### Downstream Consumers

**Access Service** (P1-ACCESS-001):
- Reads `hlsMasterPlaylistKey` to generate streaming URLs
- Verifies media `status = 'ready'` before streaming
- Integration: Access service generates presigned R2 URL for HLS master playlist

**Content Service** (P1-CONTENT-001):
- Checks media `status` before allowing content publication
- Displays transcoding progress to creators
- Integration: Content cannot be published until media ready

**Admin Dashboard** (P1-ADMIN-001):
- Monitors transcoding success/failure rates
- Provides manual retry functionality
- Integration: Queries media_items for transcoding metrics

### External Services

**RunPod**: GPU transcoding (FFmpeg, audiowaveform)
**Cloudflare R2**: Media file storage
**Neon PostgreSQL**: Transcoding job tracking
**Cloudflare Workers**: Webhook receiver

### Integration Flow

```
Media Upload Completes
    ↓
Content Service triggers transcoding
    ↓
TranscodingService.triggerJob(mediaId)
    ↓
Fetch media from database (creatorId, inputKey)
    ↓
Call RunPod API (POST /run with media details)
    ↓
Update media status = 'transcoding'
    ↓
RunPod processes video (GPU FFmpeg encoding)
    ↓
RunPod uploads HLS to R2 (multi-quality variants)
    ↓
RunPod sends webhook (POST /api/transcoding/webhook)
    ↓
Webhook handler updates media_items
    ↓
Update status = 'ready', save HLS keys
    ↓
Access Service can generate streaming URLs
```

---

## Database Schema

### Extended Media Items Fields

**Purpose**: Track transcoding job state, output asset locations, and extensibility metadata.

**New Fields** (added to existing `media_items` table from P1-CONTENT-001):

#### Core Transcoding Fields
- `hlsMasterPlaylistKey` (varchar 500, nullable): HLS master playlist R2 path
  - Example: `{creatorId}/hls/{mediaId}/master.m3u8`
  - Populated after transcoding completes
  - Used by access service to generate streaming URLs

- `hlsPreviewKey` (varchar 500, nullable): 30-second preview clip HLS path
  - Example: `{creatorId}/hls/{mediaId}/preview/preview.m3u8`
  - For content discovery (show preview before purchase)

- `thumbnailKey` (varchar 500, nullable): Auto-generated thumbnail image
  - Example: `{creatorId}/thumbnails/media/{mediaId}/auto-generated.jpg`
  - Extracted at 10% mark of video

- `waveformKey` (varchar 500, nullable): Audio waveform data (JSON) in R2
  - Example: `{creatorId}/waveforms/{mediaId}/waveform.json`
  - Only for audio media type

- `waveformImageKey` (varchar 500, nullable): Audio waveform preview image
  - Example: `{creatorId}/thumbnails/media/{mediaId}/waveform.png`

#### Job Tracking Fields
- `transcodingError` (text, nullable): Error message if transcoding fails
- `transcodingAttempts` (integer, default 0): Retry count (max 1)
- `runpodJobId` (varchar 100, nullable): RunPod job identifier

#### Extensibility Fields (Phase 1 foundation for Phase 2+)
- `mezzanineKey` (varchar 500, nullable): B2 archival path for high-quality intermediate
  - Example: `mezzanine/{creatorId}/{mediaId}/mezzanine.mp4`
  - Stored in Backblaze B2 (cheaper than R2)
  - Enables future re-encoding without quality loss

- `mezzanineStatus` (varchar 50, nullable): `pending` | `ready` | `deleted`

- `transcodingPriority` (varchar 20, default 'standard'): `immediate` | `standard` | `on_demand`
  - Prepares for future on-demand variant generation

- `readyVariants` (jsonb, default []): Array of generated variant names
  - Example: `['1080p', '720p', '480p', '360p', 'preview']`
  - Enables future selective/lazy variant generation

#### Loudness Metadata (populated by two-pass analysis)
- `loudnessIntegrated` (integer, nullable): Integrated loudness ×100
  - Example: `-1600` = -16 LUFS (EBU R128 target)

- `loudnessPeak` (integer, nullable): True peak ×100
  - Example: `-150` = -1.5 dBFS

- `loudnessRange` (integer, nullable): Loudness range ×100
  - Example: `720` = 7.2 LU

**Media Status Enum** (already in P1-CONTENT-001, clarified here):
- `uploading`: Upload in progress
- `uploaded`: Upload complete, ready for transcoding
- `transcoding`: RunPod job in progress
- `ready`: Transcoding complete, media streamable
- `failed`: Transcoding failed (check transcodingError)

### Migration Considerations

**Manual Steps**:
- Add new fields to existing `media_items` table migration
- No new tables needed (extends P1-CONTENT-001 schema)

**Database Constraints**:
- `hlsMasterPlaylistKey` required when `status = 'ready'`
- `transcodingAttempts` max value = 1 (enforced in service logic)

---

## Service Architecture

### Service Responsibilities

**TranscodingService** (extends `BaseService` from `@codex/service-errors`):
- **Primary Responsibility**: Manage media transcoding lifecycle via RunPod integration
- **Key Operations**:
  - `triggerJob(mediaId)`: Start transcoding job on RunPod
  - `handleWebhook(payload)`: Process RunPod completion webhook
  - `retryTranscoding(mediaId)`: Manually retry failed job (1 attempt max)
  - `getTranscodingStatus(mediaId)`: Query current job status
  - `cancelJob(mediaId)`: Cancel in-progress job (admin only)

### Key Business Rules

1. **Job Triggering**:
   - Media must have `status = 'uploaded'` to trigger transcoding
   - Input file must exist in R2 (`r2Key` populated)
   - Media type must be 'video' or 'audio'
   - Creator must own the media (scoping check)

2. **RunPod Job Configuration**:
   - Video: Generate HLS with 4 quality levels (1080p, 720p, 480p, 360p)
  - Video: Extract 30-second preview starting at 0 seconds (first 30s)
   - Video: Generate thumbnail at 10% mark
   - Audio: Generate HLS audio stream
   - Audio: Generate waveform visualization data (JSON)

3. **Webhook Processing**:
   - Verify webhook signature (HMAC from RunPod)
   - Extract job ID, status, output keys
   - Update media_items atomically (status + keys)
   - If failed: Store error message, allow retry (max 1)

4. **Retry Logic**:
   - Only 1 retry allowed (`transcodingAttempts < 1`)
   - Reset status to 'uploaded' before retrying
   - Increment transcodingAttempts counter
   - Manual trigger only (no automatic retries)

5. **Error Handling**:
   - RunPod API failures: Log error, keep status as 'uploaded', allow retry
   - Webhook failures: Mark status = 'failed', store error message
   - Invalid media: Fail immediately, no retry

### Design Patterns

#### Pattern 1: Async Job with Webhook Callback

**Problem**: Transcoding takes minutes, can't block HTTP request

**Solution**: Fire-and-forget job trigger + webhook callback for results

```typescript
// Service extends BaseService
export class TranscodingService extends BaseService {
  private runpodApiKey: string;
  private runpodEndpointId: string;
  private webhookBaseUrl: string;

  constructor(config: ServiceConfig & {
    runpodApiKey: string;
    runpodEndpointId: string;
    webhookBaseUrl: string;
  }) {
    super(config); // BaseService provides this.db, this.environment
    this.runpodApiKey = config.runpodApiKey;
    this.runpodEndpointId = config.runpodEndpointId;
    this.webhookBaseUrl = config.webhookBaseUrl;
  }

  async triggerJob(mediaId: string, userId: string): Promise<void> {
    // Step 1: Fetch media from database
    const media = await this.db.query.mediaItems.findFirst({
      where: and(
        eq(mediaItems.id, mediaId),
        eq(mediaItems.creatorId, userId), // Scoping check
        eq(mediaItems.status, 'uploaded')
      ),
    });

    if (!media) {
      throw new NotFoundError('Media not found or not ready for transcoding');
    }

    // Step 2: Construct webhook URL
    const webhookUrl = `${this.webhookBaseUrl}/api/transcoding/webhook`;

    // Step 3: Call RunPod API (async job)
    const response = await fetch(
      `https://api.runpod.ai/v2/${this.runpodEndpointId}/run`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.runpodApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: {
            mediaId: media.id,
          mediaType: media.mediaType,
            creatorId: media.creatorId,
            inputKey: media.r2Key, // Where to fetch input file
            webhookUrl,
          },
        }),
      }
    );

    const result = await response.json();

    // Step 4: Update media status = 'transcoding'
    await this.db.update(mediaItems)
      .set({
        status: 'transcoding',
        runpodJobId: result.id,
        updatedAt: new Date(),
      })
      .where(eq(mediaItems.id, mediaId));

    // Job is now running, webhook will update when complete
  }
}
```

#### Pattern 2: Webhook Handler with HMAC Verification

**Problem**: Webhook endpoints are public, need to verify authenticity

**Solution**: HMAC signature verification from RunPod

```typescript
export async function handleTranscodingWebhook(
  rawBody: string,
  signature: string,
  webhookSecret: string
): Promise<void> {
  // Step 1: Verify webhook signature against raw body
  const computedSignature = createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  if (computedSignature !== signature) {
    throw new ForbiddenError('Invalid webhook signature');
  }

  // Step 2: Call service to process webhook
  const payload = JSON.parse(rawBody) as RunPodWebhookPayload;
  const service = new TranscodingService(config);
  await service.handleWebhook(payload);
}
```

#### Pattern 3: Atomic Status Update

**Problem**: Webhook must update multiple fields atomically

**Solution**: Single UPDATE statement with all fields

```typescript
async handleWebhook(payload: RunPodWebhookPayload): Promise<void> {
  const mediaId = payload.output?.mediaId || payload.jobId; // Fallback to job ID

  if (payload.status === 'completed') {
    // Success: Update all fields atomically
    await this.db.update(mediaItems)
      .set({
        status: 'ready',
        hlsMasterPlaylistKey: payload.output!.hlsMasterKey,
        hlsPreviewKey: payload.output!.hlsPreviewKey,
        thumbnailKey: payload.output!.thumbnailKey,
        waveformKey: payload.output!.waveformKey, // Audio only
        durationSeconds: payload.output!.durationSeconds,
        width: payload.output!.width,
        height: payload.output!.height,
        updatedAt: new Date(),
      })
      .where(eq(mediaItems.id, mediaId));
  } else {
    // Failure: Store error message
    await this.db.update(mediaItems)
      .set({
        status: 'failed',
        transcodingError: payload.error || 'Unknown transcoding error',
        updatedAt: new Date(),
      })
      .where(eq(mediaItems.id, mediaId));
  }
}
```

#### Pattern 4: Retry with Attempt Counter

**Problem**: Allow retry but prevent infinite loops

**Solution**: Counter with max value check

```typescript
async retryTranscoding(mediaId: string, userId: string): Promise<void> {
  // Step 1: Fetch media and check retry eligibility
  const media = await this.db.query.mediaItems.findFirst({
    where: and(
      eq(mediaItems.id, mediaId),
      eq(mediaItems.creatorId, userId),
      eq(mediaItems.status, 'failed')
    ),
  });

  if (!media) {
    throw new NotFoundError('Media not found or not failed');
  }

  // Step 2: Check retry limit
  if (media.transcodingAttempts >= 1) {
    throw new ValidationError('Maximum retry attempts reached (1)');
  }

  // Step 3: Reset status and increment attempts
  await this.db.update(mediaItems)
    .set({
      status: 'uploaded',
      transcodingAttempts: media.transcodingAttempts + 1,
      transcodingError: null, // Clear previous error
      updatedAt: new Date(),
    })
    .where(eq(mediaItems.id, mediaId));

  // Step 4: Trigger new job
  await this.triggerJob(mediaId, userId);
}
```

---

## Implementation Patterns

### Pseudocode: Trigger Transcoding Job

```
FUNCTION triggerJob(mediaId, userId):
  // Step 1: Fetch media from database
  media = DATABASE.query(
    SELECT * FROM media_items
    WHERE id = mediaId
      AND creator_id = userId
      AND status = 'uploaded'
      AND deleted_at IS NULL
  )

  IF media IS NULL:
    THROW NotFoundError("Media not found or not ready")
  END IF

  // Step 2: Validate input file exists
  IF media.r2Key IS NULL:
    THROW ValidationError("Input file not uploaded")
  END IF

  // Step 3: Construct webhook URL
  webhookUrl = webhookBaseUrl + "/api/transcoding/webhook"

  // Step 4: Prepare RunPod job input
  jobInput = {
    mediaId: media.id,
    mediaType: media.mediaType,  // 'video' | 'audio'
    creatorId: media.creatorId,
    inputKey: media.r2Key,  // R2 path to original file
    webhookUrl: webhookUrl
  }

  // Step 5: Call RunPod API (async job)
  response = HTTP.POST("https://api.runpod.ai/v2/{endpointId}/run", {
    headers: {
      Authorization: "Bearer " + runpodApiKey,
      ContentType: "application/json"
    },
    body: JSON.stringify({
      input: jobInput
    })
  })

  IF response.status != 200:
    LOG.error("RunPod API error", response.error)
    THROW InternalServiceError("Failed to start transcoding job")
  END IF

  result = response.json()
  runpodJobId = result.id

  // Step 6: Update media status = 'transcoding'
  DATABASE.update(media_items, {
    status: 'transcoding',
    runpod_job_id: runpodJobId,
    updated_at: NOW()
  }, WHERE id = mediaId)

  // Step 7: Log job started
  LOG.info("Transcoding job started", {
    mediaId: mediaId,
    runpodJobId: runpodJobId,
    mediaType: media.mediaType
  })

  // Job is running, webhook will handle completion
END FUNCTION
```

### Pseudocode: Handle Webhook Callback

```
FUNCTION handleWebhook(payload):
  // Step 1: Extract job info
  jobId = payload.jobId
  status = payload.status  // 'completed' | 'failed'
  output = payload.output

  // Step 2: Find media by job ID or media ID
  mediaId = output?.mediaId OR jobId

  media = DATABASE.query(
    SELECT * FROM media_items
    WHERE runpod_job_id = jobId
       OR id = mediaId
  )

  IF media IS NULL:
    LOG.warn("Webhook received for unknown media", { jobId })
    RETURN  // Ignore unknown webhooks
  END IF

  // Step 3: Process based on status
  IF status == 'completed':
    // Success: Update with transcoded assets
    DATABASE.update(media_items, {
      status: 'ready',
      hls_master_playlist_key: output.hlsMasterKey,
      hls_preview_key: output.hlsPreviewKey,
      thumbnail_key: output.thumbnailKey,
      waveform_key: output.waveformKey,  // Audio only
      duration_seconds: output.durationSeconds,
      width: output.width,
      height: output.height,
      updated_at: NOW()
    }, WHERE id = media.id)

    LOG.info("Transcoding completed successfully", {
      mediaId: media.id,
      jobId: jobId
    })
  ELSE:
    // Failure: Store error
    errorMessage = payload.error OR "Unknown transcoding error"

    DATABASE.update(media_items, {
      status: 'failed',
      transcoding_error: errorMessage,
      updated_at: NOW()
    }, WHERE id = media.id)

    LOG.error("Transcoding failed", {
      mediaId: media.id,
      jobId: jobId,
      error: errorMessage
    })
  END IF
END FUNCTION
```

### Pseudocode: Retry Failed Transcoding

```
FUNCTION retryTranscoding(mediaId, userId):
  // Step 1: Fetch failed media
  media = DATABASE.query(
    SELECT * FROM media_items
    WHERE id = mediaId
      AND creator_id = userId
      AND status = 'failed'
  )

  IF media IS NULL:
    THROW NotFoundError("Media not found or not in failed state")
  END IF

  // Step 2: Check retry limit
  IF media.transcodingAttempts >= 1:
    THROW ValidationError("Maximum retry attempts reached")
  END IF

  // Step 3: Reset status and increment counter
  DATABASE.update(media_items, {
    status: 'uploaded',
    transcoding_attempts: media.transcodingAttempts + 1,
    transcoding_error: NULL,  // Clear previous error
    runpod_job_id: NULL,      // Clear old job ID
    updated_at: NOW()
  }, WHERE id = mediaId)

  // Step 4: Trigger new transcoding job
  triggerJob(mediaId, userId)

  LOG.info("Retrying transcoding", {
    mediaId: mediaId,
    attempt: media.transcodingAttempts + 1
  })
END FUNCTION
```

---

## API Integration

### Endpoints

| Method | Path | Purpose | Security Policy |
|--------|------|---------|-----------------|
| POST | `/api/transcoding/webhook` | Receive RunPod completion webhook | HMAC signature verification |
| POST | `/api/media/:id/retry-transcoding` | Manually retry failed job | `POLICY_PRESETS.creator()` |
| GET | `/api/media/:id/transcoding-status` | Get current transcoding status | `POLICY_PRESETS.authenticated()` |

### Webhook Handler

```typescript
// Webhook endpoint (no auth, uses HMAC verification)
app.post('/api/transcoding/webhook',
  async (c) => {
    const signature = c.req.header('x-runpod-signature');
    const webhookSecret = c.env.RUNPOD_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
      return c.json({ error: 'Missing signature' }, 401);
    }

    const rawBody = await c.req.text();

    // Verify HMAC signature
    const computedSignature = createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (computedSignature !== signature) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    // Process webhook
    const payload = JSON.parse(rawBody) as RunPodWebhookPayload;
    const service = new TranscodingService(c.env);
    await service.handleWebhook(payload);

    return c.json({ received: true }, 200);
  }
);
```

### Retry Endpoint

```typescript
// Manual retry endpoint (creator only)
app.post('/api/media/:id/retry-transcoding',
  withPolicy(POLICY_PRESETS.creator()),
  createAuthenticatedHandler({
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: async ({ input, context }) => {
      const service = new TranscodingService(context.env);

      await service.retryTranscoding(input.id, context.user.id);

      return { message: 'Transcoding retry triggered' };
    }
  })
);
```

### Status Check Endpoint

```typescript
// Get transcoding status
app.get('/api/media/:id/transcoding-status',
  withPolicy(POLICY_PRESETS.authenticated()),
  createAuthenticatedGetHandler({
    inputSchema: z.object({ id: z.string().uuid() }),
    handler: async ({ input, context }) => {
      const media = await db.query.mediaItems.findFirst({
        where: eq(mediaItems.id, input.id),
      });

      if (!media) {
        throw new NotFoundError('Media not found');
      }

      return {
        status: media.status,
        transcodingAttempts: media.transcodingAttempts,
        transcodingError: media.transcodingError,
        runpodJobId: media.runpodJobId,
      };
    }
  })
);
```

---

## Available Patterns & Utilities

### Foundation Packages

#### `@codex/database`

**Schema Extensions**:
```typescript
import { mediaItems } from '@codex/database/schema';

// Extended fields available after migration
media.hlsMasterPlaylistKey
media.hlsPreviewKey
media.thumbnailKey
media.waveformKey
media.transcodingError
media.transcodingAttempts
media.runpodJobId
```

**Query Helpers**:
- `scopedNotDeleted(mediaItems, userId)`: Creator scoping for media queries

**When to use**: All transcoding service queries use standard Drizzle with media_items table.

---

#### `@codex/service-errors`

**BaseService** (extend this):
```typescript
import { BaseService, type ServiceConfig } from '@codex/service-errors';

export class TranscodingService extends BaseService {
  private runpodApiKey: string;
  // ... RunPod config

  constructor(config: ServiceConfig & {
    runpodApiKey: string;
    runpodEndpointId: string;
    webhookBaseUrl: string;
  }) {
    super(config); // Provides this.db, this.environment
    this.runpodApiKey = config.runpodApiKey;
    // ... initialize RunPod config
  }
}
```

**Error Classes**:
- `NotFoundError`: Media not found
- `ValidationError`: Max retries reached, invalid state
- `InternalServiceError`: RunPod API failure

**When to use**: Extend BaseService for transcoding service. Throw specific errors for failures.

---

#### `@codex/validation`

**Transcoding Schemas** (to be created):
```typescript
// Webhook payload validation
export const runpodWebhookSchema = z.object({
  jobId: z.string(),
  status: z.enum(['completed', 'failed']),
  output: z.object({
    mediaId: z.string().uuid(),
  mediaType: z.enum(['video', 'audio']),
    hlsMasterKey: z.string().optional(),
    hlsPreviewKey: z.string().optional(),
    thumbnailKey: z.string().optional(),
    waveformKey: z.string().optional(),
    durationSeconds: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  }).optional(),
  error: z.string().optional(),
});

// Retry request validation
export const retryTranscodingSchema = z.object({
  id: z.string().uuid(),
});
```

**When to use**: Validate webhook payloads and API inputs.

---

### Utility Packages

#### `@codex/cloudflare-clients`

**R2 Service**:
```typescript
import { R2Service } from '@codex/cloudflare-clients';

const r2 = new R2Service(env.MEDIA_BUCKET);

// Verify input file exists before triggering job
const exists = await r2.exists(media.r2Key);
if (!exists) {
  throw new ValidationError('Input file not found in R2');
}
```

**When to use**: Verify input files exist before triggering transcoding jobs.

---

#### `@codex/worker-utils`

**Worker Setup**:
```typescript
import { createWorker } from '@codex/worker-utils';

const app = createWorker({
  serviceName: 'transcoding-api',
  enableCors: true,
  enableSecurityHeaders: true,
});

// Mount routes
app.route('/api/transcoding', transcodingRoutes);
```

**When to use**: Standard worker setup for transcoding API.

---

#### `@codex/observability`

**Logging**:
```typescript
const obs = new ObservabilityClient('transcoding-service', env.ENVIRONMENT);

// Log job started
obs.info('Transcoding job triggered', {
  mediaId,
  runpodJobId,
  mediaType: media.mediaType,
});

// Log job completed
obs.info('Transcoding completed', {
  mediaId,
  duration: media.durationSeconds,
});

// Log errors
obs.error('Transcoding failed', error, {
  mediaId,
  runpodJobId,
});
```

**When to use**: Log all transcoding events for monitoring and debugging.

---

### External SDKs

#### RunPod API

**Installation**: No SDK needed, use native `fetch`

**Trigger Job**:
```typescript
const response = await fetch(
  `https://api.runpod.ai/v2/${endpointId}/run`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: {
        mediaId,
        mediaType: 'video',
        inputKey: 'creator-123/originals/media-456/video.mp4',
        webhookUrl: 'https://yourapp.com/api/transcoding/webhook',
      },
    }),
  }
);

const result = await response.json();
// result.id = RunPod job ID
```

**When to use**: Trigger transcoding jobs, poll job status (optional).

---

## Dependencies

### Required (Blocking)

| Dependency | Status | Description |
|------------|--------|-------------|
| Content Service (P1-CONTENT-001) | ✅ Complete | Need `media_items` table and media upload flow |
| R2 Storage (@codex/cloudflare-clients) | ✅ Available | Delivery storage (HLS, thumbnails, waveforms) |
| Backblaze B2 Account | ⚠️ Required | Archival storage (mezzanines, originals) - cheaper than R2 |
| RunPod Account | ⚠️ Required | GPU transcoding service (requires setup) |

### Optional (Nice to Have)

| Dependency | Status | Description |
|------------|--------|-------------|
| Access Service (P1-ACCESS-001) | 🚧 Not Started | Will consume HLS keys for streaming. Transcoding can be built first. |

### Infrastructure Ready

- ✅ Database schema tooling (Drizzle ORM)
- ✅ Worker deployment pipeline
- ✅ R2 storage service (delivery)
- ✅ Error handling (@codex/service-errors)
- ✅ Validation (@codex/validation)

### New Infrastructure Required

- ⚠️ Backblaze B2 bucket creation and credentials
- ⚠️ B2 client in RunPod handler (boto3 with B2 endpoint)
- ⚠️ Bandwidth Alliance configuration (B2 → Cloudflare)

### RunPod Setup Required

**Before Implementation**:
1. Create RunPod account
2. Deploy custom Docker image with FFmpeg + audiowaveform
3. Create serverless endpoint
4. Configure webhook URL
5. Get API key and endpoint ID

**Docker Image Requirements**:
- FFmpeg with H.264/H.265 encoding
- HLS segmentation support
- Thumbnail extraction
- audiowaveform binary (for audio media)

---

## Implementation Checklist

- [ ] **Database Setup**
  - [ ] Extend `media_items` schema with transcoding fields (15 new fields)
  - [ ] Include extensibility fields: mezzanineKey, mezzanineStatus, transcodingPriority, readyVariants
  - [ ] Include loudness fields: loudnessIntegrated, loudnessPeak, loudnessRange
  - [ ] Generate migration with new columns
  - [ ] Run migration in development
  - [ ] Verify media status enum includes 'transcoding', 'ready', 'failed'

- [ ] **Backblaze B2 Setup**
  - [ ] Create B2 account and bucket (codex-archive)
  - [ ] Generate application key with bucket access
  - [ ] Configure Bandwidth Alliance (B2 → Cloudflare)
  - [ ] Add B2 credentials to environment variables
  - [ ] Test B2 access from RunPod handler

- [ ] **RunPod Setup**
  - [ ] Create RunPod account and API key
  - [ ] Build custom Docker image (FFmpeg + audiowaveform)
  - [ ] Add B2 client alongside R2 client
  - [ ] Implement mezzanine creation step
  - [ ] Implement two-pass loudness analysis
  - [ ] Deploy serverless endpoint
  - [ ] Test endpoint with sample video
  - [ ] Configure webhook URL in RunPod dashboard

- [ ] **Service Layer**
  - [ ] Create `packages/transcoding/src/services/transcoding-service.ts`
  - [ ] Implement `TranscodingService` extending `BaseService`
  - [ ] Implement `triggerJob()` method (call RunPod API)
  - [ ] Implement `handleWebhook()` method (process completion)
  - [ ] Implement `retryTranscoding()` method (1 attempt max)
  - [ ] Implement `getTranscodingStatus()` method
  - [ ] Add unit tests with mocked RunPod API

- [ ] **Validation**
  - [ ] Add `runpodWebhookSchema` to `@codex/validation`
  - [ ] Add `retryTranscodingSchema`
  - [ ] Add schema tests (100% coverage)

- [ ] **Worker/API**
  - [ ] Create transcoding routes or add to existing worker
  - [ ] Implement `POST /api/transcoding/webhook` endpoint
  - [ ] Implement `POST /api/media/:id/retry-transcoding` endpoint
  - [ ] Implement `GET /api/media/:id/transcoding-status` endpoint
  - [ ] Add HMAC signature verification for webhooks
  - [ ] Add integration tests

- [ ] **Integration**
  - [ ] Wire transcoding trigger into content upload flow
  - [ ] Test end-to-end transcoding (video)
  - [ ] Test end-to-end transcoding (audio)
  - [ ] Test webhook callback handling
  - [ ] Test retry logic (max 1 attempt)
  - [ ] Test failed transcoding error handling

- [ ] **Deployment**
  - [ ] Configure RUNPOD_API_KEY in Cloudflare
  - [ ] Configure RUNPOD_ENDPOINT_ID
  - [ ] Configure RUNPOD_WEBHOOK_SECRET
  - [ ] Update wrangler.jsonc with environment variables
  - [ ] Test in preview environment
  - [ ] Deploy to production
  - [ ] Monitor transcoding success rate

---

## Testing Strategy

### Unit Tests

**Service Layer** (`packages/transcoding/src/__tests__/`):
- Test job triggering (mock RunPod API)
- Test webhook handling (success/failure)
- Test retry logic (max attempts)
- Test status queries
- Mock database and RunPod API

**Validation Layer**:
- 100% coverage for transcoding schemas
- Test webhook payload validation
- Test retry request validation

### Integration Tests

**API Endpoints** (`workers/transcoding-api/src/__tests__/`):
- Test webhook endpoint with valid signature
- Test webhook endpoint with invalid signature → 401
- Test retry endpoint (creator only)
- Test status endpoint
- Mock RunPod responses

### E2E Scenarios

**Successful Video Transcoding**:
1. Upload video via content service
2. Trigger transcoding job
3. Verify media status = 'transcoding'
4. Simulate RunPod webhook callback (success)
5. Verify media status = 'ready'
6. Verify HLS keys populated
7. Access service generates streaming URL

**Failed Transcoding with Retry**:
1. Upload video
2. Trigger transcoding
3. Simulate RunPod webhook (failure)
4. Verify media status = 'failed'
5. Verify error message stored
6. Trigger manual retry
7. Verify transcodingAttempts = 1
8. Simulate success webhook
9. Verify media status = 'ready'

**Max Retry Limit**:
1. Failed transcoding with 1 attempt
2. Try to retry again
3. Verify ValidationError thrown
4. Verify transcodingAttempts = 1 (unchanged)

### Local Development Testing

**Tools**:
- **RunPod Test Mode**: Use RunPod sandbox for development
- **Ngrok**: Expose local webhook endpoint for RunPod callbacks
- **Mock Webhooks**: Manually trigger webhook endpoint with test payloads

**Test Data**:
- Sample videos (various resolutions)
- Sample audio files
- Mock RunPod webhook payloads

---

## Notes

### RunPod Docker Image

**Required Tools**:
- FFmpeg with H.264/H.265 encoding
- HLS segmentation support
- audiowaveform (for audio waveforms)
- Python/Node.js for RunPod handler script

**Handler Script Responsibilities**:
1. Download input file from R2
2. Run FFmpeg transcoding (multi-quality HLS)
3. Extract thumbnail and preview clip
4. Generate waveform (audio only)
5. Upload outputs to R2
6. Send webhook with results

**Example Dockerfile**:
```dockerfile
FROM runpod/pytorch:3.10-2.0.0-117

# Install FFmpeg
RUN apt-get update && apt-get install -y ffmpeg

# Install audiowaveform
RUN apt-get install -y audiowaveform

# Copy handler script
COPY handler.py /handler.py

CMD ["python", "/handler.py"]
```

### Transcoding Performance

**Expected Processing Time** (GPU-accelerated):
- 1080p video (10 min): ~2-3 minutes
- 720p video (10 min): ~1-2 minutes
- Audio (1 hour): ~30 seconds

**Cost Estimate** (RunPod):
- ~$0.50/hour GPU time
- Average video (10 min): ~$0.02-0.03 per transcode

### HLS Quality Levels

**Video**:
- 1080p: 5000 kbps
- 720p: 3000 kbps
- 480p: 1500 kbps
- 360p: 800 kbps

**Audio**:
- 128 kbps AAC

### Security Considerations

**Webhook Verification**:
- HMAC-SHA256 signature from RunPod
- Prevents webhook spoofing
- Must be verified before processing

**Input Validation**:
- Verify media exists and is owned by creator
- Verify input file exists in R2
- Validate media type (video/audio only)

**Retry Limits**:
- Maximum 1 retry to prevent abuse
- Manual trigger only (no automatic retries)

### Performance Considerations

**Expected Load** (Phase 1):
- Transcoding jobs: ~10-100/day
- Webhook calls: ~10-100/day
- Retry requests: ~5-10/day

**Database Impact**:
- Minimal (status updates only)
- No heavy queries during transcoding

**R2 Bandwidth**:
- Input downloads: RunPod fetches from R2
- Output uploads: RunPod uploads HLS to R2
- Ensure R2 bucket has sufficient bandwidth

---

## Future Phases

This Phase 1 implementation establishes foundations for:

- **Phase 2**: On-demand variant generation, Cloudflare Queues integration
- **Phase 3**: Audio mediation (voice-first mixing), smart variants (clips, vertical crops)
- **Phase 4**: Watermarking, DRM encryption, live streaming

---

**Last Updated**: 2026-01-01
**Version**: 2.1 (Added tiered storage, mezzanine preservation, loudness metadata, extensibility fields)
