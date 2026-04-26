# Iteration 012 — simplification × apps/web

- **Cell**: simplification × apps/web (THE LAST UNTOUCHED CELL — Round 1 closes after this cycle)
- **Date**: 2026-04-25
- **Mode**: delta
- **Since**: 14 days ago (HEAD = `946529d7` iter-011 commit)
- **Files churned**: 515 across `apps/web/src/**`; ~50 simplification-relevant
- **Agent**: agents/audit-web.md (read-only audit subagent)
- **Fallow JSON**: `/tmp/denoise-iter-012-fallow.json` (4538 lines, pre-captured)
- **Typecheck baseline**: `/tmp/denoise-iter-012-typecheck-baseline.log` (481 lines, pre-captured)
- **jscpd output**: `/tmp/denoise-iter-012-jscpd.json/jscpd-report.json` — 12.38% clone rate (4644 duplicated lines / 37501 total), 289 clone clusters, exceeds the 5% threshold

---

## Cycle preamble

**Round 1 closes here.** All 12 cells of the matrix have now had a baseline cycle:

| Cell | Iter |
|---|---|
| security × packages | iter-001 |
| security × workers | iter-002 |
| security × apps/web | iter-003 |
| types × packages | iter-004 |
| types × workers | iter-005 |
| types × apps/web | iter-006 |
| performance × packages | iter-007 |
| performance × workers | iter-008 |
| simplification × packages | iter-009 |
| performance × apps/web | iter-010 |
| simplification × workers | iter-011 |
| **simplification × apps/web** | **iter-012 (THIS)** |

After iter-012 the loop enters Round 2 / drift-detection mode. Endemic-density signals from Round 1 (R9–R14 promotions) become baseline.

**R14 already applied** at SKILL.md §1 (line 65, citation comment line 74) before this cycle began — verified by grep. No additional rule promotions queued.

---

## Fabrication check

8 references walked (refs 03 + 05 anti-pattern rows + cited helper symbols):

| Ref | Row | Cited symbol/file | Status |
|---|---|---|---|
| 03 §1 | `simplification:dup-try-catch-boilerplate` | `withServiceErrors()` wrapper | placeholder example (no live cite) |
| 03 §2 | `FooStrategy` | illustrative | placeholder |
| 03 §3 | `User.userName` | illustrative | placeholder |
| 03 §5 | `class FooFactory` | illustrative | placeholder |
| 03 §1 | `scripts/denoise/jscpd-budget.ts` | helper | **live** |
| 03 §2 | `scripts/denoise/find-consumers.ts` | helper | **live** |
| 05 §4 | `loadFromServer()` reconciliation fn | citation | **STALE** → see F8 |
| 05 §4 | `localStorageCollectionOptions` | TanStack DB | **live** (`apps/web/src/lib/collections/progress.ts:55`) |
| 05 §4 | `initProgressSync` | function | **live** (`progress-sync.ts:118`) |
| 05 §4 | `hydrateIfNeeded` | function | **live** (`hydration.ts:99`) |
| 05 §4 | `depends('cache:versions')` | call site | **live** (`(platform)/+layout.server.ts:12`) |
| 05 §5 | `buildContentUrl` | export | **live** (`subdomain.ts:160`) |
| 05 §5 | `extractSubdomain` | export | **live** (`subdomain.ts:21`) |
| 05 §5 | `hooks.ts reroute` | export | **live** (`hooks.ts:38`) |
| 05 §6 | studio `ssr = false` | const | **live** (`studio/+layout.ts:10`) |
| 05 §7 | `messages/en.json` | path | **live** (`apps/web/messages/en.json`) |

**Result: 14 of 15 cited symbols live; 1 stale → filed as F8 (denoise:doc-rot:05-domain-web).**

---

## Findings

### F1 — simplification:dup-content-item-shape

- **Severity**: major
- **File:Line**: `apps/web/src/lib/components/content/DiscoverMix.svelte:27-42`, `AudioWall.svelte:21-36`, `ArticleEditorial.svelte:30-45`, `Spotlight.svelte:31-67`
- **Description**: Four landing-section components each redeclare an inline `*Item` interface (`MixItem`, `AudioItem`, `ArticleItem`, `SpotlightItem`) that is structurally identical to the canonical `ContentItem` derived from `getPublicContent` in `routes/_org/[slug]/(space)/feed-types.ts`. The parent route hands them `section.items: ContentItem[]` and they each redeclare 9 of the same 11 fields (id/title/slug/description/thumbnailUrl/contentType/mediaItem/creator/priceCents/accessType/category). Drift risk: a wire-shape change to one component's expectations silently bypasses the others.
- **Proof test form**: Duplication count → programmatic assertion (clone-count regex over `lib/components/content/`)
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-012/F1-dup-content-item-shape.test.ts`
- **Catalogue walk**: parity (n/a — structural not behavioural), jscpd (covered partially), **consumer-count (chosen)**, dep-graph (n/a)
- **MCP evidence**: n/a (static analysis; no MCPs required for simplification cells)
- **Bead**: TBD (filed by parent skill at step 7)
- **Recurrence note**: SIBLING SHAPE of `simplification:dup-paginated-list-shape` (iter-009 F3, cycle_density=6, watched for 2-hit early-promotion). Same family as R14's `simplification:duplicate-utility-helper`. Fingerprint is NEW — flag for recurrence ledger.

### F2 — simplification:dup-component-shape

- **Severity**: major
- **File:Line**: `apps/web/src/lib/components/layout/SidebarRail/SidebarRailItem.svelte` (120 lines) + `apps/web/src/lib/components/layout/StudioSidebar/StudioSidebarItem.svelte` (215 lines)
- **Description**: Two rail-item components implement the SAME UI primitive (Melt UI tooltip + staggered label reveal + active/hover states + identical CSS color-mix rules). StudioSidebarItem.svelte:50-52 contains the explicit comment "Matches the SidebarRailItem reference pattern exactly" — direct admission of dup. The diff reduces to: badge slot + loading modifier + class-name namespace. Right shape is composition (`<RailItemBase> <NavBadge /></RailItemBase>` or a snippet).
- **Proof test form**: Duplication count → programmatic assertion (clone-count regex over the two files for createTooltip + staggered-label CSS)
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-012/F2-dup-sidebar-rail-item.test.ts`
- **Catalogue walk**: parity (refactor parity tests on the two consumers — possible but heavy), jscpd (clone count works), **clone-count + comment-asserts (chosen)**, consumer-count (n/a), dep-graph (n/a)
- **MCP evidence**: n/a (could optionally Playwright the sidebar interaction parity, but the structural assertion is sufficient)
- **Bead**: TBD
- **Recurrence note**: NEW fingerprint `simplification:dup-component-shape` (the apps/web analogue of the workers `dup-procedure-context-builder` shape). Watch for recurrence in the next apps/web simplification cycle.

### F3 — simplification:dup-auth-derive-logic

- **Severity**: major
- **File:Line**: `apps/web/src/lib/components/layout/Header/UserMenu.svelte:24-43`, `apps/web/src/lib/components/layout/Header/MobileNav.svelte:20-21` (partial), `apps/web/src/lib/components/layout/MobileNav/MobileBottomSheet.svelte:33-50`
- **Description**: STUDIO_ROLES set + canAccessStudio derivation + currentSubdomain + studioHref logic + getInitials helper inlined verbatim in 3 sibling layout components. MobileBottomSheet.svelte:32 explicitly comments "Auth logic (reused from UserMenu)" — the dup is acknowledged. Should live in `$lib/utils/auth-context.svelte.ts` or a snippet. Drift: a future role addition to `STUDIO_ROLES` or change to studioHref logic silently diverges between desktop dropdown and mobile bottom sheet.
- **Proof test form**: Duplication count → programmatic assertion (regex over the three files for the `new Set([AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN, AUTH_ROLES.PLATFORM_OWNER])` literal)
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-012/F3-dup-auth-derive-logic.test.ts`
- **Catalogue walk**: parity (n/a — pure-derivation logic), **jscpd-style clone count (chosen)**, consumer-count (n/a), dep-graph (n/a)
- **MCP evidence**: n/a
- **Bead**: TBD
- **Recurrence note**: NEW fingerprint `simplification:dup-auth-derive-logic`. Sibling family of R14 (helper-belongs-in-shared-utils).

### F4 — simplification:dup-zod-schema-fragment

- **Severity**: major
- **File:Line**: `apps/web/src/lib/remote/content.remote.ts:396-428` (`createContentFormSchema`) + `:559-592` (`updateContentFormSchema`)
- **Description**: Two Zod schemas declared with full `z.object({ ... })` literals are identical except `updateContentFormSchema` adds `contentId: z.string().uuid()` at the top. The 16 shared fields include non-trivial `transform` rules (price string→cents, tags JSON.parse pipe) — duplicated verbatim. Standard Zod fix is `.extend({ contentId: ... })`.
- **Proof test form**: Duplication count → programmatic assertion (`.match` count of `z.string().transform((v) => { const parsed = parseFloat`)
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-012/F4-dup-content-form-schema.test.ts`
- **Catalogue walk**: parity (after .extend, the resolved schemas should produce IDENTICAL parsed output for shared fields — could write a parity test, but the structural assertion is more direct), **jscpd-style count (chosen)**, consumer-count (n/a), dep-graph (n/a)
- **MCP evidence**: n/a
- **Bead**: TBD
- **Recurrence note**: First filing of `simplification:dup-zod-schema-fragment` from ref 03 §1 row in apps/web (was anti-pattern row in references; now hits=1 in the ledger).

### F5 — simplification:dup-checkout-success-loader

- **Severity**: major
- **File:Line**: `apps/web/src/routes/_org/[slug]/(space)/checkout/success/+page.server.ts`, `subscription/success/+page.server.ts`, `_creators/checkout/success/+page.server.ts`
- **Description**: Three Stripe-success loaders share an identical skeleton (cache header, depends() token, locals.user redirect, sessionId param, parent() org resolve, api.{checkout,subscription}.verify with try/catch fallback). jscpd flagged 2 clusters: org/checkout vs org/subscription (15 lines/110 tokens) and org/checkout vs _creators/checkout (11 lines). Right shape is `loadStripeVerification({ event, kind, extra })` in `$lib/server/stripe-verify.ts`. Webhook-race retry semantics live here — drift between the three has caused real issues (Codex-twzso lineage cited "subscription/success is the counterpart to checkout/success" — counterpart IS the dup smell).
- **Proof test form**: Duplication count → programmatic assertion + helper-existence assertion
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-012/F5-dup-success-page-loader.test.ts`
- **Catalogue walk**: **parity (chosen)** + clone-count (both apply); helper-exists assertion vindicates the abstraction. consumer-count (n/a), dep-graph (n/a)
- **MCP evidence**: n/a
- **Bead**: TBD
- **Recurrence note**: NEW fingerprint `simplification:dup-checkout-success-loader`. Tracks separately from `simplification:dup-checkout-form-vs-command` (F6) because the consumer surface differs (route loaders vs remote function bodies).

### F6 — simplification:dup-checkout-form-vs-command

- **Severity**: minor
- **File:Line**: `apps/web/src/lib/remote/checkout.remote.ts:18-22` (form schema) + `:71-75` (command schema), `:40-65` (form body) + `:108-123` (command body)
- **Description**: `checkoutFormSchema` and `checkoutCommandSchema` declare identical fields (`contentId`, `successUrl?`, `cancelUrl?`). Their consumer functions duplicate the `api.checkout.create({ contentId, successUrl: ..., cancelUrl: ... })` body — the form() variant wraps in try/catch + redirect, the command() returns the URL. One shared schema + one shared `createStripeSession()` helper reduces the file to ~50 lines.
- **Proof test form**: Duplication count → programmatic assertion
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-012/F6-dup-checkout-form-vs-command.test.ts`
- **Catalogue walk**: parity (n/a — different return contracts), **jscpd-style count (chosen)**, consumer-count (n/a), dep-graph (n/a)
- **MCP evidence**: n/a
- **Bead**: TBD
- **Recurrence note**: Sibling fingerprint of F4 (both are dup-zod-schema-fragment hits). Counts as 2nd hit in this cycle for `simplification:dup-zod-schema-fragment`.

### F7 — simplification:lonely-abstraction

- **Severity**: minor
- **File:Line**: `apps/web/src/lib/components/layout/Header/MobileNav.svelte` (289 lines) + `apps/web/src/lib/components/layout/Header/UserMenu.svelte` (~100 lines)
- **Description**: Both components have exactly ONE consumer: `routes/_creators/+layout.svelte`. The platform tree (`(platform)/+layout.svelte`) and the org tree (`_org/[slug]/+layout.svelte`) have BOTH migrated to the canonical `MobileBottomNav` + `MobileBottomSheet` pattern from `lib/components/layout/MobileNav/`. Only the `_creators` subdomain still imports the older hamburger drawer. Two valid resolutions: migrate `_creators` to the bottom-nav pattern (UX consistency), OR inline the hamburger code into `_creators/+layout.svelte` (eliminate the abstraction). Either way, `lib/components/layout/Header/` becomes obsolete.
- **Proof test form**: Lonely abstraction → consumer-count assertion
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-012/F7-lonely-creators-header.test.ts`
- **Catalogue walk**: parity (n/a — UX-changing refactor), jscpd (n/a — single consumer), **consumer-count (chosen)**, dep-graph (n/a)
- **MCP evidence**: n/a (could Playwright the creators subdomain after migration to confirm UX parity, but consumer count is sufficient for the audit gate)
- **Bead**: TBD; if resolution is "delete Header/MobileNav.svelte without UX change in _creators", route to `/fallow-audit` per the cross-skill hand-off in §8 of the SKILL.
- **Recurrence note**: First `simplification:lonely-abstraction` filing in apps/web — ref 03 §2 row 1 baseline.

### F8 — denoise:doc-rot:05-domain-web:row5

- **Severity**: minor
- **File:Line**: `.claude/skills/denoise/references/05-domain-web.md` (paragraph in §4 about "New localStorage collection checklist")
- **Description**: Reference cites `loadFromServer()` reconciliation fn as canonical; the actual function is `hydrateIfNeeded` (declared at `apps/web/src/lib/collections/hydration.ts:99`). `loadFromServer` exists nowhere in `apps/web/src`. The reference text was written when the function had its earlier name and was not updated when it was renamed. Same class of fabrication as `/design-system` iter-05's `axeCheck` finding.
- **Proof test form**: Doc-rot grep assertion (cited symbol must exist; old symbol must not exist)
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-012/F8-doc-rot-loadFromServer.test.ts`
- **Catalogue walk**: **API regression w/ no test infra → grep snapshot (chosen)**; all others n/a for doc-rot.
- **MCP evidence**: n/a
- **Bead**: TBD (route to denoise epic, not /fallow-audit — the fix is a reference edit, not a code edit)
- **Recurrence note**: First doc-rot filing on ref 05.

---

## Summary

| Metric | Value |
|---|---|
| Total findings | 8 |
| Blocker | 0 |
| Major | 5 (F1, F2, F3, F4, F5) |
| Minor | 3 (F6, F7, F8) |
| Testability-bugs | 0 |
| Testability-bug rate | 0% (R8 well within 15% budget) |
| Beads filed | TBD (parent skill step 7) |
| Recurrence promotions queued | 0 |

**JSCPD findings**: clone rate 12.38% across apps/web/src (4644 duplicated lines / 37501 total). Largest clusters are in `lib/components/ui/ShaderHero/renderers/` (35-43 lines duplicated across 30+ single-pass renderers — same render-loop init/uniform-binding/cleanup boilerplate). NOT filed this cycle: each renderer is a self-contained hot-swap module, and a `BaseRenderer` factory extraction is a distinct architectural decision (touches all 41 renderer files; better filed as a deliberate refactor task than a denoise audit finding). Could flag as `simplification:dup-renderer-boilerplate` in a future cycle if the count keeps growing — currently watched.

**Fallow JSON**: ~4538 lines of dead-code candidates. Spot-checked 20 entries against fallow-audit's FP taxonomy — most are remote.ts exports (FP #1), paraglide message functions (FP #10), Svelte component dispatched events (FP #2). No simplification-relevant signal not already captured above.

---

## Skill patches applied

- (none) — R14 was already applied at start of cycle. No new rule promotions queued from iter-012's findings.
- F8 will require an edit to `references/05-domain-web.md` (replace `loadFromServer()` with `hydrateIfNeeded`) — that edit happens in the fix PR, not in this audit.

---

## Next-cycle prep

**Round 1 closes with iter-012.** All 12 cells have a baseline. Round 2 begins.

- **Recurrence watches carry forward**:
  - `simplification:dup-content-item-shape` (NEW iter-012 F1) — sibling shape of `simplification:dup-paginated-list-shape` (cycle_density=6 iter-009). Combined family is now at hits=2 across two cycles. **Recommend 2-hit early-promotion watch** (R7 endemic-density precedent) for next packages OR apps/web simplification cycle. If a 3rd sibling appears, promote a R15 covering "structural-contract redeclaration of types that already have a canonical declaration site (in the route's local types.ts, in @codex/shared-types, or in @codex/<domain> wire DTOs)".
  - `simplification:dup-zod-schema-fragment` — hits=2 in this cycle alone (F4 + F6). One more cycle hit triggers R7 standard 3-hit promotion. Likely to recur in workers (form-vs-command pattern) or apps/web (more remote.ts files growing).
  - `simplification:dup-component-shape` (NEW iter-012 F2) — first apps/web filing. Watch for recurrence in next apps/web cycle.
  - `simplification:dup-auth-derive-logic` (NEW iter-012 F3) — first filing. Same family as R14 (helper-belongs-in-shared-utils). Track for recurrence.
  - **Carried from iter-011**:
    - `simplification:dup-procedure-context-builder` at hits=2 — apps/web has no `procedure()` so this cycle didn't move the counter; one more workers OR packages cycle hit fires R7 standard 3-hit promotion.
    - `simplification:dup-paginated-list-shape` (cycle_density=6 iter-009) — 2-hit early-promotion watch CLOSED for workers + apps/web (services own pagination; apps/web hand-off to feed-types ContentItem). Carries forward to next packages cycle.
  - `types:as-unknown-as` + `types:as-cast-without-guard` (hits=2 each) — types phase, not seen this cycle (out of scope).

- **Cell fidelity countdown**: simplification × apps/web 1/3 (this cycle produced findings — not yet at fidelity).

- **Round 2 cell-selection guidance**: with all 12 cells baselined, the cell-due algorithm in master.md operates normally. Tie-breaks favour security > types > performance > simplification. With ~515 churned files in apps/web in 14 days, the apps/web column is hot — expect security/types/performance × apps/web to be due before simplification cycles back.

- **Doc-rot fix carry-forward**: F8 ref-05 edit (loadFromServer → hydrateIfNeeded) lands in the same PR as the fix; cycle-0 fabrication checks on next apps/web cycle should re-confirm.

- **JSCPD endemic monitoring**: 12.38% clone rate is high for a SvelteKit app of this size. Largest sub-clusters not filed this cycle (renderer boilerplate, content-detail load() body) deserve a deliberate refactor pass — recommend filing `Codex-` epic at the end of Round 1 for a "structural dedup pass" rather than recurring denoise findings. The audit's job is to surface; the systematic remediation is project work.

- **R14 effectiveness check (carry-over from iter-011)**: not testable in apps/web cycle since R14 targets `workers/*/src/routes/**` cache-fanout. Will verify in next workers cycle.

- **Cross-skill hand-offs from this cycle**:
  - F7 (`Header/MobileNav.svelte` deletion if migrating _creators to MobileBottomNav) — possible `/fallow-audit` route depending on resolution choice.
  - All other findings stay in denoise epics.
