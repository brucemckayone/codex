---
name: codex-epic-retro
description: >
  Run a post-merge retrospective on a completed epic. Reads the bd-audit trail (per-WP stage + review
  tallies), the PRs, and codex-review findings; identifies recurring patterns; and HARDENS each lesson
  into its durable home — bd remember, a new lint/task bead, an ADR draft, a SKILL.md rule, or a
  CLAUDE.md proposal. Writes the retro doc + updates the rolling cross-cycle inventory. The mechanism by
  which the codex-* loop improves over time.
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Agent, Skill, ToolSearch
---

# Codex Epic Retro — harden the lessons

The learning half of the loop. After an epic's PRs merge, this reads what actually happened (the
audit trail `codex-epic-implement` wrote) and promotes durable lessons up the ladder defined in
[`docs/epics/conventions.md`](../../../docs/epics/conventions.md) §5.

---

## §0 — When to invoke vs defer

```
Use codex-epic-retro when:
  - An epic's PRs have MERGED  →  /codex-epic-retro <epic-id>
  - A significant mid-epic pause warrants a partial retro  →  --partial

Defer when:
  - The epic hasn't merged (retros are post-merge)
  - The lesson is cross-EPIC / cross-skill — that's codex-crystalize
```

---

## §1 — Hard Rules

| # | Rule | Why |
|---|---|---|
| R1 | Retros run post-merge. Read the merged code, not just the audit log. | `feedback`/nmemo: autonomous retros that read only logs miss the real lesson. |
| R2 | Every hardening lands in EXACTLY ONE durable home (ladder §5). Don't restate the same lesson in three places. | Prevents the fragmentation `bd prime` warns about. |
| R3 | Promotion preserves both ends — when a `bd remember` entry becomes a SKILL/ADR rule, annotate it `Promoted to <home> on <date>`. | Audit trail of what-we-thought-when. |
| R4 | A concrete deferral becomes a `bd create` task with an owner — never just a doc note. | Deferrals without a tracked owner silently compound. |
| R5 | A pattern seen 3+ times across cycles goes to the ROLLING-INVENTORY for crystalize to promote. | Recurrence is the promotion trigger. |

---

## §2 — Workflow

### Stage 1 — Load the epic's history
- `bd show <epic-id>` + `bd list --parent <epic-id> --json` (or by label) — the WPs + their close reasons.
- **Audit tally:** `scripts/audit-tally.sh <epic-id>` — per-WP stage completeness + swarm counts. Flag any `partial`/`missing` WP (a skipped gate is itself a finding).
- Read the merged PRs (`gh pr view`) and the `codex-review` findings recorded in each WP's audit (`swarm-end` tallies).
- If a prior retro exists for a related area, read `docs/epics/retros/*.md` for patterns to re-check.

### Stage 2 — Identify patterns
Categorise findings: bug-class lineage (where did a defect originate → get caught → get fixed →
become a test?); silent-failure-dense zones (persistence, webhooks, gate code); doc-vs-code drift;
scope creep (OK if surfaced); audit-discipline drift (WPs that skipped stages); recurring review
findings (same reviewer flagging the same rule across WPs).

### Stage 3 — Decide each lesson's home (the ladder)
| Lesson shape | Home |
|---|---|
| Cross-session rule, skill-specific, stable | `bd remember --key "<skill>/<slug>"` |
| Concrete deferred work | `bd create --type=task` (owner assigned) |
| New mechanical rule worth enforcing | `bd create --type=task` for a real **lint rule** |
| Skill-specific gate | edit that skill's `SKILL.md` §1 |
| Load-bearing architectural decision | draft `docs/adr/NNNN-<slug>.md` |
| Project-wide canon | propose a `CLAUDE.md` / sub-CLAUDE.md edit (surface, don't auto-apply) |
| Recurring across 3+ cycles | add to `docs/crystalizations/ROLLING-INVENTORY.md` |

### Stage 4 — Apply the hardenings
- `bd remember` / `bd create` the concrete ones now.
- Draft ADRs / propose CLAUDE.md edits (these are surfaced for user confirmation, not auto-applied).

### Stage 5 — Write the retro doc
`docs/epics/retros/<epic-id>.md` (template §3). Stamp the date from `git log -1 --format=%cd --date=short` — scripts/skills must not hardcode dates.

### Stage 6 — Update the rolling inventory
Add any 3+-cycle recurring gap to `docs/crystalizations/ROLLING-INVENTORY.md` with its cycle count and urgency, for `codex-crystalize` to promote.

---

## §3 — Retro doc template

```markdown
# Retro: <epic-id> — <epic title>

**Merged:** <date>  ·  **WPs:** <n>  ·  **Audit:** <x/y complete, list partial/missing>

## What worked
- …
## What didn't
- …  (each with the WP + evidence)
## Hardenings applied
- bd remember `<skill>/<slug>`: <rule>
- New lint task: <bead-id> — <rule>
- ADR draft: docs/adr/NNNN-<slug>.md — <decision>
- SKILL.md edit: <skill> §1 — <rule>
## Surfaced for user decision
- CLAUDE.md proposal: <edit> (NOT yet applied)
## Recurrence (-> ROLLING-INVENTORY)
- <pattern> — now seen in N cycles
```

## §4 — Anti-patterns
- ❌ Reading only the audit log, not the merged code (R1).
- ❌ Restating one lesson in bd remember AND SKILL.md AND CLAUDE.md (R2).
- ❌ "We should fix X someday" with no bead (R4).

## Related
- `codex-epic-implement` (writes the audit trail) · `codex-review` (its findings feed Stage 2) · `codex-crystalize` (consumes the ROLLING-INVENTORY) · `docs/epics/conventions.md` §5 (the ladder).
- `scripts/audit-tally.sh`.
