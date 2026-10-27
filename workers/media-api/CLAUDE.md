# Media-API Worker (port 4002)

Transcoding orchestration via RunPod. Handles the full transcoding lifecycle: trigger, webhook callbacks, status polling, and retry. Also runs a Durable Object for periodic orphaned R2 file cleanup.

## Endpoints

### Transcoding Routes

| Method | Path | Auth | Input | Success | Notes |
|---|---|---|---|---|---|
| POST | `/internal/media/:id/transcode` | `worker` (HMAC) | params: `id` (uuid); body: `{ priority? }` | 200 | Trigger transcoding; RunPod dispatch runs via `ctx.background()` |
| POST | `/api/transcoding/retry/:id` | `required`, `rateLimit: 'strict'` | params: `id` (uuid) | 200 | The studio's Try again, from `failed` or waiting; refused for a file problem or once `MAX_TRANSCODING_ATTEMPTS` (3) jobs were accepted |

Status is not polled: the studio reads lifecycle and progress from the live status socket (`/api/media-status/*`).

### Webhook Route (non-procedure)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/transcoding/webhook` | RunPod HMAC (`RUNPOD_WEBHOOK_SECRET`) | Receives `completed`, `failed`, or `progress` callbacks; raw body read for signature verification before parsing |

### Live Media Status Routes (Codex-l2c48.9)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/media-status/ticket` | `required`, roles creator/admin | `{ url, ticket, expiresAt }`: a one-minute, single-use socket ticket |
| GET | `/api/media-status/live` | the ticket, sent as subprotocol `ticket.<t>` beside `media-status.v1`; Origin checked | WebSocket upgrade into `MediaStatusObject` (Hibernation API); close 4401 = session ended |
| POST | `/internal/media-status` | `worker` (HMAC) | A lifecycle change from content-api, which has no `MEDIA_STATUS` binding |

The object is reached only through `statusObjectFor()` (`@codex/worker-utils`). The web client is `apps/web/src/lib/client/media-status.svelte.ts`.

### Orphan Cleanup DO Routes (internal, worker HMAC)

| Method | Path | Notes |
|---|---|---|
| GET | `/internal/orphan-cleanup/status` | Get cleanup stats from DO |
| POST | `/internal/orphan-cleanup/trigger` | Manually trigger cleanup |
| POST | `/internal/orphan-cleanup/schedule` | Reschedule next alarm (pushes it to now + 1h — never call this from a cron) |

The DO also answers `POST /ensure-scheduled`, which `scheduled()` calls straight through the binding on the hourly production cron. It only ever moves the alarm EARLIER, to ~60s after the cron.

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
| `RUNPOD_WORKERS_MAX` | No | Max workers the endpoint should have; the cron raises it back when RunPod pauses the endpoint. Default 5, range 1–100 |
| `WORKER_SHARED_SECRET` | Yes | HMAC secret for worker-to-worker auth |
| `RATE_LIMIT_STRICT` / `RATE_LIMIT_API` | Yes | Native per-preset rate-limit bindings — `RATE_LIMIT_KV` was removed (Codex-kgrdp.17) |
| `AUTH_SESSION_KV` | Yes | Session auth (KV check on startup) |
| `ORPHAN_CLEANUP_DO` | No | Durable Object namespace for cleanup DO |
| `ASSETS_BUCKET` | Yes (for the sweep) | The bucket the cleanup DO deletes from — where every orphan producer writes. NOT `MEDIA_BUCKET` |
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
- **`ctx.background()` for dispatch**: `triggerJobInternal` returns `{ dispatchPromise }` — the actual RunPod API call runs via `ctx.background(dispatchPromise)` (NOT `ctx.executionCtx.waitUntil`, which races procedure()'s own `waitUntil(cleanup())` and reliably kills the post-response DB writes) so the HTTP response is returned before RunPod is called.
- **Orphan cleanup DO**: Singleton instance (`idFromName('singleton')`), alarms run every hour, processes 50 orphans/run, max 3 retries per file. **Nothing starts it but the cron** (Codex-r85jo.3): the alarm is only set from inside the DO, and the DO only exists once a request reaches its stub, so `scheduled()` pokes `/ensure-scheduled` every hour. It sweeps `ASSETS_BUCKET`; sweeping `MEDIA_BUCKET` "succeeds" (deleting an absent key is not an error) and marks every orphan deleted while the objects stay. **It HEADs each key before deleting it** (Codex-r85jo.6): every image key is deterministic and overwritten in place, so a key orphaned by a failed delete is re-occupied by the next upload, and an unconditional delete destroys that live image. An object written after `orphanedAt` (minus a 5-minute clock-skew margin) is `markRetained`, not deleted.
- **The hourly cron pokes the orphan sweep FIRST, then runs `TranscodingMaintenance`**, in one `waitUntil`; maintenance has a 10 min budget (see `packages/transcoding/CLAUDE.md`). The poke takes a second, so a maintenance run that hangs can never take it down too. The cron and the webhook both build their services with `createWebhookServices`, so they get the same config as `procedure()` routes, `RUNPOD_DIRECT_URL` and `TRANSCODING_WEBHOOK_URL` included. Raising the endpoint's max workers needs a RunPod key with Serverless write access; without it the cron logs `transcoding.auto_unpause_not_permitted` at error and new uploads wait.
- **Health check runs both DB and KV checks**: `standardDatabaseCheck` (added 2026-05-22) plus `createKvCheck(['AUTH_SESSION_KV'])` — the rate-limit KV is gone.

## Reference Files

- `workers/media-api/src/routes/transcoding.ts` — trigger/retry/status routes
- `workers/media-api/src/routes/webhook.ts` — RunPod webhook handler
- `workers/media-api/src/middleware/verify-runpod-signature.ts` — HMAC verification middleware
- `workers/media-api/src/durable-objects/orphaned-file-cleanup-do.ts` — periodic R2 cleanup
