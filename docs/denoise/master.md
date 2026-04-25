# Denoise — Master Status Board

> Generated and maintained by the `/denoise` skill. Do not edit by hand outside of dismissing diffs.
> See `.claude/skills/denoise/SKILL.md` for the workflow.

## Diffs awaiting review

_None._

> CLAUDE.md regeneration diffs land at `docs/denoise/claude-md-diffs/`. Review and `git apply` (or dismiss).
> R5 forbids auto-applying diffs. Diffs older than 14 days block the cycle they belong to from closing.

---

## Table A — 12-cell status board

| Cell | Last run | Open findings | Open testability-bugs | Last checked | Next due |
|------|----------|---------------|------------------------|--------------|----------|
| security × packages | iter-001 (2026-04-25) | 6 | 0 | 2026-04-25 | skipped (no churn since iter-001) |
| security × workers | _never_ | 0 | 0 | _never_ | **due** ✅ |
| security × apps/web | _never_ | 0 | 0 | _never_ | **due** ✅ |
| types × packages | _never_ | 0 | 0 | _never_ | **due** ✅ |
| types × workers | _never_ | 0 | 0 | _never_ | **due** ✅ |
| types × apps/web | _never_ | 0 | 0 | _never_ | **due** ✅ |
| performance × packages | _never_ | 0 | 0 | _never_ | **due** ✅ |
| performance × workers | _never_ | 0 | 0 | _never_ | **due** ✅ |
| performance × apps/web | _never_ | 0 | 0 | _never_ | **due** ✅ |
| simplification × packages | _never_ | 0 | 0 | _never_ | **due** ✅ |
| simplification × workers | _never_ | 0 | 0 | _never_ | **due** ✅ |
| simplification × apps/web | _never_ | 0 | 0 | _never_ | **due** ✅ |

**Cell-due algorithm** (delta mode):
1. `git log --since=<last_run> --name-only -- <cell-paths>` produces churn list
2. For `packages/<pkg>` cells: also walk consumer graph via `scripts/denoise/consumer-graph.ts <pkg>`
3. Cell is **due** if ANY churn detected
4. Cell is **skipped** if NO churn AND zero open findings AND zero open testability-bugs AND no untracked recurrence patterns

In `--mode=full`, all cells are due regardless of churn.

---

## Table B — Recurrence ledger

Synced from `docs/denoise/recurrence.json` after each cycle. Patterns with `hits >= 1` rendered.

| Fingerprint | Hits | First seen | Last seen | Status |
|---|---|---|---|---|
| `packages:throw-raw-error` | 1 | 2026-04-25 | 2026-04-25 | tracked (Codex-ttavz.1) |
| `packages:identifier-no-shape-validation` | 1 | 2026-04-25 | 2026-04-25 | tracked, NEW fingerprint (Codex-ttavz.2) |
| `denoise:doc-rot:07-domain-packages:row1` | 1 | 2026-04-25 | 2026-04-25 | tracked, doc-rot (Codex-ttavz.3) |
| `denoise:doc-rot:07-domain-packages:row3` | 1 | 2026-04-25 | 2026-04-25 | tracked, doc-rot (Codex-ttavz.4) |
| `denoise:doc-rot:01-security-audit:row9` | 1 | 2026-04-25 | 2026-04-25 | tracked, doc-rot (Codex-ttavz.5) |
| `denoise:doc-rot:01-security-audit:row6` | 1 | 2026-04-25 | 2026-04-25 | tracked, doc-rot (Codex-ttavz.6) |

**Promotion threshold**: ≥3 hits in trailing 6 cycles → promoted to a hard rule (R9+) in SKILL.md §1.
**Single-hit security exception**: severity=blocker security findings may promote on first sighting. (None this cycle.)

---

## Table C — Testability-bug rate (R8 watch)

| Iter | Total findings | Testability-bugs | Rate | Threshold (15%) |
|------|----------------|------------------|------|-----------------|
| iter-001 | 6 | 0 | 0% | within budget |

> R8 fires when rate > 15% in any cycle. The next cycle's prep includes a meta-warning and a justification audit of every testability-bug.

---

## Audit history

| Iter | Cell | Date | Findings | Beads | Notes |
|------|------|------|----------|-------|-------|
| iter-001 | security × packages | 2026-04-25 | 6 (0B/0M/6m) | Codex-ttavz.1–6 | Cycle 0; fabrication check found 4 stale citations across references 01 + 07 (F3–F6) |

---

## Next-cycle prep

- **Suggested next cell**: `types × packages` (Phase B). Same churn surface (~85 source files in 14d), fresh phase. Phase priority puts types ahead of performance/simplification.
- **Doc-rot fixes (Codex-ttavz.3–6)**: when these beads land, re-run the `cycle 0` fabrication check on iter-002 of `security × packages` — should report 0 stale citations.
- **F2 watch**: `packages:identifier-no-shape-validation` is a NEW fingerprint. If it recurs in any future cycle, add an anti-pattern row to reference 07 §7.
- **Stop criterion countdown**: 1 of 3 zero-finding cycles needed for `security × packages` to declare fidelity. Counter resets if any new finding lands before three clean cycles.
