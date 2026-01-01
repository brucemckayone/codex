# P1-TRANSCODE-001: Media Transcoding Implementation Plan

**Status**: Ready for Implementation
**Dependencies**: P1-CONTENT-001 ✅, R2 storage ✅, @codex foundations ✅
**Created**: 2025-12-18
**Last Updated**: 2025-12-31

---

## Executive Summary

This document is the **single source of truth** for implementing media transcoding. It contains all technical details, code examples, and contracts needed to build the system without additional research.

**System Components**:
1. `@codex/transcoding` package - Business logic for job orchestration
2. `media-api` worker - Cloudflare Worker handling triggers and webhooks
3. RunPod Python worker - Docker container with FFmpeg/audiowaveform

---

## Intent and Maintenance Goals

- Keep media processing inside a single worker boundary for easy reasoning
- Capture every external contract in one place
- Avoid stringly paths: every R2 key comes from one shared utility (`paths.ts`)
- Enforce a small, tested state machine for status transitions
- Treat webhook payloads as untrusted until verified

---

## Quick Reference: Key Decisions

| Decision | Value | Rationale |
|----------|-------|-----------|
| Queue | None (Phase 1) | Simplicity; add Cloudflare Queues later |
| Retries | 1 manual only | Serverless failures are deterministic |
| State storage | `media_items` fields | No separate jobs table |
| Webhook auth | HMAC-SHA256 | Matches RunPod webhook pattern |
| Internal auth | `workerAuth` | Existing pattern |
| R2 prefix | `{creatorId}/` | Multi-tenant isolation |
| HLS segments | 6 seconds | Industry standard |
| Audio loudness | -16 LUFS | EBU R128 broadcast standard |
| Waveform resolution | 10 pts/sec | Balance detail vs size |
| Handler language | Python | Better FFmpeg integration |

---

## Part 1: Contracts (Ground Truth)

### 1.1 Storage Path Contract

All paths include creator prefix for multi-tenancy. The system uses **tiered storage**:
- **R2**: Delivery (zero egress to Cloudflare)
- **B2**: Archival (cheaper storage, Bandwidth Alliance for free egress)

**R2 Media Bucket** (`codex-media-{env}`) - Delivery:
```
{creatorId}/hls/{mediaId}/master.m3u8              # Video HLS master
{creatorId}/hls/{mediaId}/1080p/playlist.m3u8      # Video variant
{creatorId}/hls/{mediaId}/1080p/segment_000.ts     # Video segment
{creatorId}/hls/{mediaId}/preview/preview.m3u8     # 30-sec preview
{creatorId}/hls-audio/{mediaId}/master.m3u8        # Audio HLS master
{creatorId}/hls-audio/{mediaId}/128k/playlist.m3u8 # Audio variant
```

**R2 Assets Bucket** (`codex-assets-{env}`) - Public Assets:
```
{creatorId}/thumbnails/media/{mediaId}/auto-generated.jpg  # Video thumbnail
{creatorId}/waveforms/{mediaId}/waveform.json              # Audio waveform data
{creatorId}/thumbnails/media/{mediaId}/waveform.png        # Audio waveform image
```

**Backblaze B2 Archive Bucket** (`codex-archive`) - Archival:
```
originals/{creatorId}/{mediaId}/original.<ext>     # Raw upload (temporary)
mezzanine/{creatorId}/{mediaId}/mezzanine.mp4      # High-quality intermediate (permanent)
```

**Why Tiered Storage?**
- R2: $15/TB storage, $0 egress to CF Workers → best for delivery
- B2: $6/TB storage, free egress to CF via Bandwidth Alliance → best for archival
- Mezzanine retained indefinitely for future re-encoding
- Original deleted 24h after mezzanine verified (saves 50% archival storage)

### 1.2 RunPod Input Payload (media-api → RunPod)

```json
{
  "input": {
    "mediaId": "uuid",
    "creatorId": "uuid",
    "mediaType": "video",
    "inputBucket": "codex-media-production",
    "inputKey": "{creatorId}/originals/{mediaId}/original.mp4",
    "outputBucket": "codex-media-production",
    "outputPrefix": "{creatorId}/hls/{mediaId}/",
    "assetsBucket": "codex-assets-production",
    "webhookUrl": "https://media-api.codex.com/api/transcoding/webhook",
    "webhookSecret": "secret-for-hmac-signing"
  },
  "webhook": "https://media-api.codex.com/api/transcoding/webhook"
}
```

### 1.3 RunPod Webhook Payload (RunPod → media-api)

**Success (Video)**:
```json
{
  "id": "runpod-job-12345",
  "status": "COMPLETED",
  "output": {
    "mediaId": "uuid",
    "mediaType": "video",
    "hlsMasterPlaylistKey": "{creatorId}/hls/{mediaId}/master.m3u8",
    "hlsPreviewKey": "{creatorId}/hls/{mediaId}/preview/preview.m3u8",
    "thumbnailKey": "{creatorId}/thumbnails/media/{mediaId}/auto-generated.jpg",
    "mezzanineKey": "mezzanine/{creatorId}/{mediaId}/mezzanine.mp4",
    "durationSeconds": 120,
    "width": 1920,
    "height": 1080,
    "readyVariants": ["1080p", "720p", "480p", "360p", "preview"],
    "loudness": {
      "integrated": -1600,
      "peak": -150,
      "range": 720
    }
  },
  "executionTime": 45000
}
```

**Success (Audio)**:
```json
{
  "id": "runpod-job-12345",
  "status": "COMPLETED",
  "output": {
    "mediaId": "uuid",
    "mediaType": "audio",
    "hlsMasterPlaylistKey": "{creatorId}/hls-audio/{mediaId}/master.m3u8",
    "waveformKey": "{creatorId}/waveforms/{mediaId}/waveform.json",
    "waveformImageKey": "{creatorId}/thumbnails/media/{mediaId}/waveform.png",
    "mezzanineKey": "mezzanine/{creatorId}/{mediaId}/mezzanine.mp4",
    "durationSeconds": 180,
    "readyVariants": ["128k", "64k"],
    "loudness": {
      "integrated": -1600,
      "peak": -150,
      "range": 720
    }
  },
  "executionTime": 15000
}
```

**Failure**:
```json
{
  "id": "runpod-job-12345",
  "status": "FAILED",
  "output": {
    "mediaId": "uuid",
    "mediaType": "video"
  },
  "error": "FFmpeg failed: unsupported codec"
}
```

### 1.4 Media Status Transitions

```
uploaded → transcoding  (start job)
transcoding → ready     (completed job)
transcoding → failed    (failed job)
failed → uploaded       (manual retry, max 1)
```

### 1.5 Database Schema Additions

Add to `media_items` table:
```typescript
// Phase 1 core fields
hlsPreviewKey: varchar('hls_preview_key', { length: 500 }),
waveformKey: varchar('waveform_key', { length: 500 }),
waveformImageKey: varchar('waveform_image_key', { length: 500 }),
transcodingError: text('transcoding_error'),
transcodingAttempts: integer('transcoding_attempts').default(0),
runpodJobId: varchar('runpod_job_id', { length: 100 }),

// Extensibility fields (mezzanine + future features)
mezzanineKey: varchar('mezzanine_key', { length: 500 }),           // B2 archive bucket path
mezzanineStatus: varchar('mezzanine_status', { length: 50 }),      // pending|ready|deleted
transcodingPriority: varchar('transcoding_priority', { length: 20 })
  .default('standard'),                                             // immediate|standard|on_demand
readyVariants: jsonb('ready_variants').$type<string[]>().default([]), // ['1080p','720p','preview']

// Loudness metadata (populated by RunPod)
loudnessIntegrated: integer('loudness_integrated'),   // -16 LUFS (×100 for precision, e.g. -1600)
loudnessPeak: integer('loudness_peak'),               // dBFS (×100)
loudnessRange: integer('loudness_range'),             // LU (×100)
```

---

## Part 2: FFmpeg Technical Reference

### 2.1 Video HLS Generation (Multi-Quality)

**Quality Variants** (skip if source is lower resolution):

| Variant | Resolution | Bitrate | Audio |
|---------|------------|---------|-------|
| 1080p | 1920x1080 | 5000 kbps | 128k AAC |
| 720p | 1280x720 | 2500 kbps | 128k AAC |
| 480p | 854x480 | 1000 kbps | 128k AAC |
| 360p | 640x360 | 500 kbps | 128k AAC |

**FFmpeg Command (GPU with NVENC)**:
```bash
# Generate 720p HLS variant
ffmpeg -hwaccel cuda -hwaccel_output_format cuda \
  -i /tmp/input.mp4 \
  -vf "scale=1280:720" \
  -c:v h264_nvenc -preset p4 -cq 23 \
  -b:v 2500k -maxrate 3000k -bufsize 5000k \
  -c:a aac -b:a 128k -ar 48000 \
  -flags +cgop -g 48 \
  -hls_time 6 \
  -hls_playlist_type vod \
  -hls_segment_filename "/tmp/output/720p/segment_%03d.ts" \
  "/tmp/output/720p/playlist.m3u8"
```

**Key FFmpeg Options Explained**:
- `-hwaccel cuda -hwaccel_output_format cuda`: Use NVIDIA GPU acceleration
- `-c:v h264_nvenc`: NVIDIA hardware H.264 encoder
- `-preset p4`: Fast NVENC preset (p1-p7, lower=faster)
- `-cq 23`: Constant quality mode (18-28, lower=better quality)
- `-flags +cgop -g 48`: Closed GOP for clean segment boundaries (GOP = 2x segment duration at 24fps)
- `-hls_time 6`: 6-second segments
- `-hls_playlist_type vod`: VOD playlist with EXT-X-ENDLIST

**CPU Fallback (no GPU)**:
```bash
ffmpeg -i /tmp/input.mp4 \
  -vf "scale=1280:720" \
  -c:v libx264 -preset fast -crf 23 \
  -b:v 2500k -maxrate 3000k -bufsize 5000k \
  -c:a aac -b:a 128k -ar 48000 \
  -flags +cgop -g 48 \
  -hls_time 6 \
  -hls_playlist_type vod \
  -hls_segment_filename "/tmp/output/720p/segment_%03d.ts" \
  "/tmp/output/720p/playlist.m3u8"
```

### 2.2 Master Playlist Generation

**Example master.m3u8**:
```m3u8
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
720p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480
480p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360
360p/playlist.m3u8
```

**Python Code to Generate**:
```python
def generate_master_playlist(variants):
    """Generate HLS master playlist from variants list."""
    lines = ["#EXTM3U", "#EXT-X-VERSION:3"]
    for v in variants:
        bandwidth = int(v['bitrate'].replace('k', '')) * 1000
        lines.append(f"#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},RESOLUTION={v['width']}x{v['height']}")
        lines.append(f"{v['name']}/playlist.m3u8")
    return "\n".join(lines)
```

### 2.3 Preview Clip Generation (30 seconds)

```bash
# Extract first 30 seconds at 720p
ffmpeg -hwaccel cuda -hwaccel_output_format cuda \
  -i /tmp/input.mp4 \
  -t 30 \
  -vf "scale=1280:720" \
  -c:v h264_nvenc -preset p4 -cq 23 \
  -b:v 2500k -maxrate 3000k -bufsize 5000k \
  -c:a aac -b:a 128k -ar 48000 \
  -flags +cgop -g 48 \
  -hls_time 6 \
  -hls_playlist_type vod \
  -hls_segment_filename "/tmp/output/preview/segment_%03d.ts" \
  "/tmp/output/preview/preview.m3u8"
```

### 2.4 Thumbnail Extraction

```bash
# Extract frame at 10% of duration (e.g., 12s for 2-minute video)
ffmpeg -ss 12 -i /tmp/input.mp4 \
  -vframes 1 \
  -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" \
  -q:v 2 \
  "/tmp/thumbnail.jpg"
```

**Python Code**:
```python
def extract_thumbnail(input_path, output_path, duration_seconds):
    """Extract thumbnail at 10% mark."""
    timestamp = duration_seconds * 0.1
    cmd = [
        'ffmpeg', '-ss', str(timestamp), '-i', input_path,
        '-vframes', '1',
        '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
        '-q:v', '2',
        output_path
    ]
    subprocess.run(cmd, check=True)
```

### 2.5 Audio HLS with Loudness Normalization

**EBU R128 Loudness Normalization** (Two-Pass for accuracy):
```bash
# Pass 1: Analyze loudness
ffmpeg -i /tmp/input.wav \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json" \
  -f null - 2>&1 | grep -A 12 "input_"

# Output example:
# "input_i" : "-23.5",
# "input_tp" : "-0.8",
# "input_lra" : "7.2",
# "input_thresh" : "-33.8"

# Pass 2: Apply normalization with measured values
ffmpeg -i /tmp/input.wav \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=-23.5:measured_TP=-0.8:measured_LRA=7.2:measured_thresh=-33.8:linear=true" \
  -c:a aac -b:a 128k \
  -hls_time 6 \
  -hls_playlist_type vod \
  -hls_segment_filename "/tmp/output/128k/segment_%03d.ts" \
  "/tmp/output/128k/playlist.m3u8"
```

**Single-Pass (Simpler, slightly less accurate)**:
```bash
ffmpeg -i /tmp/input.wav \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11" \
  -c:a aac -b:a 128k \
  -hls_time 6 \
  -hls_playlist_type vod \
  -hls_segment_filename "/tmp/output/128k/segment_%03d.ts" \
  "/tmp/output/128k/playlist.m3u8"
```

**Parameters Explained**:
- `I=-16`: Target integrated loudness -16 LUFS (broadcast standard)
- `TP=-1.5`: True peak max -1.5 dBFS (headroom for DAC reconstruction)
- `LRA=11`: Loudness range 11 LU (dynamic range target)

### 2.6 FFprobe Metadata Extraction

```bash
# Get duration, width, height as JSON
ffprobe -v error \
  -select_streams v:0 \
  -show_entries stream=width,height,duration \
  -show_entries format=duration \
  -of json \
  /tmp/input.mp4
```

**Output**:
```json
{
  "streams": [{
    "width": 1920,
    "height": 1080,
    "duration": "120.5"
  }],
  "format": {
    "duration": "120.5"
  }
}
```

**Python Code**:
```python
def probe_media(input_path):
    """Get media metadata using ffprobe."""
    cmd = [
        'ffprobe', '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,duration',
        '-show_entries', 'format=duration',
        '-of', 'json',
        input_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    data = json.loads(result.stdout)

    stream = data.get('streams', [{}])[0]
    format_data = data.get('format', {})

    return {
        'width': stream.get('width'),
        'height': stream.get('height'),
        'duration': float(stream.get('duration') or format_data.get('duration', 0))
    }
```

---

## Part 3: Audiowaveform Technical Reference

### 3.1 Waveform JSON Generation

```bash
# Generate JSON waveform (10 points/sec, 8-bit)
audiowaveform -i /tmp/input.wav \
  -o /tmp/waveform.json \
  --pixels-per-second 10 \
  --bits 8
```

**Output Format**:
```json
{
  "version": 2,
  "channels": 2,
  "sample_rate": 48000,
  "samples_per_pixel": 4800,
  "bits": 8,
  "length": 1200,
  "data": [-65, 63, -66, 64, -40, 41, ...]
}
```

**Parameters**:
- `--pixels-per-second 10`: 10 data points per second of audio
- `--bits 8`: 8-bit amplitude values (-128 to 127)
- For 2-minute audio: 120 seconds × 10 = 1200 data points

### 3.2 Waveform Image Generation

```bash
# Generate PNG waveform image (1280x720)
audiowaveform -i /tmp/input.wav \
  -o /tmp/waveform.png \
  --width 1280 \
  --height 720 \
  --colors audacity \
  --waveform-style bars \
  --bar-width 3 \
  --bar-gap 1
```

**Style Options**:
- `--colors audacity`: Blue/gray color scheme
- `--waveform-style bars`: Bar visualization (vs `line`)
- `--bar-width 3`: 3-pixel wide bars
- `--bar-gap 1`: 1-pixel gap between bars

---

## Part 4: RunPod Worker Implementation

### 4.1 Complete Python Handler

```python
#!/usr/bin/env python3
"""
RunPod serverless handler for Codex media transcoding.
Processes video/audio files into HLS format with previews and waveforms.
"""

import os
import sys
import json
import hmac
import hashlib
import tempfile
import subprocess
import shutil
from pathlib import Path
from typing import Dict, Any, Optional, List

import runpod
import boto3
import requests

# ============================================================================
# Configuration
# ============================================================================

class Config:
    """Transcoding configuration constants."""

    # HLS Settings
    HLS_SEGMENT_DURATION = 6  # seconds
    HLS_PLAYLIST_TYPE = 'vod'

    # Video Variants (skip if source is lower resolution)
    VIDEO_VARIANTS = [
        {'name': '1080p', 'width': 1920, 'height': 1080, 'bitrate': '5000k', 'maxrate': '6000k'},
        {'name': '720p', 'width': 1280, 'height': 720, 'bitrate': '2500k', 'maxrate': '3000k'},
        {'name': '480p', 'width': 854, 'height': 480, 'bitrate': '1000k', 'maxrate': '1200k'},
        {'name': '360p', 'width': 640, 'height': 360, 'bitrate': '500k', 'maxrate': '600k'},
    ]

    # Audio Variants
    AUDIO_VARIANTS = [
        {'name': '128k', 'bitrate': '128k'},
        {'name': '64k', 'bitrate': '64k'},
    ]

    # Preview Settings
    PREVIEW_DURATION = 30  # seconds
    PREVIEW_VARIANT = '720p'

    # Thumbnail Settings
    THUMBNAIL_POSITION = 0.1  # 10% of duration
    THUMBNAIL_WIDTH = 1280
    THUMBNAIL_HEIGHT = 720

    # Waveform Settings
    WAVEFORM_PIXELS_PER_SECOND = 10
    WAVEFORM_BITS = 8
    WAVEFORM_IMAGE_WIDTH = 1280
    WAVEFORM_IMAGE_HEIGHT = 720

    # Loudness Normalization (EBU R128)
    LOUDNORM_I = -16  # Integrated loudness target (LUFS)
    LOUDNORM_TP = -1.5  # True peak max (dBFS)
    LOUDNORM_LRA = 11  # Loudness range (LU)


# ============================================================================
# R2 Storage Client
# ============================================================================

class R2Client:
    """S3-compatible client for Cloudflare R2."""

    def __init__(self):
        self.account_id = os.environ.get('R2_ACCOUNT_ID')
        self.access_key = os.environ.get('R2_ACCESS_KEY_ID')
        self.secret_key = os.environ.get('R2_SECRET_ACCESS_KEY')

        if not all([self.account_id, self.access_key, self.secret_key]):
            raise ValueError("R2 credentials not configured in environment")

        self.endpoint = f"https://{self.account_id}.r2.cloudflarestorage.com"
        self.client = boto3.client(
            's3',
            endpoint_url=self.endpoint,
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            region_name='auto'
        )

    def download(self, bucket: str, key: str, local_path: str):
        """Download file from R2 to local path."""
        print(f"Downloading s3://{bucket}/{key} to {local_path}")
        self.client.download_file(bucket, key, local_path)

    def upload(self, local_path: str, bucket: str, key: str, content_type: str = None):
        """Upload local file to R2."""
        print(f"Uploading {local_path} to s3://{bucket}/{key}")
        extra_args = {}
        if content_type:
            extra_args['ContentType'] = content_type
        self.client.upload_file(local_path, bucket, key, ExtraArgs=extra_args or None)

    def sync_directory(self, local_dir: str, bucket: str, prefix: str):
        """Sync local directory to R2 prefix."""
        local_path = Path(local_dir)
        for file_path in local_path.rglob('*'):
            if file_path.is_file():
                relative = file_path.relative_to(local_path)
                key = f"{prefix}{relative}"
                content_type = self._guess_content_type(str(file_path))
                self.upload(str(file_path), bucket, key, content_type)

    def _guess_content_type(self, path: str) -> str:
        """Guess content type from file extension."""
        ext = Path(path).suffix.lower()
        return {
            '.m3u8': 'application/vnd.apple.mpegurl',
            '.ts': 'video/mp2t',
            '.mp4': 'video/mp4',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.json': 'application/json',
        }.get(ext, 'application/octet-stream')


# ============================================================================
# Backblaze B2 Storage Client (Archival)
# ============================================================================

class B2Client:
    """S3-compatible client for Backblaze B2 archival storage."""

    def __init__(self):
        self.key_id = os.environ.get('B2_KEY_ID')
        self.app_key = os.environ.get('B2_APPLICATION_KEY')
        self.bucket_name = os.environ.get('B2_BUCKET_NAME')
        self.endpoint = os.environ.get('B2_ENDPOINT')
        self.region = os.environ.get('B2_REGION', 'us-west-004')

        if not all([self.key_id, self.app_key, self.bucket_name, self.endpoint]):
            raise ValueError("B2 credentials not configured in environment")

        self.client = boto3.client(
            's3',
            endpoint_url=self.endpoint,
            aws_access_key_id=self.key_id,
            aws_secret_access_key=self.app_key,
            region_name=self.region
        )

    def download(self, key: str, local_path: str):
        """Download file from B2 to local path."""
        print(f"Downloading b2://{self.bucket_name}/{key} to {local_path}")
        self.client.download_file(self.bucket_name, key, local_path)

    def upload(self, local_path: str, key: str, content_type: str = None):
        """Upload local file to B2."""
        print(f"Uploading {local_path} to b2://{self.bucket_name}/{key}")
        extra_args = {}
        if content_type:
            extra_args['ContentType'] = content_type
        self.client.upload_file(local_path, self.bucket_name, key, ExtraArgs=extra_args or None)

    def delete(self, key: str):
        """Delete file from B2."""
        print(f"Deleting b2://{self.bucket_name}/{key}")
        self.client.delete_object(Bucket=self.bucket_name, Key=key)


# ============================================================================
# Mezzanine Creation (High-Quality Intermediate)
# ============================================================================

def create_mezzanine(input_path: str, output_path: str) -> dict:
    """
    Create high-quality mezzanine from original.
    Uses H.264 CRF 18 (not ProRes - too large for cloud storage).

    Returns metadata about the mezzanine file.
    """
    cmd = [
        'ffmpeg', '-y', '-i', input_path,
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',  # High quality
        '-c:a', 'aac', '-b:a', '320k',                        # High-quality audio
        '-movflags', '+faststart',                            # Web optimization
        output_path
    ]
    run_command(cmd, "Create mezzanine")

    # Get mezzanine file size for logging
    mezzanine_size = os.path.getsize(output_path)
    print(f"Mezzanine created: {mezzanine_size / (1024*1024):.1f} MB")

    return {'path': output_path, 'size': mezzanine_size}


# ============================================================================
# Two-Pass Loudness Normalization
# ============================================================================

def analyze_loudness(input_path: str) -> dict:
    """
    Analyze audio loudness using ffmpeg loudnorm filter (first pass).
    Returns measured loudness values for second pass.
    """
    cmd = [
        'ffmpeg', '-i', input_path,
        '-af', f'loudnorm=I={Config.LOUDNORM_I}:TP={Config.LOUDNORM_TP}:LRA={Config.LOUDNORM_LRA}:print_format=json',
        '-f', 'null', '-'
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)

    # Parse loudnorm JSON output from stderr
    stderr = result.stderr
    json_start = stderr.rfind('{')
    json_end = stderr.rfind('}') + 1

    if json_start == -1 or json_end == 0:
        raise RuntimeError("Failed to parse loudnorm analysis output")

    loudnorm_json = json.loads(stderr[json_start:json_end])

    return {
        'input_i': float(loudnorm_json.get('input_i', -23)),
        'input_tp': float(loudnorm_json.get('input_tp', -1)),
        'input_lra': float(loudnorm_json.get('input_lra', 7)),
        'input_thresh': float(loudnorm_json.get('input_thresh', -33)),
    }


def normalize_with_measurements(input_path: str, output_path: str) -> dict:
    """
    Two-pass loudness normalization with measurements.
    Returns measured loudness values for database storage.
    """
    # Pass 1: Analyze
    analysis = analyze_loudness(input_path)
    print(f"Loudness analysis: I={analysis['input_i']:.1f} LUFS, TP={analysis['input_tp']:.1f} dBFS, LRA={analysis['input_lra']:.1f} LU")

    # Pass 2: Normalize using measured values
    loudnorm_filter = (
        f"loudnorm=I={Config.LOUDNORM_I}:TP={Config.LOUDNORM_TP}:LRA={Config.LOUDNORM_LRA}:"
        f"measured_I={analysis['input_i']}:measured_TP={analysis['input_tp']}:"
        f"measured_LRA={analysis['input_lra']}:measured_thresh={analysis['input_thresh']}:linear=true"
    )

    cmd = [
        'ffmpeg', '-y', '-i', input_path,
        '-af', loudnorm_filter,
        '-c:a', 'aac', '-b:a', '320k',
        output_path
    ]
    run_command(cmd, "Two-pass loudness normalization")

    # Return measurements for database (×100 for integer precision)
    return {
        'integrated': int(analysis['input_i'] * 100),   # e.g., -1600 for -16 LUFS
        'peak': int(analysis['input_tp'] * 100),        # e.g., -150 for -1.5 dBFS
        'range': int(analysis['input_lra'] * 100),      # e.g., 720 for 7.2 LU
    }


# ============================================================================
# Media Processing Utilities
# ============================================================================

def run_command(cmd: List[str], description: str = ""):
    """Run shell command and check for errors."""
    print(f"Running: {description or ' '.join(cmd[:3])}...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Command failed: {result.stderr}")
    return result.stdout


def probe_media(input_path: str) -> Dict[str, Any]:
    """Extract media metadata using ffprobe."""
    cmd = [
        'ffprobe', '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,duration,codec_name',
        '-show_entries', 'format=duration',
        '-of', 'json',
        input_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    data = json.loads(result.stdout)

    streams = data.get('streams', [])
    format_data = data.get('format', {})

    video_stream = streams[0] if streams else {}
    duration = float(video_stream.get('duration') or format_data.get('duration', 0))

    return {
        'width': video_stream.get('width'),
        'height': video_stream.get('height'),
        'duration': duration,
        'codec': video_stream.get('codec_name'),
        'has_video': bool(video_stream.get('width')),
    }


def check_nvenc_available() -> bool:
    """Check if NVIDIA NVENC is available."""
    try:
        result = subprocess.run(
            ['ffmpeg', '-hide_banner', '-encoders'],
            capture_output=True, text=True
        )
        return 'h264_nvenc' in result.stdout
    except Exception:
        return False


def get_applicable_variants(source_height: int) -> List[Dict]:
    """Get video variants that don't exceed source resolution."""
    return [v for v in Config.VIDEO_VARIANTS if v['height'] <= source_height]


# ============================================================================
# Video Transcoding Pipeline
# ============================================================================

def transcode_video(
    input_path: str,
    output_dir: str,
    metadata: Dict[str, Any],
    use_gpu: bool = True
) -> Dict[str, str]:
    """
    Transcode video to multi-quality HLS with preview and thumbnail.

    Returns dict with output keys:
    - hlsMasterPlaylistKey
    - hlsPreviewKey
    - thumbnailKey
    - durationSeconds, width, height
    """
    source_height = metadata.get('height', 1080)
    duration = metadata.get('duration', 0)
    variants = get_applicable_variants(source_height)

    if not variants:
        variants = [Config.VIDEO_VARIANTS[-1]]  # At minimum, use 360p

    hls_dir = Path(output_dir) / 'hls'
    preview_dir = Path(output_dir) / 'preview'
    hls_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)

    # Determine encoder settings
    if use_gpu and check_nvenc_available():
        encoder = 'h264_nvenc'
        encoder_opts = ['-preset', 'p4', '-cq', '23']
        hwaccel = ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda']
    else:
        encoder = 'libx264'
        encoder_opts = ['-preset', 'fast', '-crf', '23']
        hwaccel = []
        print("NVENC not available, using CPU encoding")

    # Transcode each variant
    for variant in variants:
        variant_dir = hls_dir / variant['name']
        variant_dir.mkdir(parents=True, exist_ok=True)

        cmd = [
            'ffmpeg', '-y',
            *hwaccel,
            '-i', input_path,
            '-vf', f"scale={variant['width']}:{variant['height']}",
            '-c:v', encoder,
            *encoder_opts,
            '-b:v', variant['bitrate'],
            '-maxrate', variant['maxrate'],
            '-bufsize', str(int(variant['bitrate'].replace('k', '')) * 2) + 'k',
            '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
            '-flags', '+cgop', '-g', '48',
            '-hls_time', str(Config.HLS_SEGMENT_DURATION),
            '-hls_playlist_type', Config.HLS_PLAYLIST_TYPE,
            '-hls_segment_filename', str(variant_dir / 'segment_%03d.ts'),
            str(variant_dir / 'playlist.m3u8')
        ]
        run_command(cmd, f"Transcode {variant['name']}")

    # Generate master playlist
    master_lines = ['#EXTM3U', '#EXT-X-VERSION:3']
    for variant in variants:
        bandwidth = int(variant['bitrate'].replace('k', '')) * 1000
        master_lines.append(
            f"#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},"
            f"RESOLUTION={variant['width']}x{variant['height']}"
        )
        master_lines.append(f"{variant['name']}/playlist.m3u8")

    master_path = hls_dir / 'master.m3u8'
    master_path.write_text('\n'.join(master_lines))

    # Generate preview (first 30 seconds at 720p)
    preview_duration = min(Config.PREVIEW_DURATION, duration)
    preview_variant = next(
        (v for v in Config.VIDEO_VARIANTS if v['name'] == Config.PREVIEW_VARIANT),
        variants[0]
    )

    preview_cmd = [
        'ffmpeg', '-y',
        *hwaccel,
        '-i', input_path,
        '-t', str(preview_duration),
        '-vf', f"scale={preview_variant['width']}:{preview_variant['height']}",
        '-c:v', encoder,
        *encoder_opts,
        '-b:v', preview_variant['bitrate'],
        '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
        '-flags', '+cgop', '-g', '48',
        '-hls_time', str(Config.HLS_SEGMENT_DURATION),
        '-hls_playlist_type', Config.HLS_PLAYLIST_TYPE,
        '-hls_segment_filename', str(preview_dir / 'segment_%03d.ts'),
        str(preview_dir / 'preview.m3u8')
    ]
    run_command(preview_cmd, "Generate preview")

    # Extract thumbnail at 10% mark
    thumbnail_path = Path(output_dir) / 'thumbnail.jpg'
    thumbnail_time = min(duration * Config.THUMBNAIL_POSITION, duration - 1)
    thumbnail_time = max(0, thumbnail_time)

    thumb_cmd = [
        'ffmpeg', '-y',
        '-ss', str(thumbnail_time),
        '-i', input_path,
        '-vframes', '1',
        '-vf', f'scale={Config.THUMBNAIL_WIDTH}:{Config.THUMBNAIL_HEIGHT}:'
               f'force_original_aspect_ratio=decrease,'
               f'pad={Config.THUMBNAIL_WIDTH}:{Config.THUMBNAIL_HEIGHT}:(ow-iw)/2:(oh-ih)/2',
        '-q:v', '2',
        str(thumbnail_path)
    ]
    run_command(thumb_cmd, "Extract thumbnail")

    return {
        'hls_dir': str(hls_dir),
        'preview_dir': str(preview_dir),
        'thumbnail_path': str(thumbnail_path),
        'duration': int(duration),
        'width': metadata.get('width'),
        'height': metadata.get('height'),
        'variants': [v['name'] for v in variants],
    }


# ============================================================================
# Audio Transcoding Pipeline
# ============================================================================

def transcode_audio(
    input_path: str,
    output_dir: str,
    metadata: Dict[str, Any]
) -> Dict[str, str]:
    """
    Transcode audio to HLS with loudness normalization and waveform.

    Returns dict with output keys:
    - hlsMasterPlaylistKey
    - waveformKey
    - waveformImageKey
    - durationSeconds
    """
    duration = metadata.get('duration', 0)

    hls_dir = Path(output_dir) / 'hls-audio'
    hls_dir.mkdir(parents=True, exist_ok=True)

    # Loudness normalization (single-pass for simplicity)
    loudnorm_filter = (
        f"loudnorm=I={Config.LOUDNORM_I}:"
        f"TP={Config.LOUDNORM_TP}:"
        f"LRA={Config.LOUDNORM_LRA}"
    )

    # Transcode each audio variant
    for variant in Config.AUDIO_VARIANTS:
        variant_dir = hls_dir / variant['name']
        variant_dir.mkdir(parents=True, exist_ok=True)

        cmd = [
            'ffmpeg', '-y',
            '-i', input_path,
            '-af', loudnorm_filter,
            '-c:a', 'aac', '-b:a', variant['bitrate'], '-ar', '48000',
            '-hls_time', str(Config.HLS_SEGMENT_DURATION),
            '-hls_playlist_type', Config.HLS_PLAYLIST_TYPE,
            '-hls_segment_filename', str(variant_dir / 'segment_%03d.ts'),
            str(variant_dir / 'playlist.m3u8')
        ]
        run_command(cmd, f"Transcode audio {variant['name']}")

    # Generate master playlist
    master_lines = ['#EXTM3U', '#EXT-X-VERSION:3']
    for variant in Config.AUDIO_VARIANTS:
        bandwidth = int(variant['bitrate'].replace('k', '')) * 1000
        master_lines.append(f"#EXT-X-STREAM-INF:BANDWIDTH={bandwidth}")
        master_lines.append(f"{variant['name']}/playlist.m3u8")

    master_path = hls_dir / 'master.m3u8'
    master_path.write_text('\n'.join(master_lines))

    # Generate waveform JSON
    waveform_json_path = Path(output_dir) / 'waveform.json'
    waveform_cmd = [
        'audiowaveform',
        '-i', input_path,
        '-o', str(waveform_json_path),
        '--pixels-per-second', str(Config.WAVEFORM_PIXELS_PER_SECOND),
        '--bits', str(Config.WAVEFORM_BITS)
    ]
    run_command(waveform_cmd, "Generate waveform JSON")

    # Generate waveform image
    waveform_png_path = Path(output_dir) / 'waveform.png'
    waveform_img_cmd = [
        'audiowaveform',
        '-i', input_path,
        '-o', str(waveform_png_path),
        '--width', str(Config.WAVEFORM_IMAGE_WIDTH),
        '--height', str(Config.WAVEFORM_IMAGE_HEIGHT),
        '--colors', 'audacity',
        '--waveform-style', 'bars',
        '--bar-width', '3',
        '--bar-gap', '1'
    ]
    run_command(waveform_img_cmd, "Generate waveform image")

    return {
        'hls_dir': str(hls_dir),
        'waveform_json_path': str(waveform_json_path),
        'waveform_png_path': str(waveform_png_path),
        'duration': int(duration),
    }


# ============================================================================
# Webhook Signing
# ============================================================================

def sign_webhook_payload(payload: Dict, secret: str) -> str:
    """Generate HMAC-SHA256 signature for webhook payload."""
    payload_json = json.dumps(payload, separators=(',', ':'))
    signature = hmac.new(
        secret.encode('utf-8'),
        payload_json.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    return signature


def send_webhook(url: str, secret: str, payload: Dict) -> bool:
    """Send signed webhook to media-api."""
    signature = sign_webhook_payload(payload, secret)
    headers = {
        'Content-Type': 'application/json',
        'X-RunPod-Signature': signature
    }

    try:
        response = requests.post(
            url,
            json=payload,
            headers=headers,
            timeout=30
        )
        print(f"Webhook response: {response.status_code}")
        return response.status_code == 200
    except Exception as e:
        print(f"Webhook failed: {e}")
        return False


# ============================================================================
# Main Handler
# ============================================================================

def handler(job: Dict[str, Any]) -> Dict[str, Any]:
    """
    RunPod serverless handler for media transcoding.

    Receives job input with media details, transcodes to HLS,
    uploads to R2, and sends webhook notification.
    """
    job_id = job.get('id', 'unknown')
    job_input = job.get('input', {})

    # Validate required fields
    required_fields = [
        'mediaId', 'creatorId', 'mediaType',
        'inputBucket', 'inputKey',
        'outputBucket', 'outputPrefix', 'assetsBucket',
        'webhookUrl', 'webhookSecret'
    ]

    missing = [f for f in required_fields if f not in job_input]
    if missing:
        return {'error': f"Missing required fields: {missing}"}

    media_id = job_input['mediaId']
    creator_id = job_input['creatorId']
    media_type = job_input['mediaType']

    if media_type not in ('video', 'audio'):
        return {'error': f"Invalid mediaType: {media_type}"}

    # Validate creator prefix in keys
    if not job_input['inputKey'].startswith(f"{creator_id}/"):
        return {'error': "Input key must start with creatorId prefix"}

    print(f"Processing {media_type} job {job_id} for media {media_id}")

    # Create temp workspace
    work_dir = tempfile.mkdtemp(prefix=f"transcode_{media_id}_")

    try:
        # Initialize R2 client
        r2 = R2Client()

        # Download input file
        input_ext = Path(job_input['inputKey']).suffix
        input_path = os.path.join(work_dir, f"input{input_ext}")
        r2.download(job_input['inputBucket'], job_input['inputKey'], input_path)

        # Probe media metadata
        metadata = probe_media(input_path)
        print(f"Media metadata: {metadata}")

        # Initialize B2 client for archival storage
        b2 = B2Client()

        # Step 1: Create mezzanine (high-quality intermediate)
        mezzanine_path = os.path.join(work_dir, 'mezzanine.mp4')
        mezzanine_result = create_mezzanine(input_path, mezzanine_path)

        # Step 2: Upload mezzanine to B2 archival storage
        mezzanine_key = f"mezzanine/{creator_id}/{media_id}/mezzanine.mp4"
        b2.upload(mezzanine_path, mezzanine_key, 'video/mp4')

        # Step 3: Measure loudness (two-pass analysis)
        loudness = analyze_loudness(mezzanine_path)
        loudness_output = {
            'integrated': int(loudness['input_i'] * 100),
            'peak': int(loudness['input_tp'] * 100),
            'range': int(loudness['input_lra'] * 100),
        }

        # Process based on media type
        if media_type == 'video':
            result = transcode_video(mezzanine_path, work_dir, metadata)

            # Upload HLS files
            r2.sync_directory(
                result['hls_dir'],
                job_input['outputBucket'],
                job_input['outputPrefix']
            )

            # Upload preview
            preview_prefix = job_input['outputPrefix'] + 'preview/'
            r2.sync_directory(
                result['preview_dir'],
                job_input['outputBucket'],
                preview_prefix
            )

            # Upload thumbnail
            thumbnail_key = f"{creator_id}/thumbnails/media/{media_id}/auto-generated.jpg"
            r2.upload(
                result['thumbnail_path'],
                job_input['assetsBucket'],
                thumbnail_key,
                'image/jpeg'
            )

            output = {
                'mediaId': media_id,
                'mediaType': 'video',
                'hlsMasterPlaylistKey': job_input['outputPrefix'] + 'master.m3u8',
                'hlsPreviewKey': preview_prefix + 'preview.m3u8',
                'thumbnailKey': thumbnail_key,
                'mezzanineKey': mezzanine_key,
                'durationSeconds': result['duration'],
                'width': result['width'],
                'height': result['height'],
                'readyVariants': result['variants'] + ['preview'],
                'loudness': loudness_output,
            }

        else:  # audio
            result = transcode_audio(mezzanine_path, work_dir, metadata)

            # Upload HLS audio files
            audio_prefix = f"{creator_id}/hls-audio/{media_id}/"
            r2.sync_directory(
                result['hls_dir'],
                job_input['outputBucket'],
                audio_prefix
            )

            # Upload waveform JSON
            waveform_key = f"{creator_id}/waveforms/{media_id}/waveform.json"
            r2.upload(
                result['waveform_json_path'],
                job_input['assetsBucket'],
                waveform_key,
                'application/json'
            )

            # Upload waveform image
            waveform_image_key = f"{creator_id}/thumbnails/media/{media_id}/waveform.png"
            r2.upload(
                result['waveform_png_path'],
                job_input['assetsBucket'],
                waveform_image_key,
                'image/png'
            )

            output = {
                'mediaId': media_id,
                'mediaType': 'audio',
                'hlsMasterPlaylistKey': audio_prefix + 'master.m3u8',
                'waveformKey': waveform_key,
                'waveformImageKey': waveform_image_key,
                'mezzanineKey': mezzanine_key,
                'durationSeconds': result['duration'],
                'readyVariants': ['128k', '64k'],
                'loudness': loudness_output,
            }

        # Send success webhook
        webhook_payload = {
            'id': job_id,
            'status': 'COMPLETED',
            'output': output,
        }
        send_webhook(
            job_input['webhookUrl'],
            job_input['webhookSecret'],
            webhook_payload
        )

        return output

    except Exception as e:
        error_msg = str(e)
        print(f"Transcoding failed: {error_msg}")

        # Send failure webhook
        webhook_payload = {
            'id': job_id,
            'status': 'FAILED',
            'output': {
                'mediaId': media_id,
                'mediaType': media_type,
            },
            'error': error_msg,
        }
        send_webhook(
            job_input['webhookUrl'],
            job_input['webhookSecret'],
            webhook_payload
        )

        return {'error': error_msg}

    finally:
        # Cleanup temp workspace
        shutil.rmtree(work_dir, ignore_errors=True)


# RunPod serverless entry point
if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
```

### 4.2 Dockerfile

```dockerfile
FROM nvidia/cuda:12.1.0-base-ubuntu22.04

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    wget \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install audiowaveform from source (not in apt)
RUN apt-get update && apt-get install -y \
    cmake \
    libsndfile1-dev \
    libgd-dev \
    libboost-filesystem-dev \
    libboost-program-options-dev \
    libboost-regex-dev \
    libmad0-dev \
    libid3tag0-dev \
    && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/bbc/audiowaveform.git /tmp/audiowaveform \
    && cd /tmp/audiowaveform \
    && mkdir build && cd build \
    && cmake .. \
    && make \
    && make install \
    && rm -rf /tmp/audiowaveform

# Install Python dependencies
COPY requirements.txt /requirements.txt
RUN pip3 install --no-cache-dir -r /requirements.txt

# Copy handler
COPY handler/ /handler/
WORKDIR /handler

# Verify tools are available
RUN ffmpeg -version && ffprobe -version && audiowaveform --version

# RunPod entry point
CMD ["python3", "main.py"]
```

### 4.3 requirements.txt

```
runpod>=1.6.0
boto3>=1.28.0
requests>=2.31.0
```

---

## Part 5: Cloudflare Worker Implementation

### 5.1 Package Structure (@codex/transcoding)

```
packages/transcoding/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── CLAUDE.md
└── src/
    ├── index.ts           # Public exports
    ├── types.ts           # Type definitions
    ├── errors.ts          # Transcoding-specific errors
    ├── paths.ts           # R2 key generation (single source of truth)
    ├── services/
    │   └── transcoding-service.ts
    └── __tests__/
        ├── transcoding-service.test.ts
        └── paths.test.ts
```

### 5.2 paths.ts (Single Source of Truth)

```typescript
/**
 * Storage path generation utilities.
 * This is the ONLY place storage keys should be constructed.
 * Supports both R2 (delivery) and B2 (archival) buckets.
 */

// =============================================================================
// R2 Media Bucket (codex-media-{env}) - Delivery
// =============================================================================
export const mediaBucketPaths = {
  /** Video HLS master playlist */
  hlsMaster: (creatorId: string, mediaId: string) =>
    `${creatorId}/hls/${mediaId}/master.m3u8`,

  /** Video HLS output prefix (for sync) */
  hlsPrefix: (creatorId: string, mediaId: string) =>
    `${creatorId}/hls/${mediaId}/`,

  /** Video preview HLS */
  hlsPreview: (creatorId: string, mediaId: string) =>
    `${creatorId}/hls/${mediaId}/preview/preview.m3u8`,

  /** Audio HLS master playlist */
  hlsAudioMaster: (creatorId: string, mediaId: string) =>
    `${creatorId}/hls-audio/${mediaId}/master.m3u8`,

  /** Audio HLS output prefix (for sync) */
  hlsAudioPrefix: (creatorId: string, mediaId: string) =>
    `${creatorId}/hls-audio/${mediaId}/`,
};

// =============================================================================
// R2 Assets Bucket (codex-assets-{env}) - Public Assets
// =============================================================================
export const assetsBucketPaths = {
  /** Video auto-generated thumbnail */
  thumbnail: (creatorId: string, mediaId: string) =>
    `${creatorId}/thumbnails/media/${mediaId}/auto-generated.jpg`,

  /** Audio waveform JSON data */
  waveformJson: (creatorId: string, mediaId: string) =>
    `${creatorId}/waveforms/${mediaId}/waveform.json`,

  /** Audio waveform PNG image */
  waveformImage: (creatorId: string, mediaId: string) =>
    `${creatorId}/thumbnails/media/${mediaId}/waveform.png`,
};

// =============================================================================
// Backblaze B2 Archive Bucket (codex-archive) - Archival
// =============================================================================
export const archiveBucketPaths = {
  /** Raw uploaded file (temporary - deleted after mezzanine verified) */
  original: (creatorId: string, mediaId: string, ext: string) =>
    `originals/${creatorId}/${mediaId}/original.${ext}`,

  /** High-quality mezzanine intermediate (permanent - for re-encoding) */
  mezzanine: (creatorId: string, mediaId: string) =>
    `mezzanine/${creatorId}/${mediaId}/mezzanine.mp4`,
};

// =============================================================================
// Validation Helpers
// =============================================================================
/** Validate that a key starts with the expected creator prefix */
export function validateCreatorPrefix(key: string, creatorId: string): boolean {
  return key.startsWith(`${creatorId}/`);
}

/** Validate archive paths (different prefix structure) */
export function validateArchivePrefix(key: string, creatorId: string): boolean {
  return key.includes(`/${creatorId}/`);
}
```

### 5.3 TranscodingService

```typescript
import { BaseService, NotFoundError, ValidationError, InternalServiceError } from '@codex/service-errors';
import { eq, and } from 'drizzle-orm';
import { mediaItems } from '@codex/database/schema';
import { mediaBucketPaths, assetsBucketPaths } from '../paths';
import type { ServiceConfig } from '@codex/service-errors';
import type { RunPodWebhookPayload, TranscodingJobPayload } from '../types';

interface TranscodingServiceConfig extends ServiceConfig {
  runpodApiKey: string;
  runpodEndpointId: string;
  webhookBaseUrl: string;
  webhookSecret: string;
  mediaBucket: string;
  assetsBucket: string;
}

export class TranscodingService extends BaseService {
  private config: TranscodingServiceConfig;

  constructor(config: TranscodingServiceConfig) {
    super(config);
    this.config = config;
  }

  /**
   * Trigger transcoding job for a media item.
   * Called by content-api after upload completion.
   */
  async triggerJob(mediaId: string, creatorId: string): Promise<void> {
    // Load media item
    const media = await this.db.query.mediaItems.findFirst({
      where: and(
        eq(mediaItems.id, mediaId),
        eq(mediaItems.creatorId, creatorId),
        eq(mediaItems.status, 'uploaded')
      ),
    });

    if (!media) {
      throw new NotFoundError('Media not found or not ready for transcoding');
    }

    if (!media.r2Key) {
      throw new ValidationError('Media has no uploaded file');
    }

    // Determine output prefix based on media type
    const outputPrefix = media.mediaType === 'video'
      ? mediaBucketPaths.hlsPrefix(creatorId, mediaId)
      : mediaBucketPaths.hlsAudioPrefix(creatorId, mediaId);

    // Build RunPod payload
    const payload: TranscodingJobPayload = {
      mediaId,
      creatorId,
      mediaType: media.mediaType,
      inputBucket: this.config.mediaBucket,
      inputKey: media.r2Key,
      outputBucket: this.config.mediaBucket,
      outputPrefix,
      assetsBucket: this.config.assetsBucket,
      webhookUrl: `${this.config.webhookBaseUrl}/api/transcoding/webhook`,
      webhookSecret: this.config.webhookSecret,
    };

    // Call RunPod API
    const response = await fetch(
      `https://api.runpod.ai/v2/${this.config.runpodEndpointId}/run`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.runpodApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: payload,
          webhook: payload.webhookUrl,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new InternalServiceError(`RunPod API error: ${error}`);
    }

    const result = await response.json();

    // Update media status
    await this.db.update(mediaItems)
      .set({
        status: 'transcoding',
        runpodJobId: result.id,
        transcodingError: null,
        updatedAt: new Date(),
      })
      .where(eq(mediaItems.id, mediaId));
  }

  /**
   * Handle webhook callback from RunPod.
   */
  async handleWebhook(payload: RunPodWebhookPayload): Promise<void> {
    const { id: jobId, status, output, error } = payload;
    const mediaId = output?.mediaId;

    if (!mediaId) {
      console.warn(`Webhook received without mediaId: ${jobId}`);
      return;
    }

    if (status === 'COMPLETED' && output) {
      await this.db.update(mediaItems)
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
        .where(eq(mediaItems.id, mediaId));
    } else {
      await this.db.update(mediaItems)
        .set({
          status: 'failed',
          transcodingError: error || 'Unknown transcoding error',
          updatedAt: new Date(),
        })
        .where(eq(mediaItems.id, mediaId));
    }
  }

  /**
   * Retry a failed transcoding job (max 1 retry).
   */
  async retryTranscoding(mediaId: string, creatorId: string): Promise<void> {
    const media = await this.db.query.mediaItems.findFirst({
      where: and(
        eq(mediaItems.id, mediaId),
        eq(mediaItems.creatorId, creatorId),
        eq(mediaItems.status, 'failed')
      ),
    });

    if (!media) {
      throw new NotFoundError('Media not found or not in failed state');
    }

    if ((media.transcodingAttempts ?? 0) >= 1) {
      throw new ValidationError('Maximum retry attempts reached (1)');
    }

    // Reset status and increment attempts
    await this.db.update(mediaItems)
      .set({
        status: 'uploaded',
        transcodingAttempts: (media.transcodingAttempts ?? 0) + 1,
        transcodingError: null,
        runpodJobId: null,
        updatedAt: new Date(),
      })
      .where(eq(mediaItems.id, mediaId));

    // Trigger new job
    await this.triggerJob(mediaId, creatorId);
  }

  /**
   * Get transcoding status for a media item.
   */
  async getTranscodingStatus(mediaId: string): Promise<{
    status: string;
    transcodingAttempts: number;
    transcodingError: string | null;
    runpodJobId: string | null;
  }> {
    const media = await this.db.query.mediaItems.findFirst({
      where: eq(mediaItems.id, mediaId),
    });

    if (!media) {
      throw new NotFoundError('Media not found');
    }

    return {
      status: media.status,
      transcodingAttempts: media.transcodingAttempts ?? 0,
      transcodingError: media.transcodingError ?? null,
      runpodJobId: media.runpodJobId ?? null,
    };
  }
}
```

### 5.4 Webhook Verification Middleware

```typescript
import { createHmac, timingSafeEqual } from 'crypto';
import type { Context, Next } from 'hono';

/**
 * Verify RunPod webhook signature.
 * Uses HMAC-SHA256 over raw JSON body.
 */
export function verifyRunPodSignature(secret: string) {
  return async (c: Context, next: Next) => {
    const signature = c.req.header('x-runpod-signature');

    if (!signature) {
      return c.json({ error: 'Missing signature' }, 401);
    }

    // Get raw body for signature verification
    const rawBody = await c.req.text();

    // Compute expected signature
    const expectedSignature = createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    // Timing-safe comparison
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (sigBuffer.length !== expectedBuffer.length ||
        !timingSafeEqual(sigBuffer, expectedBuffer)) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    // Parse body and attach to context
    c.set('webhookPayload', JSON.parse(rawBody));

    await next();
  };
}
```

---

## Part 6: Implementation Phases

### Phase 1: Database Schema & Validation

**Goal**: Extend media_items and add validation schemas

**Files to modify**:
- `packages/database/src/schema/content.ts` - Add 6 new fields
- `packages/database/src/migrations/` - Generate migration
- `packages/validation/src/content/content-schemas.ts` - Add webhook schemas
- `packages/shared-types/src/worker-types.ts` - Add RunPod bindings

**Definition of Done**:
- [ ] New fields added to media_items schema
- [ ] Migration generated and tested
- [ ] Validation schemas pass tests
- [ ] TypeScript compiles without errors

### Phase 2: @codex/transcoding Package

**Goal**: Centralized transcoding business logic

**Files to create**:
- `packages/transcoding/` - Full package structure
- `paths.ts` - R2 key generation
- `transcoding-service.ts` - Service implementation
- Unit tests for all methods

**Definition of Done**:
- [ ] Service methods tested for all state transitions
- [ ] No path strings live outside paths.ts
- [ ] 80%+ test coverage

### Phase 3: media-api Worker

**Goal**: Cloudflare Worker for transcoding orchestration

**Files to create**:
- `workers/media-api/` - Worker scaffolding
- Routes: internal trigger, webhook, retry, status
- HMAC verification middleware

**Definition of Done**:
- [ ] Worker responds to health check
- [ ] Webhook rejects invalid signatures
- [ ] Internal endpoints reject unsigned requests
- [ ] All routes have integration tests

### Phase 4: Content-API Integration

**Goal**: Auto-trigger transcoding after upload

**Files to modify**:
- `workers/content-api/src/routes/` - Add trigger call
- `workers/content-api/wrangler.jsonc` - Add MEDIA_WORKER_URL

**Definition of Done**:
- [ ] Upload completion triggers transcoding
- [ ] Media status transitions correctly
- [ ] Creators cannot set system-only status values

### Phase 5: RunPod Worker

**Goal**: Docker container for GPU transcoding

**Files to create**:
- `infrastructure/runpod/Dockerfile`
- `infrastructure/runpod/handler/main.py`
- `infrastructure/runpod/requirements.txt`
- Local test scripts

**Definition of Done**:
- [ ] Container builds and runs locally
- [ ] Video transcoding produces correct HLS
- [ ] Audio transcoding produces correct HLS + waveform
- [ ] Webhook sends correctly signed payloads

### Phase 6: CI/CD & Deployment

**Goal**: Production-ready deployment

**Files to modify**:
- `tsconfig.json` - Add @codex/transcoding
- `.github/workflows/` - Add media-api
- `.github/scripts/upload-worker-secrets.sh`

**Definition of Done**:
- [ ] CI runs tests for new packages
- [ ] Preview and production deploy work
- [ ] Secrets configured in Cloudflare

---

## Part 7: Environment Variables

### media-api Worker

```env
# Database
DATABASE_URL=postgresql://...

# R2 Storage (Delivery)
MEDIA_BUCKET=codex-media-production
ASSETS_BUCKET=codex-assets-production
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_MEDIA=codex-media-production
R2_BUCKET_ASSETS=codex-assets-production

# Backblaze B2 (Archival) - Optional for media-api, required for signed URL generation
B2_KEY_ID=your-b2-key-id
B2_APPLICATION_KEY=your-b2-app-key
B2_BUCKET_NAME=codex-archive
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com

# RunPod
RUNPOD_API_KEY=your-runpod-api-key
RUNPOD_ENDPOINT_ID=your-endpoint-id
RUNPOD_WEBHOOK_SECRET=random-secret-for-hmac

# Worker Auth
WORKER_SHARED_SECRET=shared-secret-for-internal-calls

# KV
RATE_LIMIT_KV=binding-name
```

### content-api Worker (Additions)

```env
MEDIA_WORKER_URL=https://media-api.codex.com
WORKER_SHARED_SECRET=shared-secret-for-internal-calls
```

### RunPod Endpoint Environment

```env
# R2 (Delivery - for HLS output)
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_MEDIA_BUCKET=codex-media-production
R2_ASSETS_BUCKET=codex-assets-production

# Backblaze B2 (Archival - for mezzanine storage)
B2_KEY_ID=your-b2-key-id
B2_APPLICATION_KEY=your-b2-app-key
B2_BUCKET_NAME=codex-archive
B2_ENDPOINT=https://s3.us-west-004.backblazeb2.com
B2_REGION=us-west-004
```

---

## Part 8: Testing Strategy

### Unit Tests

**TranscodingService**:
- Trigger job only when status is `uploaded`
- Reject trigger if `r2Key` missing
- Webhook success populates all expected keys
- Webhook failure sets error and `failed` status
- Retry increments attempts and resets error
- Retry fails when attempts >= 1

**paths.ts**:
- All path functions return correct format
- Creator prefix validation works

### Integration Tests

**Webhook endpoint**:
- Valid signature → 200, media updated
- Invalid signature → 401
- Missing signature → 401

**Internal trigger**:
- Signed request → triggers job
- Unsigned request → 401

### E2E Scenarios

1. **Video Upload → HLS Ready**:
   - Upload video → status = uploaded
   - Trigger transcoding → status = transcoding
   - Webhook success → status = ready, HLS keys set

2. **Audio Upload → HLS + Waveform Ready**:
   - Upload audio → status = uploaded
   - Trigger transcoding → status = transcoding
   - Webhook success → status = ready, waveform keys set

3. **Failed with Retry**:
   - Trigger → status = transcoding
   - Webhook failure → status = failed
   - Retry → status = transcoding, attempts = 1
   - Webhook success → status = ready

4. **Retry Limit**:
   - Failed with attempts = 1
   - Retry → ValidationError

---

## Part 9: Success Criteria

- [ ] Video upload → HLS ready in < 10 min for 1GB file
- [ ] Audio upload → HLS + waveform ready in < 2 min for 100MB
- [ ] 95%+ transcoding success rate
- [ ] Webhook updates media status reliably
- [ ] Manual retry works (once only)
- [ ] All R2 paths follow centralized contract
- [ ] Integration tests pass
- [ ] No secrets in logs

---

**Document Version**: 2.0
**Last Updated**: 2025-12-31
**Status**: Ready for Implementation
