---
name: codebase-audit
description: >
  Full-stack codebase audit using 6 specialist review agents, a synthesiser, and
  an epic planner. Produces verified review documents, then creates beads epics
  and tasks with dependency chains. Use for comprehensive multi-domain audits.
---

# Codebase Audit — Review, Synthesise, Plan

Full-stack codebase audit using 6 specialist review agents, a synthesiser, and an epic planner. Produces verified review documents in `docs/code-review/`, then creates beads epics and tasks with dependency chains.

## Usage

```bash
/codebase-audit                      # Full audit (all 6 domains)
/codebase-audit --scope=backend      # Backend only (workers, services, database)
/codebase-audit --scope=frontend     # Frontend only (SvelteKit app)
/codebase-audit --scope=security     # Security-focused audit
/codebase-audit --phase=review       # Review only (produce docs, no beads tasks)
/codebase-audit --phase=plan         # Plan only (read existing docs, create beads tasks)
```

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `scope` | string | `all` | `all`, `backend`, `frontend`, `security`, or comma-separated domain list |
| `phase` | string | `all` | `all` (review+plan), `review` (docs only), `plan` (beads only) |

## Domains

| Domain | Agent | Scope | Output File |
|--------|-------|-------|-------------|
| Workers & API Routes | `workers-reviewer` | `workers/*/src/**/*.ts` | `docs/code-review/01-workers-api.md` |
| Service Layer | `services-reviewer` | `packages/*/src/services/**/*.ts` | `docs/code-review/02-services.md` |
| Security | `security-reviewer` | Auth, validation, headers, OWASP | `docs/code-review/03-security.md` |
| Frontend | `frontend-reviewer` | `apps/web/src/**/*.{svelte,ts}` | `docs/code-review/04-frontend.md` |
| Database & Data Layer | `database-reviewer` | Schema, queries, migrations, caching | `docs/code-review/05-database.md` |
| Infrastructure | `infra-reviewer` | Shared packages, build, config | `docs/code-review/06-infrastructure.md` |

## Implementation

### Phase 1: Review (6 specialist agents)

```typescript
// Determine which domains to audit
const domains = resolveScope(scope);
// scope=all → all 6, scope=backend → [workers, services, database]
// scope=frontend → [frontend], scope=security → [security]

// Create output directory
await exec('mkdir -p docs/code-review');

// Launch review agents (max 2 at a time per user preference)
// Each agent does 3 verification passes
for (const batch of chunk(domains, 2)) {
  const agents = batch.map(domain => ({
    subagent_type: 'general-purpose',
    name: `${domain.name}-reviewer`,
    prompt: buildReviewPrompt(domain),
    mode: 'bypassPermissions',
  }));
  await Promise.all(agents.map(a => Agent(a)));
}
```

Each review agent MUST:
1. **Pass 1**: Read all source files in scope, produce findings table
2. **Pass 2**: Re-read every file cited in findings, verify line numbers, correct false positives, add new findings
3. **Pass 3**: Deep-dive on cross-cutting concerns, cross-reference with other domain findings, verify all claims
4. Write output to `docs/code-review/NN-domain.md` with exact format (see template below)

### Phase 2: Synthesise (1 agent)

```typescript
// Read all 6 review documents
const reviews = await readAllReviewDocs();

// Launch synthesiser agent
await Agent({
  subagent_type: 'general-purpose',
  name: 'synthesiser',
  prompt: buildSynthesisPrompt(reviews),
  mode: 'bypassPermissions',
});
```

The synthesiser agent MUST:
1. Read all review documents from `docs/code-review/01-*.md` through `06-*.md`
2. Identify cross-cutting themes (error handling, duplication, type safety, testing gaps, doc mismatches)
3. Identify contradictions between reports and flag for resolution
4. Produce `docs/code-review/00-master-summary.md` with:
   - Top 10 most critical findings (ranked by severity + blast radius)
   - Cross-cutting themes with source attribution
   - Duplication matrix
   - Quick wins table (high impact, low effort)
   - Architectural recommendations
   - What's working well (positive findings)
   - Contradiction table
   - Statistics (findings by severity, category, confirmed bugs, dead code)

### Phase 3: Plan (1 agent)

```typescript
// Read master summary + all review docs
const summary = await read('docs/code-review/00-master-summary.md');
const existingIssues = await exec('bd list --status=open');
const inProgress = await exec('bd list --status=in_progress');

// Launch planner agent
await Agent({
  subagent_type: 'general-purpose',
  name: 'epic-planner',
  prompt: buildPlannerPrompt(summary, existingIssues),
  mode: 'bypassPermissions',
});
```

The planner agent MUST:
1. Read `docs/code-review/00-master-summary.md` and all 6 domain review documents
2. Read existing beads issues (`bd list --status=open`, `bd list --status=in_progress`)
3. Group findings into epics by blast radius and dependency (NOT by source document)
4. Determine wave ordering (what can run in parallel vs what must be sequential)
5. For each finding, decide: new task, subsume into existing issue, or exclude (with documented reason)
6. Create all epics with `bd create --type=epic`
7. Create all tasks with `bd create`, linking to parent epics with `bd dep add`
8. Wire cross-task dependencies (e.g., schema migration before service code that depends on it)
9. Close any superseded existing issues with `bd close --reason="..."`
10. Write a plan file to `.claude/plans/` with the full epic/task structure

### Phase 4: Summary

Output a markdown summary table showing:
- Epic count, task count, wave structure
- What's ready to work on now (`bd ready`)
- Blocked dependency chain
- Existing issues disposition (subsumed, kept, closed)

## Review Document Template

Each review agent MUST produce output in this format:

```markdown
# [Domain] Code Review

**Date**: YYYY-MM-DD
**Scope**: [files/packages reviewed]
**Reviewer**: Claude Opus 4.6

## Review History

| Pass | Date | Notes |
|------|------|-------|
| 1 | ... | Initial review, N findings |
| 2 | ... | Verification pass. Corrected X, removed Y false positives, added Z new |
| 3 | ... | Deep-dive. Verified Pass 2, added N new, cross-referenced with other reports |

## Executive Summary (Top 5 Findings)

[Numbered list, most critical first]

## Per-[Unit] Findings

### [Unit Name]

**Files reviewed**: [list]

#### Issues

| # | Severity | File:Line | Finding |
|---|----------|-----------|---------|
| ... | Critical/High/Medium/Low/Info | exact:line | description |

#### Positive Notes
- [What's working well]

## Cross-Cutting Concerns

[Patterns that span multiple units]

## Recommendations (Prioritized by Impact)

### Critical (Fix Now)
### High Priority
### Medium Priority
### Low Priority

## Summary Statistics

| Metric | Count |
|--------|-------|
| Total findings | N |
| Critical | N |
| High | N |
| Medium | N |
| Low | N |
| Info | N |
```

## Epic Organisation Rules

When creating epics and tasks:

1. **Group by blast radius**, not by source document. A database schema fix and the service code that depends on it belong in related epics, not in "database epic" and "services epic"
2. **Wave ordering**: Security/bugs first → schema → error handling → services → workers → frontend → duplication → docs → tests
3. **Findings that appear in multiple reviews** get ONE task, not duplicates. Cross-reference the sources
4. **Existing issues**: Check beads first. If a finding matches an existing issue, link to it rather than creating a duplicate
5. **Exclude by design**: Document findings that are intentional (e.g., orgs are public, webhooks are system-scoped) rather than creating tasks for them
6. **Single migration for related schema changes**: Group all soft-delete constraint fixes into one migration
7. **Dependencies**: Schema changes block service code. Error standardisation blocks service refactors. Backend fixes block frontend verification

## Key References

- Project rules: `CLAUDE.md` (root)
- Package structure: `packages/CLAUDE.md`
- Web app patterns: `apps/web/CLAUDE.md`
- Worker patterns: `workers/CLAUDE.md`
- Service error hierarchy: `packages/service-errors/CLAUDE.md`
- Database patterns: `packages/database/CLAUDE.md`
- Security rules: `packages/security/CLAUDE.md`

## User Preferences

- Max 2 agents at a time
- Use design tokens, never hardcoded px/hex
- Default currency is GBP
- Use `@codex/constants` `getServiceUrl()` for all port references
- Always verify with Svelte MCP + Context7 for Svelte/Melt UI/TanStack DB code
- Run `pnpm dev` from monorepo root only
