# Shared UI Implementation Plan
**Worktree**: wt-shared-ui (feat/shared-ui)
**Base Branch**: feat/account-payment-history
**Date**: 2026-02-21

---

## Overview

This plan covers the completion of shared UI components for the Codex Platform. Three component tasks are mostly complete but require missing i18n messages to function properly.

`★ Insight ─────────────────────────────────────`
- **Svelte 5 Runes**: All components use `$props()` and `$derived()` for reactive state
- **Paraglide Integration**: Messages are compiled from `messages/en.json` to `src/paraglide/messages.js`
- **Component Reusability**: Pagination, ContentCard, and CreatorCard are used across ORG, CREATOR, and STUDIO features
`─────────────────────────────────────────────────`

---

## Task Summary

| Task ID | Title | Status | Blockers |
|---------|-------|--------|----------|
| Codex-ghnr | Pagination Component | ✅ Complete | None |
| Codex-6evb | ContentCard & CreatorCard | ✅ Complete | None |
| Codex-j5tl | Add paraglide i18n messages | 🔨 Ready | None |
| Codex-ood8 | Error boundaries for creator routes | ✅ Complete | None |

---

## Phase 1: Add Missing i18n Messages (Codex-j5tl)

### Current State

The components are fully implemented but reference i18n messages that don't exist in `apps/web/messages/en.json`. When the app runs, these will cause runtime errors.

### Missing Messages by Component

**ContentCard** (6 messages):
```json
"content_type_video": "Video",
"content_type_audio": "Audio",
"content_type_article": "Article",
"content_view": "View {title}",
"content_thumbnail_alt": "Thumbnail for {title}",
"content_duration": "Duration"
```

**CreatorCard** (6 messages):
```json
"creator_content_count": "{count} content",
"creator_view_profile": "View {name}'s profile",
"creator_visit_website": "Visit website",
"creator_visit_twitter": "Visit Twitter profile",
"creator_visit_youtube": "Visit YouTube channel",
"creator_visit_instagram": "Visit Instagram profile"
```

**Error Boundaries** (6 messages - may need to be added):
```json
"errors_not_found": "Page not found",
"errors_resource_not_found": "The resource you're looking for doesn't exist.",
"errors_browse_discover": "Browse Discover",
"errors_unauthorized": "Unauthorized",
"errors_login_required": "Please sign in to access this resource.",
"errors_login": "Sign In",
"errors_server_error": "Server Error",
"errors_try_again_later": "Something went wrong. Please try again later.",
"errors_go_home": "Go Home"
```

### Implementation Steps

1. **Edit `apps/web/messages/en.json`**
   - Add the 12 content/creator messages after `"common_cancel"` (line ~32)
   - Add the 9 error messages if not present
   - Maintain JSON formatting (2-space indent)

2. **Compile Paraglide Messages**
   ```bash
   cd apps/web && npx @inlang/paraglide-js compile --project project.inlang
   ```

3. **Verify Output**
   ```bash
   grep -E "export const (content_|creator_)" src/paraglide/messages.js
   ```

### Acceptance Criteria
- [ ] All 21 messages added to en.json
- [ ] Paraglide compilation succeeds
- [ ] All message functions exported in messages.js
- [ ] Storybook renders without errors
- [ ] No TypeScript errors

---

## Phase 2: Verify Existing Components

### Pagination Component ✅

**Location**: `apps/web/src/lib/components/ui/Pagination/`

**Files**:
- `Pagination.svelte` - Main component
- `Pagination.stories.svelte` - Storybook stories
- `index.ts` - Export

**Features**:
- Svelte 5 runes (`$props()`, `$derived()`)
- Ellipsis for large page ranges
- Compact and default variants
- Full i18n support with paraglide
- Accessibility (ARIA labels, keyboard nav)

**Messages Used** (all exist):
- `common_pagination`
- `common_previous`
- `common_next`
- `common_page_x_of_y`
- `common_page_number`

### ContentCard Component ✅

**Location**: `apps/web/src/lib/components/ui/ContentCard/`

**Files**:
- `ContentCard.svelte` - Main component
- `ContentCard.stories.svelte` - Storybook stories
- `index.ts` - Export

**Features**:
- Video, audio, article content types
- Thumbnail with placeholder
- Duration display
- Creator info with avatar
- Loading skeleton state
- Snippet API for actions

**Messages Used** (6 missing - see Phase 1):
- `content_type_video` ❌
- `content_type_audio` ❌
- `content_type_article` ❌
- `content_view` ❌
- `content_thumbnail_alt` ❌
- `content_duration` ❌

### CreatorCard Component ✅

**Location**: `apps/web/src/lib/components/ui/CreatorCard/`

**Files**:
- `CreatorCard.svelte` - Main component
- `CreatorCard.stories.svelte` - Storybook stories
- `index.ts` - Export

**Features**:
- Default and compact variants
- Avatar with fallback
- Bio and content count
- Social media links (website, twitter, youtube, instagram)
- Snippet API for actions

**Messages Used** (6 missing - see Phase 1):
- `creator_content_count` ❌
- `creator_view_profile` ❌
- `creator_visit_website` ❌
- `creator_visit_twitter` ❌
- `creator_visit_youtube` ❌
- `creator_visit_instagram` ❌

---

## Phase 3: Verify Error Boundaries

### Existing Error Boundaries ✅

**Files**:
- `apps/web/src/routes/_creators/[username]/+error.svelte` ✅
- `apps/web/src/routes/_creators/[username]/+error.svelte` ✅
- `apps/web/src/routes/_org/[slug]/+error.svelte` ✅
- `apps/web/src/routes/_org/[slug]/(space)/+error.svelte` ✅
- `apps/web/src/routes/_org/[slug]/(space)/explore/+error.svelte` ✅

**Pattern Used**:
- Svelte 5 `$derived()` for error info based on status
- Icons for different error types (search, lock, warning)
- Design tokens for styling
- Dark mode support
- Accessibility (role="alert", aria-live="polite")

**Messages Used** (may need verification):
- Uses `m.errors_*` pattern - needs to be verified if these exist in en.json
- Falls back to `m.org_error_*` for some buttons

---

## Phase 4: Component Exports

### Barrel Export File

**Location**: `apps/web/src/lib/components/ui/index.ts`

**Current Exports** (verify these are present):
```typescript
export { Pagination } from './Pagination';
export { ContentCard } from './ContentCard';
export { CreatorCard } from './CreatorCard';
```

---

## Phase 5: Testing & Verification

### Storybook Verification

```bash
cd apps/web && pnpm storybook
```

**Stories to Verify**:
- `/ui/pagination--default`
- `/ui/pagination--compact`
- `/ui/pagination--first-page`
- `/ui/pagination--last-page`
- `/ui/contentcard--video-content`
- `/ui/contentcard--audio-content`
- `/ui/contentcard--article-content`
- `/ui/contentcard--loading-state`
- `/ui/creatorcard--default`
- `/ui/creatorcard--compact`

### Type Checking

```bash
pnpm typecheck
```

Expected: No errors related to missing i18n message functions.

### Linting

```bash
pnpm lint
```

Expected: No errors.

---

## Rollback Plan

If issues occur after adding messages:

1. **Revert en.json changes**:
   ```bash
   git checkout apps/web/messages/en.json
   ```

2. **Recompile**:
   ```bash
   cd apps/web && npx @inlang/paraglide-js compile --project project.inlang
   ```

---

## Beads Progress Tracking

```bash
# Close completed tasks
bd close Codex-ghnr --reason="Pagination component complete with i18n"
bd close Codex-6evb --reason="ContentCard and CreatorCard components complete"
bd close Codex-j5tl --reason="i18n messages added and compiled"
bd close Codex-ood8 --reason="Error boundaries verified compliant"

# Sync with main
bd sync --from-main
```

---

## Deep Dive References

### Component Patterns
- **Svelte 5**: `apps/web/src/lib/components/ui/Pagination/Pagination.svelte`
- **Snippets**: `apps/web/src/lib/components/ui/ContentCard/ContentCard.svelte`
- **Derived State**: `apps/web/src/lib/components/ui/CreatorCard/CreatorCard.svelte`

### i18n Setup
- **Messages**: `apps/web/messages/en.json`
- **Runtime**: `apps/web/src/paraglide/runtime.js`
- **Compiled**: `apps/web/src/paraglide/messages.js`
- **Config**: `apps/web/project.inlang/settings.json`

### Error Boundaries
- **Creator Error**: `apps/web/src/routes/_creators/[username]/+error.svelte`
- **Org Error**: `apps/web/src/routes/_org/[slug]/+error.svelte`

---

## File Checklist

| File | Status | Action |
|------|--------|--------|
| `apps/web/messages/en.json` | ⚠️ Incomplete | Add 12 messages |
| `apps/web/src/paraglide/messages.js` | ⚠️ Outdated | Recompile |
| `apps/web/src/lib/components/ui/Pagination/` | ✅ Complete | None |
| `apps/web/src/lib/components/ui/ContentCard/` | ✅ Complete | None |
| `apps/web/src/lib/components/ui/CreatorCard/` | ✅ Complete | None |
| `apps/web/src/routes/_creators/[username]/+error.svelte` | ✅ Complete | None |
| `apps/web/src/lib/components/ui/index.ts` | ⚠️ Verify | Check exports |

---

## Next Steps

1. ✅ Review this plan
2. 🔨 Add missing i18n messages to `apps/web/messages/en.json`
3. 🔨 Run paraglide compile
4. 🔨 Verify Storybook renders correctly
5. 🔨 Run typecheck and lint
6. 🔨 Close completed beads tasks
7. 🔨 Sync with main branch
