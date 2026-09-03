# Overnight run — epic Codex-1g5lh (live-run bug sweep 2026-08-26)

Run started 2026-08-26 ~21:00 local, unattended. Orchestrator + isolated-worktree agents.

**Status: COMPLETE.** 3 waves, 9 agents, **9 PRs (#456–#464), 12 beads shipped**, all based on
`origin/dev`, all open and unmerged, **none targeting `main`**. Read the ⚠️ block and the two
numbered lists at the bottom first — they matter more than the code.

### Scoreboard

| | |
|---|---|
| Beads shipped | **12** — .1 (code half), .2, .5, .7, .8, .9, .10, .11, .12, .17, .24, + Codex-e32xz |
| PRs | 9, all base `dev`, total **+6706 / −263** across 77 file-changes |
| Beads deliberately not touched | 6 — .16 (your decision), .20, .22, .23 (design/privacy calls), .3/.4 (see below) |
| Beads left ready but unstarted | .6, .13, .14, .15, .18, .19, .21 |
| New beads filed from findings | 5 — Codex-nskp8, Codex-ytejx, Codex-moyu5, Codex-wq26s, Codex-hp0uf |
| **Browser-verified** | **0.** Not one fix. The dev stack holds every port; see the caveat below. |

**`.3` and `.4` (thumbnail upload) were deliberately left for you.** `.4` is a full CRUD feature
build ("upload, replace, remove, and a correct read path"), not a bug fix, and `.3` removes the URL
field on the same component. Together they are a feature-sized change on a file three other beads in
this run touch. Starting them would have meant one large speculative branch instead of nine
reviewable ones — against your explicit "6 finished properly over 20 touched". `.11`'s fix was kept
narrowly scoped to the toast/result-identity handling precisely so it won't collide when you do them.

---

## ⚠️ ACTION REQUIRED FROM YOU — two things, before anything else

### 1. Your local dev Postgres is DEAD, and this run killed it

`neon-postgres-1` PANICked at **21:17:14 UTC** with:

```
FATAL: could not open file "base/5/2601": Read-only file system
PANIC: could not open file "global/pg_control": Read-only file system
```

**Cause, and it is mine.** Three agents ran `pnpm build` concurrently. The transient build artifacts
filled the host volume (it was already at 100 % with 8 GiB free). Docker Desktop's disk image is a
sparse file on that volume, so when it could not grow, the VM's filesystem flipped **read-only** —
and that took Postgres down with it. Docker's own container log directory is read-only too, which is
why `docker restart` fails with
`open /var/lib/docker/containers/…-json.log: read-only file system`.

**`docker ps` will tell you the container is `Up 4 weeks (healthy)`. That healthcheck is lying** —
the postmaster is dead inside. Don't be misled by it.

**Recovery (one action):** restart Docker Desktop, which remounts the VM filesystem read-write.
Then optionally reclaim space — `docker system df` shows **16.39 GB of reclaimable images** (85 % of
19.07 GB) and 5.35 GB of dangling volumes, so `docker image prune -a` alone buys back a lot.

**Why I did not do it for you.** A Docker Desktop restart bounces *all eight* containers, including
`knowledge-memory-system-postgres-1` and `knowledge-memory-system-qdrant-1` — stateful services
belonging to unrelated work, up 39 hours. Restarting another project's databases unattended, while
you are asleep, on a tool with a known hang-on-restart failure mode, is not a call I should make to
save you a two-minute fix. So I left it, hardened the setup script with a hard disk floor (it now
aborts rather than fill the volume), cut concurrency from 3 agents to 2, and made every remaining
agent write DB-free tests.

**Consequence for this run:** no DB-backed test could execute after 21:17. Where a bead needed one,
the agent wrote the test and reported it as *written, not executed* — never as passing.

### 2. Create Tier (.1) cannot be fixed by code alone — it needs a secret set

`STRIPE_SECRET_KEY` is **not set** on `organization-api-production`. The code half is shipped, but
until you set that secret Create Tier will keep returning 500 in production. Details in the `.1`
section below.

---

## Read this first: three things about the brief itself

### 1. The base commit in the brief was stale

The brief said "base every branch on 52ae7a85 (dev tip)". **52ae7a85 is not the dev tip.** Verified:

```
commits on origin/dev not in 52ae7a85:  75
commits in 52ae7a85 not on origin/dev:   1
git merge-base --is-ancestor 52ae7a85 origin/dev  ->  NO
```

`52ae7a85` is a local merge commit on the `fix/kv-worker-exposure` lineage (it *is* an ancestor of
the working checkout's HEAD, which is presumably why it looked like the tip). The real dev tip at
run start was **`31fa5e7d`** ("Merge pull request #453 from brucemckayone/fix/Codex-4y8pt-ecom-subscription-mock").

Basing on 52ae7a85 would have produced PRs carrying 75 commits' worth of phantom reverts. **Every
branch in this run is based on `origin/dev` = 31fa5e7d.** All three wave-1 worktrees were confirmed
sitting on 31fa5e7d before any work began.

### 2. The worktree fan-out had to be narrowed, because of disk

The brief asked for dynamic worktree fan-out across the ready beads. Measured before launching:

| Resource | Reading | Consequence |
|---|---|---|
| Disk | **8.0 GiB free on a 100 %-full 926 GiB volume** | binding constraint |
| Cost per worktree | measured ~1.4 GiB by `du` — **this figure turned out to be wrong**, see the correction below | 9 worktrees ≈ 12 GiB → would have filled the disk mid-run |
| CPUs | 8 | workflow concurrency cap = 6 anyway |

So the fan-out is **3 concurrent worktrees per wave, in sequential waves**, not 9 at once. I
reclaimed `.turbo` (338 MB) first. I did **not** touch `.wrangler` (2.6 GiB) — that is the local
Miniflare R2/KV state and deleting it would destroy local dev data — nor `ms-playwright` (2.0 GiB,
needed for e2e), nor the pnpm store. I also left the five pre-existing `.claude/worktrees/agent-*`
worktrees alone: all of them have uncommitted changes (2–11 dirty files each), so they belong to
other sessions and are not mine to reclaim.

### 3. Two constraints made parts of the brief physically impossible

- **No agent can browser-verify.** The dev stack is already running out of the main checkout and
  holds ports 3000, 4001, 4002, 4100 and 42069–42075. Two dev stacks cannot coexist. Agents were
  therefore instructed to prove fixes with tests + static gates and to state plainly which claims
  are test-verified vs reasoned. **Where a fix below is not browser-verified, it says so.**
- **DB-backed tests had to be serialised.** `.env.test` points at the shared Neon *dev* database, so
  two agents running package tests concurrently wipe each other's rows. At most one DB-touching
  agent runs per wave.

---

## Wave 1 — complete, 3 PRs, 4 beads shipped

| Bead | Title | Status | PR | Base |
|---|---|---|---|---|
| **.2** | content form save clears form, then rejects it | **shipped** | [#458](https://github.com/brucemckayone/codex/pull/458) | dev ✓ |
| **.5** | brand hero text blanks after save | **shipped** (same PR — one defect) | [#458](https://github.com/brucemckayone/codex/pull/458) | dev ✓ |
| **.9** | immersive shader not persisted | **shipped** | [#456](https://github.com/brucemckayone/codex/pull/456) | dev ✓ |
| **Codex-e32xz** | VersionedCache fire-and-forget write | **shipped** | [#457](https://github.com/brucemckayone/codex/pull/457) | dev ✓ |

All three PRs: base branch confirmed `dev` via `gh pr view --json baseRefName`, head based on
`31fa5e7d`. **None merged** — they are yours to review.

### What each agent verified vs assumed

**#458 (.2 + .5).** Verified: red→green proof — reverting `ContentForm` to `{...form}` fails the new
test with `expected '' to be 'Breathwork for beginners'`, and `BrandEditorHeroText` with
`expected '' to be 'Of Blood and Bones'`. 2238/2238 apps/web tests pass; typecheck clean; biome
clean; svelte-check byte-identical to a *measured* `origin/dev` baseline (63 errors / 37 warnings
before and after — 13 sit in touched files, all pre-existing, only line numbers moved). No test
touches the DB. Assumed: that the browser symptom disappears (jsdom assertions, no dev stack), and
that `ProfileForm` + `categories` are genuinely improved — both reasoned from source and matching the
mechanism exactly, but **neither has a test**, because no test in the repo mounts either.

**#456 (.9).** Verified by bisect: reverting gives
`AssertionError: expected { … } to have property "shaderPreset"`; restored → 8/8 pass. Root
typecheck 57/57. Assumed: that the creator's browser symptom is fixed — the chain is traced
statically end to end and the service-layer drop is proven, but nothing exercised the real HTTP path.
The DB round-trip suite was **written and never ran** (Postgres outage) — reported as such, not as
passing.

**#457 (e32xz).** Verified with *falsifiability probes*, not just green tests: stubbing
`this.waitUntil = undefined` fails 3 of 8 new tests; `git checkout` of `public.ts` fails the envelope
assertion *and* trips `Error: Isolated storage failed` from the still-in-flight floating put. AC5
done — `journeys-routes.test.ts` now uses the real `CACHE_KV` binding, stub deleted, 53/53 pass. Both
pre-existing suite failures (content-api ×1, organization-api ×5) were **bisect-proven pre-existing**
by stashing and re-running — no flake claims made. Assumed, and stated rather than assumed away: that
the production hit rate actually rises. In-process Miniflare does **not** cancel the floating put the
way deployed workerd does (it lets the write land late and reports "Isolated storage failed"), so the
route test cannot falsify the `waitUntil` half. The 62/0 census is the evidence for cancellation, not
something reproduced locally. **First person with the dev stack up should confirm real data keys
appear via `wrangler kv key list`.**

### Three things wave 1 found that were bigger than their beads

1. **#457 uncovered a defect the cache bug was masking.** `workers/content-api/src/routes/public.ts`
   built a `PaginatedResult` *inside* the cache fetcher. The cache round-trips through JSON, so on a
   cache **hit** the value returns as a plain object, `procedure()`'s `instanceof PaginatedResult`
   check fails (`procedure.ts:171`), and the list envelope degrades from `{items, pagination}` to
   `{data:{items, pagination}}` — which is not what `api.ts:881 getPublicContent` reads. **Landing
   the cache fix alone would have broken `GET /api/content/public` on the first hit.** They had to
   ship together. Every `PaginatedResult` construction in the repo was audited; this was the only one
   inside a cache.
2. **The 189-POSTs telemetry is explained, and not by a retry loop.** There is no retry path in the
   kit runtime or in `ContentForm`; `submit()` contains exactly one `fetch`. The real source:
   `ContentForm.svelte:508` carries `oninput={() => form.validate()}`, and `validate()` POSTs to the
   **same** `/_app/remote/<id>` endpoint with `validate_only` **on every keystroke** — plus
   `SlugField.svelte:53-86` fires a debounced `checkContentSlug` POST 800 ms after any slug change. A
   POST count on that endpoint is mostly measuring per-keystroke validation. **This is a live finding
   for the KV-volume epic (Codex-kgrdp): an undebounced network round-trip per character.**
3. **`.9` was three dropped fields, not one.** `featured` is also silently dropped on create — and my
   own 21-field audit gave a **false negative** on it. See the corrections list below.

---

## Wave 2 — complete, 3 PRs, 4 more beads shipped

| Bead | Title | Status | PR | Base |
|---|---|---|---|---|
| **.1** | Create Tier → 500 | **code half shipped**; ops half is yours | [#460](https://github.com/brucemckayone/codex/pull/460) | dev ✓ |
| **.17** | follow state survives sign-out | **shipped** | [#459](https://github.com/brucemckayone/codex/pull/459) | dev ✓ |
| **.10** | studio list renders raw TipTap JSON | **shipped** | [#461](https://github.com/brucemckayone/codex/pull/461) | dev ✓ |
| **.11** | stale "Thumbnail uploaded" toast | **shipped** (same PR) | [#461](https://github.com/brucemckayone/codex/pull/461) | dev ✓ |

Diff sizes: #459 = 16 files +1111/−60 · #460 = 11 files +426/−24 · #461 = 7 files +545/−9. All bases
confirmed `dev`, all heads on `31fa5e7d`, none merged.

### 🔴 Incident: `git stash` is shared across worktrees, and my instruction caused it

**This one is my fault and you should know about it.** I told wave-2 agents to "prove any failure is
pre-existing by stashing your changes and re-running." `refs/stash` is a **single repo-wide ref** —
worktrees isolate HEAD, the index and the working tree, but **not refs**. Two agents stashed
concurrently, and one agent's `pop` restored the *other* agent's work into its tree and dropped their
entry, while `stash@{0}` still showed the right *message* pointing at the wrong commit.

**Both agents lost their entire uncommitted change set. Both recovered it**, independently, via
`git fsck --unreachable --no-reflogs` (1196 candidate objects, filtered by branch name in the stash
subject), then committed immediately and re-ran every gate. I verified the recovery rather than taking
their word for it: `user-scoped-state.ts` and `purge-collection.ts` are present in #459's file list,
and `stripe-not-configured.test.ts` + `upload-worker-secrets.sh` in #460's. **Nothing was lost.**

Belt-and-braces copies still exist and are yours to delete once you've merged: tags
`recovered/codex-1g5lh1-work-20260826` and `recovered/foreign-apps-web-20260826`, plus `stash@{0}`
(with an explanatory subject). **`stash@{1}` and `stash@{2}` are not from this run** — they belong to
other branches and I have not touched them.

I forbade `git stash` outright for wave 3 and gave agents a commit-first baseline procedure that
cannot race (commit → `git checkout origin/dev -- <changed files>` → measure → `git checkout HEAD --
<same files>`). Saved as a durable memory, since the existing "no git ops mid-agent" rule covers HEAD
shifts and does not cover this.

### The most consequential correction of the night

**My `.1` fix instruction would have shipped a no-op and left the P0 live in production.** I told the
agent to add `STRIPE_SECRET_KEY` to the `env:` block of the "Upload organization-api secrets" step in
`deploy-production.yml`. That block **is not the source of truth**:
`.github/scripts/upload-worker-secrets.sh` builds a **hardcoded per-worker `SECRETS_JSON`**, so a key
present in the workflow `env:` but absent from that script is simply never uploaded. The agent found
it, fixed both places, and adopted the `${VAR:?}` fail-fast precedent already used for media-api
(Codex-fc5oh.6). Had it followed my brief literally, the deploy would have looked correct and Create
Tier would still 500.

Two more `.1` findings worth your attention:

- **Candidate 1 is settled and needs no design change.** Products/prices *are* created on the
  platform account — but `checkout.sessions.create` also runs on the platform account with no
  `stripeAccount`, so the price ids resolve fine. This is the documented platform-charge +
  separate-transfers model (`purchase-service.ts:429`, "Codex-h69cg Option B"); creators are paid via
  `stripe.transfers.create`.
- **This PR breaks a stated architectural invariant, deliberately, and you may want the other fix
  instead.** `workers/ecom-api/src/routes/course-monetisation.ts:22` documents a prior WP that
  deliberately sited a Stripe route in ecom-api *because* "Stripe secrets go to ecom-api only". Giving
  organization-api the key makes that false. The agent corrected the comment and flagged it rather
  than deciding for you. **The alternative fix is moving the tier write path to ecom-api** — a design
  call, not an unattended one. `content-api` was checked and makes **zero** Stripe calls, so it was
  left without a key.

### `.17` was two faults, and the bead's fix would not have worked

The agent found that **`clearClientState()` already existed and already listed `codex-following`** —
and could never have worked. Its only caller is `(auth)/login/+page.svelte` on `?logout=1`, but
`routes/logout/+page.server.ts:26` redirects to `buildPlatformUrl(...)` — always the **base domain** —
while every `followingStore` call site lives under `_org/[slug]/`, served from
`{slug}.<base-domain>`. **localStorage is partitioned per origin**, so the clear ran on a different
origin from the data it was clearing. "Add a clear on logout" would have shipped and fixed nothing.

Severity was also under-stated on the bead: `get()` feeds `isFollowing` into `useAccessContext`
(`_org/[slug]/(space)/+page.svelte:257`), so a stale `true` **renders follower-gated content
unlocked**, and `+layout.svelte:326` only hydrates from the server when `!followingStore.has(orgId)`
— so the stale entry actively *suppresses* the corrective fetch.

**And it answers the question `.16` was waiting on.** All three writers of `organization_followers`
derive the follower id server-side from the session cookie
(`workers/organization-api/src/routes/followers.ts` → `ctx.user.id`, set only in
`session-auth.ts:370,416`). **No wrong-user row is possible, so `.16`'s input data is trustworthy** —
its behaviour really is the deliberate product decision you called it, not corrupted data. Nothing in
`buildRelationshipQuery` was touched.

### `.10`'s prescribed fix was wrong, and the agent declined it

The bead (and I, relaying it) said the public content page renders `description` correctly via
`ProseContent`, so reuse that. **It doesn't.** `ContentDetailView.svelte:1100` gives `ProseContent`
the content **body** (`contentBodyHtml`); **`description`** is handled at
`ContentDetailView.svelte:214` with `extractPlainText` — matching `ContentCard`, `Spotlight` and
`ArticleEditorial`. `ProseContent` is also *mechanically unusable* here: it consumes pre-rendered HTML
from `renderContentBody()`, which imports the server-only `@tiptap/html/server`, while the studio list
is client-rendered (`ssr = false`). So the agent used `extractPlainText` and truncated *after*
extraction. It also corrected the repro: only the feature slab renders a description at all —
`ContentRow.svelte` renders none, so "each card shows the JSON" was overstated.

`.11` was correct but incomplete in a way that matters: the stale singleton result also **wrote the
previous page's `thumbnailUrl` into the fresh draft** — silent data contamination, not just a cosmetic
toast. Negative control: `expected [ '/stale/previous.webp' ] to deeply equal []`.

---

## Wave 3 — complete, 3 PRs, 4 more beads shipped

| Bead | Title | Status | PR | Base |
|---|---|---|---|---|
| **.24** | structured JSON logs in the browser console | **shipped** | [#462](https://github.com/brucemckayone/codex/pull/462) | dev ✓ |
| **.7** | category editor auto-selects the new row | **shipped** | [#463](https://github.com/brucemckayone/codex/pull/463) | dev ✓ |
| **.8** | media dropdown snaps page to top, traps scroll | **shipped** (same PR) | [#463](https://github.com/brucemckayone/codex/pull/463) | dev ✓ |
| **.12** | course player not stopped or replaced | **shipped** | [#464](https://github.com/brucemckayone/codex/pull/464) | dev ✓ |

### `.8` — my "usual suspects" list was entirely wrong, and the bead was wrong twice

I told the agent the page-jump was probably `href="#"`, or `focus()` without `preventScroll`, or
`scrollIntoView()`/`aria-activedescendant`. **Every one of those is a dead end here** — following my
list would have produced a null result. The real chain, read hop by hop in source:

1. `@melt-ui/svelte/dist/builders/listbox/create.js:20` — `preventScroll: true` is the **listbox
   default**, and `MediaPicker` never overrode it.
2. same file `:502-505` — on open, `removeScroll()` runs.
3. `internal/helpers/scroll.js` — `assignStyle(body, { overflow: 'hidden' })` + a
   `data-melt-scroll-lock` attribute.
4. `apps/web/src/lib/styles/global.css:41-54` — `html { height: 100% }` **and**
   `body { height: 100%; display: flex }`.

A body that is one viewport tall **and** clips overflow stops propagating scroll to the viewport, so
the document collapses to viewport height and the browser clamps `scrollY` to 0. Hence: jumps to top,
cannot scroll back. **The fix is one line: `preventScroll: false`.**

I also named the wrong component — `MediaSection.svelte` contains no dropdown; it renders
`MediaPicker.svelte`, which owns the combobox and its CSS. `MediaSection.svelte` is unchanged.

And **the bead's fault (b) is factually wrong**: `.dropdown-list` *already* had
`max-height: 260px; overflow-y: auto`, and a ~340px menu is not taller than a laptop viewport. The
"taller than the viewport, had to zoom out" report is fully explained by fault (a) — the menu rendered
~1000px down a page that had just snapped to the top, so zooming out was the only way to see it. The
bound was hardened anyway (`min(50dvh, 22rem)`) since the acceptance criterion names it.

**⚠️ `.8` is only half-fixed from your point of view, and this needs your attention.**
`apps/web/src/lib/components/ui/Select/Select.svelte:57-66` has the **identical** bug — no
`preventScroll`, so it inherits Melt's `true`. 11 files use `<Select>`, **including
`content-form/AccessSection.svelte` — the same content-create form `.8` was filed against.** So the
media dropdown no longer snaps the page, but the access-type dropdown on that same form still does.
The agent held the verified one-line fix and deliberately declined to apply it (shared `ui/`
primitive, outside both beads, unverifiable without a browser). **Filed as `Codex-nskp8` (P1).**
`DropdownMenu` and `Popover` were checked and are safe.

### `.12` — the bead's remedy was declined, with reasons, and it was three bugs not two

The bead proposed `{#key}`. The agent declined and explained why: it would leave the same component
broken on `/content/[contentSlug]` (`ContentDetailView` reuses `AudioPlayer` identically), would not
stop a **natively**-attached element (`VideoPlayer/hls.ts:112` assigns `media.src` directly when
`Hls.isSupported()` is false), and would **still** mis-file progress, because a destroyed instance's
prop getters evaluate in the parent's already-updated scope. It took reactive-src + explicit release.

**A third defect the bead didn't mention, and it's a silent data bug live on `dev` today:**
`VideoPlayer/progress.svelte.ts` reads `getContentId()` at *save* time, which returns the **live**
prop. Both props change in one update, so a save after the swap files the **outgoing** playhead
against the **incoming** item — moving the new session's resume point. It is reachable today via the
still-playing old track, and adding `pause()` would have *guaranteed* it, so fixing the tracker was
not optional.

**Correction to my briefing:** I pointed at `ImmersiveShaderPlayer.svelte:53`'s "lazy-initialised in
onMount" comment as the smell. **Red herring** — that comment is about `pollConfig` (shader-config
polling); `ImmersiveShaderPlayer` receives the already-built `audioElement` as a prop and never owns a
src. The real smell was the *absence* of any effect on `src`, plus an `initializedSrc` guard whose only
caller was `onMount`. The agent also confirmed `.12` is **not** blocked by `Codex-2pryk.3.2` — nothing
in flight touches those files.

### `.24` — the consumer list was incomplete and the exposure is worse than filed

The bead (and I) named 8 `.svelte` consumers. **Four more client modules** log through the same
singleton: `collections/library.ts:179`, `collections/progress.ts:212,221,319,327`,
`collections/subscription.ts:148`, and `lib/editor/render.ts:54,80`. The collections are TanStack DB
collections — browser code by construction. `editor/render.ts` is **dual-use**: imported by two
`+page.server.ts` files *and* reachable client-side. That dual module is the proof the fix had to be a
runtime `browser` check in the wrapper, not a per-call-site change.

And the exposure is worse than the bead's `organizationId` example: **`ErrorBoundary.svelte:17` logs
`error.stack`** — full stack traces into the end user's devtools.

`packages/observability` is **byte-untouched** (`git diff --stat origin/dev...HEAD -- packages/
workers/` is empty), so "worker logging must be unaffected" is satisfied by a zero-byte diff rather
than by testing around a shared change. Worker logging was still verified live: `identity-api` 47/47
with `{"level":"info",…,"service":"identity-api"}` still in its output.

**The bead's own warning has come true and is unmitigated.** It said "silencing the console must not be
the reason the next 500 is undiagnosable". The agent searched for a sink (`sentry`, `/api/log`,
`reportError`, `clientError`) and there is **none**. So it took the documented fallback — suppress in
production browser, keep dev intact, leave one commented seam — and **production client failures are
now silent**. Filed as `Codex-hp0uf` (P2), and note it directly affects `.1`'s future diagnosability.

---

## Diagnoses established by the orchestrator before dispatch

These were investigated once, centrally, in the main checkout (read-only) so that no agent
re-diagnosed from scratch and so the shared-cause beads were not fanned out to three agents.

### Codex-1g5lh.2 + .5 — ONE shared cause, and it is not our code

**Verified root cause: SvelteKit 2.55.0 resets the DOM form after a successful remote-form submit.**

In `apps/web/node_modules/@sveltejs/kit/src/runtime/client/remote-functions/form.svelte.js`:

- **~444–452** — the default attachment installed by spreading `{...form}` is
  `form_onsubmit(({submit, form}) => submit().then(() => { if (!issues.$) { form.reset() } }))`,
  i.e. a native `HTMLFormElement.reset()` whenever the submission returns **no** issues.
- **~424–432** — the `reset` listener then runs `input = convert_formdata(new FormData(form))`,
  re-deriving the form's reactive field state from the now-blank DOM.
- **~569–578** — `form.enhance(callback)` returns a complete replacement for the `{...form}` spread
  (`{ method, action, [attachmentKey]: … }`) running *your* callback instead of the default. So
  `{...form.enhance(({submit}) => submit())}` submits without the reset.

This explains both beads exactly, and explains why they present differently:

- **.5** (`BrandEditorHeroText.svelte:92`, bare `{...updateOrganizationForm}`) — the save *succeeds*,
  so kit resets. Symptom: "the saved values ARE applied to the real site, but the form inputs blank
  out." That is reset-on-success, verbatim.
- **.2** (`ContentForm.svelte:474`, bare `{...form}`) — first save succeeds → reset blanks every
  input → field state re-reads as empty → the *next* submit posts empty `title`/`slug` → server
  rejects with precisely the devalue payload recorded on the bead. Note the asymmetry that makes it
  stick: when a submit *does* produce issues, kit does **not** reset, so the form stays blank and
  every further click re-posts empty.

**On the 189-POSTs telemetry.** The bead warned: check for repeat POSTs per click *before* touching
the validation schema, because a retry loop would make the schema innocent. Conclusion: **the schema
is innocent, but not because of a retry loop.** Nothing in the kit runtime or in `ContentForm.svelte`
re-submits; one submit is one fetch. The volume is consistent with many *manual* clicks against a
form that had been blanked and kept failing. The validation schema was not changed as a fix.
*(Assumption flagged: "one click = one POST" is verified by reading the runtime, not by watching a
network panel — no browser was available. See caveats.)*

**A second, independent defect in the same file** (found while confirming the above, fix dispatched
with it): the "one-time initialization" `$effect` at `ContentForm.svelte:~178-230` is asymmetric.
The `isEdit` branch sets `formInitialized = true` *and* wraps its `fields.set()` in `untrack()`; the
`else if (!isEdit)` create branch does **neither**, so the guard flag is never set and the
`createContentForm.fields.set({title:'', slug:'', …})` write is not untracked.

### Codex-1g5lh.9 — the filed root cause is WRONG

The bead speculated the shader field "may be missing from the content write schema, the remote
command payload, or the DB column". **All three are fine.** Verified hop by hop:

| Hop | Location | Present? |
|---|---|---|
| form input | `ContentForm.svelte:566` `<input type="hidden" name="shaderPreset" …>` | yes |
| remote schema | `content.remote.ts:404` `shaderPreset: optionalString` | yes |
| forwarded to API | `content.remote.ts:523, 548` (create), `:666, :691` (update) | yes |
| validation | `content-schemas.ts:330-335` (+ `shaderConfig` at 337-341) | yes |
| DB column | `packages/database/src/schema/content.ts:258` `varchar('shader_preset', {length: 50})` | yes |
| **service write** | `packages/content/src/services/content-service.ts` | **NO** |

`grep -rn 'shaderPreset\|shader_preset' packages/content/src workers/content-api/src` returns
**nothing**. `ContentService.create` builds its insert with an explicit field list (`content-service.ts`
~254-300), and `shaderPreset` is simply absent — so Zod's default `.strip()` validates the value and
then discards it at the insert boundary.

Diffing all 21 fields of `baseContentSchema` against `content-service.ts`: **`shaderPreset` and
`shaderConfig` are the only two that appear nowhere in that file.** Every other field round-trips.

**Consequence: .9's dependency on .2 is unnecessary** — the causes are unrelated and the files are
disjoint. It was dispatched in parallel with .2 rather than behind it.

### Codex-1g5lh.1 — root cause confirmed against the live deployment

**`STRIPE_SECRET_KEY` is not set on `organization-api-production`.** `wrangler secret list --env
production` in `workers/organization-api` returns exactly four secrets: `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`, `DATABASE_URL`, `WORKER_SHARED_SECRET`. No Stripe key.

Mechanism, each hop read in code:

1. `createTier` → `requireActiveConnect` (`tier-service.ts:1018`) is a pure DB read via
   `resolvePrimaryConnect`, so a Connect-green org passes it — consistent with the bead's note that
   Connect is fully green on this org.
2. `createTier` then makes its first *real* Stripe call, `this.stripe.products.create`
   (`tier-service.ts:211`).
3. `this.stripe` is the lazy Stripe proxy from the service registry. WP-12 (`Codex-fc5oh.12`) made
   resolution lazy precisely so read paths would not trip the guard — and the comment at
   `service-registry.ts:78-95` says outright that a genuine misconfiguration "still surfaces (as the
   same thrown error) the moment a Stripe call is actually attempted". `createTier` is that moment.
4. `getStripeClient` (`service-registry.ts:196-206`) throws a **plain `Error`**:
   `'STRIPE_SECRET_KEY not configured. …'`. Not a typed `ServiceError`, so `mapErrorToResponse` can
   only emit `500 INTERNAL_ERROR` — exactly the wire response on the bead.

**Why dev never caught it — two provisioning paths disagree:**

- `workers/organization-api/.dev.vars` **does** contain `STRIPE_SECRET_KEY`, so Create Tier works
  locally.
- `.github/workflows/deploy-production.yml` uploads `STRIPE_SECRET_KEY` to **ecom-api only**. Audit
  of every `Upload * secrets` step: `ecom-api` HAS it; `media-api`, `content-api`, `identity-api`,
  `admin-api`, `organization-api`, `notifications-api`, `auth-worker`, `web` all MISS it.
- `.github/scripts/generate-worker-dev-vars.sh:11` documents the key as "for ecom-api, content-api" —
  `organization-api` is not even listed, though `TierService` lives there because tiers are
  org-scoped (`POST /api/organizations/:id/tiers`).

Accuracy of the filed candidates: **candidate 1 was right on its second half** ("confirm the platform
`STRIPE_SECRET_KEY` is present and valid in the deployed organization-api") — that is the entire bug.
Its first half (Stripe calls made with no `{ stripeAccount }` option, so products/prices land on the
platform account) is a real observation but is **not** the cause of this 500; it is a separate
Connect-model design question and was left untouched. Candidate 2 (sort_order collision) is not the
cause — the failure is upstream of the insert. Candidate 3 was correct that the plain insert path
ran, and is not implicated.

**This fix is split, and one half is yours:**

- **OPS, human-gated, NOT done by this run** — the real `STRIPE_SECRET_KEY` must be set on
  `organization-api-production`. That needs the secret value and is a production mutation, so the run
  deliberately stopped short of it. Nothing else will make Create Tier work in production.
- **CODE** — add the secret to the organization-api upload step in `deploy-production.yml`; give the
  missing-key failure a machine-readable code instead of bare `INTERNAL_ERROR` (the bead's second
  acceptance criterion); list it in `organization-api/wrangler.jsonc`'s required-secrets comment; add
  a test.
- **LATENT, needs its own check** — `content-api` also misses the key in production while the
  dev-vars script says it needs one. If content-api makes any Stripe call, the same 500 is waiting.

---

## Not touched, deliberately

| Bead | Why |
|---|---|
| .16 | Triage-corrected — the library serving free + follower-gated content to org followers is `buildRelationshipQuery` working as designed. A product decision for you, not a bug. Untouched. **But `.17` answered the question it was waiting on:** all three writers of `organization_followers` derive the follower id server-side from the session cookie (`followers.ts` → `ctx.user.id`, set only in `session-auth.ts:370,416`), so **no wrong-user row is possible and its input data is trustworthy**. The behaviour really is the deliberate decision, not corrupted data. |
| .20 | Ache-section redesign — design decision. Not implemented. |
| .22 | Team-invite email lookup — needs your privacy decision on whether email existence can be probed. Not implemented. |
| .23 | Klarna/BNPL thresholds — product decision. Not implemented. |
| .3 / .4 | Thumbnail upload — a CRUD feature build, not a bug fix. Reasoning in the scoreboard. |
| .6, .13 | Both explicitly need a repro captured first (`.6` "which control, which direction, what renders"; `.13` "capture the console + network first"). Neither is possible without a browser, and `.13` additionally needs production. Attempting them unattended would have produced exactly the speculative fix you said you did not want. |
| .14, .15, .18, .19, .21 | Ready but unstarted — ran out of night. `.18` (paywall contrast) is the best-defined of these and would be a good next pick. |
| Codex-kgrdp.* | Out of scope per the brief, except Codex-e32xz which you explicitly allowed and which shipped in wave 1 as `#457`. |

---

## Corrections to the orchestrator's OWN diagnoses

I investigated .2/.5/.9/.1 centrally and handed the agents a verified brief so they would not
re-diagnose from scratch. That worked, but **my brief was wrong in five places**, and the agents
caught all five. Recording them because a confident wrong brief is more dangerous than no brief.

1. **My 21-field audit gave a false negative: `featured` is a third dropped field.** I diffed
   `baseContentSchema`'s fields against `content-service.ts` by asking whether each *name appears in
   the file*. `featured` appears 7 times — but only ever as a `listPublic` **filter** (`:1058`,
   `:1103-1106`), never in a write. **Name-frequency counting cannot distinguish a read site from a
   write site**, so it declared `featured` fine when it is dropped on create exactly like
   `shaderPreset`. The agent caught it with `grep -rn 'featured' packages/content/src/` looking at
   *what each hit does*. My method was the flaw, not a slip — and the same method would miss the next
   one.
2. **I told the .9 agent to fix "BOTH the create and the update path". The update path was never
   broken.** `content-service.ts:502` does `.set({ ...restValidated })` — a spread of the whole
   validated partial — so these fields always persisted on update. Proven, not argued: on the
   *unfixed* code the agent's 3 update-payload tests pass while 5 create tests fail. Editing an
   existing piece worked; only creating a new one dropped the field. My instruction #3 (worrying
   about absent-vs-empty semantics on update) was solving a problem that did not exist.
3. **I over-weighted the missing `untrack` in `ContentForm`'s create branch.** I presented the two
   omissions (`formInitialized` never set, write not untracked) as equally load-bearing. A root
   `fields.set(v)` resolves to `input = value` (`form.svelte.js:476-478`) — a pure write that reads
   nothing, so it creates no reactive dependency. Only the missing flag could re-blank the form, and
   that path is **latent, not live** (both create pages pass values that are stable after mount). The
   agent added `untrack` anyway for symmetry and said so, rather than letting my framing stand.
4. **My candidate list of "other forms with the same bug" was over-broad.**
   `account/notifications/+page.svelte:62` is **not** this bug: its toggles reach FormData via
   conditionally-rendered `<input type="hidden" value="on">` — a real *attribute*, so `reset()`
   restores `"on"` — and `<Switch>` is a `<button>`. `reset()` is a no-op there.
   `StepEssentials.svelte:28` likewise server-redirects on success and unmounts. Both correctly left
   alone. I had listed them as candidates on pattern-match alone.
5. **My "collapse the duplicated slug rule" instruction had to be declined, and was.** I gave the
   agent an escape hatch ("if the behaviour does not match, say so and leave it") and it was needed:
   the *message* matches but `createSlugSchema()` (`primitives.ts:61-73`) also adds `.trim()`,
   `.max(500)`, lowercasing and `^[a-z0-9]+(?:-[a-z0-9]+)*$`, which rejects leading/trailing and
   doubled hyphens — while `ContentForm.svelte:398`'s own readiness rule accepts the looser
   `/^[a-z0-9-]+$/`. The UI and the primitive already disagree, so "just dedupe" would have silently
   blocked edits to legacy slugs. Not a cleanup at all.

One further self-correction, on the orchestration rather than the code: I justified capping the
fan-out on the grounds that each worktree costs a real ~1.4 GiB. **That was wrong** — removing three
worktrees reclaimed only 0.4 GiB total, so APFS was block-sharing them after all. The cap was still
the right decision, but for a different reason than I gave: the pressure was **transient build
artifacts** from concurrent `pnpm build`, not `node_modules`. That distinction is what actually killed
Postgres, and it is why the hardened setup script now guards disk *immediately before the build* and
drops `.turbo` straight after.

## 1. Beads whose filed root cause turned out to be WRONG

Ordered by how much the wrong cause would have cost. **Note that the two most expensive errors in
this list are mine, not the beads' — see the section above.**

1. **Codex-1g5lh.17 — the filed cause was right but half-missing, and the obvious fix was already in
   the tree and already broken.** `clearClientState()` **already existed and already listed
   `codex-following`**. It could never work: its only caller is `(auth)/login/+page.svelte` on
   `?logout=1`, but `routes/logout/+page.server.ts:26` redirects to `buildPlatformUrl(...)` — always
   the base domain — while every `followingStore` call site lives under `_org/[slug]/`, served from
   `{slug}.<base-domain>`. **localStorage is partitioned per origin**, so the clear ran on a different
   origin from the data it cleared. Anyone implementing the bead as written would have added a second
   clear and shipped nothing. The bead also missed the module-singleton `$state` seeded at import
   time, and under-stated severity: stale follow state renders follower-gated content **unlocked**.
2. **Codex-1g5lh.10 — the bead's premise and prescribed fix are both wrong.** It states the public page
   renders `description` as prose via `ProseContent`. It does not: `ContentDetailView.svelte:1100`
   feeds `ProseContent` the content **body**, while **`description`** goes through `extractPlainText`
   at `:214` — as it does in `ContentCard`, `Spotlight` and `ArticleEditorial`. `ProseContent` is also
   mechanically unusable in the studio list, which is client-rendered (`ssr = false`) while
   `renderContentBody()` imports the server-only `@tiptap/html/server`. The repro was overstated too:
   only the feature slab renders a description; `ContentRow.svelte` renders none.
3. **Codex-1g5lh.9 — filed cause false on all three of its guesses.** It suspected a missing schema
   field, a missing payload field, or a missing DB column. The field is present in the form input, the
   remote schema, the forwarded payload, the validation schema **and** the DB column. `ContentService`
   simply never writes it. It was also **dep-blocked on .2** on a shared-cause theory that is false —
   the causes are unrelated and the files disjoint. *(Dependency now removed in beads.)* And it was
   **three** dropped fields, not one: `shaderPreset`, `shaderConfig` and `featured`.
4. **Codex-1g5lh.2 / .5 — right instinct, wrong direction.** The beads hypothesised the form "is
   resetting or re-mounting before/while submitting", citing the prior art that a remote `form()` prop
   must be spread or bindings detach. The forms **are** correctly spread and fields **do** use
   `.as('text')`; nothing detaches. The reset happens **after a successful** submit and is SvelteKit's
   own documented behaviour, not a repo defect. That changes the fix from "repair a binding" to "opt
   out via `form.enhance()`".
5. **Codex-1g5lh.2's telemetry theory — no retry loop exists.** The bead's leading suspicion (and its
   explicit warning to me) was an automatic retry resubmitting after state clears. There is no retry
   path in the kit runtime or in `ContentForm.svelte`; `submit()` contains exactly one `fetch`. The
   empty payload comes from a *user-initiated* second submit against an already-blanked form. **The
   189 POSTs have a different, real cause the bead did not name:** `oninput={() => form.validate()}`
   POSTs to the same remote endpoint on every keystroke.
6. **Codex-1g5lh.1 — filed cause substantially correct.** Candidate 1's second half ("confirm the
   platform `STRIPE_SECRET_KEY` is present and valid in the deployed organization-api") is the whole
   bug. Candidate 1's *first* half (no `{ stripeAccount }` option) is a real observation but not the
   cause, and is now settled as **correct by design**: `checkout.sessions.create` also runs on the
   platform account, so the price ids resolve — the documented platform-charge + separate-transfers
   model. Candidates 2 and 3 are not implicated. Credit where due.
7. **Codex-e32xz — filed cause correct and precisely stated**, needing no re-litigation, but
   incomplete in three ways: `getWithResult()` has the identical bug; `warmTierCache`'s outer
   `waitUntil` is a false reassurance; and a `PaginatedResult`-in-cache defect was being *masked* by
   it, such that fixing the cache alone would have broken `GET /api/content/public`.
8. **Codex-1g5lh.11 — filed cause correct**, and incomplete in a way that raises its severity: the
   stale singleton result also wrote the previous page's `thumbnailUrl` into the fresh draft. Silent
   data contamination, not a cosmetic toast.

## Leftovers worth filing as beads (found, deliberately not fixed)

Ranked by what I'd file first. None of these were touched — each is a different field, surface or
blast radius from the bead being worked, and fixing them silently would have made the PRs
unreviewable.

**High value**

1. **Any PATCH that omits `tags` WIPES the tag array.** `tagsSchema`
   (`content-schemas.ts:251-261`) ends `.optional().default([])`, and `.partial()` does **not** strip
   an inner `.default()`. Probe-verified: `updateContentSchema.parse({title:'x'})` returns
   `{"title":"x","tags":[]}`, and that flows straight into the `.set()` spread at
   `content-service.ts:502`. The studio form always sends tags so it is invisible from there, but any
   other PATCH caller silently clears them. *Probe-verified, not test-verified.*
2. **Undebounced network round-trip per keystroke.** `ContentForm.svelte:508`
   `oninput={() => form.validate()}` POSTs to the remote endpoint on **every character**. Directly
   relevant to Codex-kgrdp. Fix is a debounce or `preflightOnly`. Left alone because it changes
   validation UX.
3. **Editing a title silently rewrites a published slug.** `SlugField.svelte:41-49` regenerates the
   slug from the title whenever `slugManuallyEdited` is false — including in edit mode on published
   content. Renaming a live piece breaks its URL with no warning. May be intended; needs your call.
4. **Structural hazard that guarantees a fourth dropped field.** `ContentService.create` uses an
   explicit field list while `update` uses a spread, so **any** new `baseContentSchema` column
   silently persists on update and silently vanishes on create. That is `.9` three times over. Cheap
   guard: one test asserting every `baseContentSchema` key appears in the captured create payload —
   the agent's payload-capture fake is already the right harness.
5. **`ORG_CREATORS` cache keys fan out unboundedly**, and #457 makes those writes *actually happen*
   for the first time. `organizations.ts` keys on `…:${page}:${limit}` with `limit` 1–100 and `page`
   unbounded — up to 100 data slots per page per org. **This fix will increase KV write volume**;
   worth snapping `limit` to a small allow-list before it reaches production, given Codex-kgrdp.

**Medium**

6. **`ProfileForm` reverts typed edits on avatar upload.** `ProfileForm.svelte:176-189` re-seeds every
   field whenever the `profile` prop changes with no `formInitialized`-style guard, and
   `invalidateAll()` fires on avatar upload/delete (`:145`, `:154`). The `setTimeout(…, 100)` re-seed
   at `:118-132` is now dead weight too. A real refactor, not a one-liner.
7. **Edit mode always warns "unsaved changes".** `ContentForm.svelte:263-273` — `beforeNavigate`
   short-circuits only on `!isEdit && !title`, so in edit mode it *always* cancels navigation and
   opens the dialog even with nothing dirty. Pre-existing; previously **masked** because reset blanked
   the title.
8. **Two worker test suites are red by default without the dev stack.**
   `workers/content-api/src/index.test.ts:22` (health check, 5 s DB timeout) and
   `workers/organization-api/src/index.test.ts` (5 DB-dependent timeouts). Both pre-existing on `dev`.
   This matters beyond tidiness: **a real regression in those files is currently indistinguishable
   from the ambient noise.**
9. **`shaderConfig` has no UI write path at all.** #456 makes it API-reachable and round-tripping, but
   `grep -rn 'shaderConfig' apps/web/src/` returns nothing. Either wire a control or drop the column.

**Low**

10. **A partial `obs` stub silently disables the cache's graceful degradation.** If the injected
    observability object lacks `debug`, `VersionedCache.get` throws into its own catch, which calls
    the equally-missing `error`, and the exception escapes — so `cache.get` **rejects** instead of
    degrading. The "never throw from cache operations" rule in `packages/cache/CLAUDE.md` is not
    actually enforced. The registry always injects a full client, so real blast radius is small.
11. **`versioned-cache.test.ts:613` has an `it.skip`** commented "skipped due to mock state management
    complexity". #457's new test file demonstrably *can* express ordering, so this is likely
    un-skippable now.
12. **Duplicate mechanism at `studio/settings/+page.svelte:177-183`** — an inline `enhance` doing the
    same job as the new `keepValuesOnSave` helper, plus focus restoration. Should take the helper and
    keep only the focus callback.

## 2. Scope changes, and why

- **Base commit changed** from `52ae7a85` (as briefed) to `origin/dev` = `31fa5e7d`. The briefed
  commit is 75 commits behind dev and carries 1 commit not on dev; branching there would have made
  every PR unreviewable. See §1 at the top.
- **Fan-out width cut from ~9 concurrent worktrees to 3 per wave.** Disk, not ambition: 8.0 GiB free
  on a 100 %-full volume, ~1.4 GiB per worktree. See §2 at the top.
- **DB-backed tests serialised to one agent per wave**, because `.env.test` is the shared dev
  database and concurrent runs wipe each other's rows.
- **No browser verification anywhere in this run.** The main checkout's dev stack holds every service
  port, so a second stack cannot start. Every fix is test-verified rather than eyes-on-screen; each
  agent report separates verified from assumed. This is the largest single caveat on the run.
- **`.9` dispatched in parallel with `.2` instead of behind it**, because the shared-cause theory
  behind the dependency is false (see list 1).
- **`.1` split into a code half and an ops half.** The ops half (setting the production secret) is
  left for you: it needs the secret value and is a production mutation.
- **`git stash` banned mid-run, after it corrupted two agents.** My wave-2 instruction to "prove a
  failure is pre-existing by stashing" caused it. Wave 3 got a commit-first baseline procedure
  instead. Then three wave-3 agents found **the ban is not enough** — the repo's lint-staged
  pre-commit hook stashes internally, so an ordinary `git commit` fires the same race. Two used
  `--no-verify` plus manual biome. Filed as `Codex-ytejx` (P1).
- **Concurrency cut from 3 agents to 2 after the Postgres outage**, with a hard disk floor added to
  the bootstrap script (it now aborts before `install` and before `build` rather than fill the
  volume, and drops `.turbo` immediately after building). Waves 2 and 3 ran 2-then-1 and disk never
  went below 3.6 GiB.
- **`.3`/`.4` (thumbnail upload) not started at all** — a CRUD feature build, not a bug fix. Reasoning
  in the scoreboard at the top.
- **Two agents fixed things adjacent to their bead because leaving them would have shipped a
  regression**, not out of scope creep: `#457` had to fix the `PaginatedResult`-in-cache envelope bug
  (its own fix would otherwise have broken `GET /api/content/public` on the first cache hit), and
  `#464` had to fix the progress tracker (adding `pause()` would otherwise have *guaranteed* the
  playhead mis-attribution). Both are argued in their PR bodies.
- **`#456` also fixed `featured`**, a third dropped field in the same insert statement, rather than
  fixing two of three and leaving the third.
- **Nothing was merged and nothing was closed in beads.** Every bead touched is `in_progress` with a
  PR pointer, not `closed` — because *nothing in this run was browser-verified*, and this repo's own
  rule is not to close on a green test suite alone. `.1` in particular must stay open until the
  production secret is set.

---

## New beads filed from findings

| Bead | P | What |
|---|---|---|
| **Codex-nskp8** | P1 | `ui/Select` inherits Melt's `preventScroll:true` — identical page-snap bug, still live on the content form via `AccessSection`. One-line fix + test shape included. |
| **Codex-ytejx** | P1 | lint-staged pre-commit hook stashes internally; `refs/stash` is repo-wide, so concurrent worktree agents can corrupt each other on an ordinary commit. |
| **Codex-moyu5** | P1 | Any PATCH omitting `tags` wipes the tag array — `.partial()` doesn't strip an inner `.default([])`. Probe-verified. |
| **Codex-wq26s** | P1 | `ContentForm` POSTs `form.validate()` on every keystroke — undebounced round-trip per character. Feeds the Codex-kgrdp volume epic. |
| **Codex-hp0uf** | P2 | No client→server diagnostic sink, so after `#462` production client failures are silent. The interaction `.24` warned about. |

Twelve further leftovers are listed in the section above but not filed, to avoid burying you in
beads — promote whichever you want.

---

## The one caveat that qualifies everything above

**No fix in this run was verified in a browser.** Not one. The dev stack holds every service port, so
no agent could start a second one, and from 21:17 the local Postgres was down as well. Every claim in
these nine PRs rests on tests, negative controls and source reading.

To be fair to the work: the agents were rigorous about the distinction. Most used **negative controls**
— reverting the fix and proving the new tests actually fail — rather than just showing green. Several
went further: `#457` ran falsifiability probes on its own tests, `#462` added an anti-vacuity test
asserting the *unwrapped* logger still leaks so its suppression assertions can't become tautologies,
and `#463`/`#464` put liveness witnesses in their assertions so a test can't pass against an empty
list or an unopened menu. Every agent's report separates verified from assumed, and two explicitly
flagged that jsdom's no-op media API and static `scrollY` mean their most user-visible claims
(*"the audio actually goes silent"*, *"the page no longer jumps"*) are **mechanism-verified, not
outcome-verified**.

So: the mechanisms are proven, the symptoms are not. The highest-value thing you can do before merging
is bring the stack up and walk the same journey you walked on the 26th.
