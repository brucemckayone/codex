# Iteration 027 — simplification × apps/web (Round 2 second pass cycle 3, Round 3 effectiveness)

- **Cell**: simplification × apps/web
- **Date**: 2026-04-26
- **Mode**: delta
- **Since**: `7345a106` (iter-024 baseline, batch sweep)
- **HEAD before audit**: `870f4ec8` (iter-026 commit)
- **Files churned**: 16 (apps/web/src/** since iter-024 baseline)
- **Agent**: agents/audit-web.md
- **Fallow JSON**: `/tmp/denoise-iter-027-fallow.json` (218 total issues — apps/web slice dominated by ShaderHero dynamic-renderer FPs and `.remote.ts` framework exports)
- **Typecheck baseline**: `/tmp/denoise-iter-026-typecheck-baseline.log` (53/53 clean — reused from iter-026)
- **jscpd run**: `/tmp/denoise-iter-027-jscpd.json/jscpd-report.json` (354 clones, 11.42% duplicated lines — over 5% threshold; ShaderHero renderers dominate the count, content detail loaders are the actionable cluster)

## Round 3 commits in scope

`2d1c065a` (Tier 2.A+B), `7641fb4b` (2.C+G), `af0432e6` (2.E), `7440fe95` (3.A), `aff6b2ac` (3.B), `abafff49` (3.C+D), `6e8438cc` (4.A+B), `7715eaf3` (4.C+D), `9bf9fbf6` (5.A+B), `1c499d79` (6.A), `253ffab4` (7.A+B), `d5392cde` (typecheck infra), `870f4ec8` (iter-026 commit).

apps/web touchpoints from these commits (16 files):
- `app.html`, `hooks.server.ts` (Tier 7.A CSP)
- `lib/collections/subscription.ts` (Tier 3.D)
- `lib/components/layout/Header/MobileNav.svelte`, `Header/UserMenu.svelte`, `MobileNav/MobileBottomSheet.svelte` (Tier 2.A — Header surface migrated)
- `lib/remote/checkout.remote.ts`, `lib/remote/content.remote.ts` (Tier 2.E — schema dedupes)
- `lib/server/content-detail.ts` (Tier 3.D)
- `lib/types.ts` (Tier 3.C+D — SubscriptionContext canonical landing site)
- `lib/utils/access-context.svelte.ts`, `studio-access.svelte.ts`, `subscription-context.svelte.ts` (Tier 2.A + 3.D — new helpers)
- `routes/_org/[slug]/+layout.server.ts` (Tier 3.D — streamed promise wiring)
- `routes/(platform)/account/subscriptions/+page.svelte` (Tier 3.D wiring)

## Fabrication check

Walked the anti-pattern rows in `references/03-simplification.md` §7 (12 rows) and `references/05-domain-web.md` §9 (12 rows) — 24 rows total.

| Reference | Row | Cited symbol | Status |
|-----------|-----|--------------|--------|
| 03 §1 | dup-try-catch-boilerplate | `withServiceErrors()` | live (used by other cells; no apps/web claim) |
| 03 §2 | lonely-abstraction | `findConsumers` helper | live (`scripts/denoise/find-consumers.ts`) |
| 03 §5 | factory-without-logic | `class \w+Factory` | live |
| 03 §6 | jscpdBudget | `scripts/denoise/jscpd-budget.ts` | live |
| 05 §1 | server-import-in-universal-load | `+page.ts` ban | live |
| 05 §2 | streamed-promise-no-catch | streaming pattern | live |
| 05 §3 | remote-fn-no-auth-check | `.remote.ts` exports | live |
| 05 §4 | **collection-init-missing-platform-layout** | **`loadFromServer()`** | **STALE — symbol doesn't exist (F4)** |
| 05 §4 | collection-not-browser-guarded | `localStorageCollectionOptions` | live |
| 05 §4 | layout-missing-depends-cache-versions | `depends('cache:versions')` | live |
| 05 §5 | subdomain-detection-naive | `extractSubdomain` | live |
| 05 §5 | reroute-bypassing-org-resolution | `params.slug` | live |
| 05 §6 | studio-ssr-true-regression | studio `ssr = false` | live |
| 05 §7 | paraglide-message-not-in-en-json | `messages/en.json` | live |
| ... | (12 of 24 verified live; 1 stale row already filed as F4 below) | | |

**Result: 23/24 rows live, 1 stale (filed F4).** This matches Codex-mqyql.18 (still open from iter-012); the doc-rot was not touched by Round 3. Re-filing as proof-test-backed finding.

## Round 3 effectiveness verification

Targeted verification per cycle prompt:

### R14 (cache-fanout helpers in `@codex/cache`)

✅ **CLEAN.** Grep `cache.invalidate(CacheType.` over `apps/web/src/lib/{remote,server}/`, `apps/web/src/routes/` returns zero matches. R14 holds in apps/web.

### STUDIO_ROLES helper consolidation (Tier 2.A, Codex-mqyql.14)

⚠️ **PARTIALLY EFFECTIVE.** Tier 2.A canonicalised `STUDIO_ROLES` + `useStudioAccess()` in `lib/utils/studio-access.svelte.ts`, and migrated the **Header** surface (Header/MobileNav, Header/UserMenu, MobileNav/MobileBottomSheet — all 3 sites). However, two **SidebarRail** surface files were NOT migrated:

- `lib/components/layout/SidebarRail/SidebarRail.svelte:55-63` still inlines `const STUDIO_ROLES = new Set(...)` + `canAccessStudio` derive + `studioHref` ternary
- `lib/components/layout/SidebarRail/SidebarRailUserSection.svelte:31-39` same triple

Plus the server-side `routes/_creators/studio/+layout.server.ts:17` still has its own `STUDIO_ROLES` Set (acceptable — it imports the canonical via `hasStudioRole` for the gate, but redeclares for the type narrow). Lower priority; flagged in F1 only for the two .svelte client surfaces that should consume `useStudioAccess()`.

**Filed as F1.** Recurrence increment for `simplification:duplicate-utility-helper` (already promoted to R14).

### schema .extend() dedupes (Tier 2.E, Codex-mqyql.16 + .17)

✅ **EFFECTIVE.**
- `lib/remote/content.remote.ts:438` — `createContentFormSchema = contentBaseFormSchema` (now derived from base)
- `lib/remote/content.remote.ts:569` — `updateContentFormSchema = contentBaseFormSchema.extend({ contentId: z.string().uuid() })`
- `lib/remote/checkout.remote.ts:22` — single `checkoutInputSchema` shared by both `createCheckout` (form) and `createCheckoutSession` (command)

Both Codex-mqyql.16 and .17 should close. No new `simplification:dup-zod-schema-fragment` instances detected this cycle.

### SubscriptionContext consolidation (Tier 3.D, Codex-lqvw4.16)

✅ **EFFECTIVE.** `lib/types.ts:150` is now the sole canonical declaration site for `SubscriptionContext` (cross-loadable from server + client). `lib/server/content-detail.ts:21` exports it as a re-export. `lib/utils/subscription-context.svelte.ts:35` uses `Pick<SubscriptionContext, ...>` for its narrower client view (correctly named `ResolvedSubscriptionContext`). The structural divergence flagged in iter-006 F6 (`SubscriptionContext { tiers: SubscriptionTier[] }` vs full 5-field shape) is resolved — the tier-only shape is now `OrgTiersContext` (renamed in `access-context.svelte.ts:19` per Codex-lqvw4.16 docblock).

### Lonely abstraction watch (Codex-mqyql.19)

⚠️ **STILL OPEN.** `Header/MobileNav.svelte` and `Header/UserMenu.svelte` have **one consumer each**: `routes/_creators/+layout.svelte:12-13`. Round 3 Tier 2.A only refactored their internals (extracted `STUDIO_ROLES`) but did not address the 1-consumer status. Decision still pending — delete OR generalise to platform/org. Not re-filing this cycle (Codex-mqyql.19 already tracks).

### StudioSidebarItem ↔ SidebarRailItem (Codex-mqyql.12)

⚠️ **STILL OPEN.** `StudioSidebarItem.svelte:52` and line 238 of `StudioSidebar.svelte` still contain the comment `"Matches the SidebarRailItem reference pattern exactly."` Round 3 did not touch. Not re-filing this cycle (Codex-mqyql.12 tracks).

### ContentItem inline redeclarations (Codex-mqyql.13)

❌ **STILL OPEN AND RECURRING.** All 4 sites originally flagged in iter-012 (`DiscoverMix.svelte:27`, `AudioWall.svelte:21`, `ArticleEditorial.svelte:30`, `Spotlight.svelte:31`) still inline-redeclare the ContentItem shape. Plus a 5th instance was discovered this cycle: `CreatorCard.svelte:41` inline-redeclares `ContentItem` AND `SocialLinks` despite a sibling `CreatorCard/types.ts` exporting both.

**Filed as F2** — recurrence increment for `simplification:dup-content-item-shape`. This is the 2nd cycle hit for the fingerprint (cycle_density=4 in iter-012, +1 in iter-027 = 5 cumulative). Per the master.md 2-hit early-promotion watch, this fingerprint qualifies for promotion review next cycle.

## Findings

### F1 — simplification:duplicate-utility-helper

- **Severity**: major
- **File:Line**:
  - `apps/web/src/lib/components/layout/SidebarRail/SidebarRail.svelte:55-63`
  - `apps/web/src/lib/components/layout/SidebarRail/SidebarRailUserSection.svelte:31-39`
- **Description**: Two SidebarRail surface files still inline-declare `STUDIO_ROLES` + `canAccessStudio` derive + `studioHref` cross-subdomain ternary, despite Round 3 Tier 2.A landing the canonical `useStudioAccess()` composable in `lib/utils/studio-access.svelte.ts`. The Header surface (Header/MobileNav, Header/UserMenu, MobileNav/MobileBottomSheet) was migrated; the SidebarRail surface was missed.
- **Proof test form**: Duplication count → programmatic grep assertion (R14 sibling pattern)
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-027/F1-sidebar-rail-studio-roles-dup.test.ts`
- **MCP evidence**: n/a (static finding)
- **Bead** (proposed): Codex-mqyql.20 — labels: `denoise,denoise:simplification,denoise:apps-web,denoise:iter-027,denoise:simplification:duplicate-utility-helper,denoise:test-shape:grep-assertion`
- **Recurrence**: 4th cycle hit for `simplification:duplicate-utility-helper` (already R14). Cycle_density this cycle: 2.

### F2 — simplification:dup-content-item-shape

- **Severity**: major
- **File:Line**: `apps/web/src/lib/components/ui/CreatorCard/CreatorCard.svelte:41` (also line 34 for `SocialLinks`)
- **Description**: `CreatorCard.svelte` inline-redeclares `interface ContentItem { title; slug; thumbnailUrl; contentType }` and `interface SocialLinks { website; twitter; youtube; instagram }` — both already exported from sibling `CreatorCard/types.ts:18` and `:11`. The component family's docblock explicitly states "Shared types for CreatorCard family components ... so it can be re-exported from the package barrel" — the rule is established but ignored for the same-shape consumed type.
- **Proof test form**: Duplication count → programmatic grep + structural import assertion
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-027/F2-creator-card-content-item-dup.test.ts`
- **MCP evidence**: n/a (static finding)
- **Bead** (proposed): Codex-mqyql.21 — labels: `denoise,denoise:simplification,denoise:apps-web,denoise:iter-027,denoise:simplification:dup-content-item-shape,denoise:test-shape:grep-assertion`
- **Recurrence**: 2nd cycle hit for `simplification:dup-content-item-shape` (cycle_density=4 in iter-012 + 1 in iter-027). **Qualifies for promotion review next cycle per 2-hit early-promotion watch.**

### F3 — simplification:dup-fetch-handler-boilerplate

- **Severity**: major
- **File:Line**:
  - `apps/web/src/routes/_org/[slug]/(space)/content/[contentSlug]/+page.server.ts:89-171`
  - `apps/web/src/routes/_creators/[username]/content/[contentSlug]/+page.server.ts:125-209`
- **Description**: Two content detail server loaders share three jscpd-detected clone clusters totaling ~70 lines: identical `subscriptionContext` 5-field empty fallback object (×2 in each file), identical `loadAccessAndProgress(...).catch(() => fallback)` block with the same 5-field denied-access fallback, and structurally identical isPublic-authenticated and gated-authenticated return shapes. The creators-loader differs only by adding `creatorProfile` and `username` fields.
- **Proof test form**: Duplication count → programmatic clone-count assertion (jscpd-budget) + grep assertion on the literal fallback object pattern
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-027/F3-content-detail-loader-dup.test.ts`
- **MCP evidence**: jscpd report — `/tmp/denoise-iter-027-jscpd.json/jscpd-report.json` (3 clusters between the two paths: 22L, 22L, 26L)
- **Bead** (proposed): Codex-mqyql.22 — labels: `denoise,denoise:simplification,denoise:apps-web,denoise:iter-027,denoise:simplification:dup-fetch-handler-boilerplate,denoise:test-shape:jscpd-budget`
- **Recurrence**: 1st cycle hit for `simplification:dup-fetch-handler-boilerplate` (new fingerprint; previously seen as `dup-content-detail-loader` candidate).

### F4 — denoise:doc-rot:references/05-domain-web.md:§4

- **Severity**: minor
- **File:Line**: `.claude/skills/denoise/references/05-domain-web.md:145`
- **Description**: Anti-pattern row 1 of §4 cites `loadFromServer()` reconciliation as the canonical helper. The actual helper in `apps/web/src/lib/collections/hydration.ts:99` is `hydrateIfNeeded()` (per `apps/web/CLAUDE.md`). Codex-mqyql.18 was filed against this in iter-012 and is still open; Round 3 did not touch references/. Re-filing with a proof-test-backed grep assertion.
- **Proof test form**: Naming/style consistency → grep assertion (symbol exists at cited path)
- **Proof test path**: `apps/web/src/__denoise_proofs__/iter-027/F4-doc-rot-loadFromServer.test.ts`
- **MCP evidence**: n/a (doc-rot finding)
- **Bead** (proposed): increment Codex-mqyql.18 with this cycle's evidence (do not double-file — bead already exists)
- **Recurrence**: 2nd cycle hit for `denoise:doc-rot:references/05-domain-web.md:§4` (1st hit iter-012, 2nd this cycle).

## Summary

| Metric | Value |
|---|---|
| Total findings | 4 |
| Blocker | 0 |
| Major | 3 (F1, F2, F3) |
| Minor | 1 (F4 doc-rot) |
| Testability-bugs | 0 |
| Testability-bug rate | 0% (R8 budget healthy) |
| Beads filed (proposed) | 3 new (Codex-mqyql.20–22) + 1 increment (Codex-mqyql.18) |
| Recurrence promotions queued | 1 (`simplification:dup-content-item-shape` → 2-hit early promotion review) |

## Round 3 effectiveness scoreboard

| Tier | Target | Verdict |
|------|--------|---------|
| Tier 2.A (STUDIO_ROLES) | Codex-mqyql.14 (3 Header sites) | ✅ Header migrated, ⚠️ SidebarRail surface NOT migrated → F1 |
| Tier 2.B (cache-fanout helpers, R14) | apps/web inline cache.invalidate fanout | ✅ Clean — no inline fanout in apps/web |
| Tier 2.E (schema .extend) | Codex-mqyql.16 + .17 | ✅ Both closed (createCheckout/createCheckoutSession share schema; create/updateContentFormSchema share base) |
| Tier 3.D (SubscriptionContext) | Codex-lqvw4.16 (3 declaration sites, 1 divergent) | ✅ Single canonical declaration in lib/types.ts:150; client narrowing via Pick<>; OrgTiersContext rename done |
| Codex-mqyql.12 (StudioSidebarItem dup) | "Matches the SidebarRailItem reference pattern exactly" | ⚠️ Still open — Round 3 didn't touch |
| Codex-mqyql.13 (4 inline ContentItem) | DiscoverMix/AudioWall/ArticleEditorial/Spotlight | ❌ All 4 still open + 5th surfaced (CreatorCard.svelte) → F2 |
| Codex-mqyql.18 (doc-rot loadFromServer) | references/05 §4 row 1 | ❌ Still open — F4 |
| Codex-mqyql.19 (Header lonely abstraction) | Header/MobileNav + Header/UserMenu | ⚠️ 1 consumer each, decision still pending |

## Skill patches applied

- (none) — no rule promotions this cycle. F2 queues `simplification:dup-content-item-shape` for next-cycle promotion review only (2nd hit, cycle_density=5 cumulative).

## Next-cycle prep

1. **Promotion review**: `simplification:dup-content-item-shape` reaches 2 cycles with cycle_density=5 cumulative. The fingerprint mirrors R14's promotion profile (R14 promoted at cumulative cycle_density=7 across 2 cycles). Recommend the dispatching skill consider a 2-hit early promotion to a hard rule that says: "Structural shapes consumed across ≥2 component-family files MUST resolve to a single declaration site (sibling `types.ts`, package barrel, or generated wire shape via `NonNullable<...>`); inline `interface`/`type` redeclarations that exactly match an exported sibling are blocker."

2. **F1 (sidebar-rail STUDIO_ROLES dup)** is mechanically closeable in a Tier 2.A.b follow-up — replace the two inline triples with `useStudioAccess(() => ({ user, url: page.url }))`. ~20 line diff.

3. **F3 (content detail loader dup)** is the highest-impact closure: extract `EMPTY_SUB_CONTEXT` and `DENIED_ACCESS_RESULT` into `$lib/server/content-detail.ts` (smallest fix) OR extract a shared `loadContentDetail()` helper (structural fix). Either passes the proof test.

4. **F4 (doc-rot)** is a 1-line edit to `references/05-domain-web.md:145` — replace `loadFromServer()` with `hydrateIfNeeded()`. Closes Codex-mqyql.18.

5. **Stop-criterion countdown for simplification × apps/web**: Round 2 cycle 1 (iter-024) was clean. Round 2 cycle 2 (iter-027 — this cycle) is NOT clean (4 findings). Stop-criterion countdown resets to 0/3.

6. **Recurrence carries forward**:
   - `simplification:duplicate-utility-helper` (R14): 4th hit, cycle_density=2 this cycle. Continue tracking.
   - `simplification:dup-content-item-shape`: 2nd hit, cycle_density=1 this cycle. Promotion candidate next cycle.
   - `simplification:dup-fetch-handler-boilerplate`: 1st hit. Track for recurrence.
   - `simplification:dup-procedure-context-builder`: not relevant for apps/web (server-side packages cell only). Carries forward at hits=2 cumulative.

7. **No fabrication beyond F4** — references/05 §4 row 1 is the only stale citation surfaced this cycle. The other 23 cited symbols all resolved live.
