---
name: codex-epic-implement
description: >
  Drive the Codex epic implementation cycle. Walks each beads WP through a strict 10-stage gated cycle
  (preflight → orient → verify → implement → test → simplify → review → fallow → regression → ship),
  refusing to advance until each gate passes, writing a bd-audit entry per stage, and invoking
  codex-review at the review stage. Replaces epic-cycle Phase B. Use when implementing the WPs of an
  epic created by codex-epic-create. NOT for one-off fixes.
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Agent, AskUserQuestion, Skill, ToolSearch
---

# Codex Epic Implement — the gated per-WP cycle

The execution half of the `codex-*` family. Each beads WP walks the 10 stages below; each stage gates
the next and emits a `bd audit` entry that `codex-epic-retro` later reads. Source of truth for the
audit schema, the gate, branch/commit conventions, and the lessons substrate is
[`docs/epics/conventions.md`](../../../docs/epics/conventions.md).

---

## §0 — When to invoke vs defer

```
Use codex-epic-implement when:
  - An epic exists (from codex-epic-create) and a WP is `bd ready`
  - You are about to write code that belongs to a tracked WP
  - /codex-epic-implement <wp-id> | <epic-id> | --next

Defer to:
  - codex-epic-create   — the feature isn't scoped/scaffolded yet
  - codex-epic-handoff  — you're ending a session mid-cycle and need a continuation prompt
  - codex-epic-retro    — the epic merged; time to harden lessons
  - a plain bd task + direct fix — change is < 1 day and not part of an epic
```

The cycle IS the architecture. **Never skip a stage. Never batch closures.**

---

## §1 — Hard Rules

| # | Rule | Why |
|---|---|---|
| R1 | One WP at a time through all 10 stages. Never batch. | Each gate catches a different defect class. |
| R2 | Write a `bd audit record` entry on every stage EXIT. | This is the trail `codex-epic-retro` measures; a missing entry is a drift signal. |
| R3 | VERIFY (stage 2) surfaces the plan and asks "what's wrong with this plan?" — not "looks good?". Redirect → back to ORIENT. | Per nmemo; catches scope drift before code. `--autonomous` skips with an `autonomous` label. |
| R4 | `codex-review` CRITICAL/HIGH must be fixed before SHIP. `silent-failure-hunter` CRITICAL = must-fix, no litigation. | 100% real-bug rate. |
| R5 | Branch `feat/<wp-id>-<slug>`. NEVER push to main/dev directly. Re-check `git branch --show-current` before every git op. | `feedback_agent_branch_not_main`, `feedback_main_worktree_head_shift`. |
| R6 | SHIP runs `gate.sh` and trusts only its terminal marker. NEVER `--no-verify`. | `feedback_run_tests_locally_before_push`; gate-exit-code-masked-by-pipe. |
| R7 | NEVER `as any` / `@ts-ignore`. Money/auth code needs positive AND negative tests. | `feedback_modularity_no_any`, `feedback_security_deep_test`. |
| R8 | Background agents work in worktree isolation; main chat orchestrates only (no edits while agents run). Clean worktrees at SHIP. | `feedback_worktree_content_bleed_bidirectional`. |
| R9 | A WP PR's base branch MUST be trunk (`dev`/`main`), never a sibling WP branch unless intentionally stacked. Verify at SHIP (stage 9). | Codex-69t7c WP9 #280 merged into the WP8 branch → stranded off `dev` → forced re-land #283. |

---

## §2 — The 10-stage cycle

| # | Stage | Gate to advance | bd-audit on exit |
|---|---|---|---|
| 0 | PREFLIGHT | on `feat/<wp>` branch off a clean tree; WP is `bd ready` | `stage-0 PREFLIGHT complete` |
| 1 | ORIENT | plan written to the WP as a bd comment; stale pointers verified; retro-scan run | `stage-1 ORIENT complete` |
| 2 | VERIFY | user confirms the plan (or `--autonomous`) | `stage-2 VERIFY complete` |
| 3 | IMPLEMENT | code compiles; Codex patterns followed | `stage-3 IMPLEMENT complete` |
| 4 | TEST | `pnpm test --filter` + `typecheck` green; pos+neg for money/auth | `stage-4 TEST complete` |
| 5 | SIMPLIFY | `/simplify` findings applied or rejected-with-reason | `stage-5 SIMPLIFY complete` |
| 6 | REVIEW | `codex-review` no CRITICAL/HIGH left; (UI) VISUAL-VERIFY MCP gate passed | `stage-6 REVIEW complete` |
| 7 | FALLOW | no new dead code / unused exports (verified vs `src/`) | `stage-7 FALLOW complete` |
| 8 | REGRESSION | full affected suite green; migration applied to fresh DB if touched | `stage-8 REGRESSION complete` |
| 9 | SHIP | `gate.sh` → `✓ ALL GATES PASSED`; worktrees clean; pushed; PR open | `stage-9 SHIP complete` |

Audit entry shape (see conventions §3):
```bash
bd audit record --kind=tool_call --issue-id=<wp> --tool-name=codex-epic-implement --prompt="stage-<N> <NAME> complete"
```

---

## §3 — Stages in detail

### Stage 0 — PREFLIGHT
```bash
git branch --show-current     # create feat/<wp-id>-<slug> if not already on it
git status                    # clean (ignore the unrelated pre-existing files; never commit them)
bd ready                      # the WP must appear with no open blockers
```

### Stage 1 — ORIENT
- `bd show <wp-id>` — read scope, acceptance, plan reference.
- **Verify stale pointers** (`feedback_stale_bead_pointers`): if the WP names files/lines/APIs/flags, grep before trusting. Treat INTENT as authoritative, POINTERS as suspect.
- Read the plan's "Critical Files Reference" for this WP.
- **Retro-scan**: `scripts/retro-scan.sh <module(s)>` — surface prior retro lessons + `bd memories` keyed to the change area; note any to pre-empt.
- (Optional) spawn ONE Explore agent to map existing types/patterns to reuse.
- `bd update <wp-id> --status=in_progress`; write the implementation plan as a bd comment.

### Stage 2 — VERIFY (gate)
- Surface the plan to the user; ask **"What's wrong with this plan?"**
- Redirect → return to ORIENT. `--autonomous` → skip, add `--labels autonomous`.

### Stage 3 — IMPLEMENT
- Branch `feat/<wp-id>-<slug>`. Self-contained WPs may run as a background worktree agent (R8); cross-cutting WPs in main chat.
- **Backend:** `ctx.services.*` (never ad-hoc `createDbClient`), typed `ServiceError`, `dbWs.transaction()` for multi-step writes, `scopedNotDeleted()` on queries, `procedure()` with an explicit `policy`.
- **UI:** load the VISUAL-VERIFY checklist (`references/visual-verify.md`) before coding. Tokens-only CSS, OKLCH, scoped `<style>`, Melt UI primitives, idempotent change handlers (`feedback_melt_controlled_components`), a11y baseline.
- Currency = GBP. Ports via `getServiceUrl()`. No `as any`. No hardcoded CSS. New worker routes need a build (`feedback_wrangler_watches_dist`).

### Stage 4 — TEST
- Right-sized: don't test trivial getters; DO test anything that can lose money, expose data, or cross a security boundary.
- Money/auth: positive AND negative paths, every transition. ServiceError tests use `err.code` not `err.name`/`instanceof` (`feedback_service_error_test_instanceof`, `feedback_not_found_error_name_minification`).
- `pnpm turbo run test --filter <pkg> --concurrency=1` + `pnpm typecheck` — both green.

### Stage 5 — SIMPLIFY  *(absorbs the `simplify` skill — a STAGE, not a reviewer)*
- Run `/simplify` on the diff. Apply findings that clarify; reject premature abstractions (3 similar lines beat a bad abstraction).
- If delegating to a simplifier agent, end the prompt with **"STOP after applying, no follow-up work"** (`feedback_simplifier_scope_overrun`).
- Re-run tests after changes.

### Stage 6 — REVIEW  *(invokes `codex-review`)*
- Retro-scan again for the final change-set: `scripts/retro-scan.sh <modules>`.
- Invoke **`codex-review`** WITH the WP id so it writes `swarm-start`/`swarm-end` audit entries:
  - `Skill(codex-review)` against the working tree / branch range.
- Address findings: CRITICAL/HIGH must-fix (may return to IMPLEMENT); MEDIUM fix-or-`wontfix`-with-reason; LOW/nit when cheap. `silent-failure-hunter` CRITICAL = no debate.
- **VISUAL-VERIFY (UI WPs only)** — the absorbed design-system MCP gate, RUN not read:
  - `svelte-autofixer` (Svelte MCP) on changed `.svelte`; re-run until clean.
  - `chrome-devtools`/`playwright` MCP: snapshot + interact the changed surface (`feedback_thorough_verification`).
- If structural changes were needed, re-run SIMPLIFY + TEST before exiting REVIEW.

### Stage 7 — FALLOW  *(absorbs the `fallow-audit` skill — a STAGE, not a reviewer)*
- Run `/fallow` (or fallow detection) over the diff: unused exports, dead imports, orphan helpers, duplication.
- Before deleting anything, grep `src/` + tests + UI for consumers (`feedback_verify_before_declaring_unused`); exclude `dist/`/`build/` (`feedback_audit_grep_dist_contamination`).
- Scope tight: only code this WP introduced or touched.

### Stage 8 — REGRESSION
- Full affected-package suite: `pnpm turbo run test --filter <pkg> --concurrency=1`.
- UI changed → Playwright smoke on adjacent routes. Migration touched → apply to a fresh test DB (`pnpm db:local:migrate`).

### Stage 9 — SHIP (gate + push)
```bash
.claude/skills/codex-epic-implement/scripts/gate.sh --pkg <filter>   # trust ONLY "✓ ALL GATES PASSED"
git worktree list                                                    # remove any agent-* worktrees: git worktree remove --force --force <path>
git commit -m "feat(<scope>): WP-N <subject>"                        # conventional; co-author trailer
git push -u origin feat/<wp-id>-<slug>
gh pr create   # title < 70 chars; body = Summary + Test Plan
bd update <wp-id> --labels in-review
```
On failure → return to the relevant earlier stage. After PR merges: `bd close <wp-id>` + `bd sync`.
If a workspace dep was added, note the required `pnpm install` in the PR (`feedback_post_ff_pnpm_install`).

---

## §4 — Parallelisation

Run WPs in parallel where the dependency graph allows, using background agents with
`isolation: "worktree"`. Main chat orchestrates only — it reviews, runs tests, decides merge order, and
NEVER edits files while worktree agents run (`feedback_worktree_content_bleed_bidirectional`). Brief each
agent with: plan path, its WP id, "follow codex-epic-implement §3", and "Open a PR, then STOP."

| Round | Pattern |
|---|---|
| 1 | Data model + an independent FE component — fully parallel |
| 2 | Service / business logic — waits on data model |
| 3 | API routes + integrations — parallel where deps allow |
| 4 | UI surfaces — 2-3 parallel agents OK |
| 5+ | Integration, E2E, docs — sequential trailing |

---

## §5 — Close-checklist (per WP, before `bd close`)

- [ ] All 10 stage audit entries present (`bd audit` / verify via `codex-epic-retro` later)
- [ ] `gate.sh` → `✓ ALL GATES PASSED`
- [ ] `codex-review` CRITICAL/HIGH fixed; MEDIUM fixed-or-`wontfix`
- [ ] `/simplify` + `/fallow` done; no new dead code
- [ ] (UI) VISUAL-VERIFY MCP gate passed end-to-end
- [ ] Branch `feat/<wp-id>-<slug>` (NOT main/dev); PR has Summary + Test Plan
- [ ] `bd close <wp-id>` + `bd sync` after merge
- [ ] Surprising lesson → `bd remember --key "implement/<slug>"` (feeds retro/crystalize)

---

## §6 — Memory rules applied

| Rule | Stage |
|---|---|
| `feedback_main_worktree_head_shift` | 0 + every git op |
| `feedback_stale_bead_pointers` | 1 |
| `feedback_design_questions` | 2 (UI scope) |
| `feedback_modularity_no_any`, `feedback_currency_gbp`, `feedback_drizzle_migrations` | 3 |
| `feedback_security_deep_test`, `feedback_service_error_test_instanceof` | 4 |
| `feedback_simplifier_scope_overrun` | 5 |
| `feedback_thorough_verification`, `feedback_melt_controlled_components` | 6 |
| `feedback_verify_before_declaring_unused`, `feedback_audit_grep_dist_contamination` | 7 |
| `feedback_turbo_concurrency_shared_neon`, `feedback_neon_pgbouncer_ddl_breaks` | 4 + 8 |
| `feedback_run_tests_locally_before_push`, `feedback_post_ff_pnpm_install` | 9 |

---

## §7 — Anti-patterns / triggers

**Anti-patterns:** skipping VERIFY ("the plan's obviously fine"); batching multiple WPs' closes;
trusting a piped gate exit code; editing in main chat while a worktree agent runs; closing a WP with a
red `codex-review` CRITICAL.

**Invoke when:** "implement the next WP", "/codex-epic-implement <id>", "run the cycle on <epic>".

## Related
- `codex-epic-create` (produces the epic) · `codex-review` (stage 6) · `codex-epic-handoff` (mid-cycle recovery) · `codex-epic-retro` (reads this cycle's audit trail).
- `docs/epics/conventions.md` — audit schema, gate, branch/commit, lessons substrate.
- `scripts/gate.sh`, `scripts/retro-scan.sh`.
