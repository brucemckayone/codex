# Iteration 030 — types × workers

- **Cell**: types × workers (Round 2 second-pass cycle 6 / drift-detection + R11 effectiveness verdict + first R15 audit)
- **Date**: 2026-04-26
- **Mode**: delta
- **Since**: `7345a106` (iter-024 baseline; types × workers last clean run was iter-017 with the same baseline — this captures iter-024 + Round 3 + iter-026..029 churn)
- **Files churned**: 12 (`workers/*/src/**` excluding `__denoise_proofs__` / `__tests__`)
- **Agent**: agents/audit-workers.md
- **Fallow JSON**: `/tmp/denoise-iter-030-fallow.json`
- **Typecheck baseline**: `/tmp/denoise-iter-026-typecheck-baseline.log` (reused — clean 53/53 pass)
- **Workers typecheck (this cycle)**: 7/7 PASS (auth, identity-api, organization-api, ecom-api, notifications-api, content-api, media-api — all `tsc --noEmit` clean)

---

## Strategic context

This cycle is the **first audit of `types × workers` since iter-017** (the Round 2 batch sweep). It folds three mandates:

1. **R11 effectiveness verdict for workers scope** — Tier 3.A (Logger/WaitUntilFn/InvalidationLogger) and Tier 4.A (orgmanagement narrowing) and Tier 3.B (CacheCtx narrow→cast) all promised to clean workers/* of inline canonical-shape redeclarations and unguarded narrowings.
2. **First R15 audit since promotion** (iter-029). R15 has a 4-reason-code carve-out list (`drizzle-infinite-recursion`, `framework-default-init`, `proxy-target`, `type-test`); this cycle classifies every `as <TypeName>` cast in `workers/*/src/**` against those reason codes and flags any that don't fit.
3. **Recurrence drift check** — `types:as-cast-without-guard` (R15-promoted, hits=3), `types:as-unknown-as` (hits=2 of 3), `types:type-duplicate-cross-package` (R11-promoted, hits=4) all watched for new occurrences.

Verdicts up front:

- **R11 (workers scope)**: ✅ FULLY EFFECTIVE. Zero inline `interface Logger` / `interface WaitUntilFn` / `interface InvalidationLogger` survive in workers/*/src/** — both call sites that previously inlined `WaitUntilFn` (organization-api/routes/{tiers,settings}.ts) now `import type { WaitUntilFn } from '@codex/cache'`. Worker route files that need a `Logger` import canonical from `@codex/observability`. Tier 4.A landed clean — zero `ctx.organizationId as string` casts remain. Tier 3.B landed clean — zero `as CacheCtx` narrow→cast pattern remains. (Codex-lqvw4.7, .8, .9, .11 verified closed by spot-grep.)
- **R15 first audit**: 1 NEW finding (F1, identity-api), 1 PATTERN-LEVEL finding (F2, 18-site Stripe cluster needing carve-out decision), 1 NEW finding (F3, error-as-Error in 3 catch blocks). **Promotes a 5th carve-out reason code candidate** (`stripe-event-discriminated-union`) for the dispatcher's review.
- **Recurrence increments**: `types:as-cast-without-guard` hits 3 → 5 (F1 + F3); **`types:as-unknown-as` hits 2 → 3 — R7 STANDARD 3-HIT THRESHOLD REACHED, R-rule promotion queued for iter-031 (proposed R16)**.

---

## Fabrication check (cycle 0 protocol — types × workers has had 4+ cycles since iter-005)

Walked every anti-pattern row in `references/02-type-audit.md` §7 + `references/06-domain-workers.md` §9 against current HEAD:

| Reference / row | Cited symbol / file | Live in HEAD? |
|---|---|---|
| 02 §1 / row 1 | `: any` annotation grep | ✓ — only false-positive comment match in workers/media-api/src/routes/transcoding.ts:58 ("any future change") |
| 02 §1 / row 2 | `as any` cast grep | ✓ — zero hits in workers/*/src/** (excluding tests) |
| 02 §2a | `@codex/shared-types` canonical site for cross-package types | ✓ — `OrgMemberRole`, `MembershipLookupResponse`, `Bindings`, `HonoEnv` all live |
| 02 §2b | `expectTypeOf` runtime via `vitest`'s `expect-type` | ✓ — used in iter-005 + iter-028 proof tests |
| 02 §3 | `as Foo` without runtime guard (R15 territory) | ✓ — F1, F2, F3 are this cycle's findings |
| 02 §4 | `@codex/shared-types` is type-only (zero runtime deps) | ✓ — verified via `cat packages/shared-types/package.json` (no runtime deps) |
| 02 §5 | Generic abuse | ✓ — `createWorker<TEnv>` is the canonical pattern (admin-api uses it; auth + media-api don't — F4 recurrence) |
| 02 §6 | Type-equality test idioms | ✓ — used in F1 proof |
| 02 §7 / row 10 | `as unknown as` (the iter-005 F5 finding) | ✓ — F4 recurrence — same 2 sites |
| 06 §1 | `procedure()` factory | ✓ — used across all churned route files |
| 06 §2 | `ctx.services.*` registry dispatch | ✓ — all churned routes use it |
| 06 §3 | `waitUntil` hygiene + `.catch()` chain | ✓ — `media-api/routes/transcoding.ts:60` is exemplary |
| 06 §4 | DurableObject lifecycle | ✓ — orphaned-file-cleanup-do.ts has fetch/alarm; FP taxonomy #7 honoured |
| 06 §5 | wrangler.jsonc bindings | ✓ — out of scope for this cell |
| 06 §6 | Cloudflare runtime constraints | ✓ — out of scope |
| 06 §7 | Per-worker idiosyncrasies | ✓ — auth bypasses procedure() correctly; ecom-api Stripe webhooks bypass procedure(); media-api RunPod webhook bypasses |
| 06 §9 / row 1 | `workers:route-bypassing-procedure` | ✓ — none in churned files |
| 06 §9 / row 2 | `workers:procedure-no-input-schema` | ✓ — none in churned files |
| 06 §9 / row 4 | `workers:waituntil-no-catch` | ✓ — verified clean in churned files (Tier 1 fixes from `be00ddb1`) |

**Result**: 18/18 reference rows live. **0 fabrications.** Cycle 0 fabrication budget: clean.

---

## Findings

### F1 — `types:as-cast-without-guard` — `membership.role` narrowed without Zod (NEW)

- **Severity**: major (R15 hard-rule violation; security-adjacent — narrowed value flows out across worker-to-worker HMAC boundary into SvelteKit `hooks.ts` `reroute()` for subdomain routing AND role-based rendering)
- **File:Line**: `workers/identity-api/src/routes/membership.ts:52`
- **Description**: Inside the worker-to-worker `GET /:orgId/membership/:userId` handler, `membership.role` is typed `string` (per `OrganizationMembership.role` in `@codex/worker-utils/procedure/helpers.ts:174`). The handler casts that to `MembershipLookupResponse['role']` which is the strict 5-member union `'owner' | 'admin' | 'creator' | 'subscriber' | 'member' | null` from `@codex/shared-types/api-responses.ts:150`. R15's 4 reason codes do not apply: not Drizzle infinite-recursion, not framework default init, not Proxy target, not type-test. The comment at `api-responses.ts:147` flags the exact risk in human terms ("role union must match `organizationMembers.role` column CHECK constraint") — this finding converts that human coordination into a runtime-checked Zod parse.
- **Proof test form**: Catalogue row 3 (type-equality test) — proves source is `string` (broad) and target is the literal union (narrow), which establishes the cast IS narrowing (within R15's scope).
- **Proof test path**: `workers/identity-api/src/__denoise_proofs__/iter-030/F1-membership-role-narrowed-without-zod.test.ts`
- **MCP evidence**: n/a (static structural finding; `mcp__ide__getDiagnostics` returned the workers' clean baseline — no new TS errors introduced by adding the proof test in `.skip()` mode).
- **Bead**: NEW (to be filed under Codex-lqvw4). Suggested title: `fix(identity-api): replace membership.role unguarded cast with orgMemberRoleSchema.parse — close R15 narrowing on worker→hooks boundary`. Priority P2 (boundary-crossing, security-adjacent, but contained today by the Drizzle CHECK constraint).
- **Recurrence**: `types:as-cast-without-guard` increments hits=3 → 4 (iter-005 + iter-006 + iter-028 + iter-030). Already R-rule-promoted (R15) so no further promotion action.

### F2 — `types:as-cast-without-guard` — Stripe `event.data.object as Stripe.X` 18-site cluster (PATTERN-LEVEL)

- **Severity**: minor (every site is GUARDED at runtime by surrounding `switch (event.type)` discriminator AND the inbound event has been HMAC-verified by `verifyStripeSignature` — the casts are correct AT RUNTIME but lack the `// reason:` inline comment R15 §1 mandates for permitted exceptions)
- **File:Line** (18 sites — full inventory in proof test):
  - `workers/ecom-api/src/handlers/checkout.ts:54`
  - `workers/ecom-api/src/handlers/payment-webhook.ts:144,199`
  - `workers/ecom-api/src/handlers/connect-webhook.ts:38`
  - `workers/ecom-api/src/handlers/subscription-webhook.ts:306,342,390,412,436,459,486,512,535,558,571`
- **Description**: Stripe's TypeScript SDK types `event.data.object` as `Stripe.Event.Data.Object` (a union of every resource shape) and does NOT expose the `event.type ↔ event.data.object` discrimination at the type level — handlers MUST cast inside `switch (event.type)` arms. The pattern is canonical for every Stripe webhook handler in the world. R15's 4 reason codes don't fit. Two paths:
  - **Option A (mechanical)**: add `// reason: stripe-event-discriminated-union` on each of the 18 cast lines. Quick but creates a de-facto 5th reason code without a SKILL.md update.
  - **Option B (rule-level, RECOMMENDED)**: promote a 5th R15 reason code (`stripe-event-discriminated-union`) with a verification recipe asserting each cast site sits inside a `switch (event.type)` block whose case literal maps to the cast target.
- **Proof test form**: Catalogue row 11 (snapshot the route map / structural grep) — site-count guard + switch-context guard.
- **Proof test path**: `workers/ecom-api/src/__denoise_proofs__/iter-030/F2-stripe-event-discriminated-union-cast.test.ts`
- **MCP evidence**: n/a (static structural finding).
- **Bead**: NEW (to be filed under Codex-lqvw4 — pattern-level, NOT 18 individual beads). Suggested title: `decision(R15): promote 5th carve-out 'stripe-event-discriminated-union' OR mechanically annotate 18 ecom-api Stripe webhook casts`. Priority P3 (no runtime hazard; rule-bookkeeping). Body: enumerates site list + recipe for verification.
- **Recurrence**: `types:as-cast-without-guard` increments by 1 (pattern-level — this counts as one finding for recurrence purposes, not 18).
- **Skill patch follow-up queued**: dispatcher decides Option A vs B; if B, the new R15 row text (under §1) gains a 5th bullet and the verification recipe expands. Logged in "Next-cycle prep".

### F3 — `types:as-cast-without-guard` — `err as Error` / `error as Error` in catch handlers (NEW)

- **Severity**: minor (observability gap on non-Error throws — `String(err)` would surface a debuggable representation; bare cast silently produces `undefined` for `.message`)
- **File:Line** (3 sites):
  - `workers/ecom-api/src/middleware/verify-signature.ts:131` — `const error = err as Error;` then `error.message`
  - `workers/ecom-api/src/utils/webhook-handler.ts:63` — `const err = error as Error;` then `err.message` (referenced in 4 obs.error/warn calls in surrounding 30 lines)
  - `workers/ecom-api/src/handlers/connect-webhook.ts:87` — `(err as Error).message` in a `.catch((err) => { ... })` arm
- **Description**: Per ES2022 + `useUnknownInCatchVariables`, `catch (err)` is `unknown`. All three sites narrow to `Error` via bare cast. R15's 4 reason codes don't apply. Canonical pattern (used in `workers/media-api/src/routes/transcoding.ts:64`, AND in `connect-webhook.ts:298` itself — 211 lines below the violation site at `:87`):
  ```ts
  err instanceof Error ? err.message : String(err)
  ```
  Three one-liner fixes per the proof body. The fact that `connect-webhook.ts` uses BOTH patterns within the same file is the hallmark of "good pattern lives in repo, drift in 3 sites" that denoise is designed to catch.
- **Proof test form**: Catalogue row 11 (custom lint rule + structural grep — 3 file-level assertions).
- **Proof test path**: `workers/ecom-api/src/__denoise_proofs__/iter-030/F3-error-as-error-narrowing-without-instanceof.test.ts`
- **MCP evidence**: n/a (static structural finding).
- **Bead**: NEW (to be filed under Codex-lqvw4). Suggested title: `fix(ecom-api): replace 3 unguarded 'err as Error' catch casts with instanceof Error fallback — R15`. Priority P3 (one PR, three one-liners; sibling pattern already in-repo).
- **Recurrence**: `types:as-cast-without-guard` increments by 1 (single finding bundling 3 sites, per past convention for tightly-clustered same-file patterns; cf. iter-006 F3 6-site `as KVNamespace` cluster filed as one bead Codex-lqvw4.13).

### F4 — `types:as-unknown-as` recurrence (Codex-lqvw4.10 still OPEN; HITS 2 → 3)

- **Severity**: minor (same as iter-005 F5; entry-point bindings are well-known, the cast is a missing-generic shortcut, not a security/correctness hazard at runtime)
- **File:Line** (2 sites — UNCHANGED from iter-005 F5):
  - `workers/auth/src/index.ts:135` — `c.env as unknown as AuthBindings` (inside `/api/test/fast-register` test-only handler)
  - `workers/media-api/src/index.ts:129` — `c.env as unknown as { ORPHAN_CLEANUP_DO: DurableObjectNamespace }` (inside `/internal/orphan-cleanup/*` HMAC-guarded handler)
- **Description**: Codex-lqvw4.10 has been OPEN since iter-005. Round 3 commits (`be00ddb1..253ffab4`) didn't touch these entry-points. Both sites use the missing-generic shortcut (`createWorker(...)` instead of `createWorker<AuthEnv>` / `createWorker<MediaEnv>`). Admin-api (`workers/admin-api/src/index.ts:58`) is the canonical good-pattern reference: `createWorker<AdminApiEnv>({ ... })` drops the cast entirely. Fix is mechanical:
  - **auth**: `createWorker(...)` → `createWorker<AuthEnv>(...)`; drop cast at `:135`.
  - **media-api**: declare `MediaBindings` + `MediaEnv` in `workers/media-api/src/types.ts` (mirroring `workers/auth/src/types.ts`); `createWorker(...)` → `createWorker<MediaEnv>(...)`; drop cast at `:129`.
- **Proof test form**: Catalogue row 11 (structural grep guard) + Catalogue row 3 (type-equality on `c.env` post-fix).
- **Proof test path**: `workers/auth/src/__denoise_proofs__/iter-030/F4-as-unknown-as-recurrence-codex-lqvw4-10.test.ts`
- **MCP evidence**: n/a (static structural finding).
- **Bead**: Codex-lqvw4.10 (existing — recurrence increment, no new bead).
- **Recurrence**: `types:as-unknown-as` increments hits=2 → 3. **🚨 R7 STANDARD 3-HIT THRESHOLD REACHED** (iter-005 + iter-006 + iter-030; cumulative cycle_density 5). R-rule promotion queued for iter-031 prep — proposed shape:

  > **R16 candidate**: `value as unknown as Foo` (the double-cast that bypasses TypeScript entirely) is forbidden in production code. Permitted only in:
  > - (a) **Type-test scaffolding** in `*.test.ts` files (`reason: type-test`)
  > - (b) **Pragmatic framework-interop bridges** where the third-party type system genuinely cannot express the relationship (`reason: framework-interop-cast`) — case-by-case review with a documented external-issue link demonstrating the limitation.
  >
  > Verified by a per-package grep listing every `as unknown as` cast NOT matching one of the reason codes.

  Under R16, the 2 worker entry-point sites would be VIOLATIONS (missing-generic shortcuts, not framework-interop limits) and the 2 known packages-side sites (`packages/test-utils/src/stripe-mock.ts:165`, `packages/worker-utils/src/procedure/multipart-procedure.ts:279` per iter-004 + iter-005 inventory) would qualify for `reason: framework-interop-cast`.

---

## R11 effectiveness verdict (Round 3 — workers scope)

| Round 3 deliverable | Promised outcome | iter-030 verdict |
|---|---|---|
| Tier 3.A `Logger` canonical | Zero inline `interface Logger` in workers/*/src/** | ✅ EFFECTIVE — only `import type { Logger } from '@codex/observability'` survives (e.g. `workers/organization-api/src/routes/members.ts:22`); `auth/src/email.ts:16` `interface SendParams` and `auth-config.ts:21` `interface AuthConfigOptions` are unrelated local config shapes (NOT Logger). |
| Tier 3.A `WaitUntilFn` canonical | Zero inline `WaitUntilFn` declarations in workers/*/src/** | ✅ EFFECTIVE — `organization-api/src/routes/{tiers,settings}.ts` both `import type { WaitUntilFn } from '@codex/cache'`. Codex-lqvw4.8 verified closed. |
| Tier 3.A `InvalidationLogger` canonical | Zero inline `InvalidationLogger` in workers | ✅ EFFECTIVE — grep returns 0 hits in workers/*/src/**. Codex-lqvw4.4 likely closed-in-spirit (workers no longer redeclare; the bead text references content + subscription packages — separate scope). |
| Tier 3.B CacheCtx narrow→cast | Zero `as CacheCtx` / `as KVNamespace` in workers | ✅ EFFECTIVE — `organization-api/src/routes/members.ts:42` defines a local `interface CacheCtx` cleanly typed with canonical `WaitUntilFn`; zero `as KVNamespace` casts in workers/*/src/**. Codex-lqvw4.9 verified closed. |
| Tier 4.A orgmanagement narrowing | Zero `ctx.organizationId as string` casts | ✅ EFFECTIVE — grep returns 0 hits across workers/*/src/**. Codex-lqvw4.11 P0 BLOCKER verified closed. |
| Tier 4.B RevenueSplit canonical | Out of scope (packages-side) | (deferred — covered by iter-028 verdict) |

**Net workers-scope verdict**: 5/5 R11-targeted closures landed clean. Codex-lqvw4.10 (the iter-005 F5 `as unknown as` finding) was NOT a Round 3 target — it remains open and is the F4 recurrence in this cycle.

---

## Effectiveness check — open lqvw4 children touching workers

| Bead | Status | Reason |
|---|---|---|
| Codex-lqvw4.1 | OPEN (P0) | SessionData/UserData duplicate — packages-side scope; not affected by workers cell |
| Codex-lqvw4.4 | OPEN (P3) | WaitUntilFn/InvalidationLogger duplicate in @codex/{content,subscription} — workers-side closed by Tier 3.A; bead body refers to packages-side surfaces |
| Codex-lqvw4.5 | OPEN (P3) | OrganizationMembership 3-site collision — packages-side; iter-028 F1 |
| Codex-lqvw4.6 | OPEN (P3) | TemplateScope/TemplateStatus/EmailCategory triple — packages-side (notifications) |
| Codex-lqvw4.7 | ✓ CLOSED | Inline Logger consolidated (Tier 3.A) |
| Codex-lqvw4.8 | ✓ CLOSED | Inline WaitUntilFn replaced with canonical import (Tier 3.A) |
| Codex-lqvw4.9 | ✓ CLOSED | CacheCtx narrow→cast eliminated (Tier 3.B) |
| Codex-lqvw4.10 | OPEN (P3) | F4 recurrence — `as unknown as` in 2 worker entry-points |
| Codex-lqvw4.11 | ✓ CLOSED | orgmanagement narrowing widened (Tier 4.A) |

---

## Summary

| Metric | Value |
|---|---|
| Total findings | 4 |
| Blocker | 0 |
| Major | 1 (F1) |
| Minor | 3 (F2, F3, F4) |
| Testability-bugs | 0 |
| Testability-bug rate | 0% (R8 NOT fired — well below 15%) |
| New beads to file | 3 (F1, F2, F3) — F4 increments existing Codex-lqvw4.10 |
| Recurrence increments | 5 (`types:as-cast-without-guard` +3 from F1+F2+F3; `types:as-unknown-as` +1 from F4; `types:type-duplicate-cross-package` +0 — workers verdict is fully effective) |
| Recurrence patterns CLOSED for workers | 5 (Logger, WaitUntilFn, InvalidationLogger workers-side, CacheCtx, orgmanagement narrowing) |
| Recurrence promotions queued | 1 (`types:as-unknown-as` → R16 candidate; R7 standard 3-hit threshold reached) |
| Fabrication check | 18/18 rows live |
| Workers typecheck | 7/7 PASS (no new TS errors introduced) |
| Proof tests written (this cycle) | 4 (F1, F2, F3, F4 — all `.skip()`) |

---

## Skill patches applied

- **None this cycle.** R5 forbids auto-applying CLAUDE.md regenerations; R-rule promotions are queued for next cycle's prep, not auto-applied.

Suggested for next cycle (deferred to dispatcher per R5):

1. **R-rule promotion (R16 candidate)**: `types:as-unknown-as` reached R7 standard 3-hit threshold this cycle (iter-005 + iter-006 + iter-030; cumulative cycle_density 5). Promote a sibling rule to R15 for the double-cast form, with 2 reason codes (`type-test`, `framework-interop-cast`). See F4 for proposed text. Citation comment: `<!-- R16 promoted from iter-030, fingerprint types:as-unknown-as (R7 standard 3-hit threshold; cumulative cycle_density 5 across iter-005 + iter-006 + iter-030) -->`.
2. **R15 carve-out widening** (decision required): F2 surfaces a Stripe-webhook discriminated-union pattern (18 sites) that is structurally safe but not covered by R15's 4 reason codes. Choose:
   - **Option A**: add inline `// reason: stripe-event-discriminated-union` on each cast (mechanical, 18-line PR).
   - **Option B**: promote a 5th R15 reason code (`stripe-event-discriminated-union`) with a verification recipe asserting each cast site sits inside a `switch (event.type)` block whose case literal maps to the cast target. RECOMMENDED — extends the rule cleanly to a canonical SDK-shape limitation.
3. `recurrence.json`: mark `types:as-cast-without-guard` `last_seen: 2026-04-26` (already there), add `iter-030` to `iters[]`, increment `hits` 3 → 4 (or 4 → 7 if counting per-finding rather than per-iter — recommendation: count per-iter to keep R7 thresholds stable). Mark `types:as-unknown-as` `promoted: true` and `rule_id: "R16"` once promotion lands; until then, leave `promoted: false` with a queued flag.
4. `recurrence.json`: mark workers-scope R11 closures with `closed_via: "Round 3 Tier 3.A/3.B/4.A (commits 7440fe95 + aff6b2ac + 6e8438cc)"` for traceability — but the fingerprint `types:type-duplicate-cross-package` itself remains active because packages-scope sites (lqvw4.1, .4, .5, .6) keep the recurrence count climbing.
5. **No CLAUDE.md regen needed** — workers/*/CLAUDE.md and the per-worker CLAUDE.md files all describe current behaviour; this cycle's findings are about cast hygiene, not documented API surfaces.

---

## Next-cycle prep

- **R11 effectiveness verdict (workers scope)**: ✅ FULLY EFFECTIVE. 5/5 Round 3 R11 deliverables for workers landed clean (Logger, WaitUntilFn, InvalidationLogger, CacheCtx, orgmanagement narrowing). The remaining R11-adjacent open beads (lqvw4.1, .4, .5, .6) are all packages-side scope. No next-cycle action required for the workers cell to validate R11 further.
- **R15 first audit verdict**: 23 `as <TypeName>` cast hits inventoried across `workers/*/src/**` (excluding tests + denoise proofs); after filtering false-positives (1 import alias rename + 1 comment match) and `as unknown as` (separate fingerprint, 2 hits → F4), **20 substantive R15 candidates** remain — of which **18 carry the `stripe-event-discriminated-union` shape (F2 candidate carve-out), 1 is the `MembershipLookupResponse['role']` narrowing (F1), and 1 is split across F3 (3 catch-error casts, counted as 1 finding)**. So in net: **3 NEW R15 violations + 1 carve-out decision needed**. NOT bad for a first audit — the rule's coverage is strong; the 18-site Stripe cluster is the one shape that escapes its current text.
- **R7 promotion queued**: `types:as-unknown-as` → R16 candidate. Two open sites (Codex-lqvw4.10) provide the immediate cleanup target post-promotion.
- **F1 fix priority**: P2 — boundary-crossing into hooks.ts subdomain routing. Bundle into a short PR with a `@codex/validation` `orgMemberRoleSchema` export + the parse replacement.
- **F2 fix priority**: P3 — pure rule-bookkeeping decision. Defer to dispatcher.
- **F3 fix priority**: P3 — three one-liners, sibling pattern already in-repo (`connect-webhook.ts:298`). Quick PR.
- **F4 fix priority**: P3 — 2 entry-point fixes, mechanical. Open since iter-005; would close R16's first violations once R16 promotes.
- **Stop-criterion countdown**: this cycle produced 4 findings (3 new beads + 1 increment) — under §4 rule, the types × workers cell **resets to 0/3** (any non-zero finding count resets the countdown). Prior state was 1/3 from iter-017's clean run.
- **Suggested next cell** by `master.md` `(open_findings DESC, last_run ASC)` after this cycle commits:
  - `simplification × packages` (last_run iter-022, 6 open findings, no Round 3 effectiveness check yet) — phase priority puts simplification last among the 4 phases, but the open-findings count is the dominant tie-break.
  - OR `performance × workers` (last_run iter-020, 5 open findings, Round 3 R12 + R13 partially verified at packages but not yet at workers).
  - Recommend `performance × workers` for iter-031 — provides the final R12/R13 effectiveness verdict at the workers scope, plus `types × workers` is the ONLY cell completing its Round 3 effectiveness scoreboard this cycle (R11 fully closed). Rebalance toward the cell where the most recent R-rule (R12, R13) hasn't been audited.
