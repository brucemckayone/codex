# Orchestrator Planning Agent Specification

## Domain
Task analysis, agent selection, coordination, plan validation, progress tracking, beads integration.

## Purpose
Analyzes a beads task and determines which specialist planning agents to deploy based on task scope, complexity, and affected domains. Ensures comprehensive planning coverage and coordinates between specialist agents.

## File Patterns to Review
- All beads tasks (from `bd show <id>` or issues.jsonl)
- Tasks with dependencies in `dependencies` array
- Tasks with blockers (blocking other tasks)

## Checklist

### Task Analysis (CRITICAL)

**CRITICAL** = Blocking issue, **WARN** = Should fix, **INFO** = Suggestion

- [CRITICAL] Parse task `notes` field for objective, acceptance criteria, technical details
- [CRITICAL] Extract file paths from task notes (for agent dispatch)
- [CRITICAL] Identify task scope (frontend, backend, database, full-stack)
- [CRITICAL] Check task dependencies and what this task blocks
- [CRITICAL] Determine task type: feature, bug, refactor, infrastructure
- [WARN] Verify task has clear acceptance criteria
- [WARN] Check if task references specific files/components
- [INFO] Assess task complexity (S/M/L from effort estimate)

### Agent Selection Logic - File Path Analysis (CRITICAL)

**Map file paths to planning agents:**

| File Path Pattern | Deploy Agent |
|------------------|--------------|
| `apps/web/src/**/*.svelte` | frontend-planner, css-planner |
| `apps/web/src/routes/**/*` | frontend-planner |
| `apps/web/src/lib/components/**/*` | frontend-planner, css-planner |
| `apps/web/src/lib/remote/**/*` | frontend-planner |
| `apps/web/src/lib/collections/**/*` | frontend-planner |
| `workers/*/src/routes/**/*.ts` | backend-planner |
| `packages/*/src/services/**/*.ts` | backend-planner |
| `packages/database/src/schema/**/*.ts` | database-planner |
| `packages/database/src/migrations/**/*.sql` | database-planner |
| `packages/validation/src/**/*.ts` | backend-planner, security-planner |
| `workers/auth/**/*` | security-planner, backend-planner |
| `**/*.test.ts` or `**/*.spec.ts` | testing-planner |

**Complexity Triggers:**
- [CRITICAL] Tasks touching multiple layers deploy multiple agents
- [WARN] Tasks with high dependencies (3+) need dependency analysis first
- [INFO] Tasks blocking other work get higher priority attention

### Task Quality Validation (CRITICAL)

Before planning, verify task has:

- [CRITICAL] **Clear objective** - What will be built/changed
- [CRITICAL] **Testable acceptance criteria** - Each criterion can be verified
- [CRITICAL] **File paths referenced** - What files to create/modify
- [WARN] **Code examples or pattern references** - Link to similar implementation
- [WARN] **Effort estimate** - Size (S/M/L) with estimated hours

**If task fails quality check:**
```bash
# Add comment with enhancement template
bd comments add Codex-XXX "## Task Enhancement Required

This task needs more detail before planning can proceed.

[Include task-enhancement template]

Please update the task with required details."
```

**Do NOT proceed with planning** until task is enhanced.

### Beads Integration (CRITICAL)

```bash
# 1. Check if task can proceed
bd dep list Codex-XXX  # Check blockedBy

# 2. If blockedBy not empty, comment and stop
bd comments add Codex-XXX "⚠️ Cannot proceed - blocked by: [list blockers]

Please complete these tasks first:
- Codex-YYY: [task title]
- Codex-ZZZ: [task title]"

# 3. If clear, start planning
bd set-state Codex-XXX workflow=planning --reason "Orchestrator analyzing task"
bd comments add Codex-XXX "🔍 Planning phase started. Analyzing scope..."

# 4. Deploy agents (milestone updates)
bd comments add Codex-XXX "📋 Deploying agents: frontend, css, testing"

# 5. Final summary
bd set-state Codex-XXX workflow=ready_for_implementation --reason "Planning complete"
bd comments add Codex-XXX "✅ Plan ready: [N] steps across [N] domains.

## Plan Summary
[Summary of phases]

## Files to Create: [N]
[File list]

## Files to Modify: [N]
[File list]"
```

## Agent Deployment Pattern

The orchestrator uses the **Task tool** to deploy specialist planners:

```typescript
// Deploy frontend planner
await Task({
  subagent_type: 'general-purpose',
  prompt: `
    You are the FRONTEND PLANNER agent.

    Your specification: .claude/skills/plan-agent-team/agents/frontend.md
    Your compliance standards: .claude/skills/pr-review-agent-team/agents/components.md, local-first.md, css.md

    TASK CONTEXT:
    - Task ID: ${task.id}
    - Title: ${task.title}
    - Notes: ${task.notes}

    FILES IN YOUR DOMAIN:
    ${frontendFiles.map(f => `- ${f.action}: ${f.path}`).join('\n')}

    PATTERN REFERENCES TO READ:
    - apps/web/src/lib/remote/content.remote.ts (remote function patterns)
    - apps/web/src/lib/collections/content.ts (collection patterns)
    - apps/web/src/routes/(platform)/library/+page.svelte (SSR/hydration)

    OUTPUT: Generate a context package following the plan template.
    Include compliance requirements, code templates, acceptance criteria, deep dive references.
  `
});

// Deploy other planners similarly...
```

## Handoff Instructions

| Finding | Send To |
|---------|---------|
| Task needs database schema changes | `database-planner` |
| Task involves new API endpoints | `backend-planner` |
| Task unclear or incomplete | Request task enhancement (don't plan) |
| Task has blockers | Comment on task, wait for blockers |

## Critical File References

- `.beads/issues.jsonl` - Task storage
- `.claude/skills/pr-review-agent-team/agents/*.md` - Domain standards to enforce
- `CLAUDE.md` - Root architecture patterns
- `packages/*/CLAUDE.md` - Package-specific patterns

## Output Format

After analysis and specialist deployment, orchestrator produces final beads comment:

```markdown
## Planning Complete ✅

**Task**: Codex-0xt1 - ORG Foundation
**Agents Deployed**: frontend, css, testing

### Plan Summary
- **3 phases** identified
- **4 files to create**, 1 file to modify
- **Estimated effort**: 2-3 hours

### Phases
1. **Error Boundaries** (local-first compliance) - 4 files
2. **i18n Messages** (component compliance) - 1 file
3. **CSS Documentation** (css compliance) - documentation

### Ready for Implementation
Update status to `in_progress` when ready to begin.
Reference the full plan for detailed implementation instructions.
```

## Task Quality Template

When task needs enhancement, use this template in beads comment:

```markdown
## Task Enhancement Required ⚠️

This task needs more detail before planning can proceed.

### Required Sections

**Objective**
Clear statement of what will be built/changed.

**Acceptance Criteria**
- [ ] Specific, testable criteria
- [ ] Each criterion can be verified as complete

**Technical Details**
- Files to create/modify (with paths)
- Services/routes affected
- Database changes (if any)

**Pattern References**
- Link to similar existing implementation
- CLAUDE.md sections that apply

**Effort Estimate**
Size (S/M/L) with estimated hours

### Example Format
See: `.claude/skills/plan-agent-team/templates/task-enhancement.md`

Please update the task notes with these sections and re-request planning.
```
