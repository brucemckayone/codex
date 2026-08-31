# Handover: <headline — the thing a reader must not miss> (<YYYY-MM-DD>, <morning|afternoon|evening>)

**Read this whole file before acting.** <One paragraph: how many live items there are, what the one
next thing is, and any "do not do X first" warning. If a naive first move would mislead the reader —
"do not re-run CI hoping for green, a re-run is clean only when it happens to be alone" — say it
here, not in §6.>

State: **<LIVE | PARKED | DONE>**

---

## §0 — Resume here

> Self-contained. Pasted alone into a fresh chat with no file access, this must still produce
> correct first moves. 8–15 lines.

```
<Task in one sentence>. Bead <Codex-xxxxx> (P<n>) — read `bd show <id>` first; NOTES ARE
AUTHORITATIVE OVER TITLES.

Branch: cut a fresh one from `origin/<base>` @ `<sha>`. PRs here target `<dev>`, never `main`.
Working copy: <path> (<worktree|main checkout>).

Next action: <the single concrete next step>.

Gates before pushing: <exact commands>.
Do NOT: <the one highest-value prohibition>.
```

---

## §1 — State you can assume ⟳

> `/pickup` re-verifies everything in this section. Everything here is a snapshot, not a standing truth.

- **Branches.** `main` @ `<sha>` (<subject>), `dev` @ `<sha>`. <Do they agree? Which is ahead?>
- **This session's branch.** `<branch>` — <merged | open in PR #N | unpushed>. <Reusable or spent?>
- **Working copies.** <Which worktree is on what, which are clean, which are stale.>
  Never `git stash` in this repo — it is repo-wide across worktrees and has destroyed a worktree's work.
- **Uncommitted.** <What's dirty and whether it matters.>
- **Green/red.** <Which gates pass, by run id and conclusion. Name the exceptions.>
- **Running services.** <Ports listening, and which checkout serves them.>
  Confirm before trusting any measurement:
  `pid=$(lsof -nP -iTCP:3000 -sTCP:LISTEN -t); lsof -a -p $pid -d cwd -Fn | grep '^n' | cut -c2-`
- **Tooling.** <Anything disconnected, broken, or quota-limited right now.>

---

## §2 — Delivered this session

| Item | Bead | Status | Where |
|---|---|---|---|
| <what> | `<Codex-xxxxx>` | closed / open / **scoped only** | PR #N, `<sha>` |

<Anything scoped-but-deliberately-not-built goes here too, marked **scoped only**, with one line on
why it wasn't built and whose decision that was.>

---

## §3 — The live problem / next task

**<Bead id> — <title>**

### Root cause
> Write the anchor as `path:line` — that exact form is what `/pickup` extracts and checks
> against the file's real length. Prose like "at line 535" is invisible to it.
>
> If the code is NOT on the branch this working copy is standing on (e.g. it is already merged to
> `main`), say which ref, and make the re-find command name that ref too. `/pickup` reports
> `worktree_diverges_from_main` when the two copies differ, but only a named ref tells the reader
> which one you measured.

`<path>:<line>` **on `<ref, if not the current branch>`** at time of writing — **line numbers
drift, re-find with:**
```bash
<grep command that relocates it — prefix with `git show <ref>:` if the code is on another ref>
```
```<lang>
<the offending code>
```

### Mechanism
<Why this produces the symptoms. Not correlation — the causal chain. If the mechanism is not
established, say `HYPOTHESIS` and name what would confirm it.>

### Evidence
| what | value |
|---|---|
| run / commit | `<id>` @ `<sha>` |
| counts | <exact numbers, and the command that counted them> |

<If one mechanism explains several symptoms, list them together and say so — it stops the reader
chasing them separately.>

### The fix
1. <shape of the change>
2. <…>

### How to verify
<The interesting part. What would a *false* green look like? What has to be true for the check to
mean anything? If a single passing run proves nothing, say why and give the real test.>

---

## §4 — Open beads

| Bead | P | One line |
|---|---|---|
| `<id>` | P<n> | <why it matters / why it's out of scope> |

<Mark explicitly which of these are **deliberately out of scope** for the next session, so the
reader doesn't get drawn in.>

---

## §5 — Provenance: verified vs assumed

- **VERIFIED** — <claim> — <how: the command, the run id, the reproduction.>
- **HYPOTHESIS** — <claim> — <what would confirm or kill it.>
- **NOT DONE** — <step> — <why, and the cheapest way to close the gap later.>
- **RETRACTED** — <anything claimed earlier this session and later disproved, and what outranked it.>

---

## §6 — Traps hit this session

> `/pickup` does not re-verify ANY entity (bead id, branch, run id, `path:line`) that appears
> only in §5 or §6 — these sections quote them as examples of past mistakes, and checking them
> yields phantom drift warnings. Name every live entity in §0–§4; quote freely here.

- <Tool gotcha or misleading signal, and the correct move instead.>

<Keep the ones that cost real time. Drop the trivia.>

---

## §7 — Environment

- <Creds, URLs, ports, seeds.>
- <Commands that break things, with the reason.>
- <Quota / budget state, if any is near a limit.>

---

## §8 — Next actions, in order

1. <first> — <why first>
2. <second> — <why it waits>

---

## §9 — Open questions for the owner

- <Decision only he can make, phrased as a question.>
