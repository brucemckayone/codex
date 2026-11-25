# Lessons ledger

Every lesson this project has learned, the rung of the mechanism ladder that
holds it, and the home CI checks. The architecture gate's
[WF-LESSON](architecture/rules.md#wf-lesson) rule reads this table on every
CI run (`scripts/checks/workflow-lessons.mjs`).

Before this ledger, about 400 lessons lived in memory files and bd memories,
outside git and out of CI's sight, so most of them were advice. L0
(Codex-rmqfr) sorts them here. New lessons arrive through each epic's
`retro.md`, which uses the same table without the Source column.

## How to read a row

- **Verdict** is the strongest rung that holds the lesson: `arch`, `type`,
  `rule`, `test`, `hook`, `already` (something in git holds it today), or
  `prose-only` (judgement). [The retro template](epics/_template/retro.md)
  lists which homes each verdict takes.
- **Home** is where it lives, and CI proves it resolves. A `todo:<epic> "what"`
  home is a promise that a live epic will build it. It fails CI once that epic
  is retro-done or abandoned, so the promise can't quietly outlive the epic.
- **Source** names what the row stands for: `mem:<memory file>`, `bd:<key>`
  or `CLAUDE.md`. A lesson that appeared in several places is one row with
  several sources, and one source can feed several rows. A memory file or bd
  key can be deleted once every row naming it has a home other than `todo:`
  or `prose-only:`.

## Lessons

| Lesson | Verdict | Home | Source |
|---|---|---|---|
| Green CI is not a review: PR #589 went "ready" on green CI, and review then found 2 CRITICAL | already | rule:WF-REVIEW | mem:feedback_green_ci_is_not_reviewed |
| An epic that ships without a retro loses its lessons: 1 retro existed for 69 closed epics | already | rule:WF-RETRO-DEBT | mem:project_workflow_as_code_2026_11_16 |
| A lesson kept only in memory is advice: it needs a home CI can resolve | already | rule:WF-LESSON | mem:project_workflow_as_code_2026_11_16 |
| Plain `biome check` exits 0 on warnings, so every diagnostic must fail CI | already | rule:BIOME | CLAUDE.md |
