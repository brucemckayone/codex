---
name: handover
description: >
  Write a complete, self-sufficient session handover into docs/handover/ so a fresh chat can resume
  with zero scrollback. Snapshots git/worktree/PR/CI/beads state, then composes a structured doc whose
  §0 is a paste-able resume block. Use at the end of a session, before /clear, when switching tasks, or
  when blocked. Records state — never changes code or beads. Its counterpart is /pickup.
allowed-tools: Read, Write, Edit, Bash, Skill
---

# Handover — write the baton, don't describe the race

A handover is read by someone with **no memory of this session**. Everything they need must be in
the file; everything they don't need is noise that hides what they do. The bar is not "a status
report" — it is "a competent engineer can act correctly within five minutes and cannot be misled".

Counterpart: **`/pickup`** reads the newest handover, re-verifies its volatile claims, and resumes.

---

## §0 — When to invoke vs defer

```
Use /handover when:
  - The session is ending, or you're about to /clear or /compact
  - You're switching tasks and want to come back later
  - You're blocked and handing to a fresh chat (or to the owner)
  - Context is filling up and the work will outlive this window

Defer when:
  - Mid-edit with an unsaved logical change — finish or commit the thought first
  - An in-flight codex-epic-implement cycle → prefer /codex-epic-handoff (epic-stage aware)
  - Nothing happened worth recording (don't write a handover to say "no change")
```

`/handover [optional focus note]` — the note steers the headline and §3, e.g.
`/handover the CI neon collision is the live item`.

---

## §1 — Hard rules

| # | Rule | Why it exists |
|---|---|---|
| R1 | **Every factual claim carries its evidence inline** — run id, exact counts, `file:line`, the command that produced it. Anything without evidence is labelled `HYPOTHESIS` or `UNVERIFIED`. | A handover's claims get acted on without re-checking. An unmarked guess becomes tomorrow's false premise. This repo has burned days on exactly that. |
| R2 | **Pair every `file:line` with a command that re-finds it**, and name the ref when the code is not on the current branch. | Line numbers drift between sessions. A stale pointer sends the reader to the wrong code and they conclude the described thing doesn't exist — and an unqualified anchor is read against whatever the reader has checked out, which may never have contained it. |
| R3 | **Record what was NOT done, and why.** Separate "verified" from "assumed" from "skipped". | The single most dangerous handover is one that reads as complete when a step was skipped. |
| R4 | **Quote the owner verbatim on any design, product, or priority decision.** Never paraphrase it. | Paraphrase silently rewrites intent. If the owner described a weighting model or rejected an approach, his words are the spec. |
| R5 | **CI: record `conclusion`, never `status`.** Name the run id. | A `completed/*` glob matches `cancelled`. Every push here spawns a `push` run and a `pull_request` run and one is deliberately cancelled — "completed" has inverted a verdict here more than once. |
| R6 | **Never dump raw `bd` output.** Id + title + one line on why it matters. | Descriptions in this repo reach kilobytes each; a raw dump buries the handover in its own appendix. |
| R7 | **Write down the traps you hit.** Tool gotchas, false starts, misleading signals. | The next session will hit the same ones at the same cost unless told. |
| R8 | **§1 (State) is by definition volatile.** `/pickup` re-verifies all of it. Mark volatile claims elsewhere with `⟳`. | Branches move, PRs merge, beads close, services die. The handover is a snapshot with a timestamp, not a standing truth. |
| R9 | **Read-only on code and beads.** The only writes are the handover doc and its index. | Recording state must not change it. Close beads *before* the handover, then record that you did. |
| R10 | **Name the ONE next action in §0**, not a checklist. | A baton has one hand on it. Ordered options live in §8. |

---

## §2 — Workflow

### Step 1 — Snapshot
```bash
.claude/skills/handover/scripts/collect-state.sh --ports
```
One JSON blob: `repo_root`, `main_checkout`, `is_worktree`, `handover_dir`, `existing_handovers`,
`git{branch,last_sha,last_subject,dirty_count,dirty_files,recent_commits,vs_origin_dev,vs_origin_main,fetch_is_stale}`,
`worktrees[]`, `open_prs[]`, `ci{workflow,runs[{id,event,status,conclusion,sha}]}`,
`beads{in_progress,ready,blocked}`, `listening_ports[]`.

Read `fetch_is_stale` first: if true, the ahead/behind numbers predate the last remote change —
`git fetch origin main dev` before quoting them as fact.

### Step 2 — Decide the headline and the one next action
The headline is the thing a reader must not miss. Usually the highest-priority live item, or the
biggest unlanded change. If the session was pure delivery with nothing live, say so plainly.

### Step 3 — Close the loop on beads *before* writing
Update and close what this session finished (`bd update` / `bd close` with a real reason), and file
what you found but deliberately didn't do. Then the handover *records* bead state instead of asking
the next session to reconstruct it. This is the one ordering that matters: beads first, doc second.

### Step 4 — Compose the doc
Skeleton: `templates/handover.md`. Fill every section or delete it — never leave a heading with
"N/A" under it. Sections are load-bearing in this order because that's the order a reader needs them.

### Step 5 — Write it
```
<main_checkout>/docs/handover/<YYYY-MM-DD>-<HHMM>-<slug>.md
```
`<slug>` is 2–4 kebab words naming the *subject*, not the activity: `ci-neon-collision`, not
`fixed-some-ci-stuff`. Name-sort is chronological, so no symlink is needed.

Create the folder on first use, with its own `.gitignore` so handovers never enter a PR diff:
```bash
HD="$(cd "$(git rev-parse --git-common-dir)" && pwd)"; HD="$(dirname "$HD")/docs/handover"
mkdir -p "$HD"
[ -f "$HD/.gitignore" ] || printf '*\n!.gitignore\n!README.md\n' > "$HD/.gitignore"
```

### Step 6 — Prepend to `INDEX.md`
One line, newest first:
```
- [2026-08-28 20:15] [ci-neon-collision](2026-08-28-2015-ci-neon-collision.md) — LIVE: Codex-96bvd fixed, two-run overlap test not run. Next: verify matrix branch_prefix on the next fan-out PR.
```
Each line carries a **state word** — `LIVE` (something needs doing), `PARKED` (deliberately paused),
`DONE` (closed out, kept for the record) — so `/pickup` can skip finished handovers.

### Step 7 — Report and stop
Print the path, the state word, and §0 verbatim. If asked for `--prompt`, print only §0 (optionally
`| pbcopy`). Then stop — do not start the next task.

---

## §3 — Section contract

| § | Contains | Test for "good enough" |
|---|---|---|
| **§0 Resume here** | Self-contained block: the one next action, branch + base to cut from, the bead, the gate commands, the single biggest "don't do X". 8–15 lines. | Pasted alone into a fresh chat with no file access, it still produces correct first moves. |
| **§1 State you can assume** ⟳ | Branch tips and SHAs, which worktree is which, what's dirty, running services and ports, what's green, disconnected tooling. | A reader can tell where to stand and what not to touch. |
| **§2 Delivered this session** | Table: item → bead → status → PR/SHA. Include things scoped-but-not-built, marked as such. | No ambiguity about what exists vs what was merely discussed. |
| **§3 The live problem** | Root cause with `file:line` + re-find command, the **mechanism**, evidence with ids and exact counts, the fix shape, and how to verify it. | The reader could implement it without rediscovering anything. |
| **§4 Open beads** | Table: id → P → one line each, including ones deliberately out of scope. | The reader knows what's filed so they don't re-file or get drawn in. |
| **§5 Provenance** | Verified vs hypothesis vs not-done. Retractions of anything claimed earlier and later disproved. | A reader can calibrate how much to trust each claim. |
| **§6 Traps hit** | Tool gotchas, false starts, misleading signals, wrong turns and what outranked them. | The next session doesn't pay the same tolls. |
| **§7 Environment** | Creds, URLs, ports, seeds, the commands that break things, quota state. | Nothing here needs to be rediscovered by experiment. |
| **§8 Next actions** | Ordered list with a reason for the order. | The reader knows what to do second, not just first. |
| **§9 Open questions** | Decisions only the owner can make, phrased as questions. | Nothing blocks silently. |

---

## §4 — What makes a handover good (worked contrasts)

**Evidence, not adjectives.**
- ❌ "CI is flaky and E2E keeps failing."
- ✅ "E2E Web on run `33188949531` (main @ `1609cad0`): **32 failed / 55 did not run / 102 passed**, with **190** occurrences of `Fast registration failed (500)`. Counted with `grep -c`, not inferred."

**Mechanism, not correlation.**
- ❌ "Started failing after `fbffab91`, so that commit probably broke it."
- ✅ "`fbffab91` touched only five test files, none of which reach the auth worker's write path, and the worker's code is byte-identical either side. The correlation is real and the causation is not established. Suspect the environment."

**Anchors that survive drift.**
- ❌ "The bug is at `testing.yml:647`."
- ✅ "`testing.yml:647` at time of writing — **line numbers drift, re-find with**
  `grep -nE 'branch_name|ci-[a-z-]+-tests' .github/workflows/*.yml`."

**Name the ref when the anchored code is not on the branch you are standing on** — the common
case being work already merged to `main` while the working copy sits on an unrelated epic. A bare
`path:line` is silently read against whatever the reader has checked out.
- ❌ "`testing.yml:535` — `branch_name: ${{ matrix.branch_prefix }}-…`" (written while standing on
  an unrelated branch 130 commits behind; that file does not contain `branch_prefix` at all, so the
  reader greps, finds nothing, and concludes the fix was lost)
- ✅ "`testing.yml:542` **on `origin/main`** — re-find with
  `git show origin/main:.github/workflows/testing.yml | grep -n branch_prefix`."

**Say what you didn't do.**
- ❌ (silence)
- ✅ "The two-run overlap test was **not run** — Neon compute was already over quota (107.55/100 CU-hrs) and the owner stopped work. So `${{ matrix.branch_prefix }}-…` is the one changed expression CI never executed. Cheapest check: next PR touching `packages/{worker-utils,database,security}`, grep the matrix job log for the created branch name."

**Green can mean not-run.**
- ❌ "All seven matrix jobs passed."
- ✅ "All seven matrix jobs reported `completed/success` **while creating no Neon branch at all** — their `should-run` gate was false and every later step skipped. Green there means NOT RUN."

---

## §5 — Anti-patterns

- ❌ A narrative of what you did in the order you did it. A handover is oriented to the *reader's* next move, not your history.
- ❌ Unlabelled hypotheses presented alongside verified facts.
- ❌ "See the bead for details" as a substitute for §3. The bead is the archive; §3 is the briefing.
- ❌ Bare `file:line` with no re-find command, or with no ref when the code is not on the current branch (R2).
- ❌ Paraphrasing the owner's design intent (R4).
- ❌ Recording CI `status` instead of `conclusion` (R5).
- ❌ Writing the handover *before* closing the beads the session finished, so the doc and the tracker disagree.
- ❌ Committing handover docs. The folder is self-ignoring; keep it that way.
- ❌ Starting the next task after writing. Stop.

## Related
- **`/pickup`** — the counterpart; reads the newest handover and re-verifies §1 before acting.
- `/codex-epic-handoff` — narrower: an in-flight `codex-epic-implement` cycle, stage-aware.
- `/update-plan` — plan-file progress, not session state.
- `scripts/collect-state.sh` · `templates/handover.md` · `docs/handover/README.md`
