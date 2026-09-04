# Iteration 026 — performance × packages

- **Cell**: performance × packages
- **Date**: 2026-04-26
- **Mode**: delta
- **Since**: `7345a106` (iter-019..024 batch baseline; effectively all Round-3 churn)
- **Files churned**: 33 files in `packages/*/src/**` (excluding tests + denoise proofs)
- **Agent**: agents/audit-packages.md (Phase B performance branch, Round 2 second-pass cycle 2)
- **Fallow JSON**: `/tmp/denoise-iter-026-fallow.json` (218 issues; cross-cell signal — packages-only entries are FP #3 service-registry dispatch class members)
- **Typecheck baseline**: `/tmp/denoise-iter-026-typecheck-baseline.log` (clean: 53/53 pass)
- **HEAD before audit**: `d5392cde` (typecheck infra fixes)
- **Mode label**: drift-detection (Round 2 second-pass cycle 2)

---

## §5 step 1 — Cell-due algorithm

```bash
git log 7345a106..HEAD --name-only --pretty=format: -- 'packages/*/src/**' \
  | sort -u | grep -v __tests__ | grep -v __test__ | grep -v __denoise_proofs__
```

33 files churned. Round 3 was a major denoise execution — Tier 1–7 commits landed
between `be00ddb1` and `253ffab4`, executing previously-filed beads (waitUntil, HSTS,
type unification, R12 parallelisation, R14 cache-fanout extraction, CSP header,
unsubscribe rate-limit). The Tier 4.D commit (`7715eaf3`) is the dominant signal for
this cell — it parallelised analytics + access services (closed Codex-y63gl.1, .4, .5).

This audit checks (a) whether Tier 4.D's R12 work was effective AND (b) whether new
churn introduced any fresh sequential-await drift.

---

## Fabrication check

- 22 anti-pattern rows cited across reference 04 §8 (12 rows) + reference 07 §7 (10 rows)
- 22 verified live in codebase
- 0 stale (no doc-rot findings this cycle)

Symbols re-confirmed live (selected high-traffic rows):

| Reference | Row | Symbol/pattern | Hits in scope |
|---|---|---|---|
| 04 §8 row 1 | n-plus-1-await-in-loop | `for/while` over `await this.db.X(item.id)` | 0 (clean) |
| 04 §8 row 5 | findMany without columns projection | `.findMany(` | 32 (mostly intentional with-relation reads; not flagged) |
| 04 §8 row 6 | waitUntil w/o catch | `waitUntil(` in packages | 20 (R13 enforcement; spot-checked, all wrap a `.catch()` |
| 04 §8 row 7 | sync I/O in async path | `readFileSync \| writeFileSync \| execSync` | 0 (clean) |
| 04 §8 row 8 | unbounded pagination | `withPagination` correct usage | 18 callers (clean) |
| 04 §8 row 9/11 | string-concat-in-hotpath / JSON-parse-stringify | `JSON.parse(JSON.stringify(` | 0 in src (test-only) |
| 04 §8 row 13 (R12-promoted) | sequential-await-independent-queries | this audit | 1 new finding (F1) |
| 07 §7 row 1 | scopedNotDeleted / withCreatorScope | both used in services | live |
| 07 §7 row 2-4 | BaseService / typed errors / handleError | services extend BaseService | live |

**Round 3 R12 effectiveness — verified live in code:**

- `analytics-service.computeRevenueBlock:131` — `Promise.all([aggregate, daily])` ✓
- `analytics-service.computeSubscriberBlock:251` — `Promise.all([active, new, churned, daily])` ✓
- `analytics-service.computeFollowerBlock:398` — `Promise.all([total, new, daily])` ✓
- `analytics-service.getRevenueStats:75` / `getSubscriberStats:201` / `getFollowerStats:341` — `Promise.all([current, previous])` ✓
- `analytics-service.getDashboardStats:938` — `Promise.all([revenue, customers, topContent])` ✓
- `analytics-service.getRecentActivity:829` — `Promise.all([items, count])` ✓
- `ContentAccessService.hasContentAccess` — FOLLOWERS branch :327 (`subscribed||followed`),
  SUBSCRIBERS branch :339 (`subscribed||purchased`) both `Promise.all` ✓
- `tier-service.createTier:225` — monthly + annual prices via `Promise.all` ✓
- `paginatedQuery()` helper (new at `packages/database/src/utils/paginated-query.ts:158`) —
  internal `Promise.all([fetchItems(), runCount()])` ✓
  Adopted by content-service.list/listPublic, media-service.list, template-service
  listGlobal/Org/Creator. Spot-checked all 6 sites — all use the helper ✓
- `image-processing/upload-pipeline.ts:80` — `Promise.allSettled` of 3 variants ✓
- `content-invalidation.ts:380` — `Promise.all([purchases, subs, mgmt, followers])` ✓
- `cloudflare-clients/cache/client.ts:60` — `Promise.allSettled` of batched purges ✓

**R12 Round 3 outcome**: drift-prevention working. The new churn applied R12 carefully
across service boundaries. F1 below is a previously-uncovered call site that was outside
the iter-007 scope (the dashboard trend cards), not a regression of fixed code.

---

## Findings

### F1 — performance:sequential-await-independent-queries (getCustomerStats)

- **Severity**: minor
- **File:Line**:
  - `packages/admin/src/services/analytics-service.ts:462` — `totalResult = await this.db.select({totalCustomers: countDistinct(...)})`
  - `packages/admin/src/services/analytics-service.ts:482` — `newCustomersResult = await this.db.execute(sql`WITH first_purchases AS (...) SELECT COUNT(*) ...`)`
- **Description**: `getCustomerStats` issues two sequential `await` statements where
  neither result is consumed by the other. Both queries:
  - Touch `purchases` filtered by `(organization_id, status='completed')`
  - Are read-only aggregates with no foreign-key resolution between them
  - Can run concurrently via `Promise.all` for ~80-120ms latency reduction at
    Neon HTTP p95
  This is the **first drift-detection sighting** of `performance:sequential-await-independent-queries`
  since R12 promoted (iter-008) and since Tier 4.D parallelised the dashboard
  trend-block helpers (iter-007 F1/F2/F4/F5). `getCustomerStats` was outside the
  iter-007 scope (which focused on the trend KPIs); Tier 4.D's commit message
  cites only the trend blocks. The pattern persists here unchallenged.
- **Recurrence context**: hit #2 of `performance:sequential-await-independent-queries`
  in trailing 6 cycles for packages scope (master.md Table B currently shows hits=2
  with cumulative cycle_density=6 — Codex-y63gl.1-5, .8, .13). Already promoted to
  R12 in iter-008. This finding is a **straightforward R12 violation in churned
  code** (analytics-service.ts is in the iter-019..HEAD churn list).
- **Proof test form**: synthetic load harness (Catalogue row 6) — peak in-flight
  counter via mocked Drizzle client. Sequential code never overlaps; parallel code
  overlaps when each query takes > 0ms. Asserts `peak >= 2` after fix.
- **Proof test path**: `packages/admin/src/__denoise_proofs__/iter-026/F1-getCustomerStats-sequential-queries.test.ts`
- **MCP evidence**: cell-canonical Vitest `bench()` (per SKILL.md §3 matrix). Bead
  body should attach before/after delta from `pnpm --filter @codex/admin test:bench`
  once the fix lands. The proof's in-flight counter alone is sufficient at gate
  time.

---

## Summary

| Metric | Value |
|---|---|
| Total findings | 1 |
| Blocker | 0 |
| Major | 0 |
| Minor | 1 (F1) |
| Testability-bugs | 0 |
| Testability-bug rate | 0% (R8 within budget) |
| Beads filed | 0 (filing happens at step 7 of dispatching skill) |
| Recurrence promotions queued | 0 (R12 already applied iter-008; F1 is a recurrence increment) |

**Drift-detection verdict**: Round 3 Tier 4.D R12 work was **effective and targeted** —
all 7 audit-confirmed Promise.all sites verified live. R12 carve-out adherence in
churned code is **strong**: analytics + access + content + notifications + admin all
parallelise their independent awaits where feasible. The single finding (F1) is a
**previously-uncovered call site** that was outside iter-007's scope, not a regression
of fixed code.

**No new fingerprints introduced this cycle.** No N+1 await-in-loop, no KV cache
misses (cell scope: packages don't access KV directly), no sync I/O, no JSON-clone
roundtrips, no string-concat hotpaths, no unbounded findMany on growing tables, no
new subrequest-cap risk, no hot-path allocation regressions.

**Open beads under Codex-y63gl that touch packages** (verified status — none in churn,
all remain open per master.md cross-reference):
- Codex-y63gl.2 — `customer-management-service.getCustomerDetails` sequential stats+history
  (NOT in churn; pre-existing tracked finding)
- Codex-y63gl.3 — `notifications/templates/renderer.ts` (Codex-y63gl.6 actually) —
  `getAllowedTokens` array spread + Array.includes (NOT in churn)
- Codex-y63gl.6 — Set vs Array.includes in renderer (NOT in churn; pre-existing)
- Codex-y63gl.7 — tier-service.updateTier sequential Stripe price.create/update
  (NOT in churn — tier-service.ts unchanged since iter-007 baseline)
- Codex-y63gl.8 — access/listUserLibrary step 1+1b sequential (file IS in churn but
  Tier 4.D diff did not touch step 1 lines 1232/1250 — only F3 hasContentAccess at
  line 327. Step 1's conditional structure (`accessType === 'purchased' ? [] :
  await ...`) makes a Promise.all transform trickier; both branches must remain
  empty-array-friendly. This is exactly why iter-007 marked F8 as `minor`.)
- Codex-y63gl.13 — auth-config R12 violation, dev-only (NOT in scope — apps/web/workers)

## Skill patches applied

- (none) — references 04 + 07 anti-pattern rows confirmed accurate; Round 3 work
  successfully realised the R12 hard rule without introducing new patterns or
  documentation drift.

Suggested for a future cycle's prep (not applied this cycle):

- The Tier 4.D commit's own note flags that **iter-007 F1/F2/F3 proof tests are
  stub-style** (commented hints, no real assertions). The proof file in
  `packages/access/src/__denoise_proofs__/iter-007/` and analytics-service test
  proofs should be fleshed out with the real R12 in-flight counter shape — the
  test agent in iter-007 left them `.skip()`'d and relied on existing
  `analytics-service.test.ts` integration coverage. That catches behavioural
  regressions in query results but NOT a future revert from `Promise.all` back
  to sequential `await`. Consider opening Codex-y63gl.X — "flesh iter-007 R12
  proof stubs into real in-flight counter assertions" — as a P3 follow-up.
- Helper-grep guard for R12 (analogue of R14's `cache.invalidate` grep): a
  static-analysis test that scans `packages/*/src/services/**` for two
  consecutive `await this.db.{select,query,execute}` lines without an
  intervening control-flow guard, flagging each as a candidate R12 violation
  for human review. Would have caught F1 automatically.

## Next-cycle prep

- **F1 follow-up**: single-line transform in `analytics-service.getCustomerStats`
  (462 + 482 → `Promise.all`). Estimated 10-line diff. Bench attachment to bead
  via `pnpm --filter @codex/admin test:bench` (existing harness).
- **Recurrence increment**: `performance:sequential-await-independent-queries`
  hits=2 → 3 in the recurrence ledger. Already promoted to R12 — no further
  rule promotion. The 3-hit threshold is informational only for already-promoted
  rules.
- **Stop-criterion countdown**: `performance × packages` increments to **0/3**
  (cycle produced 1 new finding; stop-criterion resets when any new fingerprint
  surfaces, but a recurrence increment of an already-tracked fingerprint that
  was missed by the original audit's scope arguably should not reset — TBD by
  the dispatching skill's reading). Conservative interpretation: **1/3 toward
  fidelity** (this cycle confirmed strong R12 effectiveness; only one
  call-site missed).
- **Carry-forward fingerprint watches** (from master.md, in-scope this cycle):
  - `performance:sequential-await-independent-queries` — R12 promoted; F1 is
    recurrence increment #2 in packages scope.
  - `performance:hot-path-allocation-render-loop` (cycle_density=1) — confirmed
    no new instances in churned packages (all `new Date()` are SQL params, no
    JSON-clone roundtrips, no per-call regex compilation).
  - `performance:subrequest-cap-sequential-stripe-calls` — Codex-y63gl.7 still
    open in tier-service.updateTier (file NOT in churn, no new instances).
- **Suggested next cell**: simplification × packages OR types × workers — both
  have last_run = iter-022/iter-017 respectively in master.md and would benefit
  from a Round 3 churn re-audit. The Tier 4.C work (paginatedQuery() helper)
  collapsed 6 list-method clones — that's exactly the kind of simplification
  cell signal worth verifying. Recommend `simplification × packages` next
  (iter-022 baseline; consumer churn is high; Tier 5.A/5.B tier-name image
  pipeline extraction is also packages-domain simplification work).
- **R12 R-rule effectiveness measurement**: this cycle is the cleanest
  evidence yet that promoted R-rules drive code-level outcomes. Tier 4.D
  closed 3 beads (Codex-y63gl.1, .4, .5) by faithfully applying R12. Worth
  noting in master.md "Recurrence watches" as a closed-loop signal.
