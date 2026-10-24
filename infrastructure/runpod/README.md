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

### HLS Variants
| Quality | Resolution | Video Bitrate | Audio Bitrate |
|---------|------------|---------------|---------------|
| 1080p | 1920x1080 | 5000 kbps | 192 kbps |
| 720p | 1280x720 | 3000 kbps | 128 kbps |
| 480p | 854x480 | 1500 kbps | 96 kbps |
| 360p | 640x360 | 800 kbps | 64 kbps |

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
  "readyVariants": ["1080p", "720p", "480p", "360p"],
  "error": null
}
```

### Webhook Signature

Webhooks are signed with HMAC-SHA256:

```
X-Runpod-Signature: hmac_sha256(payload, webhook_secret)
```
