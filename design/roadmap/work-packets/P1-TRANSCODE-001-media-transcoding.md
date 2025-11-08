# Work Packet: P1-TRANSCODE-001 - Media Transcoding Service

**Status**: 🚧 To Be Implemented
**Priority**: P1 (High - enables streaming)
**Estimated Effort**: 7-10 days
**Branch**: `feature/P1-TRANSCODE-001-media-transcoding`

---

## Current State

**✅ Already Implemented:**
- R2 client for file storage (`packages/cloudflare-clients/src/r2/client.ts`)
- Database client with Drizzle ORM
- Cloudflare Queue infrastructure
- Content schema with `media_items` table (from P1-CONTENT-001)
- Observability package for logging

**🚧 Needs Implementation:**
- Transcoding service (enqueue jobs, handle webhooks)
- Cloudflare Worker for queue processing
- RunPod integration (GPU transcoding)
- Transcoding status tracking and updates
- Preview playlist generation (30-second clips)
- Tests (unit + integration)

---

## Dependencies

### Required Work Packets
- **P1-CONTENT-001** (Content Service) - MUST complete first for `media_items` schema

### Required External Services
- **Cloudflare Queue**: `TRANSCODING_QUEUE` for async job processing
- **RunPod**: Serverless GPU endpoint with custom Docker image (FFmpeg + audiowaveform)
- **Cloudflare R2**: Storage for input/output media files

### Existing Code
```typescript
// Already available
import { db } from '@codex/database';
import { R2Service } from '@codex/cloudflare-clients/r2';
import { ObservabilityClient } from '@codex/observability';
```

### Required Documentation
- [Media Transcoding PRD](../../features/media-transcoding/pdr-phase-1.md)
- [Media Transcoding TDD](../../features/media-transcoding/ttd-dphase-1.md)
- [R2 Bucket Structure](../../infrastructure/R2BucketStructure.md)
- [STANDARDS.md](../STANDARDS.md)

---

## System Architecture

```
┌─────────────────┐       ┌──────────────────┐       ┌─────────────────┐
│  Content Upload │──────>│ Cloudflare Queue │──────>│ Queue Consumer  │
│   (Completes)   │ Queue │   (Async Jobs)   │ Poll  │    (Worker)     │
└─────────────────┘ Job   └──────────────────┘       └─────────────────┘
                                                               │
                                                               │ Call RunPod API
                                                               ▼
                                                       ┌─────────────────┐
                                                       │  RunPod GPU     │
                                                       │  - FFmpeg       │
                                                       │  - HLS transcode│
                                                       │  - Preview gen  │
                                                       │  - Waveform gen │
                                                       └─────────────────┘
                                                               │
                                                               │ Webhook callback
                                                               ▼
┌─────────────────┐       ┌──────────────────┐       ┌─────────────────┐
│ Update DB Status│<──────│  Webhook Handler │<──────│  RunPod Result  │
│ media_items     │       │  /api/transcode/ │       │  (Success/Fail) │
└─────────────────┘       │   webhook        │       └─────────────────┘
                          └──────────────────┘
```

**Key Flows:**
1. User uploads media → Status: `uploaded`
2. Content service enqueues transcoding job
3. Queue worker picks up job → Status: `transcoding`
4. RunPod processes video (HLS + preview + thumbnail)
5. RunPod calls webhook with results
6. Webhook updates `media_items` → Status: `ready` or `failed`

---

## Implementation Steps

### Step 1: Update Media Items Schema for Transcoding

**File**: `packages/database/src/schema/content.ts` (modify existing)

Add fields to `mediaItems` table:

```typescript
export const mediaItems = pgTable('media_items', {
  // ... existing fields from P1-CONTENT-001 ...

  // Transcoding-specific fields
  status: text('status', {
    enum: ['uploading', 'uploaded', 'transcoding', 'ready', 'failed']
  }).default('uploaded').notNull(),

  // HLS output keys
  hlsMasterKey: text('hls_master_key'), // e.g., "hls/{mediaId}/master.m3u8"
  hlsPreviewKey: text('hls_preview_key'), // e.g., "hls/{mediaId}/preview.m3u8" (30 seconds)

  // Thumbnails
  thumbnailKey: text('thumbnail_key'), // Auto-generated at 10% mark

  // Audio-specific
  waveformKey: text('waveform_key'), // e.g., "waveforms/{mediaId}/waveform.json"

  // Metadata (populated after transcoding)
  durationSeconds: integer('duration_seconds'),
  width: integer('width'), // Video only
  height: integer('height'), // Video only

  // Error tracking
  transcodingError: text('transcoding_error'), // Error message if failed
  transcodingAttempts: integer('transcoding_attempts').default(0).notNull(),

  // ... existing timestamps ...
});
```

**Migration**:
```bash
pnpm --filter @codex/database db:gen:drizzle
pnpm --filter @codex/database db:migrate
```

---

### Step 2: Create Transcoding Service

**File**: `packages/web/src/lib/server/transcoding/service.ts`

```typescript
import { db } from '@codex/database';
import { mediaItems } from '@codex/database/schema';
import { eq } from 'drizzle-orm';
import type { Queue } from '@cloudflare/workers-types';

export interface TranscodingJobPayload {
  mediaId: string;
  type: 'video' | 'audio';
  creatorId: string;
  inputKey: string; // R2 key: "originals/{mediaId}/file.mp4"
  attemptNumber: number; // 1 or 2 (single retry)
}

export interface RunPodWebhookPayload {
  jobId: string;
  status: 'completed' | 'failed';
  output?: {
    mediaId: string;
    type: 'video' | 'audio';

    // Video/Audio outputs
    hlsMasterKey?: string; // "hls/{mediaId}/master.m3u8"
    hlsPreviewKey?: string; // "hls/{mediaId}/preview.m3u8" (30s)
    thumbnailKey?: string; // "thumbnails/media/{mediaId}/auto-generated.jpg"
    durationSeconds?: number;
    width?: number;
    height?: number;

    // Audio-specific
    waveformKey?: string; // "waveforms/{mediaId}/waveform.json"
  };
  error?: string;
}

export class TranscodingService {
  constructor(
    private queue: Queue,
    private runpodApiKey: string,
    private runpodEndpointId: string
  ) {}

  /**
   * Enqueue transcoding job (called after media upload completes)
   */
  async enqueueTranscoding(mediaId: string, creatorId: string): Promise<void> {
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

    // Build job payload
    const payload: TranscodingJobPayload = {
      mediaId,
      type: media.type,
      creatorId,
      inputKey: media.r2Key,
      attemptNumber: 1,
    };

    // Update status to transcoding
    await db
      .update(mediaItems)
      .set({
        status: 'transcoding',
        transcodingAttempts: media.transcodingAttempts + 1,
      })
      .where(eq(mediaItems.id, mediaId));

    // Enqueue job
    await this.queue.send(payload);
  }

  /**
   * Handle webhook callback from RunPod
   */
  async handleWebhook(payload: RunPodWebhookPayload): Promise<void> {
    const { status, output, error } = payload;

    if (status === 'completed' && output) {
      // Success - update media item
      await db
        .update(mediaItems)
        .set({
          status: 'ready',
          hlsMasterKey: output.hlsMasterKey,
          hlsPreviewKey: output.hlsPreviewKey,
          thumbnailKey: output.thumbnailKey,
          waveformKey: output.waveformKey,
          durationSeconds: output.durationSeconds,
          width: output.width,
          height: output.height,
          transcodingError: null,
        })
        .where(eq(mediaItems.id, output.mediaId));
    } else {
      // Failure - check retry logic
      const media = await db.query.mediaItems.findFirst({
        where: eq(mediaItems.id, payload.output?.mediaId || ''),
      });

      if (!media) return;

      if (media.transcodingAttempts < 2) {
        // Retry once (attempt 2)
        const retryPayload: TranscodingJobPayload = {
          mediaId: media.id,
          type: media.type,
          creatorId: media.creatorId,
          inputKey: media.r2Key,
          attemptNumber: 2,
        };

        // Wait 5 minutes before retry (handled by queue delay)
        await this.queue.send(retryPayload, { delaySeconds: 300 });
      } else {
        // Permanent failure after 2 attempts
        await db
          .update(mediaItems)
          .set({
            status: 'failed',
            transcodingError: error || 'Unknown transcoding error',
          })
          .where(eq(mediaItems.id, media.id));
      }
    }
  }

  /**
   * Manual retry (creator triggers from UI)
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

    // Reset and retry
    await db
      .update(mediaItems)
      .set({
        status: 'transcoding',
        transcodingAttempts: 0,
        transcodingError: null,
      })
      .where(eq(mediaItems.id, mediaId));

    await this.enqueueTranscoding(mediaId, creatorId);
  }
}
```

**Tests**: `packages/web/src/lib/server/transcoding/service.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranscodingService } from './service';

describe('TranscodingService', () => {
  let service: TranscodingService;
  let mockQueue: any;

  beforeEach(() => {
    mockQueue = { send: vi.fn() };
    service = new TranscodingService(mockQueue, 'test-api-key', 'test-endpoint');
  });

  describe('enqueueTranscoding', () => {
    it('should enqueue job and update status to transcoding', async () => {
      // Test logic: mock db, verify queue.send called, verify status updated
      // (Implementation details depend on your test setup)
    });

    it('should throw if media item not in uploaded state', async () => {
      // Test error handling
    });
  });

  describe('handleWebhook', () => {
    it('should update media item on successful completion', async () => {
      const payload = {
        jobId: 'test-job',
        status: 'completed' as const,
        output: {
          mediaId: 'test-media',
          type: 'video' as const,
          hlsMasterKey: 'hls/test/master.m3u8',
          hlsPreviewKey: 'hls/test/preview.m3u8',
          thumbnailKey: 'thumbnails/test.jpg',
          durationSeconds: 300,
          width: 1920,
          height: 1080,
        },
      };

      await service.handleWebhook(payload);

      // Verify db update called with correct values
    });

    it('should retry on first failure', async () => {
      const payload = {
        jobId: 'test-job',
        status: 'failed' as const,
        error: 'Timeout',
      };

      await service.handleWebhook(payload);

      // Verify retry queued with 5-minute delay
      expect(mockQueue.send).toHaveBeenCalledWith(
        expect.objectContaining({ attemptNumber: 2 }),
        { delaySeconds: 300 }
      );
    });

    it('should mark as failed after second attempt', async () => {
      // Mock media item with transcodingAttempts = 2
      // Verify status set to 'failed'
    });
  });
});
```

---

### Step 3: Create Queue Consumer Worker

**File**: `apps/workers/transcoding-queue-consumer/src/index.ts`

```typescript
import { TranscodingJobPayload } from '@codex/web/lib/server/transcoding/service';

interface Env {
  TRANSCODING_QUEUE: Queue;
  RUNPOD_API_KEY: string;
  RUNPOD_ENDPOINT_ID: string;
  WEBHOOK_URL: string; // https://yourapp.com/api/transcoding/webhook
}

export default {
  async queue(batch: MessageBatch<TranscodingJobPayload>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const job = message.body;

      try {
        // Call RunPod serverless API
        const response = await fetch(
          `https://api.runpod.ai/v2/${env.RUNPOD_ENDPOINT_ID}/run`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.RUNPOD_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              input: {
                mediaId: job.mediaId,
                type: job.type,
                creatorId: job.creatorId,
                inputKey: job.inputKey,
                webhookUrl: env.WEBHOOK_URL,
              },
            }),
          }
        );

        if (!response.ok) {
          throw new Error(`RunPod API error: ${response.statusText}`);
        }

        const result = await response.json();
        console.log('RunPod job started:', result.id);

        // Ack message (job successfully submitted to RunPod)
        message.ack();
      } catch (error) {
        console.error('Failed to submit RunPod job:', error);
        // Retry message (Cloudflare Queue will retry automatically)
        message.retry();
      }
    }
  },
};
```

**Configuration**: `apps/workers/transcoding-queue-consumer/wrangler.toml`

```toml
name = "transcoding-queue-consumer"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[queues.consumers]]
queue = "TRANSCODING_QUEUE"
max_batch_size = 10
max_batch_timeout = 30
max_retries = 3
dead_letter_queue = "TRANSCODING_DLQ"

[vars]
RUNPOD_ENDPOINT_ID = "your-endpoint-id"
WEBHOOK_URL = "https://yourapp.com/api/transcoding/webhook"

[[r2_buckets]]
binding = "MEDIA_BUCKET"
bucket_name = "codex-media-production"

[[r2_buckets]]
binding = "ASSETS_BUCKET"
bucket_name = "codex-assets-production"
```

---

### Step 4: Create Webhook API Endpoint

**File**: `apps/web/src/routes/api/transcoding/webhook/+server.ts`

```typescript
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TranscodingService } from '$lib/server/transcoding/service';
import type { RunPodWebhookPayload } from '$lib/server/transcoding/service';

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    const payload: RunPodWebhookPayload = await request.json();

    // Verify webhook signature (if RunPod supports it)
    // const signature = request.headers.get('x-runpod-signature');
    // if (!verifySignature(signature, payload)) {
    //   throw error(401, 'Invalid signature');
    // }

    const service = new TranscodingService(
      platform?.env.TRANSCODING_QUEUE,
      platform?.env.RUNPOD_API_KEY,
      platform?.env.RUNPOD_ENDPOINT_ID
    );

    await service.handleWebhook(payload);

    return json({ success: true });
  } catch (err) {
    console.error('Webhook error:', err);
    throw error(500, 'Webhook processing failed');
  }
};
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
    && rm -rf /var/lib/apt/lists/*

# Install audiowaveform for audio waveforms
RUN apt-get update && apt-get install -y audiowaveform

# Install Python dependencies for S3/R2 uploads
RUN pip3 install boto3

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

    input_file = f"/tmp/{media_id}_input.mp4"
    s3_client.download_file('codex-media-production', input_key, input_file)

    # Create output directory
    output_dir = Path(f"/tmp/{media_id}")
    output_dir.mkdir(exist_ok=True)

    # --- Full HLS Transcoding ---

    # Generate HLS master playlist with 4 quality variants
    ffmpeg_cmd = [
        'ffmpeg', '-i', input_file,
        # 1080p variant
        '-vf', 'scale=1920:1080', '-c:v', 'h264_nvenc', '-b:v', '5000k',
        '-c:a', 'aac', '-b:a', '128k', '-f', 'hls', '-hls_time', '6',
        '-hls_playlist_type', 'vod', '-hls_segment_filename',
        f'{output_dir}/1080p_%03d.ts', f'{output_dir}/1080p.m3u8',

        # 720p variant
        '-vf', 'scale=1280:720', '-c:v', 'h264_nvenc', '-b:v', '2500k',
        '-c:a', 'aac', '-b:a', '128k', '-f', 'hls', '-hls_time', '6',
        '-hls_playlist_type', 'vod', '-hls_segment_filename',
        f'{output_dir}/720p_%03d.ts', f'{output_dir}/720p.m3u8',

        # 480p variant
        '-vf', 'scale=854:480', '-c:v', 'h264_nvenc', '-b:v', '1000k',
        '-c:a', 'aac', '-b:a', '128k', '-f', 'hls', '-hls_time', '6',
        '-hls_playlist_type', 'vod', '-hls_segment_filename',
        f'{output_dir}/480p_%03d.ts', f'{output_dir}/480p.m3u8',

        # 360p variant
        '-vf', 'scale=640:360', '-c:v', 'h264_nvenc', '-b:v', '500k',
        '-c:a', 'aac', '-b:a', '64k', '-f', 'hls', '-hls_time', '6',
        '-hls_playlist_type', 'vod', '-hls_segment_filename',
        f'{output_dir}/360p_%03d.ts', f'{output_dir}/360p.m3u8',
    ]
    subprocess.run(ffmpeg_cmd, check=True)

    # Create master playlist
    master_playlist = f"""#EXTM3U
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
            s3_client.upload_file(str(file), 'codex-media-production', s3_key)

    # Upload preview files
    for file in preview_dir.rglob('*'):
        if file.is_file():
            relative_path = file.relative_to(preview_dir)
            s3_key = f'{creator_id}/hls/{media_id}/preview/{relative_path}'
            s3_client.upload_file(str(file), 'codex-media-production', s3_key)

    # Upload thumbnail
    thumbnail_key = f'{creator_id}/thumbnails/media/{media_id}/auto-generated.jpg'
    s3_client.upload_file(thumbnail_path, 'codex-assets-production', thumbnail_key)

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
    import requests
    requests.post(webhook_url, json=result)

    return result

def transcode_audio(media_id, creator_id, input_key, webhook_url):
    """
    Transcode audio to HLS + generate waveform
    """
    # Similar logic for audio...
    # - Convert to HLS audio (128kbps, 64kbps variants)
    # - Generate waveform JSON using audiowaveform
    # - Upload to R2
    # - Send webhook
    pass

if __name__ == '__main__':
    job_input = json.loads(sys.stdin.read())

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
```

---

### Step 6: Integration with Content Service

**File**: `packages/web/src/lib/server/content/service.ts` (modify existing)

After successful upload, enqueue transcoding:

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

    // Enqueue transcoding
    const transcodingService = new TranscodingService(
      platform.env.TRANSCODING_QUEUE,
      platform.env.RUNPOD_API_KEY,
      platform.env.RUNPOD_ENDPOINT_ID
    );

    await transcodingService.enqueueTranscoding(mediaId, creatorId);
  }
}
```

---

## Definition of Done

### Functional Requirements
- [ ] Media items auto-transcoded after upload
- [ ] Video → HLS with 4 quality variants (1080p, 720p, 480p, 360p)
- [ ] Video → 30-second preview HLS playlist
- [ ] Video → Auto-generated thumbnail (10% mark)
- [ ] Audio → HLS with 2 quality variants (128kbps, 64kbps)
- [ ] Audio → Waveform JSON generation
- [ ] Status tracking: `uploaded` → `transcoding` → `ready` / `failed`
- [ ] Single retry on failure (5-minute delay)
- [ ] Webhook handles success and failure

### Testing Requirements
- [ ] Unit tests for `TranscodingService` (enqueue, webhook, retry)
- [ ] Integration test: Full video transcoding flow
- [ ] Integration test: Audio transcoding + waveform
- [ ] Test failure scenarios and retry logic
- [ ] Test webhook signature verification (if supported)
- [ ] Test preview playlist generation

### Infrastructure Requirements
- [ ] Cloudflare Queue `TRANSCODING_QUEUE` created
- [ ] Queue consumer worker deployed
- [ ] RunPod serverless endpoint configured
- [ ] RunPod Docker image built and deployed
- [ ] Webhook URL accessible from RunPod

### Documentation Requirements
- [ ] Update PRD with preview playlist feature
- [ ] Document RunPod setup process
- [ ] Add transcoding troubleshooting guide

---

## Related Documentation

- **PRD**: [Media Transcoding PRD](../../features/media-transcoding/pdr-phase-1.md)
- **TDD**: [Media Transcoding TDD](../../features/media-transcoding/ttd-dphase-1.md)
- **Dependencies**: [Cross-Feature Dependencies](../../cross-feature-dependencies.md#6-media-transcoding)
- **Standards**: [STANDARDS.md](../STANDARDS.md)
- **R2 Storage**: [R2 Bucket Structure](../../infrastructure/R2BucketStructure.md)

---

## Notes

### Why 30-Second Previews?

- **Marketing**: Let customers sample content before purchasing
- **Engagement**: Video previews drive higher conversion than text descriptions
- **No Configuration (Phase 1)**: Always first 30 seconds for simplicity
- **Future (Phase 2+)**: Let creators configure preview start time and duration

### Preview Playlist Structure

```
{creatorId}/hls/{mediaId}/
├── master.m3u8           # Full video master playlist
├── 1080p.m3u8
├── 720p.m3u8
├── 480p.m3u8
├── 360p.m3u8
├── 1080p_000.ts
├── ...
└── preview/
    ├── preview.m3u8      # 30-second preview (720p only)
    ├── preview_000.ts
    ├── preview_001.ts
    └── preview_002.ts
```

### Cost Estimates (RunPod GPU)

- **1GB video (1080p, 10 min)**: ~2 minutes GPU time = $0.02
- **Preview generation**: +10 seconds = +$0.002
- **100MB audio + waveform**: ~30 seconds = $0.005
- **Daily estimate (10 videos, 20 audio)**: ~$0.30/day = $9/month

### Retry Strategy

- **First failure**: Retry after 5 minutes (attempt 2)
- **Second failure**: Mark as permanently failed
- **Why?**: Serverless failures are usually deterministic (corrupted file, unsupported codec). Excessive retries waste money.

---

**Document Version**: 1.0
**Last Updated**: 2025-11-08
**Status**: Ready for Implementation
