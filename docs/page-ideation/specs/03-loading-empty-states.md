# Loading & Empty States -- Implementation Spec

## Summary

Two UX polish items to improve perceived performance and user guidance across all content listing pages:

1. **Skeleton loading states** -- Add skeleton placeholders to content grids so users see structured placeholders instead of blank space during data loads. The `Skeleton` component exists but is only used inside `ContentCard` (its `loading` prop) and in one ad-hoc implementation on the platform library page. No page currently uses structured skeleton grids as a loading state.

2. **Empty state improvements** -- Audit and improve all `EmptyState` usage across the app. Several pages lack icons, descriptions, or action buttons. Some use hardcoded English strings instead of i18n messages. The `EmptyState` component is well-built but underused.

---

## Feasibility

### Pros

- **Skeleton component already exists** with shimmer animation, arbitrary width/height, and circle variant support. Stories demonstrate card, list, and paragraph patterns.
- **ContentCard already has a `loading` prop** that renders skeleton internally -- this can be leveraged directly for content grids.
- **EmptyState component is complete** with icon, title, description, and action snippet support. No changes needed to the component itself.
- **All pages already import EmptyState** -- this is mostly about enriching what is passed to the component (adding icons, descriptions, action buttons where missing).
- **Consistent grid CSS exists** across all pages (1 col / 2 col at `--breakpoint-sm` / 3 col at `--breakpoint-lg`) -- skeleton grids can reuse the same layout.

### Gotchas & Risks

- **SvelteKit SSR data loading** means most pages receive data synchronously from `+page.server.ts`. There is no client-side loading state for server-loaded pages -- the skeleton would only flash during SvelteKit navigation. Skeleton states are most valuable for pages using `useLiveQuery` with async hydration (e.g., platform library page).
- **ContentCard `loading` prop already renders Skeleton** -- using `<ContentCard loading />` is the simplest path for content grids, but it requires passing dummy id/title props. A dedicated `SkeletonContentCard` wrapper avoids this.
- **CreatorCard has no `loading` prop** -- the creators page needs a skeleton pattern built from raw `Skeleton` components to match `CreatorCard` dimensions.
- **Platform library page already has ad-hoc skeleton CSS** (`.skeleton-card`, `.skeleton-thumb`, `.skeleton-line`) that does not use the `Skeleton` component. This should be migrated to use the shared component for consistency.
- **i18n message keys** will need to be added for new empty state descriptions and action button labels that do not already have message keys.

---

## Current State

### Skeleton Loading Audit

| Page | Has Skeleton? | Method | Notes |
|------|--------------|--------|-------|
| `(platform)/library` | Yes (ad-hoc) | Hand-rolled `.skeleton-card` divs with custom CSS pulse animation | Shows 6 skeleton cards when `libraryQuery.isLoading && !data.library?.items?.length`. Does NOT use the `Skeleton` component. |
| `_org/[slug]/(space)/explore` | No | -- | Jumps straight from empty to content grid. No loading state. |
| `_org/[slug]/(space)/creators` | No | -- | Jumps straight from empty to creator grid. No loading state. |
| `_org/[slug]/studio/content` | No | -- | Server-loaded table, no loading transition. |
| `_org/[slug]/studio/customers` | No | -- | Server-loaded table, no loading transition. |
| `(platform)/discover` | No | -- | No loading state at all. |
| `_org/[slug]/(space)/library` | No | -- | No loading state. |
| `_creators/[username]` | No | -- | No loading state for content grid section. |
| `_creators/[username]/content` | No | -- | No loading state. |

### Empty State Audit

| Page | Uses EmptyState? | Has Icon? | Has Description? | Has Action? | i18n? | Notes |
|------|-----------------|-----------|-----------------|-------------|-------|-------|
| `(platform)/library` | Yes | No | No | Yes (`/discover` link) | Yes | Missing icon. Missing description explaining what the library is. |
| `(platform)/library` (filtered) | No | -- | -- | Yes (clear filters btn) | Yes | Uses custom `.no-results` div instead of EmptyState. |
| `(platform)/discover` | Yes | No | No | No | Partial | No icon, no description, no action. Search empty uses i18n but base empty does too. |
| `_org/[slug]/(space)/explore` (filtered) | Yes | Yes (`SearchXIcon`) | No | Yes (clear filters btn) | Yes | Good. Could add a description. |
| `_org/[slug]/(space)/explore` (no content) | Yes | Yes (`FileIcon`) | No | No | Yes | Missing description and action. |
| `_org/[slug]/(space)/creators` | Yes | Yes (`UsersIcon`) | No | No | Yes | Missing description. |
| `_org/[slug]/(space)/library` | Yes | No | No | Yes (`/explore` link) | No | Hardcoded English strings. Missing icon. |
| `_org/[slug]/studio/content` | Yes | Yes (`FileIcon`) | No | Yes (create link) | Yes | Good. Could add description. |
| `_org/[slug]/studio/customers` | Yes | Yes (`UsersIcon`) | No | No | Yes | Missing description and action. |
| `_org/[slug]/studio/billing` (top content) | Yes | No | No | No | Yes | Missing icon and description. |
| `_creators/[username]` (content) | Yes | Yes (`FileIcon`) | No | No | Yes | Missing description. |
| `_creators/[username]/content` (filtered) | Yes | Yes (`SearchIcon`) | No | Yes (clear link) | Yes | Good. |
| `_creators/[username]/content` (empty) | Yes | Yes (`FileIcon`) | No | No | Yes | Missing description. |
| `_creators/studio/content` | Yes | Yes (`FileIcon`) | No | Yes (create link) | Yes | Good. Identical to org studio content. |
| `(platform)/account/payment` | Yes | No | No | Yes (`/discover` link) | Yes | Missing icon and description. |

---

## Design Spec

### 1. Skeleton Grid Pattern

Create a reusable pattern for showing skeleton cards in the standard content grid layout. Since most pages use the same 1/2/3 column responsive grid, the skeleton grid should match.

**Card count**: 6 skeleton cards (fills a 3-column grid with 2 rows, a 2-column grid with 3 rows). This matches the existing ad-hoc implementation in the platform library page.

**Grid CSS**: Reuse each page's existing `.content-grid` / `.explore__grid` / `.creators__grid` class. The skeleton cards are simply rendered inside the same grid container.

**Animation**: Use the `Skeleton` component's built-in shimmer animation (not the custom `pulse` keyframes in the library page). The shimmer effect is more polished and consistent with the component library.

### 2. SkeletonContentCard Component

Create a thin wrapper that renders a skeleton matching `ContentCard` dimensions. This avoids needing to pass dummy props to `<ContentCard loading />` and provides a clean, self-contained skeleton unit.

**Path**: `apps/web/src/lib/components/ui/ContentCard/SkeletonContentCard.svelte`

**Structure** (matches ContentCard layout):
```
+----------------------------------+
| [Skeleton: 100% x aspect 16/9]  |  <- thumbnail area
+----------------------------------+
| [Skeleton: 75% x 1.25rem]       |  <- title
| [Skeleton: 50% x 1rem]          |  <- description line
| [Skeleton: 60% x 1rem]          |  <- creator/meta line
+----------------------------------+
```

**Props**: None required. Optionally accept `class` for grid item styling.

**Implementation**: Uses the existing `Skeleton` component, wrapped in a container that matches `ContentCard`'s border, radius, and padding tokens:

```svelte
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { Skeleton } from '../Skeleton';

  interface Props extends HTMLAttributes<HTMLDivElement> {}

  const { class: className, ...restProps }: Props = $props();
</script>

<article class="skeleton-card {className ?? ''}" aria-hidden="true" {...restProps}>
  <div class="skeleton-card__thumbnail">
    <Skeleton width="100%" height="100%" />
  </div>
  <div class="skeleton-card__body">
    <Skeleton width="75%" height="1.25rem" />
    <Skeleton width="50%" height="1rem" />
    <Skeleton width="60%" height="1rem" />
  </div>
</article>

<style>
  .skeleton-card {
    display: flex;
    flex-direction: column;
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .skeleton-card__thumbnail {
    aspect-ratio: 16 / 9;
  }

  .skeleton-card__body {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
</style>
```

**Export**: Add to `apps/web/src/lib/components/ui/ContentCard/index.ts`.

### 3. SkeletonCreatorCard Component

Create a skeleton matching `CreatorCard` dimensions for the creators grid.

**Path**: `apps/web/src/lib/components/ui/CreatorCard/SkeletonCreatorCard.svelte`

**Structure** (matches CreatorCard default variant):
```
+----------------------------------+
| [Circle 48px]  [Skeleton: 60%]  |  <- avatar + name
|                [Skeleton: 40%]  |  <- content count
+----------------------------------+
```

**Implementation**: Uses `Skeleton` with `skeleton-circle` class for the avatar, text skeletons for name/count, wrapped in CreatorCard's container styles.

### 4. Empty State Improvements

Improve every `EmptyState` usage to include: an appropriate icon, a helpful description, and an action button where a next step exists.

**Per-page specifications**:

| Page | Icon | Title (i18n key) | Description (i18n key, NEW) | Action | Action Label (i18n key) |
|------|------|------|------|------|------|
| `(platform)/library` (empty) | `ShoppingBagIcon` | `library_empty` (existing) | `library_empty_description` (NEW): "Content you purchase will appear here." | Link to `/discover` | `library_browse` (existing) |
| `(platform)/library` (filtered, no results) | Migrate to `EmptyState` with `SearchXIcon` | `library_no_results` (existing) | -- | Clear filters button | `library_clear_filters` (existing) |
| `(platform)/discover` (empty) | `SearchMinusIcon` | `discover_empty` (existing) | `discover_empty_description` (NEW): "Try a different search or browse all content." | Link to `/discover` (clear search) | `discover_clear_search` (NEW): "Clear search" |
| `(platform)/discover` (search, no results) | `SearchXIcon` | `discover_empty_search` (existing) | `discover_empty_search_description` (NEW): "No content matched your search. Try different keywords." | Button to clear search | `discover_clear_search` (NEW) |
| `_org/[slug]/(space)/explore` (no content) | `FileIcon` (existing) | `explore_no_content` (existing) | `explore_no_content_description` (NEW): "This organization hasn't published any content yet. Check back soon." | -- | -- |
| `_org/[slug]/(space)/explore` (filtered) | `SearchXIcon` (existing) | `explore_no_results` (existing) | -- (OK as-is, action is clear) | Clear filters (existing) | `explore_clear_filters` (existing) |
| `_org/[slug]/(space)/creators` | `UsersIcon` (existing) | `org_creators_empty` (existing) | `org_creators_empty_description` (NEW): "No creators have joined this organization yet." | -- | -- |
| `_org/[slug]/(space)/library` | `ShoppingBagIcon` | Migrate to i18n `org_library_empty` (NEW): "No purchases yet" | `org_library_empty_description` (NEW): "Content you purchase from {orgName} will appear here." | Link to `/explore` | `org_library_browse` (NEW): "Browse Content" |
| `_org/[slug]/studio/content` | `FileIcon` (existing) | `studio_content_empty` (existing) | `studio_content_empty_description` (NEW): "Create your first piece of content to get started." | Create link (existing) | `studio_content_create` (existing) |
| `_org/[slug]/studio/customers` | `UsersIcon` (existing) | `studio_customers_empty` (existing) | `studio_customers_empty_description` (NEW): "Customers will appear here once they make a purchase." | -- | -- |
| `_org/[slug]/studio/billing` (top content) | `TrendingUpIcon` | `billing_top_content_empty` (existing) | `billing_top_content_empty_description` (NEW): "Revenue data will appear here once you make your first sale." | -- | -- |
| `_creators/[username]` (no content) | `FileIcon` (existing) | `creator_profile_no_content` (existing) | `creator_profile_no_content_description` (NEW): "This creator hasn't published any content yet." | -- | -- |
| `_creators/[username]/content` (empty) | `FileIcon` (existing) | `creator_content_empty` (existing) | `creator_content_empty_description` (NEW): "This creator hasn't published any content yet." | -- | -- |
| `(platform)/account/payment` (no history) | `CreditCardIcon` | `account_payments_none_history` (existing) | `account_payments_empty_description` (NEW): "Your purchase history will appear here." | Link to `/discover` (existing) | `account_payments_discover_link` (existing) |

---

## Implementation Plan

### Files to Create

| File | Purpose |
|------|---------|
| `apps/web/src/lib/components/ui/ContentCard/SkeletonContentCard.svelte` | Skeleton card matching ContentCard dimensions |
| `apps/web/src/lib/components/ui/CreatorCard/SkeletonCreatorCard.svelte` | Skeleton card matching CreatorCard dimensions |

### Files to Modify

#### 1. Component Exports

**`apps/web/src/lib/components/ui/ContentCard/index.ts`**
- Add `export { default as SkeletonContentCard } from './SkeletonContentCard.svelte';`

**`apps/web/src/lib/components/ui/CreatorCard/index.ts`**
- Add `export { default as SkeletonCreatorCard } from './SkeletonCreatorCard.svelte';`

#### 2. i18n Messages

**`apps/web/src/paraglide/messages/en.json`** (or equivalent message source)
- Add all NEW description keys listed in the empty state table above (approximately 14 new message keys).

#### 3. Page Modifications -- Skeleton Loading

**`apps/web/src/routes/(platform)/library/+page.svelte`**
- Replace ad-hoc `.skeleton-card` divs (lines 143-151) with 6x `<SkeletonContentCard />` inside the existing `.content-grid` container.
- Remove `.skeleton-card`, `.skeleton-thumb`, `.skeleton-line`, `.skeleton-line-title`, `.skeleton-line-subtitle`, and `@keyframes pulse` CSS (lines 384-418).

**`apps/web/src/routes/_org/[slug]/(space)/explore/+page.svelte`**
- No client-side loading state needed (server-loaded via `+page.server.ts`). The data arrives with the page. Skeleton would only be visible during SvelteKit client-side navigation, which is very brief. **Skip skeleton for this page** unless a future change adds client-side data fetching.

**`apps/web/src/routes/_org/[slug]/(space)/creators/+page.svelte`**
- Same as explore -- server-loaded, no meaningful loading window. **Skip skeleton.**

**`apps/web/src/routes/_org/[slug]/studio/content/+page.svelte`**
- Server-loaded table page. **Skip skeleton** (table skeletons are a separate concern and the ContentTable component would need its own loading state).

**`apps/web/src/routes/(platform)/discover/+page.svelte`**
- No client-side loading currently. **Skip skeleton.** If the page is later migrated to use a TanStack DB collection with `useLiveQuery`, add skeleton at that time.

**`apps/web/src/routes/_org/[slug]/(space)/library/+page.svelte`**
- No `useLiveQuery` usage (server-loaded). **Skip skeleton.**

**`apps/web/src/routes/_creators/[username]/+page.svelte`**
- Server-loaded. **Skip skeleton.**

**`apps/web/src/routes/_creators/[username]/content/+page.svelte`**
- Server-loaded. **Skip skeleton.**

**Summary**: Only the `(platform)/library` page currently has a meaningful client-side loading window (via `useLiveQuery`). That is the only page that gets skeleton loading in this iteration. The skeleton components (`SkeletonContentCard`, `SkeletonCreatorCard`) are created as reusable building blocks for when other pages adopt client-side data fetching.

#### 4. Page Modifications -- Empty State Improvements

**`apps/web/src/routes/(platform)/library/+page.svelte`**
- Line 153: Add `icon={ShoppingBagIcon}` and `description={m.library_empty_description()}` to the EmptyState.
- Lines 182-193: Replace the `.no-results` div with an `EmptyState` component using `icon={SearchXIcon}`, `title={m.library_no_results()}`, and a clear filters action snippet.
- Add imports: `ShoppingBagIcon`, `SearchXIcon` from `$lib/components/ui/Icon`.
- Remove `.no-results` and `.no-results-text` CSS rules (replaced by EmptyState's built-in styling).

**`apps/web/src/routes/(platform)/discover/+page.svelte`**
- Line 82: Split the EmptyState into two branches:
  - When `data.search` is set: `icon={SearchXIcon}`, existing title, add `description={m.discover_empty_search_description()}`, add action to clear search.
  - When no search: `icon={SearchMinusIcon}`, existing title, add `description={m.discover_empty_description()}`.
- Add imports: `SearchXIcon`, `SearchMinusIcon` from `$lib/components/ui/Icon`.

**`apps/web/src/routes/_org/[slug]/(space)/explore/+page.svelte`**
- Line 198 (no content at all): Add `description={m.explore_no_content_description()}`.

**`apps/web/src/routes/_org/[slug]/(space)/creators/+page.svelte`**
- Line 75: Add `description={m.org_creators_empty_description()}`.

**`apps/web/src/routes/_org/[slug]/(space)/library/+page.svelte`**
- Line 123: Replace hardcoded string `"You haven't purchased any content from {orgName} yet."` with i18n `m.org_library_empty()`. Add `icon={ShoppingBagIcon}`, `description={m.org_library_empty_description({ orgName })}`.
- Replace `"Browse Content"` with `m.org_library_browse()`.
- Add import: `ShoppingBagIcon` from `$lib/components/ui/Icon`.

**`apps/web/src/routes/_org/[slug]/studio/content/+page.svelte`**
- Line 55: Add `description={m.studio_content_empty_description()}`.

**`apps/web/src/routes/_org/[slug]/studio/customers/+page.svelte`**
- Line 55: Add `description={m.studio_customers_empty_description()}`.

**`apps/web/src/routes/_org/[slug]/studio/billing/+page.svelte`**
- Line 123: Add `icon={TrendingUpIcon}`, `description={m.billing_top_content_empty_description()}`.
- Add import: `TrendingUpIcon` from `$lib/components/ui/Icon`.

**`apps/web/src/routes/_creators/[username]/+page.svelte`**
- Line 171: Add `description={m.creator_profile_no_content_description()}`.

**`apps/web/src/routes/_creators/[username]/content/+page.svelte`**
- Line 162: Add `description={m.creator_content_empty_description()}`.

**`apps/web/src/routes/(platform)/account/payment/+page.svelte`**
- Line 215: Add `icon={CreditCardIcon}`, `description={m.account_payments_empty_description()}`.
- Add import: `CreditCardIcon` from `$lib/components/ui/Icon`.

---

## Testing Notes

- **Visual verification**: Each modified page should be checked in two states: (a) with data present, (b) with empty data. For pages with filters, also check the "no results after filtering" state.
- **Skeleton shimmer**: Verify the `Skeleton` shimmer animation renders correctly inside the card containers (check that `overflow: hidden` on the card clips the shimmer correctly).
- **Platform library skeleton**: The skeleton loading state is only visible when the `useLiveQuery` is loading and no SSR data exists. To test: clear localStorage (removes cached library data), navigate to `/library`. The skeleton grid should appear briefly before data loads.
- **i18n completeness**: Verify all new message keys are added to all language files (currently English only, but the keys must exist).
- **Responsive layout**: Skeleton grids should match the real content grids at all breakpoints (1 column on mobile, 2 on `--breakpoint-sm`, 3 on `--breakpoint-lg`).
- **EmptyState consistency**: After changes, every EmptyState should have at minimum an icon and a title. Description is strongly preferred. Action buttons should be present wherever a logical next step exists.
- **Accessibility**: Skeleton containers should have `aria-hidden="true"` since they are decorative loading indicators. EmptyState actions should be keyboard-navigable (already handled by the component).
- **Dark mode**: Verify skeleton `--color-surface-tertiary` token renders appropriately in both light and dark themes.
