# GitHub Comment Template

```markdown
## 🤖 Codex PR Review

**Branch**: `{{BRANCH_NAME}}` | **Files Changed**: {{FILE_COUNT}}

<details>
<summary>🚫 {{BLOCKING}} Blocking Issues</summary>

{{#if has_blocking}}
{{#each blocking_issues}}
#### [{{agent}}] {{title}}

**Location**: [`{{file_path}}:{{line_number}}`]({{file_url}})

{{description}}

```typescript
// ❌ CURRENT
{{code_snippet}}

// ✅ CORRECT
{{corrected_code}}
```

{{/each}}
{{else}}
✅ No blocking issues found!
{{/if}}

</details>

<details>
<summary>⚠️ {{WARNINGS}} Warnings</summary>

{{#if has_warnings}}
{{#each warning_issues}}
#### [{{agent}}] {{title}}

**Location**: [`{{file_path}}:{{line_number}}`]({{file_url}})

{{description}}

```typescript
// Current:
{{code_snippet}}

// Suggested:
{{corrected_code}}
```

{{/each}}
{{else}}
✅ No warnings!
{{/if}}

</details>

{{#if has_info}}
<details>
<summary>ℹ️ {{INFO}} Suggestions</summary>

{{#each info_issues}}
#### [{{agent}}] {{title}}

**Location**: [`{{file_path}}:{{line_number}}`]({{file_url}})

{{description}}

{{/each}}
</details>
{{/if}}

---

## 📊 Agent Results

| Agent | Files | Issues |
|-------|-------|--------|
{{#each agent_summary}}
| {{agent_name}} | {{files}} | {{blocking}}🚫 {{warnings}}⚠️ {{info}}ℹ️ |
{{/each}}

---

*Reviewed by Codex PR Review Agent Team | {{timestamp}}*
```
