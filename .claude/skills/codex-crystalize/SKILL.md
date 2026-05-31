---
name: codex-crystalize
description: >
  Crystalize diffuse meta-learning across the codex-* family into durable shape. Reads all skill
  SKILL.md files, the bd-remember substrate, retros, ADRs, and CLAUDE.md, then surfaces patterns ready
  to graduate a layer (bd remember → SKILL.md → docs/adr → CLAUDE.md), entries silently superseded,
  doc-vs-reality drift, and recurring cross-cycle gaps. Conversational — every promotion goes through
  user dialog and preserves the audit trail. Nothing auto-applies beyond typo/timestamp fixes.
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Agent, AskUserQuestion, Skill, ToolSearch
---

# Codex Crystalize — promote the lessons

The apex of the learning loop. Where `codex-epic-retro` hardens one epic's lessons, `codex-crystalize`
consolidates ACROSS epics and skills — promoting recurring lessons up the ladder in
[`docs/epics/conventions.md`](../../../docs/epics/conventions.md) §5 and healing doc drift.

---

## §0 — When to invoke vs defer

```
Use codex-crystalize when:
  - 1–2 epics' worth of retros/bd-memories have accrued without consolidation
  - /codex-crystalize  (or "consolidation" / "meta-retro" / "skill-architecture audit")
  - A retro produced a finding that fits no single skill (cross-skill)
  - The ROLLING-INVENTORY shows a 3+-cycle recurring gap

Defer when:
  - Single-epic retrospective — that's codex-epic-retro
  - Rewriting a skill from scratch — crystalize refines, never replaces
  - Concurrent runs — race on shared edits; one at a time
```

---

## §1 — Hard Rules

| # | Rule | Why |
|---|---|---|
| R1 | NEVER delete a `bd remember` entry or doc lesson. Mark superseded; keep the words. | The substrate is the truth-of-what-we-thought-when. |
| R2 | Promotion preserves BOTH ends — annotate the source `Promoted to <home> on <date>`; the new home is canonical, the source is a breadcrumb. | Lineage must survive. |
| R3 | Conversational. Nothing auto-applies except typo/timestamp fixes — every promotion goes through user dialog. | Promotion changes project canon; humans decide. |
| R4 | A concrete deferral becomes a `bd create` task with an owner — not a doc note. | Untracked deferrals compound. |
| R5 | Promotion criteria: bd remember → SKILL.md needs 3+ independent confirmations, no new exceptions, teachable in one paragraph. | Recurrence, not novelty, drives promotion. |

---

## §2 — The promotion ladder (recap)

```
docs/epics/retros/<epic>.md  →  bd remember (<skill>/<slug>)  →  SKILL.md §1  →  docs/adr/NNNN  →  CLAUDE.md
```
Each step up requires the rule be more confirmed and more cross-cutting than the last. `docs/adr/` is the
top structural rung; `CLAUDE.md` is project-wide canon (surface the edit, never auto-apply).

---

## §3 — Workflow

### Stage 1 — Load meta-state
```bash
.claude/skills/codex-crystalize/scripts/scan-meta-state.sh
```
JSON: skills, retros, adrs, crystalizations, rolling_inventory_exists, bd_memories_approx. Then read the
ROLLING-INVENTORY and `bd memories` for the areas it flags.

### Stage 2 — Identify (categorise every finding into exactly one)

| Category | Definition |
|---|---|
| **DRIFT** | Two docs disagree, or one disagrees with reality (e.g. a SKILL cites a flag that changed). |
| **PROMOTION** | A lesson mature enough to graduate a layer (3+ confirmations). |
| **CONSOLIDATION** | Overlapping `bd remember` entries; one silently supersedes another. |
| **INVENTORY** | Load-bearing knowledge living only in retros, restated by hand. |
| **THRESHOLD** | A substrate growing past a healthy size (split/compact). |
| **SKILL-GAP** | A pattern recurring with no skill home (maybe a new reviewer/stage). |

Findings that fit no category: name them, set aside, leave for next run.

### Stage 3 — Prioritise
DRIFT + SKILL-GAP (unblock other work) > PROMOTION (hardens knowledge) > CONSOLIDATION/INVENTORY (hygiene) > THRESHOLD (defer if trigger ≠ urgency).

### Stage 4 — Surface with citations
For each finding: category + title; the source(s) (which retro / memory key / doc collision); 2–3 evidence quotes; the proposed action. **Auto-apply allowlist: ONLY typo/timestamp fixes.** Everything else → dialog.

### Stage 5 — Dialog + apply
Per approved finding: make the edit (SKILL.md / ADR / propose CLAUDE.md); annotate the source with the `Promoted to … on <date>` breadcrumb (R2); `bd create` any structural follow-up (R4). Date from `git log -1 --format=%cd --date=short`.

### Stage 6 — Write the crystalization doc
`docs/crystalizations/<YYYY-MM-DD>-crystalization.md`: triggers, findings-by-category, Applied, Deferred (with bead ids), Skill-gaps identified.

### Stage 7 — Update ROLLING-INVENTORY + own hygiene
Refresh `docs/crystalizations/ROLLING-INVENTORY.md` (cross-cycle gaps + counts); `bd remember --key "crystalize/<slug>"` any new finding-type or promotion-criteria edge case.

---

## §4 — Anti-patterns
- ❌ Deleting a superseded memory instead of marking it (R1).
- ❌ Auto-applying a SKILL/ADR/CLAUDE.md edit without dialog (R3).
- ❌ Promoting a lesson seen once ("novelty"); promotion needs recurrence (R5).
- ❌ Inventing a new skill layer unilaterally — that's itself a finding requiring approval.

## Related
- `codex-epic-retro` (feeds the ROLLING-INVENTORY) · `docs/epics/conventions.md` §5 (the ladder) · `docs/adr/` (top rung).
- `scripts/scan-meta-state.sh`.
