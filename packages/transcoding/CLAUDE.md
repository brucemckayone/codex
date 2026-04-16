# @codex/transcoding

RunPod GPU transcoding pipeline. Manages job dispatch, webhook processing, retry logic, and R2 path generation. `paths.ts` is the single source of truth for all R2/B2 storage keys.

## Key Exports

```typescript
import { TranscodingService } from '@codex/transcoding';
// R2 path utilities (use these everywhere — never hardcode paths)
import { getHlsMasterKey, getHlsPreviewKey, getOriginalKey, getThumbnailKey, getWaveformKey, getWaveformImageKey, getUserAvatarKey, getOrgLogoKey } from '@codex/transcoding';
import { TranscodingMediaNotFoundError, InvalidMediaStateError, RunPodApiError } from '@codex/transcoding';
```

## `TranscodingService`

### Constructor

```typescript
const service = new TranscodingService({
  db,
  environment,
  obs,                  // ObservabilityClient
  runpodApiKey,
  runpodEndpointId,
  webhookBaseUrl,       // e.g. 'https://media-api.codex.com' → webhook at /api/transcoding/webhook
  runpodApiBaseUrl?,    // Default: 'https://api.runpod.ai/v2'
  runpodDirectUrl?,     // Override: use this URL as-is (for local dev container)
  runpodTimeout?,       // Default: 30000ms
});
```

RunPod credentials are required. Storage credentials (R2, B2) are stored in RunPod's secret manager — not in this config.

### Methods

| Method | Signature | Notes |
|---|---|---|
| `triggerJob` | `(mediaId: string, creatorId: string, priority?: number)` | Validates media is in `uploaded` state + has `r2Key`. Sets status → `transcoding`, calls RunPod `/run`. If RunPod fails, reverts status → `uploaded`. Returns void (async fire-and-forget). |
| `handleWebhook` | `(payload: RunPodWebhookPayload)` | Processes RunPod completion callback. On success: sets HLS keys, thumbnail key, waveform key, status → `ready`. On failure: status → `failed`, increments retry count. |
| `handleProgressWebhook` | `(payload: RunPodProgressWebhookPayload)` | Handles progress/step updates during transcoding. |
| `getTranscodingStatus` | `(input: GetTranscodingStatusInput)` | Returns `TranscodingStatusResponse` with status and progress info. |
| `retryTranscoding` | `(mediaId: string, creatorId: string)` | Re-submits failed job. Throws `MaxRetriesExceededError` if retry count >= 3. |
| `recoverStuckTranscoding` | `(maxAgeMinutes?: number)` | Finds media stuck in `transcoding` state older than `maxAgeMinutes` (default 120) and marks them `failed`. Returns count of recovered items. |

## RunPod Async Pattern

RunPod's `/run` endpoint is fire-and-forget:

```
1. triggerJob() → POST /v2/{endpoint_id}/run
2. RunPod returns immediately: { id: "job-xxx", status: "IN_QUEUE" }
3. GPU processes in background
4. RunPod POSTs result to our webhook URL
5. handleWebhook() updates DB
```

`triggerJob()` returns as soon as RunPod acknowledges the job — it does NOT wait for transcoding to complete.

## R2 Path Utilities (`paths.ts`)

**Always use these functions — never hardcode R2 paths.**

| Function | R2 Key Pattern |
|---|---|
| `getOriginalKey(creatorId, mediaId)` | `{creatorId}/originals/{mediaId}/video.mp4` |
| `getHlsMasterKey(creatorId, mediaId)` | `{creatorId}/hls/{mediaId}/master.m3u8` |
| `getHlsPreviewKey(creatorId, mediaId)` | `{creatorId}/hls/{mediaId}/preview/preview.m3u8` |
| `getHlsVariantKey(creatorId, mediaId, variant)` | `{creatorId}/hls/{mediaId}/{variant}.m3u8` |
| `getHlsPrefix(creatorId, mediaId)` | `{creatorId}/hls/{mediaId}/` |
| `getThumbnailKey(creatorId, mediaId)` | `{creatorId}/thumbnails/{mediaId}/auto-generated.jpg` |
| `getWaveformKey(creatorId, mediaId)` | `{creatorId}/waveforms/{mediaId}/waveform.json` |
| `getWaveformImageKey(creatorId, mediaId)` | `{creatorId}/waveforms/{mediaId}/waveform.png` |
| `getMediaThumbnailKey(creatorId, mediaId, size)` | `{creatorId}/media-thumbnails/{mediaId}/{size}.webp` |
| `getOrgLogoKey(orgId, variant)` | In branding folder |
| `getUserAvatarKey(userId, size)` | Avatar path |
| `getMezzanineKey(creatorId, mediaId)` | B2 archival path (mezzanine) |
| `getTranscodingOutputKeys(creatorId, mediaId)` | All output keys for a media item |

Also exports `parseR2Key()` and `isValidR2Key()` for validation.

## Media Status Machine

```
uploading → uploaded → transcoding → ready
                                  → failed (retryable, max 3)
```

`triggerJob()` only accepts media in `uploaded` state. On RunPod failure, status reverts to `uploaded`.

## Custom Errors

| Error | When |
|---|---|
| `TranscodingMediaNotFoundError` | Media doesn't exist or not owned by creatorId |
| `InvalidMediaStateError` | Media not in expected state for the operation |
| `MediaOwnershipError` | Media owned by different creator |
| `RunPodApiError` | RunPod HTTP error or timeout |
| `MaxRetriesExceededError` | Retry count >= 3 |
| `TranscodingJobNotFoundError` | No RunPod job ID found for media |
| `InvalidMediaTypeError` | Unsupported media type for transcoding |

## Rules

- **MUST** verify RunPod webhook authenticity — webhook handler in media-api must validate before calling `handleWebhook()`
- **MUST** use `scopedNotDeleted(mediaItems, creatorId)` — all media queries are creator-scoped
- **MUST** use R2 path functions from `paths.ts` — NEVER hardcode path strings
- **NEVER** expose RunPod API keys in logs or responses
- Status transitions must follow the state machine — `triggerJob()` only accepts `uploaded` state
- Status reverts to `uploaded` if RunPod call fails (atomic guard using `WHERE status = 'transcoding'`)

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/cloudflare-clients` (R2), `@codex/constants`, `@codex/validation`
- **Used by**: media-api worker (port 4002)

## Reference Files

- `packages/transcoding/src/services/transcoding-service.ts`
- `packages/transcoding/src/paths.ts` — R2 key generation (single source of truth)
- `packages/transcoding/src/types.ts` — RunPod payload types, status enums
