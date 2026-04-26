# Iteration 005 — types × workers

- **Cell**: types × workers
- **Date**: 2026-04-25
- **Mode**: delta
- **Since**: 14 days ago (`git log --since='14 days ago'`)
- **Files churned**: 31 (in-scope, non-test, in `workers/*/src/**`)
- **Agent**: agents/audit-workers.md (types branch)
- **Fallow JSON**: `/tmp/denoise-iter-005-fallow.json` (inherited from iter-001)
- **Typecheck baseline**: `/tmp/denoise-iter-005-typecheck-baseline.log` (inherited; pre-existing 3 baseline TS errors in `@codex/worker-utils` per iter-004 + 2 stale errors in `workers/ecom-api/src/__denoise_proofs__/iter-002/F3-...test.ts` — NOT caused by this cycle, present at HEAD `7f052f9c`)

## Fabrication check

Cycle-0 protocol per ref 08 §5: grep every cited symbol from references 02 + 06
against current code. Iter-002 already filed doc-rot beads (Codex-ttavz.10,
Codex-ttavz.11) against ref 06 rows 9 and 11; those remain valid — not re-filed.

| Symbol cited | Where | Hits | Status |
|---|---|---|---|
| `expectTypeOf` (vitest) | ref 02 §6a | usable in `__denoise_proofs__/` | live |
| `@codex/shared-types` | ref 02 §2, §4 | 29 imports across workers/*/src | live |
| `import type {...} from '@codex/shared-types'` (no-runtime-import rule) | ref 02 §4 | All worker imports use `import type` | live, contract upheld |
| `procedure(` | ref 06 §1 row 1 | 28 files | live |
| `new XxxService(` exception (webhook handlers) | ref 06 §2, §7 | 5 sites in `workers/ecom-api/src/handlers/*` (documented exception) | live, exception holds |
| `ctx.waitUntil(...)` | ref 06 §3 | 24+ sites | live |
| `workerAuth` / `workerAuth.sign` | ref 06 §1 / cross-link 01 | live in `media-api/src/index.ts:34` | live |
| `stripe.webhooks.constructEvent` (ref 06 row 11) | ref 06 §9 row 11 | code uses `constructEventAsync` | **stale (already-tracked: Codex-ttavz.10)** |
| `ctx.storage.transaction` / `alarmInFlight` (ref 06 row 9) | ref 06 §4, §9 row 9 | DO file moved to `durable-objects/orphaned-file-cleanup-do.ts` | **stale (already-tracked: Codex-ttavz.11)** |
| `Hono<HonoEnv>()` pattern | ref 06 §1 | 22 hits across route files | live |
| `Bindings` shape (ref 02 §1 §3) | ref 02 §1, §3 | `Bindings` exported from `@codex/shared-types`, 29 imports | live |

**Result**: every NEW citation in this cycle's scope is live. The two
already-known stale rows (Codex-ttavz.10, Codex-ttavz.11) remain open from
iter-002. **No new doc-rot beads filed in iter-005.**

## Skill patches applied (iter-005 prep)

Per master.md "endemic-pattern watch" set after iter-004: the
`types:type-duplicate-cross-package` fingerprint sits at hits=1 with
cycle_density=6. The recommendation was: "if iter-005 (any scope) surfaces
another instance, consider promoting on 2nd hit." This cycle surfaces
**TWO MORE INSTANCES** (F2 Logger interface, F3 inlined WaitUntilFn) —
**this is the 2-hit early-promotion trigger**. See "Next-cycle prep" below.

No `workers:waituntil-no-catch` 3rd instance found this cycle (the cron
`runRecoverStuckTranscoding` at `media-api/src/index.ts:242` is wrapped in
a self-handling try/catch — error-contained, no loose `.catch()` needed
on the wrapper).

## Findings

### F1 — `types:type-narrowing-incomplete-orgmanagement` **[BLOCKER]**

- **Severity**: BLOCKER (silent type-safety hole; 6 production casts depend
  on a runtime invariant that the type system doesn't see)
- **File:Line**:
  - `packages/worker-utils/src/procedure/types.ts:230-234` (incomplete narrow)
  - `workers/organization-api/src/routes/tiers.ts:77` `as string`
  - `workers/organization-api/src/routes/tiers.ts:128` `as string`
  - `workers/organization-api/src/routes/tiers.ts:158` `as string`
  - `workers/organization-api/src/routes/tiers.ts:182` `as string`
  - `workers/ecom-api/src/routes/subscriptions.ts:311` `as string`
  - `workers/ecom-api/src/routes/subscriptions.ts:328` `as string`
- **Description**: The `procedure()` factory's runtime helper
  `enforcePolicy` (in `packages/worker-utils/src/procedure/helpers.ts:476-490`)
  treats `requireOrgMembership` and `requireOrgManagement` IDENTICALLY
  for the purpose of resolving `organizationId`. Both gate `needsOrg`,
  which then asserts `organizationId` is non-null before continuing —
  so at runtime, a route declared with `requireOrgManagement: true`
  is GUARANTEED to have a string `ctx.organizationId`.

  But the type-level narrow at `types.ts:230` only checks
  `TPolicy['requireOrgMembership'] extends true`. So routes with
  `requireOrgManagement: true` (and no `requireOrgMembership`) see
  `ctx.organizationId: string | undefined` and have to cast via
  `ctx.organizationId as string`. That's 6 known sites today — every
  cast is a TS escape hatch covering an invariant that's true at
  runtime but invisible at the type level.

  **Real risk**: if any of those 6 routes are ever mistakenly
  declared with neither flag (e.g. a copy-paste error keeps the cast
  but drops `requireOrgManagement`), the cast silently assumes a
  defined `organizationId` at runtime when it could be `undefined`.
  The TS compiler would not catch the bug — `as string` is a blind
  narrow.

  **Fix**: change `types.ts:230` to also check `requireOrgManagement`:

  ```typescript
  organizationId: TPolicy['requireOrgMembership'] extends true
    ? string
    : TPolicy['requireOrgManagement'] extends true
      ? string
      : TPolicy['auth'] extends 'platform_owner'
        ? string
        : string | undefined;
  ```

  All 6 `as string` casts become unnecessary and should be removed
  in the same PR.

- **Proof test form**: type-equality test (Catalogue row 3) +
  runtime invariant test
- **Proof test path**:
  `workers/organization-api/src/__denoise_proofs__/iter-005/F1-orgmanagement-not-narrowed.test.ts`
- **MCP evidence**: `mcp__ide__getDiagnostics` (per §3 matrix for
  `types × workers`) — captures TS2322 / TS2345 when the casts are
  removed BEFORE the type narrow widens, then captures clean diagnostics
  AFTER the narrow widens.
- **Recurrence (R7)**: NEW fingerprint
  `types:type-narrowing-incomplete-orgmanagement`. Single-hit, but the
  blast radius (6 casts in production code, all silently bypassing the
  type system) makes it BLOCKER severity.
- **Bead**: _filed at step 7 by dispatching skill_

### F2 — `types:type-duplicate-cross-package` (Logger interface in workers)

- **Severity**: major (recurrence — same fingerprint as iter-004 F1-F6)
- **File:Line**:
  - `workers/content-api/src/routes/content.ts:54`
  - `workers/organization-api/src/routes/settings.ts:48`
- **Description**: Two worker route files declare a near-identical
  inline `Logger` interface:

  ```typescript
  // content.ts:54
  interface Logger {
    warn(message: string, metadata?: Record<string, unknown>): void;
  }
  // settings.ts:48
  interface Logger {
    warn(message: string, metadata?: Record<string, unknown>): void;
    error(message: string, metadata?: Record<string, unknown>): void;
  }
  ```

  Both shapes match the comment "matches the subset of
  `ObservabilityClient` the helper uses" — they are duplicating the
  structural-typing trick that `@codex/content` already exports as
  `InvalidationLogger` (iter-004 F3, Codex-lqvw4.3) and
  `@codex/subscription` re-exports under the same name. The pattern
  is now spreading from package-foundation code into worker-side
  route helpers.

  This is the **2nd hit** of `types:type-duplicate-cross-package`
  (iter-004 was hit #1 with cycle_density=6). Per the master.md
  endemic-pattern watch, this triggers **2-hit early promotion**.

  **Fix**:
  - Promote `InvalidationLogger` to `@codex/observability` (the
    canonical owner of `ObservabilityClient`) — it's a structural
    subset of that interface
  - Both worker route files import it from there
  - The package-side declarations in `@codex/content` and
    `@codex/subscription` (already covered by iter-004 F3) collapse
    to that import too — same PR
- **Proof test form**: type-equality test (Catalogue row 3) + grep guard
- **Proof test path**:
  `workers/content-api/src/__denoise_proofs__/iter-005/F2-logger-interface-duplicate.test.ts`
- **MCP evidence**: `mcp__ide__getDiagnostics`
- **Recurrence (R7)**: increment of `types:type-duplicate-cross-package`
  → hit #2.
- **Bead**: _filed at step 7 by dispatching skill_

### F3 — `types:type-duplicate-cross-package` (inlined `WaitUntilFn` shape)

- **Severity**: major (same fingerprint as F2 — cycle_density adds up)
- **File:Line**:
  - `workers/ecom-api/src/routes/subscriptions.ts:66`
  - `workers/organization-api/src/routes/tiers.ts:34`
  - `workers/organization-api/src/routes/settings.ts:186`
  - `workers/organization-api/src/routes/members.ts:38, 91`
- **Description**: 5 worker route files inline the same
  `executionCtx: { waitUntil(p: Promise<unknown>): void }` shape (4 use
  param name `p`, settings.ts:186 uses `promise` — cosmetically
  divergent, structurally identical) instead of importing the canonical
  `WaitUntilFn` already exported by `@codex/content` and
  `@codex/subscription`.

  This is the SAME fingerprint as iter-004 F3 (which covered the
  package-side duplication of `WaitUntilFn` between `@codex/content`
  and `@codex/subscription`) AND the same fingerprint as F2 above
  (Logger interface). Cycle-density for `types:type-duplicate-cross-package`
  in iter-005 = **2 separate type families**, **7 distinct call sites**.

  **Fix** (after iter-004 F3's consolidation lands at `@codex/cache`
  or wherever it consolidates): each worker route file imports
  `WaitUntilFn` from the canonical site and types its
  `executionCtx` arg as `{ waitUntil: WaitUntilFn }`.
  Alternatively, since the helper is always called inside a procedure
  handler, use `Pick<ProcedureContext, 'executionCtx'>` to pick up
  the canonical shape from the procedure context types.
- **Proof test form**: type-equality test (Catalogue row 3) + grep guard
- **Proof test path**:
  `workers/organization-api/src/__denoise_proofs__/iter-005/F3-waituntilfn-inlined-duplicate.test.ts`
- **MCP evidence**: `mcp__ide__getDiagnostics`
- **Recurrence (R7)**: increment of `types:type-duplicate-cross-package`
  (cycle-internal +1 of +2 in this iteration; fingerprint hit #2 overall).
- **Bead**: _filed at step 7 by dispatching skill_

### F4 — `types:as-cast-without-guard` (CacheCtx narrow→cast)

- **Severity**: major (silent type-safety hole + 4 hand-written casts in
  one file)
- **File:Line**:
  - `workers/organization-api/src/routes/members.ts:36-39` (declares
    local `CacheCtx` with `env: { CACHE_KV?: unknown }`)
  - `workers/organization-api/src/routes/members.ts:55-56` (re-cast)
  - `workers/organization-api/src/routes/members.ts:78` (re-cast)
  - `workers/organization-api/src/routes/members.ts:96` (re-cast)
  - `workers/organization-api/src/routes/members.ts:101-103`
    (`as Parameters<typeof createDbClient>[0]` — separate but related
    cast)
- **Description**: The local helper-input type `CacheCtx` narrows the
  binding type to a structural subset typed as `unknown`:

  ```typescript
  interface CacheCtx {
    env: { CACHE_KV?: unknown };
    executionCtx: { waitUntil(p: Promise<unknown>): void };
  }
  ```

  Then every consumer re-casts the binding to acquire the type back:

  ```typescript
  const kv = ctx.env.CACHE_KV as
    import('@cloudflare/workers-types').KVNamespace;
  ```

  That's `types:as-cast-without-guard` per ref 02 §3 row 8 — the cast
  happens after a runtime null check, so the value is non-null, but
  the TYPE was never `KVNamespace | undefined` to begin with — it
  was `unknown`. The cast asserts a stronger type than the declared
  one. The canonical `Bindings.CACHE_KV` shape is already
  `KVNamespace | undefined` (see
  `packages/shared-types/src/worker-types.ts:71-75`); using
  `Pick<Bindings, 'CACHE_KV'>` for the helper input would propagate
  the correct type and eliminate the cast.

  **Concrete risk**: the inline `CACHE_KV?: unknown` is a footgun.
  If a future contributor changes the cache binding to a non-
  `KVNamespace` shape (e.g., a Durable Object reference), the
  runtime cast still compiles and silently invokes wrong methods.

  **Fix**: replace `interface CacheCtx { env: { CACHE_KV?: unknown };
  executionCtx: ... }` with a `Pick<Bindings, 'CACHE_KV' |
  'DATABASE_URL' | 'ENVIRONMENT'>`-based shape; drop the 3
  `as KVNamespace` casts; drop the `as Parameters<typeof
  createDbClient>[0]` at line 102 by widening the env shape.
- **Proof test form**: type-equality test (Catalogue row 3) + grep guard
- **Proof test path**:
  `workers/organization-api/src/__denoise_proofs__/iter-005/F4-cachectx-narrow-then-cast.test.ts`
- **MCP evidence**: `mcp__ide__getDiagnostics`
- **Recurrence (R7)**: NEW fingerprint
  `types:as-cast-without-guard` (workers-side; ref 02 §7 row 8 already
  defines the fingerprint, this is the first cycle filing it).
- **Bead**: _filed at step 7 by dispatching skill_

### F5 — `types:as-unknown-as` (worker entry-point bindings)

- **Severity**: minor (pattern crosses from "deferred" status to "real
  finding" because instances now hit production worker entry-points,
  not just test/multipart helpers)
- **File:Line**:
  - `workers/auth/src/index.ts:135` (`c.env as unknown as AuthBindings`)
  - `workers/media-api/src/index.ts:129`
    (`c.env as unknown as { ORPHAN_CLEANUP_DO: DurableObjectNamespace }`)
- **Description**: `as unknown as` is the canonical "I'm bypassing
  TypeScript" double-cast (ref 02 §7 row 10). Two new production
  instances — both same root cause: workers with bindings beyond the
  shared shape don't declare a typed env via `createWorker<TEnv>`.

  1. **auth worker** — `app` is created via `createWorker({ ... })`
     with no explicit generic; the auth worker's `AuthBindings`
     (which extends shared `Bindings`) is narrower than the default
     `HonoEnv`. The fix is to instantiate as
     `createWorker<AuthEnv>({ ... })` — the admin-api worker already
     uses this pattern (see
     `workers/admin-api/src/index.ts:58: createWorker<AdminApiEnv>({...})`)
     so auth worker should mirror it.

  2. **media-api worker** — uses
     `c.env as unknown as { ORPHAN_CLEANUP_DO: DurableObjectNamespace }`.
     `ORPHAN_CLEANUP_DO` is a worker-specific binding not declared in
     shared `Bindings`. The fix is to declare a `MediaBindings extends
     SharedBindings` type (mirroring `AuthBindings`/`AdminVariables`)
     and instantiate `createWorker<MediaEnv>({ ... })`.

  iter-004 deferred this fingerprint because the only sites were
  `packages/test-utils/src/stripe-mock.ts:165` and
  `packages/worker-utils/src/procedure/multipart-procedure.ts:279`
  — both pragmatic framework-interop exceptions. These two
  worker-side instances are NOT pragmatic — they're a missing
  generic instantiation. So they cross the threshold from
  "track for 3rd instance" to a real finding.

  **Fix**:
  - `workers/auth/src/index.ts`: change `createWorker({ ... })` to
    `createWorker<AuthEnv>({ ... })` and drop the cast at line 135
  - `workers/media-api/src/index.ts`: declare
    `type MediaBindings = Bindings & { ORPHAN_CLEANUP_DO?:
    DurableObjectNamespace }`, change `createWorker(...)` to
    `createWorker<MediaEnv>(...)`, drop cast at line 129
- **Proof test form**: type-equality test (Catalogue row 3) + grep guard
- **Proof test path**:
  `workers/auth/src/__denoise_proofs__/iter-005/F5-as-unknown-as-cast.test.ts`
- **MCP evidence**: `mcp__ide__getDiagnostics`
- **Recurrence (R7)**: increment of `types:as-unknown-as` — hit count
  reaches 4 if you count iter-004's 2 deferred-but-noted instances
  (stripe-mock, multipart-procedure) as part of the trail. Worker-
  side standalone count is 2 — this cycle's hit. Per the existing
  ref 02 §7 row 10 fingerprint, log at hits=1 (this is the first
  cycle filing it as a finding).
- **Bead**: _filed at step 7 by dispatching skill_

## Findings deferred (noted, not filed this cycle)

These were investigated and found, but DO NOT meet the bar for filing
in this cycle. Logged here so the next cycle can pick them up if they
recur or warrant their own pass.

- **`workers:webhook-no-route-procedure-doc-rot`** — `notifications-api/CLAUDE.md`
  references a `preferences.ts` route file that no longer exists. The
  file was deleted in commit `e53978a5` (chore(audit): fallow-driven
  cleanup). The CLAUDE.md still says: "the preferences.ts route file
  exists but is not currently mounted in index.ts". This is local
  CLAUDE.md drift, not a denoise-reference doc-rot — out of scope for
  the iter-005 fabrication check (which targets refs 02 + 06).
  Suggest routing to a `/codebase-audit` follow-up or a docs cleanup
  task.

- **`workers:env-binding-error-swallowed`** — `notifications-api/src/routes/unsubscribe.ts:83-91`
  catches a DB exception with `} catch {`-style swallowed error. No
  observability log. Different fingerprint (security/observability,
  not types). Note for security × workers next pass.

- **`types:zod-result-not-checked` carry-over** — none new in workers
  source (worker routes use `procedure({ input: schema })` which calls
  `safeParse` internally). Iter-004 deferred this for service-layer
  files; the workers cycle doesn't surface it.

## Summary

| Metric | Value |
|---|---|
| Total findings | 5 |
| Blocker | 1 (F1 orgManagement type-narrow incomplete) |
| Major | 3 (F2 Logger duplicate, F3 WaitUntilFn inlined ×5, F4 CacheCtx narrow→cast) |
| Minor | 1 (F5 as-unknown-as ×2) |
| Testability-bugs | 0 |
| Testability-bug rate | 0% (R8 does NOT fire) |
| Beads filed | _0 — pending step 7 of dispatching skill_ |
| Recurrence promotions queued | 1 (`types:type-duplicate-cross-package` 2-hit early promotion — see Next-cycle prep) |
| Proof tests written | 5 |

R2 catalogue walk: NOT triggered — every finding mapped to a Catalogue
row directly.

| # | Finding | Catalogue row |
|---|---|---|
| F1 | requireOrgManagement type narrow incomplete | Row 3 — type-equality test |
| F2 | Logger interface duplicated in 2 worker route files | Row 3 — type-equality test (+ grep guard) |
| F3 | inlined `WaitUntilFn` at 5 worker call sites | Row 3 — type-equality test (+ grep guard) |
| F4 | CacheCtx env narrow→cast pattern | Row 3 — type-equality test (+ grep guard) |
| F5 | `as unknown as` casts in worker entry-points | Row 3 — type-equality test (+ grep guard) |

R8 does not fire (rate < 15%).

R7 promotions: F2 + F3 share the SAME fingerprint
`types:type-duplicate-cross-package`. Cycle-internal hits = 2 (F2, F3).
Per recurrence-protocol §2, this is **+1 hit in iter-005** (one finding
per cycle is the normalised count), bringing the fingerprint to **hits=2
overall**. Per the master.md endemic-pattern watch (set after iter-004's
cycle_density=6 in a single cell), this **triggers 2-hit early
promotion** — the next cycle's prep should add a hard rule to SKILL.md
§1.

**Cycle-density annotation for iter-005**: 2 separate type families
(Logger + WaitUntilFn), 7 distinct call sites. Recurrence ledger should
record `cycle_density: { iter-004: 6, iter-005: 2 }`.

## MCP evidence summary

Per §3 matrix, `types × workers` required MCP is
`mcp__ide__getDiagnostics`. This audit produced 5 static findings
backed by Vitest `expectTypeOf` proof tests.

The dispatching skill at step 6 will:

1. Open each proof test file
2. Capture the `mcp__ide__getDiagnostics` output for the proof file's
   URI BEFORE removing `.skip()` (clean — TS doesn't diagnose inside
   `it.skip` / `describe.skip`)
3. Remove `.skip()` AND uncomment the `expectTypeOf` lines in a
   scratch branch — capture diagnostics AGAIN as the "red on main"
   snapshot the bead body needs.
4. Attach the diagnostic output as evidence to each bead.

For F1 in particular, runtime verification is also recommended: a
test that calls `procedure({ policy: { requireOrgManagement: true }
... })` and asserts `ctx.organizationId` is `string` (not
`string | undefined`) — already covered by existing
`packages/worker-utils/src/procedure/__tests__/enforce-policy-inline.test.ts`
on the runtime side; the type-level half is what this proof tests.

This audit ran fabrication-check grep verification on every cited
symbol in refs 02 + 06 in scope. The 2 stale rows in ref 06 are
already tracked (Codex-ttavz.10, .11) — no new doc-rot beads.

## Skill patches applied (this cycle)

The audit agent did not patch the skill in this cycle. The
dispatching skill applies recurrence/promotion patches at step 7 of
the cycle. Per the recurrence summary, the queued promotion for
iter-006 prep is `types:type-duplicate-cross-package` (early 2-hit
trigger).

## Next-cycle prep

- **PROMOTION QUEUED — `types:type-duplicate-cross-package` early 2-hit
  promotion**: hits=2 after this cycle (iter-004 + iter-005). Master.md
  set the early-promotion watch in iter-004's prep; iter-005 confirms
  the endemic shape (2 distinct type families with 7 call sites THIS
  cycle alone). The dispatching skill at iter-006 prep should:

  1. Apply the new R-rule to `.claude/skills/denoise/SKILL.md` §1
  2. Citation: `<!-- R<N> promoted from iter-005, fingerprint types:type-duplicate-cross-package -->`
  3. Suggested rule text:

     > **R<N>** | Type names declared in 2+ packages OR inlined at
     > 2+ worker route call sites MUST resolve to a single canonical
     > declaration site (in `@codex/shared-types` for cross-cutting
     > wire shapes; in `@codex/observability` for observability-shaped
     > interfaces; in `@codex/cache` for cache-helper utility types;
     > or in the foundation package that owns the runtime shape).
     > Verified by an `expectTypeOf<A>().toEqualTypeOf<B>()` test
     > that fails to compile when shapes drift, plus a grep guard
     > that fails when inline declarations re-appear. | Major

- **Recurrence ledger update** for `recurrence.json`:

  ```json
  "types:type-duplicate-cross-package": {
    "hits": 2,
    "iters": ["iter-004", "iter-005"],
    "cycle_density": { "iter-004": 6, "iter-005": 2 },
    "first_seen": "2026-04-25",
    "last_seen": "2026-04-25",
    "promoted": true,
    "rule_id": "R<N>"
  }
  ```

- **NEW fingerprints introduced this cycle**:
  - `types:type-narrowing-incomplete-orgmanagement` (F1) — hits=1,
    BLOCKER. Track for recurrence; the fix is a 4-line type change in
    `packages/worker-utils/src/procedure/types.ts` so it should land
    quickly.
  - `types:as-cast-without-guard` (F4) — first time filed as a
    finding (already in ref 02 §7 row 8 as anti-pattern). Track for
    recurrence.

- **Recurrence updates for existing fingerprints**:
  - `types:as-unknown-as`: increment from iter-004's 2 deferred sites
    + iter-005's 2 worker-side production sites = 4 total references
    (only 2 filed as findings). Track for recurrence; if iter-006
    surfaces ANOTHER occurrence, promote per R7 standard 3-hit rule.

- **Deferred-but-noted findings** (see "Findings deferred" §):
  - `notifications-api` CLAUDE.md drift (`preferences.ts` reference
    stale) — route to `/codebase-audit` or local docs task; not a
    denoise-reference doc-rot
  - `workers:env-binding-error-swallowed` in unsubscribe.ts:83 —
    silent DB error catch; route to security × workers next pass

- **Pending watches** (carry-forward from earlier cycles):
  - `packages:identifier-no-shape-validation` (iter-001 F2) — still
    hits=1
  - `security:public-route-no-ratelimit` (iter-002 F2) — still hits=1
  - `web:auth-remote-broken-endpoint`, `web:auth-form-orphan-rpc-surface`,
    `security:missing-hsts` (iter-003) — still hits=1
  - `workers:waituntil-no-catch` — recurrence #2 of 3 (NO 3rd hit
    found in iter-005 — the cron `runRecoverStuckTranscoding` is
    self-handling). One more sighting in iter-006 / iter-007 still
    promotes per R7 standard 3-hit threshold.

- **Doc-rot fixes carry-forward**: Codex-ttavz.3-6, .10-11 remain
  open. When they land, re-run cycle-0 fabrication checks on the
  affected cells.

- **F1 fix entanglement**: F1 (Codex-XXXXXX) edits BOTH
  `packages/worker-utils/src/procedure/types.ts` AND consumers in
  `workers/organization-api/src/routes/tiers.ts` and
  `workers/ecom-api/src/routes/subscriptions.ts`. The `as string`
  casts can ONLY be safely removed AFTER the type narrow widens.
  Same PR — single atomic change.

- **F2-F4 fix entanglement**: each F2, F3, F4 fix consolidates a
  type pattern. F2 (Logger) + F3 (WaitUntilFn) ride iter-004 F3's
  consolidation site (`@codex/observability` or `@codex/cache`).
  F4 (CacheCtx) is independent — narrow CacheCtx env shape locally.
  All three can land in the same PR or separately.

- **F5 fix entanglement**: F5 changes `createWorker(...)` to
  `createWorker<XxxEnv>(...)` in 2 worker entry files. Independent.

- **Stop criterion (§4)**: this is the FIRST cycle for `types ×
  workers`. Three consecutive zero-finding cycles needed to declare
  fidelity — countdown is 3 → 3 (this cycle produced findings, no
  decrement).

- **Cell-due check next time**:
  `git log --since=iter-005 -- 'workers/*/src/**'`. Anything that
  lands afterwards is in scope.

- **Suggested next cell** (per dispatching `master.md` priority order):
  After applying the queued R-rule promotion in iter-006, the next
  delta-eligible cell with churn is `types × apps/web` (heaviest
  churn surface; paraglide / TanStack DB / Svelte 5 props axis).
  Continuity argument: iter-005 surfaced widespread
  `types:type-duplicate-cross-package` — apps/web is likely to have
  the same pattern (paraglide message shapes, response types
  duplicated between server load and client component props).
