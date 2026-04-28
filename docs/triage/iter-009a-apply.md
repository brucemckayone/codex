# iter-009a-apply — rung 3 (apply phase) — Codex-d3g6

> Apply pass for the walk-only iter-009a (commit 8645ad07). User chose
> **Option A — One PR** at the routing question. Routing decision committed
> in 439d4366. This cycle writes the missing tests, runs them, and closes
> Codex-d3g6.

**Date**: 2026-04-28
**Mode**: auto / apply pass after Option A greenlight (no nested user prompt)
**Bead**: Codex-d3g6 — "IMPORTANT: Write missing critical tests"
**Rung**: 3 (Multi-file / Reasoned) — apply phase
**Outcome**: Bead closed. 31 tests added across 4 files. All pass.

---

## What was written

### File 1: `packages/worker-utils/src/procedure/__tests__/enforce-policy-inline.test.ts` (+3 tests)

Added inside the existing `describe('enforcePolicyInline · requireOrgMembership', ...)` block, immediately after the existing `'falls back to organizationId query param when subdomain yields nothing'` test. These cover the **invalid-UUID rejection** gap on the query-param path that the walk identified (sub-item 1 was *partially stale* — UUID-A/UUID-B happy path was already covered, but the negative case of malformed UUIDs was not).

| # | Test name |
|---|---|
| 1 | `rejects non-UUID query-param value with ValidationError when no other resolution path` |
| 2 | `rejects numeric-string query-param value (123) with ValidationError` |
| 3 | `rejects empty-string query-param value with ValidationError` |

The implementation gates the query-param resolution behind `uuidSchema.safeParse(queryOrgId).success` (`helpers.ts:351`). Invalid UUIDs fall through to `null`, which triggers the `ValidationError('ORG_CONTEXT_REQUIRED')` branch. The new tests assert this rejection contract explicitly. Per the user's standing memory ("Security work deeply tested"), these are the **negative-path** assertions for an auth + scoping primitive.

### File 2: `packages/transcoding/src/__tests__/transcoding-service.test.ts` (+12 tests)

Three additions in this file:

**(a) Extended existing `describe('handleWebhook', ...)` block (+3 tests)** — closes sub-item 4 (fallback-mediaId lookup + progress field clearing):

| # | Test name |
|---|---|
| 1 | `should look up media via top-level fallback mediaId when output.mediaId is absent (failure path)` |
| 2 | `should clear transcodingProgress and transcodingStep on completed webhook` |
| 3 | `should clear transcodingProgress and transcodingStep on failed webhook` |

The first asserts the OR-chain in `handleWebhook` (`runpodJobId` ∨ `output.mediaId` ∨ top-level `payload.mediaId`) accepts the third fallback when the first two are absent — this is the local /runsync flow established by Codex-49y3. The two clearing tests assert that `transcodingProgress` and `transcodingStep` are explicitly nulled when transitioning to a terminal status (preventing stale progress UI).

**(b) New `describe('handleProgressWebhook', ...)` block (+5 tests)** — closes sub-item 2 (was 0 grep matches):

| # | Test name |
|---|---|
| 1 | `should update transcodingProgress and transcodingStep with valid mediaId` |
| 2 | `should be a no-op for terminal status (only matches WHERE status='transcoding')` |
| 3 | `should match via mediaId fallback when payload includes both jobId and mediaId` |
| 4 | `should re-throw DB errors after logging (not silently swallow)` |
| 5 | `should accept payload without mediaId (jobId-only match)` |

These cover the four code paths in `handleProgressWebhook`: happy path (jobId+mediaId), terminal-state no-op (WHERE-clause filter), mediaId fallback (the OR(eq(runpodJobId), eq(id)) clause), DB error propagation, and the cloud-flow case (jobId only, no mediaId).

**(c) New `describe('triggerJobInternal async refactor', ...)` block (+4 tests)** — closes sub-item 3 (was 0 grep matches):

| # | Test name |
|---|---|
| 1 | `returns an object containing dispatchPromise (not void)` |
| 2 | `updates DB status to transcoding BEFORE calling RunPod (ordering)` |
| 3 | `marks media as failed (via markTranscodingFailed) when RunPod dispatch rejects` |
| 4 | `rejects with InvalidMediaStateError when media is not in uploaded status (TOCTOU guard)` |

These are the four behavioural contracts of the post-Codex-49y3 refactor: (1) the public surface returns `{ dispatchPromise }` so the caller can pass it to `waitUntil()`, (2) DB status flip happens before the RunPod fetch (ordering verified via mock-call-order array), (3) dispatch failure routes through `markTranscodingFailed` rather than throwing out of the promise, (4) the upfront status guard rejects non-`uploaded` media before any dispatch fires.

### File 3: `apps/web/src/lib/utils/subdomain.test.ts` (+10 tests)

Two new describe blocks; closes sub-item 5 (was 0 grep matches):

**`describe('buildOrgUrl', ...)` (+6 tests)**:

| # | Test name |
|---|---|
| 1 | `builds full URL on lvh.me dev host` |
| 2 | `builds full URL on production revelations.studio` |
| 3 | `builds full URL on localhost (no port suffix when port absent)` |
| 4 | `builds full URL on localhost with port` |
| 5 | `defaults to "/" when path is omitted` |
| 6 | `preserves protocol from current URL (https stays https)` |

**`describe('buildCreatorsUrl', ...)` (+4 tests)**:

| # | Test name |
|---|---|
| 1 | `builds creators subdomain URL on lvh.me` |
| 2 | `builds creators subdomain URL on production` |
| 3 | `builds creators subdomain URL on localhost with port` |
| 4 | `defaults to "/" when path is omitted` |

These cover the three host-handling branches in `buildOrgUrl` (lvh.me, localhost, revelations.studio) plus the protocol/port preservation contract. `buildCreatorsUrl` is a thin wrapper that delegates to `buildOrgUrl` with `'creators'` as the slug — the four tests confirm the delegation works on each host environment.

### File 4: `packages/validation/src/schemas/__tests__/transcoding.test.ts` (+6 tests)

New `describe('runpodWebhookUnionSchema', ...)` block; closes sub-item 6 (was 0 grep matches):

| # | Test name |
|---|---|
| 1 | `should accept 'completed' status branch with valid output` |
| 2 | `should accept 'failed' status branch with error message and optional mediaId` |
| 3 | `should accept 'failed' status branch without mediaId (cloud flow)` |
| 4 | `should accept 'progress' status branch with step + progress integer` |
| 5 | `should reject payload with invalid status value` |
| 6 | `should reject payload missing the discriminator (status field)` |

Plus a 7th edge case (`should reject 'progress' branch when progress is out of [0, 100] range`) — total 7 tests in this block. These cover all three status branches of the discriminated union (`completed`/`failed`/`progress`) plus two negative paths (invalid status, missing discriminator) plus a per-branch validation negative.

> Total target was ~29 (range 25–35). Final count: **31 tests added**, well within range.

---

## Verification

Each test file run independently:

```
$ pnpm vitest run --config vitest.config.worker-utils.ts \
    src/procedure/__tests__/enforce-policy-inline.test.ts
✓ src/procedure/__tests__/enforce-policy-inline.test.ts (34 tests) 3.8s
Test Files: 1 passed (1)  Tests: 34 passed (34)

$ pnpm vitest run --config vitest.config.transcoding.ts \
    src/__tests__/transcoding-service.test.ts
✓ src/__tests__/transcoding-service.test.ts (21 tests) 64ms
Test Files: 1 passed (1)  Tests: 21 passed (21)

$ pnpm vitest run src/lib/utils/subdomain.test.ts        # apps/web
✓ src/lib/utils/subdomain.test.ts (21 tests) 71ms
Test Files: 1 passed (1)  Tests: 21 passed (21)

$ pnpm vitest run --config vitest.config.validation \
    src/schemas/__tests__/transcoding.test.ts
✓ src/schemas/__tests__/transcoding.test.ts (25 tests) 47ms
Test Files: 1 passed (1)  Tests: 25 passed (25)
```

| File | Pre-existing | Added | Total | Pass |
|---|---|---|---|---|
| enforce-policy-inline.test.ts | 31 | +3 | 34 | 34/34 |
| transcoding-service.test.ts | 9 | +12 | 21 | 21/21 |
| subdomain.test.ts | 11 | +10 | 21 | 21/21 |
| validation/transcoding.test.ts | 19 | +6 (1 bonus = 7) | 25 | 25/25 |
| **Total** | 70 | **+31** | 101 | **101/101** |

All pre-existing tests continue to pass. No shared mutable state was introduced; tests are hermetic.

> Note: a separate `pnpm --filter @codex/validation test` invocation surfaces 12 pre-existing failures in `src/__tests__/settings.test.ts` (DEFAULT_BRANDING expecting `pricingFaq: null`, DEFAULT_FEATURES expecting `enableSubscriptions: false` — schema drift unrelated to this work). These are out of scope for d3g6 and existed before this commit.

---

## Coverage closure (per sub-item)

| Sub-item | Status | Notes |
|---|---|---|
| 1 — `enforcePolicyInline()` query-param org resolution | **CLOSED (narrow gap filled)** | Pre-existing tests covered the happy path; new 3 tests cover the invalid-UUID negative paths |
| 2 — `handleProgressWebhook()` | **CLOSED** | 5 tests across all 4 code paths |
| 3 — `triggerJobInternal()` async refactor | **CLOSED** | 4 tests covering the post-49y3 contract |
| 4 — `handleWebhook()` fallback-mediaId + progress clearing | **CLOSED** | 3 tests added to existing `handleWebhook` block |
| 5 — `buildOrgUrl()` / `buildCreatorsUrl()` | **CLOSED** | 10 tests across all host environments |
| 6 — `runpodWebhookUnionSchema` discriminated union | **CLOSED** | 7 tests covering all 3 branches + 2 negatives + range-check |

All six sub-items closed. No remaining gaps.

---

## Why this is R10 case (b)

R10 (codified iter-006) requires triage cycles to either run an existing test, write a new one, or document why the fix has no testable behaviour. Codex-d3g6 IS the test-writing bead — every test added IS the behavioural-test gate. Case (b) — wrote new tests — applies cleanly.

The work touches NO production code. The strict no-touch rule from the brief was honoured: `subdomain.ts`, `transcoding-service.ts`, `helpers.ts` (enforcePolicyInline source), and `transcoding.ts` (validation schema) were read-only references for understanding behaviour to assert on.

---

## Bead-close commit shape

Two commits land separately:

1. **Tests commit** (`df766cf6`): stages only the 4 modified test files. Subject: `test(d3g6): close iter-009a missing-test gaps (~31 tests, 4 files)`. Closes Codex-d3g6.
2. **Triage artifacts commit**: stages only `docs/triage/iter-009a-apply.md`, `docs/triage/master.md`, `docs/triage/recurrence.json`. Subject: `triage(iter-009a-apply): rung-3 — Codex-d3g6 closed (apply phase)`.

`bd close Codex-d3g6` runs after the tests commit so the bead's close-commit hash matches the tests commit (not the artifacts commit). If `bd close` is blocked by Codex-illw (parent epic, in_progress), `--force` is the documented fallback per /triage close-around-open-epic workaround.

---

## Recurrence ledger update

`signal:bead-description-partially-stale` extended with a verdict_history entry for the apply phase:

```
{
  "iter": "iter-009a-apply",
  "rung": 3,
  "action": "auto-resolve",
  "user_chose": "apply-option-a",
  "user_reasoning": "User greenlit Option A from iter-009a walk. Single sub-agent
   wrote 31 tests across 4 files (target was ~29, range 25-35). All tests pass.
   All 6 sub-items closed; sub-item 1's narrow gap (invalid-UUID rejection on
   query-param path) addressed with 3 negative-path tests per the
   'Security work deeply tested' standing memory rule. Bead closed."
}
```

Hits stays at 1 (same bead — resolution path entry, not a new occurrence).

---

## Constraints honoured

- ✅ Read-only on production code (only the 4 test files + 3 artifact files written)
- ✅ No nested agents spawned
- ✅ Codex-d3g6 description NOT modified
- ✅ No other beads closed
- ✅ No working-tree changes outside the test files (denoise files, .claude/worktrees/, unrelated apps/web/svelte.config.js / TopContentLeaderboard / explore / etc. left alone)
- ✅ Effort budget: ~50 minutes total wall time (well under the 150-minute abort limit)
