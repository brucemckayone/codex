# Continuation — ship the journey builder unification

Paste this whole file as the first message of a fresh session.

**Not in scope: the local transcoding dispatch.** That shipped as PR #448 and is
merged into this branch. Its reference doc is `infrastructure/runpod/LOCAL_DEV.md`
and it is accurate — read it if transcoding misbehaves, don't re-derive it.

---

## Where you are

**Worktree:** `/Users/brucemckay/development/Codex-js-foundation`
**Branch:** `feat/journey-builder-unification` — **12 commits, UNPUSHED, no upstream**
**Base:** `dev@cf84ac4f` (PR #448). Verified an ancestor of HEAD, so no rebase is owed.

**Re-read the tip before doing anything:** `git log --oneline -1`. Expect
`446c4695`. Naming a stale tip in a handover has bitten this programme
repeatedly, and twice this session I made claims from truncated output that were
simply wrong — see *How I got things wrong* below, it is the most useful section
here.

```
446c4695 fix(player): choose the HLS path by capability, not by canPlayType's opinion
28e5daba fix(player): the modal and hero destroy the HLS player, not the handle it came in
b6433fc1 fix(journeys): the cover upload submits FormData, because a File cannot be a command() argument
e208fc70 merge(dev): pick up #448, the local transcoding dispatch fix
c42868fb refactor(journeys): delete render-edit/, and re-point the guards that held it
a2dad399 fix(journeys): the builder canvas loads the palette its class promises
189dd9f0 docs(journeys): continuation prompt for the remaining consolidation
b5cf1da1 docs(transcoding): handover for the local dispatch investigation
3d4e10bf fix(journeys): the invite offers one dashboard link to a member, not four prices
70b6ab3e feat(builder): the generic array control — repeater, list, number and toggle
314c704e fix(journeys): the canvas applies the page's brand overrides too, scoped off the chrome
b1eeb659 feat(journeys): the builder canvas renders the real sections, axes and all
```

---

## Task 1 — push, and open ONE PR to `dev`

The repo owner already made this call: *finish the deletion first, then one PR.*
The deletion is done (`c42868fb`), so the PR is the remaining step. It was not
opened only because the session kept finding real bugs worth including.

- `gh pr create --base dev` — and **check the base on the created PR** rather
  than trusting the default. Base is `dev`, never `main`.
- Prefer a **merge commit over a squash**: each message records the measurement
  that justified the change, and those measurements are the value.
- CI notes, both previously mistaken for failures:
  - The workflow runs twice (push + pull_request). **Trust the `pull_request`
    run.** The push run gets cancelled by concurrency and `gh pr checks` shows
    `cancelled` in its `fail` bucket. A `0s` duration next to `fail` is the tell.
  - **`Ecom API Tests` fails and it is not yours.** `Codex-4y8pt` (P1, open) —
    `dev` has been red on it since 2026-07-31 with a byte-identical profile.
    `vi.mock('@codex/subscription')` omits `CourseSubscriptionService` in the
    three `workers/ecom-api/src/handlers/__tests__/subscription-webhook*` files.

---

## What shipped, and the three bugs worth carrying forward

`b1eeb659`…`3d4e10bf` are the canvas unification: the builder canvas renders the
real public components through `render/SectionFrame.svelte`, all nine design axes
and page brand overrides included, and the generic array control (`ArrayField`)
makes repeater/list/number/toggle authorable.

`c42868fb` deleted `render-edit/` — 24 files, 1,942 lines, nothing mounting it —
and **re-pointed rather than dropped** the three test guards that read its CSS.
That distinction matters: the lazy fix is to delete the assertions, which turns a
contract guard into a no-op without turning red.

Then three real bugs, each found from a single browser error message. These are
the durable lessons:

### 1 · A `File` cannot be a `command()` argument (`b6433fc1`)

`uploadJourneyCover` was a `command()` whose schema held `z.instanceof(File)`.
Command arguments are serialized with devalue, which has no representation for a
`File`, so it threw **`Cannot stringify arbitrary non-POJOs` in the browser,
before any request**. The cover upload had never worked.

The rule was already known and written down three times, in comments, on the
sibling uploads — and the next author did not inherit it. Worse, the only test
touching the path MOCKED the remote function, so the mock accepted a `File` the
real implementation could never transmit. **A stub more capable than the thing it
stands in for hides exactly this class of defect.**
`src/lib/remote/remote-file-uploads.test.ts` now asserts it mechanically, and
resolves schemas passed by NAME as well as inline (the first version read only
inline slices and saw 1 of the 4 real uploads).

Also: the failure branch discriminates on a **string** (`outcome`), not
`success: boolean`. `apps/web` compiles with `strictNullChecks` off, where a
boolean-literal discriminant does not narrow a union — `SubscribeButton.svelte`
carries two pre-existing svelte-check errors of exactly that shape.

And `enhance`'s callback is `{ form, data, submit }` at `@sveltejs/kit` 2.55,
where `form` IS the element. The `{ element, result }` shape the published docs
describe is a later version. **Check the installed version, not the docs.**

### 2 · Destroy the player, not the handle (`28e5daba`)

`createHlsPlayer` returns `{ hls, cleanup }`. `IntroVideoModal` and
`HeroInlineVideo` assigned that handle to a variable typed `Hls | null` and
called `.destroy()` on it → `TypeError: hlsInstance?.destroy is not a function`.
The TypeError was the visible half; the damage was that **neither teardown ran**,
so every open leaked an hls.js instance whose worker kept fetching segments, plus
the Safari native `error` listener. `AudioPlayer`/`VideoPlayer` had it right all
along; all four now read the same way.

**svelte-check had been reporting it in both files.** Those were 2 of the 65
errors this programme's handovers describe as *"dev's pre-existing baseline, NOT
a regression. Do not 'fix' it."* They were not cosmetic. The baseline is now
**63 errors / 37 warnings**, and both departures were live defects. A type error
on a lifecycle call deserves reading before it is accepted into a tolerated set.

### 3 · `canPlayType` says `'maybe'` and means `'no'` (`446c4695`)

The big one. `supportsNativeHls()` tested
`canPlayType('application/vnd.apple.mpegurl') !== ''` and was consulted FIRST.
Chrome answers **`'maybe'`** — it recognises the MIME type and cannot play it —
so that read as native support, assigned the manifest to `video.src`, and hls.js
was never constructed. Measured in Chrome 151 on the real page:

```
canPlayType('application/vnd.apple.mpegurl')   'maybe'
Hls.isSupported()                              true
MediaSource.isTypeSupported('video/mp2t')      true
video.error.code                               4     (MEDIA_ERR_SRC_NOT_SUPPORTED)
video.src                                      …/preview/preview.m3u8
```

This broke **every** video and audio surface in the app — all four consumers of
`createHlsPlayer` — on **every** Chromium browser, for all media. It presented as
a media problem ("errors on valid media",
`NotSupportedError: The element has no supported sources`), and two days went
into hunting missing bytes because of it.

Now capability-first: hls.js whenever `Hls.isSupported()`, Safari included (where
it also buys precise per-segment status, so an expired-URL 403 is
distinguishable from a flaky network). The element's own HLS support is the
fallback, for iOS Safari before managed Media Source. `hls.test.ts` pins the
decision table and the two path-selection cases were **proven** to fail against
the old ordering.

**Verified in a browser**, `of-blood-and-bones/pricing-smoke-test`, after
uploading and transcoding a real 43.5 MB file through the local pipeline:
`currentSrc` a `blob:` URL (MSE, not the manifest) · `readyState` 4 ·
30.05 s / 1280×720 · `currentTime` advancing 2.5 s per 2.5 s wall clock ·
buffered 0.0–30.1 s · `video.error` null · **0 console errors**.

---

## The environment, and the one thing that will waste your time

### Fleet

Ten ports, all of which MUST serve from this worktree (contract A23):
`3000` web · `42069` auth · `4001` content-api · `42071` organization-api ·
`42072` ecom-api · `42073` admin-api · `42074` identity-api ·
`42075` notifications-api · `4002` media-api · `4100` dev-cdn.

At handover: **10/10 up, pgid `59888`**, transcoder container up.

`pnpm dev` from a Claude Code background task **gets its process group killed**
after a few minutes — twice, sandboxed and unsandboxed alike. Launch it detached
in its own session instead:

```bash
LOG=/tmp/fleet.log; : > "$LOG"
LOG="$LOG" /usr/bin/python3 -c '
import os, sys
log=os.environ["LOG"]
if os.fork()>0: sys.exit(0)
os.setsid()
if os.fork()>0: sys.exit(0)
os.chdir("/Users/brucemckay/development/Codex-js-foundation")
fd=os.open(log, os.O_WRONLY|os.O_APPEND|os.O_CREAT)
os.dup2(fd,1); os.dup2(fd,2); os.close(0)
env=dict(os.environ); env["PATH"]="/Users/brucemckay/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
os.execve("/Users/brucemckay/.npm-global/bin/pnpm",["pnpm","dev"],env)
'
```

It survives the session, so it must be stopped deliberately:
`kill -TERM -<pgid>`. **Verify the per-port cwd, not just that a port is open** —
a stale `workerd` child of a dead parent keeps its port, and the primary `Codex`
clone had orphaned `pnpm dev:media-api` / `dev:dev-cdn` processes serving 4002
and 4100 from the WRONG checkout at the start of this session. Symptom is
indistinguishable from a broken feature.

Transcoder: `pnpm dev:transcoder:build` once, then
`docker run -d --rm --name codex-transcoder --env-file local.env -p 8010:8000 codex-transcoder-local`.
`-d` so Docker supervises it rather than your session. `docker stop codex-transcoder`.

### THE DATABASE AND R2 ARE FROM DIFFERENT GENERATIONS

This is the thing to internalise before debugging any media.

- **957 media rows are `ready`. Exactly 7 carry an `hls_preview_key`.**
- The R2 store holds **7,225 objects**, 62 media with HLS, 47 with a master plus
  real segments, 28 with a genuinely playable preview — and **none of those 28
  exists as a `media_items` row.** The DB was reseeded (`db:seed` / `db:reset`
  TRUNCATE), so its rows carry keys for objects that were never written for them.
- Several seeded media have a `master.m3u8` and per-rendition `index.m3u8` but
  **no `.ts` segments**. The playlist serves 200 and the segment 404s, which
  reads exactly like a player bug. **Always follow a manifest to its segments.**

So a green `Ready` badge is not evidence the bytes exist. The check that settles
it:

```bash
docker exec neon-postgres-1 psql -U postgres -d main -t -A \
  -c "SELECT hls_preview_key FROM media_items ORDER BY created_at DESC LIMIT 1;"
# then fetch that key AND the segment its playlist names, through dev-cdn:4100
```

**The one media that is consistent end to end** is
`fc84b8cb-87b0-45cf-8b65-aadd8a55d4bd` — "10-min-guided-meditation", 717 s,
uploaded and transcoded through the local pipeline this session. It is attached
to `of-blood-and-bones/pricing-smoke-test` as both intro and reel, and it plays.

### The R2 store is currently a symlink — and it is a compromise

```
Codex-js-foundation/.wrangler/state/v3/r2  ->  Codex/.wrangler/state/v3/r2   (2.7G)
Codex-js-foundation/.wrangler/state/v3/r2.foundation-backup                  (48M)
```

Only `v3/r2` was redirected, deliberately — `kv`/`do`/`cache` stay local so
sessions survive. The primary clone's store has the seeded course covers and org
branding (they serve 200 as real JPEGs); the 48 M backup has an earlier upload
that the live store lacks. **Neither store has everything.** Undo:

```bash
cd /Users/brucemckay/development/Codex-js-foundation/.wrangler/state/v3
rm r2 && mv r2.foundation-backup r2      # then restart the fleet
```

The proper fix, not yet done, is to MERGE the two rather than point at one.
Miniflare keeps a sqlite index in `miniflare-R2BucketObject/*.sqlite` and blobs
in per-bucket directories, so a hand-merge risks an index disagreeing with its
blobs — transfer through dev-cdn's S3 shim instead, or just re-transcode into
whichever store is live.

---

## The gate

From the worktree root. All four must be green before any push.

```bash
pnpm check:ci
pnpm --filter web check:brand-boundary && pnpm --filter web check:brand-boundary:test
pnpm typecheck --force
pnpm --filter web test
```

Expected, measured at `446c4695`:

| gate | expect |
|---|---|
| `check:ci` | **0 errors**, 179 warnings, 5 infos |
| both brand-boundary | **0** / **0** |
| `pnpm typecheck --force` | **0** — 57/57, **0 cached** |
| `pnpm --filter web test` | **0** — **177/177 files, 2206 tests** |
| `svelte-check --threshold error` | exit 1, **63 errors / 37 warnings** — down from 65; two of those were real bugs, fixed in `28e5daba` |

- **`--force` is not optional.** A cached `FULL TURBO` is not a gate that ran —
  confirm `0 cached`.
- **Capture the real exit code.** `$?` after a pipe to `tail` measures `tail`.
- **`check:ci` reports biome FORMAT diffs as errors, not warnings.** A pre-commit
  hook also rewrites staged files, so re-verify the tip after committing.
- The full suite takes long enough that a 600 s tool timeout can expire — run it
  in the background and wait on the output rather than assuming it hung.

---

## How I got things wrong, so you don't repeat it

Three process failures this session, all of the same shape — **believing partial
output**:

1. **`head -30` on an object listing** → I reported "exactly 4 media items have
   bytes." The store had 7,225 objects. Derive counts in code; never eyeball a
   truncated list and generalise.
2. **A `sqlite3` read of a WAL-locked database returned empty**, and my
   `${n:-0}` turned that silence into "0 objects" — so I declared a media row
   "seeded fiction" when its bytes were present. **Copy the sqlite file before
   reading it**, and treat an empty result as an error until proven otherwise.
3. **Manifest 200 ≠ playable.** I recommended repointing a page at three
   "complete" videos whose segments were 404. Follow the playlist to its
   segments, with a Range request, before calling anything playable.

Two claims to the user had to be retracted because of these. The cost was real:
the actual bug (#3 above) was in the player the whole time.

---

## Beads

Closed this session, each verified against the code rather than a commit
message: **`Codex-28ifd`** (array controls — guarded by
`section-editor-controls.svelte.test.ts`), **`Codex-6nrsk`** (canvas page-level
styling — needed FOUR commits, not the two a handover claimed; the `--jp-*` half
was still broken and closed by `a2dad399`), **`Codex-eqcpz`** (dead canvas
modifier rules — superseded by the deletion, not fixed).

**`Codex-eckbx` carries a status comment you should read before touching it.**
Its 2026-07-27 W1–W8 plan is partly built and reading it as written will cause
someone to re-scope eight items for roughly two. Verified per item: W1 and W2 are
**not** done (a handover claimed they were); W3, W4, W8 are; W5 is partial and
its hazard stands — `section-registry.ts:180` still derives anchors from `type`,
so a type collapse breaks bookmarked `#<type>` anchors. Its TITLE is satisfied
while its remaining substance is W5–W7, so it wants retitling or splitting —
**left for the owner, since the 11 → 8 collapse is explicitly deferred.**

Still genuinely open: `Codex-9tze8` (Candlelit per-type override map, A51),
`Codex-kdsuo` (journey CTA 0.16–0.20 above the AA floor), `Codex-3kqqp` (forbid
CSS math / list-composition on any axis token that can resolve to a keyword).

**Deferred by the owner, do not start unprompted:** the catalogue collapse
11 → 8 (`hero · prose · media · curriculum · proof · guide · faq · invite`). It
carries a jsonb migration over published pages plus the explicit-`anchor` change.

---

## Traps carried forward

**Never a bare `pnpm test` from the repo root.** `.env.test` points
`DATABASE_URL` at the **dev** database and `cleanupDatabase()` deletes real rows.
The gate is `pnpm --filter web test`.

**Never `pnpm db:seed` or `pnpm db:reset`** — they TRUNCATE, and they are why the
DB and R2 disagree. Local migration is `pnpm db:local:gen` / `pnpm db:local:migrate`.

**Page brand overrides must not land on `.jbc-page`.** `tokenOverridesToCssVars`
maps any non-`--brand-` key to `--color-<key>`, so a page's overrides can
re-point the very tokens the in-canvas block tags read. The canvas takes the base
`journey-palette` class and puts the brand declaration on a per-section
`display: contents` wrapper.

**Whatever applies a `journey-palette` class must import `journey-palette.css`.**
`--jp-pole-a` is declared only there, and `surface: tint|panel|invert` resolve
`--jp-sec-bg` down to it. `journey-palette.test.ts` now derives that guard.

**Whatever emits `data-jp-*` must import the axis substrate** — guarded over the
RELATIONSHIP, deriving the emitter from its markup rather than naming a file.

**`svelte-check` and `tsc` disagree.** A `<script module>` type export passes
svelte-check and fails `tsc` with TS2614 — co-locate such types in a `.ts`.

**Zsh, not bash.** Quote globs in `--include=*.css`.

**Playwright can only read files under the repo root** — copy anything from
`~/Downloads` into `.playwright-mcp/` (gitignored) first, and delete it after.

---

## Reference

- Programme spec: `docs/design/journey-sections/` — `README.md` first, then
  `CONTINUE-consolidation.md`. **`02-axis-contract.md` is BINDING.**
- Transcoding: `infrastructure/runpod/LOCAL_DEV.md` — accurate, includes the
  `--rp_serve_api` trap and the 30 s dispatch ceiling.
- Test credentials: `creator@test.com` / `Test1234!` owns `studio-alpha`;
  **`luzura@test.com` / `Test1234!` owns `of-blood-and-bones`** (this password
  was unknown to earlier handovers, which blocked browser checks on the only org
  with brand overrides stored — it works).
- Builder canvas: `http://of-blood-and-bones.lvh.me:3000/studio/journeys/06b45e59-8058-475a-85b8-b0f717948640/page`
- Public page: `http://of-blood-and-bones.lvh.me:3000/journeys/pricing-smoke-test`
  — append `?preview=1` when signed in as an owner, because the plain URL
  redirects enrolled members to `/dashboard`.
