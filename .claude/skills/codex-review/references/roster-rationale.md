# Codex Reviewer Roster — Rationale, Gap Analysis & Harvest Plan

Companion to `reviewer-roster.yaml` (v2). Records **why** the swarm is just 5 reviewers, **what gets
absorbed from where**, and **which legacy skills retire**. Produced in WP-1 (`Codex-9wkbs.1`).

## Governing principle (user direction, 2026-05-31)

> "i dont want to have these skills anymore when we are done so we can take what we can from there …
> fallow deadcode simplify should be a separate step not a reviewer … we are going for the workflow we
> defined in ios."

So: the `codex-*` family is the **sole** workflow. Legacy skills are a **quarry**, not delegates.
`codex-review` absorbs their checklist content and stays small; non-review concerns become cycle steps.

## How the roster was condensed (21 → 5)

1. Coverage analysis (sub-agent 1) classified every CLAUDE.md hard rule COVERED/PARTIAL/NOT-COVERED.
2. Owner analysis (sub-agent 2) mapped each concern to the skill that owns it best.
3. User reframe: owners are **retiring**, so "delegate" became "harvest into a brief or a cycle step."
4. Anything that is **not** a diff-review-at-the-gate concern was moved OUT of the swarm:
   - simplification → **SIMPLIFY** cycle step (absorbs `simplify`)
   - dead code → **FALLOW** cycle step (absorbs `fallow-audit`)
   - UI/CSS/a11y/tokens → **VISUAL-VERIFY** cycle step (absorbs `design-system` MCP gate)
   - deep proof-tested security/type/perf/simplification audits → folded into briefs + the retro/crystalize loop (supersedes `denoise`'s separate cadence)
5. What remained — Codex-specific conformance that must read the diff — condensed to **5**.

## The 5, and why each is irreplaceable

| Reviewer | Why it survives condensation | Absorbs from |
|---|---|---|
| `silent-failure-hunter` (generic) | 100% real-bug rate; nothing else hunts swallowed errors. Always-on. | — |
| `scoping-security` | Tenant data-exposure = highest-cost defect class. Merges security + db-scoping. | `security.md`, `database.md`(scoping), `denoise/01-security` |
| `backend-conformance` | "Wired the Codex way" — merges service-registry + API-envelope + typed-errors + procedure + N+1. 4→1. | `services.md`, `workers.md`, `architecture.md`, `denoise/04-perf`, `backend-dev` |
| `commerce-stripe` | Money loss; portal-lockdown / FOR UPDATE / GBP — **no skill owns this**. | `stripe-best-practices`, `security.md`(webhook), `backend-dev` |
| `migration-safety` | FK-ordering test breakage + DDL pitfalls — recurring in memory, **no skill owns it**. | `database.md`(migration) |

## What deliberately did NOT become a reviewer

- **error-handling / type-design** as standalone reviewers — folded into `backend-conformance` +
  `silent-failure-hunter` + the `typecheck` gate. A third reviewer here = corroboration noise.
- **ports/URLs + currency + i18n-dual-file + caching-invalidation** — narrow, near-mechanical. They are
  `checklist_pointers` (folded into briefs/steps) and **lint-candidates** (a real lint rule beats a
  per-PR agent). i18n dual-file is high-cost-but-narrow → VISUAL-VERIFY checklist + lint.
- **css / component / local-first / testing** reviewers — replaced by cycle steps (VISUAL-VERIFY) and
  the generic `pr-test-analyzer` (spawned on test deltas only, outside the core 5).

## Harvest-then-retire (WP-8, confirm before deletion)

Each legacy skill is read for content during WP-2/WP-3 brief/step authoring, THEN retired:

| Legacy skill | Harvested into | Disposition |
|---|---|---|
| `epic-cycle` | `codex-epic-create` + `codex-epic-implement` | retire |
| `pr-review-agent-team` | `codex-review` (this swarm) | retire |
| `denoise` | briefs (security/perf) + the retro/crystalize loop | retire (loop superseded) |
| `codebase-audit` | `codex-review --full` mode | retire |
| `fallow-audit` | FALLOW cycle step | retire |
| `design-system` | VISUAL-VERIFY step + `codex-epic-implement/references/` | **DECISION NEEDED** — large skill; likely keep its reference docs as a harvested reference rather than delete wholesale |
| `caching`, `tanstack-db`, `backend-dev`, `stripe-best-practices` | reviewer briefs + `references/` | likely **keep as reference** (domain knowledge, not workflow) |

**Deletion is irreversible — the retirement list is confirmed with the user before WP-8 removes anything.**
