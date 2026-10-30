# RunPod Transcoding Worker

GPU-accelerated media transcoding worker for the Codex platform.

## Overview

This worker runs on RunPod's serverless GPU infrastructure to:

- Transcode video/audio to multi-quality HLS streams
- Generate archive-quality mezzanine files (stored in B2)
- Extract thumbnails, and a 30-second preview clip of every video and audio source
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

## Development

### Directory Structure

- `handler/`: Main application logic (`main.py`).
- `tests/unit/`: Pytest unit tests mocking external dependencies.
- `tests/integration/`: Scripts for internal container verification.
- `scripts/`: Deployment scripts.

### Build the Docker image

```bash
cd infrastructure/runpod
docker build -t codex-transcoder:dev .
```

### Running Tests

#### 1. Unit Tests (Fast, Local)
Runs logic tests with mocked RunPod, S3, and FFmpeg calls.

```bash
# Install test dependencies
pip install -r requirements.txt
pip install -r requirements-dev.txt

# Run tests
pytest tests/unit
```

#### 2. Container Integration Tests (Slow, Docker)
Verifies that the Docker container builds correctly and has all required system dependencies (ffmpeg, audiowaveform, python paths) by running a real CPU-based transcode inside the container.

```bash
# Build image
docker build -t test-worker:local .

# Run verification script inside container
docker run --rm \
  -v $(pwd)/tests/integration:/app/tests/integration \
  -v $(pwd)/tests/assets:/app/tests/assets \
  --entrypoint python3 \
  test-worker:local \
  tests/integration/verify_cpu_transcode.py
```

*Note: This generates a dummy video file in `tests/assets` if one doesn't exist.*

#### 3. QuickTime Sources End to End (Docker, or any ffmpeg >= 4.4)
Generates the sources Apple devices and editors hand over (HEVC 10-bit HLG,
ProRes 4:2:2, rotated portrait, 4:4:4, a no-audio screen recording, a
timecode track, a 1.2 s clip), encodes each with the handler's own functions,
and checks every output with ffprobe: H.264 High yuv420p, 48 kHz audio, rungs
sized by their short side, a truthful master playlist, posters never
upscaled. CI runs it inside the built image.

```bash
docker run --rm \
  -v $(pwd)/tests/integration:/app/tests/integration \
  --entrypoint python3 \
  test-worker:local \
  tests/integration/verify_quicktime_outputs.py
```

#### 4. Damaged Sources End to End (Docker, or any ffmpeg >= 4.4)
Makes damaged copies of a healthy source (cut short, scattered holes, a
broken audio track under a perfect picture, an undecodable picture, a lost
moov index, broken audio-only) and checks each completes, or fails with the
code in its `EXPECTED` table. Same command, with
`tests/integration/verify_damaged_sources.py`.

## CI/CD Pipeline

Two workflows share the work: the image is built where the transcoder changed,
and the endpoint is switched where production is deployed.

`runpod-ci.yml` (PRs into `dev` and `main`, pushes to `main` that touch the transcoder, and
manual runs):

1.  **Quality & Unit**: Lints (Black, Flake8), runs unit tests, and runs the image tag script.
2.  **Container Verification**: Builds the Docker image and runs the integration script.
3.  **Publish image** (`main` only, never on a PR): pushes the image it just verified to GHCR as
    `codex-transcoder:src-<hash>`, plus `sha-<commit>` and `latest` (the most recently built
    image, used only by `scripts/setup_endpoint.py`). `.github/scripts/runpod-image-tag.sh`
    names the tag from every tracked file here except tests, scripts, docs and local-dev files,
    so a new file counts until it is excluded there. A `src-` tag is written **once** (and last):
    when it already exists, nothing is pushed, so a docs-only push can never swap the image
    production runs. It holds no RunPod secret and changes nothing on RunPod.

`deploy-production.yml` (production deploys; these are its last steps, so a RunPod problem never
holds back a worker deploy):

1.  **Wait for the transcoder image**: computes the same `src-<hash>` and waits up to 20 min for
    it to appear in GHCR. An auth or invalid-reference answer fails at once; other registry
    errors are retried until the deadline. The tag may be due from an
    earlier commit (the last one that changed the inputs); if that commit's publish failed, every
    deploy goes red here until it is published: re-run that run, or run `runpod-ci.yml` on `main`.
2.  **Point RunPod at the transcoder image** (`scripts/update_runpod_endpoint.py`): does nothing
    when the template already uses it; otherwise fails unless RunPod echoes the new image.
3.  **Transcoder endpoint health** (`update_runpod_endpoint.py --health`): prints the live
    config, warns on a long `idleTimeout` or a short `executionTimeoutMs`, and goes red when the
    endpoint is paused (`workersMax=0`) or its config cannot be read after 3 tries. It checks
    configuration, not whether a worker can start.

Steps 1 and 2 run only when every earlier deploy step passed; the next green deploy catches up,
because the tag comes from the deployed commit. Step 3 runs on every deploy that is not
cancelled.

**Rolling back**: `git revert` on `main`, then deploy. The image set in the RunPod console is
not authoritative: the next production deploy replaces it, and the run's annotations show the
replacement.

### Required GitHub Secrets

On the `production` environment, beside the Cloudflare secrets (its required reviewer approves the whole deploy):

- `RUNPOD_API_KEY`: RunPod API key with write access (the deploy edits the template).
- `RUNPOD_ENDPOINT_ID`: The ID of the serverless endpoint to update.

The repo-level `RUNPOD_*` secrets are a different thing: the E2E workflows pass them to the local stack, which talks to a mock transcoder.

## FFmpeg Settings

### Video Encoding
- **GPU**: `h264_nvenc`, preset p4, cq 23
- **CPU fallback**: `libx264`, preset fast, crf 23
- **Mezzanine**: CRF 18 (archive quality)
- **Every encode**: `format=yuv420p` and `-profile:v high` (browsers play 8-bit
  4:2:0 H.264 only), audio at 48 kHz
- **HDR sources** (PQ, HLG): tone-mapped to SDR BT.709 with `zscale` +
  `tonemap` (operator `TONEMAP_OPERATOR`), after scaling to the rung's size
- **Damaged frames**: a video job decodes with `-max_error_rate 1.0`, so bad
  frames are concealed instead of failing the file; a rung with no decodable
  picture fails as `CORRUPT_INPUT`. Audio jobs keep ffmpeg's 2/3 limit
  (exit 69 → `CORRUPT_INPUT`)
- **Progress**: the ladder's encodes write `-progress` to a file; ticks go out
  about every 5 points between 17% and 72%

### HLS Variants
| Quality | Height | Video Bitrate | Audio Bitrate |
|---------|--------|---------------|---------------|
| 720p | 720 | 3000 kbps | 128 kbps |
| 480p | 480 | 1500 kbps | 96 kbps |

A source shorter than 480 lines gets one `source` rung at its own size.

## Webhook Payload

The service parses these with `runpodWebhookUnionSchema`
(`packages/validation/src/schemas/transcoding.ts`).

### Completed

```json
{
  "jobId": "runpod-job-id",
  "status": "completed",
  "creatorId": "creator-user-id",
  "output": {
    "mediaId": "uuid",
    "type": "video",
    "hlsMasterKey": "creator-id/hls/media-id/master.m3u8",
    "hlsPreviewKey": "creator-id/hls/media-id/preview/preview.m3u8",
    "thumbnailKey": "creator-id/media-thumbnails/media-id/lg.webp",
    "thumbnailVariants": { "sm": "…/sm.webp", "md": "…/md.webp", "lg": "…/lg.webp" },
    "durationSeconds": 600,
    "width": 1920,
    "height": 1080,
    "readyVariants": ["720p", "480p"],
    "loudnessIntegrated": -1400
  }
}
```

### Failed

```json
{
  "jobId": "runpod-job-id",
  "status": "failed",
  "error": "ffprobe failed (exit 1): moov atom not found…",
  "errorCode": "CORRUPT_INPUT",
  "mediaId": "uuid",
  "creatorId": "creator-user-id"
}
```

`errorCode` is one of `CORRUPT_INPUT`, `UNSUPPORTED_CODEC`,
`INVALID_DURATION`, `MISSING_STREAM`, `OUTPUT_VALIDATION_FAILED`,
`INFRA_ERROR` (the service treats anything else as `INFRA_ERROR`). `mediaId`
is `null` when the job's own value is not a UUID.

Every payload (completed, failed, progress) carries `creatorId`, so the
service can route it to the creator's live status without a database read.
It is `null` when the job's value would fail the service's `userIdSchema`
(letters and digits only).

If the completed report cannot be delivered, the handler keeps the outputs and
finishes the job COMPLETED with `{"status": "webhook_undelivered"}`; the
maintenance run then finds it via RunPod's job status.

### Progress

`{"jobId", "status": "progress", "progress": 0-100, "step", "mediaId",
"creatorId"}`, one attempt each, never retried. Every new step is sent;
within a step, no closer than 5 points apart.

### Webhook Signature

Webhooks are signed with HMAC-SHA256 over `timestamp.payload`:

```
X-Runpod-Timestamp: <unix seconds>
X-Runpod-Signature: hmac_sha256(f"{timestamp}.{payload}", WEBHOOK_SECRET)
```

### Keep-alive ping

`{"input": {"ping": true}}` is answered `{"status": "pong"}` before anything
else is read; it only resets RunPod's idle clock.
