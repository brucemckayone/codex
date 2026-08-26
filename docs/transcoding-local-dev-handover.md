# Handover — local transcoding dispatch: "the service isn't receiving anything"

**Written** 2026-08-21, from `/Users/brucemckay/development/Codex-js-foundation` on
branch `feat/journey-builder-unification`.

**The task for the next session:** a creator uploads media in local dev and nothing
transcodes. Find out where the dispatch stops.

This document separates **what was measured** from **what is inferred**. Do not
treat the hypotheses as findings — two of them contradict standing project notes,
which is the point.

---

## 1. The chain, and where each hop is configured

Four hops. Only the first is user-visible, and only the last produces a result.

```
  [1] browser upload
        → content-api  (:4001)   registers media, R2 PUT, status uploading→uploaded
  [2] content-api → media-api    POST {MEDIA_API_URL}/internal/media/:id/transcode
                                 HMAC via workerFetch(…, WORKER_SHARED_SECRET)
  [3] media-api → container      POST {RUNPOD_DIRECT_URL}          ← the dispatch
                                 in waitUntil, NOT on the request path
  [4] container → media-api      POST {TRANSCODING_WEBHOOK_URL}/api/transcoding/webhook
                                 HMAC via RUNPOD_WEBHOOK_SECRET
```

| hop | var | set in | current value |
|---|---|---|---|
| 2 | `MEDIA_API_URL` | `workers/content-api/wrangler.jsonc:50` | `http://localhost:4002` |
| 2 | `WORKER_SHARED_SECRET` | both `.dev.vars` | `test-worker-shared-secret` (matching) |
| 3 | `RUNPOD_DIRECT_URL` | `workers/media-api/.dev.vars` | `http://192.168.1.132:8010/run` |
| 4 | `TRANSCODING_WEBHOOK_URL` | `workers/media-api/.dev.vars` | `http://host.docker.internal:4002` |
| 4 | `RUNPOD_WEBHOOK_SECRET` | `workers/media-api/.dev.vars` | `local-webhook-secret-for-testing` |
| 4 | `WEBHOOK_SECRET` | `infrastructure/runpod/local.env` | `local-webhook-secret-for-testing` (matching) |

Code map — all line numbers verified on this tip:

- **hop 2 caller** `workers/content-api/src/routes/media.ts:299` — fire-and-forget,
  wrapped in `.then/.catch` that persists failures (see §3).
- **hop 2 receiver** `workers/media-api/src/routes/transcoding.ts:39`
  `POST /internal/media/:id/transcode`, `policy: { auth: 'worker' }`.
- **hop 3** `packages/transcoding/src/services/transcoding-service.ts:214`
  `await fetch(this.runpodApiUrl, …)`.
- **URL construction** same file `:124` — `runpodDirectUrl` is used AS-IS when set,
  otherwise it builds `{runpodApiBaseUrl ?? https://api.runpod.ai/v2}/{endpointId}/run`.
- **service wiring** `packages/worker-utils/src/procedure/service-registry.ts:919`
  reads `env.RUNPOD_DIRECT_URL` and `env.RUNPOD_API_URL`.
- **hop 4 receiver** `workers/media-api/src/routes/webhook.ts:43`.

There is exactly **one** trigger call site in the repo
(`grep -rn "triggerJobInternal"`), so there is no second path to rule out.

---

## 2. Runtime state as left

```
docker ps → codex-transcoder   Up   0.0.0.0:8010->8000/tcp
```

Started manually, NOT via `pnpm dev:transcoder`:

```
docker run -d --name codex-transcoder --env-file local.env -p 8010:8000 \
  codex-transcoder-local \
  python3 -u handler/main.py --rp_serve_api --rp_api_host=0.0.0.0 \
    --rp_api_port=8000 --rp_log_level=DEBUG
```

Verified working:

| check | result |
|---|---|
| image | rebuilt from current source this session (previous image was 4 months old and predated the single-file HLS change) |
| served paths | `/run`, `/runsync`, `/stream/{job_id}`, `/status/{job_id}` |
| `POST /run` via LAN IP | **200**, body `{"id":"test-<uuid>","status":"IN_PROGRESS"}` |
| container → dev-cdn `:4100` | reachable |
| container → media-api `:4002` | reachable |
| container → MinIO `:9000` | reachable (403 = auth reached) |
| binaries | ffmpeg 4.4.2, audiowaveform v1.11.1 |

The dev fleet (`pnpm dev` → turbo, one process tree) serves `lvh.me:3000` plus the
nine worker ports from this worktree. Leave it up; killing the web vite takes the
fleet with it.

---

## 3. The evidence

**Two media items entered `transcoding` today at 13:01 and 13:04 with
`runpod_job_id = NULL`.**

```sql
select left(id::text,8), coalesce(runpod_job_id,'(no job id)'),
       to_char(updated_at,'MM-DD HH24:MI')
from media_items where status='transcoding' order by updated_at desc;
--  45997932 | (no job id) | 08-21 13:04
--  8e306b3e | (no job id) | 08-21 13:01
--  (+6 rows from 07-27, older test data)
```

Status distribution: `ready` 966 · `uploading` 101 · `transcoding` 8 · `failed` 3 ·
`uploaded` 2. The `transcoding_error` column holds nothing recent — the newest
entries are from 2026-07-27 and are visibly test fixtures (`xxxxx` padding,
"Simulated transcode failure").

### Why that combination is the whole clue

Read `transcoding-service.ts` around the dispatch:

- `:160` — refuses unless `media.status === 'uploaded'`.
- `:214` — sets status `transcoding` **before** the fetch, deliberately, because the
  webhook can arrive before the fetch returns.
- `:236-237` — `runpodJobId = (await response.json()).id`.
- `:243` — **on failure it rolls the status back to `uploaded`.**

So a dispatch that *fails* leaves `uploaded`. A dispatch that *succeeds* leaves
`transcoding` **with** a job id — and we know the container returns one, because a
direct probe does.

`transcoding` + NULL job id is neither. It is the signature of the dispatch
**never completing**: the `waitUntil` promise torn down mid-flight, before either
the id was written or the rollback ran.

### What that implies about hop 2

The status flip to `transcoding` happens **inside media-api**
(`triggerJobInternal`). So hop 2 succeeded, and `MEDIA_API_URL=http://localhost:4002`
was fetched successfully from inside workerd.

**This contradicts the standing note that workerd cannot fetch localhost.** Either
the note is wrong for this setup, or something else set that status. Establish which
before relying on either belief — it changes hop 3's prime suspect.

---

## 4. Traps that will cost you an hour each

**`docker logs` cannot tell you whether the container received a request.**
Verified twice: a `POST /run` that returned 200 produced **no log line**, and adding
`--rp_log_level=DEBUG` did not change that. The full log is 7 lines of startup.
Uvicorn access logging is off in this image. An empty log is *not* evidence of
nothing arriving — this is very likely why the symptom reads as "not receiving
anything".

Two probes that **do** work:

```bash
# (a) network counter — proves bytes arrived
before=$(docker exec codex-transcoder sh -c "awk '/eth0/{print \$2}' /proc/net/dev")
# …trigger an upload…
after=$(docker exec codex-transcoder sh -c "awk '/eth0/{print \$2}' /proc/net/dev")
echo $((after - before))   # measured: +571 bytes for one POST /run

# (b) direct probe — confirms the endpoint and the response shape
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"input":{"probe":true}}' http://192.168.1.132:8010/run
# → {"id":"test-<uuid>","status":"IN_PROGRESS"}
```

**Port 8010, not 8000.** Host port 8000 is taken by an unrelated project
(`knowledge-memory-system/ml-services`, native uvicorn, up 32 days — do not kill
it). `pnpm dev:transcoder` in the root `package.json` hardcodes `-p 8000:8000` and
will therefore collide. Start the container with the command in §2 instead.

**`RUNPOD_DIRECT_URL` is gitignored and was added mid-session.**
`.gitignore:11` matches `**/.dev.vars`, so it is in no commit — it exists only on
this machine, and it did not exist when the fleet started. **Wrangler may not have
reloaded it.** If it hadn't, hop 3 would have built
`https://api.runpod.ai/v2/local-dev-not-used/run` with key `local-dev-not-used`.

**Never `pnpm test` from the repo root.** `.env.test` points `DATABASE_URL` at the
**dev** database and `cleanupDatabase()` deletes real rows. The gate is
`pnpm --filter web test`.

**Never `pnpm db:seed` or `pnpm db:reset`** — they TRUNCATE. Local migration is
`pnpm db:local:migrate` (not `pnpm db:migrate`, which does not exist).

**A stuck row cannot simply be retried.** `:160` refuses anything not `uploaded`, so
the 8 rows sitting in `transcoding` will throw `InvalidMediaStateError`. Reset the
status first.

---

## 5. Hypotheses, ranked

**H1 — the dispatch hangs and `waitUntil` is killed. (strongest)**
Fits the evidence exactly: no id, no rollback. workerd caps `waitUntil` at ~30s, and
this project has a recorded case of a worker→worker fetch hanging ~20s against a
host that isn't correctly exposed. Candidate causes: the LAN IP is not routable from
inside workerd, or `192.168.1.132` has changed since it was written.

*Already checked, so do not redo it:* `ipconfig getifaddr en0` still returns
`192.168.1.132`, and `POST http://192.168.1.132:8010/run` from the host shell returns
**200**. The address is correct and the container is listening on it.

That does **not** clear H1. Reachable from the host shell is not the same as
reachable from inside workerd, which is the only caller that matters here.

*Test:* re-upload, and while it is in flight watch the network counter from §4(a). No
delta ⇒ the request never left workerd, and the cause is workerd's own egress rather
than the address. Delta ⇒ it arrived, and hop 4 is the problem.

**H2 — wrangler never reloaded `.dev.vars`, so hop 3 aimed at the real RunPod API.**
Would normally 401 fast and roll back to `uploaded`, which is *not* what we see — so
this is second, not first, unless the request to `api.runpod.ai` hangs (no network
egress) in which case H1 and H2 are the same failure.

*Test:* restart the fleet, re-upload a fresh file, then
`select status, runpod_job_id from media_items order by updated_at desc limit 1`.

**H3 — it reaches the container and hop 4 (the webhook) is what fails.**
The container would then transcode and call back to
`http://host.docker.internal:4002/api/transcoding/webhook`, HMAC-signed. Secrets
match on both sides (§1), and the container can reach `:4002`, so this is less
likely — but it produces the same user-visible symptom.

*Test:* network delta present (§4a) but status still stuck ⇒ look here. Forge a
webhook against `:4002` to test the handler in isolation.

**H4 — the 101 rows at `uploading` never reached hop 2 at all.**
`:160` requires `uploaded`; content-api only promotes `uploading`→`uploaded` when it
sees `status === UPLOADING`. Worth checking whether today's uploads are landing in
`uploading` and stopping there — a different bug wearing the same symptom.

---

## 6. First three moves

1. Restart the fleet so `.dev.vars` is definitely loaded. This settles H2 either
   way and costs one command; doing it first means every later observation is made
   against a known env.
2. Upload one small file with the §4(a) counter running, then read back
   `status, runpod_job_id, transcoding_error` for that media id. Those three fields
   plus the counter delta localise the break to a single hop.
3. If the counter shows no delta, the question becomes "can workerd reach a LAN IP
   at all here" — test that in isolation rather than through an upload, because the
   upload path has three other hops that can mask it.

(The address check is already done — see H1.)

---

## 7. State of the branch (unrelated to this bug, but do not lose it)

`feat/journey-builder-unification`, **4 commits, unpushed, no upstream**, based on
`dev@6c86d756`:

```
3d4e10bf fix(journeys): the invite offers one dashboard link to a member, not four prices
70b6ab3e feat(builder): the generic array control — repeater, list, number and toggle
314c704e fix(journeys): the canvas applies the page's brand overrides too, scoped off the chrome
b1eeb659 feat(journeys): the builder canvas renders the real sections, axes and all
```

Gate green as of the last commit: web **175/175** · `check:ci` **0 errors / 179
warnings** (that warning count is the baseline) · brand-boundary **0** ·
`typecheck --force` **57/57, 0 cached** · `svelte-check` **65 errors, zero in journey
code** (65 is `dev`'s pre-existing baseline — do not try to fix it).

Still open, deliberately not started:

- Delete `render-edit/` (1,942 lines, now inert — nothing mounts it). Blocked on
  re-pointing the axis-contract guards in `journey-design.test.ts` and
  `journey-palette.test.ts`, which assert over its CSS partials.
- Update `Codex-eckbx` — its 2026-07-27 W1–W8 plan is now substantially built, and a
  reader who trusts it will re-scope eight work items for roughly one.
- `Codex-4y8pt` (P1) — `Ecom API Tests` has been red on `dev` since 2026-07-31:
  `vi.mock('@codex/subscription')` omits `CourseSubscriptionService`, 80 tests. Not
  caused by this branch; the failure profile is byte-identical on `dev`.
