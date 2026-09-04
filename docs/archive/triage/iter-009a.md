# iter-009a — rung 3 — Codex-d3g6 (parallel cycle)

> Parallel cycle to iter-009 (Codex-y63gl.14, rung-1, in working tree but not yet
> committed at time of pick). Concurrent /triage agent claimed the rung-1 work
> (perf hot-path poll-config helper); this cycle picked the next-highest-impact
> item per user direction "we are going to tackle a harder one just pick one of
> the higher complexity ones" — meaning rung 3 or rung 4. Suffix `iter-009a`
> per concurrent-cycle precedent (iter-005a, signal:concurrent-cycle-suffix).

**Date**: 2026-04-28
**Mode**: auto (user-directed pick at rung 3+)
**Bead**: Codex-d3g6 — "IMPORTANT: Write missing critical tests"
**Rung**: 3 (Multi-file / Reasoned)
**Outcome**: USER CHOSE **Option A — One PR** (Recommended). Apply phase queued as `iter-009a-apply` — single sub-agent writes ~29 missing test cases across 4 files in one PR, then `bd close Codex-d3g6` after tests pass. Routing label `triage:routing:backend-dev` applied for audit trail (the apply phase is executed in-cycle by a backend-dev-style sub-agent rather than waiting for a user-invoked `/backend-dev` session).

---

## Bead summary

> **Codex-d3g6** (P1 task) — Six distinct test gaps cited in the description:
>
> 1. **SECURITY**: `enforcePolicyInline()` query param org resolution — membership check, UUID validation, platform owner bypass.
> 2. `handleProgressWebhook()` — progress writes, no-op for completed/failed, mediaId fallback.
> 3. `triggerJobInternal()` async refactor — returns dispatchPromise, DB update before RunPod, markTranscodingFailed on failure.
> 4. `handleWebhook()` fallback mediaId lookup + progress field clearing.
> 5. `buildOrgUrl()` / `buildCreatorsUrl()` — lvh.me, localhost, production URLs.
> 6. `runpodWebhookUnionSchema` — discriminated union validation.
>
> Created 2026-03-29 as the test-coverage follow-up to the 184-file PR review epic Codex-illw (still in_progress). Sibling fix beads (Codex-igu8 P0, Codex-49y3 P1) closed same day.

## Why this bead over the other rung-3 candidates

| Candidate | Reason picked / skipped |
|---|---|
| **Codex-x0pa (P0)** | Skipped. Rung-4 in disguise — it's an end-to-end Playwright test of 10 user flows requiring browser MCP access. Sub-agents (this cycle) have no UI surface; even framing approach options needs a live Stripe sandbox + browser. Belongs in a session where the user runs `/loop` with playwright MCP forefront. Will recur. |
| **Codex-i49f (P1)** | Skipped. Blocked by Codex-u498. |
| **Codex-u498 (P1)** | Skipped. Same shape as x0pa — Chrome DevTools + Playwright verification, 21 manual test steps. Browser-MCP gated. |
| **Codex-d3g6 (P1)** | **Picked.** Pure unit-test writing. 6 distinct surfaces, ALL with file:line locators per pre-flight read. Spans 4 packages (worker-utils, transcoding, validation, apps/web/lib/utils). Cleanest rung-3 in the queue: enumerable approach options (one-PR vs split-into-6 vs split-by-package vs spawn-backend-dev), no live infra dependency, no UI dependency. |

## Pre-flight gate — bead claims vs codebase reality

**Critical finding**: Sub-item (1) is **partially stale**. The other five are confirmed gaps.

### (1) `enforcePolicyInline()` query param org resolution — PARTIALLY STALE

`packages/worker-utils/src/procedure/__tests__/enforce-policy-inline.test.ts` already covers most of what the bead asks for (file is 500+ lines, 43 references to `enforcePolicyInline`):

- ✅ UUID path-param resolution (line 383: `it('resolves org from UUID path param and runs membership check', ...)`)
- ✅ Subdomain fallback (line 407: `it('falls back to subdomain extraction when no UUID param', ...)`)
- ✅ **Query param `organizationId` fallback (line 430: `it('falls back to organizationId query param when subdomain yields nothing', ...)`)**
- ✅ Platform-owner bypass of membership check (line 482: `it('skips membership check for platform_owner accessing via UUID param', ...)`)
- ✅ Platform-owner auth=`platform_owner` mode (line 302 describe block)

What's possibly missing: explicit **invalid-UUID rejection** for the query-param path (the file tests UUID-A/UUID-B as valid only). One narrow gap, not a 6-item area.

### (2) `handleProgressWebhook()` — CONFIRMED GAP

`packages/transcoding/src/__tests__/transcoding-service.test.ts` (354 lines) — `grep handleProgressWebhook` returns **0 matches**. Method is fully untested. Cited behaviours per `packages/transcoding/CLAUDE.md`: handles progress/step updates during transcoding, no-op for terminal states, mediaId fallback.

### (3) `triggerJobInternal()` async refactor — CONFIRMED GAP

Same file. `grep triggerJobInternal | dispatchPromise | markTranscodingFailed` returns **0 matches**. Existing `triggerJob` tests (lines 49–158) cover the public surface but not the post-49y3 internal refactor that returns `dispatchPromise`, updates DB before RunPod call, and calls `markTranscodingFailed` on dispatch failure. Codex-49y3 closed the FIX; this bead is the missing TEST.

### (4) `handleWebhook()` fallback mediaId lookup + progress field clearing — PARTIALLY GAP

`handleWebhook` itself has 5 tests (lines 161–353): success, failure-and-attempt-increment, empty-readyVariants rejection, mezzanineKey storage, source variant. What's missing per the bead:

- Fallback **mediaId lookup** path (when payload's `output.mediaId` is absent and the service has to look it up via `runpodJobId`)
- **Progress field clearing** on terminal status (e.g. zero-out `transcodingProgress`, `transcodingStep`)

### (5) `buildOrgUrl()` / `buildCreatorsUrl()` — CONFIRMED GAP

`apps/web/src/lib/utils/subdomain.test.ts` covers `extractSubdomain` and `getSubdomainContext` extensively — but `grep buildOrgUrl | buildCreatorsUrl` in that file returns **0 matches**. Both functions are exported from `subdomain.ts` (lines 89, 120) and are the canonical URL builders for cross-org subdomain navigation. Untested.

### (6) `runpodWebhookUnionSchema` — CONFIRMED GAP

`packages/validation/src/schemas/__tests__/transcoding.test.ts` (206 lines) covers `runpodWebhookOutputSchema` (the inner output shape) extensively — but `grep runpodWebhookUnionSchema | discriminatedUnion` returns **0 matches**. The outer discriminated-union dispatch (`status: 'completed'` vs `'failed'` vs `'in_progress'` etc.) is the contract that decides which branch validates — and it's the one without test coverage.

### Bead description does NOT contradict the codebase materially

Sub-item (1) is partially overlapped with existing coverage but the gap (UUID validation on query-param path) is narrow and real. Sub-items (2)–(6) are accurate.

## Approach options enumerated

I am surfacing 4 options. Each one has the same broad effect (close test gaps for d3g6) but differs in scope-per-PR and routing.

### Option A — One PR, all 6 sub-items (Recommended for review velocity)

**Scope**: ~5 test files touched (or extended), ~25–35 test cases added, single commit, single PR.

- `packages/worker-utils/src/procedure/__tests__/enforce-policy-inline.test.ts` — add invalid-UUID rejection on query-param path (~3 cases).
- `packages/transcoding/src/__tests__/transcoding-service.test.ts` — add `describe('handleProgressWebhook')` (~5 cases) + `describe('triggerJobInternal async refactor')` (~4 cases) + extend `handleWebhook` describe with fallback-mediaId-lookup + progress-clearing (~3 cases).
- `apps/web/src/lib/utils/subdomain.test.ts` — add `describe('buildOrgUrl')` + `describe('buildCreatorsUrl')` (~8 cases covering lvh.me, localhost, production, default path, custom path).
- `packages/validation/src/schemas/__tests__/transcoding.test.ts` — add `describe('runpodWebhookUnionSchema')` (~6 cases — one per status branch + invalid-status rejection).

**Cost**: ~2–3h focused work. **Risk**: low (adding tests, no production code change). **Routing**: spawn `/backend-dev` to write the tests OR I (next cycle) re-dispatch as a coordinated apply pass.

### Option B — Split into 6 sub-beads (one per sub-item)

**Scope**: 6 child beads filed via parallel `bd create`. Each is rung-1 or rung-2. Parent `d3g6` becomes the umbrella.

- Codex-d3g6.1 — Stale-overlap audit + invalid-UUID gap on enforcePolicyInline query-param path (rung-1, ~30min).
- Codex-d3g6.2 — handleProgressWebhook tests (rung-2, ~30min).
- Codex-d3g6.3 — triggerJobInternal async refactor tests (rung-2, ~45min).
- Codex-d3g6.4 — handleWebhook fallback-mediaId + progress-clearing tests (rung-2, ~30min).
- Codex-d3g6.5 — buildOrgUrl/buildCreatorsUrl tests (rung-1, ~30min).
- Codex-d3g6.6 — runpodWebhookUnionSchema tests (rung-1, ~20min).

**Cost**: same total work, more bead-management overhead. **Risk**: very low — each child PR is mergeable independently. **Routing**: future cycles drain rung-1/rung-2 children mechanically.

### Option C — Split by package (3 children: worker-utils + transcoding-related + apps-web-utils + validation, but really 3 PRs)

**Scope**: 3 child beads, one per coherent test suite. Compromise between A and B.

- Codex-d3g6-A — All transcoding tests (sub-items 2, 3, 4) — single file, single domain, single PR. ~4–5h on its own.
- Codex-d3g6-B — All enforce-policy + subdomain + validation tests (sub-items 1, 5, 6) — three files but small additions. ~1.5h.

**Cost**: similar to A but groups by domain expertise (transcoding tests benefit from continuity; subdomain/validation/policy each stand alone). **Risk**: low. **Routing**: spawn `/backend-dev` for the transcoding child; subdomain/validation children become rung-1 mechanical.

### Option D — Defer / spawn /backend-dev for the whole thing

**Scope**: route the existing `Codex-d3g6` bead to `/backend-dev` without splitting. `/backend-dev` is the owning skill for transcoding service, worker procedure, and SvelteKit server-utils tests per its skill description.

**Cost**: zero in this session. **Risk**: defers a P1 test-coverage gap until `/backend-dev` is invoked. **Routing**: `bd label add Codex-d3g6 triage:routing:backend-dev`. User invokes `/backend-dev` in a future session.

## Question payload (returned to parent)

```json
{
  "question": "Codex-d3g6 has 6 test gaps across 4 packages. Sub-item (1) is partially stale (existing test already covers query-param path); other 5 are confirmed gaps. How to proceed?",
  "header": "Rung-3 routing — d3g6 test coverage",
  "options": [
    { "label": "One PR (Recommended)", "next": "one-pr" },
    { "label": "Split into 6 children", "next": "split-6" },
    { "label": "Split by package (2-3 children)", "next": "split-by-package" },
    { "label": "Spawn /backend-dev", "next": "spawn-backend-dev" }
  ]
}
```

## Code excerpts for the question

These three short snippets clarify the gap shape (per `signal:underspecified-payload-rung-3` — earlier rung-3 cycles failed because payloads were too abstract):

### Existing query-param coverage (sub-item 1 — STALE)

```ts
// packages/worker-utils/src/procedure/__tests__/enforce-policy-inline.test.ts:430
it('falls back to organizationId query param when subdomain yields nothing', async () => {
  // ... (already exists — sub-item 1 partially covered)
  query: { organizationId: UUID_A },
  // ...
  expect(vars.organizationId).toBe(UUID_A);
});
```

### Missing handleProgressWebhook coverage (sub-item 2)

```ts
// packages/transcoding/src/__tests__/transcoding-service.test.ts
// 354 lines, grep handleProgressWebhook → 0 matches
// describe('TranscodingService', () => { describe('triggerJob' ...), describe('handleWebhook' ...) })
// Missing: describe('handleProgressWebhook', ...)
```

### Missing buildOrgUrl coverage (sub-item 5)

```ts
// apps/web/src/lib/utils/subdomain.test.ts
// covers extractSubdomain + getSubdomainContext extensively
// grep buildOrgUrl|buildCreatorsUrl → 0 matches
// Missing: describe('buildOrgUrl', ...) + describe('buildCreatorsUrl', ...)
```

## Files affected (preview — no edits this cycle)

- `packages/worker-utils/src/procedure/__tests__/enforce-policy-inline.test.ts` (line 430 region — confirm stale, narrow gap)
- `packages/transcoding/src/__tests__/transcoding-service.test.ts` (extend with 3 new describe blocks)
- `apps/web/src/lib/utils/subdomain.test.ts` (extend with 2 new describe blocks)
- `packages/validation/src/schemas/__tests__/transcoding.test.ts` (extend with 1 new describe block)

## What I'm returning to the parent

`{needsUser: true, rung: 3, beadId: Codex-d3g6, ...}` with the 4 options above. Parent will render via `AskUserQuestion`. On answer:

- **one-pr** → re-dispatch this cycle in apply mode with explicit file list, OR (recommended) hand to `/backend-dev` for the writing.
- **split-6** → spawn 6 parallel `bd create` calls; this bead becomes the parent epic.
- **split-by-package** → spawn 2–3 parallel `bd create` calls.
- **spawn-backend-dev** → label `triage:routing:backend-dev`; end cycle; user invokes `/backend-dev` next.

## Recurrence ledger

This bead surfaces a **new** fingerprint:

- `signal:bead-description-partially-stale` — sub-item (1) of d3g6 was already covered in the cited test file by tests written after the bead was filed (2026-03-29 → enforce-policy-inline.test.ts has post-March commits adding query-param coverage). The bead remained open, accumulating staleness; pre-flight verification (`signal:bead-description-self-contradicts-codebase` and friends) catches this. Hits=1.

Concurrent-cycle pattern: increment `signal:concurrent-cycle-suffix` to hits=2 (iter-005a, iter-009a).

## Constraints honoured

- Read-only on production code: confirmed (only the 3 artifact files written this cycle).
- No nested agents spawned.
- No `AskUserQuestion` called from this sub-agent (R9): confirmed.
- Iter-009 ladder snapshot ownership: not touched (the parallel iter-009 cycle owns it). Cycle-history row appended only.
