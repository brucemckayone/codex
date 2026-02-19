# Plan Agent Team

Generate implementation plans from beads tasks. Orchestrates specialist planning agents to create context-rich plans that guide implementation.

## Usage

```bash
/plan [task-id]               # Plan specific beads task
/plan Codex-0xt1             # Plan specific task by ID
/plan                         # Plan first ready task (no blockers)
```

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `task-id` | string | `ready` | Task ID, or omit to pick first ready task |

## Implementation

```typescript
// Extract task ID
const taskId = args[0] || 'ready';

// 1. Get task details
if (taskId === 'ready') {
  const result = await exec('bd ready --json');
  const tasks = JSON.parse(result.stdout);
  taskId = tasks[0]?.id;
}

const task = JSON.parse(await exec(`bd show ${taskId} --json`).stdout);

// 2. Analyze task and extract file paths
const files = extractFilesFromTask(task.notes);

// 3. Determine which planners to deploy based on file paths
const planners = determinePlanners(files);

// 4. Create agent team
const teamName = `plan-${Date.now()}`;
await TeamCreate({
  team_name: teamName,
  description: `Planning for ${task.title}`
});

// 5. Deploy specialist planners
for (const planner of planners) {
  await Task({
    subagent_type: 'general-purpose',
    team_name: teamName,
    name: planner.name,
    prompt: PLANNER_PROMPT(planner, task, files)
  });
}

// 6. Collect plans and aggregate into beads comment
const results = await collectPlans(teamName);
const aggregatedPlan = aggregatePlans(results);

// 7. Add plan as beads comment
await exec(`bd comments add ${taskId} "${aggregatedPlan}"`);

// 8. Cleanup
await shutdownTeam(teamName);
await TeamDelete();
```

## Planner Dispatch Logic

```typescript
const AGENT_PATTERNS = {
  'frontend-planner': [
    'apps/web/src/**/*.svelte',
    'apps/web/src/routes/**/*',
    'apps/web/src/lib/components/**/*',
    'apps/web/src/lib/remote/**/*',
    'apps/web/src/lib/collections/**/*',
  ],
  'backend-planner': [
    'workers/*/src/routes/**/*',
    'packages/*/src/services/**/*',
  ],
  'database-planner': [
    'packages/database/src/schema/**/*',
    'packages/database/src/migrations/**/*',
  ],
  'css-planner': [
    '**/*.svelte',
    'apps/web/src/lib/styles/**/*',
  ],
  'testing-planner': [
    '**/*.test.ts',
    '**/*.spec.ts',
  ],
};

function determinePlanners(files) {
  const deployed = new Set();

  for (const file of files) {
    for (const [agent, patterns] of Object.entries(AGENT_PATTERNS)) {
      if (patterns.some(p => minimatch(file, p))) {
        deployed.add(agent);
      }
    }
  }

  return Array.from(deployed).map(name => ({
    name,
    spec: `.claude/skills/plan-agent-team/agents/${name}.md`
  }));
}
```

## Planner Prompt Template

```markdown
You are the {{AGENT_NAME}} planning agent.

**Your Role**: Generate a comprehensive implementation plan for {{DOMAIN}} work based on the beads task.

---

## 📋 Task Context

**Task ID**: {{TASK_ID}}
**Title**: {{TASK_TITLE}}
**Priority**: {{TASK_PRIORITY}}
**Dependencies**: {{DEPENDENCIES}}

**Task Notes**:
{{TASK_NOTES}}

---

## 📁 Files in Your Domain

{{FILES_LIST}}

---

## 📖 Your Specification

Read your full specification from: `{{SPEC_PATH}}`

This contains:
- Domain compliance requirements
- File patterns to review
- Code examples and patterns
- Critical file references

---

## 📤 Plan Output Format

Generate a plan following this structure:

```markdown
## {{DOMAIN}} Implementation Plan

### Applicable PR Review Agents
- Agent Name: path/to/agent.md

---

## Phase 1: [Phase Name]
### Files to [CREATE/MODIFY]
- `file/path` - Description

### Implementation Instructions
**Read this pattern first**: [Reference file]

**Requirements** (CRITICAL):
- [CRITICAL] Requirement 1
- [WARN] Requirement 2

**Code Template**:
```typescript
// Template code
```

**Acceptance Criteria**:
- [ ] Criteria 1
- [ ] Criteria 2

---

## Deep Dive References
- Pattern: `path/to/reference/file`
- PR Review Agent: `path/to/agent.md`
```

---

## ✅ Quality Checklist

Before outputting your plan, verify:
- [ ] All phases have clear file paths
- [ ] Code templates are complete and working
- [ ] Acceptance criteria are testable
- [ ] Deep dive references are accurate paths
- [ ] Compliance requirements are linked to PR review agents
```

---

## Result Collection

Plans are collected and aggregated into a single beads comment with:

```markdown
# Implementation Plan: {{TASK_TITLE}}

## Task Context
- Task ID, priority, dependencies

## Applicable PR Review Agents
- List of compliance standards

## Phase 1: [Domain]
[Files, templates, acceptance criteria]

## Phase 2: [Domain]
[Files, templates, acceptance criteria]

## Verification Steps
[How to test]

## Beads Progress Tracking
[Milestone update commands]
```

---

## Beads Integration

```bash
# Start planning
bd set-state {{TASK_ID}} workflow=planning

# Add plan
bd comments add {{TASK_ID}} "[FULL PLAN]"

# Ready for implementation
bd set-state {{TASK_ID}} workflow=ready_for_implementation
```
