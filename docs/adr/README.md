# Architecture Decision Records (ADRs)

The **top promotion rung** of the `codex-*` epic family's learning loop (see
`docs/epics/conventions.md` §5). A lesson that is load-bearing — a structural decision with
alternatives worth recording — graduates here from `bd remember` / a SKILL.md rule.

`codex-epic-retro` drafts ADRs; `codex-crystalize` promotes recurring lessons into them. Both surface
the draft for user confirmation — ADRs are not auto-applied.

## Naming
`NNNN-<kebab-slug>.md`, zero-padded sequential (`0001-…`, `0002-…`).

## Template

```markdown
# ADR-NNNN: <title>

- **Status:** proposed | accepted | superseded by ADR-MMMM
- **Date:** <YYYY-MM-DD>   (stamp from `git log -1 --format=%cd --date=short`)
- **Promoted from:** <bd remember key / SKILL.md rule / retro> (preserve the lineage)

## Context
What forces are at play; what problem/decision this addresses.

## Decision
The decision, stated plainly.

## Alternatives considered
- <option> — why not.

## Consequences
What becomes easier/harder; follow-on work (filed as beads).
```

## Index
<!-- codex-crystalize / codex-epic-retro append entries here -->
- _none yet_
