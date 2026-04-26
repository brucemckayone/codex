# Denoise — Master Status Board

> Generated and maintained by the `/denoise` skill. Do not edit by hand outside of dismissing diffs.
> See `.claude/skills/denoise/SKILL.md` for the workflow.

## ⚠️ R7 promotions — R9, R10, R11 applied; **R12 queued (endemic single-cycle 5-hit fired)**

- **R9 (applied iter-003)** — `security:auth-endpoint-no-ratelimit` from iter-002 F1.
- **R10 (applied iter-004)** — `security:missing-csp` from iter-003 F2.
- **R11 (applied iter-006)** — `types:type-duplicate-cross-package` from iter-005 F2+F3 endemic 2-hit early promotion.
- **R12 (queued for iter-008)** — `performance:sequential-await-independent-queries` from iter-007 F1+F2+F3+F4+F5+F8 endemic-density single-cycle 5-hit promotion. Cycle_density=5 in single cycle (analytics ×2, access ×2, organization ×1, customer-mgmt ×1). Iter-008's first action MUST add **R12** to SKILL.md §1 with citation `<!-- R12 promoted from iter-007, fingerprint performance:sequential-await-independent-queries (endemic single-cycle 5-hit) -->`. Suggested rule: "Service methods MUST launch independent DB/API awaits via `Promise.all`. Sequential `await` permitted only when later query consumes prior query's value (guard-then-fetch, transaction step ordering). Verified by an in-flight counter test that asserts peak overlap >= 2 for the public method." Severity: Major.
- **Recurrence watches (iter-008+)**: `types:as-unknown-as` and `types:as-cast-without-guard` both at hits=2 — one more cycle hit triggers R7 standard 3-hit promotion. `workers:waituntil-no-catch` stays at hits=2 (not in scope this cycle). `types:redundant-cast-after-narrow` (NEW iter-006, cycle_density=6) — sibling shape to type-duplicate, watch for endemic threshold.

---

## Diffs awaiting review

_None._

> CLAUDE.md regeneration diffs land at `docs/denoise/claude-md-diffs/`. Review and `git apply` (or dismiss).
> R5 forbids auto-applying diffs. Diffs older than 14 days block the cycle they belong to from closing.

---

## Table A — 12-cell status board

| Cell | Last run | Open findings | Open testability-bugs | Last checked | Next due |
|------|----------|---------------|------------------------|--------------|----------|
| security × packages | iter-001 (2026-04-25) | 6 | 0 | 2026-04-25 | skipped (no churn since iter-001) |
| security × workers | iter-002 (2026-04-26) | 5 | 0 | 2026-04-26 | skipped (no churn since iter-002) |
| security × apps/web | iter-003 (2026-04-26) | 5 | 0 | 2026-04-26 | skipped (no churn since iter-003) |
| types × packages | iter-004 (2026-04-26) | 6 | 0 | 2026-04-26 | skipped (no churn since iter-004) |
| types × workers | iter-005 (2026-04-26) | 5 | 0 | 2026-04-26 | skipped (no churn since iter-005) |
| types × apps/web | iter-006 (2026-04-26) | 8 | 0 | 2026-04-26 | skipped (no churn since iter-006) |
| performance × packages | iter-007 (2026-04-26) | 8 | 0 | 2026-04-26 | skipped (no churn since iter-007) |
| performance × workers | _never_ | 0 | 0 | _never_ | **due** ✅ |
| performance × apps/web | _never_ | 0 | 0 | _never_ | **due** ✅ |
| simplification × packages | _never_ | 0 | 0 | _never_ | **due** ✅ |
| simplification × workers | _never_ | 0 | 0 | _never_ | **due** ✅ |
| simplification × apps/web | _never_ | 0 | 0 | _never_ | **due** ✅ |

**Cell-due algorithm** (delta mode):
1. `git log --since=<last_run> --name-only -- <cell-paths>` produces churn list
2. For `packages/<pkg>` cells: also walk consumer graph via `scripts/denoise/consumer-graph.ts <pkg>`
3. Cell is **due** if ANY churn detected
4. Cell is **skipped** if NO churn AND zero open findings AND zero open testability-bugs AND no untracked recurrence patterns

In `--mode=full`, all cells are due regardless of churn.

---

## Table B — Recurrence ledger

Synced from `docs/denoise/recurrence.json` after each cycle. Patterns with `hits >= 1` rendered.

| Fingerprint | Hits | First seen | Last seen | Status |
|---|---|---|---|---|
| `packages:throw-raw-error` | 1 | 2026-04-25 | 2026-04-25 | tracked (Codex-ttavz.1) |
| `packages:identifier-no-shape-validation` | 1 | 2026-04-25 | 2026-04-25 | tracked, NEW fingerprint (Codex-ttavz.2) |
| `denoise:doc-rot:07-domain-packages:row1` | 1 | 2026-04-25 | 2026-04-25 | tracked, doc-rot (Codex-ttavz.3) |
| `denoise:doc-rot:07-domain-packages:row3` | 1 | 2026-04-25 | 2026-04-25 | tracked, doc-rot (Codex-ttavz.4) |
| `denoise:doc-rot:01-security-audit:row9` | 1 | 2026-04-25 | 2026-04-25 | tracked, doc-rot (Codex-ttavz.5) |
| `denoise:doc-rot:01-security-audit:row6` | 1 | 2026-04-25 | 2026-04-25 | tracked, doc-rot (Codex-ttavz.6) |
| `security:auth-endpoint-no-ratelimit` | 1 | 2026-04-26 | 2026-04-26 | **PROMOTED → R9 (queued for next cycle prep)** (Codex-ttavz.7, BLOCKER) |
| `security:public-route-no-ratelimit` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint, major (Codex-ttavz.8) |
| `workers:waituntil-no-catch` | 1 | 2026-04-26 | 2026-04-26 | tracked (Codex-ttavz.9) |
| `denoise:doc-rot:06-domain-workers:row11` | 1 | 2026-04-26 | 2026-04-26 | tracked, doc-rot (Codex-ttavz.10) |
| `denoise:doc-rot:06-domain-workers:row9` | 1 | 2026-04-26 | 2026-04-26 | tracked, doc-rot (Codex-ttavz.11) |
| `web:auth-remote-broken-endpoint` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint, BLOCKER (Codex-ttavz.12) |
| `security:missing-csp` | 1 | 2026-04-26 | 2026-04-26 | **PROMOTED → R10 (queued for iter-004 prep)** (Codex-ttavz.13, BLOCKER) |
| `security:missing-hsts` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint, major (Codex-ttavz.14) |
| `web:auth-form-orphan-rpc-surface` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint, major (Codex-ttavz.15) |
| `workers:waituntil-no-catch` | **2** | 2026-04-26 | 2026-04-26 | **recurrence #2 of 3** (Codex-ttavz.9, .16) — 1 more triggers R-rule |
| `types:type-duplicate-cross-package` | **3** | 2026-04-26 | 2026-04-26 | **PROMOTED → R11 (APPLIED iter-006)**, cumulative cycle_density=16 across 3 scopes (Codex-lqvw4.1-8, .15, .16) |
| `types:type-narrowing-incomplete-orgmanagement` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint, **BLOCKER** (Codex-lqvw4.11) |
| `types:as-cast-without-guard` | **2** | 2026-04-26 | 2026-04-26 | recurrence #2 of 3 (Codex-lqvw4.9, .12) — 1 more triggers R7 promotion |
| `types:as-unknown-as` | **2** | 2026-04-26 | 2026-04-26 | recurrence #2 of 3 (Codex-lqvw4.10, .17, .18, .19) — 1 more triggers R7 promotion |
| `types:redundant-cast-after-narrow` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint, cycle_density=6 (Codex-lqvw4.13) — sibling-shape watch |
| `types:any-explicit` | 1 | 2026-04-26 | 2026-04-26 | tracked, first apps/web filing (Codex-lqvw4.14) |
| `performance:sequential-await-independent-queries` | 1 | 2026-04-26 | 2026-04-26 | **PROMOTED → R12 (queued for iter-008)**, single-cycle cycle_density=5 endemic (Codex-y63gl.1-5,.8) |
| `performance:array-spread-and-linear-includes-per-render` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint (Codex-y63gl.6) |
| `performance:subrequest-cap-sequential-stripe-calls` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint (Codex-y63gl.7) |

**Promotion threshold**: ≥3 hits in trailing 6 cycles → promoted to a hard rule (R9+) in SKILL.md §1.
**Single-hit security exception**: severity=blocker security findings may promote on first sighting. (Fired in iter-002 for F1, in iter-003 for F2.)

---

## Table C — Testability-bug rate (R8 watch)

| Iter | Total findings | Testability-bugs | Rate | Threshold (15%) |
|------|----------------|------------------|------|-----------------|
| iter-001 | 6 | 0 | 0% | within budget |
| iter-002 | 5 | 0 | 0% | within budget |
| iter-003 | 5 | 0 | 0% | within budget |
| iter-004 | 6 | 0 | 0% | within budget |
| iter-005 | 5 | 0 | 0% | within budget |
| iter-006 | 8 | 0 | 0% | within budget |
| iter-007 | 8 | 0 | 0% | within budget |

> R8 fires when rate > 15% in any cycle. The next cycle's prep includes a meta-warning and a justification audit of every testability-bug.

---

## Audit history

| Iter | Cell | Date | Findings | Beads | Notes |
|------|------|------|----------|-------|-------|
| iter-001 | security × packages | 2026-04-25 | 6 (0B/0M/6m) | Codex-ttavz.1–6 | Cycle 0; fabrication check found 4 stale citations across references 01 + 07 (F3–F6) |
| iter-002 | security × workers | 2026-04-26 | 5 (1B/1M/3m) | Codex-ttavz.7–11 | Cycle 0 for cell; F1 BLOCKER (auth rate-limiter stale paths); R7 single-hit promotion fired for `security:auth-endpoint-no-ratelimit` → R9 queued; 2 new doc-rot in ref 06 (F4 = constructEvent vs constructEventAsync; F5 = ctx.storage.transaction / alarmInFlight) |
| iter-003 | security × apps/web | 2026-04-26 | 5 (2B/2M/1m) | Codex-ttavz.12–16 | Cycle 0 for cell; **R9 applied at start** (security:auth-endpoint-no-ratelimit promoted to local SKILL.md §1); F1 BLOCKER (auth.remote.ts forgot/forget-password typo silently breaks reset); F2 BLOCKER (apps/web ships with NO CSP header — R10 queued for iter-004); F3 major (no HSTS); F4 major (orphan auth RPC surface — 3 .remote.ts forms with 0 consumers); F5 minor recurrence #2 of `workers:waituntil-no-catch` in apps/web/src/lib/server/brand-cache.ts |
| iter-004 | types × packages | 2026-04-26 | 6 (1B/2M/3m) | Codex-lqvw4.1–6 | Cycle 0 for cell; **R10 applied at start** (security:missing-csp); single fingerprint `types:type-duplicate-cross-package` with cycle_density=6 (F1 Database 5 declarations, F2 RevenueSplit 2 packages, F3 WaitUntilFn/InvalidationLogger, F4 BLOCKER SessionData/UserData with divergent shapes — silent runtime undefined via index signature, F5 OrganizationMembership name collision, F6 TemplateScope/TemplateStatus/EmailCategory triple-source-of-truth); fabrication check 9/9 ref 02 + 07 cited symbols live (no new doc-rot) |
| iter-005 | types × workers | 2026-04-26 | 5 (1B/3M/1m) | Codex-lqvw4.7–11 | Cycle 0 for cell; F1 BLOCKER (Codex-lqvw4.11): types.ts:230 narrows ctx.organizationId only on requireOrgMembership but runtime helper treats requireOrgManagement identically — 6 silent 'as string' casts in production routes; F2+F3 = `types:type-duplicate-cross-package` recurrence #2 (Logger inlined in 2 worker routes + WaitUntilFn inlined at 5 sites) → triggered ENDEMIC 2-HIT EARLY PROMOTION (R11 queued for iter-006); F4 CacheCtx narrow-then-cast (4 sites in members.ts); F5 'as unknown as' in auth + media-api entry points (createWorker<TEnv>() not used); workers:waituntil-no-catch did NOT recur (3rd instance investigated, error-contained) |
| iter-006 | types × apps/web | 2026-04-26 | 8 (0B/3M/5m) | Codex-lqvw4.12–19 | Cycle 0 for cell; **R11 applied at start**; F1 (.19) UserOrgSubscription wire-shape cast (Date↔string drift); F2 (.12) OrganizationData missing heroLayout/enableSubscriptions — silent contract drift with org-api; F3 (.13) NEW fingerprint types:redundant-cast-after-narrow (6 'as KVNamespace' casts after truthy guard); F4 (.14) result:any in 2 enhance() callbacks; F5 (.15) CreatorCard.svelte inlines types from neighbouring types.ts; F6 (.16) SubscriptionContext declared 3 times (1 SAME-NAME structurally divergent shape — clear future bug source); F7 (.17) + F8 (.18) more `as unknown as` sites; types:type-duplicate-cross-package now hits=3, types:as-unknown-as + types:as-cast-without-guard both at hits=2 of 3; workers:waituntil-no-catch did NOT recur in apps/web |
| iter-007 | performance × packages | 2026-04-26 | 8 (0B/3M/5m) | Codex-y63gl.1–8 | Cycle 0 for cell + first beads under performance epic; F1+F2 (.1, .2) MAJOR analytics-service.ts: computeRevenueBlock/SubscriberBlock/FollowerBlock + current-vs-previous comparison blocks issue 4-8 sequential Neon queries on the studio analytics dashboard hot path (post-iter-018 redesign); F3 (.3) MAJOR ContentAccessService.hasContentAccess deny-path 3 sequential queries on every savePlaybackProgress (every 5-10s during playback); F4 (.4) org public-creators enrichment, F5 (.5) admin customer-details, F8 (.8) access listUserLibrary step 1 — all same fingerprint; F6 (.6) NEW fingerprint performance:array-spread-and-linear-includes-per-render in notifications renderer; F7 (.7) NEW fingerprint performance:subrequest-cap-sequential-stripe-calls in tier-service updateTier (5 sequential Stripe calls). 5 of 8 share NEW fingerprint performance:sequential-await-independent-queries — cycle_density=5 → ENDEMIC SINGLE-CYCLE 5-HIT PROMOTION fired (R12 queued for iter-008). Fabrication check 22/22 cited symbols live |

---

## Next-cycle prep

- **PROMOTION (highest priority)**: iter-008's first action is to add R12 to local SKILL.md §1 Hard Rules table:
  > **R12** | Service methods MUST launch independent DB/API awaits via `Promise.all`. Sequential `await` is permitted only when a later query consumes a prior query's value (guard-then-fetch, transaction step ordering, foreign-key resolution). Verified by an in-flight counter test (mock client tracks concurrent calls; assert peak overlap >= 2 for the public method) OR a `bench()` test asserting parallel runtime is < 1.5× single-query latency. | Major

  With citation comment `<!-- R12 promoted from iter-007, fingerprint performance:sequential-await-independent-queries (endemic single-cycle 5-hit) -->`.

- **Suggested next cell**: `performance × workers` (continuity with iter-007 hot-path concerns; will pick up KV miss rate, waitUntil leaks, subrequest cap on routes consuming the analytics services flagged here). Alternative: `simplification × packages` (only-never-run cell at this point if simplification phase is approached; bumps phase coverage to 4/4). Tie-break by phase priority: performance > simplification, so workers performance cycle wins.
- **Recurrence watches (carry-forward)**:
  - `types:as-unknown-as`, `types:as-cast-without-guard` at hits=2 — one more cycle increment → R7 standard 3-hit promotion
  - `workers:waituntil-no-catch` at hits=2 — workers cell next cycle is the natural place to catch a 3rd
  - `types:redundant-cast-after-narrow` (cycle_density=6 in iter-006) — endemic shape, watch for 2nd hit
  - `performance:array-spread-and-linear-includes-per-render` + `performance:subrequest-cap-sequential-stripe-calls` (iter-007) — track for recurrence
- **Add new row to ref 04 §8 anti-pattern table**: `13 | performance:sequential-await-independent-queries` (per iter-007 agent's recommendation). Land alongside R12 promotion in iter-008 prep.
- **Suggested next cell**: Per phase priority + recent guidance, `types × workers` (same complementary axis as iter-002, will pick up `c.env[name] as ...` patterns hinted by 3 baseline TS errors in worker-utils). Alternative: `types × apps/web` (heaviest churn 464 files; paraglide / TanStack DB / Svelte 5 props axis). Tie-break: continuity with iter-002 → `types × workers`.
- **Fingerprint watches** (carry-forward):
  - `packages:identifier-no-shape-validation` (iter-001 F2) — add to ref 07 §7 if recurs
  - `security:public-route-no-ratelimit` (iter-002 F2) — add to ref 01 §8 row 13 if recurs
  - `web:auth-remote-broken-endpoint`, `web:auth-form-orphan-rpc-surface`, `security:missing-hsts` (iter-003) — track for recurrence
  - `workers:waituntil-no-catch` — recurrence #2 of 3 (one more sighting in iter-005-007 promotes per R7 standard threshold)
  - `types:type-duplicate-cross-package` — hits=1 with cycle_density=6; consider 2-hit early promotion
- **Doc-rot fixes carry-forward** (Codex-ttavz.3-6, .10-11): when these land, re-run cycle-0 fabrication checks on affected cells.
- **Iter-004 deferred (not filed)**: `types:zod-result-not-checked` (9 occurrences in 5 service files — route to /backend-dev), `types:as-unknown-as` in stripe-mock + multipart-procedure (track for 3rd instance), `types:non-null-assertion-overuse` in analytics-service (comment-justified, defer), 3 baseline TS errors in @codex/worker-utils (pre-existing, elevate if survive workers cycle).
- **Iter-004 fix entanglement**:
  - F4 (Codex-lqvw4.1) edits packages/security/src/session-auth.ts AND packages/shared-types/src/worker-types.ts; consumers in worker-utils/src/test-utils.ts and apps/web/src/app.d.ts in same PR.
  - F1, F2, F3, F6 fixes consolidate to canonical site (@codex/shared-types or @codex/cache or canonical foundation); each independent.
- **Stop criterion countdown**: `security × packages` 1/3, `security × workers` 0/3, `security × apps/web` 0/3, `types × packages` 0/3 (this cycle produced findings). All reset on new findings.
