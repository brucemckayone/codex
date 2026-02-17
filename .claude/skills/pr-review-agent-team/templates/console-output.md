# Console Output Template - Enhanced

```
╔════════════════════════════════════════════════════════════════════════════╗
║                    🔍 Codex PR Review Report                             ║
╠════════════════════════════════════════════════════════════════════════════╣
║  Branch: {{BRANCH_NAME}}                                                  ║
║  Base: main → HEAD                                                       ║
╠════════════════════════════════════════════════════════════════════════════╣
║  Files Changed: {{FILE_COUNT}} | Additions: {{ADDITIONS}} | Deletions: {{DELETIONS}}    ║
║  🚫 BLOCKING: {{BLOCKING}} | ⚠️ WARNINGS: {{WARNINGS}} | ℹ️ INFO: {{INFO}}              ║
╚════════════════════════════════════════════════════════════════════════════╝

{{#if executive_summary}}
## 📋 Executive Summary

{{executive_summary}}

**Overall Assessment**: {{OVERALL_ASSESSMENT}} {{#if ready_to_merge}}✅ Ready to merge{{else}}⚠️ Requires fixes{{/if}}

---

{{/if}}
## 🎯 Pattern Compliance Scores

| Domain | Compliance | Critical Issues | Agent |
|--------|------------|-----------------|-------|
{{#each compliance_scores}}
| {{domain}} | {{score}}% | {{critical}} | {{agent}} |
{{/each}}

**Overall Compliance**: {{overall_compliance}}%

---

{{#if blocking_issues}}
## 🚫 BLOCKING ISSUES (Must Fix Before Merge)

{{#each blocking_issues}}
### {{issue_id}}. {{title}}
**Domain**: {{agent}} | **File**: `{{file_path}}:{{line_number}}`
{{#if rule_ref}}**Rule**: `{{rule_ref}}`{{/if}}
{{#if handoff}}
**Verification**: {{agent}} (found) → {{handoff}} (verified) ✓
{{/if}}

#### Issue Description
{{description}}

{{#if impact}}
#### Impact
{{impact}}
{{/if}}

#### Current Code
```typescript{{#if language}}
{{language}}{{/if}}
{{code_snippet}}
```

#### Corrected Code
```typescript{{#if language}}
{{language}}{{/if}}
{{corrected_code}}
```

{{#if remediation}}
#### Remediation Steps
{{remediation}}
{{/if}}

{{#if related_issues}}
**Related Issues**: {{#each related_issues}}`{{this}}` {{/each}}
{{/if}}

---
{{/each}}
{{/if}}

{{#if warning_issues}}
## ⚠️ WARNINGS (Should Fix)

{{#each warning_issues}}
### {{issue_id}}. {{title}}
**Domain**: {{agent}} | **File**: `{{file_path}}:{{line_number}}`
{{#if rule_ref}}**Rule**: `{{rule_ref}}`{{/if}}

{{description}}

{{#if code_snippet}}
```typescript{{#if language}}
{{language}}{{/if}}
{{code_snippet}}
```
{{/if}}

{{#if corrected_code}}
**Suggested**:
```typescript{{#if language}}
{{language}}{{/if}}
{{corrected_code}}
```
{{/if}}

{{#if remediation}}
**Note**: {{remediation}}
{{/if}}

---
{{/each}}
{{/if}}

{{#if info_issues}}
## ℹ️ SUGGESTIONS (Optional Improvements)

{{#each info_issues}}
### {{issue_id}}. {{title}}
**Domain**: {{agent}} | **File**: `{{file_path}}:{{line_number}}`

{{description}}

{{#if corrected_code}}
```typescript{{#if language}}
{{language}}{{/if}
{{corrected_code}}
```
{{/if}}

---
{{/each}}
{{/if}}

## 📁 File-by-File Breakdown

{{#each file_breakdown}}
### `{{file_path}}`
**Changes**: +{{additions}} -{{deletions}} | **Issues**: {{blocking}} 🚫 {{warnings}} ⚠️ {{info}} ℹ️
**Reviewed by**: {{#each agents}}{{this}} {{/each}}

{{#if issues}}
| Severity | Line | Domain | Issue |
|----------|------|--------|-------|
{{#each issues}}
| {{severity_icon}} `{{severity}}` | `{{line}}` | {{agent}} | {{title}} |
{{/each}}
{{else}}
✅ No issues found in this file
{{/if}}

---
{{/each}}

## 🔬 Detailed Agent Results

{{#each agent_details}}
### {{agent_name}}

**Files Reviewed**: {{files_count}}
**Patterns Checked**: {{patterns_checked}}
**Time**: {{duration}}

{{#if findings_summary}}
**Findings Summary**:
{{findings_summary}}
{{/if}}

{{#if notes}}
**Notes**:
{{notes}}
{{/if}}

---
{{/each}}

## 📊 Final Statistics

| Metric | Value |
|--------|-------|
| **Total Files Changed** | {{FILE_COUNT}} |
| **Files Reviewed** | {{files_reviewed}} / {{FILE_COUNT}} |
| **Lines Added** | {{ADDITIONS}} |
| **Lines Removed** | {{DELETIONS}} |
| **Net Change** | {{net_change}} |
| **Blocking Issues** | {{BLOCKING}} |
| **Warning Issues** | {{WARNINGS}} |
| **Info Suggestions** | {{INFO}} |
| **Total Issues** | {{total_issues}} |
| **Agents Deployed** | {{agents_deployed}} |
| **Review Duration** | {{review_duration}} |

### Issue Breakdown by Domain

| Domain | Blocking | Warning | Info | Total |
|--------|----------|---------|------|-------|
{{#each domain_breakdown}}
| {{domain}} | {{blocking}} | {{warning}} | {{info}} | {{total}} |
{{/each}}

### Files Most Needing Attention

1. `{{worst_file_1}}` - {{worst_file_1_count}} issues
2. `{{worst_file_2}}` - {{worst_file_2_count}} issues
3. `{{worst_file_3}}` - {{worst_file_3_count}} issues

---

{{#if has_blocking}}
## 🔧 Recommended Action Plan

1. **Fix all {{BLOCKING}} blocking issues** - These must be resolved before merge
2. **Address warnings** - Review and fix {{WARNINGS}} warning(s) for better code quality
3. **Re-run review** - Execute `/pr-review` after fixes to verify resolution

**Estimated Fix Time**: {{estimated_fix_time}}

{{else}}
## ✅ Review Passed - Ready for Merge

All blocking issues resolved. Consider addressing {{WARNINGS}} warning(s) for optimal code quality.
{{/if}}

---

{{#if has_issues}}
Would you like me to:
  1. Post this review as a GitHub comment?
  2. Generate fix patches for blocking issues?
  3. Create detailed remediation tickets?
{{else}}
Would you like me to post this approval as a GitHub comment?
{{/if}}
```

## Enhanced Variables

### Header Variables
- `BRANCH_NAME`: Name of the branch being reviewed
- `FILE_COUNT`: Number of files changed
- `ADDITIONS`: Total lines added
- `DELETIONS`: Total lines removed
- `BLOCKING`: Count of blocking issues
- `WARNINGS`: Count of warnings
- `INFO`: Count of info items

### Executive Summary
- `executive_summary`: 2-3 sentence overview of the PR
- `OVERALL_ASSESSMENT`: "Good", "Needs Work", "Critical Issues"
- `ready_to_merge`: boolean

### Compliance Scores
- `compliance_scores[]`: Array of domain compliance scores
  - `domain`: Name of domain (Security, Database, etc.)
  - `score`: Percentage (0-100)
  - `critical`: Number of critical violations
  - `agent`: Agent name
- `overall_compliance`: Overall percentage

### Issue Object (Enhanced)
```typescript
interface Issue {
  issue_id: string;           // Sequential number (1, 2, 3...)
  title: string;
  agent: string;              // Which agent found it
  file_path: string;
  line_number: number;
  severity: 'blocking' | 'warning' | 'info';
  description: string;
  impact?: string;            // Why this matters
  code_snippet?: string;
  corrected_code?: string;
  language?: string;          // For syntax highlighting
  rule_ref?: string;          // Reference to specific rule
  handoff?: string;           // Agent that verified
  remediation?: string;       // Step-by-step fix
  related_issues?: string[];  // IDs of related issues
}
```

### File Breakdown
- `file_breakdown[]`: Array of per-file results
  - `file_path`: Path to file
  - `additions`: Lines added in this file
  - `deletions`: Lines removed
  - `blocking`: Count of blocking issues
  - `warnings`: Count of warnings
  - `info`: Count of info
  - `agents`: Array of agent names that reviewed
  - `issues[]`: Array of issues in this file

### Agent Details
- `agent_details[]`: Array of detailed agent results
  - `agent_name`: Name of agent
  - `files_count`: Number of files reviewed
  - `patterns_checked`: Number of patterns/checks
  - `duration`: Time taken for review
  - `findings_summary`: Summary of findings
  - `notes`: Additional notes

### Statistics
- `files_reviewed`: Number of files actually reviewed
- `net_change`: Net line change (additions - deletions)
- `total_issues`: Total issues across all severities
- `agents_deployed`: Number of agents that ran
- `review_duration`: Total time for review

### Domain Breakdown
- `domain_breakdown[]`: Array of per-domain issue counts
  - `domain`: Domain name
  - `blocking`: Count by severity
  - `warning`: Count by severity
  - `info`: Count by severity
  - `total`: Total for domain

### Files Most Needing Attention
- `worst_file_1`, `worst_file_1_count`: Worst file and issue count
- `worst_file_2`, `worst_file_2_count`: Second worst
- `worst_file_3`, `worst_file_3_count`: Third worst

### Action Plan
- `estimated_fix_time`: Estimated time to fix issues (e.g., "30 minutes")

## Helper Functions for Enhanced Output

```typescript
// Calculate compliance score per domain
function calculateCompliance(agentResults: AgentResult[]): ComplianceScore[] {
  return agentResults.map(agent => {
    const checksPerformed = agent.checksPerformed || 0;
    const violations = agent.issues.filter(i => i.severity === 'blocking').length;
    const score = checksPerformed > 0
      ? Math.round(((checksPerformed - violations) / checksPerformed) * 100)
      : 100;
    return {
      domain: agent.agent.replace('-reviewer', '').toUpperCase(),
      score,
      critical: violations,
      agent: agent.agent
    };
  });
}

// Generate executive summary
function generateExecutiveSummary(results: AgentResult[]): string {
  const blocking = results.flatMap(r => r.issues).filter(i => i.severity === 'blocking');
  const warnings = results.flatMap(r => r.issues).filter(i => i.severity === 'warning');

  if (blocking.length > 0) {
    return `This PR has **${blocking.length} blocking issue(s)** that must be fixed before merge. ` +
           `Primary concerns: ${getTopDomains(blocking)}. ` +
           `Additionally, ${warnings.length} warning(s) should be reviewed.`;
  } else if (warnings.length > 0) {
    return `No blocking issues found. ${warnings.length} warning(s) present ` +
           `that should be addressed for better code quality.`;
  } else {
    return `✅ All checks passed. This PR follows Codex architectural patterns.`;
  }
}

// Group issues by file
function groupByFile(issues: Issue[]): FileBreakdown[] {
  const fileMap = new Map<string, FileBreakdown>();

  for (const issue of issues) {
    if (!fileMap.has(issue.file_path)) {
      fileMap.set(issue.file_path, {
        file_path: issue.file_path,
        additions: 0,
        deletions: 0,
        blocking: 0,
        warnings: 0,
        info: 0,
        agents: new Set<string>(),
        issues: []
      });
    }
    const file = fileMap.get(issue.file_path)!;
    file[issue.severity + 's']++;
    file.agents.add(issue.agent);
    file.issues.push(issue);
  }

  return Array.from(fileMap.values());
}

// Get line changes per file
async function getFileChanges(branch: string): Promise<Map<string, {additions: number, deletions: number}>> {
  const result = await exec(`git diff --numstat main...${branch}`);
  const changes = new Map();

  result.stdout.trim().split('\n').forEach(line => {
    const [additions, deletions, file] = line.split('\t');
    changes.set(file, {
      additions: parseInt(additions) || 0,
      deletions: parseInt(deletions) || 0
    });
  });

  return changes;
}

// Estimate fix time
function estimateFixTime(issues: Issue[]): string {
  const blocking = issues.filter(i => i.severity === 'blocking').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;

  // Rough estimate: 10 min per blocking, 5 min per warning
  const minutes = (blocking * 10) + (warnings * 5);

  if (minutes < 15) return '~5-10 minutes';
  if (minutes < 60) return `~${Math.ceil(minutes / 5) * 5} minutes`;
  const hours = Math.ceil(minutes / 60);
  return `~${hours} hour${hours > 1 ? 's' : ''}`;
}
```
