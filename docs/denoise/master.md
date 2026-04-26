# Denoise — Master Status Board

> Generated and maintained by the `/denoise` skill. Do not edit by hand outside of dismissing diffs.
> See `.claude/skills/denoise/SKILL.md` for the workflow.

## ⚠️ R7 promotions — R9-R13 applied; **R14 queued (endemic 2-hit fired iter-011)**

- **R9 (applied iter-003)** — `security:auth-endpoint-no-ratelimit` from iter-002 F1.
- **R10 (applied iter-004)** — `security:missing-csp` from iter-003 F2.
- **R11 (applied iter-006)** — `types:type-duplicate-cross-package` from iter-005 endemic 2-hit early promotion.
- **R12 (applied iter-008)** — `performance:sequential-await-independent-queries` from iter-007 endemic single-cycle 5-hit promotion.
- **R13 (applied iter-009)** — `workers:waituntil-no-catch` from iter-008 R7 standard 3-hit threshold.
- **R14 (queued for iter-012)** — `simplification:duplicate-utility-helper`. **R7 ENDEMIC 2-HIT PROMOTION fires** in iter-011. Cumulative cycle_density=7 across iter-009 + iter-011 (mirrors R11 endemic-2-hit profile). Iter-012's first action MUST add **R14** to SKILL.md §1 with citation `<!-- R14 promoted from iter-011, fingerprint simplification:duplicate-utility-helper (endemic 2-hit early promotion; cumulative cycle_density 7) -->`. Suggested rule: "Cache-fanout helpers (per-user library invalidation, slug-keyed cache invalidation, content-version bumps) MUST live in `@codex/cache` or `@codex/worker-utils`, not as inline route helpers. Verified by a grep guard over `workers/*/src/routes/**` asserting no `cache.invalidate(CacheType.COLLECTION_*)` literal appears outside the canonical helper sites." Severity: Major.
- **Recurrence watches (iter-012+)**:
  - `simplification:dup-procedure-context-builder` — hits=2 (iter-009 + iter-011). One more cycle hit triggers R7 standard 3-hit promotion.
  - `simplification:dup-paginated-list-shape` (iter-009, cycle_density=6) — 2-hit early-promotion watch CLOSED for workers cell (workers correctly delegate to services). Carries forward to next packages cycle.
  - `types:as-unknown-as` + `types:as-cast-without-guard` both at hits=2 — one more cycle hit triggers R7 standard 3-hit promotion.
  - `types:redundant-cast-after-narrow` (NEW iter-006, cycle_density=6) — sibling shape watch.

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
| performance × workers | iter-008 (2026-04-26) | 5 | 0 | 2026-04-26 | skipped (no churn since iter-008) |
| performance × apps/web | iter-010 (2026-04-26) | 5 | 0 | 2026-04-26 | skipped (no churn since iter-010) |
| simplification × packages | iter-009 (2026-04-26) | 6 | 0 | 2026-04-26 | skipped (no churn since iter-009) |
| simplification × workers | iter-011 (2026-04-26) | 5 | 0 | 2026-04-26 | skipped (no churn since iter-011) |
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
| `workers:waituntil-no-catch` | **3** | 2026-04-26 | 2026-04-26 | **PROMOTED → R13 (queued for iter-009)**, cumulative cycle_density=7 across 3 cycles (Codex-ttavz.9, .16 + Codex-y63gl.9-.12) |
| `types:type-duplicate-cross-package` | **3** | 2026-04-26 | 2026-04-26 | **PROMOTED → R11 (APPLIED iter-006)**, cumulative cycle_density=16 across 3 scopes (Codex-lqvw4.1-8, .15, .16) |
| `types:type-narrowing-incomplete-orgmanagement` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint, **BLOCKER** (Codex-lqvw4.11) |
| `types:as-cast-without-guard` | **2** | 2026-04-26 | 2026-04-26 | recurrence #2 of 3 (Codex-lqvw4.9, .12) — 1 more triggers R7 promotion |
| `types:as-unknown-as` | **2** | 2026-04-26 | 2026-04-26 | recurrence #2 of 3 (Codex-lqvw4.10, .17, .18, .19) — 1 more triggers R7 promotion |
| `types:redundant-cast-after-narrow` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint, cycle_density=6 (Codex-lqvw4.13) — sibling-shape watch |
| `types:any-explicit` | 1 | 2026-04-26 | 2026-04-26 | tracked, first apps/web filing (Codex-lqvw4.14) |
| `performance:sequential-await-independent-queries` | **2** | 2026-04-26 | 2026-04-26 | **PROMOTED → R12 (APPLIED iter-008)**, cumulative cycle_density=6 (Codex-y63gl.1-5, .8, .13) |
| `performance:array-spread-and-linear-includes-per-render` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint (Codex-y63gl.6) |
| `performance:subrequest-cap-sequential-stripe-calls` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint (Codex-y63gl.7) |
| `simplification:duplicate-utility-helper` | **2** | 2026-04-26 | 2026-04-26 | **PROMOTED → R14 (queued for iter-012)**, cumulative cycle_density=7 (Codex-mqyql.1, .5, .7, .8) |
| `simplification:dup-procedure-context-builder` | **2** | 2026-04-26 | 2026-04-26 | recurrence #2 of 3 (Codex-mqyql.2, .9) — 1 more triggers R7 standard 3-hit |
| `simplification:speculative-extension-point` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint (Codex-mqyql.10) |
| `simplification:dup-r2-key-resolution` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint (Codex-mqyql.11) |
| `simplification:dup-paginated-list-shape` | 1 | 2026-04-26 | 2026-04-26 | **endemic-density watch (cycle_density=6)**, R14 candidate (Codex-mqyql.3) — 2-hit early promotion if recurs |
| `simplification:dup-image-pipeline` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint (Codex-mqyql.4) — rule of three |
| `simplification:dup-fetch-with-without-scope` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint (Codex-mqyql.6) |
| `performance:hot-path-shader-config-getcomputedstyle` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint (Codex-y63gl.14) |
| `performance:hot-path-allocation-render-loop` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint (Codex-y63gl.15) |
| `performance:render-thrash-list-no-key` | 1 | 2026-04-26 | 2026-04-26 | tracked, first filing of ref 04 §3 row (Codex-y63gl.16) |
| `performance:kv-get-no-cache-ttl` | 1 | 2026-04-26 | 2026-04-26 | tracked, first filing of ref 04 §4/§8 row 2 (Codex-y63gl.17) |
| `performance:regex-recompiled-per-call` | 1 | 2026-04-26 | 2026-04-26 | tracked, first filing of ref 04 §7 row 14 (Codex-y63gl.18) |

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
| iter-008 | 6 | 0 | 0% | within budget |
| iter-009 | 6 | 0 | 0% | within budget |
| iter-010 | 5 | 0 | 0% | within budget |
| iter-011 | 5 | 0 | 0% | within budget |

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
| iter-008 | performance × workers | 2026-04-26 | 5 (0B/2M/3m) | Codex-y63gl.9–13 | Cycle 0 for cell; **R12 applied at start**; F1 (DUPLICATE of Codex-ttavz.9, NOT re-filed — still-open from iter-002 ecom-api checkout cache invalidation); F2 (.9) MAJOR media-api transcoding dispatchPromise no .catch (RunPod failures silenced); F3 (.10) MAJOR organization-api settings 3 sites (lines 217, 454, 499) — Promise.all+cache.invalidate in branding mutation rejects on first failure; F4 (.11) MINOR organizations.ts 3 sites — :572 raw BRAND_KV.delete is genuine hazard, :79+:577 defensive only; F5 (.12) MINOR media-api scheduled cron defensive; F6 (.13) MINOR R12 violation in auth-config dev-path KV.put + email sequential (production single-await unchanged). 5 of 6 share workers:waituntil-no-catch fingerprint (3rd cycle appearance + 4 new sites + 1 duplicate confirmation) → R7 STANDARD 3-HIT PROMOTION fires (R13 queued for iter-009). First standard-3-hit promotion (R9/R10/R11/R12 used non-standard paths). Fabrication check 14/14 cited symbols live |
| iter-009 | simplification × packages | 2026-04-26 | 6 (0B/4M/2m) | Codex-mqyql.1–6 | Cycle 0 for cell + first beads under simplification epic; **R13 applied at start**; F1+F2 (.1, .2) MAJOR worker-utils dedupe (generateRequestId/getClientIP + procedure context builder vs buildUploadBaseContext); F3 (.3) MAJOR NEW fingerprint simplification:dup-paginated-list-shape — 6 instances across content/notifications (cycle_density=6, R12-profile, queued as 2-hit early-promotion watch for iter-010); F4 (.4) MAJOR image-processing 3 nearly-identical pipelines — cacheControl literal repeated 9 times (rule-of-three); F5 (.5) MINOR @codex/cache should host bumpWithLogger; F6 (.6) MINOR transcoding-service column projection drift. JSCPD: 508 clones cluster-wide; 60+ TS source clones, 6 actionable. Fabrication check 38/38 cited symbols live (0 stale). 0 testability-bugs (R8 budget). Agent showed strong hand-off discipline (14 unused types routed to /fallow-audit, not filed) |
| iter-010 | performance × apps/web | 2026-04-26 | 5 (0B/1M/4m) | Codex-y63gl.14–18 | Cycle 0 for cell; **R12 EFFECTIVENESS CHECK PASSED** — first apps/web cycle since R12 promoted iter-008; zero new sequential-await-independent-queries violations across 13 SvelteKit loaders + helpers; existing parallelism correct (Promise.all for independent, guard-then-fetch for FK ordering — R12 carve-out respected). F1 (.14) MAJOR NEW fingerprint performance:hot-path-shader-config-getcomputedstyle — ImmersiveShaderPlayer + ShaderPreview hit getComputedStyle every frame (60 forced-style-recalcs/sec per active player); canonical ShaderHero already amortises with 30-frame poll counter, immersive overlay shipped without inheriting; F2 (.15) MINOR NEW fingerprint performance:hot-path-allocation-render-loop (120 alloc/sec in immersive playback); F3 (.16) MINOR keyless {#each} on org landing; F4 (.17) MINOR BRAND_KV.get without cacheTtl; F5 (.18) MINOR auth RegExp recompiled per call. Fabrication check 12/12 live |
| iter-011 | simplification × workers | 2026-04-26 | 5 (0B/3M/2m) | Codex-mqyql.7–11 | Cycle 0 for cell; **R12 + R13 EFFECTIVENESS CHECKS PASSED** in spot-checks across ecom-api webhook handlers; F1+F2 (.7, .8) MAJOR — `simplification:duplicate-utility-helper` RECURRENCE #2 (iter-009 + iter-011): 3 inline bumpUserLibrary sites + slug-resolve-then-invalidate dup. Cumulative cycle_density=7 → R7 ENDEMIC 2-HIT PROMOTION fires (R14 queued for iter-012). F3 (.9) MAJOR — `simplification:dup-procedure-context-builder` RECURRENCE #2 (5 sites of createPerRequestDbClient triple-field boilerplate in ecom-api webhooks); ONE MORE CYCLE HIT → R7 standard 3-hit promotion. F4 (.10) MINOR speculative perRequestDb in admin-api types referencing nonexistent middleware; F5 (.11) MINOR R2 key→URL resolution inlined 3× in content-api routes (belongs in service layer). `simplification:dup-paginated-list-shape` 2-hit early-promotion watch CLOSED for workers cell (services own pagination). Fabrication check 14/14 live |

---

## Next-cycle prep

- **PROMOTION (highest priority)**: iter-012's first action is to add R14 to local SKILL.md §1 Hard Rules table:
  > **R14** | Cache-fanout helpers (per-user library invalidation, slug-keyed cache invalidation, content-version bumps) MUST live in `@codex/cache` or `@codex/worker-utils`, not as inline route helpers. Verified by a grep guard over `workers/*/src/routes/**` asserting no `cache.invalidate(CacheType.COLLECTION_*)` literal appears outside the canonical helper sites. | Major

  With citation comment `<!-- R14 promoted from iter-011, fingerprint simplification:duplicate-utility-helper (endemic 2-hit early promotion; cumulative cycle_density 7) -->`.

- **R12 + R13 EFFECTIVENESS CONFIRMED iter-011**: spot-checks across ecom-api webhook handlers found zero new violations of either rule. Both holding on workers cell.
- **Suggested next cell**: ONE remaining never-run cell: **`simplification × apps/web`**. After iter-012, all 12 cells have a baseline cycle and Round 1 closes — Round 2 / drift-detection mode begins.
- **Recurrence watches (carry-forward)**:
  - `simplification:dup-procedure-context-builder` at hits=2 — one more cycle hit → R7 standard 3-hit promotion
  - `simplification:dup-paginated-list-shape` (cycle_density=6 iter-009) — 2-hit early-promotion watch carries to next packages cycle
  - `types:as-unknown-as` + `types:as-cast-without-guard` at hits=2 — one more cycle hit → R7 standard 3-hit promotion
  - `types:redundant-cast-after-narrow` (cycle_density=6 iter-006) — endemic shape watch
  - 5 NEW performance fingerprints from iter-010 — track for recurrence in next perf cycle
  - 2 new simplification fingerprints (`speculative-extension-point`, `dup-r2-key-resolution`) — track for recurrence
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
