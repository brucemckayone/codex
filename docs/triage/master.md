# Triage — Master Status Board

> Generated and maintained by the `/triage` skill. Do not edit by hand outside of dismissing items.
> See `.claude/skills/triage/SKILL.md` for the workflow.

## ⚠️ Promoted routing rules

_None yet. Rules accumulate as recurrence patterns hit 3+ within a 6-cycle window. See `.claude/skills/triage/references/02-routing-rules.md`._

---

## Ladder snapshot

<!-- LADDER START -->

_Snapshot timestamp_: 2026-04-27 (iter-003: re-classified Codex-y6x9j 4→1 + closed)
_Eligibility filter_: excludes `denoise:*`, `ds-review*`, `fallow-followup` (owned by other skills) and 4 in-progress beads + Codex-ttavz.12 (routed iter-001) + Codex-fcdkk + Codex-y6x9j (closed iter-002 + iter-003).

| Rung | Count | Top by priority |
|------|-------|-------------------|
| 0 — Trivial | 0 | — |
| 1 — Mechanical | 0[^iter003-r1] | — |
| 2 — Scoped | 1 | Codex-v5bzy (P1) — needs design choice (a/b reconcile) |
| 3 — Multi-file | 21 | Codex-x0pa (P0), Codex-6axi0 (P1), Codex-i49f (P1), Codex-u498 (P1), Codex-d3g6 (P1) |
| 4 — Design-needed | 5 | Codex-ev3k (P1 epic), Codex-cbbet (P2 epic), Codex-zp30d (P2), Codex-r4woq (P2 epic), Codex-84b53 (P2 epic) |

[^iter003-r1]: iter-003 re-classified Codex-y6x9j (was rung-4 in iter-002 due to misread `.env` regex hit; actual fix is a single-site mechanical replacement of an inline slug-resolve block with the existing `@codex/worker-utils` `invalidateOrgSlugCache` helper). Resolved + closed this cycle. Rung-1 queue is now empty per skill design (rung-2+ deferred under /loop policy override).

<!-- LADDER END -->

---

## Cycle history

| Iter | Date | Rung | Bead | Action | Outcome |
|------|------|------|------|--------|---------|
| iter-001 | 2026-04-27 | 3 | Codex-ttavz.12 | routed to /backend-dev (wire-up planned functionality) | bead remains open with labels triage:routing:backend-dev + triage:needs-design; user will invoke /backend-dev next session to wire forms + fix typo |
| iter-002 | 2026-04-27 | 1 | Codex-fcdkk | mechanical: corrected `repoRoot` path in 5 iter-012 proof tests (6→5 dotdot levels) | closed; tests collect cleanly + repoRoot now resolves to actual repo root (verified via node fs check) |
| iter-003 | 2026-04-27 | 1 | Codex-y6x9j | mechanical: replaced inline slug-resolve+invalidate block in `workers/organization-api/src/routes/settings.ts` with existing `invalidateOrgSlugCache` helper from `@codex/worker-utils` (R14). Re-classified from rung-4 (iter-002) to rung-1 — earlier classifier matched a `.env` regex on description text; reread shows pure mechanical helper-extract. | closed; F2-dup-slug-resolve-invalidate proof test extended to include settings.ts and passes (1/1); existing settings.test.ts passes (24/24); typecheck clean |

---

## Recurrence watches

_None yet. Patterns at hits=2 (one cycle from threshold) appear here for visibility before they auto-promote._

---

## Stop criteria

A cycle exits early without producing a triage decision if:

- The open backlog is < 10 beads (use `bd ready` directly instead).
- `bd sync` is dirty / out of sync — risk of misclassification.
- The current user has > 0 in_progress beads claimed in another agent — wait for that work to land.

A bead is removed from the ladder if:

- It is closed by another skill or by hand.
- It is reassigned to another owner via `bd update`.
- It moves to `in_progress` under another agent.

---

## Notes

The master board is updated in step 7 of every cycle. It is the source-of-truth for what `/triage` will pick next; if the snapshot diverges from the actual `bd` state, the next cycle's classify step refreshes it.

Diff with denoise's `master.md`: triage doesn't track 12 cells (denoise's matrix). It tracks 5 rungs (the complexity ladder). Cycle history rows include the bead ID resolved or escalated, not just the cell.
