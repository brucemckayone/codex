# Iteration 007 — performance × packages

- **Cell**: performance × packages
- **Date**: 2026-04-25
- **Mode**: delta
- **Since**: 14 days ago (iter-006 baseline ref `a79bbcc3`)
- **Files churned**: 93 files in `packages/*/src/**` (excluding tests + migrations)
- **Agent**: agents/audit-packages.md (Phase B performance branch)
- **Fallow JSON**: `/tmp/denoise-iter-007-fallow.json` (207 issues; cross-cell, used as background)
- **Typecheck baseline**: `/tmp/denoise-iter-007-typecheck-baseline.log` (3 pre-existing errors in `@codex/worker-utils` carried from iter-005; not a regression)

## Fabrication check

- 22 anti-pattern rows cited across reference 04 (12 rows in §8) + reference 07 (10 rows in §7)
- 22 verified live in codebase
- 0 stale (no doc-rot findings this cycle)

Symbols re-confirmed live:
| Reference | Row | Symbol/pattern | Hits |
|---|---|---|---|
| 04 §8 row 1 | n-plus-1-await-in-loop | `for (.. of ..) { await db.X }` | 0 in scope (tests only) |
| 04 §8 row 2 | KV.get without cacheTtl | `\.KV\.get(` | 0 (clean) |
| 04 §8 row 5 | findMany without columns | `.findMany(` w/o `columns:` | 3 (3 reviewed; 1 in F8 candidate) |
| 04 §8 row 6 | waitUntil w/o catch | `waitUntil(` | 16 (audited at iter-002, iter-003 — not re-flagged) |
| 04 §8 row 7 | sync I/O in async path | `readFileSync\|writeFileSync\|execSync` | 0 (clean) |
| 04 §8 row 8 | unbounded pagination | `withPagination` correct usage | 3 callers (clean) |
| 04 §8 row 9/11 | string-concat-in-hotpath / JSON-parse-stringify | `JSON.parse(JSON.stringify(` | 0 (clean) |
| 07 §7 row 1 | scopedNotDeleted / withCreatorScope | both used in services | live |
| 07 §7 row 2-4 | BaseService / typed errors / handleError | 22 services extend BaseService | live |

The package code is in good performance hygiene at the static-pattern level. **No N+1 await-in-loop, no KV-without-cacheTtl, no sync I/O, no JSON-clone-via-roundtrip, no string-concat-in-loop, no unbounded findMany on growing tables.**

The findings below are all of one shape: **independent sequential `await` statements that should run via `Promise.all`.** This is a recurring pattern across analytics, access, organization, and subscription services. New fingerprint: `performance:sequential-await-independent-queries`.

---

## Findings

### F1 — performance:sequential-await-independent-queries (analytics block helpers)

- **Severity**: major
- **File:Line**:
  - `packages/admin/src/services/analytics-service.ts:118` and `:142` — `computeRevenueBlock` (2 sequential queries: aggregate + daily)
  - `packages/admin/src/services/analytics-service.ts:227`, `:247`, `:259`, `:271` — `computeSubscriberBlock` (4 sequential queries: active + new + churned + daily)
  - `packages/admin/src/services/analytics-service.ts:367`, `:378`, `:390` — `computeFollowerBlock` (3 sequential queries: total + new + daily)
- **Description**: The studio analytics dashboard composes its top-level result via `Promise.all` (`getDashboardStats` line 903), but each inner block helper issues 2-4 sequential `await this.db.select(...)` calls whose results are independent (none of the later queries consume earlier query values). At Neon HTTP p95 (~80-120ms), `computeSubscriberBlock` alone is 320-480ms when it could be ~100ms via `Promise.all`. The redesigned analytics dashboard (epic Codex-84b53, iter-018) is the heaviest consumer.
- **Proof test form**: synthetic load harness (Catalogue row 6) — in-flight counter via mocked Drizzle client. Sequential code never overlaps; parallel code overlaps when each query takes > 0ms. Asserts `peak >= 2` after fix.
- **Proof test path**: `packages/admin/src/__denoise_proofs__/iter-007/F1-analytics-sequential-block-queries.test.ts`
- **MCP evidence**: Vitest `bench()` — performance × packages cell does not require chrome-devtools. The proof harness measures wall-clock + query count.

### F2 — performance:sequential-await-comparison-blocks (analytics current-vs-previous)

- **Severity**: major
- **File:Line**:
  - `packages/admin/src/services/analytics-service.ts:69` and `:76` — `getRevenueStats`
  - `packages/admin/src/services/analytics-service.ts:184` and `:191` — `getSubscriberStats`
  - `packages/admin/src/services/analytics-service.ts:313` and `:320` — `getFollowerStats`
- **Description**: When `compareFrom`/`compareTo` are passed (default for the analytics-redesign trend KPIs), each stats method computes the `current` block, then sequentially computes the `previous` block. The two windows are disjoint date ranges with no data flow between them. Combined with F1, a single `getSubscriberStats({ ..., compareFrom, compareTo })` call issues 8 sequential queries (4 current + 4 previous) when 1-2 batches via `Promise.all` would suffice.
- **Proof test form**: synthetic load harness (Catalogue row 6) — wall-clock comparison with fixed-delay mock. Sequential current → previous = ~2x single-block time; parallel = ~1x.
- **Proof test path**: `packages/admin/src/__denoise_proofs__/iter-007/F2-analytics-current-vs-previous-sequential.test.ts`
- **MCP evidence**: Vitest `bench()` (cell-canonical).

### F3 — performance:sequential-await-access-decision-branches

- **Severity**: major
- **File:Line**: `packages/access/src/services/ContentAccessService.ts:228` (`hasContentAccess`)
- **Description**: The FOLLOWERS, SUBSCRIBERS, and PAID branches each issue up to 3 sequential awaits to evaluate access (subscription / follower / management / purchase). Called from `savePlaybackProgress` (line 1092) which fires every progress save — every 5-10 seconds while a user is watching. Worst case (deny path): 3 × Neon round-trips = ~300ms blocking the progress write. Granted-access paths short-circuit on first truthy, but the deny path is exactly when latency matters because the request is being rejected.
- **Proof test form**: synthetic load harness (Catalogue row 6) — peak in-flight counter + query count assertion under deny path. Strict `Promise.all` over-fetches (the OR is short-circuit), but a "launch the cheap pair concurrently, fall through to management" transform brings the deny path from 3 to 2 queries with `peak >= 2`.
- **Proof test path**: `packages/access/src/__denoise_proofs__/iter-007/F3-hasContentAccess-sequential-branches.test.ts`
- **MCP evidence**: Vitest `bench()` (cell-canonical).

### F4 — performance:sequential-await-independent-queries (org public profile enrichment)

- **Severity**: minor
- **File:Line**: `packages/organization/src/services/organization-service.ts:479` (`recentItems`) and `:526` (`otherMemberships`) inside `getPublicCreators`
- **Description**: After the parallelised count + members query (line 413), the method enriches the result with two sequential queries: top-4 recent content per creator (window function) + other-org memberships per creator. Both depend only on the resolved `members` set; neither consumes the other's value. Mitigated by the `ORG_CREATORS` KV cache, but cold-cache renders pay an extra Neon round-trip.
- **Proof test form**: synthetic load harness (Catalogue row 6) — same in-flight counter as F1.
- **Proof test path**: `packages/organization/src/__denoise_proofs__/iter-007/F4-getPublicCreators-sequential-enrichment.test.ts`
- **MCP evidence**: Vitest `bench()` (cell-canonical).

### F5 — performance:sequential-await-independent-queries (admin customer details)

- **Severity**: minor
- **File:Line**: `packages/admin/src/services/customer-management-service.ts:218` (`getCustomerDetails`)
- **Description**: After the user lookup early-return guard (line 222), `statsResult` (line 231) and `purchaseHistory` (line 259) run sequentially. Both filter on `(customerId, organizationId, status=COMPLETED)` and are independent. The success case (typical for an admin opening a customer detail page) saves one round-trip with `Promise.all`. The no-purchases case throws `NotFoundError` from stats and discards the history result — slightly more work but rare.
- **Proof test form**: synthetic load harness (Catalogue row 6).
- **Proof test path**: `packages/admin/src/__denoise_proofs__/iter-007/F5-customer-details-sequential-stats-history.test.ts`
- **MCP evidence**: Vitest `bench()` (cell-canonical).

### F6 — performance:array-spread-and-linear-includes-per-render

- **Severity**: minor
- **File:Line**: `packages/notifications/src/templates/renderer.ts:301` (`getAllowedTokens`) and `:80` (`allowedTokens.includes`)
- **Description**: `getAllowedTokens` allocates a fresh array via three spreads on every call (`[...brand, ...unsubscribe, ...template]`). `renderTemplate` then calls `Array.includes()` per token — O(n × m) where n=allowed tokens (~20-30) and m=template tokens (~5-15). A `Set<string>` lookup is O(1) per token; precomputing once per template eliminates the per-render allocation.
- **Proof test form**: `bench()` with explicit threshold (Catalogue perf default) — measure ops/sec on a fixed corpus, assert post-fix beats pre-fix.
- **Proof test path**: `packages/notifications/src/__denoise_proofs__/iter-007/F6-getAllowedTokens-array-spread-and-includes.test.ts`
- **MCP evidence**: Vitest `bench()` (cell-canonical).

### F7 — performance:subrequest-cap-sequential-stripe-calls

- **Severity**: minor
- **File:Line**: `packages/subscription/src/services/tier-service.ts:340` (`updateTier`)
- **Description**: When both monthly and annual prices change, the method issues up to 5 sequential Stripe API calls: monthly `prices.create` → monthly `prices.update` (archive old) → annual `prices.create` → annual `prices.update` → `products.update`. Each call is a Cloudflare subrequest (~200-500ms). The monthly and annual blocks are independent — no data flow between them. The product update is also independent. Sequential worst-case ~1.5s; parallel worst-case ~600ms. Subrequest budget is comfortable (5 of 50/1000), but felt latency on creator tier edits.
- **Proof test form**: synthetic load harness (Catalogue row 6) — mock Stripe tracker; assert `peak >= 2` after fix.
- **Proof test path**: `packages/subscription/src/__denoise_proofs__/iter-007/F7-tier-update-sequential-stripe-prices.test.ts`
- **MCP evidence**: Vitest `bench()` (cell-canonical).

### F8 — performance:sequential-await-independent-queries (library step 1)

- **Severity**: minor
- **File:Line**: `packages/access/src/services/ContentAccessService.ts:1222` (`activeMemberships`) and `:1240` (`activeSubscriptions`) inside `listUserLibrary`
- **Description**: Step 1 + 1b of `listUserLibrary` sequentially awaits two independent queries used to build downstream filters. Step 5 (line 1700) correctly uses `Promise.all` for the three library queries — but the step-1 setup pays an extra round-trip on every library page load. (Both queries are gated on `input.accessType` but their conditions are independent of each other.)
- **Proof test form**: synthetic load harness (Catalogue row 6).
- **Proof test path**: `packages/access/src/__denoise_proofs__/iter-007/F8-listUserLibrary-step1-sequential.test.ts`
- **MCP evidence**: Vitest `bench()` (cell-canonical).

---

## Summary

| Metric | Value |
|---|---|
| Total findings | 8 |
| Blocker | 0 |
| Major | 3 (F1, F2, F3) |
| Minor | 5 (F4, F5, F6, F7, F8) |
| Testability-bugs | 0 |
| Testability-bug rate | 0% (R8 within budget) |
| Beads filed | 0 (filing happens at step 7 of dispatching skill) |
| Recurrence promotions queued | 0 (new fingerprint introduced; first sighting) |

**Endemic-density signal**: 5 of 8 findings (F1, F2, F4, F5, F8) share the **same** fingerprint `performance:sequential-await-independent-queries`. This is `cycle_density=5` for a brand-new fingerprint — historically (per master.md Table B) this has been a 2-hit early-promotion signal. Recommend **endemic 5-hit early promotion** to a hard rule R12 in iter-008's prep:

> **R12 (proposed)** — Service methods MUST launch independent DB queries via `Promise.all`. Sequential `await` is permitted only when a later query consumes a prior query's value (e.g., guard-then-fetch, transaction step ordering). Verified by an in-flight counter test that asserts peak overlap >= 2 for the public method.

The pattern's footprint across analytics, access, organization, customer-mgmt argues for hardening it via lint or a service-method audit rule rather than per-cycle whack-a-mole.

**No 3rd-hit recurrences** of older fingerprints this cycle (`workers:waituntil-no-catch` stayed at hits=2; `types:as-cast-without-guard` and `types:as-unknown-as` are types-cell concerns and not in scope).

## Skill patches applied

- (none) — references 04 + 07 are accurate; no doc-rot found.

Suggested for iter-008's prep, not applied this cycle:
- Add new row to `references/04-performance.md` §8 anti-pattern table:
  - `13 | performance:sequential-await-independent-queries | Multiple independent DB/API awaits in same method run sequentially | Multiplies latency by N; under 100ms Neon p95 a 4-await sequential block is 400ms when 100ms is achievable | Wrap in `Promise.all()` |`
- Document the FOLLOWERS-branch short-circuit-with-parallel-launch idiom in `/backend-dev` reference (the access-decision-branches case is subtle and needs guidance).

## Next-cycle prep

- **Endemic-density promotion candidate**: `performance:sequential-await-independent-queries` (cycle_density=5, single cycle). Recommend R12 promotion in iter-008's prep — same precedent as R11's 2-hit early promotion for `types:type-duplicate-cross-package`.
- **Per-finding follow-up**:
  - F1 + F2 (analytics): consolidate into one fix PR — analytics-service.ts is one file, parallelism transform is mechanical. Bench delta (mock-DB before/after) attaches to the bead.
  - F3 (hasContentAccess): proof-test wiring is the trickier piece. The Drizzle `findFirst` chain is harder to mock than `select(...)`. Consider exposing a typed helper that the test can inject, OR using a real `setupTestDatabase()` integration test under `packages/access/src/__tests__/`.
  - F6 (renderer): bench harness is fully wired in this iteration — fix can land standalone.
  - F4, F5, F7, F8: minor; can batch into a single "parallelisation pass" PR if maintainer prefers.
- **Stop-criterion countdown**: `performance × packages` 0/3 (cycle produced 8 findings).
- **Carry-forward fingerprint watches** (from master.md):
  - `workers:waituntil-no-catch` (hits=2) — not in scope; track in workers cells
  - `types:as-cast-without-guard`, `types:as-unknown-as` (hits=2 each) — not in scope
- **Suggested next cell**: `performance × workers` (KV miss rate, waitUntil leak, subrequest cap on routes that consume the analytics services flagged here). Tie-break: continuity with this cycle's hot-path concerns. Phase priority puts security>types>performance>simplification, but security/types cells were last run iter-006 and remain skipped (no churn).
- **Iter-007 fix entanglement**:
  - F1 + F2 in same file (`analytics-service.ts`); single PR.
  - F3 + F8 both in `ContentAccessService.ts`; single PR feasible.
  - F4, F5, F6, F7 are independent files.
