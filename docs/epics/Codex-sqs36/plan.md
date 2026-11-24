# W0: workflow as code (epic lifecycle in git, WF-* rules, the bd-close hook)


> **Changed in implementation (2026-11-24).**
> - The bd-close guard lives in `scripts/checks/bd-close-guard.mjs`, not `scripts/hooks/`. Inside the gate's folder it is gate code with no extra list entry. It is a CI gate, `WF-BD-CLOSE`: a self-test plus `--check-wiring`.
> - Spec clauses: S12 is the hook, S13 the PR rules.
> - S10's "statuses only move forward" is enforced inside WF-RETRO-DEBT, because a backward move or a deleted epic.md would dodge the debt.

## Context
- **Most of the workflow runs on trust.** One retro exists for 69 closed epics. No hook or CI job runs any of the 8 workflow scripts. Plans live in `~/.claude/plans`, outside git. codex-review never writes its tally anywhere CI can see. Beads' git export stopped on 12 May, so CI can't see epic state.
- **What the owner asked for (16 Nov):** "constrain the system correctly". The workflow itself must be enforced in code.
- **Design source:** page 6 of the owner's local design pages (session notes, not in git), every question decided 16 Nov, plus page 7's additions on 17 Nov.
- **Where W0 sits:** step 3 of G0 → D1 → **W0** → L0 → G1.
- **What it builds on:** G0 has shipped (#725), so W0's rules plug into its registry.
- **Absorbs Codex-3l73h**, the missing bd-audit trail. W0 moves the retro's input into git: epic.md, PR-body tallies and retro.md.

## Decisions
| Decision | Choice | Source |
|---|---|---|
| Where lifecycle state lives | `docs/epics/<id>/epic.md` in git; beads is kept in step by a hook | page 6, 16 Nov |
| Retro debt | 7 days after an epic ships, every PR into dev fails, except the retro PR and a PR labelled `hotfix` (the exemption is logged) | 16 Nov |
| How a review is recorded | A `## Review` tally in the PR body, written by codex-review and checked by CI | 16 Nov |
| The 69 closed epics | Grandfathered; L0 sorts their lessons | 16 Nov |
| The bd-close hook | Tracked `.claude/settings.json` | 16 Nov |
| Lessons | A `prose-only` home must say why each higher rung failed; skill and CLAUDE.md homes use phrase-present; the tally is bound to a commit; each WP in a plan needs Files, Verify and Pass when | page 7, 17 Nov |
| Which open epics get an epic.md now | The 7 updated in the last 30 days: 8swlj, 2hxff.89, eerxq, omrp2, 2hxff, a6ofh, 61zsk. The 20 dormant ones get theirs when touched | owner, 24 Nov |
| Where the PR rules run | A new light workflow, `pr-rules.yml`, as a second required check on dev | owner, 24 Nov |
| Which PRs need a review | Every PR into dev except dev→main releases. The tier sets the depth: product code repeats until no MEDIUM; tooling, tests and docs get one round | owner, 24 Nov |
| How the tally binds to commits | `reviewed: <sha>` must be in the branch. If commits follow it, `fixes through: <head>` must equal the exact head | owner, 24 Nov |
| Closing a dormant epic | A new `abandoned` status (no retro needed), so every epic closed after W0 leaves a git record | follows from the hook |

## Data model: the files in each epic folder
`docs/epics/<id>/epic.md` front matter:
```
id: Codex-xxxx            # must equal the folder name
title: …
status: planned | active | shipped | retro-done | abandoned
plan: plan.md             # required until retro-done or abandoned
prs: [725]                # at least one once shipped
reason: …                 # required when abandoned
```
- **`plan.md`** is the plan, copied into git when the epic is created. Each `### WP-N` block needs `Files:`, `Verify:` and `Pass when:` lines.
- **`retro.md`** is written at the retro, with a lessons table: `| Lesson | Verdict | Home |`. A Home is one of:
  - `rule:<ID>`, which must exist in RULES or GATES;
  - `adr:NNNN`, which must exist as a file;
  - `test:<path>`, which must exist;
  - `skill:<name> "phrase"` or `claude-md:<path> "phrase"`, where the phrase must appear verbatim in that file;
  - `prose-only: arch: …; type: …; rule: …; test: …; hook: …`, with every rung given a reason.
- **Statuses only move forward.** At `retro-done` the folder holds only epic.md and retro.md (DOC-PLAN).

## The rules (all are G0 registry entries, `baseline: false`, so always strict)
| ID | Kind | Runs in | Holds |
|---|---|---|---|
| WF-EPIC | new `epic-file` (per file) | static-analysis + commit | The front-matter schema, `id` equal to the folder, a known status, and the plan lint (each WP has Files, Verify and Pass when) |
| DOC-PLAN | `epic-file` | static-analysis + commit | At retro-done or abandoned, the folder holds only epic.md and retro.md |
| WF-LESSON | new `lessons-table` (per file) | static-analysis + commit | Each retro.md lesson has a Home that resolves; phrase-present; prose-only names every rung |
| WF-PR-LINK | new `pr` kind | pr-rules | The branch or an `Epic:` body line names an id. Its nearest ancestor with an epic.md (walking the id up, so `.89.3` reaches `.89`) must exist for a dotted id or an `Epic:` line. An undotted standalone id passes |
| WF-REVIEW | `pr` | pr-rules | A `## Review` block of the form `reviewed: <sha> · rounds: N · found: xC/xH/xM/xL/xnit · open: 0C/0H/0M`. The reviewed commit must be in the branch, and if it isn't the head, `fixes through: <head>` must equal the head. Wontfix items are listed with a reason and don't count as open. Release PRs are exempt |
| WF-RETRO-DEBT | `pr` | pr-rules | For each epic.md with status shipped, the date it became shipped comes from git: the first commit on the base branch's first-parent history where it did. Over 7 days fails the PR, unless the PR moves that epic to retro-done or carries the `hotfix` label, which is printed as a notice |
| WF-ONE-PR | `pr` (warn) | pr-rules | A notice when the same author has more than one open PR into dev (GitHub API, `pull-requests: read`) |

**Runner changes** (`scripts/checks/`). Every one is a gate edit, so **the owner countersigns W0's PR**.
- `ciBase` gains the PR payload: body, labels, head SHA and head ref, from `GITHUB_EVENT_PATH`.
- Matchers get `ctx.pr`, which is null outside PR runs.
- Rules with `when: 'pr'` run only under the new `--pr-rules` flag. `--ci`, which static-analysis runs, skips them, so a body edit can never leave the required static-analysis check stale-red.
- `--pr-event <file>` lets fixtures and local runs simulate a PR.
- New file `scripts/checks/workflow-*.mjs` for the epic, lesson and PR matchers. The registry gains the 7 rules, the spec gains clauses S10–S12 (holds, outside and tests), and `rules.md` is regenerated.

**`.github/workflows/pr-rules.yml`**
- Triggers: `pull_request` [opened, edited, synchronize, reopened, labeled, unlabeled] into dev.
- Concurrency per PR, with cancel-in-progress.
- Steps: checkout (fetch-depth 0), node, then the self-test and `check-architecture.mjs --pr-rules`. No pnpm install, about 1 minute.
- It is added to `GATE_CODE_ELSEWHERE`, and a self-test asserts its trigger types.

**The WF-BD-CLOSE hook**
- Files: `scripts/checks/bd-close-guard.mjs` and a tracked `.claude/settings.json` with `hooks.PreToolUse` [matcher `Bash`].
- It exits 0 at once unless the command calls bd.
- It parses `bd [global flags] close <ids…>` (with or without `--force`), `bd update <ids> --status/-s closed`, and `bd epic close-eligible` (refused unless `--dry-run`).
- For each id it runs `bd show <id> --json`. If the id is an epic, epic.md must say retro-done or abandoned. Otherwise it exits 2, with the reason on stderr.
- Outside its reach (written into the spec): `bd sql`, `batch`, `import`, `supersede` and `duplicate`. It's an agent-side gate, and a human can close an epic in a shell.

## Work packages (one epic, ONE PR, branch `feat/<epic>-w0-workflow`, worktree `../Codex-w0` off dev)

### WP-1: epic files, WF-EPIC and DOC-PLAN
- **What:** the `epic-file` kind; templates in `docs/epics/_template/` (epic.md, plan.md, retro.md); a lifecycle section in `docs/epics/conventions.md`; spec clause S10.
- Files: `scripts/checks/workflow-epic.mjs`, `scripts/checks/architecture-rules.mjs`, `scripts/checks/architecture-spec.mjs`, `scripts/checks/check-architecture.test.mjs`, `docs/epics/_template/*`, `docs/epics/conventions.md`
- Verify: `node --test scripts/checks/check-architecture.test.mjs`; `node scripts/checks/check-architecture.mjs`
- Pass when: a FIRES fixture fails each of WF-EPIC (bad status, id ≠ folder, a WP missing Pass when) and DOC-PLAN (a plan left at retro-done); the templates pass; the self-test is green.

### WP-2: retro lessons, WF-LESSON
- **What:** the `lessons-table` kind, with homes resolved against RULES/GATES, `docs/adr`, `.claude/skills` and paths; phrase-present; the prose-only rungs.
- Files: `scripts/checks/workflow-lessons.mjs`, the registry, the spec, the self-test
- Verify: the self-test, plus planted retro.md fixtures
- Pass when: each kind of bad home fails (an unknown rule, a missing ADR, an absent phrase, a prose-only with a rung missing), and a valid table passes.

### WP-3: the PR rules and pr-rules.yml
- **What:** the PR payload in `ciBase`, `ctx.pr`, `--pr-rules` and `--pr-event`; WF-PR-LINK, WF-REVIEW, WF-RETRO-DEBT and WF-ONE-PR; the workflow; spec clause S11.
- Files: `scripts/checks/architecture-raises.mjs` (ciBase), `scripts/checks/check-architecture.mjs`, `scripts/checks/workflow-pr.mjs`, `.github/workflows/pr-rules.yml`, the registry, the spec, the self-test
- Verify: the self-test with planted event JSON; a run on a scratch branch with `--pr-event`
- Pass when: each of these fails:
  - a missing tally, or one with an open MEDIUM;
  - a stale `fixes through` after a later commit;
  - a WP branch whose epic has no epic.md;
  - a shipped epic 8 days old;

  and each of these passes:
  - a retro PR, or a `hotfix` PR (with a notice);
  - a release PR;

  while static-analysis's `--ci` never runs a `pr` rule.

### WP-4: the WF-BD-CLOSE hook
- **What:** the guard script, the tracked `.claude/settings.json`, its own `node --test` self-test as a CI step, and spec clause S12. Before writing, verify the hook contract (stdin JSON, exit 2, `$CLAUDE_PROJECT_DIR`) against the Claude Code docs, using the update-config skill.
- Files: `scripts/checks/bd-close-guard.mjs`, `scripts/checks/bd-close-guard.test.mjs`, `.claude/settings.json`, `.github/workflows/static_analysis.yml` (a step)
- Verify: the self-test, using planted commands and a stubbed `bd show`; a live try in a session (`bd close` on a test epic)
- Pass when: these are refused (exit 2):
  - `bd close <epic>`, with or without `--force` or global flags;
  - `bd update <epic> -s closed`;
  - `bd epic close-eligible`;

  these pass:
  - closing a non-epic;
  - closing an epic at retro-done or abandoned;
  - a command with no bd in it, which exits in under 100 ms.

### WP-5: the skills, adoption and docs
- **codex-epic-create** writes `docs/epics/<id>/{epic.md, plan.md}` when it scaffolds.
- **codex-epic-implement** sets `active` and then `shipped`, adds the `Epic:` line, and puts the tally in the PR body.
- **codex-review** writes or updates the `## Review` block with `gh pr edit`.
- **codex-epic-retro** writes `docs/epics/<id>/retro.md`, sets `retro-done` and deletes the plan.
- **Adoption:** epic.md files for the 7 active epics, and W0's own folder.
- **Closures:** Codex-3l73h, with a note.
- Files: `.claude/skills/{codex-epic-create,codex-epic-implement,codex-review,codex-epic-retro}/SKILL.md`, `docs/epics/<7 ids>/epic.md`, `docs/epics/conventions.md`
- Verify: `check-architecture.mjs` passes WF-EPIC on all 8 folders; `--pr-rules --pr-event` passes on a drafted body for W0's own PR
- Pass when: every active epic has a valid epic.md, and each skill names the exact file it writes.

### WP-6: ship
- **Steps:**
  1. codex-review: one round, since this is tooling, with its own tally in the PR body.
  2. Rebase, then the full gate.
  3. **The owner countersigns** the gate-edit lines G0 prints.
  4. The PR opens when the one-PR slot is free.
  5. After merge, with the owner's go: add `pr-rules` as a required check on dev through the API.
  6. Tell every peer session that each PR into dev now needs a `## Review` tally and an epic link.
- Files: the PR body, and the `dev-protection` ruleset (16697675)
- Verify: CI green, both checks
- Pass when: the merged dev shows both required checks, and the next PR without a tally fails pr-rules.

## Verification (end to end)
- `node --test scripts/checks/check-architecture.test.mjs` and `node --test scripts/checks/bd-close-guard.test.mjs` are both green.
- A scratch PR without a tally goes red in pr-rules. Adding the tally (a body edit) re-runs the check and turns it green, while static-analysis stays green throughout.
- In a session, `bd close <active epic>` is refused with the reason shown, and passes once epic.md says retro-done.
- gate.sh `--skip-tests --skip-build` prints ALL GATES PASSED.

## Out of scope
- L0, the lesson sweep (next epic).
- Backfilling retros for the 69 closed epics.
- Restoring beads' JSONL export.
- Judging whether a retro is insightful or a tally honest. The owner reviews retro PRs and spot-checks tallies (page 6 §5).
- bd paths beyond the hook (sql, batch, import).

## Open questions
None blocking. W0's own retro falls due 7 days after it merges. .89's retro is the template's pilot.

## Beads
- An epic (P1, labels `guardrails, workflow`) with children WP-1 to WP-6.
- Dependencies: 1→2; 1→3; {1,2,3,4}→5; 5→6. WP-4 is independent.
- Codex-3l73h is linked, and closed by WP-5.
