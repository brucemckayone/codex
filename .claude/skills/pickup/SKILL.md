---
name: pickup
description: >
  Resume work in a fresh session from the newest handover in docs/handover/ — no copy-pasting. Reads the
  handover, re-verifies its volatile claims against live git/PR/CI/beads state, reports what has drifted,
  then states the one next action and proceeds. Use right after /clear, at the start of a session, or when
  asked to "pick up where we left off". Counterpart of /handover.
allowed-tools: Read, Bash, Grep, Glob, Skill, Edit, Write
---

# Pickup — read the baton, then check it's still warm

`/pickup` replaces pasting a continuation prompt. It finds the newest handover, reads it, and —
critically — **re-verifies it before acting on it**.

A handover is a timestamped snapshot, not a standing truth. Between writing and reading, branches
move, PRs merge, beads close, CI runs finish, line numbers drift, and dev servers die. The failure
mode this skill exists to prevent is **acting confidently on a stale premise** — which in this repo
has cost multiple sessions.

Counterpart: **`/handover`** writes the doc this reads.

---

## §0 — When to invoke

```
Use /pickup when:
  - Starting a fresh session, or immediately after /clear or /compact
  - "pick up where we left off" / "continue from the handover"
  - /pickup                 → newest handover
  - /pickup --list          → choose from a list
  - /pickup <filename>      → a specific handover
  - /pickup <extra steer>   → newest handover, plus the user's redirection

Defer when:
  - The user gave a complete task in this message — do that task; the handover is
    background, not an instruction that overrides them.
  - No handover exists → say so and ask what to work on. Don't invent a plan.
```

---

## §1 — Hard rules

| # | Rule | Why it exists |
|---|---|---|
| R1 | **Re-verify before acting.** Run the script, diff its `reverified` block against the doc, and report drift *before* the first substantive move. | The whole point. Acting on a merged branch, a closed bead, or a moved line number produces confident wrong work. |
| R2 | **The doc is context; the user's current message is the instruction.** If they conflict, the user wins — say so and follow them. | A handover is a note from the past. It cannot outrank the person in front of you. |
| R3 | **Report drift, don't silently absorb it.** Name what changed since the handover. | The user's mental model is the handover's. Correct it explicitly or they'll be surprised later. |
| R4 | **Trust the doc's labels.** `HYPOTHESIS`/`UNVERIFIED`/`NOT DONE` mean exactly that — don't promote them to fact by re-stating them plainly. | Handovers mark provenance precisely so the next session can calibrate. Flattening it destroys the signal. |
| R5 | **Beads: notes are authoritative over titles.** Run `bd show <id>` on the live item before doing anything. | Titles here go stale and get corrected in notes. A title-only read has produced wrong work repeatedly. |
| R6 | **`git fetch` before quoting any ahead/behind or "is it merged" claim.** | `fetch_is_stale` in the output tells you when. Local refs lie quietly. |
| R7 | **Never `git stash`.** Never run root `pnpm test`. | Stash is repo-wide across worktrees here and has destroyed work. Root `pnpm test` points at the shared local dev DB and wipes local orgs — scope it (`pnpm --filter web test`). |
| R8 | **Don't re-file what the doc says is filed.** Check §4 before creating a bead. | Duplicate beads fragment the record. |
| R9 | **Read the whole handover before the first tool call that changes anything.** | Sections interact: §5 may retract something §3 asserts. |

---

## §2 — Workflow

### Step 1 — Locate and snapshot
```bash
.claude/skills/pickup/scripts/resume-state.sh          # newest
.claude/skills/pickup/scripts/resume-state.sh --list   # choose
.claude/skills/pickup/scripts/resume-state.sh --file <name>
```
Returns `{ handover{found,path,age_human,state_word}, now{…}, reverified{beads,branches,ci_runs,file_anchors} }`.

If `handover.found` is false → tell the user the folder is empty and ask what to work on. Stop.

If `handover.state_word` is `DONE` → that session closed out. Say so and offer `--list`; don't
resume finished work.

### Step 2 — Read the handover in full
`Read` the file at `handover.path`. All of it, §0 → §9, before acting (R9).

### Step 3 — Diff the doc against reality
Walk the `reverified` block and build a drift list:

| Signal in output | What it means | What to do |
|---|---|---|
| `beads[].status_now` is `closed`, doc says open | Someone finished it — possibly the owner | Don't redo it. Confirm with `bd show`. |
| `beads[].status_now` is `null` | Bead doesn't exist under that id | The doc's id may be from a summary, not the tracker. Search: `bd search "<title words>"`. |
| `branches[].merged_into_main` is `true` | The working branch is **spent** | Cut a fresh branch; don't reuse or re-push it. |
| `branches[].exists_remote` is `false` | Deleted after merge, or never pushed | Check which before assuming. |
| `ci_runs[].conclusion` differs from the doc | The run finished after the handover was written | Use the live conclusion. Never read `status` (a `completed/*` glob matches `cancelled`). |
| `file_anchors[].line_beyond_eof` is `true` | Line number is past EOF — **definitely stale** | Re-find with the doc's grep command. Intent is authoritative; the number is not. |
| `file_anchors[].file_exists` is `false` | Moved, renamed, or you're in the wrong worktree | Check `now.is_worktree` and `now.repo_root` before concluding it's gone. |
| `file_anchors[].worktree_diverges_from_main` is `true` | Your working copy of that file and `origin/main`'s differ, so the line number is **ref-dependent**. An in-range number proves nothing — it may have been measured against bytes that never held the anchored code | Re-find on the ref the handover meant: `git show origin/main:<path> \| grep -n '<pattern>'`. Compare `on_main.file_lines` to `file_lines` to see how far apart they are. |
| `now.fetch_is_stale` is `true` | Ahead/behind and merge answers are unreliable | `git fetch origin main dev`, then re-run. |
| `now.branch` differs from the doc's branch | You're standing somewhere else | Decide deliberately where to work; don't drift into the wrong checkout. |
| `handover.age_human` is large (> ~12h) | Treat all of §1 as suspect, not just the flagged items | Re-verify green/red status and running services yourself. |

Being in a **different worktree** than the handover assumed is the most common false alarm: files
"missing" and beads "wrong" usually mean wrong directory. Check `now.is_worktree` first.

Two scoping facts, so you don't misread a gap as a problem. First, **every** extractor — beads,
branches, runs and anchors — runs over the doc **minus §5 and §6**. Those sections are retrospective
and quote entities as examples of past mistakes ("`Codex-neon` is a fragment of the path",
"`testing.yml:99999` was past EOF"); verifying them yields phantom "bead unresolved" and "file
missing" warnings. A well-formed handover names every live entity in §0–§4, so nothing checkable is
lost. Second, an empty list is not a signal: a handover naming no `path:line` anchor simply has no
anchors to check.

### Step 4 — Orient the user (short)
Before doing work, print a compact briefing — this is what replaces the paste:

```
Picked up: <handover name> (<age>, state <LIVE>)
Headline:  <one line from the doc>
Standing:  <branch> @ <sha> in <worktree|main> — <clean|N dirty>
Drift:     <bullet per change since the handover, or "none detected">
Next:      <the one next action from §0>
```

Keep it under ~12 lines. The user wrote the handover; they don't need it read back to them — they
need to know **what changed** and **what you're about to do**.

### Step 5 — Confirm or proceed
- Drift changes the plan, or §9 has an unanswered question that blocks → **ask**, with a recommendation.
- Next action is clear and drift is cosmetic → **proceed**, and say you are.
- The user's message steered elsewhere → do that (R2), noting what you're setting aside.

### Step 6 — Re-read the live bead
`bd show <id>` on the item you're about to work (R5), and claim it: `bd update <id> --status in_progress`
*before* starting, not after.

---

## §3 — Worked example of a good pickup

```
Picked up: 2026-08-28-2015-ci-neon-collision.md (3h 40m, state LIVE)
Headline:  Hardcoded Neon branch names made concurrent CI runs share one database.
Standing:  main @ b298c9df in main checkout — clean.
Drift:     • Codex-96bvd is now CLOSED (doc said in_progress) — fix merged via PR #469 → #470.
           • fix/ci-neon-per-run-branch-names is merged into main — branch is spent, cut fresh.
           • Run 33202813007 now concludes SUCCESS (doc recorded it in_progress).
           • testing.yml:647 anchor is stale — file is 1300 lines and the guard moved; re-found
             the per-run names at :223, :678, :855.
Next:      §5 says the two-run overlap test was NOT run and matrix.branch_prefix is the one
           expression CI never executed. Cheapest close-out: next PR touching
           packages/{worker-utils,database,security}, grep the matrix job log for the branch name.
```

Note what this does: it corrects four stale premises *before* touching anything, and it carries
forward the doc's own "NOT DONE" label instead of quietly assuming the work was finished.

---

## §4 — Anti-patterns

- ❌ Reading the handover and starting work without re-verifying. This is the one failure that matters.
- ❌ Summarising the handover back to the user at length. They wrote it. Report **drift** and **next action**.
- ❌ Treating a `HYPOTHESIS` in the doc as established (R4).
- ❌ Reusing a branch the output says is `merged_into_main`.
- ❌ Trusting a `file:line` when `line_beyond_eof` is true.
- ❌ Reading `line_beyond_eof: false` as a pass while `worktree_diverges_from_main` is true.
  That is the same failure as "green means not run": the check returned a verdict without
  ever reaching the code it claims to have checked.
- ❌ Reading CI `status` instead of `conclusion`.
- ❌ Concluding a file is deleted when you're simply in a different worktree.
- ❌ Re-filing a bead §4 already lists.
- ❌ Letting the handover override the user's current message (R2).

## Related
- **`/handover`** — writes the doc this reads; its §1 is the volatile section this re-verifies.
- `/codex-epic-handoff` + `/codex-epic-implement` — the epic-cycle equivalent pair.
- `scripts/resume-state.sh` · `docs/handover/README.md` · `docs/handover/INDEX.md`
