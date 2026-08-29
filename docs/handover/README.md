# Session handovers

One file per session. Written by **`/handover`**, read by **`/pickup`**.

```
/handover        end of session → writes <YYYY-MM-DD>-<HHMM>-<slug>.md + prepends INDEX.md
/clear
/pickup          new session → reads the newest, re-verifies it, resumes
```

That's the whole loop. No copy-pasting a continuation prompt.

## Why this folder is where it is

The path resolves against `git rev-parse --git-common-dir`, which returns the **main checkout's**
`.git` from every worktree. So a handover written in `Codex-neon-fix` is found by `/pickup` running
in `Codex`, or in any of the other worktrees. `docs/handover/` under a *working tree* path would give
each worktree its own private copy — which is exactly the bug this avoids.

## Why nothing here gets committed

`.gitignore` in this folder is self-contained:

```
*
!.gitignore
!README.md
```

Git honours a `.gitignore` even when the file itself is untracked, so handover docs can never appear
in a PR diff, and the root `.gitignore` never needed touching. Only `README.md` — the durable
contract — is tracked, and it needed `git add -f`.

**`INDEX.md` is ignored too, deliberately.** Tracking it would commit an index of *uncommitted*
files (dangling links for anyone who clones), and because `/handover` prepends a line every session
it would become a tracked file modified on whatever branch you happened to be standing on — an
unrelated one-line diff leaking into unrelated PRs. It is local navigation furniture, ignored like
the docs it indexes.

## Files

| File | What it is |
|---|---|
| `INDEX.md` | Running index, newest first. Each line carries a state word. |
| `<date>-<time>-<slug>.md` | One session. Name-sorts chronologically, so no `LATEST` symlink. |
| `README.md` | This file. |
| `archive/` | Pre-`/handover` continuation prompts, kept for forensics. See its own README. |

**The naming convention is load-bearing, not cosmetic.** `/pickup` picks the newest by
`ls docs/handover/*.md | sort -r`, so any filename that does not start with a date will sort ABOVE
every real handover and be read as the newest one — `continuation-…` and `prompt-…` both do, since
`c` and `p` outrank `2`. Anything not following `<YYYY-MM-DD>-<HHMM>-<slug>.md` belongs in
`archive/`, which the non-recursive glob cannot see.

## State words

Every handover declares `State: **LIVE|PARKED|DONE**` near the top, and repeats it in `INDEX.md`.

| Word | Meaning | `/pickup` behaviour |
|---|---|---|
| `LIVE` | Something needs doing next | Resumes it |
| `PARKED` | Deliberately paused; not abandoned | Reports it, asks before resuming |
| `DONE` | Closed out, kept for the record | Says so, offers `--list` instead of resuming |

## What a handover owes its reader

The full contract is in `.claude/skills/handover/SKILL.md` §1 and §3. The short version:

- Every claim carries its **evidence** — run id, exact counts, `file:line`, the command that produced it.
- Every `file:line` is paired with a **grep that re-finds it**, because line numbers drift.
- **What was not done** is stated as plainly as what was.
- The **owner's own words** on any design or priority decision are quoted, never paraphrased.
- CI is recorded by **`conclusion`**, never `status`.
- §1 is **volatile by definition** — `/pickup` re-verifies all of it.

## Housekeeping

Nothing prunes this folder automatically. Handovers are cheap and the history is useful — the
prior-art docs that these skills were modelled on were still earning their keep weeks later. If it
does get noisy, delete `DONE` entries older than a month and drop their `INDEX.md` lines.

## Related

`/codex-epic-handoff` covers the narrower case of an in-flight `codex-epic-implement` cycle and is
stage-aware; use it instead when that's the situation. `/update-plan` tracks a plan file, not
session state.
