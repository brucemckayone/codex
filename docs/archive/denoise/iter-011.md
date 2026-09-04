# Iteration 011 — simplification × workers

- **Cell**: simplification × workers
- **Date**: 2026-04-26
- **Mode**: delta
- **Since**: 14 days ago (HEAD `b95d533c` iter-010)
- **Files churned**: 31 (workers/*/src/** non-test files)
- **Agent**: agents/audit-workers.md
- **Fallow JSON**: `/tmp/denoise-iter-011-fallow.json` (workers slice: 2 unused exports in auth/email.ts → fallow-audit; 2 unused class members in DurableObject = FP taxonomy #7)
- **Typecheck baseline**: `/tmp/denoise-iter-011-typecheck-baseline.log` (3 pre-existing TS2538/TS2322 in `@codex/worker-utils` — unchanged from iter-004 prep notes)
- **MCP gate**: simplification × all = STATIC; no MCPs required (per SKILL.md §3 matrix)

## Fabrication check

- **Reference 03 (simplification)**: 6 anti-pattern rows + helper symbols cited.
  - `jscpdBudget` ✅ live (`scripts/denoise/jscpd-budget.ts:52`)
  - `findConsumers` ✅ live (`scripts/denoise/find-consumers.ts:48`)
  - `dependencyGraph` — Phase D placeholder, ref already documents "Phase B uses simple grep substitute" (not stale).
  - `withServiceErrors` — referenced as the FIX for try-catch boilerplate, not an existing symbol (no fabrication).
  - `class \w+Factory` — only matches in node_modules (not stale per ref's intent).
- **Reference 06 (workers)**: 12 anti-pattern rows + 9 cited symbols.
  - `procedure`, `ctx.services`, `service-registry.ts`, `workerFetch`, `workerAuth`, `verifyStripeSignature`, `createPerRequestDbClient`, `createWorker`, `STRIPE_EVENTS`, `bumpOrgContentVersion` — all ✅ live.
  - `stripe.webhooks.constructEvent` — already filed as doc-rot in iter-002 (Codex-ttavz.10), not re-filed.
  - `ctx.storage.transaction` / `alarmInFlight` — already filed as doc-rot in iter-002 (Codex-ttavz.11), not re-filed.
- **Status**: 14/14 cited symbols live in current code (excluding 2 already-filed doc-rot rows from iter-002). 0 new doc-rot.

## Findings

### F1 — `simplification:duplicate-utility-helper` (major)

**Sites** (all do `cache.invalidate(CacheType.COLLECTION_USER_LIBRARY(userId))` via VersionedCache + `waitUntil` + `.catch(() => {})`):

- `workers/organization-api/src/routes/members.ts:75-83` — `function bumpUserLibrary(ctx: CacheCtx, userId)`
- `workers/organization-api/src/routes/followers.ts:32-42` — `function bumpUserLibrary(env, ctx, userId)` (same name, different signature)
- `workers/ecom-api/src/handlers/checkout.ts:167-174` — inline (same body)

The two `bumpUserLibrary` declarations have signature differences (CacheCtx wrapper vs raw env+ctx) but identical bodies — they construct `new VersionedCache({ kv: ... })`, dispatch `cache.invalidate(CacheType.COLLECTION_USER_LIBRARY(userId))` via `waitUntil`, and swallow with `.catch(() => {})`. The checkout.ts inline copy adds the third site. Per project memory `feedback_dont_defer_cache_issues.md` and the iter-009 cache-helper extraction principle, this should land in `@codex/cache`.

**Fix**: extract `invalidateUserLibrary({ env, waitUntilFn, userId })` to `@codex/cache`; replace all three sites with the shared call.

**Proof**: `workers/organization-api/src/__denoise_proofs__/iter-011/F1-dup-bump-user-library.test.ts` — two assertions: (a) `function bumpUserLibrary` declarations across worker route files = 0 post-fix; (b) `cache.invalidate(CacheType.COLLECTION_USER_LIBRARY(...))` literal sites in worker route files = 0 post-fix.

**MCP gate**: static.

**Catalogue walk**: row 12 (custom lint rule + test the rule) chosen. Row 1 (parity) NOT applicable — the helper has no observable output to snapshot. Row 2 (consumer-count) inverse-applicable but more brittle: the count must DECREASE here, not enforce ≤1. Row 4 (dep-graph) NOT applicable — no layer leak. Row 6 (synthetic load) NOT applicable — no perf concern.

**Recurrence**: hits=2 of `simplification:duplicate-utility-helper` across iters {iter-009, iter-011}. iter-009 had cycle_density=2 (Codex-mqyql.1 + .5). iter-011 brings cycle_density=3 (members.ts, followers.ts, checkout.ts) in this cycle alone. **Cumulative cycle_density=5 across 2 cycles** — same R12 endemic profile that drove R7 single-cycle 5-hit promotion. **Recommendation**: queue for **2-hit early R7 promotion** at next cycle prep (R14 candidate "cache-fanout helpers must live in `@codex/cache`, not as inline route helpers"). At minimum, escalate to standard R7 watch — one more cycle hit triggers 3-hit threshold.

### F2 — `simplification:duplicate-utility-helper` sub-stem (major)

**Sites** (both implement "fetch slug from DB by orgId, then `cache.invalidate(slug)`" wrapped in a try/catch "Non-critical — slug cache expires via TTL" swallow):

- `workers/content-api/src/routes/content.ts:78-91` — inside `bumpOrgContentVersion`
- `workers/organization-api/src/routes/members.ts:99-114` — `invalidateOrgSlugCache`

Both lift the EXACT shape:

```ts
const db = createDbClient(env);
const org = await db.query.organizations.findFirst({
  where: eq(schema.organizations.id, orgId),
  columns: { slug: true },
});
if (org?.slug) await cache.invalidate(org.slug);
```

…inside a `try { … } catch { /* Non-critical — slug cache expires via TTL */ }`.

Drift risk: a future change to slug-cache key shape (e.g. namespacing under `cache:org-slug:`), or a switch to `tier`/`stats`-keyed invalidation, would silently miss one of the two implementations. Both are on critical mutation paths (members & content) where slug-cache staleness affects public stats / creators visibility.

**Fix**: extract `invalidateOrgSlugCache({ db, cache, orgId, logger? })` to `@codex/cache`. Both workers consume it.

**Proof**: `workers/organization-api/src/__denoise_proofs__/iter-011/F2-dup-slug-resolve-invalidate.test.ts` — asserts the canonical `findFirst({ where: eq(...id), columns: { slug: true } })` shape appears 0 times across the two worker route files post-fix (helper owns the query).

**MCP gate**: static.

**Catalogue walk**: row 12 (clone-count assertion) chosen. Row 1 (parity) NOT applicable — fire-and-forget, no observable output. Row 4 (dep-graph) NOT applicable. Row 7 (contract test) considered — could mock VersionedCache and assert the orchestration, but proof is more direct as a static grep.

**Recurrence**: hits=2 of `simplification:duplicate-utility-helper` (same parent stem as F1). This sub-stem is structurally distinct (slug-resolve+invalidate, not user-library bump) but rolls up under the same family fingerprint.

### F3 — `simplification:dup-procedure-context-builder` (major)

**Sites** (all five lift the IDENTICAL `{DATABASE_URL, DATABASE_URL_LOCAL_PROXY, DB_METHOD}` triple off `c.env`):

- `workers/ecom-api/src/handlers/checkout.ts:132-136`
- `workers/ecom-api/src/handlers/connect-webhook.ts:28-32`
- `workers/ecom-api/src/handlers/connect-webhook.ts:70-75` (nested in account-activation pending-payouts branch)
- `workers/ecom-api/src/handlers/payment-webhook.ts:245-249`
- `workers/ecom-api/src/handlers/subscription-webhook.ts:170-174`

```ts
const { db, cleanup } = createPerRequestDbClient({
  DATABASE_URL: c.env.DATABASE_URL,
  DATABASE_URL_LOCAL_PROXY: c.env.DATABASE_URL_LOCAL_PROXY,
  DB_METHOD: c.env.DB_METHOD,
});
```

`procedure()` handlers don't have this boilerplate (service registry handles per-request DB lifecycle). Webhook handlers bypass `procedure()` for HMAC + raw-body verification, so they need their own DB lifecycle — but the shape is so uniform that one helper `createWebhookDbClient(c.env)` collapses 5 sites into one import. Drift risk: a future env-binding rename (e.g. `DB_METHOD` → `DB_DRIVER`) would silently miss any one of the five sites.

**Fix**: extract `createWebhookDbClient(env)` to `@codex/database` (or `workers/ecom-api/src/utils/`); replace all five sites with the helper call.

**Proof**: `workers/ecom-api/src/__denoise_proofs__/iter-011/F3-dup-per-request-db-client.test.ts` — clone-count assertion via static grep over the literal three-field call shape across `workers/ecom-api/src/handlers/`. Pre-fix: 5 offenders. Post-fix: 0.

**MCP gate**: static.

**Catalogue walk**: row 12 (clone-count assertion) chosen. Row 1 (parity) considered — could snapshot `db, cleanup` shape pre/post extraction, but row 12 captures the simplification more directly.

**Recurrence**: hits=2 of `simplification:dup-procedure-context-builder`. iter-009 F2 (Codex-mqyql.2) was the first hit — same fingerprint, different surface (procedure() context vs upload-shared.ts buildUploadBaseContext). iter-011 hit makes 2 cycles. **One more cycle hit triggers R7 standard 3-hit promotion.**

### F4 — `simplification:speculative-extension-point` (minor)

**Site**: `workers/admin-api/src/types.ts:14-19`

```ts
export interface AdminVariables extends Variables {
  /** Platform owner's organization ID, set by middleware */
  organizationId: string;
  /** Per-request database client for transaction support, set by withPerRequestDb middleware */
  perRequestDb?: DatabaseWs;
}
```

Reality: `withPerRequestDb` middleware does NOT exist anywhere in the repo. Grep returns hits only in this file's source + dist copies. Fallow flagged the entire `AdminVariables` interface as unused (line 14, type_name=null) — but the actionable signal is finer: the interface IS used (`AdminApiEnv.Variables: AdminVariables` consumed by `createWorker<AdminApiEnv>(...)`), and `organizationId` IS legitimately set by procedure's org-membership policy resolution. The phantom is `perRequestDb`.

**Why it stays here (not /fallow-audit)**: the deletion is field-level (one member + JSDoc + import), not file/export-level. Fallow's coarse "delete the type" suggestion is wrong; the simplification finding pinpoints the actual cleanup.

**Fix**: drop the `perRequestDb?: DatabaseWs` member, drop the JSDoc line, drop the now-unused `DatabaseWs` import.

**Proof**: `workers/admin-api/src/__denoise_proofs__/iter-011/F4-speculative-perRequestDb-binding.test.ts` — two assertions: source no longer matches `/perRequestDb/`, source no longer matches `/withPerRequestDb/`.

**MCP gate**: static.

**Catalogue walk**: row 12 (grep assertion) chosen. Row 5 ("delete is the fix") considered — but this is a partial-deletion (one field, not the whole interface), so /fallow-audit's coarse signal isn't the right home. Row 2 (consumer-count) considered — `perRequestDb` consumers count is 0 today, but the assertion shape is cleaner as a grep that the symbol is gone.

**Recurrence**: NEW fingerprint instance (the family `simplification:speculative-extension-point` is in ref 03 §4 row 4 but not previously filed). hits=1.

### F5 — `simplification:dup-r2-key-resolution` (minor)

**Sites** (both implement `key && cdnBase ? \`${cdnBase}/${key}\` : null`):

- `workers/content-api/src/routes/public.ts:28-48` — `resolveR2Urls()` handles `mediaItem.thumbnailKey` AND `mediaItem.hlsPreviewKey`, then nested-spreads them onto items.
- `workers/content-api/src/routes/media.ts:145-153` — inline (handles flat `item.thumbnailKey` only).

Both read `R2_PUBLIC_URL_BASE` from env. The nullable-key + nullable-base check is done **3 times** across the two files (thumbnail in media.ts, thumbnail + hlsPreview in public.ts). Per `feedback_logic_in_services.md`, this transformation belongs in the service layer (`@codex/content`), not the route handler. The strict rule "NEVER return raw R2 keys" makes future media keys (waveform, image variants, intro-video) candidates for the same inlining if no canonical helper exists.

**Tracking**: NEW fingerprint, hits=1, cycle_density=3 in this cycle (3 inlined sites). Track for recurrence — if a third call site appears (e.g. when intro-video URL is added in another route), rule-of-three is vindicated.

**Fix**: move URL composition into `@codex/content` `MediaItemService.list` / `ContentService.listPublic` so routes receive pre-resolved `thumbnailUrl`/`hlsPreviewUrl` fields.

**Proof**: `workers/content-api/src/__denoise_proofs__/iter-011/F5-dup-r2-key-resolution.test.ts` — clone-count assertion via static grep over `(thumbnailKey|hlsPreviewKey) && \w*[Bb]ase` shape. Pre-fix: 3 sites. Post-fix: 0 (service-layer owns URL composition).

**MCP gate**: static.

**Catalogue walk**: row 12 (clone-count assertion) chosen. Row 1 (parity) applicable post-fix — could snapshot pre/post output for a corpus of (thumbnailKey, cdnBase) pairs, but row 12 captures the simplification target more directly.

## Summary

| Metric | Value |
|---|---|
| Total findings | 5 |
| Blocker | 0 |
| Major | 3 |
| Minor | 2 |
| Testability-bugs | 0 |
| Testability-bug rate | 0% (within R8 budget) |
| Beads to file | 5 |
| Recurrence promotions queued | 0 (but 2 watches escalate — see Next-cycle prep) |
| Proof tests | 5 (in 4 worker proof dirs under `__denoise_proofs__/iter-011/`) |
| Fabrication check | 14/14 live; 0 new stale rows (2 doc-rot rows already filed iter-002) |

## Notes on recurrence ledger movement

| Fingerprint | Iter-010 hits | Iter-011 hits | New status |
|---|---|---|---|
| `simplification:duplicate-utility-helper` | 1 (cycle_density=2) | 2 (cycle_density=5) | **2 hits, cumulative cycle_density=7** — R12 endemic profile reached. Recommend 2-hit early R7 promotion (R14 candidate) at iter-012 prep. |
| `simplification:dup-procedure-context-builder` | 1 (cycle_density=1) | 2 (cycle_density=5) | **2 hits, cumulative cycle_density=6** — sibling endemic profile. One more cycle hit fires R7 standard 3-hit promotion. |
| `simplification:dup-paginated-list-shape` | 1 (cycle_density=6) | **0** (workers correctly delegate to services) | **2-hit early-promotion watch CLOSED for workers cell** — workers do not exhibit this anti-pattern; the inline `count()` query stays in service-layer code. iter-009 F3 watch carries forward to next packages cycle. |
| `simplification:speculative-extension-point` | (filed in ref but not as cycle bead) | 1 (cycle_density=1) | NEW first filing. Track for recurrence. |
| `simplification:dup-r2-key-resolution` | (NEW) | 1 (cycle_density=3) | NEW fingerprint. cycle_density=3 — single-cell low signal. Track for recurrence. |

## Skill patches applied

- (none) — no SKILL.md edits this cycle. R7 promotion watches updated in master.md "Next-cycle prep" instead.

## Next-cycle prep

- **R14 promotion candidate** (NEW): `simplification:duplicate-utility-helper` reaches cumulative cycle_density=7 across 2 cycles. Profile mirrors R12's endemic single-cycle 5-hit promotion. Recommend filing the proposed R14 as: **"Cache-fanout helpers (per-user library invalidation, slug-keyed cache invalidation, content-version bumps) MUST live in `@codex/cache` or `@codex/worker-utils`, not as inline route helpers. Verified by a grep guard over `workers/*/src/routes/**` asserting no `cache.invalidate(CacheType.COLLECTION_*)` literal appears outside the canonical helper sites."**
- **`simplification:dup-procedure-context-builder` watch**: hits=2 of 3 (R7 standard threshold). One more cycle hit (any future "context-builder boilerplate copied N times" finding) triggers promotion.
- **R12 effectiveness on workers cell**: NO new `performance:sequential-await-independent-queries` violations found in the 5 ecom-api webhook handlers despite their high mutation density. Sequential `await stripe.X(...)` followed by `await dbWriter(...)` is intentional (transaction ordering) and out of R12 scope per its carve-out. **R12 holding.**
- **R13 effectiveness on workers cell**: spot-check confirmed every `waitUntil(...)` site touched in the 31-file churn set has `.catch(...)` chained. organizations.ts:573 (`BRAND_KV.delete(brand:${oldSlug})`) is the only exception still open from iter-008 (Codex-ttavz.16) — already filed; not re-filed here.
- **Round 1 stop-criterion review**: 11 of 12 cells now cycled (only `simplification × apps/web` remains). After iter-012 the matrix completes Round 1.
- **Recurrence watches (carry-forward)**:
  - `types:as-unknown-as` + `types:as-cast-without-guard` at hits=2 each — out of phase scope this cycle.
  - `types:redundant-cast-after-narrow` (cycle_density=6 iter-006) — endemic-shape watch.
  - 5 new performance fingerprints from iter-010 (hot-path-shader-config-getcomputedstyle etc.) — track in next perf cycle.
  - `simplification:dup-paginated-list-shape` (iter-009 F3, cycle_density=6) — 2-hit early-promotion watch carries forward to next **packages** cycle (workers cell ruled out this iter, see "Notes on recurrence ledger movement").

## Hand-offs

- `workers/auth/src/email.ts` exports `sendPasswordChangedEmail` (line 99) and `sendWelcomeEmail` (line 117) — both flagged unused by fallow. **Routed to `/fallow-audit`** (deletion-only finding, no behaviour change).
- `workers/content-api/src/routes/public-cache.ts:30` — `PublicContentCacheQuery` exported but only consumed in same file; tests don't import it. **Routed to `/fallow-audit`** (action: drop the `export` keyword).

## Critical-rule compliance

- **R1**: every finding has a proof test under `workers/<worker>/src/__denoise_proofs__/iter-011/F<N>-<slug>.test.ts`. ✅
- **R2**: zero `denoise:testability-bug` filings. ✅ (no Catalogue walks for last-resort bar)
- **R3**: ONE cell — simplification × workers. ✅
- **R6**: MCP gate = STATIC for simplification × all (per §3 matrix). No MCP evidence required. ✅
- **R8**: testability-bug rate = 0% (within 15% budget). ✅
- **R12 / R13**: spot-checked across the churn set; no new violations introduced.
