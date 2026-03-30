# @codex/transcoding

Transcoding pipeline orchestration via RunPod. Manages transcoding job lifecycle: submission, status tracking, webhook processing, and retry.

## API

### `TranscodingService`
| Method | Purpose | Notes |
|---|---|---|
| `startTranscoding(mediaId, sourceKey)` | Submit job to RunPod | Returns jobId |
| `handleWebhook(payload)` | Process RunPod callback | Updates media status to ready/failed |
| `getStatus(mediaId)` | Get transcoding job status | Returns status + progress |
| `retryTranscoding(mediaId)` | Retry failed job | Resubmits to RunPod |

## Transcoding Pipeline

```
1. Content-API calls media-api (worker HMAC auth)
2. TranscodingService.startTranscoding():
   a. Validate source exists in R2
   b. Submit job to RunPod API
   c. Update media status: uploading → transcoding
3. RunPod GPU processing:
   a. Download source from R2
   b. Transcode to HLS (multiple quality variants)
   c. Generate thumbnail
   d. Upload results to R2
   e. Callback to media-api webhook
4. TranscodingService.handleWebhook():
   a. Verify RunPod HMAC signature
   b. Update media: set HLS keys, thumbnail key, status → ready
   c. On failure: status → failed, log error details
```

## Media Status Machine

```
uploading → uploaded → transcoding → ready
                                  → failed (retryable)
```

## Custom Errors
| Error | When |
|---|---|
| `TranscodingError` | RunPod submission failed |
| `SourceNotFoundError` | Source media not found in R2 |

## Strict Rules

- **MUST** verify RunPod webhook signatures — NEVER trust unverified callbacks
- **MUST** validate source exists in R2 before submitting transcoding job
- **MUST** update media status atomically — use transactions for status transitions
- **NEVER** expose RunPod API keys in responses or logs
- **NEVER** allow status transitions that skip states (e.g., uploading → ready)

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/cloudflare-clients` (R2)
- **Used by**: media-api worker (port 4002)

## Reference Files

- `packages/transcoding/src/services/transcoding-service.ts`
- `packages/transcoding/src/types.ts` — job types, status enum
- `packages/transcoding/src/paths.ts` — R2 key patterns
