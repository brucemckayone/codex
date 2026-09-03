# Archive

Documentation that records a decision or a point-in-time investigation, but is
**not current guidance**. Nothing here is maintained, and nothing here should be
consulted to answer "how does the platform work today" — for that, start at the
root [CLAUDE.md](../../CLAUDE.md) and the per-package `CLAUDE.md` files, which
are the only docs kept in sync with the code.

Moved here on 2026-09-03 by the overnight cleanup audit. Contents preserve their
original directory shape, so `design/features/auth/pdr-phase-1.md` is now
`docs/archive/design/features/auth/pdr-phase-1.md`.

## What is in here

| Origin | Why archived |
|---|---|
| `design/` (the root tree, distinct from `docs/design`) | Fully superseded as guidance — no `CLAUDE.md`, skill, source file or CI job referenced any of it. Its `ARCHITECTURE.md` described a 3-component prototype (Vercel/Netlify deploys, docker-compose Postgres, JWT sessions, a `workers/stripe-webhook`) where every specific is now false. Retained because it holds the only copy of some real decisions — the creator-owned vs org-owned content model, and the v1→v2 schema reasoning whose CHECK constraint is still verbatim in `packages/database/src/schema/subscriptions.ts`. |
| Per-iteration audit logs (`denoise/`, `triage/`, `code-review/`, `frontend-audit/`, `commerce-audit/`, …) | Point-in-time output. Findings that mattered were either fixed or filed as beads; the logs are the working notes, not the conclusion. |
| Shader, design-system, page-ideation and nav specs | Describe work that has shipped and since been iterated on, or that was never built. |
| Session handovers and continuation prompts | Session history. Useful once, to one person, on one day. |

## A warning about links inside this directory

**Internal links here are unreliable, by design.** The same cleanup that moved
these files also deleted others, so an archived document may link to something
that no longer exists in the working tree (139 such links). That is honest for
a tombstone: the target is still in git history.

To read a deleted file:

```bash
# find the commit that removed it
git log --diff-filter=D --oneline -- <path>
# read it as of the commit before
git show <commit>^:<path>
```

Do not "fix" these links by restoring the targets. If a document in here turns
out to be genuinely load-bearing, move it back out and make it accurate — an
archive is not a place to maintain things.

## What was deleted rather than archived

70 paths / 103 tracked files, all recoverable from git history: generated
duplicates (`GEMINI.md` copies frozen at 2026-01-20, one of which still
documented 4 workers where the platform runs 9), empty scaffolding, machine
reports whose findings had already been fixed, and per-iteration proof-test
logs whose subject no longer exists.

One deletion was **withheld from the script**: `docs/commerce-audit/screenshots/`
(66 PNGs, 29 MB). `git ls-files` returns zero for it and no commit in any branch
ever touched it, so removing it is irrecoverable — the executor refuses to
delete what git cannot restore, however unreferenced it is. The owner
subsequently authorised the deletion, so it is removed by hand rather than by
the triage run; the file list it held is recorded in the PR discussion. If you
are reading this because a link into that directory broke, the images are gone
and are not retrievable from history.
