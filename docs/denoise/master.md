# Denoise — Master Status Board

> Generated and maintained by the `/denoise` skill. Do not edit by hand outside of dismissing diffs.
> See `.claude/skills/denoise/SKILL.md` for the workflow.

## ⚠️ R7 single-hit security promotion queued

`security:auth-endpoint-no-ratelimit` qualified for R7 single-hit security promotion in iter-002 (severity=blocker, fingerprint starts with `security:`). The NEXT cycle's first action MUST add a hard rule **R9** to SKILL.md §1 with citation `<!-- R9 promoted from iter-002, fingerprint security:auth-endpoint-no-ratelimit -->`. See iter-002.md "Next-cycle prep" for suggested rule text.

---

## Diffs awaiting review

_None._

> CLAUDE.md regeneration diffs land at `docs/denoise/claude-md-diffs/`. Review and `git apply` (or dismiss).
> R5 forbids auto-applying diffs. Diffs older than 14 days block the cycle they belong to from closing.

---

## Table A — 12-cell status board

| Cell | Last run | Open findings | Open testability-bugs | Last checked | Next due |
|------|----------|---------------|------------------------|--------------|----------|
| security × packages | iter-001 (2026-04-25) | 6 | 0 | 2026-04-25 | skipped (no churn since iter-001) |
| security × workers | iter-002 (2026-04-26) | 5 | 0 | 2026-04-26 | skipped (no churn since iter-002) |
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
| `security:auth-endpoint-no-ratelimit` | 1 | 2026-04-26 | 2026-04-26 | **PROMOTED → R9 (queued for next cycle prep)** (Codex-ttavz.7, BLOCKER) |
| `security:public-route-no-ratelimit` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint, major (Codex-ttavz.8) |
| `workers:waituntil-no-catch` | 1 | 2026-04-26 | 2026-04-26 | tracked (Codex-ttavz.9) |
| `denoise:doc-rot:06-domain-workers:row11` | 1 | 2026-04-26 | 2026-04-26 | tracked, doc-rot (Codex-ttavz.10) |
| `denoise:doc-rot:06-domain-workers:row9` | 1 | 2026-04-26 | 2026-04-26 | tracked, doc-rot (Codex-ttavz.11) |

**Promotion threshold**: ≥3 hits in trailing 6 cycles → promoted to a hard rule (R9+) in SKILL.md §1.
**Single-hit security exception**: severity=blocker security findings may promote on first sighting. (Fired in iter-002 for F1.)

---

## Table C — Testability-bug rate (R8 watch)

| Iter | Total findings | Testability-bugs | Rate | Threshold (15%) |
|------|----------------|------------------|------|-----------------|
| iter-001 | 6 | 0 | 0% | within budget |
| iter-002 | 5 | 0 | 0% | within budget |

> R8 fires when rate > 15% in any cycle. The next cycle's prep includes a meta-warning and a justification audit of every testability-bug.

---

## Audit history

| Iter | Cell | Date | Findings | Beads | Notes |
|------|------|------|----------|-------|-------|
| iter-001 | security × packages | 2026-04-25 | 6 (0B/0M/6m) | Codex-ttavz.1–6 | Cycle 0; fabrication check found 4 stale citations across references 01 + 07 (F3–F6) |
| iter-002 | security × workers | 2026-04-26 | 5 (1B/1M/3m) | Codex-ttavz.7–11 | Cycle 0 for cell; F1 BLOCKER (auth rate-limiter stale paths); R7 single-hit promotion fired for `security:auth-endpoint-no-ratelimit` → R9 queued; 2 new doc-rot in ref 06 (F4 = constructEvent vs constructEventAsync; F5 = ctx.storage.transaction / alarmInFlight) |

---

## Next-cycle prep

- **PROMOTION (highest priority)**: iter-003's first action is to add R9 to SKILL.md §1 Hard Rules table:
  > **R9** | Auth endpoints MUST be rate-limited via a path-prefix or path-set match against the canonical BetterAuth route names — never hard-coded literal paths that drift from the framework's routing. Verified by an integration test that posts 6× to each rate-limited path and asserts a 429 response. | Blocker

  With citation comment `<!-- R9 promoted from iter-002, fingerprint security:auth-endpoint-no-ratelimit -->` above the §1 table.

- **Suggested next cell**: `security × apps/web` (Phase C, third security cell — completes the security row before moving to types). Phase priority security > types ranks security cells ahead of types even though they're cycled. Tie-break: among due cells, `security × apps/web` is the only security cell still never-run, plus it has heavy churn from the recent shader/audio work.
- **Folded fix on F4 (Codex-ttavz.10)**: F4's PR should also patch reference 01 §8 row 5 (same `constructEvent` drift, different reference).
- **Companion finding to F5 (Codex-ttavz.11)**: when ref 06 §4 + row 9 are rewritten against `orphaned-file-cleanup-do.ts`, audit that DO for actual idempotency. If it has none, file a NEW workers-security finding.
- **Doc-rot fixes (Codex-ttavz.3–6, 10–11)**: when these land, re-run `cycle 0` fabrication checks on the affected cells.
- **F2 (security × packages)** watch: `packages:identifier-no-shape-validation` is a NEW fingerprint. Add anti-pattern row to reference 07 §7 if it recurs.
- **F2 (security × workers)** watch: `security:public-route-no-ratelimit` is a NEW fingerprint. Add anti-pattern row to reference 01 §8 (row 13) if it recurs.
- **Stop criterion countdown**: `security × packages` 1 of 3 zero-finding cycles. `security × workers` 0 of 3 (this was its first cycle and produced findings). Counters reset on new findings.
