# Task Enhancement Template

Use this template when a beads task lacks sufficient detail for planning.

## Template

```markdown
## Task Enhancement Required ⚠️

This task needs more detail before planning can proceed. Please update the task with:

### Objective
Clear statement of what will be built/changed. What problem does this solve?

### Acceptance Criteria
- [ ] Specific, testable criteria
- [ ] Each criterion can be verified as complete
- [ ] Include both functional and non-functional requirements

### Technical Details
- Files to create/modify (with full paths)
- Services/routes affected
- Database changes (if any)
- External dependencies (if any)

### Pattern References
- Link to similar existing implementation in the codebase
- CLAUDE.md sections that apply
- Any relevant documentation

### Effort Estimate
Size (S/M/L) with estimated hours

---

## Example Format

### Objective
Add organization landing page with branded header and content listing. This allows organizations to showcase their content with custom branding.

### Acceptance Criteria
- [ ] Page loads at `/org/:slug`
- [ ] Displays org name and logo from database
- [ ] Lists all published content for this org
- [ ] Respects org brand colors via CSS variables
- [ ] Error boundary handles 404 for invalid org slugs
- [ ] Page is SSR for SEO with proper meta tags

### Technical Details

**Files to CREATE:**
- `apps/web/src/routes/_org/[slug]/+page.server.ts` - SSR data load, fetch org and content
- `apps/web/src/routes/_org/[slug]/+page.svelte` - Page component
- `apps/web/src/routes/_org/[slug]/+error.svelte` - Error boundary
- `apps/web/src/lib/collections/org.ts` - TanStack DB collection for org data

**Files to MODIFY:**
- `apps/web/src/lib/paraglide/messages/en.js` - Add i18n keys

**Database Queries:**
- Fetch org by slug (scoped)
- Fetch published content for org (scoped)
- Count total content for pagination

### Pattern References
- Similar page: `apps/web/src/routes/(platform)/library/+page.svelte`
- CLAUDE.md: `packages/CLAUDE.md` (Service layer), `workers/CLAUDE.md` (API routes)
- Remote functions: `apps/web/src/lib/remote/content.remote.ts`

### Effort
M - 4-6 hours

---

## How to Use

When the orchestrator identifies an incomplete task, add a comment to the task with this template and the enhancement guidance. The task owner should then update the task notes with the required sections.
```
