# Media Transcoding - Phase 1 TDD (Technical Design Document)

## System Overview

The media transcoding system asynchronously converts uploaded videos to HLS format and audio files to HLS with waveform generation. Processing happens via Cloudflare Queue → Cloudflare Worker → Runpod GPU workers.

**Key Architecture Decisions**:
- **Asynchronous Processing**: Queue-based to avoid blocking uploads
- **GPU Acceleration**: Runpod serverless for 10x faster transcoding
- **Webhook Callbacks**: Runpod notifies when jobs complete
- **Single Retry**: Cost control, serverless failures are deterministic
- **Automatic Cleanup**: Failed items auto-deleted after 24 hours
- **Waveform in R2**: Waveform JSON stored in R2 (not database) to save DB costs

**Architecture**:
- **Queue Layer**: Cloudflare Queue for job management
- **Worker Layer**: Cloudflare Worker processes queue messages, calls Runpod
- **Processing Layer**: Runpod GPU workers (custom Docker image with ffmpeg + audiowaveform)
- **Storage Layer**: R2 for input/output files, waveforms, thumbnails
- **Metadata Layer**: Neon Postgres for status tracking only (no waveform data)

**Architecture Diagram**:

![Transcoding Architecture](./assets/transcoding-architecture.png)

The diagram shows the complete transcoding pipeline: queue-based job management, Cloudflare Worker orchestration, Runpod GPU processing, and R2 storage integration.

---

## Dependencies

See the centralized [Cross-Feature Dependencies](../../cross-feature-dependencies.md#6-media-transcoding) document for details on dependencies between features.

### Technical Prerequisites

1.  **Content Management Service**: The media upload flow and `media_items` table are required as inputs to the transcoding process.
2.  **Cloudflare Queue**: The `TRANSCODING_QUEUE` must be set up for asynchronous job handling.
3.  **Runpod Account & Endpoint**: A serverless GPU endpoint with the custom Docker image is necessary for processing.
4.  **R2 Buckets**: Creator-specific buckets must be provisioned for input and output storage.

---

## Component List

### 1. Transcoding Service (`packages/web/src/lib/server/transcoding/service.ts`)

**Responsibility**: Enqueue transcoding jobs and handle webhook callbacks

**Interface**:
```typescript
export interface ITranscodingService {
  // Enqueue transcoding job (called after media upload)
  enqueueTranscodingJob(mediaItem: MediaItem): Promise<void>;

  // Handle webhook callback from Runpod
  handleWebhook(payload: RunpodWebhookPayload): Promise<void>;

  // Retry failed job (manual retry by creator)
  retryTranscoding(mediaId: string): Promise<void>;

  // Cleanup job (cron: delete failed items after 24 hours)
  cleanupFailedItems(): Promise<void>;
}

export interface TranscodingJobPayload {
  mediaId: string;
  type: 'video' | 'audio';
  inputBucket: string;
  inputKey: string;
  outputBucket: string;
  outputPrefix?: string;  // For video/audio HLS output
  assetsBucket: string;   // For thumbnails/waveforms
  attemptNumber: number;  // 1 or 2 (single retry)
}

export interface RunpodWebhookPayload {
  id: string;  // Runpod job ID
  status: 'completed' | 'failed';
  output?: {
    mediaId: string;
    type: 'video' | 'audio';
    // Video/Audio outputs
    hlsMasterPlaylistKey?: string;
    thumbnailKey?: string;
    durationSeconds?: number;
    width?: number;
    height?: number;
    // Audio-specific outputs
    waveformKey?: string;  // R2 key: 'waveforms/{mediaId}/waveform.json'
    waveformImageKey?: string;
  };
  error?: string;
}
```

**Implementation**:
```typescript
import { db } from '$lib/server/db';
import { mediaItems } from '$lib/server/db/schema';
import { eq, and, lt } from 'drizzle-orm';

export class TranscodingService implements ITranscodingService {
  async enqueueTranscodingJob(mediaItem: MediaItem): Promise<void> {
    const payload: TranscodingJobPayload = {
      mediaId: mediaItem.id,
      type: mediaItem.type,
      inputBucket: mediaItem.bucketName,
      inputKey: mediaItem.fileKey,
      assetsBucket: `codex-assets-${mediaItem.ownerId}`,
      attemptNumber: 1
    };

    if (mediaItem.type === 'video') {
      payload.outputBucket = mediaItem.bucketName;
      payload.outputPrefix = `hls/${mediaItem.id}/`;
    } else {
      // Audio
      payload.outputBucket = mediaItem.bucketName;
      payload.outputPrefix = `hls-audio/${mediaItem.id}/`; // HLS output for audio
    }

    // Enqueue to Cloudflare Queue
    // (Actual enqueue happens in Content Management with platform.env.TRANSCODING_QUEUE)
  }

  async handleWebhook(payload: RunpodWebhookPayload): Promise<void> {
    const { mediaId, status, output, error } = payload;

    if (status === 'completed' && output) {
      // Success: Update media_items with output metadata
      if (output.type === 'video') {
        await db.update(mediaItems)
          .set({
            status: 'ready',
            hlsMasterPlaylistKey: output.hlsMasterPlaylistKey,
            thumbnailKey: output.thumbnailKey,
            durationSeconds: output.durationSeconds,
            width: output.width,
            height: output.height,
            updatedAt: new Date()
          })
          .where(eq(mediaItems.id, mediaId));
      } else {
        // Audio
        await db.update(mediaItems)
          .set({
            status: 'ready',
            hlsMasterPlaylistKey: output.hlsMasterPlaylistKey, // HLS master playlist for audio
            waveformKey: output.waveformKey,  // R2 key to waveform JSON
            waveformImageKey: output.waveformImageKey,
            durationSeconds: output.durationSeconds,
            updatedAt: new Date()
          })
          .where(eq(mediaItems.id, mediaId));
      }
    } else if (status === 'failed') {
      // Failure: Check if this is first or second attempt
      const mediaItem = await db.query.mediaItems.findFirst({
        where: eq(mediaItems.id, mediaId)
      });

      if (!mediaItem) {
        throw new Error(`Media item ${mediaId} not found`);
      }

      // Store error message in media_items for debugging
      await db.update(mediaItems)
        .set({
          errorMessage: error || 'Unknown transcoding error',
          updatedAt: new Date()
        })
        .where(eq(mediaItems.id, mediaId));

      // Check attempt number from error message (or track separately)
      // For now, if already has errorMessage, this is 2nd failure
      if (mediaItem.errorMessage) {
        // Second failure: Mark as failed, will be cleaned up automatically
        await db.update(mediaItems)
          .set({
            status: 'failed',
            errorMessage: `Permanent failure: ${error}`,
            updatedAt: new Date()
          })
          .where(eq(mediaItems.id, mediaId));

        console.error(`Transcoding permanently failed for ${mediaId}: ${error}`);
      } else {
        // First failure: Will be retried by queue consumer
        console.log(`Transcoding failed for ${mediaId}, will retry: ${error}`);
      }
    }
  }

  async retryTranscoding(mediaId: string): Promise<void> {
    // Manual retry triggered by creator from admin UI
    const mediaItem = await db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, mediaId)
    });

    if (!mediaItem) {
      throw new Error('Media item not found');
    }

    if (mediaItem.status !== 'failed') {
      throw new Error('Can only retry failed transcoding jobs');
    }

    // Reset status and clear error
    await db.update(mediaItems)
      .set({
        status: 'transcoding',
        errorMessage: null,
        updatedAt: new Date()
      })
      .where(eq(mediaItems.id, mediaId));

    await this.enqueueTranscodingJob(mediaItem);
  }

  async cleanupFailedItems(): Promise<void> {
    // Cron job: Delete failed media items older than 24 hours
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const failedItems = await db.query.mediaItems.findMany({
      where: and(
        eq(mediaItems.status, 'failed'),
        lt(mediaItems.updatedAt, cutoff)
      )
    });

    for (const item of failedItems) {
      console.log(`Cleaning up failed media item: ${item.id}`);

      // Delete from database
      await db.delete(mediaItems).where(eq(mediaItems.id, item.id));

      // TODO: Delete original file from R2 (optional, could keep for debugging)
      // await r2Service.deleteFile(item.bucketName, item.fileKey);
    }

    console.log(`Cleaned up ${failedItems.length} failed media items`);
  }
}

export const transcodingService = new TranscodingService();
```

---

### 2. Queue Consumer Worker (`workers/transcoding-queue-consumer/src/index.ts`)

**Responsibility**: Process Cloudflare Queue messages and call Runpod API

**Implementation**:
```typescript
import { Env } from './types';

export default {
  async queue(
    batch: MessageBatch<TranscodingJobPayload>,
    env: Env
  ): Promise<void> {
    for (const message of batch.messages) {
      const job = message.body;

      try {
        // Call Runpod serverless endpoint
        const response = await fetch(env.RUNPOD_ENDPOINT_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RUNPOD_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            input: {
              mediaId: job.mediaId,
              type: job.type,
              inputBucket: job.inputBucket,
              inputKey: job.inputKey,
              outputBucket: job.outputBucket,
              outputPrefix: job.outputPrefix,
              assetsBucket: job.assetsBucket,
              // R2 credentials for Runpod to download/upload
              // (Passed securely via Runpod, not exposed to client)
              r2AccountId: env.CLOUDFLARE_ACCOUNT_ID,
              r2AccessKeyId: env.R2_ACCESS_KEY_ID,
              r2SecretAccessKey: env.R2_SECRET_ACCESS_KEY,
              // Webhook URL for completion notification
              webhookUrl: `${env.APP_URL}/api/transcoding/webhook`,
              webhookSecret: env.WEBHOOK_SECRET  // For signature verification
            }
          })
        });

        if (!response.ok) {
          throw new Error(`Runpod API error: ${response.statusText}`);
        }

        const result = await response.json();
        console.log(`Runpod job started: ${result.id} for media ${job.mediaId}`);

        // ACK message (remove from queue)
        message.ack();

      } catch (error) {
        console.error(`Failed to process transcoding job for ${job.mediaId}:`, error);

        // Single retry logic
        if (job.attemptNumber < 2) {
          // Retry after 5 minutes with incremented attempt number
          const retryJob = { ...job, attemptNumber: job.attemptNumber + 1 };
          message.retry({ delaySeconds: 300 });
        } else {
          // Permanent failure: ACK and notify webhook
          message.ack();

          await fetch(`${env.APP_URL}/api/transcoding/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: 'internal-failure',
              status: 'failed',
              output: { mediaId: job.mediaId, type: job.type },
              error: `Queue consumer error: ${error.message}`
            })
          });
        }
      }
    }
  }
};
```

---

### 3. Webhook API Route (`packages/web/src/routes/api/transcoding/webhook/+server.ts`)

**Responsibility**: Receive completion notifications from Runpod

**Implementation**:
```typescript
import { transcodingService } from '$lib/server/transcoding/service';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import crypto from 'crypto';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const payload: RunpodWebhookPayload = await request.json();

    // Verify webhook signature (prevent unauthorized calls)
    const signature = request.headers.get('x-runpod-signature');
    if (!verifyWebhookSignature(payload, signature)) {
      return json({ error: 'Invalid signature' }, { status: 401 });
    }

    await transcodingService.handleWebhook(payload);

    return json({ success: true });

  } catch (error) {
    console.error('Webhook processing error:', error);
    return json({ error: error.message }, { status: 500 });
  }
};

function verifyWebhookSignature(payload: any, signature: string | null): boolean {
  if (!signature) return false;

  const secret = process.env.WEBHOOK_SECRET!;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

---

### 4. Runpod Handler (Custom Docker Image)

**Why Docker Image?**
- Runpod serverless requires custom code execution
- Preinstall ffmpeg (with NVIDIA GPU support) + audiowaveform
- Package Python handler script
- Deploy as reusable Docker image on Docker Hub

**Dockerfile** (`infrastructure/runpod/Dockerfile`):
```dockerfile
FROM nvidia/cuda:12.1.0-base-ubuntu22.04

# Install ffmpeg with NVENC (NVIDIA GPU encoding)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    audiowaveform \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install AWS CLI for R2 access (S3-compatible)
RUN pip3 install awscli runpod

# Copy handler script
COPY handler.py /handler.py

# Runpod serverless entry point
CMD ["python3", "/handler.py"]
```

**Handler Script** (`infrastructure/runpod/handler.py`):
```python
import os
import json
import subprocess
import requests
import hmac
import hashlib
from pathlib import Path

def handler(event):
    """
    Runpod serverless handler for video/audio transcoding
    """
    input_data = event['input']

    media_id = input_data['mediaId']
    media_type = input_data['type']
    webhook_url = input_data['webhookUrl']
    webhook_secret = input_data['webhookSecret']

    # Configure R2 (S3-compatible) credentials
    # Runpod receives credentials securely, configures AWS CLI
    os.environ['AWS_ACCESS_KEY_ID'] = input_data['r2AccessKeyId']
    os.environ['AWS_SECRET_ACCESS_KEY'] = input_data['r2SecretAccessKey']
    r2_endpoint = f"https://{input_data['r2AccountId']}.r2.cloudflarestorage.com"

    try:
        # Download input file from R2
        input_path = f"/tmp/{media_id}-input"
        s3_url = f"s3://{input_data['inputBucket']}/{input_data['inputKey']}"

        print(f"Downloading from R2: {s3_url}")
        subprocess.run([
            'aws', 's3', 'cp', s3_url, input_path,
            '--endpoint-url', r2_endpoint
        ], check=True)

        # Transcode based on type
        if media_type == 'video':
            result = transcode_video(media_id, input_path, input_data, r2_endpoint)
        else:
            result = transcode_audio(media_id, input_path, input_data, r2_endpoint)

        # Send success webhook with signature
        send_webhook(webhook_url, webhook_secret, {
            'id': event['id'],
            'status': 'completed',
            'output': result
        })

        return result

    except Exception as e:
        print(f"Transcoding failed: {str(e)}")

        # Send failure webhook
        send_webhook(webhook_url, webhook_secret, {
            'id': event['id'],
            'status': 'failed',
            'output': {'mediaId': media_id, 'type': media_type},
            'error': str(e)
        })

        raise

def transcode_video(media_id, input_path, input_data, r2_endpoint):
    """
    Transcode video to HLS with multiple quality variants
    """
    output_dir = f"/tmp/{media_id}-hls"
    os.makedirs(output_dir, exist_ok=True)

    # Detect source resolution and duration using ffprobe
    probe_cmd = [
        'ffprobe', '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,duration',
        '-of', 'json', input_path
    ]
    probe_result = subprocess.run(probe_cmd, capture_output=True, text=True, check=True)
    probe_data = json.loads(probe_result.stdout)
    stream = probe_data['streams'][0]

    source_width = int(stream['width'])
    source_height = int(stream['height'])
    duration = float(stream.get('duration', 0))

    # Determine quality variants (don't upscale)
    variants = []
    if source_height >= 1080:
        variants = [
            {'name': '1080p', 'width': 1920, 'height': 1080, 'bitrate': '5000k'},
            {'name': '720p', 'width': 1280, 'height': 720, 'bitrate': '2500k'},
            {'name': '480p', 'width': 854, 'height': 480, 'bitrate': '1000k'},
            {'name': '360p', 'width': 640, 'height': 360, 'bitrate': '500k'}
        ]
    elif source_height >= 720:
        variants = [
            {'name': '720p', 'width': 1280, 'height': 720, 'bitrate': '2500k'},
            {'name': '480p', 'width': 854, 'height': 480, 'bitrate': '1000k'},
            {'name': '360p', 'width': 640, 'height': 360, 'bitrate': '500k'}
        ]
    elif source_height >= 480:
        variants = [
            {'name': '480p', 'width': 854, 'height': 480, 'bitrate': '1000k'},
            {'name': '360p', 'width': 640, 'height': 360, 'bitrate': '500k'}
        ]
    else:
        variants = [{'name': '360p', 'width': 640, 'height': 360, 'bitrate': '500k'}]

    # Transcode each quality variant to HLS
    for variant in variants:
        variant_dir = f"{output_dir}/{variant['name']}"
        os.makedirs(variant_dir, exist_ok=True)

        print(f"Transcoding {variant['name']}...")
        ffmpeg_cmd = [
            'ffmpeg', '-i', input_path,
            '-vf', f"scale={variant['width']}:{variant['height']}",
            '-c:v', 'h264_nvenc',  # NVIDIA GPU hardware encoding
            '-preset', 'p4',  # Fast preset for NVENC
            '-b:v', variant['bitrate'],
            '-c:a', 'aac', '-b:a', '128k',
            '-hls_time', '6',  # 6-second segments
            '-hls_playlist_type', 'vod',
            '-hls_segment_filename', f"{variant_dir}/segment_%03d.ts",
            f"{variant_dir}/playlist.m3u8"
        ]
        subprocess.run(ffmpeg_cmd, check=True)

    # Generate HLS master playlist
    master_playlist = "#EXTM3U\n#EXT-X-VERSION:3\n"
    for variant in variants:
        bandwidth = int(variant['bitrate'].replace('k', '000'))
        master_playlist += f"#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},RESOLUTION={variant['width']}x{variant['height']}\n"
        master_playlist += f"{variant['name']}/playlist.m3u8\n"

    master_path = f"{output_dir}/master.m3u8"
    with open(master_path, 'w') as f:
        f.write(master_playlist)

    # Extract thumbnail at 10% mark
    thumbnail_time = duration * 0.1
    thumbnail_path = f"/tmp/{media_id}-thumbnail.jpg"
    print(f"Extracting thumbnail at {thumbnail_time}s...")
    subprocess.run([
        'ffmpeg', '-ss', str(thumbnail_time), '-i', input_path,
        '-vframes', '1', '-vf', 'scale=1280:720',
        thumbnail_path
    ], check=True)

    # Upload HLS files to R2 (sync entire directory)
    output_prefix = input_data['outputPrefix']
    print(f"Uploading HLS files to R2: {output_prefix}")
    subprocess.run([
        'aws', 's3', 'sync', output_dir,
        f"s3://{input_data['outputBucket']}/{output_prefix}",
        '--endpoint-url', r2_endpoint
    ], check=True)

    # Upload thumbnail to assets bucket
    thumbnail_key = f"thumbnails/media/{media_id}/auto-generated.jpg"
    print(f"Uploading thumbnail to R2: {thumbnail_key}")
    subprocess.run([
        'aws', 's3', 'cp', thumbnail_path,
        f"s3://{input_data['assetsBucket']}/{thumbnail_key}",
        '--endpoint-url', r2_endpoint
    ], check=True)

    return {
        'mediaId': media_id,
        'type': 'video',
        'hlsMasterPlaylistKey': f"{output_prefix}master.m3u8",
        'thumbnailKey': thumbnail_key,
        'durationSeconds': int(duration),
        'width': source_width,
        'height': source_height
    }

def transcode_audio(media_id, input_path, input_data, r2_endpoint):
    """
    Transcode audio to HLS with multiple quality variants and generate waveform
    """
    output_dir = f"/tmp/{media_id}-hls-audio"
    os.makedirs(output_dir, exist_ok=True)

    # Detect duration using ffprobe
    probe_cmd = [
        'ffprobe', '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'json', input_path
    ]
    probe_result = subprocess.run(probe_cmd, capture_output=True, text=True, check=True)
    probe_data = json.loads(probe_result.stdout)
    duration = float(probe_data['format']['duration'])

    # Define audio quality variants
    variants = [
        {'name': '128k', 'bitrate': '128k'},
        {'name': '64k', 'bitrate': '64k'}
    ]

    # Transcode each quality variant to HLS
    for variant in variants:
        variant_dir = f"{output_dir}/{variant['name']}"
        os.makedirs(variant_dir, exist_ok=True)

        print(f"Transcoding audio {variant['name']}...")
        ffmpeg_cmd = [
            'ffmpeg', '-i', input_path,
            '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',  # EBU R128 loudness
            '-c:a', 'aac', '-b:a', variant['bitrate'],
            '-hls_time', '6',  # 6-second segments
            '-hls_playlist_type', 'vod',
            '-hls_segment_filename', f"{variant_dir}/segment_%03d.ts",
            f"{variant_dir}/playlist.m3u8"
        ]
        subprocess.run(ffmpeg_cmd, check=True)

    # Generate HLS master playlist
    master_playlist = "#EXTM3U\n#EXT-X-VERSION:3\n"
    for variant in variants:
        bandwidth = int(variant['bitrate'].replace('k', '000'))
        master_playlist += f"#EXT-X-STREAM-INF:BANDWIDTH={bandwidth}\n"
        master_playlist += f"{variant['name']}/playlist.m3u8\n"

    master_path = f"{output_dir}/master.m3u8"
    with open(master_path, 'w') as f:
        f.write(master_playlist)

    # Generate waveform JSON (stored in R2, not database)
    waveform_json_path = f"/tmp/{media_id}-waveform.json"
    print("Generating waveform JSON...")
    subprocess.run([
        'audiowaveform', '-i', input_path,
        '-o', waveform_json_path,
        '--pixels-per-second', '10',  # 10 data points per second
        '--bits', '8'
    ], check=True)

    # Generate waveform preview image
    waveform_img_path = f"/tmp/{media_id}-waveform.png"
    print("Generating waveform image...")
    subprocess.run([
        'audiowaveform', '-i', input_path,
        '-o', waveform_img_path,
        '--width', '1280', '--height', '720',
        '--colors', 'audacity'
    ], check=True)

    # Upload HLS audio files to R2 (sync entire directory)
    output_prefix = input_data['outputPrefix']
    print(f"Uploading HLS audio files to R2: {output_prefix}")
    subprocess.run([
        'aws', 's3', 'sync', output_dir,
        f"s3://{input_data['outputBucket']}/{output_prefix}",
        '--endpoint-url', r2_endpoint
    ], check=True)

    # Upload waveform JSON to R2 (assets bucket)
    waveform_key = f"waveforms/{media_id}/waveform.json"
    print(f"Uploading waveform JSON to R2: {waveform_key}")
    subprocess.run([
        'aws', 's3', 'cp', waveform_json_path,
        f"s3://{input_data['assetsBucket']}/{waveform_key}",
        '--endpoint-url', r2_endpoint
    ], check=True)

    # Upload waveform image (thumbnail)
    waveform_img_key = f"thumbnails/media/{media_id}/waveform.png"
    print(f"Uploading waveform image to R2: {waveform_img_key}")
    subprocess.run([
        'aws', 's3', 'cp', waveform_img_path,
        f"s3://{input_data['assetsBucket']}/{waveform_img_key}",
        '--endpoint-url', r2_endpoint
    ], check=True)

    return {
        'mediaId': media_id,
        'type': 'audio',
        'hlsMasterPlaylistKey': f"{output_prefix}master.m3u8",
        'waveformKey': waveform_key,  # R2 key, frontend fetches JSON
        'waveformImageKey': waveform_img_key,
        'durationSeconds': int(duration)
    }

def send_webhook(url, secret, payload):
    """
    Send webhook with HMAC signature for security
    """
    payload_json = json.dumps(payload)

    # Generate HMAC signature
    signature = hmac.new(
        secret.encode(),
        payload_json.encode(),
        hashlib.sha256
    ).hexdigest()

    response = requests.post(
        url,
        json=payload,
        headers={'x-runpod-signature': signature}
    )

    if not response.ok:
        print(f"Webhook failed: {response.status_code} {response.text}")

# Runpod serverless entry point
if __name__ == "__main__":
    import runpod
    runpod.serverless.start({"handler": handler})
```

**Building and Deploying Docker Image**:
```bash
# Build image
cd infrastructure/runpod
docker build -t your-dockerhub-username/codex-transcoder:latest .

# Push to Docker Hub
docker push your-dockerhub-username/codex-transcoder:latest

# Configure Runpod serverless endpoint to use this image
# (Done via Runpod dashboard or API)
```

---

## Data Models / Schema

**Update to Media Items Table** (add error tracking and waveform key):
```typescript
// In packages/web/src/lib/server/db/schema/media.ts
export const mediaItems = pgTable('media_items', {
  // ... existing fields ...

  // HLS output (if video or audio, populated after transcoding)
  hlsMasterPlaylistKey: varchar('hls_master_playlist_key', { length: 500 }),  // 'hls/{mediaId}/master.m3u8' or 'hls-audio/{mediaId}/master.m3u8'

  // Waveform data (R2 key, not stored in DB)
  waveformKey: varchar('waveform_key', { length: 500 }),  // 'waveforms/{mediaId}/waveform.json'

  // Error tracking (for failed transcoding)
  errorMessage: text('error_message')  // Null if successful, error string if failed
});
```

**Note**: No separate `transcoding_errors` table. Errors stored directly in `media_items.errorMessage` for simplicity. Failed items auto-deleted after 24 hours by cron job.

---

## Cron Job for Cleanup (`packages/web/src/routes/api/cron/cleanup-failed-media/+server.ts`)

**Responsibility**: Run daily to delete failed media items

```typescript
import { transcodingService } from '$lib/server/transcoding/service';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
  // Verify cron secret (prevent unauthorized calls)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  await transcodingService.cleanupFailedItems();

  return json({ success: true });
};
```

**Cloudflare Cron Trigger** (`wrangler.toml`):
```toml
[triggers]
crons = ["0 2 * * *"]  # Daily at 2am UTC
```

---

## Environment Configuration

```bash
# Runpod
RUNPOD_API_KEY=your-runpod-api-key
RUNPOD_ENDPOINT_URL=https://api.runpod.ai/v2/{endpoint-id}/run

# Webhook security
WEBHOOK_SECRET=random-secret-key-for-signature-verification

# Cron security
CRON_SECRET=random-secret-for-cron-endpoint

# Cloudflare (already configured)
CLOUDFLARE_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key

# App URL (for webhooks)
APP_URL=https://codex.example.com
```

**wrangler.toml** (Queue Worker):
```toml
name = "transcoding-queue-consumer"
main = "workers/transcoding-queue-consumer/src/index.ts"
compatibility_date = "2024-01-01"

[[queues.consumers]]
queue = "transcoding-queue"
max_batch_size = 10
max_batch_timeout = 30
max_retries = 1  # Single retry in queue

[vars]
APP_URL = "https://codex.example.com"

[env.production.vars]
RUNPOD_API_KEY = "production-key"
RUNPOD_ENDPOINT_URL = "https://api.runpod.ai/v2/{prod-endpoint}/run"
WEBHOOK_SECRET = "production-webhook-secret"
```

---

## Testing Strategy

### Unit Tests

**TranscodingService**:
```typescript
describe('TranscodingService', () => {
  it('handles successful video webhook', async () => {
    const webhook: RunpodWebhookPayload = {
      id: 'job-id',
      status: 'completed',
      output: {
        mediaId: 'media-uuid',
        type: 'video',
        hlsMasterPlaylistKey: 'hls/media-uuid/master.m3u8',
        thumbnailKey: 'thumbnails/media/media-uuid/auto-generated.jpg',
        durationSeconds: 120,
        width: 1920,
        height: 1080
      }
    };

    await transcodingService.handleWebhook(webhook);

    const mediaItem = await db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, 'media-uuid')
    });

    expect(mediaItem.status).toBe('ready');
    expect(mediaItem.hlsMasterPlaylistKey).toBe('hls/media-uuid/master.m3u8');
  });

  it('handles successful audio webhook with waveform', async () => {
    const webhook: RunpodWebhookPayload = {
      id: 'job-id',
      status: 'completed',
      output: {
        mediaId: 'audio-uuid',
        type: 'audio',
        normalizedAudioKey: 'audio/audio-uuid/normalized.mp3',
        waveformKey: 'waveforms/audio-uuid/waveform.json',  // R2 key
        waveformImageKey: 'thumbnails/media/audio-uuid/waveform.png',
        durationSeconds: 180
      }
    };

    await transcodingService.handleWebhook(webhook);

    const mediaItem = await db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, 'audio-uuid')
    });

    expect(mediaItem.status).toBe('ready');
    expect(mediaItem.waveformKey).toBe('waveforms/audio-uuid/waveform.json');
  });

  it('cleans up failed items after 24 hours', async () => {
    // Create failed media item 25 hours ago
    await db.insert(mediaItems).values({
      id: 'failed-uuid',
      status: 'failed',
      errorMessage: 'Test error',
      updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000)
    });

    await transcodingService.cleanupFailedItems();

    const deleted = await db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, 'failed-uuid')
    });

    expect(deleted).toBeNull();
  });
});
```

---

## Related Documents

- **PRD**: [Media Transcoding PRD](./pdr-phase-1.md)
- **Cross-Feature Dependencies**:
  - [Content Management TDD](../content-management/ttd-dphase-1.md) - Media upload
  - [Content Access TDD](../content-access/ttd-dphase-1.md) - HLS/waveform delivery
  - [Admin Dashboard TDD](../admin-dashboard/ttd-dphase-1.md) - Status display
- **Infrastructure**:
  - [R2 Bucket Structure](../../infrastructure/R2BucketStructure.md) - Output storage
  - [Runpod Setup](../../infrastructure/RunpodSetup.md) - Docker image deployment
  - [Cloudflare Queue Setup](../../infrastructure/CloudflareSetup.md) - Job queue
  - [Database Schema](../../infrastructure/DatabaseSchema.md) - Media items schema

---

**Document Version**: 1.0
**Last Updated**: 2025-10-20
**Status**: Draft - Awaiting Review
