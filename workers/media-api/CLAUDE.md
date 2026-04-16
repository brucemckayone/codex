# Media-API Worker (port 4002)

Transcoding orchestration via RunPod. Handles the full transcoding lifecycle: trigger, webhook callbacks, status polling, and retry. Also runs a Durable Object for periodic orphaned R2 file cleanup.

## Endpoints

### Transcoding Routes

| Method | Path | Auth | Input | Success | Notes |
|---|---|---|---|---|---|
| POST | `/internal/media/:id/transcode` | `worker` (HMAC) | params: `id` (uuid); body: `{ priority? }` | 200 | Trigger transcoding; RunPod dispatch runs via `waitUntil` |
| POST | `/api/transcoding/retry/:id` | `required`, `rateLimit: 'strict'` | params: `id` (uuid) | 200 | Retry a failed job; only 1 retry allowed per media item |
| GET | `/api/transcoding/status/:id` | `required`, `rateLimit: 'api'` | params: `id` (uuid) | 200 | Get current transcoding status |

### Webhook Route (non-procedure)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/transcoding/webhook` | RunPod HMAC (`RUNPOD_WEBHOOK_SECRET`) | Receives `completed`, `failed`, or `progress` callbacks; raw body read for signature verification before parsing |

### Orphan Cleanup DO Routes (internal, worker HMAC)

| Method | Path | Notes |
|---|---|---|
| GET | `/internal/orphan-cleanup/status` | Get cleanup stats from DO |
| POST | `/internal/orphan-cleanup/trigger` | Manually trigger cleanup |
| POST | `/internal/orphan-cleanup/schedule` | Reschedule next alarm |

## Transcoding Pipeline

```
1. content-api → POST /internal/media/:id/transcode (worker HMAC)
2. Media-API validates + sets status 'transcoding' in DB synchronously
3. RunPod dispatch runs in background via waitUntil
4. RunPod GPU: transcode → HLS variants → thumbnail
5. RunPod → POST /api/transcoding/webhook (RunPod HMAC verified)
6. Media-API handles webhook: status → 'ready' or 'failed'; stores HLS/thumbnail keys in DB
```

## Security Model

Two distinct HMAC mechanisms — do not confuse them:

| Endpoint | Auth Mechanism | Secret |
|---|---|---|
| `/internal/media/:id/transcode` | Worker-to-worker HMAC (`@codex/security` `workerAuth`) | `WORKER_SHARED_SECRET` |
| `/internal/orphan-cleanup/*` | Worker-to-worker HMAC (inline `createWorkerAuth`) | `WORKER_SHARED_SECRET` |
| `/api/transcoding/webhook` | RunPod webhook HMAC (`verifyRunpodSignature` middleware) | `RUNPOD_WEBHOOK_SECRET` |

## Bindings / Env

| Binding | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Neon DB connection |
| `RUNPOD_API_KEY` | Yes | RunPod API key for dispatching jobs |
| `RUNPOD_ENDPOINT_ID` | Yes | RunPod endpoint to dispatch to |
| `RUNPOD_WEBHOOK_SECRET` | Yes | HMAC secret for verifying RunPod callbacks |
| `WORKER_SHARED_SECRET` | Yes | HMAC secret for worker-to-worker auth |
| `RATE_LIMIT_KV` | Yes | Rate limiting |
| `AUTH_SESSION_KV` | Yes | Session auth (KV check on startup) |
| `B2_ENDPOINT` | Yes | Backblaze B2 endpoint (media storage) |
| `B2_KEY_ID` | Yes | B2 application key ID |
| `B2_APP_KEY` | Yes | B2 application key |
| `B2_BUCKET` | Yes | B2 bucket name |
| `ORPHAN_CLEANUP_DO` | No | Durable Object namespace for cleanup DO |
| `ENVIRONMENT` | No | `development` / `production` |
| `API_URL` | No | Base URL used in RunPod webhook callback config |

## Key Packages

| Package | Why |
|---|---|
| `@codex/transcoding` | `TranscodingService` — job management, RunPod dispatch, webhook handling; `runpodWebhookUnionSchema` |
| `@codex/security` | `workerAuth` for worker-to-worker HMAC |
| `@codex/image-processing` | `OrphanedFileService` — used inside cleanup DO |
| `@codex/cloudflare-clients` | `R2Service` — used inside cleanup DO |

## Gotchas

- **Webhook is not a `procedure()` endpoint** — RunPod owns the callback contract. Raw body must be read before JSON parsing for HMAC verification. Managed by `verifyRunpodSignature` middleware which stores raw body in context.
- **Webhook error classification**: `ValidationError` and `ServiceError` (permanent) → return 200 to stop RunPod retries. Transient errors (DB/network) → return 500 to trigger RunPod retry.
- **`waitUntil` for dispatch**: `triggerJobInternal` returns `{ dispatchPromise }` — the actual RunPod API call runs via `ctx.executionCtx.waitUntil(dispatchPromise)` so the HTTP response is returned before RunPod is called.
- **Orphan cleanup DO**: Singleton instance (`idFromName('singleton')`), alarms run every hour, processes 50 orphans/run, max 3 retries per file.
- **No database check in health**: Only KV checked on startup (`RATE_LIMIT_KV`, `AUTH_SESSION_KV`).
- **B2 credentials** are passed to RunPod via its secret manager — they are not sent in webhook payloads.

## Reference Files

- `workers/media-api/src/routes/transcoding.ts` — trigger/retry/status routes
- `workers/media-api/src/routes/webhook.ts` — RunPod webhook handler
- `workers/media-api/src/middleware/verify-runpod-signature.ts` — HMAC verification middleware
- `workers/media-api/src/durable-objects/orphaned-file-cleanup-do.ts` — periodic R2 cleanup
