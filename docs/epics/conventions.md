# Codex Epic Family — Conventions Spine

The shared house-style + mechanics for the `codex-` epic skill family. Every family skill cites this
doc instead of restating these rules. (Codex-tailored equivalent of nmemo's
`architecture/workflow/{epic-implementation-cycle,self-hardening}.md`.)

Produced in WP-1 (`Codex-9wkbs.1`). Authority for promotion lives here; the top rung is `docs/adr/`.

---

## 1. The family (the closed loop)

```
codex-epic-create ─► codex-epic-implement ─► codex-review ─► codex-epic-retro ─► codex-crystalize
   (scope+scaffold)    (gated per-WP cycle)    (swarm)        (harden lessons)     (promote up ladder)
                              ▲ codex-epic-handoff (zero-context recovery, read-only) ▲
```

| Skill | Role |
|---|---|
| `codex-epic-create` | Scope a feature, verify unknowns, scaffold beads epic + WPs. Replaces epic-cycle Phase A. |
| `codex-epic-implement` | Walk each WP through the gated cycle. Writes the bd-audit trail. Replaces Phase B. |
| `codex-review` | Multi-agent conformance swarm (`reviewer-roster.yaml`). |
| `codex-epic-handoff` | Emit a zero-context continuation prompt for an in-flight epic. Read-only. |
| `codex-epic-retro` | Post-merge: read the audit trail, harden lessons into durable homes. |
| `codex-crystalize` | Cross-skill meta-consolidation; promote recurring lessons up the ladder. |

**End-state principle (user direction 2026-05-31).** This family is Codex's *sole* epic+quality
workflow. Legacy skills (`epic-cycle`, `denoise`, `design-system`, `pr-review-agent-team`,
`codebase-audit`, `fallow-audit`, …) are **harvested for content, then retired** — the family is
self-contained and does NOT delegate to skills that will be deleted. `codex-review` is a **small (5)
conformance swarm** (see `codex-review/references/reviewer-roster.yaml`). `SIMPLIFY`, `FALLOW`, and
`VISUAL-VERIFY` (the design-system MCP gate, UI WPs only) are **cycle STAGES of `codex-epic-implement`**,
not swarm reviewers. Retirement (deletion) is confirmed with the user before it happens — it's irreversible.

---

## 2. SKILL.md house style (matches existing Codex skills)

Frontmatter — exactly these keys:

```yaml
---
name: codex-epic-implement
description: >
  1–3 sentences. Verb-driven. State WHEN to invoke and the gate strategy up front.
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Agent, AskUserQuestion, Skill, ToolSearch
---
```

Section order (drop sections that don't apply):
`§0 When to invoke vs defer` → `§1 Hard Rules (table + rationale + feedback citations)` →
`§2 Decision tree / architecture` → `§3+ Workflow (phases/stages)` → `§N Quality gates / checklist` →
`§N+1 Memory rules applied` → `§N+2 Examples / triggers` → `§N+3 Anti-patterns` → `Related`.

Hard-rule rows cite their origin: ``per `feedback_<slug>` `` or ``CLAUDE.md#<section>``.
References go in `references/NN-topic.md` (numbered, ~200–280 lines, loaded on demand).
Reviewer/agent briefs go in `agents/<name>.md`.
Deterministic helpers go in `scripts/*.sh` (must be `chmod +x`, emit TSV/JSON, exit 0 on success).

---

## 3. bd-audit discipline (the data retros read)

Every gated stage and every swarm writes an append-only entry to `.beads/interactions.jsonl` via
`bd audit record`. This is what `codex-epic-retro`'s `audit-tally.sh` measures.

```bash
# codex-epic-implement — one per stage, on stage EXIT:
bd audit record --kind=tool_call --issue-id=<wp> --tool-name=codex-epic-implement \
  --prompt="stage-<N> <NAME> complete"

# codex-review — bracketing the swarm:
bd audit record --kind=tool_call --issue-id=<wp> --tool-name=codex-review \
  --prompt="swarm-start: <N> agents, scope=<file-count> files"
bd audit record --kind=tool_call --issue-id=<wp> --tool-name=codex-review \
  --prompt="swarm-end: <C>C/<H>H/<M>M/<L>L/<n>nit; <one-line action summary>"
```

Rules:
- Write `swarm-start` BEFORE spawning agents and `swarm-end` AFTER collation — a stage that ran but
  left no audit entry is itself a drift signal the retro flags.
- Standalone `/codex-review` (no WP context) skips audit entries but still prints the tally header.
- Stage names (canonical): `0 PREFLIGHT, 1 ORIENT, 2 VERIFY, 3 IMPLEMENT, 4 TEST, 5 SIMPLIFY, 6 REVIEW, 7 FALLOW, 8 REGRESSION, 9 SHIP`.

---

## 4. Lessons substrate — `bd remember` (NOT MEMORY.md)

`bd prime` bans per-skill `MEMORY.md` ("fragment across accounts; use bd remember"). So canonical,
cross-session lessons live in `bd remember`, **keyed per-skill**:

```bash
bd remember --key "<skill-short>/<kebab-slug>" "<lesson>. Why: <…>. How to apply: <…>. Added <date> (<epic/PR>)."
bd memories <keyword>                 # search before writing (avoid duplicates)
bd remember --key <key> "<new text>"  # update in place
bd forget <key>                       # remove when proven wrong
```

- `<skill-short>` ∈ `{create, implement, review, handoff, retro, crystalize}`.
- The **timestamped append-only narrative** (nmemo's MEMORY.md feel) lives in the retro/crystalize
  **docs** under `docs/epics/` — that is the audit log of what we thought when. `bd remember` holds
  only the distilled, currently-true rule.
- Decision D3 is **reversible**: if per-stage lessons prove too high-volume for `bd remember`, add
  `docs/epics/lessons/<skill>.md` as a working log and keep `bd remember` for promoted rules only.

---

## 5. The promotion ladder (how lessons harden)

```
docs/epics/retros/<epic>.md         (raw cycle observations — codex-epic-retro writes)
        ▼  3+ independent confirmations, no new exceptions, teachable in one paragraph
bd remember  (key: <skill>/<slug>)  (distilled cross-session rule)
        ▼  rule is stable + skill-specific
SKILL.md §1 Hard Rules              (becomes a gate in that skill)
        ▼  rule is cross-skill OR structural (defines cycle shape)
docs/adr/NNNN-<slug>.md             (load-bearing architectural decision, alternatives recorded)
        ▼  the rule is now project-wide canon
CLAUDE.md / sub-CLAUDE.md           (binding on ALL agents)
```

Promotion **preserves both ends**: when a `bd remember` entry is promoted to a SKILL.md rule or ADR,
update the entry in place to note ``Promoted to <home> on <date>.`` — the breadcrumb stays.
`codex-crystalize` is the only skill that drives promotion, and only through user dialog (nothing
auto-applies beyond typo/timestamp fixes).

---

## 6. Docs layout (the `docs/epics/` tree)

```
docs/epics/conventions.md                     # this file
docs/epics/retros/<epic-id>.md                # codex-epic-retro output, one per epic
docs/crystalizations/<YYYY-MM-DD>-crystalization.md   # codex-crystalize output
docs/crystalizations/ROLLING-INVENTORY.md     # cross-cycle recurring-gap table
docs/adr/NNNN-<slug>.md                        # Architecture Decision Records (top promotion rung)
```

Dates: scripts cannot call `Date.now()`/`new Date()`. Stamp dates by reading the latest git commit
date (`git log -1 --format=%cd --date=short`) or pass the date in explicitly — never hardcode.

---

## 7. Branch, commit, PR conventions

- Branch: `feat/<wp-id>-<short-slug>` (e.g. `feat/codex-9wkbs.3-implement`). NEVER push to main/dev directly (`feedback_agent_branch_not_main`).
- Re-check `git branch --show-current` live before every git op — the session-start snapshot goes stale (`feedback_main_worktree_head_shift`).
- Conventional commits: `feat(<scope>): WP-N <subject>`. Co-author trailer required.
- One PR per epic where practical; PR body has Summary + Test Plan; title < 70 chars.
- After merge: `bd close <wp-id>` then `bd sync`.

---

## 8. The gate (`gate.sh`, run at the SHIP stage)

The Codex equivalent of nmemo's `gate.sh` (which ran swift/xcodebuild). Runs, in order, and reports a
**terminal marker** — never trust a piped exit code (`feedback`/nmemo `gate-exit-code-masked-by-pipe`):

```
pnpm typecheck                 # no `as any`, no @ts-ignore left behind
biome check <changed>          # MUST exclude .beads/ and .dolt/ (bd remember: biome-must-exclude-beads-and-dolt)
pnpm test --filter <pkg>       # turbo --concurrency=1 (bd remember: turbo-concurrency-shared-neon)
pnpm build --filter <pkg>      # catches Vite/Svelte/dts errors typecheck misses
→ prints "✓ ALL GATES PASSED" or "✗ FAILED GATES: <list>"
```

UI work additionally requires Playwright MCP verification (`feedback_thorough_verification`); it is not
part of `gate.sh` (interactive), but is a close-checklist item.

---

## 9. bd 1.0.4 CLI cheatsheet (differs from nmemo's bd!)

nmemo scripts assume an older bd. On Codex (bd 1.0.4, Dolt-backed) these differ — porting scripts
verbatim silently emits nothing:

| Need | bd 1.0.4 | nmemo-era (DO NOT use) |
|---|---|---|
| machine-readable list | `bd list --json` (pipe to python/jq) | `bd list --no-color \| awk` ❌ |
| filter status | `bd list --status open,in_progress` | same ✓ |
| filter label | `bd list --label <l>` / `--label-any` | `--label` ✓ |
| create with labels | `bd create --labels a,b` (plural) | varies |
| parent link | `bd create --parent <id>` → hierarchical `<epic>.<n>` ids | `bd epic create` ❌ |
| audit | `bd audit record --kind=tool_call --issue-id=<id> --tool-name=<t> --prompt="…"` | `bd audit log <id> "…"` ❌ |
| lessons | `bd remember --key k "…"` / `bd memories <kw>` / `bd forget k` | MEMORY.md ❌ |
| sync | `bd sync` (daemon auto-commits to Dolt) | `bd dolt push` |

Always probe `bd <cmd> --help` before baking a flag into a script.
