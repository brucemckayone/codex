# iter-012 — Codex-u498 walk

## Cycle parameters

- **Iter ID**: iter-012
- **Bead**: Codex-u498 — *[Nav Redesign] WP-10: Verification (DevTools + Playwright)*
- **Rung**: 3 (walk-only, no auto-resolve)
- **Forced flag**: `--bead=Codex-u498` (user excluded Codex-x0pa from this cycle; Codex-6axi0 + Codex-i49f are blocked)
- **Date**: 2026-04-29

## Pre-flight gate

`bd show Codex-u498 --json` returned:

- `status=open` ✓
- `owner=brucemckayone@gmail.com` (current user) ✓
- No `triage:in-progress-other-agent` label ✓
- Dependency `Codex-nn8l` (WP-09 Studio View Transition) `status=closed` 2026-04-08 ✓
- Bead body unchanged from iter-011 snapshot ✓

**Gate passed.** Claimed `bd update Codex-u498 --status=in_progress` immediately per cycle's stricter protocol (supersedes RT3 working-tree fingerprint detection as collision lockout for this cycle).

## Bead summary

WP-10 of the nav-redesign epic. The bead's deliverable is 21 verification assertions (10 DevTools manual + 11 Playwright automated) covering the 11 new nav-redesign components. All assertions are enumerated in `docs/nav-redesign/WP-10-verification.md` (279 lines). Outcome required before WP-11 (Codex-i49f, currently blocked by this bead) can ship.

## Surface map

### Components in scope (11 files, 5 directories)

- `apps/web/src/lib/components/layout/SidebarRail/` — 3 files (SidebarRail.svelte, SidebarRailItem.svelte, SidebarRailUserSection.svelte)
- `apps/web/src/lib/components/layout/MobileNav/` — 3 files (MobileBottomNav.svelte, MobileBottomSheet.svelte, index.ts)
- `apps/web/src/lib/components/layout/StudioSidebar/` — 4 files (StudioSidebar.svelte, StudioSidebarItem.svelte, StudioSwitcher.svelte, NavBadge.svelte)
- `apps/web/src/lib/components/command-palette/` — 1 file (CommandPalette.svelte)
- `apps/web/src/lib/components/search/CommandPaletteSearch.svelte` — wraps CommandPalette for layout integration

### Integration points

- `apps/web/src/routes/(platform)/+layout.svelte:11,89` — imports + renders `CommandPaletteSearch scope="platform"`
- `apps/web/src/routes/_org/[slug]/+layout.svelte` — imports nav components for org-subdomain context
- View-transition wiring (WP-09 confirmed live): `view-transition-name` cited in SidebarRail.svelte + StudioSidebar.svelte + ImmersiveShaderPlayer + ShaderHero + org layout

### Test plan structure (21 assertions)

| Category | DevTools (manual) | Playwright (automated) | Total |
|---|---|---|---|
| Desktop sidebar rail | T-01 (platform), T-02 (org subdomain) | PW-01 (render), PW-02 (hover expand), PW-07 (navigation), PW-08 (org subdomain) | 6 |
| Command palette | T-03 | PW-03 (open/close) | 2 |
| Mobile bottom nav | T-04 | PW-04 (visibility), PW-05 (search button) | 3 |
| Mobile bottom sheet | T-05 | PW-06 (open/close) | 2 |
| Auth states | T-06 | PW-09 (unauth), PW-10 (auth) | 3 |
| Studio transition | T-07, T-08 (brand-editor) | PW-11 (no rail in studio) | 3 |
| Responsive | T-09 (5 breakpoints) | — | 1 |
| Accessibility | T-10 (keyboard, ARIA, reduced motion) | — | 1 |
| **Total** | **10** | **11** | **21** |

## Critical pre-flight findings

### F1: Zero existing test coverage for new nav components

Repo-wide grep for `MobileBottomNav`, `SidebarRail`, `CommandPalette`, `Main navigation`, `Mobile navigation` returns **0 hits across `apps/web/e2e/`**. The `studio/navigation.spec.ts` spec exists but uses `.studio-layout` selector — different surface (covers existing studio sidebar, not platform/org redesign). No `*.svelte.test.ts` siblings exist for any of the 11 new nav files.

**Implication**: This is a green-field test surface — every assertion in the WP-10 plan is net-new work. No risk of duplicating existing coverage (vs Codex-x0pa where steps 9+10 were already pre-resolved by `account-subscription-cancel.spec.ts`).

### F2: Cross-coupling with Codex-i49f (WP-11)

iter-011b's walk on Codex-i49f surfaced that `apps/web/src/routes/_creators/+layout.svelte:12-13` still imports the deprecated `Header/UserMenu` + `Header/MobileNav` components. WP-11 includes the migration to new SidebarRail/MobileBottomNav as work-item G1.

**Implication for WP-10**: T-09 (responsive at 768px) on the `/creators` route would observe the legacy mobile header rendering until WP-11 ships. Two paths to handle this:
1. Defer Codex-u498's T-09 on `/creators` until WP-11 lands (Option D in routing).
2. Run T-09 on `/creators` and document the failure as expected-pending-WP-11 (deferred-bug pattern).

### F3: Bead is genuinely test-plan-execution shaped

Distinct from existing recurrence fingerprints:
- Not `signal:bead-description-partially-stale` (zero existing coverage = nothing to skip)
- Not `signal:bead-cites-nonexistent-feature` (every cited component exists)
- Not `signal:bead-fully-stale-already-resolved-by-sibling` (no sibling has shipped these tests)

This is a NEW fingerprint: `signal:bead-is-test-plan-execution` — the bead's deliverable is test artifacts + green-checkmark report, not a code diff. Common WP-N decomposition pattern (verification gets its own bead late in the work-package sequence).

## Routing options

| Option | Label | Description | Tradeoff |
|---|---|---|---|
| **A** | One bundled PR | Run all 21 checks via chrome-devtools+playwright MCPs in this cycle | High context budget; couples 21 distinct surfaces in one commit; hard to revert if a single check is wrong |
| **B (Recommended)** | Split into 4 child beads | Codex-u498.1 desktop sidebar (6 checks), .2 mobile (5), .3 command palette (2), .4 a11y/responsive/auth/transitions/brand-editor (8) | Matches team's per-flow E2E convention; each child drains as rung-2 mechanical spec-authoring; cycle scope stays small |
| **C** | Spawn `/backend-dev` or `/design-system` | Hand off verification to a domain skill via skill MCP gates | Neither skill owns E2E spec authoring as primary surface — `/design-system` covers visual review but not Playwright automation; `/backend-dev` covers integration tests but not browser-MCP flows |
| **D** | Defer until Codex-i49f ships | Block on WP-11 cleanup of `_creators/+layout.svelte` Header imports first | Avoids T-09 spurious failure on `/creators`; trades cycle latency for a clean baseline |

**Recommended: B (split into 4 child beads).**

Reasons:
1. Team's existing convention (`apps/web/e2e/` has per-flow specs: `account-subscription-cancel.spec.ts`, `auth-flow.spec.ts`, `homepage.spec.ts`, etc.) — splitting matches how the codebase organises E2E work.
2. Each child bead becomes a rung-2 mechanical spec-authoring task (write Playwright spec, run it, attach proof). Cycle scope per child is bounded.
3. Reduces blast radius if one assertion family (e.g., command palette debounce) needs revisiting — only affects child .3, not all 21 checks.
4. WP-11 dependency (F2) only affects `.4` (responsive); the other 3 children can ship independently of Codex-i49f's resolution.

## Recurrence ledger updates

- **NEW**: `signal:bead-is-test-plan-execution` (hits=1, beads=[Codex-u498]) — first sighting. Promotion threshold 3.
- `signal:bead-description-partially-stale` NOT bumped — zero existing coverage for nav-redesign components, so no sub-items are pre-resolved.
- `signal:bead-cites-nonexistent-feature` NOT bumped — every component referenced exists at the expected path.

## Bead labels applied

- `triage`
- `triage:rung-3`
- `triage:iter-012`

(NOT applied: `triage:routing:*` — waits for user answer in next session.)

## Bead status

`status=in_progress` — held across the user's `AskUserQuestion`. Next session's apply pass (`--apply --bead=Codex-u498`) will:
- Apply the user's chosen routing option (A/B/C/D)
- Either close Codex-u498 (Option A close-on-pass) or split into 4 child beads (Option B) or hand off (Option C) or label `triage:routing:defer` (Option D)
- Reset `status=open` if the cycle aborts

## Question payload returned to parent

```
needsUser: true
rung: 3
beadId: Codex-u498
question: "WP-10 has 21 verification checks across 11 new nav components with zero existing E2E coverage. How should we approach?"
options:
  - label: "Split into 4 child beads (Recommended)"
    description: "Codex-u498.1 desktop sidebar / .2 mobile / .3 command palette / .4 a11y+responsive+auth+transitions. Each child drains as rung-2 spec-authoring matching team's per-flow E2E convention."
    next: "split"
  - label: "One bundled verification PR"
    description: "Run all 21 checks via chrome-devtools+playwright MCPs in one cycle. High context, single commit, harder to revert."
    next: "one-pr"
  - label: "Spawn /design-system or /backend-dev"
    description: "Hand off verification to a domain skill — but neither owns E2E spec authoring as primary surface."
    next: "spawn-skill"
  - label: "Defer until Codex-i49f (WP-11) ships"
    description: "Block on WP-11 cleanup of _creators/+layout.svelte Header imports first to avoid T-09 spurious failures on /creators."
    next: "defer"
recommendedOption: "split"
```
