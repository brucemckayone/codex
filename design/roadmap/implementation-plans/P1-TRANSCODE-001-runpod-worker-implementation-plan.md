# P1-TRANSCODE-001: RunPod Worker Implementation Plan

**Status**: Ready for Implementation
**Owner**: Media Transcoding
**Created**: 2025-12-18
**Last Updated**: 2025-12-31

> **Note**: This document is a companion to the main implementation plan.
> See `P1-TRANSCODE-001-implementation-plan.md` for the complete Python handler code,
> Dockerfile, FFmpeg commands, and all technical specifications.

---

## Intent and Maintenance Goals

- Define the RunPod worker as a cleanly bounded system with a single job contract.
- Keep output paths deterministic and aligned with `media-api`.
- Make the transcoding pipeline reproducible and testable locally.
- Avoid leaking secrets in payloads or logs.
- Keep all operational steps documented so future you is not stuck.

---

## Context Sources (read before implementation)

- `design/roadmap/implementation-plans/P1-TRANSCODE-001-implementation-plan.md`
- `design/roadmap/work-packets/P1-TRANSCODE-001-media-transcoding.md`
- `design/features/media-transcoding/pdr-phase-1.md`
- `design/features/media-transcoding/ttd-dphase-1.md`
- `design/infrastructure/R2BucketStructure.md`
- `design/infrastructure/CLOUDFLARE-SETUP.md`

Missing doc to create:
- `design/infrastructure/RunpodSetup.md` (referenced by PRD but absent)

---

## External References (Web, verify before implementation)

- FFmpeg HLS muxer docs: https://ffmpeg.org/ffmpeg-formats.html#hls
- FFmpeg loudnorm filter docs: https://ffmpeg.org/ffmpeg-filters.html#loudnorm
- audiowaveform README: https://github.com/bbc/audiowaveform
- RunPod serverless send-requests: https://docs.runpod.io/serverless/endpoints/send-requests
- RunPod serverless job states: https://docs.runpod.io/serverless/endpoints/job-states
- RunPod handler functions: https://docs.runpod.io/serverless/workers/handler-functions
- RunPod custom worker docs: https://docs.runpod.io/serverless/workers/custom-worker
- RunPod env vars: https://docs.runpod.io/serverless/development/environment-variables
- RunPod S3-compatible storage: https://docs.runpod.io/storage/s3-api

---

## System Boundary (English)

- RunPod worker receives a single job payload from `media-api`.
- It pulls the original media from R2, transcodes, writes outputs back to R2, and posts a webhook to `media-api`.
- It does not touch the database directly.
- It does not implement retries beyond what RunPod provides; retries are manual in `media-api`.

---

## Contracts (Must Match media-api)

### Input Payload (from media-api)

Required fields:
- `mediaId`
- `creatorId`
- `mediaType` (video or audio)
- `inputBucket`
- `inputKey`
- `outputBucket`
- `outputPrefix`
- `assetsBucket`
- `webhookUrl`
- `webhookSecret`

Validation rules:
- Reject missing fields.
- Reject media types outside video or audio.
- Reject keys that do not include `{creatorId}/`.

### Output Payload (to media-api webhook)

Required fields:
- `id` (RunPod job ID)
- `status` (completed or failed)
- `output.mediaId`
- `output.mediaType`

Optional fields (set on success):
- `output.hlsMasterPlaylistKey`
- `output.hlsPreviewKey`
- `output.thumbnailKey`
- `output.waveformKey`
- `output.waveformImageKey`
- `output.durationSeconds`
- `output.width`
- `output.height`

Error field on failure:
- `error` (human-readable)

---

## R2 Path Contract (Must Match media-api)

Media bucket keys:
- `{creatorId}/originals/{mediaId}/original.<ext>`
- `{creatorId}/hls/{mediaId}/master.m3u8`
- `{creatorId}/hls/{mediaId}/preview/preview.m3u8`
- `{creatorId}/hls-audio/{mediaId}/master.m3u8`

Assets bucket keys:
- `{creatorId}/thumbnails/media/{mediaId}/auto-generated.jpg`
- `{creatorId}/waveforms/{mediaId}/waveform.json`
- `{creatorId}/thumbnails/media/{mediaId}/waveform.png`

---

## Toolchain Details (From Repo TDD/PRD + External Docs)

**ffmpeg / ffprobe**:
- Use ffprobe JSON output for width, height, and duration; fall back to container duration if stream duration is missing.
- Use ffmpeg with H.264 video + AAC audio for HLS outputs.
- HLS segment duration target is 6 seconds for both video and audio.
- Use VOD playlist type so an endlist is written.
- Use deterministic segment naming so R2 keys are stable across runs.

**GPU acceleration**:
- Use NVENC when available (NVIDIA).
- Use a fast preset (p4 in TDD) for predictable performance.
- If NVENC is unavailable, fall back to CPU with a documented preset and log the change.

**Audio normalization**:
- Loudness target -16 LUFS, true peak -1.5, LRA 11 (EBU R128 loudnorm filter).
- Decide and document one-pass vs two-pass loudnorm; log measured values if available.

**audiowaveform**:
- Waveform JSON at 10 points per second, 8-bit amplitude.
- PNG waveform image is 1280x720; choose a single palette and document it.
- Decide whether to merge stereo channels or keep them separate in the JSON.

**R2 upload tooling**:
- Use S3-compatible APIs with explicit endpoint URL for R2.
- Sync HLS directories; copy single assets (thumbnail, waveform) individually.

Source references:
- `design/features/media-transcoding/ttd-dphase-1.md`
- `design/features/media-transcoding/pdr-phase-1.md`

---

## Runtime Dependencies (Binary + SDK)

- ffmpeg (includes ffprobe) compiled with NVENC support.
- audiowaveform with JSON and PNG output support.
- AWS CLI or S3 SDK for R2 uploads (document the chosen approach).
- RunPod serverless SDK (python or node).
- HTTP client for webhook posts.
- Crypto library for HMAC signing.

---

## Transcoding Parameters (Explicit)

**Video HLS variants** (skip upscales):
- 1080p: 1920x1080 at 5000 kbps
- 720p: 1280x720 at 2500 kbps
- 480p: 854x480 at 1000 kbps
- 360p: 640x360 at 500 kbps

**Audio HLS variants**:
- 128 kbps AAC
- 64 kbps AAC

**Preview clip**:
- 30 seconds at 720p
- Start at 0 seconds (first 30 seconds)

**Thumbnail**:
- Extract at 10 percent mark
- 1280x720 JPEG

**Waveform**:
- JSON file, 1000 data points for 100 seconds
- 10 points per second, 8-bit depth
- PNG image 1280x720

---

## Credential Strategy

Preferred approach:
- Store R2 credentials and bucket names in RunPod endpoint env vars.
- Do not pass secrets per job payload.

Fallback approach:
- If endpoint env vars are not available, extend the job payload to include:
  - `r2AccountId`
  - `r2AccessKeyId`
  - `r2SecretAccessKey`
  - `outputBucket`, `assetsBucket`
- If this is required, update both this plan and the media-api contract.

---

## Webhook Signing (Details)

- Signature header: `X-RunPod-Signature` (case-insensitive)
- Algorithm: HMAC-SHA256 over raw JSON payload
- Output format: hex digest
- The exact signing must match media-api verification

---

## Output Verification Checklist

Video:
- Master playlist exists and references only generated variants.
- Variant playlists exist and contain 6-second segments.
- Playlists are VOD with an endlist marker.
- Thumbnail exists and matches 1280x720 target size.
- Preview playlist exists at the expected key.
- Segment filenames follow a deterministic numeric pattern.
- Preview duration is approximately 30 seconds (clamped to source length).

Audio:
- Master playlist exists and references 128k and 64k variants.
- Loudness normalized output is audible and not clipped.
- Waveform JSON exists with expected length.
- Waveform image exists and is 1280x720 PNG.
- Waveform JSON resolution matches ~10 points per second of audio duration.

---

## Feature Breakdown

### Video Pipeline
- Detect source resolution and duration.
- Generate HLS variants (1080p, 720p, 480p, 360p) without upscaling.
- Produce HLS master playlist that references only generated variants.
- Create a 30-second preview HLS at 720p (first 30 seconds).
- Extract a thumbnail at the 10 percent mark.

### Audio Pipeline
- Normalize loudness to -16 LUFS.
- Generate HLS audio variants (128 kbps, 64 kbps AAC).
- Produce waveform JSON (1000 data points).
- Render a waveform image thumbnail (PNG).

### Output Publishing
- Upload all outputs into the correct bucket and prefix.
- Only include keys that were actually generated in the webhook payload.

---

## Repository Layout (proposed in this repo)

Create a dedicated folder for RunPod worker artifacts:

- `infrastructure/runpod/README.md`
- `infrastructure/runpod/Dockerfile`
- `infrastructure/runpod/handler/`
- `infrastructure/runpod/handler/index.ts` or `handler.py`
- `infrastructure/runpod/handler/config.ts`
- `infrastructure/runpod/scripts/`
- `infrastructure/runpod/scripts/validate-output.sh`
- `infrastructure/runpod/scripts/local-run.sh`
- `infrastructure/runpod/fixtures/`
- `infrastructure/runpod/fixtures/sample-video.mp4`
- `infrastructure/runpod/fixtures/sample-audio.wav`

If a separate repo is preferred, mirror this layout there and link it from `design/infrastructure/RunpodSetup.md`.

---

## Phase 0: Design and Setup Docs

**Goal**: Make this system discoverable and repeatable.

**Checklist**:
- Create `design/infrastructure/RunpodSetup.md` with setup steps.
- Record the payload contract and R2 key contract in the doc.
- Document how the RunPod endpoint is created and updated.
- Link external docs (RunPod, ffmpeg, audiowaveform) in the setup doc for future reference.

**Definition of Done**:
- A developer can follow the doc and set up the endpoint without external help.

---

## Phase 1: Docker Image and Runtime Base

**Goal**: Build a stable container with all required binaries.

**Checklist**:
- Choose a base image compatible with RunPod serverless.
- Install ffmpeg with GPU acceleration enabled.
- Install audiowaveform for waveform generation.
- Include a minimal runtime (node or python) for the handler.
- Add a small health command in the image to verify tool availability.
- Record ffmpeg/ffprobe/audiowaveform versions in `infrastructure/runpod/README.md`.
- Verify `h264_nvenc` is present; document the fallback encoder if not.
- Verify audiowaveform can produce both JSON and PNG outputs.

**Files to touch**:
- `infrastructure/runpod/Dockerfile`
- `infrastructure/runpod/README.md`

**Definition of Done**:
- Container builds locally and can run a simple media probe.

---

## Phase 2: Handler Implementation

**Goal**: Implement the job lifecycle in one handler entry point.

**Checklist**:
- Validate payload and fail fast on invalid input.
- Download input media from R2 into a temp workspace.
- Probe media metadata (duration, dimensions, audio channels).
- Run video or audio pipeline based on `mediaType`.
- Upload outputs to R2 using the declared key contract.
- Post webhook payload to `media-api`.
- Clean up temp files to avoid disk bloat.
- Enforce output verification checklist before sending success webhook.
- Ensure HLS playlists are VOD and segment naming matches the deterministic pattern.
- Ensure master playlists include bandwidth and resolution metadata for each variant.
- Clamp preview and thumbnail timestamps within the actual duration.

**Files to touch**:
- `infrastructure/runpod/handler/`
- `infrastructure/runpod/README.md`

**Definition of Done**:
- For both video and audio, outputs match the agreed R2 keys.
- Webhook payload includes only valid keys.

---

## Phase 3: Validation and Safety

**Goal**: Protect against bad inputs and dangerous edge cases.

**Checklist**:
- Reject missing or malformed payload fields.
- Reject path traversal in keys.
- Clamp preview and thumbnail timestamps within media duration.
- Skip variants above source resolution.
- Emit a descriptive error if ffmpeg fails.
- Ensure webhook payloads only include keys that actually exist.
- Validate HLS playlists include an endlist marker for VOD outputs.
- Validate waveform JSON length against duration * 10 to catch truncation.

**Definition of Done**:
- A corrupted or unsupported input fails gracefully and posts a failed webhook.

---

## Phase 4: Local Test Harness

**Goal**: Validate behavior before any RunPod deployment.

**Checklist**:
- Add fixtures for a small video and audio file.
- Provide a local runner script that simulates the RunPod payload.
- Add a validation script to check output files and playlists.
- Document the expected output folder structure.

**Files to touch**:
- `infrastructure/runpod/scripts/`
- `infrastructure/runpod/fixtures/`
- `infrastructure/runpod/README.md`

**Definition of Done**:
- A local run produces the full output set with correct paths.

---

## Phase 5: RunPod Endpoint Setup

**Goal**: Deploy and configure the RunPod serverless endpoint.

**Checklist**:
- Create RunPod project and endpoint.
- Push the container image to a registry.
- Configure endpoint env vars:
  - R2 credentials
  - Bucket names
  - Webhook secret
- Restrict endpoint access to API key only.

**Files to touch**:
- `design/infrastructure/RunpodSetup.md`
- `infrastructure/runpod/README.md`

**Definition of Done**:
- Endpoint can run a job and post a webhook to staging `media-api`.

---

## Phase 6: Operations and Maintenance

**Goal**: Keep the worker stable over time.

**Checklist**:
- Rotate RunPod API key and webhook secret quarterly.
- Monitor GPU cost per job and success rate.
- Update ffmpeg and audiowaveform versions on a scheduled cadence.
- Keep a regression fixture for video and audio outputs.

**Definition of Done**:
- Documented maintenance playbook in `design/infrastructure/RunpodSetup.md`.

---

## Risks and Mitigations

- R2 key mismatch causes broken playback. Mitigation: validate keys in handler and test harness.
- Webhook signature mismatch causes jobs to look failed. Mitigation: single shared contract with media-api.
- Output size explosion from too many variants. Mitigation: skip upscales, limit to known variants.

---

## Final Definition of Done

- RunPod worker can process both video and audio with correct outputs.
- Webhook payloads update media-api without manual intervention.
- A documented setup and maintenance guide exists in the repo.
