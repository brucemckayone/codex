# Iteration 008 — performance × workers

- **Cell**: performance × workers
- **Date**: 2026-04-26
- **Mode**: delta
- **Since**: 14 days ago (HEAD `ce69f9c9` post-iter-007)
- **Files churned**: 31 files in `workers/*/src/**` (excluding `*.test.ts`)
- **Agent**: agents/audit-workers.md (performance branch)
- **Fallow JSON**: `/tmp/denoise-iter-008-fallow.json`
- **Typecheck baseline**: `/tmp/denoise-iter-008-typecheck-baseline.log` (3 carry-forward `@codex/worker-utils` errors from iter-005, plus 2 pre-existing iter-002 proof-test errors at `workers/ecom-api/src/__denoise_proofs__/iter-002/F3-…ts:57,59` — neither is a regression introduced this cycle. iter-008 proofs clean.)

## Skill patches applied

- **R12 already applied** in `.claude/skills/denoise/SKILL.md` §1 Hard Rules table (line 63) with citation `<!-- R12 promoted from iter-007, fingerprint performance:sequential-await-independent-queries (endemic single-cycle 5-hit) -->`. The promotion fired in master.md "Next-cycle prep" for this cycle; verified in place. No additional rule-table edits required this cycle.
- **No doc-rot found** in references 04 + 06 anti-pattern citations (see Fabrication check).

## Fabrication check

22 anti-pattern rows cited across reference 04 (12 rows in §8) + reference 06 (12 rows in §9). All cited symbols / patterns verified live in current code:

| Reference | Row | Symbol/pattern | Hits in workers/ |
|---|---|---|---|
| 04 §8 row 1 | n-plus-1-await-in-loop | `for ... { await db.X }` | 0 (zero in-loop awaits in workers — service layer owns DB access) |
| 04 §8 row 2 | KV.get without cacheTtl | `KV.get` | 1 (auth `/api/test/verification-token/:email` — dev-only, scope-excluded) |
| 04 §8 row 4 | render-thrash-effect-loop | `$effect` | 0 (workers; not applicable scope) |
| 04 §8 row 6 | waitUntil w/o catch | `waitUntil(...)` no `.catch` | **8 violations across 4 workers** — see findings F1-F5 |
| 04 §8 row 7 | sync-io-in-async-path | `readFileSync\|execSync` | 0 |
| 04 §8 row 8 | unbounded-pagination | `withPagination` | service-layer concern; clean in routes |
| 04 §8 row 9 | string-concat-in-hotpath | `+=` in loops | 0 |
| 04 §8 row 12 | subrequest-cap-loop-fetch | `fetch(...)` in loop | 0 (no loops with fetch in routes) |
| 04 §8 row 13 (NEW iter-007) | sequential-await-independent-queries | independent `await` not in `Promise.all` | 1 candidate — see F6 (auth-config) |
| 06 §9 row 1 | route-bypassing-procedure | `app.METHOD` no `procedure()` | confirmed exceptions only (BetterAuth, Stripe webhooks, RunPod webhook, dev-cdn, unsubscribe — all documented) |
| 06 §9 row 4 | waituntil-no-catch | same as 04 §8 row 6 | duplicate citation; same findings F1-F5 |
| 06 §9 row 5 | webhook-no-db-cleanup | `createPerRequestDbClient` | every webhook handler in scope correctly wraps `await cleanup()` in `finally` |
| 06 §9 row 8 | fetch-localhost-blocked | `fetch('http://localhost:...')` | 0 (workerd guard respected; LAN-IP idiom in tests only) |
| 06 §9 row 12 | console-log-not-redacted | `console.log(token)` | 0 (only `console.error` in webhook.ts on schema-validation paths — payloads pre-validated, slice 500) |

References 04 + 06 cite reality. **0 stale rows** — no doc-rot findings this cycle.

## Findings

The dominant fingerprint this cycle is **`workers:waituntil-no-catch`**. Going into iter-008 the recurrence ledger had it at hits=2 of 3 (Codex-ttavz.9 ecom-api iter-002, Codex-ttavz.16 apps/web iter-003). This audit finds **5 distinct sites across 4 worker files** (8 individual `waitUntil` calls counting line-counts). The single-cycle cycle_density is the same shape that triggered R12's endemic 5-hit promotion in iter-007 — see "Next-cycle prep" for the recommended action.

### F1 — workers:waituntil-no-catch (ecom-api checkout webhook)

- **Severity**: major (3rd hit on this fingerprint — triggers R7 standard 3-hit promotion to a hard rule)
- **File:Line**: `workers/ecom-api/src/handlers/checkout.ts:169-173`
- **Description**: After `purchaseService.completePurchase(...)` succeeds, the booking webhook fire-and-forgets `cache.invalidate(COLLECTION_USER_LIBRARY(customerId))` via `c.executionCtx.waitUntil(...)` with no `.catch()`. Every other `waitUntil` in this worker handles errors via `.catch((err) => obs?.warn(...))` — this site is the regression. The subscription-cache-audit (Codex-v8bub PR 1 + PR 2) explicitly relies on every cache invalidation logging on failure for forensic visibility.
- **Proof test form**: Catalogue row 12 — custom static-analysis "lint rule + test the rule"
- **Proof test path**: `workers/ecom-api/src/__denoise_proofs__/iter-008/F1-checkout-cache-invalidate-no-catch.test.ts`
- **MCP evidence**: n/a (static structural test; Hono test client latency probe not applicable to static-pattern findings)
- **Bead**: filed at step 7

### F2 — workers:waituntil-no-catch (media-api transcoding dispatch)

- **Severity**: major (raw RunPod API promise — actual external call that can reject)
- **File:Line**: `workers/media-api/src/routes/transcoding.ts:56`
- **Description**: `triggerJobInternal()` returns a `dispatchPromise` which is the live RunPod API call. The route fire-and-forgets it via `ctx.executionCtx.waitUntil(dispatchPromise)` with no `.catch()`. RunPod 5xx, network failures, RUNPOD_API_KEY rotation — all silently disappear. The cron `runRecoverStuckTranscoding` is the safety net (rescues after 120 minutes), but the route-level dispatch error never surfaces in obs. Compare to `workers/content-api/src/routes/media.ts:294` where the same shape (`triggerPromise`) IS catch-wrapped at lines 287-292. media-api's transcoding.ts is the only fire-and-forget RunPod-call site missing the catch.
- **Proof test form**: Catalogue row 12 — static-analysis grep
- **Proof test path**: `workers/media-api/src/__denoise_proofs__/iter-008/F2-transcoding-dispatch-promise-no-catch.test.ts`
- **MCP evidence**: n/a (static structural test)
- **Bead**: filed at step 7

### F3 — workers:waituntil-no-catch (organization-api settings — 3 sites)

- **Severity**: major (3 sites in one file; settings is a hot mutation path; PUT /contact + PUT /features are user-facing)
- **File:Lines**:
  - `workers/organization-api/src/routes/settings.ts:217` — `waitUntil(Promise.all(tasks))` (warm + version bump on branding mutations)
  - `workers/organization-api/src/routes/settings.ts:454` — `cache.invalidate(orgId)` after PUT /contact
  - `workers/organization-api/src/routes/settings.ts:499` — `cache.invalidate(orgId)` after PUT /features
- **Description**: All three sites pass a bare `Promise<void>` to `waitUntil` with no `.catch()`. Every other `waitUntil` in the organization-api worker (followers.ts:39, members.ts:59/80/98, organizations.ts:590/659) IS catch-wrapped — these three are the regression. The :217 site is particularly concerning because `Promise.all` rejects on first failure, so a KV reject on `cache.invalidate(orgId)` cancels the `updateBrandCache` task even though the latter is internally try/caught.
- **Proof test form**: Catalogue row 12 — static-analysis grep
- **Proof test path**: `workers/organization-api/src/__denoise_proofs__/iter-008/F3-settings-waituntil-no-catch.test.ts`
- **MCP evidence**: n/a (static structural test)
- **Bead**: filed at step 7

### F4 — workers:waituntil-no-catch (organization-api organizations.ts — 3 sites)

- **Severity**: minor (2 of 3 sites call `updateBrandCache` which is internally try/caught — defensive rule violation; 1 site is raw `BRAND_KV.delete` that CAN reject)
- **File:Lines**:
  - `workers/organization-api/src/routes/organizations.ts:79` — `updateBrandCache(...)` (POST / create — internally try/caught)
  - `workers/organization-api/src/routes/organizations.ts:572` — `BRAND_KV.delete('brand:${oldSlug}')` on slug change (PATCH /:id — raw KV; CAN reject)
  - `workers/organization-api/src/routes/organizations.ts:577` — `updateBrandCache(...)` (PATCH refresh — internally try/caught)
- **Description**: The :572 site is the genuine fire-and-forget hazard — a raw `BRAND_KV.delete` that has no internal try/catch. The :79 + :577 sites are defensive rule violations: `updateBrandCache` (settings.ts:97-164) wraps its body in try/catch and logs via `obs?.error`, so today these are functionally safe. But ref 04 §6 + ref 06 §3 require explicit `.catch()` regardless — a future refactor of `updateBrandCache` (drop the try/catch, surface errors) would silently break invariants.
- **Proof test form**: Catalogue row 12 — static-analysis grep
- **Proof test path**: `workers/organization-api/src/__denoise_proofs__/iter-008/F4-organizations-brand-kv-delete-no-catch.test.ts`
- **MCP evidence**: n/a (static structural test)
- **Bead**: filed at step 7

### F5 — workers:waituntil-no-catch (media-api scheduled cron)

- **Severity**: minor (defensive — `runRecoverStuckTranscoding` is internally try/caught and documented "NEVER throws")
- **File:Line**: `workers/media-api/src/index.ts:242`
- **Description**: `ctx.waitUntil(runRecoverStuckTranscoding(env, ctx))` in the scheduled cron handler with no `.catch()`. The function itself wraps its body in try/catch (line 199-222) and the docstring promises it never throws, so today this is functionally safe. Defensive rule violation only — guards against future refactors that drop the inner try/catch.
- **Proof test form**: Catalogue row 12 — static-analysis grep
- **Proof test path**: `workers/media-api/src/__denoise_proofs__/iter-008/F5-scheduled-recover-no-catch.test.ts`
- **MCP evidence**: n/a (static structural test)
- **Bead**: filed at step 7

### F6 — performance:sequential-await-independent-queries (auth-config dev-path KV.put + email)

- **Severity**: minor — R12 violation per SKILL.md §1 (just promoted from iter-007). Dev/test path only; production runs the email-send path alone.
- **File:Lines**: `workers/auth/src/auth-config.ts:122` + `:128`
- **Description**: BetterAuth `sendVerificationEmail` callback runs two independent awaits sequentially:
  1. `await env.AUTH_SESSION_KV.put('verification:${user.email}', token, { expirationTtl: 300 })` — gated on dev/test env, used only by the `/api/test/verification-token/:email` test endpoint.
  2. `await sendVerificationEmail(env, user, token)` — the real email send via cross-worker fetch to notifications-api.
  Neither consumes the other's value. R12 mandates `Promise.all` for independent awaits. In dev/test this adds ~5-50ms (KV write latency) to every register flow before the email fire; in production this is moot (KV branch skipped). Lifting to `Promise.all([sendEmail, kvPut])` collapses the sequential window.
- **Proof test form**: synthetic load harness (Catalogue row 6) — in-flight counter via fixed-delay mocks. Sequential code never overlaps (peak == 1); parallel transform overlaps (peak >= 2). Three test cases: sequential dev, parallel dev, parallel prod.
- **Proof test path**: `workers/auth/src/__denoise_proofs__/iter-008/F6-auth-config-sequential-kv-and-email.test.ts`
- **MCP evidence**: n/a (in-flight counter is the load harness; cell-canonical for R12 fingerprint per SKILL.md §1 R12 rule text)
- **Bead**: filed at step 7

---

## Summary

| Metric | Value |
|---|---|
| Total findings | 6 |
| Blocker | 0 |
| Major | 3 (F1, F2, F3) |
| Minor | 3 (F4, F5, F6) |
| Testability-bugs | 0 |
| Testability-bug rate | 0% (R8 within budget) |
| Beads filed | 0 (filing happens at step 7 of dispatching skill) |
| Recurrence promotions queued | 1 (`workers:waituntil-no-catch` standard R7 3-hit promotion fires; see Next-cycle prep) |

### Fingerprint distribution

- `workers:waituntil-no-catch` — F1 + F2 + F3 + F4 + F5 (5 findings, 8 individual sites). Cumulative ledger hits: 2 (pre-cycle) + 5 (this cycle) = **7 hits** with cycle_density=5 in iter-008.
- `performance:sequential-await-independent-queries` — F6 (1 finding). Ledger hits: 5 (iter-007) + 1 (this cycle) = 6 hits. Already promoted to R12 in iter-007.

### Endemic-density signal

`workers:waituntil-no-catch` cycle_density=5 in iter-008. Coming in at hits=2, exiting at hits=7. The recurrence threshold (3 hits in trailing 6 cycles) was already exceeded by the second findings on the cycle (iter-002 + iter-003 + this cycle's first hit = 3). This finding triggers **R7 standard 3-hit promotion** — recommended SKILL.md §1 patch in iter-009's prep:

> **R13** — Every `executionCtx.waitUntil(...)` (or `ctx.waitUntil(...)` in scheduled handlers) MUST chain `.catch(...)` on the inner promise expression, OR pass a function whose internal try/catch is documented to never throw — and even then the `.catch()` is recommended defensively. Verified by a static-analysis test per worker that scans every `waitUntil(<expr>);` call and asserts `<expr>` contains `.catch(`. | Major

The promotion citation: `<!-- R13 promoted from iter-008, fingerprint workers:waituntil-no-catch (standard 3-hit threshold; cumulative cycle_density across iter-002 + iter-003 + iter-008 = 7) -->`.

### R12 recurrence

R12 (`performance:sequential-await-independent-queries`) — 1 new instance this cycle (F6, auth-config dev-path). The fingerprint is now in the workers cell as well as packages — but the nature is dev-only and the production path is single-await. Filed at minor severity per the rule's "permitted only when a later query consumes a prior query's value" — F6 is the textbook sequential-independent shape, but the cost surface is dev-only.

### Recurrence-watch carry-forward (informational only — not in scope this cycle)

Per master.md Table B + iter-007's "Recurrence watches":
- `types:as-cast-without-guard` — hits=2, **NOT incremented this cycle** (out-of-scope; types phase not run).
- `types:as-unknown-as` — hits=2, **NOT incremented this cycle** (out-of-scope).
- `types:redundant-cast-after-narrow` — hits=1 cycle_density=6, **NOT incremented this cycle** (out-of-scope).

The audit explicitly searched for these patterns in the workers code-paths but did not file them (R3 — one cell per cycle). They remain at their pre-iter-008 hit counts.

## MCP gate

R6 matrix for `performance × workers`: `playwright` (Hono test client latency) required, observability MCP optional. **Findings F1-F5 are static-pattern (waitUntil-no-catch) findings** — they do not have a runtime latency signal. The proof tests are static-analysis lint rules per Catalogue row 12; the bead body documents this gate exception (per SKILL.md §6: "performance findings ALWAYS need numeric evidence — a measurement before AND after the fix" — but for the fire-and-forget rejection class, the failure mode is rejected-promise visibility, not latency). The fix's bead body should still attach a Playwright Hono test client latency probe showing the `.catch()` does not measurably regress p50/p95 on the route — a "no perf regression introduced by fix" check rather than a "fix improves perf" check.

**F6 (R12 violation)** is a true latency finding — the in-flight counter test in the proof file is the cell-canonical evidence per R12 rule text.

## Next-cycle prep

- **PROMOTION (highest priority)**: iter-009's first action should add R13 to local SKILL.md §1 Hard Rules table:
  > **R13** | Every `executionCtx.waitUntil(...)` (or `ctx.waitUntil(...)` in scheduled handlers) MUST chain `.catch(...)` on the inner promise expression, or pass a function whose internal try/catch is documented to never throw (in which case the `.catch()` is recommended defensively). Verified by a static-analysis test per worker that scans every `waitUntil(<expr>);` call and asserts `<expr>` contains `.catch(`. | Major

  With citation comment `<!-- R13 promoted from iter-008, fingerprint workers:waituntil-no-catch (standard 3-hit threshold; cumulative cycle_density 7 across iter-002 + iter-003 + iter-008) -->`.

- **Suggested next cell**: `simplification × workers` or `simplification × packages` — both at "never run" per master.md Table A; phase priority for simplification is lowest, but they are the only never-run cells remaining. Tie-break: `simplification × workers` (continuity with this cycle's worker focus and avoids a context switch). Alternative: `performance × apps/web` (also never-run, higher phase priority, but a context switch).

- **Recurrence watches (carry-forward)**:
  - `types:as-unknown-as`, `types:as-cast-without-guard` — both at hits=2; one more types-cell increment → R7 standard 3-hit promotion.
  - `types:redundant-cast-after-narrow` — hits=1 cycle_density=6; sibling-shape watch.
  - `performance:array-spread-and-linear-includes-per-render`, `performance:subrequest-cap-sequential-stripe-calls` (iter-007) — track for recurrence.
  - `workers:waituntil-no-catch` — **promoted to R13 (queued)**; ledger entry should mark `promoted: true, rule_id: "R13"`.

- **Add new row to ref 04 §8 + ref 06 §9** anti-pattern tables: cite the R13 lint shape so future cycles know the static-analysis test is the canonical proof form for this fingerprint.

- **Per-finding follow-up**:
  - F1 (ecom-api checkout): single-line fix — chain `.catch((err) => obs?.warn(...))`.
  - F2 (media-api transcoding dispatch): consider where the catch lives. Cleanest is to move the try/catch *into* `triggerJobInternal` (return a never-rejecting `dispatchPromise`) so the route stays clean and every consumer is safe.
  - F3 (organization-api settings — 3 sites): single-PR mechanical fix; chain `.catch(() => {})` minimum on each. Consider extracting to a `safeWaitUntil(ctx, promise, label)` helper if a 4th instance appears.
  - F4 (organization-api organizations.ts — 3 sites): same shape as F3; F4's :572 (BRAND_KV.delete) is the genuine hazard, F4's :79 and :577 are defensive. One PR with F3.
  - F5 (media-api scheduled): defensive only; lowest priority.
  - F6 (auth-config R12): single-PR fix — wrap the conditional KV.put + email send in `Promise.all`. Production path unchanged.

- **Stop-criterion countdown**: `performance × workers` 0/3 (this cycle produced findings).

- **Iter-008 fix entanglement**:
  - F1 standalone (single file, single line).
  - F3 + F4 share `organization-api` worker; recommend consolidated PR.
  - F2 + F5 share `media-api` worker; can land same PR.
  - F6 standalone (auth worker).
