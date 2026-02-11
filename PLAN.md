# Frontend Phase 1: Beads Task Restructure Plan

## Current State Summary

### What's Done (182 closed beads)
- **WP-1**: SvelteKit scaffold, Cloudflare adapter, Svelte 5 runes
- **WP-2**: hooks.ts reroute + hooks.server.ts session validation
- **WP-4**: Design tokens (colors, typography, spacing, etc.) + 22 Melt UI components
- **WP-6 partial**: PlatformHeader, Footer, PageContainer, MobileNav
- **WP-7 partial**: Landing, Discover, Pricing, About pages
- **Data Layer**: TanStack DB + Remote Functions (DL-1 through DL-8)
- **Branding**: KV edge cache for org tokens
- **Auth**: Login + Register functional, session cookies working
- **Library**: Basic page with TanStack DB integration + progress
- **VideoPlayer**: HLS component built (not routed to any page)
- **Image Pipeline**: Multi-size WebP thumbnails via transcoding

### What's Open (13 issues, 2 blocked)
| Issue | Status | Priority | Notes |
|-------|--------|----------|-------|
| Codex-tvf | Epic | P1 | Parent epic, keep |
| Codex-tvf.2 | In Progress | P1 | Auth - login/register done, 3 pages skeletal |
| Codex-tvf.3 | Open | P2 | Core Product - too coarse, needs breakdown |
| Codex-tvf.4 | Open | P2 | Admin - too coarse, needs breakdown |
| Codex-tvf.5 | Open | P2 | E-Commerce - too coarse, needs breakdown |
| Codex-nib | Open | P1 | Org Routes - **critical path blocker** |
| Codex-0vf | Open | P2 | Library - basic version done, needs features |
| Codex-4dz | Blocked | P2 | Checkout - blocked on Codex-nib |
| Codex-2zy | Blocked | P2 | SEO - blocked on Codex-nib |
| Codex-gg9 | Open | P3 | Image Optimization - unblocked |
| Codex-qv2 | Open | P2 | Public content API (backend) |
| Codex-pns | Epic | P2 | Test coverage - separate initiative |
| Codex-qwg | Epic | P2 | Constants refactor - separate initiative |

### Critical Gaps (Code vs Design Docs)
1. **Content Detail Page** - Route doesn't exist. VideoPlayer built but no page to mount it.
2. **Studio/Admin Dashboard** - Placeholder only, no functionality.
3. **Auth pages** - Forgot/reset/verify are skeleton (no backend integration).
4. **Account Settings** - Profile form has no save action. Payment/notifications empty.
5. **Creator Profiles** - Placeholder content only.
6. **Org Routes** - Landing/explore are basic. No content detail. No studio.
7. **Checkout Flow** - Not started.
8. **SEO** - Not started.
9. **Error Pages** - No custom 404/500.

---

## Plan: New Task Structure

### Strategy
- Keep existing Codex-tvf epic + phase subtasks as organizational markers
- Create **34 new standalone tasks** with full specs + dependency links
- Each task is self-contained: file paths, component APIs, acceptance criteria, code patterns
- Dependencies link back to phases and to each other
- Update existing tasks (nib, 0vf, 2zy, 4dz, gg9) with enhanced descriptions

### Task Map by Phase

#### Phase 1.2: Auth Completion (4 tasks → unblock Phase 1.3)
```
AUTH-01: Complete Forgot Password Flow          P1  deps: [tvf.2]
AUTH-02: Complete Reset Password Flow           P1  deps: [AUTH-01]
AUTH-03: Complete Email Verification Flow       P1  deps: [tvf.2]
AUTH-04: Account Layout & Protected Routes      P1  deps: [tvf.2]
```

#### Phase 1.3a: Content & Org Routes (6 tasks → critical path)
```
CONTENT-01: Content Detail Page Route           P1  deps: [nib]
CONTENT-02: VideoPlayer Integration             P1  deps: [CONTENT-01]
CONTENT-03: PreviewPlayer & Access Gate         P1  deps: [CONTENT-02]
ORG-01: Org Landing Page Enhancement            P1  deps: [nib]
ORG-02: Org Explore Page Enhancement            P1  deps: [nib]
ORG-03: OrgHeader & Org Layout Activation       P1  deps: [nib]
```

#### Phase 1.3b: Library Enhancement (3 tasks)
```
LIB-01: Library Filtering & Search              P2  deps: [0vf]
LIB-02: Library Continue Watching Section       P2  deps: [0vf]
LIB-03: Library Sort & Pagination               P2  deps: [0vf]
```

#### Phase 1.3c: Creator Profiles (2 tasks)
```
CREATOR-01: Creator Profile Page                P2  deps: [tvf.3]
CREATOR-02: Creator Content Catalog             P2  deps: [CREATOR-01]
```

#### Phase 1.3d: Account Pages (3 tasks)
```
ACCT-01: Account Profile Save                   P2  deps: [AUTH-04]
ACCT-02: Account Notifications Settings         P2  deps: [AUTH-04]
ACCT-03: Account Payment Settings               P2  deps: [AUTH-04]
```

#### Phase 1.4: Admin/Studio (6 tasks)
```
STUDIO-01: Studio Layout Shell                  P2  deps: [tvf.4, ORG-03]
STUDIO-02: Studio Dashboard Stats               P2  deps: [STUDIO-01]
STUDIO-03: Studio Activity Feed                 P2  deps: [STUDIO-01]
STUDIO-04: Studio Content Management            P2  deps: [STUDIO-01]
STUDIO-05: Studio Analytics Page                P2  deps: [STUDIO-01]
STUDIO-06: Studio Customers Page                P2  deps: [STUDIO-01]
```

#### Phase 1.4b: Admin Settings (3 tasks)
```
SETTINGS-01: Branding Settings (Logo + Colors)  P2  deps: [STUDIO-01]
SETTINGS-02: General & Social Settings          P2  deps: [STUDIO-01]
SETTINGS-03: Billing Page (Owner Only)          P2  deps: [STUDIO-01]
```

#### Phase 1.5: E-Commerce (4 tasks)
```
ECOM-01: Purchase Components                    P2  deps: [CONTENT-03]
ECOM-02: Checkout Session & Redirect            P2  deps: [ECOM-01]
ECOM-03: Checkout Success Page                  P2  deps: [ECOM-02]
ECOM-04: Checkout Cancel Page                   P2  deps: [ECOM-02]
```

#### Cross-Cutting (3 tasks)
```
SEO-01: SEO Component & Page Integration        P2  deps: [CONTENT-01, ORG-01] (update Codex-2zy)
IMG-01: Image Optimization & ResponsiveImage    P3  deps: [] (update Codex-gg9)
ERR-01: Custom Error Pages (404, 500)           P2  deps: [tvf]
```

### Existing Tasks to Update
- **Codex-nib**: Add detailed file paths, component specs, code patterns from WP-8
- **Codex-0vf**: Mark as "basic done", update to track only enhancements
- **Codex-4dz**: Enhance description with full checkout flow from P1-FE-ECOM-001
- **Codex-2zy**: Enhance with SEO component code + per-page meta specs
- **Codex-gg9**: Enhance with enhanced-img config + ResponsiveImage component

### Dependency Graph (Critical Path highlighted)
```
tvf.2 (Auth - in progress)
  ├── AUTH-01 → AUTH-02
  ├── AUTH-03
  └── AUTH-04 → ACCT-01, ACCT-02, ACCT-03

nib (Org Routes - CRITICAL)
  ├── CONTENT-01 → CONTENT-02 → CONTENT-03 → ECOM-01 → ECOM-02 → ECOM-03, ECOM-04
  ├── ORG-01 ─────┐
  ├── ORG-02      ├── SEO-01 (Codex-2zy)
  └── ORG-03 → STUDIO-01 → STUDIO-02..06, SETTINGS-01..03

0vf (Library - basic done)
  ├── LIB-01
  ├── LIB-02
  └── LIB-03

tvf.3 → CREATOR-01 → CREATOR-02

Standalone: IMG-01, ERR-01
```

### Execution Priority Order
1. **NOW**: Finish tvf.2 (auth completion) + Codex-nib (org routes) in parallel
2. **NEXT**: CONTENT-01..03 + ORG-01..03 (content pages + org enhancements)
3. **THEN**: STUDIO-01 + LIB-01..03 + AUTH-04 + ACCT-01..03 in parallel
4. **THEN**: STUDIO-02..06 + SETTINGS-01..03 + ECOM-01..04
5. **FINALLY**: SEO-01 + IMG-01 + ERR-01 + CREATOR-01..02

### Task Spec Template (for each new task)
Each task description will include:
- **Objective**: What this task accomplishes
- **Files to Create/Modify**: Exact paths
- **Component API**: Props interface, expected behavior
- **Server Load**: Data fetching patterns with API endpoints
- **Code Patterns**: Key implementation snippets from design docs
- **Design Doc References**: Which docs to read for full context
- **Acceptance Criteria**: Checkboxes for completion
- **Effort Estimate**: Hours
- **Dependencies**: What must be done first

### Estimated Total Effort
| Phase | Tasks | Hours |
|-------|-------|-------|
| Auth Completion | 4 | 10-14h |
| Content & Org | 6 | 30-40h |
| Library Enhancement | 3 | 8-12h |
| Creator Profiles | 2 | 6-8h |
| Account Pages | 3 | 8-12h |
| Admin/Studio | 6 | 25-35h |
| Admin Settings | 3 | 8-12h |
| E-Commerce | 4 | 10-14h |
| Cross-Cutting | 3 | 8-12h |
| **Total** | **34** | **113-159h** |

---

## Execution Plan

Once approved, I will:
1. Create all 34 new beads tasks with full self-contained specs
2. Update 5 existing tasks with enhanced descriptions
3. Set all dependency links
4. Run `bd sync` to persist

I'll use parallel agents to create tasks efficiently (batches of 3-4).
