# Media API (4002)

Transcoding Orchestration (RunPod).

## Endpoints
- **POST /internal/media/:id/transcode**: Trigger job. (HMAC Auth).
- **POST /transcoding/webhook**: RunPod callback. (HMAC Auth).
- **GET /transcoding/status/:id**: Job status.
- **POST /transcoding/retry/:id**: Retry failed job.

## Architecture
- **Service**: `@codex/transcoding`.
- **Flow**:
  1. Content-API calls `internal/transcode`.
  2. Media-API calls RunPod.
  3. RunPod calls `webhook`.
  4. Media-API updates DB (`ready`/`failed`).
- **Security**: Worker-to-Worker HMAC (`WORKER_SHARED_SECRET`). Webhook HMAC (`RUNPOD_WEBHOOK_SECRET`).

## Standards
- **Validation**: Zod schema for every input.
- **Assert**: `invariant(ctx.user, "Auth required")`.
- **No Logic**: Route -> Service -> Response only.
- **Errors**: Map Service Errors to HTTP codes.
