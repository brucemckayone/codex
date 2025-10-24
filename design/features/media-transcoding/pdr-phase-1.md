# Media Transcoding - Phase 1 PRD

## Feature Summary

Automated media transcoding system that:

- **Videos**: Converts to HLS (HTTP Live Streaming) format with multiple quality variants
- **Audio**: Converts to HLS (HTTP Live Streaming) format and generates waveform visualizations

Transcoding happens asynchronously using Runpod GPU workers, triggered via Cloudflare Queue after upload. Outputs stored in creator-specific R2 buckets.

**Key Concept**: When creators upload video or audio, the system automatically transcodes for optimal streaming: HLS for videos (adaptive quality), HLS for audio + waveform JSON for audio.

## Problem Statement

Creators need media transcoded for optimal streaming because:

- **Videos**:
  - Raw uploads aren't streamable (single-quality MP4 doesn't support adaptive bitrate)
  - Large file sizes cause buffering on mobile/slow connections
  - No mobile optimization
- **Audio**:
  - Various formats (WAV, M4A, FLAC) need conversion to HLS for adaptive streaming.
  - No visual representation for audio playback (waveforms needed)
  - Inconsistent loudness across audio files
- **Thumbnails**: Need automated thumbnail/preview generation

Without transcoding:

- Videos buffer and play poorly on mobile
- Audio files inconsistent quality and format
- No waveform visualization for audio players
- No thumbnails for content preview
- Higher bandwidth costs

## Goals / Success Criteria

### Primary Goals

1. **Automatic Transcoding** - Media transcoded immediately after upload
2. **Video**: Multi-quality HLS output (1080p, 720p, 480p, 360p)
3. **Audio**: HLS output + waveform JSON generation
4. **Fast Processing** - 1GB video in < 10 minutes, audio in < 2 minutes
5. **Thumbnail/Waveform Generation** - Auto-generate visual previews
6. **Status Tracking** - Real-time status updates (transcoding, ready, failed)
7. **Error Handling** - Retry failed jobs once, notify creators of failures

### Success Metrics

- 1GB video transcoded in < 10 minutes (p95)
- 100MB audio transcoded + waveform in < 2 minutes (p95)
- 95% transcoding success rate
- HLS streams play smoothly on desktop, mobile, tablet
- Waveforms generated for 100% of audio files
- Thumbnails generated for 100% of videos
- Creators see accurate transcoding status in admin UI

## Scope

### In Scope (Phase 1 MVP)

#### Video Transcoding

- **Automatic Trigger**: Via Cloudflare Queue after upload
- **HLS Output**:
  - Master playlist (master.m3u8)
  - Variant playlists (1080p, 720p, 480p, 360p)
  - Video segments (.ts files, 6-second duration)
  - Adaptive bitrate streaming
- **Quality Variants**:
  - 1080p (1920x1080) @ 5 Mbps
  - 720p (1280x720) @ 2.5 Mbps
  - 480p (854x480) @ 1 Mbps
  - 360p (640x360) @ 0.5 Mbps
  - Skip variants if source is lower quality
- **Thumbnail**: Extract frame at 10% mark, save as 1280x720 JPEG
- **Codecs**: H.264 video, AAC audio

#### Audio Transcoding

- **Automatic Trigger**: Via Cloudflare Queue after upload
- **HLS Output**:
  - Master playlist (master.m3u8)
  - Variant playlists (e.g., 128kbps, 64kbps)
  - Audio segments (.ts files)
  - Adaptive bitrate streaming
- **Quality Variants**:
  - 128kbps AAC audio
  - 64kbps AAC audio
  - Loudness normalization (-16 LUFS target)
- **Waveform Generation**:
  - JSON format with amplitude data points
  - 1000 data points (10 points per second for 100-second audio)
  - Stored in R2: `codex-assets-{creatorId}/waveforms/{mediaId}/waveform.json`
  - Format: `{ "version": 2, "channels": 2, "sample_rate": 44100, "samples_per_pixel": 512, "bits": 8, "length": 1000, "data": [0.5, 0.8, ...] }`
- **Thumbnail**: Generate waveform preview image (1280x720 PNG)

#### GPU Processing

- Runpod serverless GPU workers (ffmpeg + hardware acceleration)
- Cloudflare Queue for job management
- Single retry on failure (serverless failures are deterministic)

#### Status Tracking

- Media item status: `uploaded` → `transcoding` → `ready` / `failed`
- Real-time updates in admin UI

#### Error Handling

- Retry failed jobs once (exponential backoff: 5 minutes)
- Log errors to database for debugging
- Notify creator of permanent failures

### Explicitly Out of Scope (Future Phases)

- **Custom quality settings** - Creator-defined bitrates/resolutions (Phase 2)
- **Video editing** - Trim, crop, filters (Phase 3)
- **Subtitle/caption extraction** - Phase 3
- **Multi-audio tracks** - Phase 3
- **DRM encryption** - Phase 3
- **Live streaming transcoding** - Phase 4
- **Batch transcoding** - Re-transcode existing media (Phase 2)
- **Advanced waveform analysis** - Beat detection, spectrum analysis (Phase 3)

## Cross-Feature Dependencies

See the centralized [Cross-Feature Dependencies](../../cross-feature-dependencies.md#6-media-transcoding) document for details.

---

## User Stories & Use Cases

### US-TRANSCODE-001: Automatic Video Transcoding After Upload

**As a** Creator
**I want** videos to be automatically transcoded to HLS after upload
**So that** customers can stream videos smoothly on any device

**Flow:**

1. Creator uploads video via Content Management
2. Video uploaded to `codex-media-{creatorId}/originals/{mediaId}/original.mp4`
3. Backend enqueues transcoding job:
   ```json
   {
     "mediaId": "uuid",
     "type": "video",
     "inputBucket": "codex-media-creatorId",
     "inputKey": "originals/{mediaId}/original.mp4",
     "outputBucket": "codex-media-creatorId",
     "outputPrefix": "hls/{mediaId}/",
     "assetsBucket": "codex-assets-creatorId"
   }
   ```
4. Backend updates `media_items.status = 'transcoding'`
5. Cloudflare Worker picks up job, calls Runpod API
6. Runpod transcodes video:
   - Detects source resolution (e.g., 1080p)
   - Generates HLS variants (1080p, 720p, 480p, 360p)
   - Extracts thumbnail at 10% mark
   - Uploads HLS files to `codex-media-{creatorId}/hls/{mediaId}/`
   - Uploads thumbnail to `codex-assets-{creatorId}/thumbnails/media/{mediaId}/auto-generated.jpg`
7. Runpod notifies webhook: `POST /api/transcoding/webhook`
8. Webhook updates `media_items`:
   - `status = 'ready'`
   - `hlsMasterPlaylistKey = 'hls/{mediaId}/master.m3u8'`
   - `durationSeconds`, `width`, `height`
9. Creator sees "Ready" status in media library

**Acceptance Criteria:**

- HLS variants stored in R2 with correct structure
- Thumbnail auto-generated and stored
- Video metadata extracted and saved
- Creator can create content once status = 'ready'
- Transcoding completes in < 10 minutes for 1GB video

---

### US-TRANSCODE-002: Automatic Audio Transcoding + Waveform Generation

**As a** Creator
**I want** audio files converted to HLS and waveforms generated automatically
**So that** customers have consistent audio quality, visual playback, and adaptive streaming

**Flow:**

1. Creator uploads audio file (e.g., WAV, 50MB)
2. Audio uploaded to `codex-media-{creatorId}/audio/{mediaId}/original.wav`
3. Backend enqueues transcoding job:
   ```json
   {
     "mediaId": "uuid",
     "type": "audio",
     "inputBucket": "codex-media-creatorId",
     "inputKey": "audio/{mediaId}/original.wav",
     "outputBucket": "codex-media-creatorId",
     "outputPrefix": "hls-audio/{mediaId}/",
     "assetsBucket": "codex-assets-creatorId"
   }
   ```
4. Backend updates `media_items.status = 'transcoding'`
5. Runpod transcodes audio:
   - Converts to HLS (e.g., 128kbps, 64kbps AAC audio)
   - Normalizes loudness to -16 LUFS
   - Generates waveform JSON (1000 data points)
   - Generates waveform preview image (1280x720 PNG)
   - Uploads HLS audio files to `codex-media-{creatorId}/hls-audio/{mediaId}/`
   - Uploads waveform to `codex-assets-{creatorId}/waveforms/{mediaId}/waveform.json`
   - Uploads waveform image to `codex-assets-{creatorId}/thumbnails/media/{mediaId}/waveform.png`
6. Runpod notifies webhook
7. Webhook updates `media_items`:
   - `status = 'ready'`
   - `hlsMasterPlaylistKey = 'hls-audio/{mediaId}/master.m3u8'`
   - `waveformKey = 'waveforms/{mediaId}/waveform.json'`
   - `durationSeconds` (extracted)
8. Creator sees "Ready" status with waveform preview

**Acceptance Criteria:**

- Original audio converted to HLS audio streams.
- Waveform JSON generated with 1000 data points.
- Waveform preview image generated.
- Audio duration extracted.
- Transcoding completes in < 2 minutes for 100MB audio.
- Waveform loads in audio player for customer playback.

---

### US-TRANSCODE-003: Multi-Quality Adaptive Video Streaming

**As a** Customer
**I want** videos to stream smoothly on my device
**So that** I don't experience buffering

**Flow:**

1. Customer plays video content
2. Video player requests HLS master playlist
3. Player downloads master playlist with variants:
   ```m3u8
   #EXTM3U
   #EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
   1080p/playlist.m3u8
   #EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
   720p/playlist.m3u8
   #EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480
   480p/playlist.m3u8
   #EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360
   360p/playlist.m3u8
   ```
4. Player selects quality based on network speed:
   - Fast WiFi → 1080p
   - 4G → 720p
   - 3G → 480p
   - 2G → 360p
5. Player dynamically switches quality if network changes
6. Customer experiences smooth playback

**Acceptance Criteria:**

- All quality variants available in master playlist
- Player switches qualities seamlessly
- No buffering on typical network conditions

---

### US-TRANSCODE-004: Audio Waveform Visualization

**As a** Customer
**I want** to see waveform visualization while playing HLS audio
**So that** I can see playback progress and audio intensity

**Flow:**

1. Customer plays HLS audio content
2. Frontend loads waveform JSON from R2
3. Audio player renders waveform canvas:
   - X-axis: time (1000 data points)
   - Y-axis: amplitude (0.0 to 1.0)
   - Colors: played portion (blue), unplayed (gray)
4. Customer clicks waveform to seek to specific time
5. Playback jumps to clicked position

**Acceptance Criteria:**

- Waveform loads in < 500ms
- Waveform accurately represents audio intensity
- Customer can click to seek
- Played/unplayed sections visually distinct
- Waveform responsive (scales to player width).

---

### US-TRANSCODE-005: Handle Transcoding Failures with Single Retry

**As a** Creator
**I want** to be notified quickly if transcoding fails
**So that** I can re-upload or troubleshoot without excessive delays

**Flow:**

1. Transcoding job fails (e.g., corrupted file, unsupported codec)
2. Runpod sends error webhook with `status = 'failed'`
3. Backend logs error to `transcoding_errors` table
4. If first failure (attempt 1):
   - Re-enqueue job after 5 minutes
   - Update `media_items` with retry status
5. If second failure (attempt 2):
   - Mark `media_items.status = 'failed'`
   - No further retries (serverless failure likely deterministic)
6. Creator sees "Failed" status in media library
7. Error message displayed: "Transcoding failed: Unsupported video codec"
8. Creator can:
   - Delete media item and re-upload
   - Contact support if issue persists

**Acceptance Criteria:**

- Failed jobs retried once (not 3 times)
- 5-minute delay before retry
- Permanent failure after 2nd attempt
- Creator sees error message in media library
- Errors logged to database
- No excessive retries (cost control)

---

### US-TRANSCODE-006: Skip Lower Quality Variants for Low-Res Videos

**As a** System
**I want** to skip unnecessary quality variants
**So that** processing time and storage are optimized

**Flow:**

1. Creator uploads 720p video
2. Runpod detects source resolution: 1280x720
3. System skips 1080p variant (can't upscale)
4. System generates:
   - 720p (re-encode for HLS)
   - 480p (downscale)
   - 360p (downscale)
5. HLS master playlist includes only available variants
6. Customers on fast connections get 720p (best available)

**Acceptance Criteria:**

- Source resolution detected before transcoding
- No upscaling (quality loss, wasted storage)
- At least 2 quality variants if source ≥ 480p
- Master playlist only lists available variants

---

## User Flows (Visual)

See diagrams:

- [Video Transcoding Workflow](../_assets/video-transcoding-workflow.png)
- [Audio Transcoding + Waveform](../_assets/audio-transcoding-workflow.png)
- [Queue Processing Flow](../_assets/queue-processing-flow.png)
- [Error Handling & Retries](../_assets/transcoding-error-handling.png)

---

## Dependencies

### Internal Dependencies (Phase 1)

- **Content Management**: Uploads media, enqueues transcoding
- **Content Access**: Serves HLS streams, audio files, waveforms
- **Admin Dashboard**: Displays transcoding status, waveform previews
- **Notifications**: Sends failure notifications (optional)

### External Dependencies

- **Cloudflare Queue**: Job queue for transcoding tasks
  - Queue: `TRANSCODING_QUEUE`
  - Single retry on failure
- **Cloudflare R2**: Media storage (input and output)
  - Video input: `codex-media-{creatorId}/originals/{mediaId}/`
  - Video output: `codex-media-{creatorId}/hls/{mediaId}/`
  - Audio input: `codex-media-{creatorId}/audio/{mediaId}/original.*`
  - Audio output: `codex-media-{creatorId}/audio/{mediaId}/normalized.mp3`
  - Thumbnails: `codex-assets-{creatorId}/thumbnails/media/{mediaId}/`
  - Waveforms: `codex-assets-{creatorId}/waveforms/{mediaId}/`
- **Runpod**: GPU-accelerated transcoding service
  - Serverless endpoint for ffmpeg + audiowaveform
  - Webhook callback for job completion
  - See [Runpod Integration](../../infrastructure/RunpodSetup.md)
- **Neon Postgres**: Status tracking
  - `media_items` table
  - `transcoding_errors` table

---

## Acceptance Criteria (Feature-Level)

### Functional Requirements

- Video transcoding to HLS (4 quality variants)
- Audio transcoding to HLS
- Waveform JSON generation for all audio files
- Thumbnail generation for videos (10% frame)
- Waveform preview image for audio
- Transcoding triggered automatically after upload
- Status tracked in `media_items` table
- Single retry on failure (not 3)
- Creators notified of permanent failures

### Quality Requirements

- **Video**:
  - HLS segments: 6-second duration
  - H.264 codec, AAC audio
  - Bitrates: 5/2.5/1/0.5 Mbps for 1080p/720p/480p/360p
- **Audio**:
  - HLS segments: 6-second duration
  - AAC audio
  - Bitrates: 128kbps, 64kbps
  - Loudness normalized to -16 LUFS
  - Waveform: 1000 data points, JSON format
- **Thumbnails**: 1280x720 JPEG, < 200KB
- **Waveform Images**: 1280x720 PNG, < 100KB

### Error Handling Requirements

- Corrupted files fail gracefully with clear error
- Unsupported codecs return descriptive error
- Runpod API failures trigger single retry (5 min delay)
- Permanent failure after 2 attempts (no more retries)
- All errors logged to database

### Testing Requirements

- Unit tests for queue message processing
- Integration tests for Runpod API calls
- E2E tests for video and audio transcoding flows
- Test failure scenarios and retry logic
- Test waveform generation accuracy
- Test coverage > 85% for transcoding module

---

## Related Documents

- **TDD**: [Media Transcoding Technical Design](./ttd-dphase-1.md)
- **Cross-Feature Dependencies**:
  - [Content Management PRD](../content-management/pdr-phase-1.md) - Media upload
  - [Content Access PRD](../content-access/pdr-phase-1.md) - HLS/audio delivery
  - [Admin Dashboard PRD](../admin-dashboard/pdr-phase-1.md) - Status display
- **Infrastructure**:
  - [R2 Bucket Structure](../../infrastructure/R2BucketStructure.md) - Output storage
  - [Runpod Setup](../../infrastructure/RunpodSetup.md) - GPU integration
  - [Cloudflare Queue Setup](../../infrastructure/CloudflareSetup.md) - Job queue
  - [Database Schema](../../infrastructure/DatabaseSchema.md) - Media items schema

---

## Notes

### Why Transcode Audio?

- **Format Consistency**: WAV, FLAC, M4A → HLS audio
- **Loudness Normalization**: Consistent volume across all audio files
- **Waveform Visualization**: Fun, useful playback feature
- **Adaptive Streaming**: Smooth playback over varying network conditions.
- **Quality**: Multiple bitrate options for optimal user experience.

### Quality Variant Selection Logic

```
Source Resolution | Output Variants
------------------|------------------
Audio             | 128kbps, 64kbps AAC HLS
```

### Waveform JSON Format

```json
{
  "version": 2,
  "channels": 2,
  "sample_rate": 44100,
  "samples_per_pixel": 512,
  "bits": 8,
  "length": 1000,
  "data": [0.5, 0.82, 0.61, 0.73, 0.45, ...]
}
```

- **1000 data points**: ~10 points per second for 100-second audio
- **Amplitude range**: 0.0 (silence) to 1.0 (peak)
- **Rendering**: Frontend draws canvas with data points

### Why Single Retry?

- **Serverless Determinism**: If job fails once, likely same issue on retry
- **Cost Control**: GPU time is expensive, avoid wasteful retries
- **Fast Feedback**: Creator knows quickly if file is problematic
- **Example Failures**:
  - Corrupted file → Will fail again
  - Unsupported codec → Will fail again
  - Timeout/API error → Retry might help (hence 1 retry)

### Quality Variant Selection Logic

```
Source Resolution | Output Variants
------------------|------------------
≥ 1080p          | 1080p, 720p, 480p, 360p
720p             | 720p, 480p, 360p
480p             | 480p, 360p
360p             | 360p only
< 360p           | Source only (no transcode)
```

### Transcoding Cost Estimates (Runpod)

- **1GB video (10 min 1080p)**: ~2 min GPU time = ~$0.02
- **100MB audio + waveform**: ~30 sec GPU time = ~$0.005
- **10 videos/day + 20 audio/day**: ~$0.30/day = ~$9/month
- **100 videos/day + 200 audio/day**: ~$3/day = ~$90/month
- **Single retry cost**: 2x job cost on failure (acceptable risk)

---

**Document Version**: 1.0
**Last Updated**: 2025-10-20
**Status**: Draft - Awaiting Review
