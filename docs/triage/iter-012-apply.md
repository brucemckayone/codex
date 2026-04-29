# iter-012-apply — Codex-u498 verification execution (4-agent team)

> Apply phase after iter-012's walk + user greenlight on Option A "One bundled verification PR" (clarified to mean: 4 parallel sub-agents, each owning one slice, confirming at the end). User explicitly waived per-PR commit/atomicity discipline ("no production app, hardening phase").

## Cycle parameters

- **Iter ID**: iter-012-apply
- **Bead**: Codex-u498 — *[Nav Redesign] WP-10: Verification (DevTools + Playwright)*
- **Mode**: cluster-execute team (R1 exception variant — heterogeneous slice recipes, single fingerprint family)
- **Rung**: 3 (apply phase, walk landed in iter-012's `fbf4ff87`)
- **Date**: 2026-04-29
- **Predecessor commit**: `fbf4ff87` (iter-012 walk + early-claim)

## Team protocol

User clarification on iter-012's AskUserQuestion answer: chose **Option A (One bundled verification PR)** but ALSO instructed: "we can have 4 subagents doing each separately confirming at the end i dont care about commit pr structurs right now there is no production app we are in the process of hardening so its no big deal".

Interpreted as a hybrid: parallelism of Option B (4 sub-agents) + apply-now-don't-split-beads of Option A (no child epics, just verification execution). Closest skill analog: §13 cluster-defect agent team (R1 exception), but recipes are NON-byte-equivalent (sidebar checks ≠ mobile checks ≠ palette checks ≠ a11y checks). NEW team-cycle shape recorded as `signal:cluster-execute-heterogeneous-slices` candidate (not yet filed in recurrence ledger pending pattern recurrence).

## Slice ownership

| Slice | Agent ID | Checks | Surface |
|---|---|---|---|
| 1 — Desktop sidebar | a378…ef31 | T-01, T-02, PW-01, PW-02, PW-07, PW-08 | platform + studio-alpha rail at desktop viewports |
| 2 — Mobile (375x812) | a2cd…9c46 | T-04, T-05, PW-04, PW-05, PW-06 | bottom nav + bottom sheet |
| 3 — Command palette | ae51…c428 | T-03 (9 sub) + PW-03 | palette open/close/debounce/scope |
| 4 — A11y / auth / transitions / responsive / brand-editor | a6fe…376e | T-06, T-07, T-08, T-09, T-10, PW-09, PW-10, PW-11 | cross-cutting concerns |

Each agent ran chrome-devtools + playwright MCPs in its own browser session (no overlap). Total wall time ~12 min (longest slice 4 at 11.5 min). Parent context grew by ~4 structured returns (one per slice).

## Aggregate result

**21 checks → 19 pass-or-deferred + 2 hard fails + 3 partials.** Bead's "All must pass before WP-11" gate **not met** — Codex-u498 stays open with 7 dependency child beads blocking close.

| Slice | Pass | Fail | Partial | Pending-WP-11 | Beads filed |
|---|---|---|---|---|---|
| 1 — Desktop sidebar | 6/6 | 0 | 0 | 0 | 1 (P3 polish) |
| 2 — Mobile | 5/5 | 0 | 0 | 0 | 0 |
| 3 — Command palette | 11/11 | 0 | 0 | 0 | 1 (P3 bug) |
| 4 — A11y / etc | 4/8 + 5/6 sub | 2 | 3 | 1 | 5 (2× P2, 2× P3, 1× P4) |
| **Total** | **19** | **2** | **3** | **1** | **7** |

## Findings detail

### Hard fails (2)

**1. Codex-nwlhm (P2 bug)** — Platform `/` does not render auth state in SidebarRailUserSection.

After login, `/discover` and `/library` show authenticated avatar + name + email + dropdown menu (Account/Library/Studio/Log out). `lvh.me:3000/` still shows the unauth Sign In link. Same browser session, same cookie, two different render paths producing two different user states. Likely cause: platform marketing home does not propagate `locals.user` to `SidebarRailUserSection`. Real bug, not test infra — the kind of cross-cutting issue only end-to-end browser MCP catches.

**2. Codex-rf1l9 (P2 bug)** — Nav redesign components ignore `prefers-reduced-motion`.

`SidebarRail*`, `MobileBottomNav`, `MobileBottomSheet`, `CommandPalette`, `CommandPaletteSearch` have no `@media (prefers-reduced-motion: reduce)` blocks. `StudioSidebar*` does — copy that pattern. WCAG 2.3.3 (Animation from Interactions) implicated. Mechanically a 30-line CSS addition.

### Partials (3) — captured as P3 task beads

**3. Codex-peuan (P3)** — Arrow-key navigation within rail not implemented (Tab works fine, ArrowDown/Up don't move focus). Spec T-10 says "arrow keys work within rail". Roving-tabindex pattern needed.

**4. Codex-1k9ns (P3)** — Studio sidebar uses 64→260 hover-expand instead of always-expanded per spec T-07. May be spec drift (design unified rail behaviour) rather than implementation bug — bead requests product/design clarification before fix lands.

**5. Codex-95vdy (P4 cosmetic)** — Dropdown menu item "Log out" vs spec "Sign Out". Minor wording alignment.

### Polish bead (1)

**6. Codex-onjxy (P3)** — `--rail-width-expanded: 240px` literal in `SidebarRail.svelte:154` should hoist into `tokens/layout.css` for brand-editor density-tier overrides. Single consumer, no current functional impact.

### Cross-org bug (1)

**7. Codex-usqgu (P3 bug)** — `CommandPaletteSearch.svelte:124-127` does naive `goto('/content/{slug}')` and 404s when palette returns foreign-org content (cross-subdomain). Should use `buildContentUrl(page.url, content)` per CLAUDE.md "Common Developer Tasks → Content page URLs".

This is the **third** missed-call-site of an established-helper pattern → recurrence promotion-eligible (see § Recurrence ledger updates below).

### Expected pending Codex-i49f (1)

**T-09.creators-768** — `apps/web/src/routes/_creators/+layout.svelte:12-13` still imports legacy `Header/UserMenu` + `Header/MobileNav`. WP-11 (Codex-i49f) cleanup will migrate to new `SidebarRail` + `MobileBottomNav`. Deferred to Codex-i49f scope per F2 of iter-012's walk doc.

## Bead state changes

- **Codex-u498**: status `in_progress` → `open` (apply ended partial, not closed). Labels: + `triage:routing:apply-partial`. Now blocked by 7 child beads.
- **Codex-nwlhm** (NEW, P2 bug): platform root auth state regression
- **Codex-rf1l9** (NEW, P2 bug): reduced-motion a11y regression
- **Codex-peuan** (NEW, P3 task): arrow-key nav
- **Codex-1k9ns** (NEW, P3 task): studio sidebar always-expanded spec deviation
- **Codex-onjxy** (NEW, P3 task): rail width token hoisting
- **Codex-usqgu** (NEW, P3 bug): palette cross-org goto
- **Codex-95vdy** (NEW, P4 task): log out vs sign out wording
- 7× `bd dep add Codex-u498 <child>` — all 7 children block Codex-u498's close

## Recurrence ledger updates

### Bumped: `route:self:promoted-helper-missed-call-site` (hits 2 → 3, PROMOTION ELIGIBLE)

Third distinct bead, third distinct helper missed at a new call site:

- iter-003 / Codex-y6x9j: `invalidateOrgSlugCache` missed at `settings.ts`
- iter-009 / Codex-y63gl.14: `pollConfig` (cadence) missed at `ImmersiveShaderPlayer` + `ShaderPreview`
- iter-012 / Codex-usqgu: `buildContentUrl` missed at `CommandPaletteSearch.svelte:124-127`

All three: established helper documented in CLAUDE.md OR promoted via denoise R-rule, then a later-arriving consumer ships without inheriting it. Cleanly meets §3 promotion-gate: hits ≥ 3 ✓, verdict_history consistent (all `auto-resolve` rung-1 fixes) ✓, was `promoted: false` going in ✓. **Queued for next /triage cycle's parent prep step** — RT4 codification candidate (mirrors RT3 promotion path in iter-010a-promote).

Draft RT4 rule text:

> When a perf/structural pattern is amortised inline in component A and component B/C are introduced later that share the underlying expensive call (`getShaderConfig`, `audio.getAnalysis()`, `goto()` for cross-subdomain routing, etc.), the introducing PR MUST extract or consume the existing helper before merge. Denoise filters that flag bare expensive calls in render loops or naive `goto()` calls when `buildContentUrl()` is in scope would catch this earlier. Lint candidate: AST-grep for `goto(\`/content/${...}\`)` patterns and route-level mutation hot paths that bypass canonical helpers.

### Bumped: `signal:bead-is-test-plan-execution` (verdict_history extended)

iter-012-apply added an `auto-resolve-partial` entry tagged `apply-option-a-team-execute`. Hits stays at 1 (single bead, multiple verdict_history entries do NOT increment 3-distinct-bead promotion threshold per `signal:type-drift-template-vs-api` precedent).

### NEW: `signal:cluster-execute-heterogeneous-slices` (hits=1)

First sighting. Distinct from §13's cluster-defect team-fix (byte-equivalent recipes) — here the slice recipes are NON-byte-equivalent (sidebar checks ≠ mobile checks ≠ palette checks ≠ a11y checks). Common shape: a single test-plan-execution bead (per `signal:bead-is-test-plan-execution`) where the natural decomposition is by viewport/context axis, not by file-locality. If 3+ recurrences (other verification-only beads in nav-redesign / auth-perf / analytics epics), promote rule: "verification-only beads with N≥10 assertions and a clean decomposition along viewport/context axis MAY use parallel sub-agents per slice without splitting into child beads — single team-cycle apply with per-slice structured returns."

### NEW: `signal:apply-phase-partial-children-block-parent` (hits=1)

First sighting. Apply phase ended with N child beads filed and parent left open with `triage:routing:apply-partial`, dependency-wired to all N children. Distinct from clean closes (single-bead resolve) and split-during-walk (children filed before any execution). If 3+ recurrences, promote rule: "rung-3 apply phases that produce N hard-fail / partial findings filing N child beads MUST wire dependencies bidirectionally so the parent stays in the `bd ready` exclusion set until children close."

## Surface gaps captured for skill self-improvement

1. **Cluster-execute heterogeneous slices** — §13's cluster-defect protocol assumes byte-equivalent recipes. Verification-execution clusters have heterogeneous recipes but a shared fingerprint family. §13 needs a sub-section codifying this variant.
2. **Apply-partial routing** — no `triage:routing:apply-partial` precedent existed before this cycle; iter-009a-apply closed cleanly, iter-010-apply closed cleanly. First time the apply phase produces a non-close outcome that's also not a hard-stop. Skill should codify: "rung-3 apply phases MAY end with parent-stays-open + N children filed; the routing label `triage:routing:apply-partial` is the audit trail."

## Commit

`triage(iter-012-apply): rung-3 apply — Codex-u498 verification 4-agent team (19/21 pass, 7 child beads filed)` covering:

- `docs/triage/iter-012-apply.md` (new)
- `docs/triage/master.md` (cycle-history row + ladder snapshot footnote + new beads counted in rung-3)
- `docs/triage/recurrence.json` (bump 2, add 2)

No source-file edits this cycle (verification-only). 7 child beads exist as `.beads/issues.jsonl` mutations synced via `bd sync`.

## Next steps

1. User confirms `git push` (R4 — push always requires explicit user gate).
2. Subsequent /triage cycles drain the 2× P2 children (Codex-nwlhm root auth, Codex-rf1l9 reduced-motion) — both are rung-1 mechanical for someone who knows the layout-server.ts patterns + CSS reduced-motion idiom.
3. RT4 promotion candidate (`route:self:promoted-helper-missed-call-site`) surfaces in next /triage parent prep step as `AskUserQuestion`.
4. `signal:bead-description-partially-stale` is also at hits=3 PROMOTION ELIGIBLE from iter-011b — could land in same parent prep step alongside RT4 candidate.
