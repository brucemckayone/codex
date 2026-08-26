# Local transcoding — how it works and how to run it

Transcoding in local dev runs the **same `handler/main.py` as production**, in a
CPU-only Docker container, against Miniflare R2 via `dev-cdn`. Only the job
*dispatch* differs from production, and that difference is where every failure
in this pipeline has come from. This document is the source of truth for it.

---

## Quick start

```bash
# 1. Build the image (once, or after changing handler/ or local_server.py)
pnpm dev:transcoder:build

# 2. Run the container — publishes container :8000 on host :8010
pnpm dev:transcoder

# 3. Bring up the fleet (needs at least content-api, media-api, dev-cdn)
pnpm dev
```

Then upload media as a creator. `media_items.status` should go
`uploading → uploaded → transcoding → ready`.

`workers/media-api/.dev.vars` must exist — copy it from
`workers/media-api/.dev.vars.example`, which documents every transcoding
variable. **Wrangler reads `.dev.vars` at worker start**: if you edit it,
restart the worker rather than assuming a hot reload took.

---

## The four hops

```
[1] browser upload
      → content-api (:4001)   registers media, R2 PUT, status uploading → uploaded
[2] content-api → media-api   POST {MEDIA_API_URL}/internal/media/:id/transcode
                              HMAC-SHA256 via workerFetch(…, WORKER_SHARED_SECRET)
[3] media-api → container     POST {RUNPOD_DIRECT_URL}          ← the dispatch
                              inside ctx.waitUntil(), NOT on the request path
[4] container → media-api     POST {TRANSCODING_WEBHOOK_URL}/api/transcoding/webhook
                              HMAC-SHA256 via RUNPOD_WEBHOOK_SECRET
```

| hop | variable | set in | local value |
|---|---|---|---|
| 2 | `MEDIA_API_URL` | `workers/content-api/wrangler.jsonc` | `http://localhost:4002` |
| 2 | `WORKER_SHARED_SECRET` | both workers' `.dev.vars` | must match |
| 3 | `RUNPOD_DIRECT_URL` | `workers/media-api/.dev.vars` | `http://127.0.0.1:8010/run` |
| 4 | `TRANSCODING_WEBHOOK_URL` | `workers/media-api/.dev.vars` | `http://host.docker.internal:4002` |
| 4 | `RUNPOD_WEBHOOK_SECRET` | `workers/media-api/.dev.vars` | must match ↓ |
| 4 | `WEBHOOK_SECRET` | `infrastructure/runpod/local.env` | must match ↑ |

Storage, from the container's side (`local.env`): `R2_ENDPOINT` points at
`http://host.docker.internal:4100` — **dev-cdn**, which exposes an
S3-compatible interface over Miniflare R2 so boto3 works unmodified.
`B2_ENDPOINT` points at MinIO on `:9000` for mezzanine archival.

There is exactly one dispatch call site in the repo (`grep -rn
"triggerJobInternal"`), so there is never a second path to rule out.

---

## Why the container does NOT use `--rp_serve_api`

This is the single most important thing on this page.

runpod-python ships a local test server (`python handler/main.py
--rp_serve_api`). Its `/run` route **never invokes your handler**. From
runpod 1.12.0 `rp_fastapi.py`:

```python
async def _sim_run(self, job_request):
    assigned_job_id = f"test-{uuid.uuid4()}"
    job_list.add({...})                                  # stash only
    return {"id": assigned_job_id, "status": "IN_PROGRESS"}
```

It appends the job to a list and returns. Work happens only in `_sim_runsync`,
or in `_sim_status` when something later polls `GET /status/{id}`.

That leaves no good option against runpod's own server:

| dispatch target | dispatch returns | handler runs? | outcome |
|---|---|---|---|
| `--rp_serve_api` `/run` | instantly, with a job id | **never** | silent no-op. Status sits at `transcoding` forever, no error anywhere. |
| `--rp_serve_api` `/runsync` | only after the full transcode | yes | trips the 30s dispatch timeout (below) on anything non-trivial |

Neither failure prints anything useful, which is why this pipeline has read as
"the transcoding service isn't receiving anything" more than once. It *was*
receiving the request and discarding it.

**Production has neither problem**: RunPod's cloud `/run` queues the job and
returns in under a second, so `/run` + `waitUntil` is correct there.

So the container serves **`local_server.py`** instead, which reproduces the
cloud contract: accept the job, return an id immediately, transcode on a
background thread, and let the handler post its own completion webhook. Local
and production then use the identical `/run` path and the identical semantics.

`handler/main.py` guards its `runpod.serverless.start(...)` under
`if __name__ == "__main__":` purely so `local_server.py` can import `handler`
without starting the serverless loop. Production is unaffected — its CMD is
`python3 -u handler/main.py`, so the guard still fires.

---

## The 30-second dispatch ceiling

`media-api` dispatches inside `ctx.executionCtx.waitUntil(...)` with
`AbortSignal.timeout(30_000)` (`packages/transcoding/src/services/transcoding-service.ts`,
`dispatchRunPodJob`). Two independent 30s limits apply:

- `AbortSignal.timeout(this.runpodTimeout)` — 30 000 ms, hardcoded.
- `ctx.waitUntil` itself — Cloudflare documents a **30 second** limit after the
  invocation ends, shared across all `waitUntil` calls; over it, tasks are
  cancelled.

If the dispatch has not returned by then, the fetch aborts and the `catch`
calls `markTranscodingFailed(...)` — marking the media **failed while the
container is still successfully transcoding it**. Measured with a blocking
`/runsync` dispatch on 2026-08-21: abort at exactly t+30s, `markTranscodingFailed`
attempted, the media saved from a wrong `failed` only because that UPDATE
happened to fail too (the "Double failure" branch).

An asynchronous `/run` never gets near this, which is the main reason
`local_server.py` exists. **Do not point `RUNPOD_DIRECT_URL` at a blocking
endpoint.**

Diagnostic signature, worth memorising:

| observed state | means |
|---|---|
| `transcoding` + `runpod_job_id` NULL + no error | dispatch never completed — cancelled `waitUntil`, or the worker died mid-flight |
| `uploaded` (rolled back) | dispatch failed fast and cleanly |
| `failed` + error text | dispatch or transcode failed and reported |
| `transcoding` forever, job id set | dispatch succeeded but the handler never ran (the `--rp_serve_api /run` stub) |

---

## Multipart uploads

boto3 switches to multipart automatically above
`TransferConfig.multipart_threshold` (8 MB default), so the handler uses it for
any HLS output of consequence — a single-file `stream.ts` for a 47 MB source is
well over the line. `dev-cdn` therefore implements the S3 multipart routes
(`POST ?uploads`, `PUT ?partNumber&uploadId`, `POST ?uploadId`,
`DELETE ?uploadId`) on top of R2's binding API. Before that existed, every
local transcode of real-sized media died with:

```
An error occurred (405) when calling the CreateMultipartUpload operation: Method Not Allowed
```

This was deliberately **not** fixed by raising the threshold in the Python
handler: production genuinely uses multipart against real R2, and a local path
that never exercised it would hide multipart bugs until they reached prod.

---

## Verifying it, and traps

**Ports.** The container listens on 8000 internally and is published on
**8010**, because host 8000 is frequently taken by unrelated services. If you
change this, change `RUNPOD_DIRECT_URL` to match.

**Loopback works.** `workerd` under `wrangler dev` can fetch `127.0.0.1`
(verified 2026-08-21). Prefer it to a LAN IP, which breaks whenever the DHCP
lease changes.

**Verify the process, not the port.** A dead `pnpm`/`turbo` parent can leave its
`workerd` child holding the port, so "port 4002 is listening" does not mean your
current code is serving it. Probe `GET /health` and check the worker's own log
for its startup banner. To clear everything:

```bash
ps -eo pid,command | grep "development/Codex" \
  | grep -Ei "wrangler|workerd|miniflare|turbo run dev" | grep -v grep \
  | awk '{print $1}' | xargs -r kill -TERM
```

**Probes that work.**

```bash
# container is alive and how many jobs it has seen
curl -s http://127.0.0.1:8010/health

# dev-cdn serves a source object (S3 mode — what the container uses)
curl -sI http://127.0.0.1:4100/codex-media-test/{creatorId}/originals/{mediaId}/media.mp3

# run one job by hand, synchronously, bypassing media-api entirely
curl -s -X POST http://127.0.0.1:8010/runsync -H 'content-type: application/json' \
  -d '{"input":{"mediaId":"…","type":"audio","creatorId":"…","inputKey":"…",
        "webhookUrl":"http://host.docker.internal:4002/api/transcoding/webhook"}}'
```

`local_server.py` leaves uvicorn **access logging on**, so `docker logs
codex-transcoder` shows every request. With `--rp_serve_api` it did not: a POST
that returned 200 produced no log line, making a working dispatch
indistinguishable from one that never left the worker.

**A stuck row cannot simply be re-triggered.** `triggerJobInternal` refuses
anything whose status is not `uploaded` (`InvalidMediaStateError`). Reset first:

```sql
UPDATE media_items
   SET status = 'uploaded', runpod_job_id = NULL, transcoding_error = NULL,
       transcoding_attempts = 0, transcoding_progress = 0
 WHERE id = '…';
```

**Never `pnpm test` from the repo root.** `.env.test` points `DATABASE_URL` at
the local **dev** database and `cleanupDatabase()` deletes real rows. Scope it:
`pnpm --filter web test`.

**Local migrations** are `pnpm db:local:migrate`. `pnpm db:seed` and
`pnpm db:reset` TRUNCATE.
