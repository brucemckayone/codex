# RunPod Transcoding Worker

GPU-accelerated media transcoding worker for the Codex platform.

## Overview

This worker runs on RunPod's serverless GPU infrastructure to:

- Transcode video/audio to multi-quality HLS streams
- Generate archive-quality mezzanine files (stored in B2)
- Extract thumbnails and preview clips
- Generate audio waveform visualizations
- Send HMAC-signed webhook callbacks on completion

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                    RunPod Serverless GPU                       │
├────────────────────────────────────────────────────────────────┤
│  1. Download original from R2                                  │
│  2. Probe metadata (ffprobe)                                   │
│  3. Create mezzanine (CRF 18) → B2                            │
│  4. Transcode HLS variants → R2                                │
│  5. Generate preview/thumbnail/waveform → R2                   │
│  6. Send HMAC-signed webhook → media-api                       │
└────────────────────────────────────────────────────────────────┘
```

## Storage

| Asset | Storage | Bucket |
|-------|---------|--------|
| Original uploads | R2 | codex-media-{env} |
| HLS streams | R2 | codex-media-{env} |
| Thumbnails | R2 | codex-media-{env} |
| Waveforms | R2 | codex-media-{env} |
| Mezzanine (archive) | B2 | codex-mezzanine-{env} |

## FFmpeg Settings

### Video Encoding
- **GPU**: `h264_nvenc`, preset p4, cq 23
- **CPU fallback**: `libx264`, preset fast, crf 23
- **Mezzanine**: CRF 18 (archive quality)

### HLS Variants (Video)
| Quality | Resolution | Video Bitrate | Audio Bitrate |
|---------|------------|---------------|---------------|
| 1080p | 1920x1080 | 5000 kbps | 192 kbps |
| 720p | 1280x720 | 3000 kbps | 128 kbps |
| 480p | 854x480 | 1500 kbps | 96 kbps |
| 360p | 640x360 | 800 kbps | 64 kbps |

### HLS Variants (Audio)
| Quality | Bitrate |
|---------|---------|
| 128k | 128 kbps |
| 64k | 64 kbps |

### Audio Normalization
- **Target loudness**: -16 LUFS
- **True peak**: -1.5 dBTP
- **Loudness range**: 11 LU

## Local Development

### Build the Docker image

```bash
cd infrastructure/runpod
docker build -t codex-transcoder:dev .
```

### Test locally (without GPU)

```bash
docker run --rm \
  -e RUNPOD_DEBUG=true \
  codex-transcoder:dev \
  python3 -c "from handler.main import handler; print('Handler loaded successfully')"
```

### Test with GPU

```bash
docker run --rm --gpus all \
  codex-transcoder:dev \
  ffmpeg -encoders | grep nvenc
```

## Deployment

### Push to Docker Hub

```bash
docker tag codex-transcoder:dev yourusername/codex-transcoder:latest
docker push yourusername/codex-transcoder:latest
```

### Create RunPod Serverless Endpoint

1. Go to RunPod Console → Serverless
2. Create new endpoint
3. Use Docker image: `yourusername/codex-transcoder:latest`
4. Configure GPU (RTX 3090 or better recommended)
5. Set webhook URL in endpoint settings

## Environment Variables

The handler receives credentials via the job input payload:

```json
{
  "mediaId": "uuid",
  "creatorId": "user-id",
  "type": "video",
  "inputKey": "creator-id/originals/media-id/video.mp4",
  "webhookUrl": "https://media-api.codex.com/api/transcoding/webhook",
  "webhookSecret": "hmac-secret",
  "r2Endpoint": "https://account-id.r2.cloudflarestorage.com",
  "r2AccessKeyId": "...",
  "r2SecretAccessKey": "...",
  "r2BucketName": "codex-media-production",
  "b2Endpoint": "https://s3.us-west-004.backblazeb2.com",
  "b2AccessKeyId": "...",
  "b2SecretAccessKey": "...",
  "b2BucketName": "codex-mezzanine-production"
}
```

## Webhook Payload

### Success

```json
{
  "status": "completed",
  "mediaId": "uuid",
  "hlsMasterPlaylistKey": "creator-id/hls/media-id/master.m3u8",
  "hlsPreviewKey": "creator-id/hls/media-id/preview/preview.m3u8",
  "thumbnailKey": "creator-id/thumbnails/media-id/auto-generated.jpg",
  "waveformKey": null,
  "waveformImageKey": null,
  "mezzanineKey": "creator-id/mezzanine/media-id/mezzanine.mp4",
  "durationSeconds": 600,
  "width": 1920,
  "height": 1080,
  "readyVariants": ["1080p", "720p", "480p", "360p"],
  "error": null
}
```

### Failure

```json
{
  "status": "failed",
  "mediaId": "uuid",
  "error": "Error message (max 2KB)"
}
```

### Webhook Signature

Webhooks are signed with HMAC-SHA256:

```
X-Runpod-Signature: hmac_sha256(payload, webhook_secret)
```
