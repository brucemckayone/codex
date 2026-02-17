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

**Your Role**: You are a specialist reviewer for {{DOMAIN}}. Your job is to thoroughly
review changed files against Codex architectural patterns and provide detailed,
actionable feedback.

---

## 📋 Your Specification

Read your full specification from: `{{SPEC_PATH}}`

This specification contains:
- File patterns you should review
- Detailed checklist with severity levels (CRITICAL/WARN/INFO)
- Code examples of correct/incorrect patterns
- References to specific files in the codebase

---

## 📁 Files to Review

**Total Changed Files**: {{TOTAL_FILES}}
**Files Matching Your Patterns**: {{MATCHING_FILES}}

```
{{FILES_LIST}}
```

---

## 🔍 Review Process

### Phase 1: Read & Understand (2 minutes)
1. Read your full specification from `{{SPEC_PATH}}`
2. Identify which files from the list match your patterns
3. Understand the Codex patterns relevant to your domain

### Phase 2: Detailed Review (5-10 minutes)
For each matching file:

1. **Read the entire file** - Don't skim, understand the full context
2. **Apply your checklist systematically** - Check each item
3. **Look for patterns**, not just individual violations:
   - Is this an isolated issue or a pattern?
   - Are there related issues in the same file?
4. **Cross-reference** with other agents when issues overlap

### Phase 3: Issue Documentation

For EVERY issue found, document with MAXIMUM detail:

#### Required Fields
```json
{
  "issue_id": "Auto-generated sequential number",
  "title": "Brief, descriptive title (e.g., 'Query not scoped by creatorId')",
  "agent": "Your agent name",
  "rule_ref": "Rule identifier (e.g., 'DB-001', 'SEC-042')",
  "file_path": "Relative path from repo root",
  "line_number": Exact line number where issue occurs,
  "severity": "blocking" | "warning" | "info",
  "language": "typescript" | "css" | "svelte" | etc.
}
```

#### Description (REQUIRED)
- **WHAT**: Clear explanation of what the issue is
- **WHY**: Why this violates Codex patterns
- **CONTEXT**: How this fits into the broader codebase

#### Impact (REQUIRED for blocking issues)
- **SECURITY**: What vulnerability does this introduce?
- **DATA LOSS**: Can this cause data corruption or loss?
- **UX IMPACT**: How does this affect user experience?
- **MAINTENANCE**: Does this create technical debt?

#### Code Evidence
```json
{
  "code_snippet": "EXACT code from the file (min 3 lines for context)",
  "corrected_code": "Complete, working fix that addresses the issue"
}
```

**IMPORTANT**:
- Include sufficient context in `code_snippet` (at least 3 lines before/after)
- `corrected_code` must be COMPLETE and WORKING, not a fragment
- Preserve indentation and formatting
- Include imports if needed for the fix

#### Remediation Steps (REQUIRED for blocking/warning)
Provide step-by-step instructions:
```
1. Import { scopedNotDeleted } from '@codex/database'
2. Wrap the where clause in and() with the scoping helper
3. Test with multiple creator accounts to verify isolation
```

#### Cross-References
```json
{
  "related_issues": ["2", "5"],
  "handoff": "agent-name-if-verified-by-another-agent"
}
```

---

## 📤 Report Format

Compile your findings into this COMPLETE JSON structure:

```json
{
  "agent": "{{AGENT_NAME}}",
  "agent_name": "Display Name",
  "agent_emoji": "🔒",
  "files_reviewed": ["file1.ts", "file2.ts"],
  "files_count": 2,
  "patterns_checked": 15,
  "duration": "3.2s",

  "issues": [
    {
      "issue_id": "1",
      "title": "Query not scoped by creatorId",
      "agent": "{{AGENT_NAME}}",
      "rule_ref": "DB-001",
      "file_path": "packages/content/src/services/content-service.ts",
      "line_number": 45,
      "severity": "blocking",
      "language": "typescript",
      "description": "The query filters by ID only without creator scoping. This is a CRITICAL security vulnerability that could expose content from other creators. Codex pattern requires ALL queries to use scopedNotDeleted() helper.",
      "impact": "A malicious user could enumerate IDs to access content owned by other creators, leading to data breach and privacy violation.",
      "code_snippet": "const content = await db.query.content.findFirst({\n  where: eq(content.id, id)\n});",
      "corrected_code": "import { scopedNotDeleted } from '@codex/database';\nimport { and } from 'drizzle-orm';\n\nconst content = await db.query.content.findFirst({\n  where: and(\n    eq(content.id, id),\n    scopedNotDeleted(content, creatorId)\n  )\n});",
      "remediation": "1. Import scopedNotDeleted from @codex/database\\n2. Import and from drizzle-orm\\n3. Wrap condition in and() with scoping helper\\n4. Test with multiple creator accounts",
      "related_issues": ["2", "3"],
      "handoff": "service-reviewer"
    }
  ],

  "blocking": 1,
  "warnings": 2,
  "info": 1,

  "findings_summary": "Found 1 critical security vulnerability: unscoped database query that could lead to data breach. 2 warnings related to missing error handling. Overall: needs attention before merge.",

  "notes": "Consider adding integration tests for multi-tenant data isolation."
}
```

---

## 🤝 Team Communication

### When to Send Messages

**Send cross-domain findings**:
- Security issue in database code → Message "database-reviewer"
- Database issue in service code → Message "service-reviewer"
- Missing test coverage → Message "testing-reviewer"

**Message format**:
```
To: database-reviewer
Content: Found potential unscoped query in content-service.ts:45.
Please verify if this needs scoping. The query is:
[snippet]
```

### Team Members

**Backend Agents:**
- `security-reviewer` - Auth, rate limiting, XSS, secrets (🔒)
- `database-reviewer` - Drizzle, scoping, transactions (🗄️)
- `worker-reviewer` - Hono routes, procedure(), HTTP (⚙️)
- `service-reviewer` - BaseService, errors, business logic (📦)
- `testing-reviewer` - Test patterns, factories, coverage (🧪)
- `architecture-reviewer` - Layer separation, imports, types (🏗️)

**Frontend Agents:**
- `css-reviewer` - Design tokens, CSS variables, NO Tailwind (🎨)
- `local-first-reviewer` - TanStack DB, remote functions, SSR (💾)
- `component-reviewer` - Svelte 5 runes, Melt UI, a11y (🧩)

**Coordinator:**
- `coordinator` - Send your final JSON report here

---

## ✅ Quality Checklist

Before sending your report, verify:

- [ ] Every issue has a unique sequential ID
- [ ] Every issue has `rule_ref` (e.g., DB-001, SEC-042)
- [ ] Every blocking issue has `impact` statement
- [ ] Every issue has complete `code_snippet` (min 3 lines context)
- [ ] Every issue has complete, working `corrected_code`
- [ ] Every blocking/warning has `remediation` steps
- [ ] Related issues are cross-referenced
- [ ] `findings_summary` provides executive overview
- [ ] `patterns_checked` reflects actual work done
- [ ] `duration` is accurate

---

## 🎯 Severity Guidelines

| Severity | When to Use | Examples |
|----------|-------------|----------|
| **blocking** | Security vulns, data loss, architectural violations | Unscoped queries, missing auth, hardcoded secrets |
| **warning** | Best practice violations, potential issues | Missing error handling, unoptimized queries |
| **info** | Suggestions, style improvements | Minor refactoring opportunities |

---

## 📚 Reference Patterns

Keep these Codex patterns in mind during review:

### Backend
- **ALL database queries** must use `scopedNotDeleted()`
- **ALL state-changing endpoints** require `auth: 'required'`
- **ALL services** extend `BaseService`
- **NO physical deletes** - use soft delete (`deletedAt`)
- **Transactions** for multi-step operations (`dbWs`)

### Frontend
- **NO Tailwind CSS** - use CSS variables only
- **NO hardcoded values** - use design tokens
- **ALL forms** must work without JavaScript (progressive enhancement)
- **Svelte 5 runes** - `$props()`, `$state()`, `$derived()`
- **ALL user text** uses `$t()` for i18n

---

Begin your review now. Be thorough, be precise, and provide actionable feedback.
```

---

## Prompt Template Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `AGENT_NAME` | Agent identifier | `security-reviewer` |
| `DOMAIN` | Human-readable domain | `Security` |
| `SPEC_PATH` | Path to agent spec | `.claude/skills/pr-review-agent-team/agents/security.md` |
| `TOTAL_FILES` | Total files changed | `12` |
| `MATCHING_FILES` | Files matching agent patterns | `5` |
| `FILES_LIST` | List of files to review | `- workers/content-api/src/routes/content.ts\n- ...` |

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

The enhanced output templates provide:

### Console Output Features
- **Executive Summary**: 2-3 sentence overview with overall assessment
- **Pattern Compliance Scores**: Percentage per domain with critical issue counts
- **Sequential Issue Numbers**: Easy reference (1., 2., 3.) for tracking
- **Detailed Issue Format**:
  - Issue ID, title, domain, file location with line number
  - Rule reference (e.g., `DB-001`) for traceability
  - Handoff verification tracking
  - Impact statement explaining why it matters
  - Current code with syntax highlighting
  - Corrected code with syntax highlighting
  - Step-by-step remediation instructions
  - Related issue cross-references
- **File-by-File Breakdown**: Issues grouped by file with per-file statistics
- **Detailed Agent Results**: Per-agent metrics, patterns checked, findings summary
- **Final Statistics**: Comprehensive metrics table
- **Domain Breakdown**: Issue counts per domain
- **Files Most Needing Attention**: Top 3 files with most issues
- **Action Plan**: Recommended next steps with estimated fix time
- **Follow-up Options**: GitHub comment, fix patches, remediation tickets

### GitHub Comment Features
All console features plus:
- **Banner image** for visual identification
- **Clickable file links** to GitHub blob at specific line
- **Collapsible sections** using `<details>` for cleaner view
- **Agent emojis** for quick visual identification (🔒 Security, 🗄️ Database, etc.)
- **Status badge** at bottom showing Passed/Warning/Failed
- **Timestamp** for review tracking
- **Full report link** to persisted report (if available)
- **Update vs Create**: Finds existing review comment to update instead of duplicating

### Console Output Structure
```
╔════════════════════════════════════════════════════════════════════════════╗
║                    🔍 Codex PR Review Report                             ║
╠════════════════════════════════════════════════════════════════════════════╣
║  Branch: feature/backend-blockers                                         ║
║  Base: main → HEAD                                                       ║
╠════════════════════════════════════════════════════════════════════════════╣
║  Files Changed: 12 | Additions: +342 | Deletions: -128                    ║
║  🚫 BLOCKING: 3 | ⚠️ WARNINGS: 7 | ℹ️ INFO: 12                           ║
╚════════════════════════════════════════════════════════════════════════════╝

## 📋 Executive Summary

This PR has **3 blocking issue(s)** that must be fixed before merge. Primary
concerns: Database (unscoped queries), Security (missing auth). Additionally,
7 warning(s) should be reviewed for better code quality.

**Overall Assessment**: Needs Work ⚠️

---

## 🎯 Pattern Compliance Scores

| Domain | Compliance | Critical Issues | Agent |
|--------|------------|-----------------|-------|
| SECURITY | 75% | 2 | security-reviewer |
| DATABASE | 60% | 1 | database-reviewer |
| WORKER | 90% | 0 | worker-reviewer |
| SERVICE | 85% | 0 | service-reviewer |
| TESTING | 100% | 0 | testing-reviewer |
| ARCHITECTURE | 95% | 0 | architecture-reviewer |
| CSS | 100% | 0 | css-reviewer |
| LOCAL-FIRST | 100% | 0 | local-first-reviewer |
| COMPONENT | 100% | 0 | component-reviewer |

**Overall Compliance**: 89%

---

## 🚫 BLOCKING ISSUES (Must Fix Before Merge)

### 1. Query not scoped by creatorId
**Domain**: DATABASE | **File**: `packages/content/src/services/content-service.ts:45`
**Rule**: `DB-001`
**Verification**: database-reviewer (found) → service-reviewer (verified) ✓

#### Issue Description
The query filters by ID only without creator scoping. This is a CRITICAL
security vulnerability that could expose content from other creators.

#### Impact
A malicious user could enumerate IDs to access content owned by other
creators, leading to data breach.

#### Current Code
```typescript
const content = await db.query.content.findFirst({
  where: eq(content.id, id)
});
```

#### Corrected Code
```typescript
import { scopedNotDeleted } from '@codex/database';

const content = await db.query.content.findFirst({
  where: and(
    eq(content.id, id),
    scopedNotDeleted(content, creatorId)
  )
});
```

#### Remediation Steps
1. Import `scopedNotDeleted` from `@codex/database`
2. Wrap condition in `and()` with scoping helper
3. Test with multiple creator accounts to verify isolation

**Related Issues**: `2`, `3`

---
```

### Issue Object Structure (Enhanced)

```typescript
interface Issue {
  // Identification
  issue_id: string;           // Sequential: "1", "2", "3"
  title: string;              // Brief descriptive title
  agent: string;              // Agent that found it
  rule_ref?: string;          // e.g., "DB-001", "SEC-042"

  // Location
  file_path: string;
  line_number: number;

  // Classification
  severity: 'blocking' | 'warning' | 'info';

  // Details
  description: string;        // What the issue is
  impact?: string;            // Why it matters
  code_snippet?: string;      // Current problematic code
  corrected_code?: string;    // Fixed code
  language?: string;          // For syntax highlighting (typescript, css, etc.)

  // Verification
  handoff?: string;           // Agent that verified the finding
  related_issues?: string[];  // IDs of related issues

  // Guidance
  remediation?: string;       // Step-by-step fix instructions
}
```

### Agent Report Structure

```typescript
interface AgentReport {
  agent: string;              // Agent name
  agent_name: string;         // Display name
  agent_emoji: string;        // 🔒, 🗄️, etc.

  // Work performed
  files_reviewed: string[];   // List of files reviewed
  files_count: number;
  patterns_checked: number;   // Number of patterns/checks performed
  duration: string;           // e.g., "2.3s"

  // Findings
  issues: Issue[];
  blocking: number;
  warnings: number;
  info: number;

  // Summary
  findings_summary?: string;  // Natural language summary
  notes?: string;             // Additional notes
}
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
