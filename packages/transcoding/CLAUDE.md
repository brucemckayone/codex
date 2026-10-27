# @codex/transcoding

RunPod GPU transcoding pipeline. Manages job dispatch, webhook processing, retry logic, and R2 path generation. `paths.ts` is the single source of truth for all R2/B2 storage keys.

## Key Exports

```typescript
import { TranscodingService, TranscodingMaintenance } from '@codex/transcoding';
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
  runpodWorkersMax?,    // Max workers the endpoint should have. Default: 5
  runpodApi?,           // RunPodApi override (tests)
});
```

RunPod credentials are required. Storage credentials (R2, B2) are stored in RunPod's secret manager — not in this config.

### Methods

| Method | Signature | Notes |
|---|---|---|
| `claimForDispatch` | `(mediaId, allowedFrom, scope, { priority? })` | THE way into `transcoding`: one guarded UPDATE…RETURNING that checks the state, attempts left and soft delete, counts the attempt and clears the last run. Returns the row or `null`. Two concurrent claims cannot both match. `scope` is `{ creatorId }` for every request path, or `MAINTENANCE_SCOPE` for the cron, which sweeps all creators. That object is not exported from the package and is compared by identity: a look-alike, an empty creator or no creator throws `ValidationError`. |
| `dispatch` | `(media: TranscodingMediaItem)` | POSTs `/run` (with `input.contract` and a per-job `policy`), classifies the answer (`classifyRunPodAnswer`), records it. **Never throws.** |
| `triggerJobInternal` | `(mediaId, priority?)` | Upload path (content-api, worker HMAC). Claims from `uploaded`; returns `{ alreadyQueued: true }` or `{ alreadyQueued: false, dispatchPromise }`. |
| `retryTranscoding` | `(mediaId, creatorId)` | Creator's Retry, from `failed` or waiting `uploaded`. Refuses a non-retryable code (`TranscodingNotRetryableError`) and exhausted attempts (`MaxRetriesExceededError`). Returns `{ dispatchPromise }`. |
| `handleWebhook` | `(payload: RunPodWebhookPayload)` | Completion → `ready`; failure → `failed` with a job-side code. Both writes are guarded on `transcoding` AND the held job (`heldJobIs`), so a stale webhook changes nothing. Attempts are never counted here. |
| `rejectWebhookOutput` | `({ jobId, mediaId }, detail)` | A signed completion/failure our schema rejected → `failed OUTPUT_REJECTED` now, not after the cron's timeout. |
| `handleProgressWebhook` | `(payload: RunPodProgressWebhookPayload)` | Progress/step updates, guarded on the held job. |
| `ensureEndpointAwake` | `(deadline: number)` | Reads the endpoint's max workers over REST v2 and raises it to `runpodWorkersMax` when RunPod scaled it down (paused = 0). `dispatch` calls it on a 409; the cron calls it every run. A key without access is logged at error as `transcoding.auto_unpause_not_permitted`; any other failure that is not a passing outage (an unreadable answer, a 2xx that did not apply the new value) is an error too. A bad `runpodWorkersMax` logs `transcoding.workers_max_invalid` at error and uses the default. |

## `RunPodApi` (`runpod-api.ts`)

The management and status calls `/run` does not cover: `endpointWorkers`,
`setWorkersMax` (REST v2 `api.runpod.io/v2/serverless/{id}`; v1 retires
2026-11-15), `jobStatus` (`/v2/{id}/status/{job}`; 404 → `GONE`) and the
keep-alive `ping` (a low-priority job with a 10 s ttl, so no worker starts).
**Never throws**; every call is bounded by a deadline and an 8 s cap (a call
cut off answers `out_of_time`). All calls answer `unsupported` when
`runpodDirectUrl` is set: the local container has `/run` only. A job's `error`
text is never read: RunPod's words never reach a creator.

## `TranscodingMaintenance` (the hourly cron)

`run({ now?, deadline })` never throws; each step runs on its own and a
failing step is reported in `failedSteps`. Built by the registry
(`ctx.services.transcodingMaintenance`); media-api's `scheduled()` runs it on
the existing hourly production cron.

1. `ensureEndpointAwake`, first, so the ping finds the endpoint awake.
2. Keep-alive `ping` in the 03:00 UTC run (RunPod pauses after 7 idle days).
   The handler answers a ping before reading any job field (`{status:
   'pong'}`, Codex-l2c48.8); the image deployed before it (3f0ce3fa) raises
   `KeyError` and fails the job. A FAILED ping job is never alerted either
   way: the request already reset RunPod's idle clock. A ping RunPod REFUSES
   for a reason that will not pass (`not_permitted`, `not_found`) is alerted
   (`pingRefused`, once a day).
3. `transcoding` rows past their job's `executionTimeout` (with a job id) or
   `ttl` (without) plus 15 min: ask RunPod. Still running → leave; COMPLETED
   or gone (RunPod keeps a result only 30 min) → `failed WEBHOOK_LOST`;
   FAILED → `INFRA_ERROR`; cancelled or timed out → `TIMED_OUT`; no job id →
   back to waiting, attempt given back. Anything still unresolved 24 h past
   due fails `TIMED_OUT` whatever RunPod says, at error: a `transcoding` row
   cannot be retried by its creator. Reads 100 rows to find 25 due ones, so
   long videos not yet due never take a due row's slot.
4. `uploaded` rows idle 10 min (waiting, or stranded by a failed content-api
   hop): claim with `MAINTENANCE_SCOPE` and dispatch. The first dispatch
   RunPod does not accept ends the retries for that run. Give up at 24 h
   since `uploaded_at`, or with no attempts left, keeping the waiting code.
5. `uploading` rows untouched 24 h: R2 HEAD. There → `uploaded` (the next run
   dispatches it); definitely absent → `failed UPLOAD_INCOMPLETE`; R2 cannot
   say → left alone, and the step stops. No R2 bucket → the step fails, at
   error, every run.

The rules are pure functions in `maintenance-rules.ts`. Every write is guarded
on the state the run read (deletion included), so a creator's Retry or a
webhook that got there first is never overwritten; one that matches nothing
counts in `report.raced`. When RunPod cannot answer at all (down, out of
time, a key that may not ask) the step stops asking; one unreadable answer is
that job's alone. 25 rows per step per run; a retry is not started with under
25 s of budget left. Lost-job failures that mean the pipeline broke
(`WEBHOOK_LOST`, `INFRA_ERROR`, the 24 h ceiling) log at error.

Its integration suite sweeps EVERY creator's rows, so it runs only in CI or
with `TRANSCODING_SWEEP_DB=1` against a throwaway database, and refuses
`neondb`, `main` and `main_test`.

## `TranscodingAlerts` (emails)

Built once per request by the registry and shared by `transcoding` and
`transcodingMaintenance`; none without an execution context. **Never throws**:
the lookups and sends run after the response on the registry's `dbWaitUntil`,
which a webhook's DB pool waits for before closing.

- `mediaFailed(row)`: the creator (existing `transcoding-failed` template:
  per-category `errorSummary`, `retryUrl` = the creator studio's media page
  built from `WEB_APP_URL` with `buildCreatorsUrl`) and every platform owner
  (`transcoding-owner-alert`, with the creator, code, attempts and the
  handler's own text), read from the row. Called ONLY with the row a guarded
  write just failed, so a webhook delivered 3 times emails once; never
  deduped beyond that. Nothing for a category with `notify: false` (an
  abandoned upload), and nothing while an upload is only waiting. The two
  sends are independent: a failed creator lookup still mails the owners
  (`(lookup failed)`), and one recipient's throw never stops the next.
- Setup faults, owners only: `dispatchRefused(mediaId, outcome)` (a refusal
  whose code is `alertOwnerOnEntry`), `endpointStuck(outcome)` (paused and
  cannot be raised, or its settings cannot be read), `pingRefused(reason)`
  and `uploadsIncomplete(count)`. Callers report EVERY outcome (every
  dispatch, every maintenance run); the alerts decide whether it is a fault
  (a passing outage or a local container's `unsupported` is not) and mail
  each fault at most **once per UTC day** through an `AlertLedger`: a
  `CACHE_KV` key `transcoding-alert:<event>:<yyyy-mm-dd>` (36 h TTL). The
  ledger fails OPEN (a KV error or no `CACHE_KV` mails, and warns): a
  duplicate beats a lost alert.
- Subjects: a creator's title is stripped of `<`, `>` and line breaks, since
  the renderer refuses a subject holding `<` or `>` (the email is lost).
- Owners are looked up once per request (the drizzle query is materialised
  with `.then`, since awaiting the builder runs it again). No owner at all
  logs `transcoding.owner_alert_no_recipient` at error.

Creator copy is fixed and owner-approved; RunPod's or the handler's raw text
never reaches a creator. `transcoding-failed` itself cannot be edited in place
(the deploy seed only inserts missing templates).

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
still be written. A 409 then wakes the endpoint, and the whole dispatch stays
inside `DISPATCH_BUDGET_MS` (22 s).

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

The hourly maintenance run also moves rows:
  uploading   ──file in R2──▶ uploaded      uploading ──file absent──▶ failed UPLOAD_INCOMPLETE
  uploaded    ──24 h waiting──▶ failed (keeps the waiting code)
  transcoding ──no job id──▶ uploaded       transcoding ──lost job──▶ failed
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
- **MUST** use `scopedNotDeleted(mediaItems, creatorId)` — all media queries are creator-scoped. The ONE exception is `TranscodingMaintenance` (cron only), which sweeps every creator's rows with `isNull(deletedAt)` on every read and write and claims with `MAINTENANCE_SCOPE`. Never add another unscoped query, and never "fix" the sweep by scoping it to a creator
- **MUST** use R2 path functions from `paths.ts` — NEVER hardcode path strings
- **NEVER** expose RunPod API keys in logs or responses
- **MUST** enter `transcoding` only through `claimForDispatch()` — it is the only place an attempt is counted
- **MUST** guard every state write on the state it moves from (and webhooks on the held job): two writers can then never both apply

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/cloudflare-clients` (R2), `@codex/constants`, `@codex/validation`
- **Used by**: media-api worker (port 4002)

## Reference Files

- `packages/transcoding/src/services/transcoding-service.ts`
- `packages/transcoding/src/services/transcoding-maintenance.ts` — the hourly maintenance run
- `packages/transcoding/src/services/transcoding-alerts.ts` — failure and setup-fault emails
- `packages/transcoding/src/services/media-state.ts` — the SETs of the moves to `failed` and back to waiting
- `packages/transcoding/src/maintenance-rules.ts` — the maintenance run's pure rules
- `packages/transcoding/src/runpod-api.ts` — RunPod REST v2 and job-status client
- `packages/transcoding/src/dispatch.ts` — what a `/run` answer means; per-job policy
- `packages/transcoding/src/paths.ts` — R2 key generation (single source of truth)
- `packages/transcoding/src/types.ts` — RunPod payload types, status enums
