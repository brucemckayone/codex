---
name: epic-cycle
description: >
  DEPRECATED — superseded by the codex-* family (codex-epic-create + codex-epic-implement). Kept as a
  fallback until that loop is proven on one real epic, then removed (see docs/adr/0001).
  Two-phase workflow for substantial multi-WP features in the Codex monorepo.
  Phase A (Plan + Scaffold): Explore → design Q&A → write plan → ExitPlanMode →
  create beads epic + child WPs → wire deps → save memory. Phase B (Strict
  per-WP Cycle): orient → implement → test → /simplify → /review → /fallow →
  regression → commit. Use when the user has a real feature that spans multiple
  work packages and needs both careful upfront design AND reliable per-WP execution
  with quality gates. NOT for one-off bug fixes or simple changes.
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Agent, AskUserQuestion, Skill, TaskCreate, TaskUpdate, ToolSearch
---

# Epic Cycle — Plan-and-Ship Workflow

A skill for taking substantial features from "rough idea" to "shipped across N work packages" without sacrificing design quality or per-WP rigour.

---

## §0 — When To Invoke vs Defer

```
Use /epic-cycle when ALL of:
  - The work is meaningfully multi-WP (3+ tasks, likely 4-6 weeks)
  - There are real design decisions (data model, UX flow, scope boundaries)
  - The user wants quality gates on every WP (tests, review, simplify, fallow)
  - You have time to do Phase A properly — DO NOT skip planning under time pressure

Defer to:
  - /triage      — backlog item already filed, just needs routing
  - /denoise     — quality audit cycle, not feature work
  - /codebase-audit — cross-cutting review, no implementation
  - /backend-dev — single endpoint or service method, scope = 1 PR
  - /design-system — pure UI polish on an existing component
  - Just answering — exploratory "what could we do about X" questions
```

If the user describes a bug fix that's clearly < 1 day of work, do NOT use this skill — over-engineering process kills momentum.

---

## §1 — Hard Rules

| # | Rule | Why |
|---|---|---|
| R1 | Phase A runs in plan mode. NEVER write production code in Phase A. | Plan-mode protects the working tree while you ask questions. |
| R2 | Ask design questions BEFORE writing the plan, in batches of ≤4 via `AskUserQuestion`. | Per `feedback_design_questions` — don't assume taste. |
| R3 | When user says "best outcome not simplest", switch defaults from "Recommended" → "most rigorous". | Per `feedback_dont_push_to_stop` — propose forward, not backward. |
| R4 | Per-WP cycle (Phase B) is 8 steps. NEVER skip steps. NEVER batch closures. | Each gate catches a different class of defect. |
| R5 | Background agents work in worktree isolation. Main chat never edits files while agents are running. | Per `feedback_worktree_content_bleed_bidirectional`. |
| R6 | NEVER push to main directly. Always `feat/<wp-id>-<slug>` branches with PRs. | Per `feedback_agent_branch_not_main`. |
| R7 | NEVER `as any`. Type hygiene is a hard close-gate. | Per `feedback_modularity_no_any`. |
| R8 | Money/auth code requires positive AND negative tests both. | Per `feedback_security_deep_test`. |

---

## §2 — Phase A: Plan + Scaffold

### Step A1 — Frame the work (5 min)
- Restate the user's problem in your own words.
- Identify whether it's bug-driven (start from the repro) or feature-driven (start from the user story).
- If bug-driven: read the failing path end-to-end before proposing fixes.

### Step A2 — Explore the codebase (parallel agents)
- Spawn **1–3 Explore agents in parallel** based on scope uncertainty:
  - 1 agent for narrow, well-bounded work
  - 2–3 agents when scope is uncertain or spans multiple subtrees
- Each agent gets a specific focus (don't duplicate searches). Examples:
  - "Find where X is implemented + its tests"
  - "Map existing UI patterns I can reuse"
  - "Locate two-party consent flows I can model on"
- Cap response at ~400 words per agent to avoid context flooding.
- Per `feedback_audit_grep_dist_contamination`: tell agents to restrict greps to `src/`, exclude `dist/`.

### Step A3 — Design questions (multi-batch if needed)
Use `AskUserQuestion` with 1–4 options per question. Lead with "Recommended" but be explicit about trade-offs. Common forks:

- **Data model:** new column vs new table; status enum vs derived state.
- **Lifecycle:** single-round vs multi-round; lock semantics; termination policy.
- **UX scope:** which surface owns the feature; per-user vs per-org; visibility/transparency.
- **Boundary scope:** which revenue types / regions / roles are covered v1.

Per `feedback_design_questions`: don't ship visual UI plans without explicit design input from the user.

**If the user pushes back** ("you're picking the easy options"): switch defaults to most-rigorous and ask remaining questions with that lens.

### Step A4 — Write the plan
Save to `~/.claude/plans/<descriptor>.md`. Required sections:

1. **Context** — Why this work, what triggered it, intended outcome.
2. **Locked-In Design Decisions** — Table of choice + rationale + notes.
3. **Data Model** — Schema changes, new tables, migration approach.
4. **Surfaces & Routes** — Where files live, owner side, creator side, notifications.
5. **Service Layer** — New packages, service methods, error types.
6. **Work Package Breakdown** — Table with WP # / Title / Type / Depends on / Notes.
7. **Critical Files Reference** — Existing files (read for patterns) + new files (to create).
8. **Verification** — How to test end-to-end (Playwright MCP, Stripe CLI, etc.).
9. **Out of Scope (Future Epics)** — Bright-line scope boundaries.
10. **Open Questions** — Deferred decisions tied to specific WPs.
11. **Beads Epic Structure** — Dependency chain, priority, labels.

### Step A5 — ExitPlanMode
Submit the plan for approval. Do NOT use AskUserQuestion to ask "is this plan ok" — that's exactly what ExitPlanMode does.

### Step A6 — Create the epic + child WPs (parallel beads)
After plan approval:

```bash
bd create --type=epic --priority=1 --title="<Epic Title>" --description="<plan-reference + WP list + dep chain>"
```

Note the epic ID. Then create all WPs **in parallel** with separate Bash calls in one message:

```bash
bd create --type=feature --priority=<P> --title="WP-N: <subject>" --description="Epic: <epic-id>. Plan: <path>. <scope>. <tests required>. <relevant memory feedback>"
```

Use `feature` for new functionality, `task` for tests/docs.

### Step A7 — Wire dependencies (parallel)
For each "WP-N depends on WP-M" relationship:
```bash
bd dep add <WP-N-id> <WP-M-id>
```
Run them all in parallel — bd handles concurrency.

### Step A8 — Link children to epic (parallel)
```bash
bd update <WP-id> --parent=<epic-id>
```
Run them all in parallel.

### Step A9 — Add labels
```bash
bd update <epic-id> <WP-1-id> <WP-2-id> ... --add-label=<topic> --add-label=<area>
```
One command, all IDs, multiple `--add-label` flags.

### Step A10 — Save project memory
Write `~/.claude/projects/-Users-brucemckay-development-Codex/memory/project_<descriptor>.md`:
- Lead with epic ID + plan file path
- **Why:** bug context or motivation
- **How to apply:** when to read the plan
- WP ID table
- Dependency chain summary
- Adjacent existing beads to coordinate with
- Related memories list (using `[[link-name]]` format)

Then update `MEMORY.md` under "Active Epics" with a one-line entry.

### Step A11 — Sync
```bash
bd sync
git status     # should be clean (daemon auto-commits beads JSONL)
```

If anything dirty, investigate before continuing.

---

## §3 — Phase B: Strict Per-WP Implementation Cycle

For **each** WP in the epic, run this 8-step cycle. No exceptions.

### Step B0 — Pre-flight
```bash
git branch --show-current     # MUST be main
git status                    # MUST be clean
bd ready                       # WP must appear, no blockers
```
Per `feedback_main_worktree_head_shift`: always verify branch before git ops with agents running.

### Step B1 — Orient
- `bd show <wp-id>` — read scope.
- **Verify stale pointers** (per `feedback_stale_bead_pointers`): if the description names files, line numbers, APIs, or flags, grep before trusting them. Treat the INTENT as authoritative but the POINTERS as suspect.
- Read the plan's "Critical Files Reference" for this WP's existing-files list.
- `bd update <wp-id> --status=in_progress` to claim.

### Step B2 — Implement
- **Branch:** `git checkout -b feat/<wp-id>-<short-slug>`.
- **Self-contained WPs** (schema, isolated component, docs): spawn a background agent with `isolation: "worktree"`. Brief with plan path + WP ID + this skill's §3 instructions.
- **Cross-cutting WPs** (pipeline integration, UI flows): work in main chat.
- **UI/UX work:** invoke `/design-system` BEFORE coding to load checklist. Tokens-only CSS, OKLCH, scoped `<style>`, Melt UI primitives, container queries, idempotent change handlers (per `feedback_melt_controlled_components`), a11y baseline.
- **Backend:** service registry via `ctx.services.*`, typed `ServiceError`, `dbWs.transaction()` for multi-step writes, `scopedNotDeleted()` on queries, `procedure()` for routes.
- Currency = GBP. Ports via `getServiceUrl()`. No `as any`. No hardcoded CSS.

### Step B3 — Test (right-sized, not over-engineered)
- **Money/auth code:** positive AND negative paths, every state transition.
- **UI:** Playwright MCP for golden path + 2-3 critical edges.
- **ServiceError tests:** use `err.name`, not `constructor.name` (per `feedback_service_error_test_instanceof`).
- Run:
  ```bash
  pnpm test --filter <pkg>
  pnpm typecheck
  ```
- Both green before proceeding. No exceptions.
- Don't write tests for trivial getters. Do write tests for anything that could lose money, expose data, or cross a security boundary.

### Step B4 — `/simplify`
- Run `/simplify` on the diff.
- Apply findings that genuinely clarify. Reject premature abstractions (three similar lines beats a bad abstraction).
- Per `feedback_simplifier_scope_overrun`: if delegating to a simplifier agent, end the prompt with **"STOP after opening PR, no follow-up work"** — they scope-creep into docs/CLAUDE.md edits.
- Re-run `pnpm test` after applying changes.

### Step B5 — `/review`
- Run `/review` on the PR diff.
- Implement Critical + Important findings. Suggestions are judgment calls — don't gold-plate.
- Re-run `pnpm test` after applying changes.

### Step B6 — `/fallow`
- Run `/fallow` (fallow-audit skill) over the diff to detect:
  - Unused exports introduced in this WP
  - Dead imports
  - Duplicated logic that could be DRYed
  - Orphan helper functions
- Per `feedback_verify_before_declaring_unused`: before deleting anything fallow flags, grep across `src/` + tests + UI for consumers. False positives are common.
- Per `feedback_audit_grep_dist_contamination`: greps must exclude `dist/`/`build/` — stale compiled `.d.ts` files fabricate ghost API pointers.
- Keep scope tight: only delete code introduced or directly touched by this WP. Don't let fallow propose unrelated deletions.

### Step B7 — Regression check
- Full affected-package test suite: `pnpm test --filter <pkg>`.
- If UI changed: Playwright smoke for adjacent routes.
- If migration touched: `pnpm db:migrate` against a fresh test DB.
- Per `feedback_thorough_verification`: every WP verified end-to-end via Playwright MCP before close. No rubber-stamping.

### Step B8 — Commit, PR, merge, close
- Conventional commit: `feat(<scope>): WP-N <subject>` or similar.
- Push: `git push -u origin feat/<wp-id>-<slug>`.
- Open PR via `gh pr create`. Title < 70 chars. Body has Summary + Test Plan.
- After PR merges:
  ```bash
  bd close <wp-id>
  bd sync
  ```
- If `pnpm install` needed mid-flight (workspace dep added), document it in the PR (per `feedback_post_ff_pnpm_install`).
- If something surprising/non-obvious emerged, save a memory entry pointing to the PR + lesson.

---

## §4 — Parallelisation Strategy

Run WPs in parallel where the dependency graph permits. Use background agents with `isolation: "worktree"` to avoid main-worktree HEAD shifts.

Typical round structure:

| Round | Pattern |
|---|---|
| 1 | Foundation (data model) + independent FE component — fully parallel |
| 2 | Service / business logic — sequential, waits on data model |
| 3 | API routes + downstream integrations — parallel where deps allow |
| 4 | UI surfaces (owner side + creator side + adjacent) — 2-3 parallel agents OK |
| 5+ | Integration, E2E, docs — sequential trailing rounds |

**Agent orchestration rule:** when running parallel agents, main chat orchestrates only — never makes direct code edits while agents are working in worktrees. Main chat reviews PRs, runs tests, decides merge order.

**Pre-flight before spawning a background agent:**
- Confirm working tree clean on main
- Pass the agent: plan path, its specific WP ID, instruction to follow this skill's §3
- Tell it explicitly: "Open a PR. STOP after that. No follow-up work."

---

## §5 — Quality Gates (close-checklist per WP)

Every WP must pass before `bd close`:

- [ ] `pnpm test --filter <pkg>` green
- [ ] `pnpm typecheck` green (no `as any`, no `@ts-ignore` left behind)
- [ ] `/simplify` findings addressed or explicitly rejected with reason
- [ ] `/review` Critical + Important findings fixed
- [ ] `/fallow` shows no new dead code or duplication (verified against `src/`)
- [ ] Playwright MCP verifies UI flow end-to-end (if UI touched)
- [ ] PR body has Summary + Test Plan
- [ ] Branch is `feat/<wp-id>-<slug>`, NOT main
- [ ] `bd close <wp-id>` + `bd sync` after merge

---

## §6 — Critical Memory Rules Applied During This Skill

Reference list — load-bearing rules from `~/.claude/projects/.../memory/`:

| Rule | When it applies |
|---|---|
| `feedback_no_hardcoded_css` | Step B2 (UI work) |
| `feedback_currency_gbp` | Step B2 (any price-touching code) |
| `feedback_drizzle_migrations` | Step B2 (schema changes — use `db:generate`, never hand-write SQL) |
| `feedback_security_deep_test` | Step B3 (money/auth — positive + negative) |
| `feedback_thorough_verification` | Step B7 (Playwright MCP per WP) |
| `feedback_main_worktree_head_shift` | Step B0 + every git op |
| `feedback_agent_branch_not_main` | Step B2 + B8 |
| `feedback_post_ff_pnpm_install` | When workspace deps land |
| `feedback_wrangler_watches_dist` | Step B2 (new worker routes need build) |
| `feedback_stripe_cli_account_mismatch` | When testing webhook handlers |
| `feedback_modularity_no_any` | Step B2 + B5 close gate |
| `feedback_simplifier_scope_overrun` | Step B4 (cap scope) |
| `feedback_audit_grep_dist_contamination` | Step B6 (fallow + any audit grep) |
| `feedback_uselivequery_empty_array_fallback` | Step B2 (TanStack DB hydration) |
| `feedback_service_error_test_instanceof` | Step B3 (use `err.name`) |
| `feedback_paraglide_two_generated_files` | Step B2 (i18n key adds) |
| `feedback_stale_bead_pointers` | Step B1 (verify before trusting) |
| `feedback_verify_before_declaring_unused` | Step B6 (fallow false positives) |
| `feedback_worktree_content_bleed_bidirectional` | When using `isolation: "worktree"` |
| `feedback_melt_controlled_components` | Step B2 (Melt change handlers) |
| `feedback_dont_push_to_stop` | When user pushes forward, propose forward |

---

## §7 — Examples / Triggers

**Invoke this skill when the user says:**
- "We need to design X — let's chat" (substantial feature)
- "I want to build the epic for Y with proper planning"
- "Let's plan and ship this carefully across multiple WPs"
- "Set up the epic for [thing] and the strict implementation cycle"
- `/epic-cycle <topic>` (explicit invocation)

**Do NOT invoke for:**
- "Fix this typo"
- "Why is X broken?" (exploration)
- "Add a console.log here"
- "What's the right way to..." (advice without scope)

**Real-world example (verbatim run reference):**
- User reported a multi-creator payout bug
- Phase A: 2 Explore agents, 2 batches of 4 design questions, plan written to `/Users/brucemckay/.claude/plans/ok-awesome-we-unified-flamingo.md`, epic `Codex-nk4km` + 11 WPs created with full dependency chain, project memory `project_revenue_share_agreements.md` saved
- Phase B: continuation prompt at `/Users/brucemckay/.claude/plans/ok-awesome-we-unified-flamingo-continue.md` documents the 8-step cycle for the executing chat

---

## §8 — Self-Improvement Hooks

When you complete an epic via this skill, check for surprising patterns:

- If a quality gate caught a class of bug **3+ times across WPs**, promote it from a soft check to a hard rule in §1.
- If a memory feedback rule kept firing during this epic, surface it in §6 with higher priority.
- If parallelisation broke down at the same junction repeatedly, document the failure mode in §4.

Update this SKILL.md with patches. Don't write new skills for one-off learnings — recurrence promotes.
