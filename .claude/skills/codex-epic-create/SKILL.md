---
name: codex-epic-create
description: >
  Drive the Codex epic creation cycle — scope a feature through design Q&A, verify unknowns (Context7 /
  web search), scan adjacent beads + prior retros, write an implementation plan, then scaffold a beads
  epic + child WPs with dependencies, labels, and the plan reference. Enforces one PR per epic. Replaces
  epic-cycle Phase A. Read-only on code — its output is beads issues and a plan, never code.
allowed-tools: Read, Grep, Glob, Bash, Write, Agent, AskUserQuestion, Skill, ToolSearch
---

# Codex Epic Create — scope & scaffold

The front of the `codex-*` family. Takes a rough feature idea to an approved plan + a beads epic whose
WPs `codex-epic-implement` then walks. Runs the design/plan part in **plan mode**; scaffolds beads only
after the plan is approved. See [`docs/epics/conventions.md`](../../../docs/epics/conventions.md) for
branch/commit conventions and the lessons substrate.

---

## §0 — When to invoke vs defer

```
Use codex-epic-create when:
  - A feature is meaningfully multi-WP (3+ tasks) with real design decisions
  - /codex-epic-create <feature>
  - A retro/crystalize surfaced cross-cutting work that warrants its own epic

Defer to:
  - codex-epic-implement — the epic already exists; just walk the WPs
  - a plain bd task + direct fix — single change, scope = 1 PR, < 1 day
  - just answering — exploratory "what could we do about X"
```

Never start implementation here. Output = beads issues + a plan file. Never `--status=in_progress`.

---

## §1 — Hard Rules

| # | Rule | Why |
|---|---|---|
| R1 | The design + plan run in PLAN MODE. NEVER write production code here. | Plan mode protects the tree while you ask questions. |
| R2 | Ask design questions BEFORE writing the plan, in batches of ≤4 via `AskUserQuestion`. | `feedback_design_questions` — don't assume taste. |
| R3 | When the user says "best outcome not simplest", switch defaults from "Recommended" → most-rigorous. | `feedback_dont_push_to_stop` — propose forward. |
| R4 | Scan adjacent beads (`adjacent-work-scan.sh`) AND retros BEFORE proposing scope. | `feedback_bd_search_before_filing` — avoid duplicate epics. |
| R5 | Verify unknowns with Context7 / web search before locking a design that depends on them. | `feedback_thorough_research_context7` — don't guess third-party behaviour. |
| R6 | One PR per epic where practical; record the branch convention in the plan. | Keeps the epic a single reviewable unit. |
| R7 | ExitPlanMode requests approval — never use AskUserQuestion to ask "is the plan ok?". | That's literally what ExitPlanMode does. |

---

## §2 — The create workflow

### Stage 1 — Load context (parallel)
- Grep `design/`, `docs/`, relevant `CLAUDE.md` files for the feature + adjacent concepts.
- **Adjacent beads:** `scripts/adjacent-work-scan.sh <area-keyword> [more...]` — surface open/in_progress beads so you fold into existing work instead of duplicating.
- **Retro-scan:** read recent `docs/epics/retros/*.md` + `bd memories <area>` for prior lessons that should shape scope.
- Spawn 1–3 Explore agents (per scope uncertainty) to map existing implementations/patterns to reuse. Cap each at ~400 words; tell them to restrict greps to `src/`, exclude `dist/` (`feedback_audit_grep_dist_contamination`).
- Summarise back: corpus references, adjacent beads, prior lessons.

### Stage 2 — Surface & verify unknowns
- Enumerate unknowns: capability/perf questions, API ergonomics, third-party (Stripe/Neon/Cloudflare) behaviour, data-model ambiguities.
- Resolve via `mcp__context7` (library/SDK behaviour) or web search. For each: decide **search now / defer to the user / accept as risk** and record the verified answer.

### Stage 3 — Design Q&A
- `AskUserQuestion`, ≤4 options per question, batches as needed. Lead with "Recommended" but be explicit about trade-offs. Common forks: data model (column vs table; status enum vs derived), lifecycle (single vs multi-round; lock semantics), UX scope (which surface owns it; per-user vs per-org), boundary scope (which revenue types/roles v1).
- If the user pushes back ("you're picking the easy options") → switch defaults to most-rigorous and re-ask with that lens.

### Stage 4 — Write the plan
Save to `~/.claude/plans/<descriptor>.md`. Required sections:
1. **Context** — why, what triggered it, intended outcome.
2. **Locked-In Design Decisions** — choice + rationale (table).
3. **Data Model** — schema changes, new tables, migration approach.
4. **Surfaces & Routes** — file locations, owner/creator sides, notifications.
5. **Service Layer** — new packages, service methods, error types.
6. **Work Package Breakdown** — table: WP# / Title / Type / Depends on / Notes.
7. **Critical Files Reference** — existing files (read for patterns) + new files.
8. **Verification** — how to test end-to-end (Playwright MCP, Stripe CLI, gate.sh).
9. **Out of Scope (Future Epics)** — bright-line boundaries.
10. **Open Questions** — deferred decisions tied to specific WPs.
11. **Beads Epic Structure** — dep chain, priorities, labels.

### Stage 5 — ExitPlanMode
Submit for approval. Do NOT ask "is this ok" any other way.

### Stage 6 — Scaffold beads (after approval) — bd 1.0.4
```bash
# Epic
bd create --type=epic --priority=1 --labels=<topic>,<area> \
  --title="<Epic Title>" --description="Plan: <path>. <motivation>. <WP list>. <dep chain>."
# note the epic id, then create WPs as hierarchical children (parented):
bd create --type=feature --priority=<P> --parent=<epic-id> --labels=<topic> \
  --title="WP-N: <subject>" --description="Epic: <epic-id>. Plan: <path>. <scope>. <tests required>."
# wire cross-WP deps (issue depends on depends-on):
bd dep add <WP-N-id> <WP-M-id>
# verify
bd show <epic-id>; bd ready
```
Use `feature` for functionality, `task` for tests/docs/chores. `--parent` makes `<epic>.<n>` ids.
(bd 1.0.4: `--labels` plural on create; NO `--no-color`; `--json` to parse.)

### Stage 7 — Save memory
- `bd remember --key "create/<epic-slug>" "<non-obvious scope decisions + why>. Epic <id>. Plan <path>."`
- Write `~/.claude/projects/-Users-brucemckay-development-Codex/memory/project_<descriptor>.md` (epic id, plan path, **Why**, **How to apply**, WP table, dep chain, adjacent beads, `[[links]]`).

### Stage 8 — Sync
```bash
bd sync
git status   # clean (daemon auto-commits beads to Dolt; never commit unrelated files)
```

---

## §3 — What this skill NEVER does
- Never writes production code (output is beads + plan).
- Never marks a WP `in_progress` or pushes a branch (that's `codex-epic-implement`).
- Never skips the design Q&A or the adjacent/retro scan.

## §4 — Triggers
"design X — let's chat" · "plan and scaffold the epic for Y" · `/codex-epic-create <feature>`.

## Related
- `codex-epic-implement` (walks the WPs this creates) · `codex-epic-retro` (its lessons feed Stage 1's retro-scan) · `docs/epics/conventions.md`.
- `scripts/adjacent-work-scan.sh`.
