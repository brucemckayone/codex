# Console Output Template

```
╔══════════════════════════════════════════════════════════════╗
║         Codex PR Review - Branch: {{BRANCH_NAME}}           ║
╠══════════════════════════════════════════════════════════════╣
║  Files Changed: {{FILE_COUNT}} | 🚫 {{BLOCKING}} | ⚠️ {{WARNINGS}} | ℹ️ {{INFO}}     ║
╚══════════════════════════════════════════════════════════════╝

## 🚫 BLOCKING ISSUES (Must Fix)

{{#each blocking_issues}}
### [{{agent}}] {{title}}
**File**: `{{file_path}}:{{line_number}}`
{{#if handoff}}
**Agents**: {{agent}} (found) → {{handoff}} (verified)
{{/if}}

{{description}}

```typescript
// ❌ CURRENT ({{file_path}}:{{line_number}})
{{code_snippet}}

// ✅ CORRECT
{{corrected_code}}
```
{{/each}}

{{#if no_blocking}}
✅ No blocking issues found!
{{/if}}

---

## ⚠️ WARNINGS (Should Fix)

{{#each warning_issues}}
### [{{agent}}] {{title}}
**File**: `{{file_path}}:{{line_number}}`

{{description}}

```typescript
// Current:
{{code_snippet}}

// Suggested:
{{corrected_code}}
```
{{/each}}

{{#if no_warnings}}
✅ No warnings!
{{/if}}

---

## ℹ️ INFO (Optional Improvements)

{{#each info_issues}}
### [{{agent}}] {{title}}
**File**: `{{file_path}}:{{line_number}}`

{{description}}
{{/each}}

{{#if no_info}}
✅ No suggestions!
{{/if}}

---

## 📊 Review Summary

| Agent | Files Reviewed | Issues Found |
|-------|---------------|--------------|
{{#each agent_summary}}
| {{agent_name}} | {{files}} | {{blocking}} 🚫 / {{warnings}} ⚠️ / {{info}} ℹ️ |
{{/each}}

**Total**: {{total_files}} files reviewed across {{total_agents}} agents

---

{{#if has_issues}}
🔗 Run `/pr-review` again after fixing to verify changes.
{{else}}
✨ Looks good! This PR is ready to merge.
{{end}}
```

## Variables

- `BRANCH_NAME`: Name of the branch being reviewed
- `FILE_COUNT`: Number of files changed
- `BLOCKING`: Count of blocking issues
- `WARNINGS`: Count of warnings
- `INFO`: Count of info items
- `blocking_issues`: Array of blocking issue objects
- `warning_issues`: Array of warning objects
- `info_issues`: Array of info objects
- `agent_summary`: Array of per-agent results
- `total_files`: Total files reviewed
- `total_agents`: Total agents that ran

## Issue Object Structure

```typescript
interface Issue {
  title: string;
  agent: string;          // Which agent found it
  file_path: string;
  line_number: number;
  severity: 'blocking' | 'warning' | 'info';
  description: string;
  code_snippet?: string;
  corrected_code?: string;
  handoff?: string;       // Agent that verified the finding
}
```

## Agent Summary Object

```typescript
interface AgentSummary {
  agent_name: string;
  files: number;
  blocking: number;
  warnings: number;
  info: number;
}
```
