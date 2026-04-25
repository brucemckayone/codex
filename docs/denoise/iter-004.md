# Iteration 004 — types × packages

- **Cell**: types × packages
- **Date**: 2026-04-25
- **Mode**: delta
- **Since**: 14 days ago (`git log --since='14 days ago'`)
- **Files churned**: 93 (in-scope, non-test, non-migration, in `packages/*/src/**`)
- **Agent**: agents/audit-packages.md
- **Fallow JSON**: `/tmp/denoise-iter-004-fallow.json` (inherited from iter-001)
- **Typecheck baseline**: `/tmp/denoise-iter-004-typecheck-baseline.log` (3 pre-existing TS errors in `@codex/worker-utils`, baseline preserved)

## Fabrication check

Cycle 0 protocol: grep every cited symbol from references 02-type-audit.md
and 07-domain-packages.md against current code. Reference 07's drift was
already covered by iter-001 F3 (Codex-ttavz.3 — `assertNotFound` row 1) and
iter-001 F4 (Codex-ttavz.4 — `BusinessRuleError`/`RateLimitError`/
`InternalError` row 3). This cycle adds reference 02 to the scan.

| Symbol cited | Where | Hits | Status |
|---|---|---|---|
| `expectTypeOf` (vitest expect-type) | ref 02 §6a, §6b, §6c | 0 in src, used in test at runtime | live (vitest API; usable in `__denoise_proofs__`) |
| `@codex/shared-types` | ref 02 §2, §4 | 16 source-side imports, all `import type` | live, contract upheld |
| `@codex/shared-types/test-helpers` | ref 02 §6c | **0 hits — does not exist** | **acknowledged in ref ("may need to be added")** — NOT doc-rot |
| `import type {...} from '@codex/shared-types'` (no-runtime-import rule) | ref 02 §4 | 16 of 16 source imports use `import type` | live, rule upheld |
| `scopedNotDeleted` | ref 07 §2 | 61 hits | live |
| `withCreatorScope`, `withOrgScope` | ref 07 §2 | 60+54 hits | live |
| `BaseService` | ref 07 §1 | 101 hits | live |
| `safeParse` | ref 02 §3 row 12 | 4 hits in src | live |
| (raw) `<schema>.parse(input)` in service code | ref 02 §3 row 12 ("zod-result-not-checked") | 9 occurrences in 5 service files | live (latent F7 candidate; deferred — see Findings) |

**Result**: every hard-symbol citation in ref 02 + ref 07 is live in the
codebase. The only "miss" is `@codex/shared-types/test-helpers`, which the
reference itself acknowledges as future work. **No new doc-rot beads filed
in iter-004.** The four open doc-rot beads from iter-001 (Codex-ttavz.3-6)
and two from iter-002 (Codex-ttavz.10-11) remain valid and pertain to refs
01, 06, 07.

## Skill patches applied (iter-004 prep)

Per master.md "Next-cycle prep" / iter-003 F2 promotion: **R10 was
already applied** to local `.claude/skills/denoise/SKILL.md` §1 by the
dispatching skill at the start of this cycle (verified at the read at
audit start; citation comment present:
`<!-- R10 promoted from iter-003, fingerprint security:missing-csp -->`).
No additional skill patches in this cycle. Recurrence promotions queued
in §"Next-cycle prep" below.

## Findings

### F1 — `types:type-duplicate-cross-package` (Database)

- **Severity**: major
- **File:Line**:
  - `packages/database/src/client.ts:329` (canonical: HTTP only)
  - `packages/content/src/types.ts:21` (redeclared: `dbHttp | dbWs` union)
  - `packages/notifications/src/types.ts:36` (redeclared: same union)
  - `packages/organization/src/types.ts:15` (redeclared: same union)
  - `packages/test-utils/src/database.ts:87` (redeclared: `DatabaseWs`)
- **Description**: five distinct `export type Database` declarations
  across packages, with structurally divergent shapes. The canonical
  `@codex/database` Database is HTTP-only (`ReturnType<typeof
  drizzleHttp<typeof schema>>`) — but three service packages
  (`content`, `notifications`, `organization`) re-declare it as
  `typeof dbHttp | typeof dbWs` (a strict superset). `test-utils`
  redeclares as `DatabaseWs` (the WS-only variant). The
  `packages/database/CLAUDE.md` "Type Exports" section instructs
  consumers to `import type { Database, DatabaseWs } from '@codex/database'`
  — but service packages bypass this because the canonical type is
  too narrow for service constructors that accept BOTH HTTP and WS.

  Concrete consumer risk:
  - A worker that imports both `@codex/content`'s service types and
    `@codex/database`'s canonical Database sees two distinct types
    under the same name. They are not assignment-compatible in either
    direction (HTTP-only ⊂ HTTP|WS).
  - A future contributor adding a new package will guess wrong about
    the shape and pick whichever they imported first.

  Fix (suggested):
  - Broaden the canonical `@codex/database` `Database` export to
    `typeof dbHttp | typeof dbWs` (matches what 3 service packages
    actually want), OR
  - Keep `Database` HTTP-only and export a new `DatabaseAny` /
    `DatabaseClient` type that's the union; the three services
    import the union and drop their local redeclaration.
- **Proof test form**: type-equality test (Catalogue row 3) —
  `expectTypeOf<X>().toEqualTypeOf<Y>()`
- **Proof test path**: `packages/content/src/__denoise_proofs__/iter-004/F1-database-type-duplicate.test.ts`
- **MCP evidence**: `mcp__ide__getDiagnostics` (per §3 matrix for
  `types × packages`) — captures the structural divergence as a
  TS2344 / TS2322 error when the proof test's `.skip()` is removed.
- **Recurrence (R7)**: NEW fingerprint
  `types:type-duplicate-cross-package`. Track for recurrence — first
  hit. Multiple findings in this cycle (F1-F6) all share this
  fingerprint, so cycle-internal increment is +6.
- **Bead**: _filed at step 7 by dispatching skill_

### F2 — `types:type-duplicate-cross-package` (RevenueSplit)

- **Severity**: major
- **File:Line**:
  - `packages/purchase/src/services/revenue-calculator.ts:27`
  - `packages/subscription/src/services/revenue-split.ts:17`
  - Public exports:
    - `packages/purchase/src/index.ts:76` → `type RevenueSplit`
    - `packages/subscription/src/index.ts:63` → `type RevenueSplit`
- **Description**: structurally identical `RevenueSplit` interfaces
  declared and publicly exported by TWO packages. Both define
  `{ platformFeeCents: number; organizationFeeCents: number;
  creatorPayoutCents: number }`. Per `@codex/subscription/CLAUDE.md`
  "Key Exports": `calculateRevenueSplit(amountCents, platformFeePercent,
  orgFeePercent)` returns a `RevenueSplit` — and `@codex/purchase`
  documents `calculateRevenueSplit` similarly.

  ecom-api worker imports both packages. A handler that types a
  variable as `RevenueSplit` from `@codex/purchase` and assigns from
  a `@codex/subscription` helper return value compiles only because
  the shapes match TODAY. If either package adds a field (e.g. a
  Stripe Connect transfer accountId), only that package's consumers
  benefit.

  Fix (suggested):
  - Move canonical `RevenueSplit` to `@codex/shared-types` (zero-runtime
    package, per ref 02 §4)
  - Update both `@codex/purchase` and `@codex/subscription` to
    `import type { RevenueSplit } from '@codex/shared-types'` and
    re-export from their barrels for compatibility
  - Both packages' `calculateRevenueSplit` functions return the same
    canonical type
- **Proof test form**: type-equality test (Catalogue row 3)
- **Proof test path**: `packages/subscription/src/__denoise_proofs__/iter-004/F2-revenuesplit-duplicate.test.ts`
- **MCP evidence**: `mcp__ide__getDiagnostics` — TS2344 if the canonical
  shape diverges, OR `expectTypeOf().toEqualTypeOf` failure at compile
  time if shapes drift after the fix.
- **Recurrence (R7)**: increment of `types:type-duplicate-cross-package`
  (cycle-internal +1 of +6).
- **Bead**: _filed at step 7 by dispatching skill_

### F3 — `types:type-duplicate-cross-package` (WaitUntilFn / InvalidationLogger)

- **Severity**: minor
- **File:Line**:
  - `packages/content/src/services/content-invalidation.ts:101,107`
  - `packages/subscription/src/services/subscription-invalidation.ts:70,76`
  - Public exports:
    - `packages/content/src/index.ts:67-68` → `InvalidationLogger`, `WaitUntilFn`
    - `packages/subscription/src/index.ts:68,71` → `type InvalidationLogger`, `type WaitUntilFn`
- **Description**: `WaitUntilFn` is structurally identical between the
  two packages (`(promise: Promise<unknown>) => void`).
  `InvalidationLogger` is *almost* identical — the content-package
  variant adds an optional `info` member that the subscription variant
  doesn't have:

  ```typescript
  // content-invalidation.ts
  export interface InvalidationLogger {
    warn: (message: string, context?: Record<string, unknown>) => void;
    info?: (message: string, context?: Record<string, unknown>) => void;  // <-- only here
  }
  // subscription-invalidation.ts
  export interface InvalidationLogger {
    warn: (message: string, context?: Record<string, unknown>) => void;
  }
  ```

  Both packages publicly export both types from their barrel. Both
  comments explicitly say "We intentionally do not depend on Hono or
  workers-types here so this helper stays portable" — they're trying
  to stay foundation-free, hence the duplicate. The cure is to
  centralise the shared infrastructure in `@codex/cache` (which
  already owns `VersionedCache`) or `@codex/shared-types`.

  Fix (suggested):
  - Move both types to `@codex/cache` (the package responsible for
    cache invalidation infrastructure)
  - `content-invalidation.ts` and `subscription-invalidation.ts`
    `import type` from `@codex/cache`
  - Their barrels re-export for compatibility
- **Proof test form**: type-equality test (Catalogue row 3)
- **Proof test path**: `packages/content/src/__denoise_proofs__/iter-004/F3-waituntil-invalidationlogger-duplicate.test.ts`
- **MCP evidence**: `mcp__ide__getDiagnostics`
- **Recurrence (R7)**: increment of `types:type-duplicate-cross-package`.
- **Bead**: _filed at step 7 by dispatching skill_

### F4 — `types:type-duplicate-cross-package` (SessionData / UserData) **[BLOCKER]**

- **Severity**: blocker
- **File:Line**:
  - `packages/security/src/session-auth.ts:15,29` (strict shapes)
  - `packages/security/src/index.ts:31-32` (publicly exported)
  - `packages/shared-types/src/worker-types.ts:370,408` (loose shapes
    with index signature)
  - `packages/shared-types/src/index.ts:46-47` (publicly exported)
  - Wire-up:
    - `packages/worker-utils/src/test-utils.ts:14` → `from '@codex/security'`
    - `packages/test-utils/src/e2e/helpers/types.ts:8` → `from '@codex/shared-types'`
    - `apps/web/src/app.d.ts:4` → `from '$lib/types'` (which re-exports
      from `@codex/shared-types`)
- **Description**: `SessionData` and `UserData` are declared in BOTH
  `@codex/security` and `@codex/shared-types` with **structurally
  divergent shapes**. The shared-types `Variables` interface declares
  `session?: SessionData; user?: UserData;` — those are the LOOSE
  shapes that Hono context typing exposes to handlers. But
  `requireAuth()` middleware in `@codex/security` populates those
  context variables with the STRICT shapes.

  Concrete divergences:

  | Field | `security.SessionData` | `shared-types.SessionData` |
  |---|---|---|
  | `token` | `string` (required) | `string \| undefined` |
  | `ipAddress` | `string \| null` (required) | absent |
  | `userAgent` | `string \| null` (required) | absent |
  | `createdAt` / `updatedAt` | required | absent |
  | index signature | none | `[key: string]: unknown` |

  | Field | `security.UserData` | `shared-types.UserData` |
  |---|---|---|
  | `id`, `email`, `emailVerified`, `image`, `role` | yes | yes (via UserProfile) |
  | `name` | `string` (required) | `string \| null` (overridden in UserData) |
  | `username`, `bio`, `socialLinks` | absent | required (via UserProfile) |
  | `createdAt` | yes | yes |
  | `updatedAt` | yes | absent |
  | index signature | none | `[key: string]: unknown` |

  **Silent runtime failure mode**: a handler typed via shared-types
  (the Hono context shape) reads `ctx.user.username` — compiles fine
  because shared-types' `UserProfile.username` is `string | null`. At
  runtime the value is `undefined` because the security middleware
  set the strict shape, which has no `username` field. The
  `[key: string]: unknown` index signature on shared-types makes
  `ctx.user.anyKey` indexable without error, masking the runtime
  divergence.

  This is a NEW BLOCKER fingerprint. It does not match any iter-001/2/3
  recorded fingerprint. R9 (auth-rate-limit) and R10 (CSP) handle
  different concerns. The single-hit security-blocker exception (R7
  footnote) does NOT fire because `phase=types`, not `security` —
  the fingerprint starts with `types:`. So promotion follows the
  standard 3-hits-in-trailing-6 rule.

  Fix (suggested):
  - Rename security-internal types: `SessionAuthRow` / `UserAuthRow`
    (or `DBSession` / `DBUser`) — they describe rows the middleware
    reads from the DB, not the Hono context shape.
  - `requireAuth()` projects strict→loose before
    `c.set('session', ...)` / `c.set('user', ...)` (or the strict
    shape is *subset-compatible* with the loose shape, which it
    almost is — the missing piece is the index signature).
  - Update consumers (`worker-utils/src/test-utils.ts` etc.) to
    import from the right place.
- **Proof test form**: type-equality test (Catalogue row 3)
- **Proof test path**: `packages/security/src/__denoise_proofs__/iter-004/F4-sessiondata-userdata-duplicate.test.ts`
- **MCP evidence**: `mcp__ide__getDiagnostics`. Future runtime
  verification via Vitest with a real session injected through the
  middleware, asserting the Hono context's typed read returns the
  values the test expects.
- **Recurrence (R7)**: increment of `types:type-duplicate-cross-package`.
  Severity blocker on type-system grounds (silent runtime undefined),
  not security-blocker.
- **Bead**: _filed at step 7 by dispatching skill_

### F5 — `types:type-duplicate-cross-package` (OrganizationMembership)

- **Severity**: minor
- **File:Line**:
  - `packages/database/src/schema/content.ts:412` (canonical DB row)
  - `packages/worker-utils/src/procedure/helpers.ts:173` (3-field
    projection)
- **Description**: `OrganizationMembership` declared in two packages
  with structurally divergent shapes. The database schema variant is
  the canonical `$inferSelect` row (id, userId, organizationId, role,
  status, joinedAt, invitedBy, invitedAt, createdAt, updatedAt,
  deletedAt). The worker-utils variant is a 3-field projection
  (`{ role, status, joinedAt }`) used to populate
  `ctx.organizationMembership` inside `procedure({ requireOrgMembership:
  true })`.

  This shape is read in `org-helpers.ts:checkOrganizationMembership`
  (in scope this cycle) — see lines 138-189 — and the projection is
  hand-rolled rather than derived via `Pick`.

  Concrete consumer risk: a route handler typing its membership
  variable as `OrganizationMembership` from `@codex/database` (the
  canonical schema export) and assigning from
  `ctx.organizationMembership` compiles only because the projection
  is a subset; assignment in the OTHER direction silently strips
  fields. Naming collision is the bug, not assignability.

  Fix (suggested):
  - Rename the worker-utils helper:
    `OrganizationMembershipContext` (or `MembershipPolicyContext`)
  - Or derive via `Pick<OrganizationMembership, 'role' | 'status' |
    'joinedAt'>` so future schema additions to `role` / `status`
    propagate.
- **Proof test form**: type-equality test (Catalogue row 3)
- **Proof test path**: `packages/database/src/__denoise_proofs__/iter-004/F5-organizationmembership-duplicate.test.ts`
- **MCP evidence**: `mcp__ide__getDiagnostics`
- **Recurrence (R7)**: increment of `types:type-duplicate-cross-package`.
- **Bead**: _filed at step 7 by dispatching skill_

### F6 — `types:type-duplicate-cross-package` (TemplateScope / TemplateStatus / EmailCategory)

- **Severity**: minor
- **File:Line**:
  - `packages/database/src/schema/notifications.ts:220,221`
    (drizzle-enum inferred)
  - `packages/validation/src/schemas/notifications.ts:9,12,390`
    (Zod-enum inferred)
  - `packages/notifications/src/types.ts:135` (literal union)
- **Description**: three notification-domain enum types declared in
  multiple places with no enforced cross-package consistency:

  - `TemplateScope`: declared in `@codex/database` (drizzle enum) and
    `@codex/validation` (z.infer)
  - `TemplateStatus`: same pair
  - `EmailCategory`: declared in `@codex/notifications` as a literal
    union AND in `@codex/validation` as `z.infer<typeof
    emailCategoryEnum>`

  Today the values match, but nothing in the build forces them to
  stay aligned. If the Zod enum gains a value (`'urgent'`?), the
  literal union in `@codex/notifications/types.ts` will not see it.
  If the Drizzle enum gains a value, validation may accept it but
  the database type still excludes it.

  Fix (suggested): pick ONE source of truth. The Zod schema in
  `@codex/validation` is the natural choice (validates at the API
  boundary). Database schema and notifications types `import type`
  from validation.
- **Proof test form**: type-equality test (Catalogue row 3)
- **Proof test path**: `packages/notifications/src/__denoise_proofs__/iter-004/F6-template-types-duplicate.test.ts`
- **MCP evidence**: `mcp__ide__getDiagnostics`
- **Recurrence (R7)**: increment of `types:type-duplicate-cross-package`.
- **Bead**: _filed at step 7 by dispatching skill_

## Findings deferred (noted, not filed this cycle)

These were investigated and found, but DO NOT meet the bar for filing in
this cycle. Logged here so the next cycle can pick them up if they recur
or warrant their own pass.

- **`types:zod-result-not-checked`** in service constructors that call
  `<schema>.parse(input)` outside try/catch:
  - `packages/content/src/services/media-service.ts:88,271`
  - `packages/content/src/services/content-service.ts:148,289`
  - `packages/organization/src/services/organization-service.ts:94,196`
  - `packages/purchase/src/services/purchase-service.ts:142,595`
  - `packages/platform-settings/src/services/branding-settings-service.ts:244`
  - The schemas are also validated upstream by `procedure({ input })`,
    so in production the service-level parse is double validation.
    BUT: services called from internal paths (tests, future direct
    callers) that bypass `procedure()` get a raw `ZodError` instead
    of the `ValidationError` envelope `mapErrorToResponse()` expects.
  - **Why deferred**: ref 02 §3 row 12 owns this fingerprint, but the
    pattern is widespread (9 occurrences in 5 service files) — fix
    is a sweeping refactor that doesn't fit the cycle's "one cell"
    discipline. Better routed to a focused `/backend-dev` task.
  - Track in next-cycle prep for elevation if it recurs.

- **`types:as-unknown-as`** in `packages/test-utils/src/stripe-mock.ts:165`
  (`mock as unknown as Stripe`) and
  `packages/worker-utils/src/procedure/multipart-procedure.ts:279`
  (`file as unknown as File`).
  - Both are in churned files in scope.
  - `stripe-mock.ts` is a TEST FIXTURE (CLAUDE.md says
    `createMockStripe()` returns "a `Stripe`-shaped mock") — ref 02 §1
    excludes test files from the audit but NOT test-utility helpers
    that are exported as a public API. Borderline.
  - `multipart-procedure.ts` casts a Cloudflare Workers `File`
    (different runtime shape) to a standard DOM `File` type — a
    well-known framework interop gap, not a clean code finding.
  - **Why deferred**: both are pragmatic exception-shaped, not
    pattern-of-laziness. Re-evaluate if a third instance lands.

- **`types:non-null-assertion-overuse`** in
  `packages/admin/src/services/analytics-service.ts:569,570,666,667`
  (4 hits in 2 query blocks). The non-null assertions on
  `options!.compareFrom!` and `options!.compareTo!` are gated by an
  explicit `wantsCompare` boolean check (`if (wantsCompare && ...)`),
  with a code comment justifying the assertion. Pre-existing pattern;
  no new churn.
  - **Why deferred**: comment-justified; the smell is real but the
    fix (refactor to extract a guarded options object) is style, not
    bug. Defer until it's the *only* outstanding finding in a future
    cycle.

- **TS2538 in `packages/worker-utils/src/middleware.ts:320,389`**
  (`c.env[name]` where `name: string` cannot index the Bindings
  type) and **TS2322 in
  `packages/worker-utils/src/procedure/service-registry.ts:736`**
  (`dist/versioned-cache` vs `src/versioned-cache` type identity
  mismatch). All three errors are in the typecheck baseline
  (pre-existing).
  - **Why deferred**: pre-existing baseline. These are real type-
    safety holes (the second one indicates a duplicate-emit /
    package-resolution issue between `dist/` and `src/`), but
    they're already known. The denoise cell-due check should have
    skipped them since they predate iter-001's baseline; surfacing
    here only because they're co-located with churn this cycle.
    Track for elevation if they survive into the workers cycle's
    next pass.

## Summary

| Metric | Value |
|---|---|
| Total findings | 6 |
| Blocker | 1 (F4 SessionData/UserData divergence) |
| Major | 2 (F1 Database, F2 RevenueSplit) |
| Minor | 3 (F3 WaitUntilFn/InvalidationLogger, F5 OrganizationMembership, F6 Template*/EmailCategory) |
| Testability-bugs | 0 |
| Testability-bug rate | 0% (R8 does NOT fire) |
| Beads filed | _0 — pending step 7 of dispatching skill_ |
| Recurrence promotions queued | 0 (single fingerprint with 6 cycle-internal hits — see Next-cycle prep) |
| Proof tests written | 6 |

R2 catalogue walk: NOT triggered — every finding mapped to a Catalogue
row directly.

| # | Finding | Catalogue row |
|---|---|---|
| F1 | Database type re-declared 5 times, divergent | Row 3 — type-equality test |
| F2 | RevenueSplit duplicated across 2 packages | Row 3 — type-equality test |
| F3 | WaitUntilFn / InvalidationLogger duplicated | Row 3 — type-equality test |
| F4 | SessionData / UserData divergent across 2 packages | Row 3 — type-equality test |
| F5 | OrganizationMembership name-collision | Row 3 — type-equality test |
| F6 | TemplateScope/Status/EmailCategory triple-source-of-truth | Row 3 — type-equality test |

R8 does not fire (rate < 15%).

R7 promotions: every finding shares the SAME fingerprint
`types:type-duplicate-cross-package`. Cycle-internal hits = 6 (F1-F6),
but per the recurrence-protocol §2, a "hit" is *one finding per cycle*,
not per file. So this counts as **+1 hit in iter-004**, total = 1.
The fingerprint is therefore at hits=1 after this cycle. No promotion
yet (threshold = 3 in trailing 6).

**However**: the cycle-internal density (6 instances in one cell) is
itself a strong signal. Suggest the dispatching skill record this in
recurrence.json with a `cycle_density` annotation so the next cycle's
prep can weight it. If the same fingerprint surfaces in iter-005 or
iter-006 (any scope), promotion to a hard rule should be considered
even at hits=2 — the SHAPE of the recurrence (multi-instance per cycle)
tells us the pattern is endemic, not rare.

## MCP evidence summary

Per §3 matrix, types × packages's required MCP is
`mcp__ide__getDiagnostics`. This audit produced 6 static findings
backed by Vitest `expectTypeOf` proof tests. The dispatching skill at
step 6 will:

1. Open each proof test file
2. Capture the `mcp__ide__getDiagnostics` output for the proof file's
   URI BEFORE removing `.skip()` (should be clean — TS doesn't
   diagnose inside `it.skip`)
3. Remove `.skip()` in a scratch branch and capture diagnostics
   AGAIN — this is the "red on main" snapshot the bead body needs.
4. Attach the diagnostic output as evidence to each bead.

For F4 in particular, runtime verification via Vitest is also
recommended: a test that actually invokes `requireAuth()` middleware
with a valid session, then reads `ctx.user.username` — should return
`undefined` today (proving the divergence has runtime impact), and a
real value after the fix.

## Skill patches applied (this cycle)

- **R10 applied** to `.claude/skills/denoise/SKILL.md` §1 by the
  dispatching skill at the start of this cycle (queued by iter-003
  F2 single-hit security exception). Citation comment present:
  `<!-- R10 promoted from iter-003, fingerprint security:missing-csp -->`.

The audit agent did not patch the skill in this cycle. The dispatching
skill applies recurrence/promotion patches at step 7 of the cycle.

## Next-cycle prep

- **PROMOTION watch**: `types:type-duplicate-cross-package` (F1-F6)
  hits=1 after this cycle. The cycle-internal density (6 distinct
  instances) is a strong signal of pattern endemic-ness. If iter-005
  surfaces another instance of this fingerprint (any scope), the
  dispatching skill should consider promoting on the second hit
  rather than waiting for the standard 3-hit threshold. Suggested
  rule text if promoted:

  > **R<N>** | Type names declared in 2+ packages MUST resolve to a
  > single canonical declaration site (in `@codex/shared-types` for
  > cross-cutting wire shapes, or in the foundation package that
  > owns the runtime shape). Verified by an `expectTypeOf<A>().toEqualTypeOf<B>()`
  > test that fails to compile when shapes drift. | Major

- **Recurrence**: track 1 fingerprint in `recurrence.json`:
  `types:type-duplicate-cross-package` with `iters: ["iter-004"]`,
  `hits: 1`, AND a cycle_density annotation noting 6 distinct
  declarations were found in this single cycle. Suggested:

  ```json
  "types:type-duplicate-cross-package": {
    "hits": 1,
    "iters": ["iter-004"],
    "cycle_density": { "iter-004": 6 },
    "first_seen": "2026-04-25",
    "last_seen": "2026-04-25",
    "promoted": false,
    "rule_id": null
  }
  ```

- **Deferred-but-noted findings** (see "Findings deferred" §):
  - `types:zod-result-not-checked` — 9 occurrences across 5 service
    files. Don't surface as denoise findings; route to `/backend-dev`
    as a focused refactor or wait for organic re-discovery.
  - `types:as-unknown-as` in stripe-mock + multipart-procedure —
    track for a third instance.
  - `types:non-null-assertion-overuse` in analytics-service — comment-
    justified; defer.
  - 3 baseline TS errors in `@codex/worker-utils` — pre-existing;
    elevate if they survive the next workers cycle.

- **Pending watches** (carry-forward from earlier cycles):
  - `packages:identifier-no-shape-validation` (iter-001 F2) — add
    to ref 07 §7 if recurs (still hits=1)
  - `security:public-route-no-ratelimit` (iter-002 F2) — add to ref
    01 §8 row 13 if recurs (still hits=1)
  - `web:auth-remote-broken-endpoint`, `web:auth-form-orphan-rpc-surface`,
    `security:missing-hsts` (iter-003) — track for recurrence
  - `workers:waituntil-no-catch` — recurrence #2 of 3 (one more sighting
    in iter-005 / iter-006 promotes per R7 standard 3-hit threshold)

- **Doc-rot fixes carry-forward**: Codex-ttavz.3-6, .10-11 remain open.
  When they land, re-run cycle-0 fabrication checks on the affected
  cells.

- **F4 fix entanglement**: F4 (SessionData/UserData) edits BOTH
  `packages/security/src/session-auth.ts` AND
  `packages/shared-types/src/worker-types.ts`. The fix MUST update
  consumers in `packages/worker-utils/src/test-utils.ts:14` and
  `apps/web/src/app.d.ts:4` (which goes through `$lib/types`).
  Same PR.

- **F1-F3, F6 fix entanglement**: each F1-F3, F6 fix consolidates
  type declarations to one canonical site (`@codex/shared-types` or
  `@codex/cache` for invalidation infra; canonical foundation
  package for `Database`). All four fixes can land independently —
  no cross-PR coupling.

- **Stop criterion (§4)**: this is the FIRST cycle for `types ×
  packages`. Three consecutive zero-finding cycles needed to declare
  fidelity — countdown is 3 → 3 (this cycle produced findings, no
  decrement).

- **Cell-due check next time**:
  `git log --since=iter-004 -- 'packages/*/src/**'`. Anything that
  lands afterwards is in scope.

- **Suggested next cell** (per dispatching `master.md` priority order):
  `types × workers` (same churn surface as iter-002, complementary
  axis, will pick up any worker-side `any` patterns — particularly
  the `c.env[name] as ...` pattern hinted at by the baseline
  TS2538 errors). Alternative: `types × apps/web` (heaviest churn
  surface; fresh paraglide / TanStack DB / Svelte 5 props axis).
  Tie-break: phase priority is identical (both types); pick
  `types × workers` for continuity with iter-002's findings.
