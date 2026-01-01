# Media Transcoding - Phase 1 TDD (Technical Design Document)

## System Overview

The media transcoding system asynchronously converts uploaded videos to HLS format and audio files to HLS with waveform generation. Processing happens via content-api → media-api → Runpod GPU workers (no queue in Phase 1).

**Key Architecture Decisions**:

- **Asynchronous Processing**: Internal trigger to avoid blocking uploads (no queue in Phase 1)
- **GPU Acceleration**: Runpod serverless for 10x faster transcoding
- **Webhook Callbacks**: Runpod notifies when jobs complete
- **Single Retry**: Cost control, serverless failures are deterministic
- **Automatic Cleanup**: Failed items auto-deleted after 24 hours
- **Waveform in R2**: Waveform JSON stored in R2 (not database) to save DB costs
- **Tiered Storage**: R2 for delivery (zero egress), B2 for archival (~60% cheaper)
- **Mezzanine Preservation**: High-quality intermediate retained for future re-encoding
- **Two-Pass Loudness**: Measure then normalize, store measurements for analytics

**Architecture**:

- **Media API Layer**: media-api worker orchestrates Runpod jobs and webhook handling
- **Processing Layer**: Runpod GPU workers (custom Docker image with ffmpeg + audiowaveform)
- **Delivery Storage**: Cloudflare R2 for HLS, thumbnails, waveforms (zero egress)
- **Archival Storage**: Backblaze B2 for originals, mezzanines (cheap, Bandwidth Alliance)
- **Metadata Layer**: Neon Postgres for status tracking and loudness metadata

**Architecture Diagram**:

![Transcoding Architecture](./assets/transcoding-architecture.png)

The diagram shows the transcoding pipeline: media-api orchestration, Runpod GPU processing, and R2 storage integration.

---

## Phase 1 Alignment Note (Authoritative)

- Phase 1 does not use Cloudflare Queues; content-api calls the internal media-api trigger.
- media-api owns Runpod job orchestration and webhook handling (`/api/transcoding/webhook` with raw-body HMAC).
- R2 keys are creator-scoped with `{creatorId}/` prefixes (see implementation plans for the exact contract).
- Queue consumer examples below are deferred to Phase 2 and should be treated as legacy.

## Dependencies

See the centralized [Cross-Feature Dependencies](../../cross-feature-dependencies.md#6-media-transcoding) document for details on dependencies between features.

### Technical Prerequisites

1.  **Content Management Service**: The media upload flow and `media_items` table are required as inputs to the transcoding process.
2.  **Runpod Account & Endpoint**: A serverless GPU endpoint with the custom Docker image is necessary for processing.
3.  **R2 Buckets**: Unified buckets must be provisioned with `{creatorId}/` prefixes for input and output storage.

---

## Component List

### 1. Transcoding Service (`packages/transcoding/src/services/transcoding-service.ts`)

**Responsibility**: Trigger Runpod jobs and handle webhook callbacks

**Interface**:

```typescript
export interface ITranscodingService {
  // Trigger transcoding job (called after media upload)
  triggerJob(mediaId: string, creatorId: string): Promise<void>;

  // Handle webhook callback from Runpod
  handleWebhook(payload: RunpodWebhookPayload): Promise<void>;

  // Retry failed job (manual retry by creator)
  retryTranscoding(mediaId: string, creatorId: string): Promise<void>;

  // Query current transcoding status
  getTranscodingStatus(mediaId: string, creatorId: string): Promise<MediaStatus>;
}

export interface TranscodingJobPayload {
  mediaId: string;
  creatorId: string;
  mediaType: 'video' | 'audio';
  inputBucket: string;
  inputKey: string;
  outputBucket: string;
  outputPrefix: string; // For video/audio HLS output
  assetsBucket: string; // For thumbnails/waveforms
  webhookUrl: string;
  webhookSecret: string;
}

export interface RunpodWebhookPayload {
  id: string; // Runpod job ID
  status: 'completed' | 'failed';
  output?: {
    mediaId: string;
    mediaType: 'video' | 'audio';
    // Video/Audio outputs
    hlsMasterPlaylistKey?: string;
    hlsPreviewKey?: string;
    thumbnailKey?: string;
    durationSeconds?: number;
    width?: number;
    height?: number;
    // Audio-specific outputs
    waveformKey?: string; // R2 key: '{creatorId}/waveforms/{mediaId}/waveform.json'
    waveformImageKey?: string;
    // Extensibility fields (Phase 1)
    mezzanineKey?: string; // B2 key: 'mezzanine/{creatorId}/{mediaId}/mezzanine.mp4'
    readyVariants?: string[]; // ['1080p', '720p', '480p', '360p', 'preview']
    loudness?: {
      integrated: number; // -16 LUFS stored as -1600 (×100)
      peak: number; // dBFS ×100
      range: number; // LU ×100
    };
  };
  error?: string;
}
```

**Implementation**:

Note: Example below reflects Phase 1 (`media-api` trigger, no queue).

```typescript
import { and, eq, sql } from 'drizzle-orm';
import { mediaItems } from '@codex/database/schema';

export class TranscodingService implements ITranscodingService {
  async triggerJob(mediaId: string, creatorId: string): Promise<void> {
    const mediaItem = await db.query.mediaItems.findFirst({
      where: and(eq(mediaItems.id, mediaId), eq(mediaItems.creatorId, creatorId)),
    });

    if (!mediaItem) {
      throw new Error('Media item not found');
    }

    const outputPrefix =
      mediaItem.mediaType === 'video'
        ? `${creatorId}/hls/${mediaItem.id}/`
        : `${creatorId}/hls-audio/${mediaItem.id}/`;

    const payload: TranscodingJobPayload = {
      mediaId: mediaItem.id,
      creatorId,
      mediaType: mediaItem.mediaType,
      inputBucket: env.R2_BUCKET_MEDIA,
      inputKey: mediaItem.r2Key,
      outputBucket: env.R2_BUCKET_MEDIA,
      outputPrefix,
      assetsBucket: env.R2_BUCKET_ASSETS,
      webhookUrl: `${env.APP_URL}/api/transcoding/webhook`,
      webhookSecret: env.RUNPOD_WEBHOOK_SECRET,
    };

    const response = await fetch(
      `https://api.runpod.ai/v2/${env.RUNPOD_ENDPOINT_ID}/run`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RUNPOD_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input: payload }),
      }
    );

    if (!response.ok) {
      throw new Error(`Runpod API error: ${response.statusText}`);
    }

    const result = await response.json();

    await db
      .update(mediaItems)
      .set({
        status: 'transcoding',
        runpodJobId: result.id,
        transcodingError: null,
        updatedAt: new Date(),
      })
      .where(eq(mediaItems.id, mediaItem.id));
  }

  async handleWebhook(payload: RunpodWebhookPayload): Promise<void> {
    const { output, status, error } = payload;

    if (!output) {
      return;
    }

    if (status === 'completed') {
      await db
        .update(mediaItems)
        .set({
          status: 'ready',
          hlsMasterPlaylistKey: output.hlsMasterPlaylistKey ?? null,
          hlsPreviewKey: output.hlsPreviewKey ?? null,
          thumbnailKey: output.thumbnailKey ?? null,
          waveformKey: output.waveformKey ?? null,
          waveformImageKey: output.waveformImageKey ?? null,
          durationSeconds: output.durationSeconds ?? null,
          width: output.width ?? null,
          height: output.height ?? null,
          transcodingError: null,
          updatedAt: new Date(),
        })
        .where(eq(mediaItems.id, output.mediaId));

      return;
    }

    await db
      .update(mediaItems)
      .set({
        status: 'failed',
        transcodingError: error || 'Unknown transcoding error',
        transcodingAttempts: sql`${mediaItems.transcodingAttempts} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(mediaItems.id, output.mediaId));
  }

  async retryTranscoding(mediaId: string, creatorId: string): Promise<void> {
    const mediaItem = await db.query.mediaItems.findFirst({
      where: and(eq(mediaItems.id, mediaId), eq(mediaItems.creatorId, creatorId)),
    });

    if (!mediaItem) {
      throw new Error('Media item not found');
    }

    if (mediaItem.status !== 'failed') {
      throw new Error('Can only retry failed transcoding jobs');
    }

    if (mediaItem.transcodingAttempts >= 1) {
      throw new Error('Retry limit reached');
    }

    await db
      .update(mediaItems)
      .set({
        status: 'uploaded',
        transcodingError: null,
        runpodJobId: null,
        updatedAt: new Date(),
      })
      .where(eq(mediaItems.id, mediaId));

    await this.triggerJob(mediaId, creatorId);
  }
}

export const transcodingService = new TranscodingService();
```

---

### 2. Queue Consumer Worker (`workers/transcoding-queue-consumer/src/index.ts`) (Phase 2 - Deferred)

**Responsibility**: Process Cloudflare Queue messages and call Runpod API

Phase 1 uses `media-api` without a queue; this worker is not implemented in the
current plan.

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
        const response = await fetch(
          `https://api.runpod.ai/v2/${env.RUNPOD_ENDPOINT_ID}/run`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${env.RUNPOD_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              input: {
                mediaId: job.mediaId,
                creatorId: job.creatorId,
                mediaType: job.mediaType,
                inputBucket: job.inputBucket,
                inputKey: job.inputKey,
                outputBucket: job.outputBucket,
                outputPrefix: job.outputPrefix,
                assetsBucket: job.assetsBucket,
                // Webhook URL for completion notification
                webhookUrl: `${env.APP_URL}/api/transcoding/webhook`,
                webhookSecret: env.RUNPOD_WEBHOOK_SECRET, // For signature verification
              },
            }),
          }
        );

        if (!response.ok) {
          throw new Error(`Runpod API error: ${response.statusText}`);
        }

        const result = await response.json();
        console.log(
          `Runpod job started: ${result.id} for media ${job.mediaId}`
        );

        // ACK message (remove from queue)
        message.ack();
      } catch (error) {
        console.error(
          `Failed to process transcoding job for ${job.mediaId}:`,
          error
        );

        // Let queue retry once (max_retries=1 in wrangler config)
        message.retry({ delaySeconds: 300 });
      }
    }
  },
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

function verifyWebhookSignature(
  payload: any,
  signature: string | null
): boolean {
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

**Update to Media Items Table** (add transcoding fields with extensibility):

```typescript
// In packages/database/src/schema/content.ts
export const mediaItems = pgTable('media_items', {
  // ... existing fields ...

  // HLS output (populated after transcoding)
  hlsMasterPlaylistKey: varchar('hls_master_playlist_key', { length: 500 }),
  hlsPreviewKey: varchar('hls_preview_key', { length: 500 }),

  // Audio-specific
  waveformKey: varchar('waveform_key', { length: 500 }),
  waveformImageKey: varchar('waveform_image_key', { length: 500 }),
  thumbnailKey: varchar('thumbnail_key', { length: 500 }),

  // Error tracking
  transcodingError: text('transcoding_error'),
  transcodingAttempts: integer('transcoding_attempts').default(0),
  runpodJobId: varchar('runpod_job_id', { length: 100 }),

  // Extensibility fields (Phase 1 foundation for Phase 2+)
  mezzanineKey: varchar('mezzanine_key', { length: 500 }), // B2 path
  mezzanineStatus: varchar('mezzanine_status', { length: 50 }), // pending|ready|deleted
  transcodingPriority: varchar('transcoding_priority', { length: 20 }).default('standard'),
  readyVariants: jsonb('ready_variants').$type<string[]>().default([]),

  // Loudness metadata (populated by two-pass analysis)
  loudnessIntegrated: integer('loudness_integrated'), // -16 LUFS as -1600 (×100)
  loudnessPeak: integer('loudness_peak'), // dBFS ×100
  loudnessRange: integer('loudness_range'), // LU ×100
});
```

**Storage Tiers**:
- **R2 (Delivery)**: `hlsMasterPlaylistKey`, `hlsPreviewKey`, `waveformKey`, `thumbnailKey`
- **B2 (Archival)**: `mezzanineKey` (permanent), originals (temporary, deleted after 24h)

**Note**: Failed items tracked via `transcodingError` and `transcodingAttempts`. Auto-cleanup after 24 hours by cron job.

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

**Cloudflare Cron Trigger** (`wrangler.jsonc`):

```toml
[triggers]
crons = ["0 2 * * *"]  # Daily at 2am UTC
```

---

## Environment Configuration

```bash
# Runpod
RUNPOD_API_KEY=your-runpod-api-key
RUNPOD_ENDPOINT_ID=your-endpoint-id
RUNPOD_WEBHOOK_SECRET=random-webhook-secret

# Cloudflare R2 (delivery storage)
R2_ACCOUNT_ID=your-cf-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret
R2_MEDIA_BUCKET=codex-media-production
R2_ASSETS_BUCKET=codex-assets-production

# Backblaze B2 (archival storage - mezzanines/originals)
B2_KEY_ID=your-b2-key-id
B2_APPLICATION_KEY=your-b2-app-key
B2_BUCKET_NAME=codex-archive
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com

# Cron security
CRON_SECRET=random-secret-for-cron-endpoint

# App URL (for webhooks)
APP_URL=https://codex.example.com
WORKER_SHARED_SECRET=internal-auth-secret
```

**Storage Configuration Notes**:
- **R2**: Zero egress to Cloudflare Workers (delivery)
- **B2**: ~$6/TB vs R2 $15/TB (archival), Bandwidth Alliance = free egress to CF

**wrangler.jsonc** (Queue Worker):

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
        height: 1080,
      },
    };

    await transcodingService.handleWebhook(webhook);

    const mediaItem = await db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, 'media-uuid'),
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
        waveformKey: 'waveforms/audio-uuid/waveform.json', // R2 key
        waveformImageKey: 'thumbnails/media/audio-uuid/waveform.png',
        durationSeconds: 180,
      },
    };

    await transcodingService.handleWebhook(webhook);

    const mediaItem = await db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, 'audio-uuid'),
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
      updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });

    await transcodingService.cleanupFailedItems();

    const deleted = await db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, 'failed-uuid'),
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

**Document Version**: 1.1
**Last Updated**: 2026-01-01
**Status**: Ready for Implementation

**Revision Notes**:
- Added tiered storage (R2 delivery + B2 archival)
- Added mezzanine preservation and loudness metadata fields
- Updated webhook payload with extensibility fields
- Added B2 environment configuration
