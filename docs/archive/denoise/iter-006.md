# Iteration 006 — types × apps/web

- **Cell**: types × apps/web
- **Date**: 2026-04-25
- **Mode**: delta
- **Since**: 14 days ago
- **Files churned**: 503 in `apps/web/src/**`; ~50 types-relevant; ~30 walked.
- **Agent**: agents/audit-web.md (types branch)
- **Fallow JSON**: `/tmp/denoise-iter-006-fallow.json` (inherited)
- **Typecheck baseline**: `/tmp/denoise-iter-006-typecheck-baseline.log`
  (apps/web typecheck PASSED; pre-existing failures only in
  `@codex/worker-utils` per iter-005 — not caused by this cycle)
- **HEAD**: `361bdc78`

## Skill patches applied (iter-006 prep)

R11 already applied to local SKILL.md §1 by the dispatching skill at
the start of iter-006 (citation:
`<!-- R11 promoted from iter-005, fingerprint types:type-duplicate-cross-package (endemic 2-hit early promotion) -->`).
Audit agent did not patch the skill in this cycle.

## Fabrication check

13/13 cited symbols from refs 02 + 05 grep-verified live in apps/web
scope. NO new doc-rot beads filed. (Iter-001/002 doc-rot beads
Codex-ttavz.3-6, .10-11 remain open against refs 01 + 06 + 07 — not
re-filed.) Notable confirmations: `expectTypeOf` from vitest 4.0.2
usable in `__denoise_proofs__/`; `import type` discipline upheld for
all 13 `@codex/shared-types` imports in apps/web; `m.foo({...})` calls
sampled (30) and message keys present in `messages/en.json`;
`localStorageCollectionOptions` (3 collections) all browser-guarded.

## Findings

### F1 — `types:as-unknown-as` (subscription period-end wire-shape cast)

- **Severity**: major (silent type-bypass, two production sites)
- **File:Line**:
  - `apps/web/src/routes/(platform)/account/subscriptions/+page.svelte:298`
  - `apps/web/src/routes/(platform)/account/subscriptions/+page.svelte:310`
- **Description**: `UserOrgSubscription extends Subscription` (Drizzle
  row, `currentPeriodEnd: Date`). Over JSON, the field serialises to
  string. The static type says Date; runtime says string. Both sites
  cast `sub.currentPeriodEnd as unknown as string` to `formatDate(...)`
  — bypassing the type system entirely.

  Compare to `Spotlight.svelte:48` and `lib/collections/subscription.ts:130`
  which handle the same boundary correctly via `string | Date | null`
  prop type + runtime normalisation.
- **Fix**: declare a `DateAsString<T>` helper or per-shape wire variants
  in `lib/types.ts`; ascribe `request<UserOrgSubscriptionWire[]>` in
  api.ts; drop both casts.
- **Proof**: `__denoise_proofs__/iter-006/F1-subscription-period-end-wire-shape.test.ts`
  (Catalogue row 3, expectTypeOf assertion)
- **MCP**: `mcp__ide__getDiagnostics`
- **Recurrence**: `types:as-unknown-as` hit #2 (after iter-005 hit #1).
  Plus F7 + F8 same-fingerprint, this cycle has 3 distinct sites.
- **Bead**: filed at step 7

### F2 — `types:as-cast-without-guard` (apps/web client type drifts from worker)

- **Severity**: major (silent contract drift between SvelteKit server
  load and worker route response)
- **File:Line**:
  - `apps/web/src/routes/_org/[slug]/+layout.server.ts:43-69`
    (handwritten cast `org as { ... heroLayout?; enableSubscriptions? }`)
  - `apps/web/src/lib/types.ts:195-212` (`OrganizationData` declaration —
    MISSING `heroLayout` and `enableSubscriptions`)
  - `workers/organization-api/src/routes/organizations.ts:298,337` (server
    DOES return both fields)
- **Description**: `api.org.getPublicInfo(slug)` is declared to return
  `OrganizationData`, but the worker actually returns
  `{ ..., heroLayout, enableSubscriptions }`. The layout server load
  papers over this with an inline `org as { ... wider shape ... }`
  cast at lines 43-69.

  **Concrete risk**: the auth-fallback branch (lines 116-128) does NOT
  include `heroLayout`/`enableSubscriptions`. Consumers reading
  `data.org.heroLayout` (`_org/[slug]/+layout.svelte:354,420,421`)
  silently get `undefined` and fall back to `'default'` — regardless
  of what the auth API returns. The `?? 'default'` mask hides the
  contract violation.
- **Fix**: add the two fields to `OrganizationData`; drop the inline
  cast; make the auth-fallback branch return the same shape; ideally
  extract `PublicOrganizationInfo` to `@codex/shared-types`.
- **Proof**: `__denoise_proofs__/iter-006/F2-org-public-info-shape-drift.test.ts`
- **MCP**: `mcp__ide__getDiagnostics`
- **Recurrence**: `types:as-cast-without-guard` hit #2 (after iter-005
  F4 Codex-lqvw4.9).
- **Bead**: filed at step 7

### F3 — `types:redundant-cast-after-narrow` (`as KVNamespace` ×6)

- **Severity**: minor (no immediate runtime risk; footgun for future drift)
- **File:Line** (all 6):
  - `apps/web/src/lib/server/cache.ts:14`
  - `apps/web/src/routes/(platform)/account/notifications/+page.server.ts:23`
  - `apps/web/src/routes/_org/[slug]/+layout.server.ts:180`
  - `apps/web/src/routes/(platform)/+layout.server.ts:17`
  - `apps/web/src/routes/(platform)/account/+layout.server.ts:26`
  - `apps/web/src/routes/_org/[slug]/(space)/explore/+page.server.ts:155`
- **Description**: `App.Platform.env.CACHE_KV` is declared as
  `KVNamespace | undefined` in `apps/web/src/app.d.ts:40`. After a
  truthy guard like `if (!platform?.env?.CACHE_KV) return;`, TS narrows
  it to `KVNamespace` — the `as KVNamespace` cast is redundant.

  If a future change relaxes the type to `unknown` (e.g., during a
  refactor mirroring `App.Platform.env` onto `@codex/shared-types`
  `Bindings`), the redundant cast still compiles silently. Same
  pattern family as iter-005 F4 (CacheCtx narrow→cast in workers).

  Deeper exposure: `App.Platform.env` in `app.d.ts` is hand-rolled and
  diverges from canonical `Bindings` (~15 fields vs ~100+). See
  "Findings deferred" §.
- **Fix**: drop all 6 casts (truthy guard already narrows).
- **Proof**: `__denoise_proofs__/iter-006/F3-redundant-kvnamespace-cast.test.ts`
  (Catalogue row 12, grep guard)
- **MCP**: `mcp__ide__getDiagnostics`
- **Recurrence**: NEW fingerprint `types:redundant-cast-after-narrow`
  (hits=1, cycle_density=6).
- **Bead**: filed at step 7

### F4 — `types:any-explicit` (`result: any` in form-enhance ×2)

- **Severity**: minor (low blast radius; surrounding `result.type === 'success'`
  guard does narrow at runtime, but the annotation forfeits IDE assistance
  and lets `result.data?.sessionUrl` be any shape)
- **File:Line**:
  - `apps/web/src/routes/_org/[slug]/(space)/content/[contentSlug]/+page.svelte:143`
  - `apps/web/src/routes/_creators/[username]/content/[contentSlug]/+page.svelte:130`
- **Description**: SvelteKit's `enhance` callback is typed via
  `SubmitFunction` from `@sveltejs/kit`. The hand-rolled
  `{ result: any; update: () => Promise<void> }` annotation loses
  ALL type-narrowing from `ActionResult`'s discriminated union
  (`type: 'success' | 'failure' | 'redirect' | 'error'` with
  branch-specific `data` / `error` fields).

  If the server's purchase action ever renames `sessionUrl` →
  `checkoutUrl` or drops `data`, the client silently breaks at
  `window.location.href = result.data.sessionUrl`. No `SubmitFunction`
  use found anywhere in apps/web (grep returned 0).
- **Fix**: import `SubmitFunction` from `@sveltejs/kit` and ascribe
  the `handlePurchase` function with it; drop the inline annotation.
- **Proof**: `__denoise_proofs__/iter-006/F4-result-any-in-form-enhance.test.ts`
- **MCP**: `mcp__ide__getDiagnostics` (+ optional `svelte-autofixer`)
- **Recurrence**: `types:any-explicit` (ref 02 §7 row 1) — first
  apps/web filing; hits=1.
- **Bead**: filed at step 7

### F5 — `types:type-duplicate-cross-package` (CreatorCard same-package dup)

- **Severity**: minor (within-package, not strictly R11; same fingerprint family)
- **File:Line**:
  - `apps/web/src/lib/components/ui/CreatorCard/types.ts:11` (canonical `SocialLinks`)
  - `apps/web/src/lib/components/ui/CreatorCard/types.ts:18` (canonical `ContentItem`)
  - `apps/web/src/lib/components/ui/CreatorCard/CreatorCard.svelte:34` (inline dup of `SocialLinks`)
  - `apps/web/src/lib/components/ui/CreatorCard/CreatorCard.svelte:41` (inline dup of `ContentItem`)
- **Description**: `types.ts` next door to the component already exports
  both interfaces (with a comment explaining why types live in a separate
  file). The component declares them inline anyway. Shapes are
  byte-equivalent.

  R11 targets cross-package duplicates; this is within-package. Lower
  blast radius but same drift risk: a contributor adding a field to
  `types.ts` `SocialLinks` won't know to update the inline copy.
- **Fix**: replace inline declarations with
  `import type { SocialLinks, ContentItem } from './types'`.
- **Proof**: `__denoise_proofs__/iter-006/F5-creatorcard-types-duplicate.test.ts`
- **MCP**: `mcp__ide__getDiagnostics`
- **Recurrence**: increment of `types:type-duplicate-cross-package`
  (already promoted to R11). Cycle-density: iter-006 = 3 sites
  (this F5 + F6).
- **Bead**: filed at step 7

### F6 — `types:type-duplicate-cross-package` (`SubscriptionContext` ×3 in apps/web)

- **Severity**: major (the 3rd declaration is a NAME COLLISION with a
  STRUCTURALLY DIFFERENT shape — clear future bug source)
- **File:Line**:
  - `apps/web/src/lib/server/content-detail.ts:88` (canonical, full
    shape: 5 fields including `currentSubscription` and `tiers`)
  - `apps/web/src/lib/utils/subscription-context.svelte.ts:34`
    (`ResolvedSubscriptionContext` — different name, near-equivalent
    shape: 3 fields + optional `tiers`)
  - `apps/web/src/lib/utils/access-context.svelte.ts:18`
    (`SubscriptionContext` — SAME NAME as canonical, structurally
    DIFFERENT: 1 field, just `tiers`)
- **Description**: Site #2 is documented ("declared locally to avoid
  importing from `$lib/server/*`"). But the fix is solvable: move the
  canonical shape to `lib/types.ts` (client-safe) and import from both.

  Site #3 is the worst: same name as canonical but a 1-field shape.
  Future imports could silently target the wrong type. Rename to
  `OrgTiersContext` — it's not a "subscription context", it's a
  tier list.
- **Fix**: move canonical to `lib/types.ts`; replace #2 with import
  + `Pick<...>` if narrower shape needed; rename #3 to `OrgTiersContext`.
- **Proof**: `__denoise_proofs__/iter-006/F6-subscription-context-duplicate.test.ts`
  (Catalogue row 12, grep guard)
- **MCP**: `mcp__ide__getDiagnostics`
- **Recurrence**: increment of `types:type-duplicate-cross-package`
  (R11). Cycle-internal #2 of #2 with F5.
- **Bead**: filed at step 7

### F7 — `types:as-unknown-as` (`org.remote.ts:303` query return forced)

- **Severity**: minor (single site; cast hides why `query()` is callable)
- **File:Line**: `apps/web/src/lib/remote/org.remote.ts:303`
- **Description**: `query()` from `$app/server` does not return a bare
  `() => Promise<T>` — it returns a `Query<T>` with `.refresh()` /
  `.subscribe()` methods (and is callable as shorthand for `.fn()`).
  The cast forcibly re-asserts the return type as a plain function,
  hiding that mechanism. Same fingerprint family as iter-005 F5.
- **Fix**: let TS infer the return type, OR use the explicit overload
  `query<OrganizationWithRole[] | null>(async () => { ... })`.
- **Proof**: `__denoise_proofs__/iter-006/F7-org-remote-as-unknown-as.test.ts`
- **MCP**: `mcp__ide__getDiagnostics`
- **Recurrence**: increment of `types:as-unknown-as`.
- **Bead**: filed at step 7

### F8 — `types:as-unknown-as` (`ContentDetailView.svelte:551` content shape)

- **Severity**: minor (well-commented; pattern signal more than blast-radius)
- **File:Line**: `apps/web/src/lib/components/content/ContentDetailView.svelte:551`
- **Description**: `content as unknown as { publishedAt; createdAt }`
  to extract two fields the static prop interface doesn't surface.
  Fields exist at runtime — the prop interface just doesn't declare them.
- **Fix**: declare the fields on `Props.content` directly, like
  `Spotlight.svelte:48-50` does (`string | Date | null`).
- **Proof**: `__denoise_proofs__/iter-006/F8-content-detail-view-as-unknown-as.test.ts`
- **MCP**: `mcp__ide__getDiagnostics`
- **Recurrence**: increment of `types:as-unknown-as`.
- **Bead**: filed at step 7

## Findings deferred (noted, not filed)

- **`types:any-explicit` in `lib/collections/use-live-query-ssr.ts`** —
  3 `// biome-ignore lint/suspicious/noExplicitAny:` at lines 66, 111,
  115. Each documents a deliberate any (overload return-type variance,
  server-side undefined collection sentinel). Pragmatic, well-documented
  exceptions. NOT filed.

- **`ASSETS?: any` in app.d.ts:36** — eslint-disable comment present.
  SvelteKit/Cloudflare Pages generates `ASSETS` without a stable type.
  Pragmatic ambient type. NOT filed.

- **`types:type-duplicate-cross-package`: app.d.ts `App.Platform.env`
  vs `@codex/shared-types` `Bindings`** — apps/web declares its own
  ~15-field shape divergent from canonical Bindings (~100+). This IS
  a R11-strict cross-package duplicate, but: the fix is large (replace
  the entire shape with `import type { Bindings } from '@codex/shared-types'`);
  shared-types CLAUDE.md says "NEVER import from this package in the
  SvelteKit web app at runtime" (`import type` would be allowed but
  the rule's intent argues caution); risk of breaking SvelteKit's
  ambient `App` namespace declaration. **DEFERRED** — recommend filing
  as a separate /backend-dev epic-level task. Track for recurrence.

- **`feed-types.ts ContentItem`** — uses `Awaited<ReturnType<typeof
  getPublicContent>>['items'][number]` to derive type. NOT a finding;
  this is the CORRECT pattern.

- **`web:streamed-promise-no-catch`** — every streamed promise in
  scoped server loaders has `.catch()`. No new violations.

- **TanStack DB collection type drift** — `progressCollection`,
  `libraryCollection`, `subscriptionCollection` all have local `*Item`
  types (`PlaybackProgress`, `LibraryItem`, `SubscriptionItem`) distinct
  from server response shapes. They normalise wire data at the boundary
  (correct pattern). NOT a duplicate.

- **`web:remote-fn-no-auth-check`** — every `*.remote.ts` uses
  `getRequestEvent()` and delegates to `createServerApi()` which
  forwards session cookies. Out of scope for this types cell anyway.

- **Paraglide message shape drift** — sampled 30 `m.foo({...})` calls;
  all keys present in `messages/en.json`. Clean.

- **`workers:waituntil-no-catch` 3rd hit** — searched all `waitUntil(`
  in apps/web. Only sites are `lib/server/brand-cache.ts:75` and `:90`,
  both already filed in iter-003 F5 (Codex-ttavz.16). **NO new instance.**
  Standard 3-hit R7 promotion does NOT fire this cycle. Recurrence
  remains at hits=2.

## Summary

| Metric | Value |
|---|---|
| Total findings | 8 |
| Blocker | 0 |
| Major | 3 (F1 wire-shape cast, F2 client/server type drift, F6 same-name 3-decl) |
| Minor | 5 (F3 ×6, F4 ×2, F5 ×2, F7 ×1, F8 ×1) |
| Testability-bugs | 0 |
| Testability-bug rate | 0% (R8 does NOT fire) |
| Beads filed | 0 — pending step 7 |
| Recurrence promotions queued | 0 (R11 already applied at start) |
| Proof tests written | 8 |
| Fabrication check | 13/13 cited symbols live; 0 stale |

R2 catalogue walk: NOT triggered — every finding mapped to a Catalogue
row directly.

| # | Finding | Catalogue row |
|---|---|---|
| F1 | UserOrgSubscription wire-shape cast | Row 3 — type-equality |
| F2 | OrganizationData drift from worker | Row 3 — type-equality |
| F3 | Redundant `as KVNamespace` ×6 | Row 12 — grep guard |
| F4 | `result: any` in form-enhance | Row 3 — type-equality |
| F5 | CreatorCard same-package dup | Row 3 + Row 12 |
| F6 | SubscriptionContext ×3 declarations | Row 12 — grep guard |
| F7 | `org.remote.ts` query force-cast | Row 12 — grep guard |
| F8 | ContentDetailView content cast | Row 12 — grep guard |

R8 does not fire (rate < 15%).

R7 promotions: R11 already applied at cycle start. No new promotion
queued. `types:as-unknown-as` rises hits=1 → hits=2 (cycle-density: 3
sites in iter-006). `types:as-cast-without-guard` rises hits=1 → hits=2
(F2 + F3 contribute, normalised to 1). One more cycle increment of
either triggers standard 3-hit R7 promotion.

**`workers:waituntil-no-catch`**: NO 3rd instance found in apps/web.
Recurrence remains at hits=2 of 3. Standard R7 promotion does NOT fire.

**R11 violations explicit flag**: F2 is closest to R11-strict (apps/web
client type drifts from worker server response shape) — but the duplicate
is within apps/web (apps/web declares `OrganizationData`; worker declares
the actual response). It's a sibling problem to R11 — client/server
contract drift, not package/package. F5 + F6 are within-package
duplicates, fingerprint-related but not strictly R11. **No strict R11
cross-package violation surfaced this cycle in apps/web.**

## MCP evidence summary

Per §3 matrix, `types × apps/web` required MCP is
`mcp__ide__getDiagnostics`. Optional: `mcp__svelte__svelte-autofixer`.

8 static findings backed by Vitest `expectTypeOf` + grep proof tests in
`apps/web/src/__denoise_proofs__/iter-006/`. Dispatching skill at step
6 will:

1. Open each proof test file
2. Capture `mcp__ide__getDiagnostics` BEFORE removing `.skip()` (clean —
   TS doesn't diagnose inside `describe.skip`)
3. Remove `.skip()` in scratch branch — capture diagnostics AGAIN as
   the "red on main" snapshot
4. Attach diagnostic output as evidence to each bead

For F5/F6/F7/F8, the proof test is a grep assertion on file content —
the un-skipped test runs as plain Vitest and asserts literal patterns
absent. Pre-fix red, post-fix green.

For F4, `mcp__svelte__svelte-autofixer` recommended on the two
`+page.svelte` files as a follow-up — the autofixer can identify
`SubmitFunction`-shaped callbacks and surface proper typing.

## Next-cycle prep

- **R11 status**: applied. No further promotion action needed.

- **Recurrence ledger updates** for `recurrence.json`:
  - `types:type-duplicate-cross-package`: hits=3, iters=[004,005,006],
    cycle_density={004:6,005:7,006:3}, promoted=true, rule_id=R11
  - `types:as-unknown-as`: hits=2, iters=[005,006], cycle_density={005:2,006:3}
  - `types:as-cast-without-guard`: hits=2, iters=[005,006], cycle_density={005:5,006:7}
  - `types:any-explicit`: hits=1, iters=[006], cycle_density={006:2} — NEW filing
  - `types:redundant-cast-after-narrow`: hits=1, iters=[006], cycle_density={006:6} — NEW fingerprint

- **Carry-forward fingerprint watches**:
  - `workers:waituntil-no-catch` — still hits=2 of 3 (NOT incremented)
  - `types:as-unknown-as`, `types:as-cast-without-guard` — both hits=2
    of 3; one more cycle increment triggers R7 standard 3-hit promotion
  - `web:auth-remote-broken-endpoint`, `web:auth-form-orphan-rpc-surface`,
    `security:missing-hsts` (iter-003) — still hits=1
  - `packages:identifier-no-shape-validation` (iter-001 F2) — hits=1
  - `security:public-route-no-ratelimit` (iter-002 F2) — hits=1

- **Doc-rot fixes carry-forward**: Codex-ttavz.3-6, .10-11 remain open.
  When they land, re-run cycle-0 fabrication checks on affected cells.

- **Endemic-pattern watch validation**: with R11 now applied and a 3rd
  cycle filing this cycle (apps/web), the pattern is confirmed endemic
  across all three scopes (packages, workers, apps/web). Next types-
  focused cycle should capture whether R11 is effective at preventing
  NEW instances vs only surfacing existing ones.

- **F1 fix entanglement**: F1 touches `lib/types.ts` (add wire-shape
  helper) AND `lib/server/api.ts` (request<…Wire[]>) AND
  `(platform)/account/subscriptions/+page.svelte` (drop casts).
  Single atomic PR.

- **F2 fix entanglement**: edits `lib/types.ts` (extend `OrganizationData`)
  AND `_org/[slug]/+layout.server.ts` (drop inline cast, fix auth-fallback).
  Independent.

- **F3-F8 fix entanglement**: each independent file edit; can land in
  separate PRs.

- **Stop criterion (§4)**: FIRST cycle for `types × apps/web`.
  Countdown 3 → 3 (this cycle produced findings).

- **Suggested next cell**: per master.md priority order,
  `simplification × packages` (oldest implemented cell never run; iter-001
  ran security × packages so simplification × packages is overdue).
  Alternative: `performance × apps/web` (heaviest churn surface;
  Lighthouse + bundle-size baseline due). Tie-break (open_findings DESC,
  last_run ASC, phase priority security>types>performance>simplification)
  → `simplification × packages` first.

- **Anti-pattern row addition (ref 02 §7 row 13)**: consider adding
  `types:redundant-cast-after-narrow` even at hits=1 (cycle_density=6
  is high enough to justify pre-emptive documentation).
