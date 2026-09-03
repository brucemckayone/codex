# Iteration 028 — types × packages

- **Cell**: types × packages
- **Date**: 2026-04-26
- **Mode**: delta
- **Since**: `7345a106` (iter-016 / iter-024 baseline — captures all Round 3 churn through Tier 7)
- **Files churned**: 33 (`git log 7345a106..HEAD --name-only -- 'packages/*/src/**'`, excluding test/proof dirs)
- **Agent**: agents/audit-packages.md
- **Fallow JSON**: `/tmp/denoise-iter-028-fallow.json` (218 total issues)
- **Typecheck baseline**: `/tmp/denoise-iter-026-typecheck-baseline.log` (53/53 clean)
- **Strategic focus**: Round 3 R11 effectiveness audit (Tier 6.A + 3.A + 4.A landings)

## Fabrication check

- 12 anti-pattern rows cited in references/02-type-audit.md §7
- 10 anti-pattern rows cited in references/07-domain-packages.md §7
- All 22 verified live in codebase (helper symbols `scopedNotDeleted`,
  `withCreatorScope`, `extends BaseService`, `expectTypeOf` all exist; deep-import
  patterns and policy enforcement helpers all present)
- 0 stale rows
- Note: ref 02 §6c mentions a future `@codex/shared-types/test-helpers` module
  that doesn't exist; the reference flags this as forward-looking ("may need to
  be added"), so it's not a fabrication.

## R11 effectiveness verdict (Round 3)

**Mostly landed; two P0/P3 R11 sites still open.**

| Round 3 work | Status | Evidence |
|---|---|---|
| Tier 6.A — Database 5-package reconciliation (lqvw4.2) | ✅ CLOSED, landed clean | `DatabaseClient = Database \| DatabaseWs` canonical at `@codex/database/src/client.ts`; 4 service packages re-alias their local `Database` to canonical; `@codex/content/src/types.ts:22` and `@codex/notifications/src/types.ts` confirmed |
| Tier 4.B — RevenueSplit canonical (lqvw4.3) | ✅ CLOSED | Single declaration at `packages/shared-types/src/financial.ts:19`; consumed by `@codex/purchase` + `@codex/subscription` via type-only re-exports |
| Tier 3.A — Logger / WaitUntilFn / InvalidationLogger (lqvw4.7, lqvw4.8) | ✅ CLOSED | `Logger` single-canonical at `packages/observability/src/index.ts:30`; `WaitUntilFn` single-canonical at `packages/cache/src/helpers/invalidate.ts:35`; `InvalidationLogger = Logger` alias re-exported through `@codex/cache` for back-compat |
| Tier 4.A — orgmanagement type widen (lqvw4.11, P0) | ✅ CLOSED | `procedure/types.ts:232-238` widens `organizationId` to `string` for `requireOrgMembership: true`, `requireOrgManagement: true`, AND `auth: 'platform_owner'`. Grep `ctx.organizationId.*as string` returns ZERO hits in `workers/` |
| **Codex-lqvw4.1 SessionData/UserData (P0 BLOCKER)** | ❌ STILL OPEN | `interface SessionData` declared in BOTH `@codex/security/src/session-auth.ts:15` (8 fields, `token` required) AND `@codex/shared-types/src/worker-types.ts:370` (4 fields + `[key: string]: unknown`, `token` optional). Same for `UserData`. iter-004 proof at `F4-sessiondata-userdata-duplicate.test.ts` remains RED. |
| **Codex-lqvw4.4 InvalidationLogger duplicate (P3)** | ⚠ OPEN but landed in spirit | Tier 3.A consolidated InvalidationLogger to `@codex/observability` and re-exports through `@codex/cache`. Bead can likely be closed with link to Tier 3.A commit `7440fe95`. |
| **Codex-lqvw4.5 OrganizationMembership collision (P3)** | ❌ STILL OPEN + extended this cycle | `OrganizationMembership` declared in 3 sites (database row $inferSelect + worker-utils helpers.ts:173 named export + shared-types worker-types.ts:352 inline shape on Variables). See F1 below. |
| **Codex-lqvw4.6 TemplateScope/Status/EmailCategory triple-source (P3)** | ❌ STILL OPEN | `TemplateScope`, `TemplateStatus`, `EmailCategory` still declared in 3+ packages (database schema + validation z.infer + notifications types literal union) |

**Verdict**: Round 3 closed the high-value R11 violations (Database, RevenueSplit, Logger family, orgmanagement BLOCKER). Three R11 sites remain open — one P0 (lqvw4.1) and two P3 (lqvw4.5, lqvw4.6). lqvw4.1 should be the next R11 priority because it's a P0 silent-runtime-undefined risk.

## Findings

### F1 — types:type-duplicate-cross-package (OrganizationMembership 3-site)

- **Severity**: minor
- **File:Line**: `packages/shared-types/src/worker-types.ts:352` (inline shape) +
  `packages/worker-utils/src/procedure/helpers.ts:173` (named interface) +
  `packages/database/src/schema/content.ts:412` (Drizzle row $inferSelect)
- **Description**: `OrganizationMembership` (or its 3-field projection `{ role, status, joinedAt }`) is declared in three places. The `Variables.organizationMembership` field on `@codex/shared-types` uses an INLINE shape that byte-equals the named export from `@codex/worker-utils/procedure/helpers.ts` — exactly the kind of inline structural shape R11 forbids. Codex-lqvw4.5 already filed the worker-utils ↔ database collision; this iter-028 finding extends the bead with the third inline-shape site.
- **Proof test form**: type-equality test (Catalogue row 3)
- **Proof test path**: `packages/worker-utils/src/__denoise_proofs__/iter-028/F1-organizationmembership-three-site-duplicate.test.ts`
- **MCP evidence**: `mcp__ide__getDiagnostics` (typecheck clean — proof passes structurally today; the bug is the duplication, not assignability)
- **Recurrence**: hit 4 of `types:type-duplicate-cross-package` (already R11-promoted; this is R11 violation drift)
- **Bead**: extends Codex-lqvw4.5 (re-open / append finding, do not double-file)

### F2 — types:type-duplicate-cross-package (ObsWarnSink inline Logger projection)

- **Severity**: minor
- **File:Line**: `packages/image-processing/src/utils/upload-pipeline.ts:35`
- **Description**: `interface ObsWarnSink { warn(message, context?): void }` is an inline structural projection of `Pick<Logger, 'warn'>` from `@codex/observability`. Tier 5.A's commit message justified the duplication ("avoid pulling @codex/observability into image-processing's deps") but `@codex/observability` is already a transitive dep via BaseService. R11 forbids inline structural shapes that exist as canonical exports.
- **Proof test form**: type-equality test (Catalogue row 3)
- **Proof test path**: `packages/image-processing/src/__denoise_proofs__/iter-028/F2-obswarnsink-inline-logger-projection.test.ts`
- **MCP evidence**: `mcp__ide__getDiagnostics` (typecheck clean)
- **Recurrence**: hit 5 of `types:type-duplicate-cross-package` (R11 promoted; drift exposure)
- **Bead**: NEW under Codex-lqvw4
- **Suggested fix**: replace `interface ObsWarnSink` with `import type { Logger } from '@codex/observability'`; type the parameter as `Pick<Logger, 'warn'>` (or just `Logger`).

### F3 — types:type-duplicate-cross-package (ObservabilityClient name collision)

- **Severity**: minor
- **File:Line**: `packages/security/src/kv-secondary-storage.ts:50`
- **Description**: `export interface ObservabilityClient { warn(message, context?): void }` declares an interface using the SAME NAME as the runtime class `ObservabilityClient` from `@codex/observability` (which the file also imports, aliased as `ObsClientImpl` on line 45 to avoid collision). The local interface is a 1-method projection; the canonical class has many more methods. Two different declarations under one name is the R11 anti-pattern Tier 3.A consolidated for `Logger` — this site was missed because the inline name shadows the runtime CLASS, not the `Logger` type.
- **Proof test form**: type-equality test (Catalogue row 3)
- **Proof test path**: `packages/security/src/__denoise_proofs__/iter-028/F3-observabilityclient-name-collision.test.ts`
- **MCP evidence**: `mcp__ide__getDiagnostics` (typecheck clean)
- **Recurrence**: hit 6 of `types:type-duplicate-cross-package` (R11 promoted)
- **Bead**: NEW under Codex-lqvw4
- **Suggested fix**: drop the local interface; type `fallbackObs: Logger` (or `Pick<Logger, 'warn'>`) from `@codex/observability`. Alternative: rename to `KvStorageObsSink` to remove the name collision. Fallow already flags this interface as unused.

### F4 — types:literal-union-drift-vs-runtime-presets (NEW fingerprint)

- **Severity**: minor
- **File:Line**: `packages/worker-utils/src/procedure/types.ts:190`
- **Description**: `ProcedurePolicy.rateLimit?: 'api' | 'auth' | 'strict' | 'public' | 'webhook' | 'streaming'` drifts from `RATE_LIMIT_PRESETS` keys exposed by `@codex/security/src/rate-limit.ts:256` which are `'api' | 'auth' | 'strict' | 'streaming' | 'webhook' | 'web'`. The procedure type allows `'public'` (no preset entry) and disallows `'web'` (the actual preset key). `middleware-chain.ts:61` already does the right thing (`keyof typeof RATE_LIMIT_PRESETS`); the procedure surface should match.
- **Proof test form**: type-equality test (Catalogue row 3)
- **Proof test path**: `packages/worker-utils/src/__denoise_proofs__/iter-028/F4-procedure-rateLimit-literal-drift.test.ts`
- **MCP evidence**: `mcp__ide__getDiagnostics` (typecheck clean — proof FAILS today, PASSES post-fix)
- **Recurrence**: hit 1 of NEW fingerprint `types:literal-union-drift-vs-runtime-presets`
- **Bead**: NEW under Codex-lqvw4
- **Suggested fix**: replace the hand-written union with `keyof typeof RATE_LIMIT_PRESETS` imported from `@codex/security`. No runtime impact today (procedure() doesn't currently apply policy.rateLimit — that's via middleware-chain), but the type-system contract should match.

### F5 — types:as-cast-without-guard (DatabaseTransaction cast post-Tier-6.A)

- **Severity**: minor
- **File:Line**: `packages/content/src/services/content-service.ts:158`
- **Description**: Inside `await this.db.transaction(async (tx) => { ... })`, the call `validateMediaItem(tx as DatabaseTransaction, ...)` casts `tx` to `DatabaseTransaction`. `DatabaseTransaction` (defined at `types.ts:28`) is HTTP-only-derived (`Parameters<Parameters<typeof dbHttp.transaction>[0]>[0]`). After Tier 6.A widened the parent `Database` type to `DatabaseClient = Database | DatabaseWs`, the runtime `tx` can be HTTP or WS transaction — but the cast claims HTTP unconditionally. Today the call surface stays in the HTTP|WS overlap so nothing breaks; the bug is the type-system bypass that hides future drift. R11 root cause: `DatabaseTransaction` did not widen alongside `Database`.
- **Proof test form**: type-equality / structural narrowing test (Catalogue row 3)
- **Proof test path**: `packages/content/src/__denoise_proofs__/iter-028/F5-databasetransaction-cast-after-tier6a.test.ts`
- **MCP evidence**: `mcp__ide__getDiagnostics` (typecheck clean)
- **Recurrence**: **hit 3 of `types:as-cast-without-guard`** (after iter-005, iter-006). Reaches R7 standard 3-hit promotion threshold in trailing 6 cycles → flag for promotion to R-rule in iter-029.
- **Bead**: NEW under Codex-lqvw4
- **Suggested fix**: widen `DatabaseTransaction` to `Parameters<Parameters<typeof dbHttp.transaction>[0]>[0] | Parameters<Parameters<typeof dbWs.transaction>[0]>[0]` (or derive from `DatabaseClient`); drop the `as DatabaseTransaction` cast at line 158.

### F6 — types:type-duplicate-cross-package (recurrence pointer — SessionData/UserData STILL RED)

- **Severity**: blocker (inherited from Codex-lqvw4.1 P0)
- **File:Line**: `packages/security/src/session-auth.ts:15,29` + `packages/shared-types/src/worker-types.ts:370,408`
- **Description**: Codex-lqvw4.1 (P0 BLOCKER) remains OPEN. SessionData/UserData are declared in both packages with structurally divergent shapes. Tier 6.A's Database reconciliation did NOT extend to SessionData/UserData. iter-004 proof at `packages/security/src/__denoise_proofs__/iter-004/F4-sessiondata-userdata-duplicate.test.ts` is still red.
- **Proof test form**: type-equality test (Catalogue row 3) — original at iter-004/F4
- **Proof test path**: `packages/security/src/__denoise_proofs__/iter-028/F6-sessiondata-userdata-still-red.test.ts` (traceability marker only; the active proof remains at iter-004/F4)
- **MCP evidence**: same as iter-004
- **Recurrence**: hit 7 of `types:type-duplicate-cross-package` (already R11-promoted — this is post-promotion drift). Bead lqvw4.1 unchanged.
- **Bead**: existing Codex-lqvw4.1 (no new bead; recurrence ledger increment only)

## Summary

| Metric | Value |
|---|---|
| Total findings | 6 |
| Blocker | 1 (F6 — recurrence; existing bead Codex-lqvw4.1) |
| Major | 0 |
| Minor | 5 |
| Testability-bugs | 0 |
| Testability-bug rate | 0% (R8 does NOT fire) |
| Beads to file (NEW) | 3 (F2, F3, F4 — F5 may file as recurrence-extension under lqvw4.x) |
| Beads to extend | 1 (F1 → Codex-lqvw4.5) |
| Beads to leave (recurrence pointer only) | 1 (F6 → Codex-lqvw4.1) |
| Recurrence promotions queued | 1 (`types:as-cast-without-guard` reaches hit 3 → R7 promotion) |

**Recurrence ledger updates**:
- `types:type-duplicate-cross-package`: hits 3→7 (already R11-promoted; tracking continued post-promotion drift across F1, F2, F3, F6)
- `types:as-cast-without-guard`: hits 2→3 (REACHES R7 threshold; queued for promotion in iter-029)
- `types:literal-union-drift-vs-runtime-presets`: NEW, hits 1 (first sighting)

## Skill patches applied

(none — no edits to SKILL.md, references, or agent briefs this cycle)

## Next-cycle prep

- **Promote `types:as-cast-without-guard` to R-rule** (R7 threshold reached: hit 3 in trailing 6 cycles, iter-005/iter-006/iter-028). Suggested rule text: "Type assertions of the form `value as Foo` where Foo is more specific than the source type MUST be guarded by a runtime check (Zod schema, type guard, or instanceof) — except for Drizzle infinite-recursion bridges, framework defaults like `{} as TPolicy`, and Proxy-target placeholders. Verified by a grep + manual review per cycle." The exception list is non-trivial — recommend drafting the rule first, then human-reviewing before adding to §1.
- **Re-open Codex-lqvw4.1 priority**: it is the highest-value R11 site remaining (P0, blocks ctx.user typing across all workers). Tier 6.A's Database pattern (additive canonical union) won't work here — SessionData/UserData need either (a) the security types renamed (SessionAuthRow/UserAuthRow) and projected to canonical at the `c.set('user', ...)` boundary, or (b) the security types deleted in favour of the shared-types ones (with widening / index-signature compatibility). Recommend (a).
- **Codex-lqvw4.4 review**: bead is open but Tier 3.A appears to have addressed it (Logger consolidated, InvalidationLogger as alias re-exported through @codex/cache). Either close the bead or document why it's still open.
- **DatabaseTransaction widening (F5)**: companion fix to Tier 6.A. The Database widening landed cleanly but its dependent type `DatabaseTransaction` was not similarly widened. Same package (`@codex/content/src/types.ts`).
- **Cell rotation note**: types × packages had hits 7→7 cumulative for the R11 fingerprint after this cycle. Three consecutive zero-finding cycles needed for fidelity (§7 stop criterion). Recommend keeping this cell on standard cadence until lqvw4.1 lands; after that, a focused re-audit of just the SessionData/UserData closure verifies the R11 work has reached fidelity.
