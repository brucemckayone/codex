# Triage iter-007 — 2026-04-28

## Summary

Auto mode `/triage` cycle. Picked **Codex-tj03p** (P4 stale-doc bug, rung-0). Closed.

## Cycle context

- Brief flagged that iter-006's ladder snapshot showed rung 0/1 = 0 — but the
  iter-006 classify pass implicitly bucketed several P3/P4 candidates at rung-3
  by priority alone (no per-bead reread). Auto-mode policy this cycle: scan
  rung-0 first, then rung-1; skip-and-pick-next at rung 2+.
- 142 open beads total. After excluding `denoise:*` (without proof-test path),
  `ds-review*`, `fallow-followup`, in-progress (Codex-2rol/Codex-shea/Codex-illw/Codex-bxb8),
  Codex-6axi0 (just verified, blocked), and previously-triaged beads,
  60 candidates remained.
- Rung-0/1 candidates surfaced: Codex-tj03p (rung-0 doc fix), Codex-mm0z9
  (rung-1 CSS sweep, 120 sites). Picked Codex-tj03p per ladder rule
  (lowest non-empty rung first).

## Bead picked: Codex-tj03p

**Title**: Fix stale doc: phase-3-studio-ui.md incorrectly marks SETTINGS_NAV unused
**Priority**: P4
**Type**: bug
**Description**: claimed `routes/_org/[slug]/studio/settings/+layout.svelte:15`
imports `SETTINGS_NAV` from `$lib/config/navigation.ts:79` — and that the doc's
"unused" claim was therefore stale.

## Pre-flight grep verification

```
$ grep -rn "SETTINGS_NAV" /Users/brucemckay/development/Codex/apps/web/src/
(no matches)
```

The `SETTINGS_NAV` symbol does not exist anywhere in the codebase. The bead's
description is itself self-contradictory — a non-existent symbol cannot be
"unused" or "imported." Reading the actual files:

- `apps/web/src/lib/config/navigation.ts` exports `PLATFORM_NAV`, `STUDIO_NAV`,
  `SIDEBAR_BASE_LINKS`, `SIDEBAR_ADMIN_LINKS`, `SIDEBAR_OWNER_LINKS`,
  `SIDEBAR_PERSONAL_LINKS`, `ACCOUNT_NAV`. No `SETTINGS_NAV`.
- `apps/web/src/routes/_org/[slug]/studio/settings/+layout.svelte` does NOT
  import from `$lib/config/navigation`. Its tabs are a `$derived` array
  defined locally (lines 42–58) with i18n-keyed labels.

So the doc's claim that the settings nav is hardcoded **is correct** — but
its parenthetical reference to "the unused `SETTINGS_NAV` array in
`navigation.ts`" is to a phantom symbol. The achievable directional fix
matching the bead's intent: rewrite the parenthetical to drop the phantom
reference and clarify WHY the tabs live locally.

## Fix applied

`docs/pricing-page/phase-3-studio-ui.md:154`:

Before:
> The settings nav is **hardcoded in the layout** (NOT from the unused
> `SETTINGS_NAV` array in `navigation.ts`).

After:
> The settings nav is **hardcoded in the layout** as a `$derived` `tabs`
> array. It is not driven from `$lib/config/navigation.ts` — the settings
> tab list is intentionally local to the settings layout because each tab
> has i18n-keyed labels and bespoke `value`/`href` pairs that don't fit
> the shared `NavLink` shape used by `SIDEBAR_*_LINKS` / `ACCOUNT_NAV`.

## R10 gate

Case (c) — pure docs, no testable behaviour. Justification: the edit is to
a Markdown design doc; no code, type, or runtime path changed. The
correctness of the fix is asserted by the prose itself ("the settings tabs
ARE hardcoded — confirmed by reading the file").

## Recurrence increments

- **NEW**: `signal:bead-description-self-contradicts-codebase` — first sighting.
  Hits=1. Will promote to a hard rule at 3+ hits: "cycle agent MUST grep for
  the cited symbol/string before applying any rung-0/1 fix; if zero matches,
  treat the bead as needing reinterpretation."
- **Counter-example logged on RT1** (`signal:auto-loop-skip-rung-2-plus`):
  iter-007 found a rung-0 candidate without brief hints. RT1 hits stays at 3
  (no demotion), but the rule's stated certainty is reduced — the iter-006
  ladder snapshot was incomplete because no prior cycle had reread P4-priority
  beads. This is informational, not a counter-example strong enough to demote
  the rule.

## Labels applied

- `triage`
- `triage:rung-0`
- `triage:iter-007`

## Outcome

Closed (`bd close Codex-tj03p`). One commit covering the doc edit + artifact
updates.

## Files changed

- `docs/pricing-page/phase-3-studio-ui.md` (1 line rewritten, surrounding
  context expanded)
- `docs/triage/master.md` (cycle history row + ladder snapshot refresh)
- `docs/triage/recurrence.json` (new pattern entry + RT1 counter-example note)
- `docs/triage/iter-007.md` (this file)

## Backlog state at end of cycle

- Rung 0: 0 (drained)
- Rung 1: 1 (Codex-mm0z9 — 120-site CSS sweep, P3, candidate for next cycle)
- Rung 2: 2 (Codex-70xgd, Codex-3u505)
- Rung 3: 21 (top: Codex-x0pa P0, Codex-i49f P1, Codex-u498 P1, Codex-d3g6 P1)
- Rung 4: 5 (Codex-ev3k P1 epic, Codex-cbbet P2 epic, Codex-zp30d P2,
  Codex-r4woq P2 epic, Codex-84b53 P2 epic)

## Notes for next cycle

- Codex-mm0z9 is the next clear rung-1 target. 120 byte-identical replacements
  of `outline-offset: 2px` → `outline-offset: var(--space-0-5)` across
  apps/web/src. Recipe: single sed-style replace, verify zero false-positives
  by re-running the grep, no behavioural test needed (R10 case (c) — CSS
  token swap with no JS behaviour). Note: bead description only mentions 2
  sites but actual scope is 120; consider re-scope-check before pick.
- Bead description audit candidate: a follow-up cycle could pre-grep all open
  beads' cited file:line claims to detect more `signal:bead-description-self-contradicts-codebase`
  cases. Out of scope for iter-007 (R1 — one bead per cycle).
