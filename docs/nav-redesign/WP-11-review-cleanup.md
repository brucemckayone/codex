# WP-11: Review & Cleanup

## Purpose

Final code review, deprecation of old components, barrel export updates, and verification that nothing was missed. This is the gate before merging.

## Dependencies

- **WP-10** — All verification tests pass

---

## Phase 1: Code Review Checklist

Run the `pr-review-toolkit:code-reviewer` agent on all changed files. Review against these criteria:

### Strict Rules Compliance

- [ ] **Design tokens only** — zero hardcoded px, hex, rgb, or raw values in any new/modified CSS
- [ ] **Svelte 5 patterns** — `$props()`, `$state()`, `$derived()`, `$effect()` used correctly; no Svelte 4 patterns
- [ ] **`$app/state`** not `$app/stores` — `page` from `$app/state`, not `$page`
- [ ] **`Props` interface** — every component has a typed `Props` interface
- [ ] **No `as any`** — all types explicit
- [ ] **ARIA compliance** — every interactive element has appropriate roles/labels
- [ ] **Reduced motion** — all animations use token durations (auto-collapse in `motion.css`)
- [ ] **No console.log** — use `ObservabilityClient` if logging is needed
- [ ] **Scoped styles** — all CSS is `<style>` scoped (no global leak except intentional `:global()`)
- [ ] **i18n** — all user-visible strings use `$paraglide/messages`

### Architecture Compliance

- [ ] **Service registry** — if any API calls are added, they go through `createServerApi`
- [ ] **No hardcoded ports/URLs** — uses `getServiceUrl` from `@codex/constants`
- [ ] **Route paths root-relative** — no slug in URL paths on org subdomains
- [ ] **`buildContentUrl()`** — for any content page links
- [ ] **`buildCreatorsUrl()` / `buildPlatformUrl()`** — for cross-subdomain navigation

### Animation Review

- [ ] **Disney principles visible** — bounce easing on expand, staggered label fade, logo staging
- [ ] **200ms hover delay** — confirmed via JS setTimeout, not CSS
- [ ] **Instant collapse** — no delay on mouse leave
- [ ] **Glass morphism brandable** — uses `color-mix()` from `var(--color-surface)`
- [ ] **View transition** — `sidebar-nav` name on both SidebarRail and StudioSidebar

---

## Phase 2: Silent Failure Hunt

Run the `pr-review-toolkit:silent-failure-hunter` agent on:

- `CommandPaletteSearch.svelte` — search fetch error handling
- `/api/search/+server.ts` — API proxy error handling
- `MobileBottomSheet.svelte` — touch event handling
- Layout files — ensure no catch-and-swallow patterns

---

## Phase 3: Type Design Review

Run the `pr-review-toolkit:type-design-analyzer` agent on new types:

- `RailIcon` union type
- `RailNavLink` interface
- `SearchResult` / `CreatorResult` interfaces in CommandPaletteSearch
- Props interfaces for all new components

---

## Phase 4: Comment Review

Run the `pr-review-toolkit:comment-analyzer` agent on all new files. Verify:

- [ ] Component JSDoc headers are accurate
- [ ] No stale comments referencing old header system
- [ ] Animation comments explain the "why" (Disney principles) not just the "what"

---

## Phase 5: Deprecation & Cleanup

### Files to Deprecate (mark with comment, don't delete yet)

Add this comment to the top of each deprecated file:

```svelte
<!-- @deprecated — Replaced by SidebarRail/MobileBottomNav in nav redesign. Remove after 2026-04-22. -->
```

Files:
- `apps/web/src/lib/components/layout/Header/Header.svelte`
- `apps/web/src/lib/components/layout/Header/OrgHeader.svelte`
- `apps/web/src/lib/components/layout/Header/PlatformHeader.svelte`
- `apps/web/src/lib/components/layout/Header/StudioHeader.svelte`
- `apps/web/src/lib/components/layout/Header/MobileNav.svelte`
- `apps/web/src/lib/components/layout/Header/UserMenu.svelte`

### Update Barrel Exports

**File:** `apps/web/src/lib/components/layout/index.ts`

```typescript
// New sidebar rail
export { SidebarRail } from './SidebarRail';
export { SidebarRailItem } from './SidebarRail';
export { SidebarRailUserSection } from './SidebarRail';

// New mobile nav
export { MobileBottomNav } from './MobileNav';
export { MobileBottomSheet } from './MobileNav';

// Studio sidebar (unchanged)
export { default as StudioSidebar } from './StudioSidebar/StudioSidebar.svelte';
export { default as StudioSwitcher } from './StudioSidebar/StudioSwitcher.svelte';

// Deprecated — remove after 2026-04-22
export { default as Header } from './Header/Header.svelte';
export { default as MobileNav } from './Header/MobileNav.svelte';
export { default as OrgHeader } from './Header/OrgHeader.svelte';
export { default as PlatformHeader } from './Header/PlatformHeader.svelte';
export { default as StudioHeader } from './Header/StudioHeader.svelte';
export { default as UserMenu } from './Header/UserMenu.svelte';
```

### Verify No Remaining Imports

Search the codebase for any remaining imports of deprecated components:

```bash
grep -r "PlatformHeader\|OrgHeader\|MobileNav\|UserMenu\|StudioHeader" \
  apps/web/src/routes/ apps/web/src/lib/ \
  --include="*.svelte" --include="*.ts" \
  | grep -v "Header/" | grep -v "node_modules"
```

Any matches are bugs that need fixing.

### Remove Unused SearchBar Usage

If `SearchBar.svelte` is no longer imported anywhere (replaced by `CommandPaletteSearch`), add the same deprecation comment. But it may still be used in the studio — verify first.

---

## Phase 6: Final Build Check

```bash
pnpm typecheck   # Zero errors
pnpm build        # Successful build
pnpm dev          # No console errors on load
```

---

## Phase 7: Test Coverage Review

Run the `pr-review-toolkit:pr-test-analyzer` agent to identify if any new test files are needed. At minimum:

- [ ] Navigation config exports are importable and correctly typed
- [ ] `isActive()` logic (exact match for `/`, startsWith for others) — unit test
- [ ] Recent searches localStorage logic — unit test if extracted to utility

---

## Acceptance Criteria

- [ ] All review agents pass with no critical issues
- [ ] Deprecated files marked with removal date
- [ ] Barrel exports updated with new + deprecated components
- [ ] No remaining imports of deprecated components in active code
- [ ] `pnpm typecheck` and `pnpm build` pass
- [ ] No console errors in dev
- [ ] PR description drafted with summary of changes
