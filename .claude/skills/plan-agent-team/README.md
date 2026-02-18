# Planning Agent Team

A team of specialist planning agents that analyze beads tasks and generate comprehensive implementation plans. Each plan serves as a **complete context package** for implementation agent teams.

## Overview

The planning agent team ensures that:

1. **Tasks are well-defined** - Validate task quality before planning
2. **Plans are comprehensive** - Include all files, patterns, and compliance standards
3. **Context is preserved** - Plans work post-compaction for fresh agent teams
4. **Progress is tracked** - Update beads with milestones and final summaries

## Flow

```
Beads Task → Orchestrator → Specialist Planners → Context-Rich Plan → Implementation Team → Code → PR Review Agents
```

## Agents

### Planning Agents (Create Plans)

| Agent | Domain | Specification |
|-------|--------|--------------|
| **Orchestrator** | Coordination | `agents/orchestrator.md` |
| **Frontend Planner** | Svelte 5, remote functions, TanStack DB, SSR | `agents/frontend.md` |
| **Backend Planner** | Services, workers, procedures, validation | `agents/backend.md` |
| **Database Planner** | Schema, migrations, scoping, transactions | `agents/database.md` |
| **CSS Planner** | Design tokens, responsive, dark mode | `agents/css.md` |
| **Security Planner** | Auth, rate limiting, XSS prevention | `agents/security.md` |
| **Testing Planner** | Test coverage, factories, isolation | `agents/testing.md` |
| **Architecture Planner** | Layer separation, imports, dependencies | `agents/architecture.md` |

### Implementation Agents (Consume Plans)

| Agent | Domain | Specification |
|-------|--------|--------------|
| **Frontend Implementer** | Svelte components | `implementers/frontend.md` |
| **Backend Implementer** | Services, workers | `implementers/backend.md` |
| **CSS Implementer** | Styles | `implementers/css.md` |
| **Testing Implementer** | Tests | `implementers/testing.md` |

## Usage

### Starting a Planning Session

1. **Ensure task is ready**: `bd ready` to find tasks without blockers
2. **Check task quality**: Verify task has objective, acceptance criteria, file paths
3. **Invoke orchestrator**: The orchestrator will deploy specialist planners
4. **Review plan**: Check the generated context package
5. **Hand to implementers**: Implementation team executes the plan

### Beads Integration

Planning agents integrate with beads via comments:

```bash
# Start planning
bd set-state Codex-XXX workflow=planning --reason "Planning phase started"
bd comments add Codex-XXX "🔍 Deploying agents: frontend, backend, testing"

# Milestone updates
bd comments add Codex-XXX "✅ Milestone: Frontend plan complete"

# Final summary
bd set-state Codex-XXX workflow=ready_for_implementation --reason "Planning complete"
bd comments add Codex-XXX "✅ Plan ready: 12 steps across 3 domains"
```

## Plan Output Format

Each plan is a **self-contained context package**:

```markdown
# Implementation Plan: [Task Name]

## Task Context
- Task ID, title, priority
- Dependencies and what this blocks

## Applicable PR Review Agents
- Which compliance standards apply
- Links to agent specifications

## Phase 1: [Domain]
- Files to create/modify
- Implementation instructions
- Code templates
- Acceptance criteria
- Pattern references

## Verification Steps
- How to test the implementation

## Beads Progress Tracking
- Milestone updates
- Final completion command
```

## Directory Structure

```
.claude/skills/plan-agent-team/
├── agents/                      # Planning agent specifications
│   ├── orchestrator.md          # Main coordinator
│   ├── frontend.md              # Frontend planning
│   ├── backend.md               # Backend planning
│   ├── database.md              # Database planning
│   ├── css.md                   # CSS planning
│   ├── security.md              # Security planning
│   ├── testing.md               # Testing planning
│   └── architecture.md          # Architecture planning
├── implementers/                 # Implementation agent specifications
│   ├── frontend.md              # Frontend implementation
│   ├── backend.md               # Backend implementation
│   ├── css.md                   # CSS implementation
│   └── testing.md               # Testing implementation
├── templates/                    # Reusable templates
│   ├── task-enhancement.md      # Task quality improvement
│   └── plan-output.md           # Standard plan format
└── README.md                     # This file
```

## Related

- **PR Review Agents**: `.claude/skills/pr-review-agent-team/agents/` - Compliance standards referenced by planning agents
- **Beads Documentation**: `.claude/skills/beads*` - Task management integration
