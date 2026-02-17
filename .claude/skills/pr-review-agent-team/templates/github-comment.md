# GitHub Comment Template - Enhanced

```markdown
{{#if banner}}
<a href="{{banner_url}}"><img src="{{banner_image}}" alt="Codex PR Review" /></a>
{{/if}}

## 🔍 Codex PR Review Report

**Branch**: ``{{BRANCH_NAME}}`` **→** ``main``
**Files Changed**: {{FILE_COUNT}} (**+{{ADDITIONS}}** / **-{{DELETIONS}}**)
**Review Duration**: {{review_duration}}

---

### Summary

| Status | {{#if ready_to_merge}}✅ Ready to Merge{{else}}⚠️ Requires Fixes{{/if}} |
|--------|-------|
| **Overall Compliance** | {{overall_compliance}}% |
| **Blocking Issues** | 🚫 {{BLOCKING}} |
| **Warnings** | ⚠️ {{WARNINGS}} |
| **Suggestions** | ℹ️ {{INFO}} |

{{executive_summary}}

---

### Pattern Compliance by Domain

| Domain | Score | Issues | Agent |
|--------|-------|--------|-------|
{{#each compliance_scores}}
| **{{domain}}** | {{#if score_under_80}}⚠️{{/if}} **{{score}}%** | {{critical}} 🚫 / {{warning}} ⚠️ | @{{agent}} |
{{/each}}

---

{{#if blocking_issues}}
### 🚫 Blocking Issues (Must Fix)

{{#each blocking_issues}}
#### {{issue_id}}. {{title}} {{#if rule_ref}}`[{{rule_ref}}]`{{/if}}

<details>
<summary><b>Location:</b> <code>{{file_path}}:{{line_number}}</code></summary>

**Domain**: {{agent}}
{{#if handoff}}
**Verified by**: {{handoff}}
{{/if}}

{{description}}

{{#if impact}}
**Impact**: {{impact}}
{{/if}}

**Current Code**:
```typescript{{#if language}}
{{language}}{{/if}}
{{code_snippet}}
```

**Fixed Code**:
```typescript{{#if language}}
{{language}}{{/if}}
{{corrected_code}}
```

{{#if remediation}}
**Fix Steps**:
{{remediation}}
{{/if}}

</details>

{{/each}}
{{/if}}

---

{{#if warning_issues}}
### ⚠️ Warnings (Should Fix)

{{#each warning_issues}}
#### {{title}} {{#if rule_ref}}`[{{rule_ref}}]`{{/if}}

<details>
<summary><b>Location:</b> <code>{{file_path}}:{{line_number}}</code> — {{description}}</summary>

**Domain**: {{agent}}

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
{{remediation}}
{{/if}}

</details>

{{/each}}
{{/if}}

---

{{#if info_issues}}
### ℹ️ Suggestions (Optional)

{{#each info_issues}}
#### {{title}}

<details>
<summary><code>{{file_path}}:{{line_number}}</code></summary>

{{description}}

{{#if corrected_code}}
```typescript{{#if language}}
{{language}}{{/if}}
{{corrected_code}}
```
{{/if}}

</details>

{{/each}}
{{/if}}

---

### 📁 Files Reviewed

{{#each file_breakdown}}
<details>
<summary><code>{{file_path}}</code> — {{blocking}} 🚫 {{warnings}} ⚠️ {{info}} ℹ️</summary>

**Changes**: +{{additions}} -{{deletions}}
**Reviewed by**: {{#each agents}}{{this}} {{/each}}

{{#if issues}}
| Severity | Line | Issue |
|----------|------|-------|
{{#each issues}}
| {{severity_icon}} `{{severity}}` | `{{line}}` | {{title}} |
{{/each}}
{{else}}
✅ No issues found
{{/if}}

</details>

{{/each}}

---

### 📊 Detailed Agent Results

{{#each agent_details}}
#### {{agent_emoji}} {{agent_name}}

| Metric | Value |
|--------|-------|
| Files Reviewed | {{files_count}} |
| Patterns Checked | {{patterns_checked}} |
| Issues Found | {{blocking}} 🚫 / {{warnings}} ⚠️ / {{info}} ℹ️ |
| Duration | {{duration}} |

{{#if findings_summary}}
{{findings_summary}}
{{/if}}

{{#if notes}}
> {{notes}}
{{/if}}

{{/each}}

---

### 📈 Statistics

| Metric | Value |
|--------|-------|
| **Total Files Changed** | {{FILE_COUNT}} |
| **Files Reviewed** | {{files_reviewed}} |
| **Lines Changed** | +{{ADDITIONS}} / -{{DELETIONS}} |
| **Total Issues** | {{total_issues}} |
| **Agents Deployed** | {{agents_deployed}} |

#### Issues by Domain

| Domain | Blocking | Warning | Info | Total |
|--------|----------|---------|------|-------|
{{#each domain_breakdown}}
| {{domain}} | {{blocking}} | {{warning}} | {{info}} | {{total}} |
{{/each}}

#### Files Requiring Most Attention

1. `{{worst_file_1}}` — **{{worst_file_1_count}}** issues
2. `{{worst_file_2}}` — **{{worst_file_2_count}}** issues
3. `{{worst_file_3}}` — **{{worst_file_3_count}}** issues

---

{{#if has_blocking}}
### 🔧 Recommended Actions

1. ✅ Fix all **{{BLOCKING}}** blocking issues
2. 🔄 Review **{{WARNINGS}}** warning(s)
3. 🧪 Re-run review after fixes

**Estimated Fix Time**: {{estimated_fix_time}}

{{else}}
### ✅ Review Passed

No blocking issues found. Consider addressing {{WARNINGS}} warning(s) for optimal code quality.

{{/if}}

---

<small>
*Reviewed by Codex PR Review Agent Team • {{timestamp}} • [View Full Report]({{report_url}})*
</small>

{{#if has_issues}}
<!-- PR Review Badges -->
![Codex Review](https://img.shields.io/badge/Codex%20Review-{{review_status}}-{{review_color}})
{{/if}}
```

## Enhanced Variables (in addition to console template)

### GitHub-Specific Variables
- `banner`: Whether to show banner image
- `banner_url`: URL for banner link
- `banner_image`: Banner image URL
- `review_url`: URL to full report (if persisted)
- `timestamp`: ISO timestamp of review
- `ready_to_merge`: Boolean for merge readiness

### Compliance Scores
- `score_under_80`: Boolean flag for scores below 80%
- `agent_emoji`: Emoji for each agent (e.g., 🔒 for Security)

### Agent Emojis Map
```typescript
const AGENT_EMOJIS: Record<string, string> = {
  'security-reviewer': '🔒',
  'database-reviewer': '🗄️',
  'worker-reviewer': '⚙️',
  'service-reviewer': '📦',
  'testing-reviewer': '🧪',
  'architecture-reviewer': '🏗️',
  'css-reviewer': '🎨',
  'local-first-reviewer': '💾',
  'component-reviewer': '🧩'
};
```

### Severity Icons
```typescript
const SEVERITY_ICONS: Record<string, string> = {
  'blocking': '🚫',
  'warning': '⚠️',
  'info': 'ℹ️'
};
```

### Review Status Badge
```typescript
function getReviewStatus(results: AgentResult[]): { status: string, color: string } {
  const blocking = results.flatMap(r => r.issues).filter(i => i.severity === 'blocking').length;

  if (blocking > 0) {
    return { status: 'Failed', color: 'red' };
  }
  const warnings = results.flatMap(r => r.issues).filter(i => i.severity === 'warning').length;
  if (warnings > 0) {
    return { status: 'Warning', color: 'yellow' };
  }
  return { status: 'Passed', color: 'brightgreen' };
}
```

## GitHub Comment Posting

```typescript
async function postGitHubComment(
  markdown: string,
  prNumber?: string
): Promise<void> {
  const commentBody = markdown.trim();

  if (prNumber) {
    await exec(`gh pr comment ${prNumber} --body-file -`, {
      input: commentBody
    });
  } else {
    // Post to current PR
    await exec(`gh pr comment --body-file -`, {
      input: commentBody
    });
  }
}

// Find existing review comment to update or create new
async function findOrCreateReviewComment(): Promise<string | null> {
  const comments = await exec(`gh pr comments --json id,body,author`);

  const botComment = JSON.parse(comments.stdout)
    .find((c: any) =>
      c.author.login === 'github-actions[bot]' &&
      c.body.includes('Codex PR Review')
    );

  return botComment?.id || null;
}

async function updateReviewComment(commentId: string, body: string): Promise<void> {
  await exec(`gh pr comment edit ${commentId} --body-file -`, {
    input: body
  });
}
```

## URL Generation for File Links

```typescript
function generateFileUrl(
  filePath: string,
  lineNumber: number,
  branch: string,
  repoOwner: string,
  repoName: string
): string {
  return `https://github.com/${repoOwner}/${repoName}/blob/${branch}/${filePath}#L${lineNumber}`;
}
```
