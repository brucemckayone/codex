# Codex PR Review Agent Team

Comprehensive PR review using 9 specialist agents with sequential handoff capability for cross-domain analysis across **full stack** (Workers → Services → Foundation → Frontend).

## Usage

```bash
/pr-review                    # Review current branch
/pr-review pr-123             # Review specific PR
/pr-review current            # Explicit current branch
/pr-review --files=all        # Include docs
/pr-review --severity=blocking # Only blocking issues
```

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `pr` | string | `current` | PR number, URL, branch name, or "current" |
| `files` | string | `code` | "code" (default) or "all" to include .md files |
| `severity` | string | `all` | "all", "blocking", or "warnings" |

## Implementation

```typescript
// Extract parameters
const args = input.split(/\s+/).filter(Boolean);
const pr = args[0] || 'current';
const files = args.includes('--files=all') ? 'all' : 'code';
const severity = args.includes('--severity=blocking') ? 'blocking'
  : args.includes('--severity=warnings') ? 'warnings' : 'all';

// 1. Identify PR and get changed files
const branch = await getBranchName(pr);
const changedFiles = await getChangedFiles(branch);

// 2. Filter by file type
const filesToReview = files === 'all'
  ? changedFiles
  : changedFiles.filter(f => !f.endsWith('.md'));

// 3. Create agent team
const teamName = `pr-review-${Date.now()}`;
const team = await TeamCreate({
  team_name: teamName,
  description: `PR review for ${branch}: ${filesToReview.length} files`
});

// 4. Spawn 9 specialist teammates (6 backend + 3 frontend)
const agents = [
  // Backend agents
  { name: 'security-reviewer', spec: 'agents/security.md', patterns: SECURITY_PATTERNS },
  { name: 'database-reviewer', spec: 'agents/database.md', patterns: DATABASE_PATTERNS },
  { name: 'worker-reviewer', spec: 'agents/workers.md', patterns: WORKER_PATTERNS },
  { name: 'service-reviewer', spec: 'agents/services.md', patterns: SERVICE_PATTERNS },
  { name: 'testing-reviewer', spec: 'agents/testing.md', patterns: TEST_PATTERNS },
  { name: 'architecture-reviewer', spec: 'agents/architecture.md', patterns: ARCH_PATTERNS },

  // Frontend agents
  { name: 'css-reviewer', spec: 'agents/css.md', patterns: CSS_PATTERNS },
  { name: 'local-first-reviewer', spec: 'agents/local-first.md', patterns: LOCAL_FIRST_PATTERNS },
  { name: 'component-reviewer', spec: 'agents/components.md', patterns: COMPONENT_PATTERNS }
];

for (const agent of agents) {
  await Task({
    subagent_type: 'general-purpose',
    team_name: teamName,
    name: agent.name,
    prompt: REVIEWER_PROMPT(agent, filesToReview, severity)
  });
}

// 5. Wait for all agents to complete and collect results
const results = await collectAgentResults(teamName);

// 6. Aggregate and display
await displayResults(results, branch, severity);

// 7. Cleanup
await shutdownTeam(teamName);
await TeamDelete();
```

## File Patterns

```typescript
// Backend patterns
const SECURITY_PATTERNS = [
  'packages/security/**/*.ts',
  'packages/validation/**/*.ts',
  'workers/*/src/middleware/**/*.ts',
  'workers/*/src/routes/**/*.ts'
];

const DATABASE_PATTERNS = [
  'packages/database/**/*.ts',
  'packages/*/src/services/**/*.ts'
];

const WORKER_PATTERNS = [
  'workers/*/src/routes/**/*.ts',
  'packages/worker-utils/**/*.ts'
];

const SERVICE_PATTERNS = [
  'packages/*/src/services/**/*.ts',
  'packages/service-errors/**/*.ts'
];

const TEST_PATTERNS = [
  '**/__tests__/**/*.test.ts',
  'packages/test-utils/**/*.ts'
];

const ARCH_PATTERNS = [
  '**/*.ts' // All files for cross-cutting review
];

// Frontend patterns (NEW)
const CSS_PATTERNS = [
  'apps/web/src/lib/styles/**/*.css',
  'apps/web/src/**/*.svelte'  // Check <style> blocks
];

const LOCAL_FIRST_PATTERNS = [
  'apps/web/src/lib/collections/**/*.ts',
  'apps/web/src/lib/remote/**/*.ts',
  'apps/web/src/routes/**/*.server.ts',
  'apps/web/src/routes/**/+page.svelte'
];

const COMPONENT_PATTERNS = [
  'apps/web/src/lib/components/ui/**/*.svelte',
  'apps/web/src/lib/components/ui/**/*.stories.svelte',
  'apps/web/src/routes/**/*.svelte'
];
```

## Reviewer Prompt Template

```markdown
You are the {{AGENT_NAME}} on the Codex PR Review team.

## Your Specification

Read your full specification from: {{SPEC_PATH}}

## Files to Review

{{FILES_LIST}}

## Review Process

1. Read your agent specification from {{SPEC_PATH}}
2. Identify which files from the list match your patterns
3. For each matching file, read it and apply your checklist
4. When you find issues that belong to another agent's domain, use SendMessage:
   - Recipient: the appropriate agent name
   - Example: Send unscoped query findings to "database-reviewer"
5. Compile your findings into this JSON structure:

\`\`\`json
{
  "agent": "{{AGENT_NAME}}",
  "files_reviewed": ["file1.ts", "file2.ts"],
  "issues": [
    {
      "title": "Brief issue title",
      "file_path": "relative/path/to/file.ts",
      "line_number": 42,
      "severity": "blocking" | "warning" | "info",
      "description": "Clear explanation of the issue",
      "code_snippet": "The problematic code",
      "corrected_code": "The corrected code",
      "handoff": "agent-name-if-verified-by-another-agent"
    }
  ]
}
\`\`\`

6. When complete, send a message to "coordinator" with your results

## Team Members

**Backend Agents:**
- security-reviewer
- database-reviewer
- worker-reviewer
- service-reviewer
- testing-reviewer
- architecture-reviewer

**Frontend Agents:**
- css-reviewer (design tokens, CSS variables, NO Tailwind)
- local-first-reviewer (TanStack DB, remote functions, SSR)
- component-reviewer (Svelte 5 runes, Melt UI, accessibility)

**Coordinator:**
- coordinator (send results here)

## Communication

Use SendMessage to:
- Send cross-domain findings to specific agents
- Report completion to coordinator
- Ask for clarification on issues

Begin your review now.
```

## Result Collection

```typescript
interface AgentResult {
  agent: string;
  files_reviewed: string[];
  issues: Issue[];
}

interface Issue {
  title: string;
  file_path: string;
  line_number: number;
  severity: 'blocking' | 'warning' | 'info';
  description: string;
  code_snippet?: string;
  corrected_code?: string;
  handoff?: string;
}

// Collect results from agent messages
async function collectAgentResults(teamName: string): Promise<AgentResult[]> {
  // Monitor messages sent to coordinator
  // Parse JSON results from each agent
  // Return aggregated results
}
```

## Helper Functions

```typescript
async function getBranchName(pr: string): Promise<string> {
  if (pr === 'current' || !pr) {
    const result = await exec('git rev-parse --abbrev-ref HEAD');
    return result.stdout.trim();
  }
  if (/^\d+$/.test(pr)) {
    // PR number - fetch from gh CLI
    const result = await exec(`gh pr view ${pr} --json headRefName`);
    return JSON.parse(result.stdout).headRefName;
  }
  if (pr.includes('github.com')) {
    // PR URL - extract branch
    const result = await exec(`gh pr view ${pr} --json headRefName`);
    return JSON.parse(result.stdout).headRefName;
  }
  return pr; // Branch name
}

async function getChangedFiles(branch: string): Promise<string[]> {
  const base = 'main'; // Or configurable base branch
  const result = await exec(`git diff --name-only ${base}...${branch}`);
  return result.stdout.trim().split('\n').filter(Boolean);
}

function filterFilesByAgent(files: string[], patterns: string[]): string[] {
  // Match files against glob patterns
  return files.filter(file =>
    patterns.some(pattern => minimatch(file, pattern))
  );
}

async function shutdownTeam(teamName: string) {
  // Send shutdown_request to all teammates
  // Wait for approvals
  // Team will auto-cleanup via TeamDelete
}
```

## Severity Filtering

```typescript
function filterBySeverity(results: AgentResult[], severity: string) {
  if (severity === 'all') return results;
  if (severity === 'blocking') {
    return results.map(r => ({
      ...r,
      issues: r.issues.filter(i => i.severity === 'blocking')
    }));
  }
  if (severity === 'warnings') {
    return results.map(r => ({
      ...r,
      issues: r.issues.filter(i => i.severity === 'blocking' || i.severity === 'warning')
    }));
  }
}
```

## Output Formatting

Console output uses box-drawing characters:
```
╔══════════════════════════════════════════════════════════════╗
║         Codex PR Review - Branch: feature/backend           ║
╠══════════════════════════════════════════════════════════════╣
║  Files Changed: 12 |  🚫 BLOCKING: 2 | ⚠️ WARNINGS: 5      ║
╚══════════════════════════════════════════════════════════════╝
```

## GitHub Comment Option

After displaying results, offer:
```
Would you like me to post this review as a GitHub comment? (y/n)
```

If yes, use `gh pr comment` with formatted markdown.

---

★ Insight ─────────────────────────────────────
**Sequential Handoff Pattern**: Agents communicate via SendMessage to verify cross-domain issues. For example, Security Agent finds a missing auth check → sends to Worker Agent → Worker Agent verifies the procedure() pattern and confirms. This ensures issues are validated by the domain expert before being reported.
─────────────────────────────────────────────────
