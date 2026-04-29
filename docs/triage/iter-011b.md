# iter-011b — Rung-3 Walk: Codex-i49f (Nav Redesign WP-11 Review & Cleanup)

> Concurrent /triage cycle. iter-011 (predecessor) walked Codex-x0pa (held by another agent — HARD EXCLUDED).
> iter-011a was a reconciliation pass already committed at `c54cdb5a`.
> iter-011b adopted suffix per RT3 second-agent collision protocol; picked next-highest-priority rung-3 candidate.

## Cycle inputs

- Iter ID: `iter-011b`
- Target rung: **3** (forced by parent — rungs 0/1/2 lanes empty per current ladder snapshot)
- Hard exclusions: Codex-x0pa (concurrent agent), Codex-6axi0 (blocked), Codex-70xgd (just walked iter-010a).
- Pick rule: default — Codex-i49f (P1) initial candidate; fall through to Codex-u498 (P1) if collision detected.

## Pre-flight collision-check (RT3 / new `signal:concurrent-unclaimed-work-detected-pre-pick`)

Stronger four-check protocol per brief:

1. **`bd show Codex-i49f --json`** — status=open, owner=brucemckayone@gmail.com (current user). No `triage:in-progress-other-agent` label. Dependencies show Codex-u498 still open (WP-10 verification).
2. **`git log --oneline --since="48 hours" -- <cited file paths>`** — last commit touching nav-redesign component file space was `be1ddd0d` (iter-008 CSS token sweep, incidental). No bead-ID-citing commits. **Clear.**
3. **`git status --short`** — only `.beads/bd.sock.startlock` (M) + agent worktrees from older runs. No dirty hunks in nav-redesign code. **Clear.**
4. **Worktree-staleness scan** — `ls -la .claude/worktrees/`: most recent worktree mtime `28 Apr 22:41`. None modified in the last hour. No branch names suggest active Codex-i49f work. **Clear.**

**Verdict**: `none` — `signal:concurrent-unclaimed-work-detected-pre-pick` did NOT fire. Initial pick stands. `recurrence.json` does NOT increment for this fingerprint (would only increment if pre-flight had revealed a collision).

## Bead summary

| Field | Value |
|---|---|
| ID | Codex-i49f |
| Title | [Nav Redesign] WP-11: Review & Cleanup |
| Priority | P1 |
| Status | open |
| Owner | brucemckayone@gmail.com |
| Created | 2026-04-08 |
| Dependencies | Codex-u498 (P1, open) — WP-10 verification |
| Labels (pre-cycle) | none |

**Description**: Final code review using pr-review-toolkit agents (code-reviewer, silent-failure-hunter, type-design-analyzer, comment-analyzer). Deprecate old header components with removal date. Update barrel exports. Verify no remaining imports of deprecated components. `pnpm typecheck + build` pass. See `docs/nav-redesign/WP-11-review-cleanup.md` for full spec.

**Spec doc** (`docs/nav-redesign/WP-11-review-cleanup.md`, 173 lines): 7 phases — code review (pr-review-toolkit), silent-failure hunt, type-design review, comment review, deprecation/cleanup, final build check, test coverage review.

## Classification reasoning

### R8 check (no `file:line` → auto-rung-3)

Bead description cites a **document** (`docs/nav-redesign/WP-11-review-cleanup.md`) that itself lists ~6 specific files for deprecation, an explicit barrel-export file path, and a grep recipe. Treating this as locator-cited (the doc IS the locator). R8 does **not** auto-fire.

### Cross-package / multi-file gate

Files explicitly named in the spec doc:

- `apps/web/src/lib/components/layout/Header/{Header,OrgHeader,PlatformHeader,StudioHeader,MobileNav,UserMenu}.svelte` (6 files — deprecation comments)
- `apps/web/src/lib/components/layout/index.ts` (1 file — barrel exports, currently does not exist)
- `CommandPaletteSearch.svelte` + `/api/search/+server.ts` + `MobileBottomSheet.svelte` (silent-failure hunt scope)
- All "new files" with `Props` interfaces (type-design-analyzer scope — at minimum SidebarRail/SidebarRailItem/SidebarRailUserSection/MobileBottomNav/MobileBottomSheet × `.svelte` = 5 files)
- `_creators/+layout.svelte` (last leaking deprecated-import call site — see staleness finding below)
- Plus build/typecheck verification gates.

Touches **>= 12 files in 1 package** (`apps/web`) plus 4 review-agent passes. Not multi-package, but multi-file + multi-phase + multi-agent. This is genuine rung-3 territory — the work is gated on running 4 different `pr-review-toolkit` review agents and reconciling their outputs.

### Staleness finding — `signal:bead-description-partially-stale` THIRD HIT

Significant pre-flight evidence that the bead's deprecation/cleanup phase is **partially stale**:

| WP-11 plan item | Reality on disk (2026-04-29) |
|---|---|
| Add `@deprecated — Replaced by SidebarRail/MobileBottomNav. Remove after 2026-04-22.` to 6 Header/* files | 4 of 6 files (`Header.svelte`, `OrgHeader.svelte`, `PlatformHeader.svelte`, `StudioHeader.svelte`) are **already deleted** — `ls apps/web/src/lib/components/layout/Header/` returns only `MobileNav.svelte` + `UserMenu.svelte`. The 2026-04-22 removal date is **7 days past** as of today. |
| Update `apps/web/src/lib/components/layout/index.ts` barrel exports with new + deprecated re-exports | File **does not exist**. Consumers all deep-import from subdirectory index files (`$lib/components/layout/SidebarRail`, `$lib/components/layout/MobileNav`). Barrel may not even be needed. |
| Verify no remaining imports of deprecated components | `_creators/+layout.svelte` (lines 12–13) still imports `UserMenu` + `MobileNav` from `$lib/components/layout/Header/` — the **one** real cleanup gap on the migration. `(platform)/+layout.svelte` and `_org/[slug]/+layout.svelte` already use new `MobileBottomNav` + `MobileBottomSheet`. |
| Run `pr-review-toolkit:*` agents on changed files | Original change-set window is **3 weeks old** — running review agents now reviews everything-and-the-kitchen-sink (other denoise/triage/audit work has overlaid the surface since); the audit value diverges from the WP-11 intent. |

So WP-11's mechanical-cleanup phases (deprecate 6 files, update barrel) are **mostly complete** by accident-of-other-work; the surviving genuine gaps are:

- **G1**: Migrate `_creators/+layout.svelte` lines 12–13 off `Header/UserMenu` + `Header/MobileNav` onto the new SidebarRail / MobileBottomNav system. Single file, ~30 LoC. **Rung-1-shaped sub-bead.**
- **G2**: Decide whether to delete the two surviving leaf files (`Header/UserMenu.svelte` + `Header/MobileNav.svelte`) or keep them gated until creators-subtree migrates. Depends on G1.
- **G3**: Decide whether the barrel `apps/web/src/lib/components/layout/index.ts` is still useful (consumers deep-import; barrel might be dead). Single file decision.
- **G4**: The actual "review" phases (code-reviewer / silent-failure-hunter / type-design-analyzer / comment-analyzer) on the **new** components — SidebarRail, MobileBottomNav, MobileBottomSheet, CommandPaletteSearch — which is the genuinely-open quality work, not stale.
- **G5**: Run `pnpm typecheck + build` to confirm the system compiles cleanly today. Pure verification, fast feedback.

This is the 3rd DISTINCT bead-recurrence of `signal:bead-description-partially-stale` (after Codex-d3g6 iter-009a and Codex-x0pa iter-011) — **promotion threshold reached**. See recurrence section below.

### Dependency / WP-10 status

Dependency `Codex-u498` (WP-10 verification — 10 manual + 11 Playwright tests) is **still open** with no triage labels. WP-10 cannot be auto-completed by /triage because it's gated on browser-MCP verification (Playwright tool calls + Chrome DevTools MCP). This is a known pattern (iter-009a declined Codex-x0pa + Codex-u498 for the same reason: "both are E2E browser-MCP-gated tasks that sub-agents cannot frame approach options for").

The bead's status quo says "WP-11 starts after WP-10 ships". But:

- Several phases (deprecation cleanup + barrel + grep guard) are independent of "WP-10 verification passed";
- WP-10 has been blocking-but-stale for ~3 weeks (filed 2026-04-08, no movement);
- The bead is misjudgement-shaped: WP-10's verification IS the review phase that WP-11 also schedules.

This strengthens the case for splitting WP-11 into rung-1 cleanup beads (drainable now) and parking the "review-agent pass" portion behind WP-10 (or merging the two — see Option B below).

## Routing options

Four bounded approaches surfaced for the user's choice. Recommendation: **Option B**.

### Option A — One PR (apply WP-11 as written)

**Short**: A future apply-cycle drives WP-11 end-to-end: deprecation cleanup, barrel update, grep guards, run all 4 pr-review-toolkit agents on the new components, fix anything they raise, commit single PR.

**Tradeoff**: Honours the original spec. But: (a) ~50% of "deprecation" work is no-op (files already deleted); (b) the barrel-export task may be unnecessary; (c) "review agents on changed files" 3 weeks post-change is broader than WP-11 intended; (d) bundles a real rung-1 fix (`_creators/+layout.svelte` migration) with 4 review-agent passes that may surface their own beads — likely produces a sprawling PR with mixed velocities.

**Effort estimate**: 2–3 sessions, 1 review-agent each, plus apply phase. ~150–400 LoC across ~8–12 files.

### Option B — Split into 4 child beads (RECOMMENDED)

**Short**: File 4 sub-beads via parallel `bd create`:

- **Codex-i49f.1** — *rung-1*: Migrate `_creators/+layout.svelte` lines 12–13 to new SidebarRail/MobileBottomNav. Delete `Header/UserMenu.svelte` + `Header/MobileNav.svelte` after migration. ~30 LoC, 3 files.
- **Codex-i49f.2** — *rung-1*: Decide barrel exports — either create `apps/web/src/lib/components/layout/index.ts` per spec, or delete the spec line if deep-imports are the convention. ~10 LoC, 1 file.
- **Codex-i49f.3** — *rung-3*: Run `pr-review-toolkit:code-reviewer` + `silent-failure-hunter` + `type-design-analyzer` + `comment-analyzer` on the new nav components only (SidebarRail/MobileBottomNav/MobileBottomSheet/CommandPaletteSearch). File a sub-bead per finding. Quality work, can land independently.
- **Codex-i49f.4** — *rung-1*: `pnpm typecheck + build` verification + console-error spot check on dev. Pure verification gate. Closes when both pass clean.

Codex-i49f becomes parent (epic-shaped), closes after .1 + .2 + .4 close + .3 spawns its own sub-beads. WP-10 (Codex-u498) stays as parallel browser-MCP work.

**Tradeoff**: Honours the team's per-flow split convention (matches iter-011's recommended path for Codex-x0pa). Lets a future /triage cycle drain .1 + .2 + .4 as auto-resolvable rung-1 work without re-investigating the stale deprecation phases. Costs: 4 `bd create` calls now, ~3 lines of dependency wiring.

**Effort estimate**: ~5 minutes to file the 4 sub-beads. Then .1 + .2 + .4 each ~10–20 minutes apply pass. .3 is open-ended quality work.

### Option C — Spawn /design-system

**Short**: Hand off WP-11 entirely to `/design-system` skill (which owns nav/visual review under its v2 mandate). /design-system runs the 4 review agents on the new components as part of its standard sweep, surfaces a recursive-review iteration with R-rules + ds-review beads.

**Tradeoff**: Strongest quality outcome — /design-system has 5-iteration recursive-review loop and DS-skill MCP gate. But: (a) /design-system is heavier than this bead needs (G1+G2 are not design-system work, they're mechanical cleanup); (b) /design-system already produced 36 ds-review beads in its last sweep — adding more may overload that backlog.

**Effort estimate**: 1 /design-system invocation (~30–60 min), + cleanup of any ds-review beads it surfaces.

### Option D — Defer

**Short**: Mark `triage:routing:defer`. The deprecation phase is mostly done by accident; the live gap (G1) is small enough to file as a single rung-1 bead later; the quality-review phase can wait until the user re-prioritises.

**Tradeoff**: Lowest cost now. But: leaves G1 (`_creators/+layout.svelte` import leak) un-addressed indefinitely, which means the deprecated `Header/MobileNav.svelte` + `Header/UserMenu.svelte` files keep shipping in the bundle. Mild byte-cost, no correctness impact.

## Recommended

**Option B** — Split into 4 children.

**Reason**: Honours the partially-stale fingerprint (drains the genuinely-open work as rung-1 mechanical, parks the open-ended quality work as a discoverable parent). Matches iter-011's recommendation shape for Codex-x0pa (also rung-3 partially-stale). Doesn't bundle the fast G1 fix behind the slower G3 review work. Leaves WP-10 as parallel browser-MCP work (correct domain separation).

## R8 / cross-package / R10 gate notes

- **R8**: did not fire — bead cites a doc that lists explicit file paths.
- **Cross-package**: single package (apps/web), but multi-file + multi-phase + multi-agent. Rung-3 by virtue of phase-count + agent-count, not file-spread.
- **R10**: not applicable — rung-3 walk-only cycle. R10 fires on rung 0–1 close.

## Recurrence increments

- **`signal:bead-description-partially-stale`**: hits 2 → **3** (Codex-d3g6 iter-009a + Codex-x0pa iter-011 + **Codex-i49f iter-011b**). **PROMOTION-ELIGIBLE per §7 R6 (3+ hits within 6-cycle window).** Iters of evidence: iter-009a, iter-011, iter-011b (3 distinct beads, 3 distinct cycles). Recommended next-cycle action: queue an `AskUserQuestion` confirmation for promotion to **RT4** with draft rule text: *"when a bead lists N sub-items and any of them is partially stale at pickup, the cycle MUST surface the staleness in the iter doc + question payload + propose split-into-N-children as a default option so future cycles drain the genuinely-open sub-items as rung-1 mechanical work without re-investigating the resolved ones."* See `recurrence.json` verdict_history append for full reasoning.
- **`signal:concurrent-unclaimed-work-detected-pre-pick`**: NEW fingerprint per brief instruction — but this cycle's pre-flight returned `none` (no signal fired). Per brief: only increment if pre-flight TRIPS the signal. **Not incremented.** Ledger entry skeleton added with hits=0 + notes-only definition (so future cycles can find the fingerprint by name without re-deriving it).
- **`signal:concurrent-cycle-suffix`** (PROMOTED RT3): post-promotion verdict_history append for iter-011b. Hits stays at 3 (frozen at promotion per RT3 promotion-freezing semantics). This is the 5th sighting (iter-005a, iter-009a, iter-010a, iter-011a, iter-011b) — RT3 protocol still validated zero-friction.

## Bead labels applied

- `bd label add Codex-i49f triage`
- `bd label add Codex-i49f triage:rung-3`
- `bd label add Codex-i49f triage:iter-011` (per RT3 suffix-stays-in-doc convention; bead label uses the un-suffixed iter id)

No routing label until user answers (R3 — rung-3 walk-only).

## Files touched (artifact-only — read-only on production code)

- `docs/triage/iter-011b.md` (this file, NEW)
- `docs/triage/master.md` (cycle-history row appended; ladder snapshot counts UNCHANGED per RT3 step 4)
- `docs/triage/recurrence.json` (`signal:bead-description-partially-stale` bumped 2 → 3 + verdict_history append; `signal:concurrent-unclaimed-work-detected-pre-pick` ledger skeleton added at hits=0 + notes-only; `signal:concurrent-cycle-suffix` verdict_history append)

## Stop-and-ask payload (returned to parent as data)

See structured return at the bottom of the cycle agent's response. Parent will render via `AskUserQuestion`.
