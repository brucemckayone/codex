# Frontend Specification - Continuation Context

**Created**: 2026-01-10
**Purpose**: Zero-context continuation for frontend spec restructuring

---

## TASK SUMMARY

We are restructuring `design/frontend/FRONTEND_SPEC.md` (currently 1991 lines) into separate domain-area documents with significant corrections.

### What Was Done
1. Created initial FRONTEND_SPEC.md with 17 sections
2. Created RESEARCH_NOTES.md for experimental ideas
3. Archived 8 old docs to `design/frontend/_archive/`
4. Researched codebase to understand creator/org model
5. Identified major corrections needed

### What Needs To Be Done
1. Split FRONTEND_SPEC.md into domain-area documents (6-8 docs)
2. Apply all corrections listed below
3. Reduce code examples drastically (design doc, not implementation)
4. Research and clarify the multi-tenancy/monetization model further

---

## CRITICAL CORRECTIONS

### Technical Stack Changes

| Wrong (in current doc) | Correct |
|------------------------|---------|
| Cloudflare Pages hosting | **Cloudflare Workers** hosting SvelteKit |
| Tailwind CSS | **Vanilla CSS** + accessibility-focused library |
| Shadcn-Svelte components | **Custom components** (no Shadcn) |
| `storefront` terminology | **`home`** or other term (not storefront) |

### Creator/Organization Model Corrections

| Wrong Assumption | Correct (from codebase research) |
|------------------|----------------------------------|
| Creators must be in org | Creators CAN exist independently with personal content |
| All content monetizable | **Phase 1: Only org-scoped content purchasable** |
| Creator pages on subdomain | Creator pages at `creators.revelations.studio/{username}` |

### URL Structure (Corrected)

```
revelations.studio/              → Platform marketing/home
www.revelations.studio/          → Alias for root
{org-slug}.revelations.studio/   → Organization home (NOT "storefront")
creators.revelations.studio/{username}/ → Creator personal pages
api.revelations.studio/          → Content-API Worker
auth.revelations.studio/         → Auth Worker
```

---

## CODEBASE RESEARCH FINDINGS

### Database Schema (Key Tables)

**Read these files for schema details:**
- `packages/database/src/schema/users.ts`
- `packages/database/src/schema/content.ts`
- `packages/database/src/schema/ecommerce.ts`

**Key Relationships:**
```
users.role = 'customer' (default, only value currently)

organizationMemberships.role = 'owner' | 'admin' | 'creator' | 'subscriber' | 'member'

content.creatorId = required (who created it)
content.organizationId = nullable (NULL = personal, UUID = org-scoped)

mediaItems.creatorId = required (always creator-owned, NOT org-owned)
```

### Content Ownership Model

1. **Content ALWAYS has creatorId** - tracks who made it
2. **Content CAN belong to org** - `organizationId` nullable
3. **Personal content** = `organizationId IS NULL`, slug unique per creator
4. **Org content** = `organizationId IS NOT NULL`, slug unique per org

### Monetization (Phase 1 Restriction)

**CRITICAL FINDING** in `packages/purchase/src/services/purchase-service.ts`:
```typescript
if (!contentRecord.organizationId) {
  throw new ContentNotPurchasableError(
    'Content must belong to an organization to be purchasable'
  );
}
```

**This means:**
- Creators CAN create personal content
- Creators CANNOT monetize personal content (Phase 1)
- Only org-scoped content is purchasable
- Revenue split: 10% platform, 0% org, 90% creator

### Role Enforcement

**Found in:** `packages/worker-utils/src/procedure/helpers.ts`

The `enforcePolicyInline()` function enforces:
1. IP whitelist
2. Authentication (none/optional/required/worker/platform_owner)
3. Role-based access via `policy.roles` array (checks `user.role`)
4. Organization membership via `requireOrgMembership`
5. Org management (owner/admin) via `requireOrgManagement`

**Note:** `user.role` from users table is always 'customer'. The org membership roles (owner/admin/creator/etc) are separate and checked when `requireOrgMembership: true`.

---

## USER DECISIONS (from conversation)

1. **Doc structure**: Split by domain area (AUTH.md, ROUTING.md, DATA.md, etc.)
2. **Creator pages**: Use `creators.revelations.studio/{username}` pattern
3. **Org landing**: "home" is acceptable term for now
4. **Styling**: Vanilla CSS + accessibility lib (NOT Tailwind/Shadcn)
5. **Hosting**: Cloudflare Workers (NOT Pages)
6. **Code examples**: Minimize - this is a design doc, not implementation

---

## OPEN QUESTIONS (Need Discussion)

1. **Personal content monetization** - When will Phase 2 enable this? Will creators get auto "personal org" or direct monetization?

2. **Org branding/theming** - How do we:
   - Get org brand settings in SSR context?
   - Apply design tokens per-org with subdomain routing?
   - Handle this with vanilla CSS (no Tailwind)?

3. **Role enforcement gap** - `user.role` is always 'customer', but org membership roles are separate. Is this intentional? How should frontend handle this?

4. **Creator studio outside org** - User said "creators are not required to be members of an organisation so they can have a studio outside of any org". But current code requires org for monetization. Clarify the vision.

---

## FILES TO READ

### Current Spec (to be split)
- `design/frontend/FRONTEND_SPEC.md` - Current 1991-line spec
- `design/frontend/RESEARCH_NOTES.md` - Experimental ideas

### Archived Docs (reference material)
- `design/frontend/_archive/ARCHITECTURE.md` - Original architecture
- `design/frontend/_archive/SUBDOMAIN_ROUTING.md` - Multi-tenant routing
- `design/frontend/_archive/DATA_FETCHING.md` - Data patterns
- `design/frontend/_archive/SVELTE5_DATA_PATTERNS.md` - Runes patterns

### Backend Reference
- `CLAUDE.md` - Root project overview
- `packages/CLAUDE.md` - All packages overview
- `packages/database/src/schema/` - Database schema
- `packages/worker-utils/src/procedure/` - Role enforcement
- `packages/purchase/src/services/purchase-service.ts` - Monetization logic

### Key Code Locations
- `packages/worker-utils/src/procedure/helpers.ts:196` - `enforcePolicyInline()` role checks
- `packages/purchase/src/services/purchase-service.ts` - `createCheckoutSession()` org requirement
- `packages/database/src/schema/content.ts` - Content/org relationship

---

## PROPOSED NEW STRUCTURE

Split into domain-area documents:

```
design/frontend/
├── OVERVIEW.md          - Tech stack, principles, project structure
├── INFRASTRUCTURE.md    - Workers hosting, DNS, subdomains, env config
├── ROUTING.md           - Routes, subdomain rewriting, navigation
├── AUTH.md              - Authentication (Auth Worker integration)
├── AUTHORIZATION.md     - Roles, guards, permissions
├── DATA.md              - Data fetching, state management, API helpers
├── COMPONENTS.md        - Component architecture, patterns (no Shadcn)
├── STYLING.md           - Vanilla CSS, theming, org branding, a11y
├── CONTINUATION_CONTEXT.md - This file (for session handoff)
├── RESEARCH_NOTES.md    - Experimental ideas
└── _archive/            - Old docs for reference
```

Each doc should:
- Focus on design decisions, not code
- Minimize code examples (only when truly needed)
- Reference backend docs where appropriate
- Flag open questions clearly

---

## BEADS STATUS

```bash
# Check current status
bd stats
bd list --status=open

# Relevant closed tasks
bd show Codex-nue  # Epic (closed)
bd show Codex-fue  # Setup task (closed)
```

The frontend spec epic (Codex-nue) was closed, but we're now restructuring based on feedback. May need new tasks for the restructure work.

---

## IMMEDIATE NEXT STEPS

1. **Discuss open questions** with user (especially creator/org model clarity)
2. **Create new document structure** - split FRONTEND_SPEC.md into domain docs
3. **Apply corrections** - Workers not Pages, vanilla CSS, correct URLs
4. **Reduce code** - convert code examples to design descriptions
5. **Research theming** - how to handle org branding with vanilla CSS + SSR

---

## CONTEXT7 QUERIES TO RUN

For SvelteKit on Workers:
- Query: 'SvelteKit Cloudflare Workers adapter deployment'
- Library: /sveltejs/kit

For accessibility library options:
- Query: 'Svelte accessibility component library a11y'
- Library: (search for options)

For CSS theming with SSR:
- Query: 'SvelteKit CSS custom properties SSR theming'
- Library: /sveltejs/kit

---

## GIT STATUS

```bash
# Current branch
git branch  # component-definition

# Recent commit
git log -1  # docs: consolidate frontend specification...

# Uncommitted changes (this file)
git status
```

---

**END OF CONTINUATION CONTEXT**
