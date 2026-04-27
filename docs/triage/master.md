# Triage — Master Status Board

> Generated and maintained by the `/triage` skill. Do not edit by hand outside of dismissing items.
> See `.claude/skills/triage/SKILL.md` for the workflow.

## ⚠️ Promoted routing rules

_None yet. Rules accumulate as recurrence patterns hit 3+ within a 6-cycle window. See `.claude/skills/triage/references/02-routing-rules.md`._

---

## Ladder snapshot

<!-- LADDER START -->

| Rung | Count | Top 5 by priority |
|------|-------|-------------------|
| 0 — Trivial | _not-classified_ | — |
| 1 — Mechanical | _not-classified_ | — |
| 2 — Scoped | _not-classified_ | — |
| 3 — Multi-file | 1[^1] | Codex-ttavz.12 (P0) |
| 4 — Design-needed | _not-classified_ | — |

[^1]: `iter-001` was a `--bead=Codex-ttavz.12` cycle, not a full-queue classify. Counts above reflect ONLY the single bead routed through the classifier this iter; the rest of the open backlog is unclassified. A full-queue classify pass will run when the next `/triage` invocation has no `--bead=` flag.

<!-- LADDER END -->

---

## Cycle history

| Iter | Date | Rung | Bead | Action | Outcome |
|------|------|------|------|--------|---------|
| iter-001 | 2026-04-27 | 3 | Codex-ttavz.12 | routed to /backend-dev (wire-up planned functionality) | bead remains open with labels triage:routing:backend-dev + triage:needs-design; user will invoke /backend-dev next session to wire forms + fix typo |

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
