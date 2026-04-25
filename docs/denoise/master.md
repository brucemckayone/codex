# Denoise — Master Status Board

> Generated and maintained by the `/denoise` skill. Do not edit by hand outside of dismissing diffs.
> See `.claude/skills/denoise/SKILL.md` for the workflow.

## ⚠️ R7 single-hit security promotion — R10 queued, R9 applied

- **R9 (applied iter-003)** — `security:auth-endpoint-no-ratelimit` from iter-002 F1. Hard rule added to local SKILL.md §1 with citation `<!-- R9 promoted from iter-002, fingerprint security:auth-endpoint-no-ratelimit -->`.
- **R10 (queued for iter-004)** — `security:missing-csp` from iter-003 F2 (severity=blocker, fingerprint starts with `security:`). Iter-004's first action MUST add R10 to SKILL.md §1 with citation `<!-- R10 promoted from iter-003, fingerprint security:missing-csp -->`. Suggested rule text in iter-003.md F2.

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
| security × apps/web | iter-003 (2026-04-26) | 5 | 0 | 2026-04-26 | skipped (no churn since iter-003) |
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
| `web:auth-remote-broken-endpoint` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint, BLOCKER (Codex-ttavz.12) |
| `security:missing-csp` | 1 | 2026-04-26 | 2026-04-26 | **PROMOTED → R10 (queued for iter-004 prep)** (Codex-ttavz.13, BLOCKER) |
| `security:missing-hsts` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint, major (Codex-ttavz.14) |
| `web:auth-form-orphan-rpc-surface` | 1 | 2026-04-26 | 2026-04-26 | tracked, NEW fingerprint, major (Codex-ttavz.15) |
| `workers:waituntil-no-catch` | **2** | 2026-04-26 | 2026-04-26 | **recurrence #2 of 3** (Codex-ttavz.9, .16) — 1 more triggers R-rule |

**Promotion threshold**: ≥3 hits in trailing 6 cycles → promoted to a hard rule (R9+) in SKILL.md §1.
**Single-hit security exception**: severity=blocker security findings may promote on first sighting. (Fired in iter-002 for F1, in iter-003 for F2.)

---

## Table C — Testability-bug rate (R8 watch)

| Iter | Total findings | Testability-bugs | Rate | Threshold (15%) |
|------|----------------|------------------|------|-----------------|
| iter-001 | 6 | 0 | 0% | within budget |
| iter-002 | 5 | 0 | 0% | within budget |
| iter-003 | 5 | 0 | 0% | within budget |

> R8 fires when rate > 15% in any cycle. The next cycle's prep includes a meta-warning and a justification audit of every testability-bug.

---

## Audit history

| Iter | Cell | Date | Findings | Beads | Notes |
|------|------|------|----------|-------|-------|
| iter-001 | security × packages | 2026-04-25 | 6 (0B/0M/6m) | Codex-ttavz.1–6 | Cycle 0; fabrication check found 4 stale citations across references 01 + 07 (F3–F6) |
| iter-002 | security × workers | 2026-04-26 | 5 (1B/1M/3m) | Codex-ttavz.7–11 | Cycle 0 for cell; F1 BLOCKER (auth rate-limiter stale paths); R7 single-hit promotion fired for `security:auth-endpoint-no-ratelimit` → R9 queued; 2 new doc-rot in ref 06 (F4 = constructEvent vs constructEventAsync; F5 = ctx.storage.transaction / alarmInFlight) |
| iter-003 | security × apps/web | 2026-04-26 | 5 (2B/2M/1m) | Codex-ttavz.12–16 | Cycle 0 for cell; **R9 applied at start** (security:auth-endpoint-no-ratelimit promoted to local SKILL.md §1); F1 BLOCKER (auth.remote.ts forgot/forget-password typo silently breaks reset); F2 BLOCKER (apps/web ships with NO CSP header — R10 queued for iter-004); F3 major (no HSTS); F4 major (orphan auth RPC surface — 3 .remote.ts forms with 0 consumers); F5 minor recurrence #2 of `workers:waituntil-no-catch` in apps/web/src/lib/server/brand-cache.ts |

---

## Next-cycle prep

- **PROMOTION (highest priority)**: iter-004's first action is to add R10 to local SKILL.md §1 Hard Rules table:
  > **R10** | apps/web (and any SvelteKit-on-Cloudflare deployment) MUST set `Content-Security-Policy` either via `kit.csp.directives` in `svelte.config.js` or via response headers in `hooks.server.ts`. Verified by an integration test that requests `/` and asserts `Content-Security-Policy` is present in the response headers. | Blocker

  With citation comment `<!-- R10 promoted from iter-003, fingerprint security:missing-csp -->` above the §1 table.

- **Suggested next cell**: Security row is now COMPLETE for cycle 0 (packages → workers → apps/web all audited). Move to **types phase**. Per phase priority + churn, **`types × apps/web`** is the heaviest churn surface (464 churned files in 14d, fresh axis on recent ShaderHero / AudioPlayer / branding work). Alternative: `types × packages` (~85 files, smaller report).
- **F1 + F4 entanglement (Codex-ttavz.12 + .15)**: fix in same PR. Prefer DELETING the orphan exports (page actions canonical) per memory `feedback_minimal_ux_change.md`.
- **F2 + F3 entanglement (Codex-ttavz.13 + .14)**: same hooks.server.ts edit. Add CSP via `kit.csp.directives` in svelte.config.js (preferred — SvelteKit's framework support handles nonce injection) AND HSTS in securityHook.
- **F5 (Codex-ttavz.16)**: trivial 2-line fix on brand-cache.ts. Recurrence #2 of `workers:waituntil-no-catch`. One more sighting in iter-004-006 promotes per R7's standard 3-hit threshold.
- **Pending watches** (carry-forward):
  - `packages:identifier-no-shape-validation` (iter-001 F2) — add to ref 07 §7 if recurs
  - `security:public-route-no-ratelimit` (iter-002 F2) — add to ref 01 §8 row 13 if recurs
  - `web:auth-remote-broken-endpoint`, `web:auth-form-orphan-rpc-surface`, `security:missing-hsts` (iter-003) — track for recurrence
- **Doc-rot fixes (Codex-ttavz.3–6, 10–11)**: when these land, re-run cycle 0 fabrication checks on affected cells.
- **Companion finding to Codex-ttavz.11**: when ref 06 §4 + row 9 are rewritten against `orphaned-file-cleanup-do.ts`, audit that DO for actual idempotency. If none, file a NEW workers-security finding.
- **Stop criterion countdown**: `security × packages` 1/3, `security × workers` 0/3, `security × apps/web` 0/3. All reset on new findings.
