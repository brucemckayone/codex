---
name: codex-epic-handoff
description: >
  Produce a zero-context continuation prompt for an in-flight codex-epic-implement cycle, so work can
  resume in a fresh chat after a session ends, a blocker, a task switch, or before /clear. Reads git +
  beads state via detect-state.sh and emits a ready-to-paste markdown prompt. READ-ONLY — never modifies
  code, beads state, or docs.
allowed-tools: Read, Bash, Skill
---

# Codex Epic Handoff — zero-context continuation

When a `codex-epic-implement` cycle is mid-flight and the session is ending, this emits a prompt that
lets a fresh chat pick up exactly where you left off — no scrollback required.

---

## §0 — When to invoke vs defer

```
Use codex-epic-handoff when:
  - A session is ending mid-cycle, or you're about to /clear
  - You hit a blocker and need to switch focus
  - /codex-epic-handoff   (auto-detects the current epic from the branch)

Defer when:
  - No in-flight cycle (nothing to capture)
  - You want to commit/push — that's codex-epic-implement's SHIP stage, not handoff
```

---

## §1 — Hard Rules

| # | Rule | Why |
|---|---|---|
| R1 | READ-ONLY. Never modify code, beads, or docs. | Handoff captures state; it must not change it. |
| R2 | The emitted prompt must be self-sufficient — name the epic, WP, stage, branch, and next action. | The receiving chat has zero scrollback. |
| R3 | Surface only user-visible state; don't dump raw bd internals. Prefer continuity over novelty. | A handoff is a baton, not a status report. |

---

## §2 — Workflow

### Step 1 — Snapshot state
```bash
.claude/skills/codex-epic-handoff/scripts/detect-state.sh
```
Returns JSON: `{ branch, last_sha, last_subject, worktree_dirty, worktree_count, in_progress[], ready[], in_review[] }`.

### Step 2 — Identify scope
- **Epic/WP:** from `branch` (`feat/<wp-id>-<slug>` → the WP id → its epic) and the `in_progress[]` list.
- **Stage:** infer the current `codex-epic-implement` stage:
  - dirty tree, no PR → mid-IMPLEMENT/TEST.
  - clean, branch pushed, `in_review` label set → REVIEW/SHIP.
  - findings outstanding → REVIEW.
- **Blockers/next:** read the WP's latest bd comment (its plan) and any `in_review` items.

### Step 3 — Compose the prompt (§3 template) and emit
Print it as a fenced ```` ``` ```` markdown block. Optionally `printf '%s' "$prompt" | pbcopy` (macOS) to copy to clipboard. Then stop.

---

## §3 — Continuation-prompt template

````
Resume codex-epic-implement on **<EPIC-ID> — <epic title>**, WP **<wp-id>: <wp title>**.

- Branch: `feat/<wp-id>-<slug>` (last commit `<sha> <subject>`; tree <clean|dirty>)
- Current stage: **<N> <STAGE>** — <one line why we're here / what's blocking>
- Plan: `~/.claude/plans/<descriptor>.md` (read the WP's bd comment for the implementation plan)
- In-progress WPs: <ids+titles> | Ready next: <ids> | In-review: <ids>

Next action: <the single concrete next step — e.g. "address the 2 codex-review HIGH findings in
content-service.ts, then re-run stage 6", or "run gate.sh and open the PR">.

Conventions: docs/epics/conventions.md (bd-audit per stage, gate.sh terminal marker, feat/<wp> branch,
bd remember for lessons). Invoke /codex-epic-implement <wp-id> to continue the cycle.
````

Heuristics: don't restate stable context (the conventions doc); name the *one* next action, not a
checklist; if `worktree_count > 1`, warn that agent worktrees may need cleanup at SHIP.

## §4 — Anti-patterns
- ❌ Modifying anything (it's read-only).
- ❌ A vague "continue the work" prompt with no stage/next-action.
- ❌ Dumping the whole bd list instead of the in-flight slice.

## Related
- `codex-epic-implement` (the cycle this resumes) · `scripts/detect-state.sh` · `docs/epics/conventions.md`.
- Overlaps the generic `/update-plan`; this one is epic-cycle-shaped and beads-state-aware.
