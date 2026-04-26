# Iteration 010 — performance × apps/web

- **Cell**: performance × apps/web
- **Date**: 2026-04-25
- **Mode**: delta
- **Since**: 14 days ago (HEAD = b6a136ca, iter-009 commit)
- **Files churned**: 510 in apps/web/src (filtered to ~50 perf-relevant — server loaders, render-loop components, server cache, collections, hot-path utilities)
- **Agent**: agents/audit-web.md (`{{PHASE}} === 'performance'` branch)
- **Fallow JSON**: `/tmp/denoise-iter-010-fallow.json` (207 issues, mostly types/exports — none structurally relevant to this perf cell)
- **Typecheck baseline**: `/tmp/denoise-iter-010-typecheck-baseline.log` (3 pre-existing TS errors in @codex/worker-utils — unchanged from iter-004 baseline; out of scope)

## Notes / context

- **R12 effectiveness check (first apps/web cycle since R12 promoted iter-008)**: clean. Every server / layout loader inspected this cycle (`_org/[slug]/(space)/+page.server.ts`, `_org/[slug]/(space)/explore/+page.server.ts`, `_org/[slug]/(space)/content/[contentSlug]/+page.server.ts`, `_org/[slug]/(space)/pricing/+page.server.ts`, `_org/[slug]/+layout.server.ts`, `_creators/[username]/+page.server.ts`, `_creators/[username]/content/+page.server.ts`, `_creators/[username]/content/[contentSlug]/+page.server.ts`, `(platform)/discover/+page.server.ts`, `(platform)/account/notifications/+page.server.ts`, `(platform)/account/subscriptions/+page.server.ts`, `lib/server/content-detail.ts`, `(platform)/+layout.server.ts`) follows R12 — independent fetches use `Promise.all`, sequential awaits are guard-then-fetch (creator-id → creator-content) or `await parent()` chained appropriately. **No new R12 violations in apps/web SvelteKit loaders.**
- **`simplification:dup-paginated-list-shape` (iter-009 endemic-density watch)**: not surfaced this cycle. Out of phase scope; ledger entry untouched.
- **`types:as-unknown-as` + `types:as-cast-without-guard` (hits=2 each)**: not surfaced; out of phase scope.
- **Iter-003 F5 (`workers:waituntil-no-catch` in `apps/web/src/lib/server/brand-cache.ts:75`, Codex-ttavz.16)**: still open; observed during this cycle but NOT re-filed (R13 already promoted, recurrence ledger captured).

## Fabrication check

- 12 anti-pattern rows cited across ref 04 (`performance`) + ref 05 (`domain-web`).
- 12 verified live in current code or scope-mismatch (ref 04 §1 `inArray` is server-side and apps/web doesn't host it directly — that's the right placement, not stale).
- 0 stale.

| Citation | Verified | Notes |
|---|---|---|
| ref 04 §3 `$effect` | ✅ 156 hits in apps/web | |
| ref 04 §5 `findMany` | ✅ scope-correct | apps/web doesn't query Drizzle directly; this is a packages/workers concern |
| ref 04 §1 `inArray` | ✅ scope-correct | same |
| ref 05 §3 `*.remote.ts` | ✅ 14 files | |
| ref 05 §4 `localStorageCollectionOptions` | ✅ 9 sites | |
| ref 05 §5 `buildContentUrl` | ✅ 38 sites | |
| ref 05 §6 `export const ssr = false` | ✅ studio/+layout.ts:10 | |
| ref 05 §4 `depends('cache:org-versions')` | ✅ org/+layout.server.ts:28 | |
| ref 05 §4 `depends('cache:versions')` | ✅ (platform)/+layout.server.ts:12 | |
| ref 05 §4 `initProgressSync` | ✅ collections/progress-sync.ts | |
| ref 05 §1 `sanitizeSvgContent` | ✅ packages/validation | |
| ref 04 §2b `@codex/admin import in public route` | ✅ no leakage observed in churn | |

## Findings

### F1 — `performance:hot-path-shader-config-getcomputedstyle` (NEW fingerprint)

- **Severity**: major
- **File:Line**:
  - `apps/web/src/lib/components/AudioPlayer/ImmersiveShaderPlayer.svelte:171`
  - `apps/web/src/lib/components/studio/content-form/ShaderPreview.svelte:80`
- **Description**: Both files call `getShaderConfig(null, ...)` inside their per-frame `renderFrame()` loop (60Hz). `getShaderConfig` (apps/web/src/lib/components/ui/ShaderHero/shader-config.ts:812) reads `getComputedStyle(.org-layout)` and parses 8+ CSS variables (preset, intensity, grain, vignette, primary/secondary/accent/bg). The canonical `ShaderHero.svelte` (lines 135-146) already amortises this with a 30-frame poll counter, but the new immersive overlay + studio preview shipped without inheriting the optimisation.
- **Why it matters**: forced style recalculation is one of the most expensive operations in a render loop. At 60Hz this is up to 60 forced layouts/sec per active immersive player or shader-picker preview — the immersive overlay is the entry path for the audio-player-shader-mode epic (Codex-03rh, completed 2026-04-14) and runs whenever a user enters fullscreen audio. Lifting the `pollConfig` cadence into a shared helper (e.g. `ShaderHero/poll-config.ts`) and reusing it from the two churned consumers removes the cost without changing observable behaviour (brand-editor live updates still propagate within ~0.5s).
- **Proof test form**: Catalogue row 7 — Contract test at the boundary (instrument `getShaderConfig` / spy on `getComputedStyle`, drive 120 frames, assert calls ≤ 6).
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-010/F1-shader-config-hot-path.test.ts`
- **MCP evidence required (R6)**: `chrome-devtools__performance_start_trace` on the immersive overlay route — capture forced-style-recalc count before/after fix.
- **Bead**: TBD (filed at step 7)

### F2 — `performance:hot-path-allocation-render-loop` (NEW fingerprint)

- **Severity**: minor
- **File:Line**:
  - `apps/web/src/lib/components/AudioPlayer/audio-analyser.ts:176-187` (`getAnalysis()` returns fresh 10-key object every call)
  - `apps/web/src/lib/components/AudioPlayer/ImmersiveShaderPlayer.svelte:153-168` (builds fresh `audioState` object literal each frame from the analyser result)
- **Description**: Each animation frame allocates two ~10-property object literals (one inside `getAnalysis()`, one in `renderFrame()`). Combined: 120 ambient allocations/sec per active immersive player, all short-lived (immediately consumed by `renderer.render(...)`). Not catastrophic, but it pressures the GC during the longest hot path in the app (audio playback in immersive mode).
- **Fix shape**: recycle a single buffer in the analyser (mutate fields each call, return same instance); thread it through ImmersiveShaderPlayer without re-wrapping. Ref 04 §7 row 11 (`performance:json-parse-stringify-clone`) and row 13 (`performance:date-new-in-hotpath`) document the same family.
- **Proof test form**: Catalogue row 6 — bench()-style + ref-equality (assert `analyser.getAnalysis() === analyser.getAnalysis()` post-fix).
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-010/F2-render-loop-allocation.test.ts`
- **MCP evidence required (R6)**: `chrome-devtools__take_memory_snapshot` before/after a 60-second immersive playback session — assert minor-GC count drops.
- **Bead**: TBD

### F3 — `performance:render-thrash-list-no-key`

- **Severity**: minor
- **File:Line**:
  - `apps/web/src/routes/_org/[slug]/(space)/+page.svelte:314`
  - `apps/web/src/routes/_org/[slug]/(space)/+page.svelte:449`
- **Description**: Two `{#each feedCategories as category}` blocks render category pills without a `(category.name)` key. Per ref 04 §3 anti-pattern row `performance:render-thrash-list-no-key`, keyless `{#each}` blocks force a full re-render of every child when the array reference changes. Categories on the org landing change rarely (per-load via `data.feedCategories`), so wall-clock impact is bounded — but the pattern is endemic-prone (the same shape will appear in future per-category carousels) and the fix is one-line.
- **Proof test form**: Catalogue row 12 — custom static lint rule + test the rule (grep on the .svelte source for `{#each` blocks without `(...)` key clause).
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-010/F3-each-no-key.test.ts`
- **MCP evidence required (R6)**: n/a for static finding (per ref 04 §9 — bench() not meaningful at observed scale; lint guard suffices).
- **Bead**: TBD

### F4 — `performance:kv-get-no-cache-ttl`

- **Severity**: minor
- **File:Line**: `apps/web/src/lib/server/brand-cache.ts:30`
- **Description**: `platform.env.BRAND_KV.get<CachedBrandConfig>(...)` is called without a `cacheTtl` option. Per ref 04 §4 + §8 anti-pattern row 2, KV.get should pass `{ type: 'json', cacheTtl: <seconds> }` so workerd's edge cache layer holds the value across requests and avoids a cold KV read on each. BRAND_KV holds rarely-changing org branding (TTL governed by `CACHE_TTL.BRAND_CACHE_SECONDS`), so a `cacheTtl` of e.g. 60s is safe.
- **Proof test form**: Catalogue row 7 — contract test on `BRAND_KV.get` mock; assert options object passed and `cacheTtl >= 60`.
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-010/F4-kv-get-no-cache-ttl.test.ts`
- **MCP evidence required (R6)**: n/a static finding; contract assertion is sufficient. (Optional: observability-MCP lookup on real-world KV miss rate after fix, deferred to follow-up.)
- **Bead**: TBD

### F5 — `performance:regex-recompiled-per-call`

- **Severity**: minor
- **File:Line**: `apps/web/src/lib/server/auth-utils.ts:25-27`
- **Description**: `extractSessionToken()` constructs two `new RegExp(...)` objects on every call from a template literal interpolating `COOKIES.SESSION_NAME`. The constant doesn't change at runtime, so the patterns can hoist to module scope. Auth-flow only (login / register / verify-email / logout helpers), so multiplier is modest — filed for catalogue consistency with ref 04 §7 row 14, and to prime the recurrence-counter if the same shape surfaces in a higher-traffic file later.
- **Proof test form**: Catalogue row 12 — static lint rule + RegExp-construction proxy spy.
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-010/F5-regex-recompiled-per-call.test.ts`
- **MCP evidence required (R6)**: n/a static finding.
- **Bead**: TBD

## Summary

| Metric | Value |
|---|---|
| Total findings | 5 |
| Blocker | 0 |
| Major | 1 (F1) |
| Minor | 4 (F2 / F3 / F4 / F5) |
| Testability-bugs | 0 |
| Testability-bug rate | 0% (R8 budget intact) |
| Beads filed | 0 (filed by main chat at step 7) |
| Recurrence promotions queued | 0 |

## R12 effectiveness audit (first apps/web cycle since promotion)

R12 was promoted in iter-008 from a single-cycle 5-hit endemic profile in `packages/`. The hard rule is: **service methods MUST launch independent DB/API awaits via Promise.all; sequential await is permitted only for guard-then-fetch / FK ordering**.

This cycle is the **first apps/web cycle since R12 was promoted**. The apps/web equivalent surface is SvelteKit `+page.server.ts` / `+layout.server.ts` loaders, plus `lib/server/*.ts` helpers called from them. Findings:

- **0 NEW sequential-await-independent-queries violations** observed in apps/web loaders.
- Existing parallelism is correct and idiomatic:
  - `_org/[slug]/(space)/+page.server.ts` launches `statsPromise` + `creatorsPromise` BEFORE `await parent()` → maximally overlapped.
  - `_org/[slug]/+layout.server.ts:191-200` reads multiple version keys with `Promise.all`.
  - `lib/server/content-detail.ts:loadAccessAndProgress` and `loadSubscriptionContext` both use `Promise.all`.
  - Creator-resolution paths (`_creators/[username]/+page.server.ts`, `_org/[slug]/(space)/explore/+page.server.ts`) are guard-then-fetch — content fetch depends on `creatorProfile.id`, which R12 explicitly permits.

**Conclusion**: R12 is effective at the apps/web boundary. The rule prevents the same shape that surfaced in `analytics-service` and `ContentAccessService` during iter-007. Continued monitoring at every apps/web performance cycle.

## Skill patches applied

- (none) Cycle did not modify SKILL.md, references, or agent briefs. All cited symbols verified live; no doc-rot to fix.

## Next-cycle prep

- **Round 2 begins.** All 12 cells now have a baseline cycle. Subsequent cycles transition from "discovery mode" to "drift-detection mode" — focus shifts from cataloguing endemic patterns to verifying churn-since-last-run does not regress.
- **No promotion queued for iter-011.** No fingerprint hit ≥3 times in trailing 6 cycles; no single-hit security exception fired.
- **Carry-forward watches**:
  - `simplification:dup-paginated-list-shape` (iter-009, cycle_density=6) — 2-hit early-promotion candidate. Watch in next simplification cycle.
  - `types:as-unknown-as` + `types:as-cast-without-guard` (hits=2 each) — one more cycle increment triggers R7 standard 3-hit promotion. Watch in next types cycle.
  - `types:redundant-cast-after-narrow` (cycle_density=6 iter-006) — endemic shape watch.
  - F1 (`performance:hot-path-shader-config-getcomputedstyle`) is NEW; track for recurrence in next perf cycle (especially when ShaderPicker / studio-form components churn again).
  - F2 (`performance:hot-path-allocation-render-loop`) is NEW; track for recurrence as audio/shader features expand.
- **R12 effectiveness sub-watch**: confirmed effective at apps/web boundary this cycle. Next perf×apps/web cycle should re-verify after any new server-load churn.
- **R13 effectiveness sub-watch**: not exercised this cycle (no new `executionCtx.waitUntil` sites in apps/web; iter-003 F5 still open in brand-cache.ts:75). Defer to next workers cycle.
- **Cell stop-criterion countdown**:
  - performance × apps/web: 0/3 (this cycle produced findings; reset).
  - All other cells: unchanged (no new churn in this cycle's window).
- **MCP evidence (R6) for F1 + F2 must be captured by main chat at filing time.** Both findings carry `chrome-devtools` MCP requirements per the matrix in §3 of SKILL.md.
- **Iter-010 fix entanglement**:
  - F1 fix: lift `pollConfig` from ShaderHero into a shared helper (e.g. `apps/web/src/lib/components/ui/ShaderHero/use-poll-config.ts`); rewrite ImmersiveShaderPlayer + ShaderPreview to use it. Single PR, three files.
  - F2 fix: recycle the `AudioAnalysis` buffer inside `audio-analyser.ts` (mutate fields, return stable instance); rewrite ImmersiveShaderPlayer's renderFrame to skip the local literal. Same PR can take F1 + F2 since they share the immersive-player surface.
  - F3 fix: add `(category.name)` keys at lines 314 and 449. Trivial.
  - F4 fix: add `cacheTtl` option to BRAND_KV.get call. Trivial.
  - F5 fix: hoist the two RegExp patterns to module scope. Trivial.
- **Round 2 scheduling suggestion**: with all 12 cells cycled, future runs benefit from `--mode=delta --since=<previous iter commit for THAT cell>` rather than calendar windows. Master.md's per-cell "last run" field is now the correct basis for cell-due computation.
