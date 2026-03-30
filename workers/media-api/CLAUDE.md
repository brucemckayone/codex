# Media-API Worker (port 4002)

Transcoding orchestration via RunPod. Handles transcoding job lifecycle: start, webhook callbacks, status, and retry.

## Endpoints

| Method | Path | Policy | Input | Success | Response |
|---|---|---|---|---|---|
| POST | `/internal/media/:id/transcode` | `auth: 'worker'` (HMAC) | params + body: transcode request | 200 | `{ data: { jobId } }` |
| POST | `/transcoding/webhook` | RunPod HMAC | body: RunPod callback | 200 | `{ received: true }` |
| GET | `/transcoding/status/:id` | `auth: 'required'` | params: `{ id: uuid }` | 200 | `{ data: { status, progress } }` |
| POST | `/transcoding/retry/:id` | `auth: 'required'` | params: `{ id: uuid }` | 200 | `{ data: { jobId } }` |

## Transcoding Pipeline

```
1. Content-API calls POST /internal/media/:id/transcode (worker HMAC auth)
2. Media-API validates request, calls RunPod API to start job
3. RunPod processes video (GPU): transcode → HLS variants → thumbnail
4. RunPod calls POST /transcoding/webhook with result
5. Media-API verifies RunPod HMAC signature
6. Updates media status: ready (success) or failed (error)
7. Sets HLS playlist key, variant keys, thumbnail key in DB
```

## Security Model

This worker uses TWO different HMAC auth mechanisms:

| Endpoint | Auth | Secret |
|---|---|---|
| `/internal/media/:id/transcode` | Worker-to-worker HMAC (`@codex/security`) | `WORKER_SHARED_SECRET` |
| `/transcoding/webhook` | RunPod webhook HMAC | `RUNPOD_WEBHOOK_SECRET` |

## Services Used

- `TranscodingService` (`@codex/transcoding`) — job management, RunPod integration
- `MediaItemService` (`@codex/content`) — media status updates

## Special Notes

- **No session auth for internal endpoints** — uses worker HMAC instead (content-api → media-api)
- **Webhook endpoint is a non-procedure exception** — RunPod owns the callback contract
- **Retry logic**: Failed jobs can be retried via POST `/transcoding/retry/:id`
- **Status machine**: `uploading → uploaded → transcoding → ready/failed`

## Strict Rules

- **MUST** verify worker HMAC on internal endpoints — NEVER accept unsigned requests
- **MUST** verify RunPod webhook signatures — NEVER trust unverified callbacks
- **MUST** update media status atomically — use transactions for status transitions
- **NEVER** expose RunPod API keys in responses or logs
- **NEVER** allow direct external access to internal endpoints

## Config

- `WORKER_SHARED_SECRET` — shared secret for worker-to-worker HMAC
- `RUNPOD_WEBHOOK_SECRET` — RunPod webhook signing secret
- `RUNPOD_API_KEY` — RunPod API key for starting jobs

## Reference Files

- `workers/media-api/src/routes/transcoding.ts` — transcoding routes
- `workers/media-api/src/routes/webhook.ts` — RunPod webhook handler
- `workers/media-api/src/middleware/verify-runpod-signature.ts` — HMAC verification
