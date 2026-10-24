# @codex/transcoding

RunPod GPU transcoding pipeline. Manages job dispatch, webhook processing, retry logic, and R2 path generation. `paths.ts` is the single source of truth for all R2/B2 storage keys.

## Key Exports

```typescript
import { TranscodingService } from '@codex/transcoding';
// R2 path utilities (use these everywhere — never hardcode paths)
import { getHlsMasterKey, getHlsPreviewKey, getOriginalKey, getThumbnailKey, getWaveformKey, getWaveformImageKey, getUserAvatarKey, getOrgLogoKey } from '@codex/transcoding';
import { TranscodingMediaNotFoundError, InvalidMediaStateError, MaxRetriesExceededError } from '@codex/transcoding';
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
  runpodTimeout?,       // /run answer timeout. Default: 10000ms
});
```

RunPod credentials are required. Storage credentials (R2, B2) are stored in RunPod's secret manager — not in this config.

### Methods

| Method | Signature | Notes |
|---|---|---|
| `claimForDispatch` | `(mediaId, allowedFrom, { creatorId?, priority? })` | THE way into `transcoding`: one guarded UPDATE…RETURNING that checks the state, attempts left and soft delete, counts the attempt and clears the last run. Returns the row or `null`. Two concurrent claims cannot both match. |
| `dispatch` | `(media: TranscodingMediaItem)` | POSTs `/run` (with `input.contract` and a per-job `policy`), classifies the answer (`classifyRunPodAnswer`), records it. **Never throws.** |
| `triggerJobInternal` | `(mediaId, priority?)` | Upload path (content-api, worker HMAC). Claims from `uploaded`; returns `{ alreadyQueued: true }` or `{ alreadyQueued: false, dispatchPromise }`. |
| `retryTranscoding` | `(mediaId, creatorId)` | Creator's Retry, from `failed` or waiting `uploaded`. Refuses a non-retryable code (`TranscodingNotRetryableError`) and exhausted attempts (`MaxRetriesExceededError`). Returns `{ dispatchPromise }`. |
| `handleWebhook` | `(payload: RunPodWebhookPayload)` | Completion → `ready`; failure → `failed` with a job-side code. Both writes are guarded on `transcoding` AND the held job (`heldJobIs`), so a stale webhook changes nothing. Attempts are never counted here. |
| `rejectWebhookOutput` | `({ jobId, mediaId }, detail)` | A signed completion/failure our schema rejected → `failed OUTPUT_REJECTED` now, not after the cron's timeout. |
| `handleProgressWebhook` | `(payload: RunPodProgressWebhookPayload)` | Progress/step updates, guarded on the held job. |
| `getTranscodingStatus` | `(mediaId, creatorId)` | Returns `TranscodingStatusResponse`, including `transcodingErrorCode`. |
| `recoverStuckTranscoding` | `(maxAgeMinutes?: number)` | Cron: `transcoding` rows older than `maxAgeMinutes` (default 120) → `failed TIMED_OUT`. |

## RunPod Async Pattern

RunPod's `/run` endpoint is fire-and-forget:

```
1. claimForDispatch() → status transcoding, attempt counted
2. dispatch() → POST /v2/{endpoint_id}/run
3. RunPod returns immediately: { id: "job-xxx", status: "IN_QUEUE" }
4. GPU processes in background
5. RunPod POSTs result to our webhook URL
6. handleWebhook() updates DB
```

What a `/run` answer means (`dispatch.ts`, pure and unit-tested):

| Answer | Outcome | Row |
|---|---|---|
| 2xx with an id | accepted | job id stored (unless a fast webhook already moved the row) |
| 409 `ENDPOINT_PAUSED` / 429 / 4xx / 5xx | rejected | back to `uploaded` with `TRANSCODER_*` code, attempt given back ("waiting") |
| timeout, network error, 2xx without an id | ambiguous | stays `transcoding`: RunPod may have the job |

### The dispatch runs in `ctx.background`, not `waitUntil`

`triggerJobInternal()` returns `{ dispatchPromise }`; the route registers it with
**`ctx.background(...)`**, not `ctx.executionCtx.waitUntil(...)`. The dispatch
writes to the DB after the response is sent (the job id, or the waiting
state on a refusal), and a bare `waitUntil` races `procedure()`'s own
`waitUntil(cleanup())` — which calls `pool.end()` and reliably wins. The writes
then failed silently. Use `ctx.background` for any post-response DB work.

`AbortSignal.timeout(runpodTimeout)` is 10 000 ms, well inside Cloudflare's
30 s `waitUntil` ceiling, so a hung `/run` gives up while the outcome can
still be written.

### Local development

Local dev does **not** talk to RunPod. It posts to a container running
`infrastructure/runpod/local_server.py` via `RUNPOD_DIRECT_URL`, which
reproduces the cloud `/run` contract. Do not point it at runpod-python's
`--rp_serve_api`: that server's `/run` never invokes the handler at all.
See **[infrastructure/runpod/LOCAL_DEV.md](../../infrastructure/runpod/LOCAL_DEV.md)**.

## R2 Path Utilities (`paths.ts`)

**Always use these functions — never hardcode R2 paths.**

| Function | R2 Key Pattern |
|---|---|
| `getOriginalKey(creatorId, mediaId, filename)` | `{creatorId}/originals/{mediaId}/{filename}` |
| `getHlsMasterKey(creatorId, mediaId)` | `{creatorId}/hls/{mediaId}/master.m3u8` |
| `getHlsPreviewKey(creatorId, mediaId)` | `{creatorId}/hls/{mediaId}/preview/preview.m3u8` |
| `getHlsVariantKey(creatorId, mediaId, variant)` | `{creatorId}/hls/{mediaId}/{variant}.m3u8` |
| `getHlsPrefix(creatorId, mediaId)` | `{creatorId}/hls/{mediaId}/` |
| `getThumbnailKey(creatorId, mediaId)` | `{creatorId}/thumbnails/{mediaId}/auto-generated.jpg` |
| `getWaveformKey(creatorId, mediaId)` | `{creatorId}/waveforms/{mediaId}/waveform.json` |
| `getWaveformImageKey(creatorId, mediaId)` | `{creatorId}/waveforms/{mediaId}/waveform.png` |
| `getMediaThumbnailKey(creatorId, mediaId, size)` | `{creatorId}/media-thumbnails/{mediaId}/{size}.webp` |
| `getOrgLogoKey(orgId, size)` | `{orgId}/branding/logo/{size}.webp` (size: sm/md/lg/original) |
| `getUserAvatarKey(userId, size)` | Avatar path |
| `getMezzanineKey(creatorId, mediaId)` | B2 archival path (mezzanine) |
| `getTranscodingOutputKeys(creatorId, mediaId)` | All output keys for a media item |

Also exports `parseR2Key()` and `isValidR2Key()` for validation.

## Media Status Machine

```
uploading → uploaded ──claim──▶ transcoding → ready
               ▲                    │ └──▶ failed ──retry (claim)──┐
               └── RunPod refused ──┘                               │
               └────────────────────────────────────────────────────┘
```

`uploaded` with a `transcoding_error_code` means "waiting for the transcoder".
`MAX_TRANSCODING_ATTEMPTS` (3) counts accepted jobs; a refusal gives its attempt back.

## Custom Errors

| Error | When |
|---|---|
| `TranscodingMediaNotFoundError` | Media doesn't exist or not owned by creatorId |
| `InvalidMediaStateError` | Media not in expected state for the operation |
| `MaxRetriesExceededError` | No attempts left (`MAX_TRANSCODING_ATTEMPTS`) |
| `TranscodingNotRetryableError` | The last failure was the file itself; the creator re-uploads |
| `TranscodingJobNotFoundError` | No RunPod job ID found for media |
| `InvalidMediaTypeError` | Unsupported media type for transcoding |

## Rules

- **MUST** verify RunPod webhook authenticity — webhook handler in media-api must validate before calling `handleWebhook()`
- **MUST** use `scopedNotDeleted(mediaItems, creatorId)` — all media queries are creator-scoped
- **MUST** use R2 path functions from `paths.ts` — NEVER hardcode path strings
- **NEVER** expose RunPod API keys in logs or responses
- **MUST** enter `transcoding` only through `claimForDispatch()` — it is the only place an attempt is counted
- **MUST** guard every state write on the state it moves from (and webhooks on the held job): two writers can then never both apply

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/cloudflare-clients` (R2), `@codex/constants`, `@codex/validation`
- **Used by**: media-api worker (port 4002)

## Reference Files

- `packages/transcoding/src/services/transcoding-service.ts`
- `packages/transcoding/src/paths.ts` — R2 key generation (single source of truth)
- `packages/transcoding/src/types.ts` — RunPod payload types, status enums
