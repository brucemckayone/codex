# Navigation & Chrome Polish -- Implementation Spec

## Summary

Five small, independent navigation/chrome enhancements that improve wayfinding and page usability across the org public pages and the studio interface. Each enhancement is self-contained with no cross-dependencies, making them parallelizable.

1. **View Toggle (Grid/List)** -- Switch between grid and list layouts on Explore and Library pages, persisted in localStorage.
2. **"View All" Links** -- Add navigation links below each featured section on the org landing page.
3. **Active Nav Indicator** -- Highlight the current page in OrgHeader desktop/mobile nav links.
4. **Breadcrumbs** -- Reusable Breadcrumb component for nested studio pages (Content Edit, Settings > Branding).
5. **Back to Top Button** -- Floating button appears after scrolling, smooth-scrolls to top.

---

## Feasibility

### Pros

- All five items are purely frontend, requiring zero backend or API changes.
- Each is independent -- can be implemented in any order or in parallel.
- StudioSidebar already has a working `isActive()` function and `aria-current="page"` pattern that can be reused for OrgHeader.
- The org landing page already has a "View All" link for Featured Content (`featured__view-all`) pointing to `/explore` -- the pattern is established and just needs extending.
- localStorage for view preference is a proven pattern in this codebase (libraryCollection, progressCollection use `localStorageCollectionOptions`).
- All icon components follow the same `IconBase` + `IconProps` pattern, so adding new icons is straightforward.

### Gotchas & Risks

- **View Toggle + ContentCard**: ContentCard is currently a vertical card (`flex-direction: column` with `aspect-ratio: 16/9` thumbnail). List mode needs a horizontal variant. The cleanest approach is a `data-layout` attribute on the parent grid that ContentCard reads via CSS inheritance -- avoids changing ContentCard's Props interface.
- **Active Nav in OrgHeader**: The current `nav-link` class has no active state styling. Unlike StudioSidebar which uses `page.url.pathname` and an `isActive()` function, OrgHeader gets its links from `getOrgNav()` which returns simple `{href, label}` objects. The page state import (`$app/state`) needs adding to OrgHeader.
- **Breadcrumbs in Studio**: Studio content edit route is `studio/content/[contentId]/edit/+page.svelte`. The content title is available in `data.content.title` for display. Breadcrumb data is page-specific, so each page must pass its own items -- no automatic route-based generation.
- **Back to Top scroll threshold**: Needs to avoid the button appearing on short pages where it adds no value. A threshold of `window.innerHeight * 0.5` (half a viewport) is more robust than a fixed pixel value.
- **MobileNav active state**: The mobile drawer uses the same `NavLink[]` array as the desktop nav but renders differently. Both need the active indicator wired in for consistency.

---

## Design Spec

### 1. View Toggle (Grid/List)

A two-button segmented control that switches the content grid between a card grid layout and a compact list layout.

#### Toggle UI

A pair of icon buttons in a segmented control, placed in the controls bar of Explore and Library pages (right-aligned, next to the sort dropdown).

```svelte
<!-- ViewToggle.svelte -->
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { browser } from '$app/environment';
  import { LayoutGridIcon, LayoutListIcon } from '$lib/components/ui/Icon';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    value?: 'grid' | 'list';
    onchange?: (value: 'grid' | 'list') => void;
  }

  const { value = 'grid', onchange, class: className, ...restProps }: Props = $props();
</script>

<div class="view-toggle {className ?? ''}" role="radiogroup" aria-label="View mode" {...restProps}>
  <button
    class="view-toggle__btn"
    class:active={value === 'grid'}
    onclick={() => onchange?.('grid')}
    aria-checked={value === 'grid'}
    role="radio"
    aria-label="Grid view"
  >
    <LayoutGridIcon size={18} />
  </button>
  <button
    class="view-toggle__btn"
    class:active={value === 'list'}
    onclick={() => onchange?.('list')}
    aria-checked={value === 'list'}
    role="radio"
    aria-label="List view"
  >
    <LayoutListIcon size={18} />
  </button>
</div>
```

#### localStorage Key

```
codex-view-mode
```

Value: `"grid"` or `"list"`. Default when absent: `"grid"`.

Read/write pattern:
```typescript
// In the page component
import { browser } from '$app/environment';

const STORAGE_KEY = 'codex-view-mode';

let viewMode = $state<'grid' | 'list'>(
  browser ? (localStorage.getItem(STORAGE_KEY) as 'grid' | 'list') ?? 'grid' : 'grid'
);

function handleViewChange(mode: 'grid' | 'list') {
  viewMode = mode;
  if (browser) localStorage.setItem(STORAGE_KEY, mode);
}
```

#### List Layout CSS

The list layout uses a single-column grid where each ContentCard renders horizontally. Controlled via a `data-view` attribute on the grid container, with CSS adjusting ContentCard's flex direction:

```css
/* On the grid container */
.content-grid[data-view="list"] {
  grid-template-columns: 1fr;
  gap: var(--space-3);
}

/* ContentCard adapts via parent attribute -- scoped overrides in the page */
.content-grid[data-view="list"] :global(.content-card) {
  flex-direction: row;
}

.content-grid[data-view="list"] :global(.content-card__thumbnail) {
  aspect-ratio: 16 / 9;
  width: 200px;
  min-width: 200px;
  flex-shrink: 0;
}

.content-grid[data-view="list"] :global(.content-card__body) {
  flex: 1;
  min-width: 0;
}

/* Mobile: revert to stacked card in list mode too */
@media (--below-sm) {
  .content-grid[data-view="list"] :global(.content-card) {
    flex-direction: column;
  }

  .content-grid[data-view="list"] :global(.content-card__thumbnail) {
    width: 100%;
    min-width: 0;
  }
}
```

#### Where to Add

- `apps/web/src/routes/_org/[slug]/(space)/explore/+page.svelte` -- in `.explore__controls`, right side, next to sort wrapper
- `apps/web/src/routes/_org/[slug]/(space)/library/+page.svelte` -- in `.sort-bar` row, right side
- `apps/web/src/routes/(platform)/library/+page.svelte` -- in `.sort-bar` row, right side

The `data-view` attribute goes on the grid container element (`.explore__grid`, `.content-grid`).

#### New Icons Required

Two new icons following the existing `IconBase` pattern:

- `LayoutGridIcon.svelte` -- 2x2 grid squares (Lucide `layout-grid`)
- `LayoutListIcon.svelte` -- horizontal lines with thumbnails (Lucide `layout-list`)

---

### 2. "View All" Links

The org landing page currently has a single "View All" link for the Featured Content section (already implemented as `.featured__view-all` linking to `/explore`). This task extends that pattern to any additional featured sections that exist or will be added.

#### Current State

The landing page (`_org/[slug]/(space)/+page.svelte`) already has:
```svelte
<a href="/explore" class="featured__view-all">
  {m.org_view_all_content()} &rarr;
</a>
```

This link uses `--color-interactive` for text and transitions to `--color-interactive-hover` on hover. It includes a right arrow entity (`&rarr;`).

#### What to Add

If additional sections are added to the landing page (e.g., "Latest Videos", "Popular Audio", "Free Content"), each section header should follow the same pattern:

| Section | "View All" href | i18n Key |
|---------|----------------|----------|
| Featured Content | `/explore` | `org_view_all_content` (exists) |
| Latest Videos | `/explore?type=video` | `org_view_all_videos` (new) |
| Popular Audio | `/explore?type=audio` | `org_view_all_audio` (new) |
| Free Content | `/explore?type=&sort=free` | `org_view_all_free` (new) |
| Creators | `/creators` | `org_view_all_creators` (new) |

#### Section Header Pattern

Extract the repeating header pattern into a reusable snippet or keep it inline (since it is only a few lines):

```svelte
<div class="section__header">
  <h2 class="section__title">{sectionTitle}</h2>
  {#if items.length > 0}
    <a href={viewAllHref} class="section__view-all">
      {viewAllLabel} &rarr;
    </a>
  {/if}
</div>
```

The styling already exists in `.featured__header`, `.featured__title`, and `.featured__view-all`. When adding new sections, reuse these classes or create a shared `.section__header` / `.section__view-all` class pair with identical styles.

#### Action Items for Now

Since the landing page currently only has one section (Featured Content) and the "View All" link already exists, the immediate work is:
1. Verify the existing link works correctly (it does -- `href="/explore"` is root-relative, correct for org subdomains).
2. Add i18n keys for future section types to `apps/web/src/paraglide/messages/`.
3. No structural changes needed until additional landing page sections are added.

---

### 3. Active Nav Indicator

Highlight the current page in OrgHeader's desktop nav and MobileNav's drawer links using visual styling and `aria-current="page"`.

#### OrgHeader -- Current State

`OrgHeader.svelte` renders nav links without any active state:
```svelte
{#each navLinks as link}
  <a href={link.href} class="nav-link">{link.label}</a>
{/each}
```

#### OrgHeader -- Target State

Import `page` from `$app/state` (already used in other components) and add an `isActive` helper matching the StudioSidebar pattern:

```svelte
<script lang="ts">
  import { page } from '$app/state';

  // ... existing code ...

  function isActive(href: string): boolean {
    const pathname = page.url.pathname;
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }
</script>

<!-- In the template -->
{#each navLinks as link}
  <a
    href={link.href}
    class="nav-link"
    class:nav-link--active={isActive(link.href)}
    aria-current={isActive(link.href) ? 'page' : undefined}
  >
    {link.label}
  </a>
{/each}
```

#### CSS -- Active Link Style

The active indicator is a bottom border + color change, consistent with the settings tab pattern:

```css
.nav-link--active {
  color: var(--color-text);
  position: relative;
}

.nav-link--active::after {
  content: '';
  position: absolute;
  bottom: calc(-1 * var(--space-4));
  left: 0;
  right: 0;
  height: var(--border-width-thick);
  background-color: var(--color-interactive);
  border-radius: var(--radius-xs);
}
```

The `bottom` offset positions the indicator at the bottom edge of the header (accounting for the header's vertical padding). The exact value depends on the header's padding -- the implementation should measure and adjust to align with the `border-bottom` of `.header`.

#### MobileNav -- Active State

MobileNav receives the same `NavLink[]` and should also indicate the active link. Since MobileNav does not currently import `page`, add it:

```svelte
<script lang="ts">
  import { page } from '$app/state';
  // ... existing code ...

  function isActive(href: string): boolean {
    const pathname = page.url.pathname;
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }
</script>

<!-- In the nav-list -->
{#each links as link}
  <li>
    <a
      href={link.href}
      class="nav-item"
      class:nav-item--active={isActive(link.href)}
      aria-current={isActive(link.href) ? 'page' : undefined}
      onclick={close}
    >
      {link.label}
    </a>
  </li>
{/each}
```

```css
.nav-item--active {
  background-color: var(--color-interactive-subtle);
  color: var(--color-interactive);
}
```

This matches the StudioSidebar `.nav-item.active` pattern exactly.

---

### 4. Breadcrumb Component

A simple, reusable Breadcrumb component for nested pages in the studio interface.

#### Props

```typescript
interface BreadcrumbItem {
  label: string;
  href?: string;  // omit for current/last item
}

interface Props {
  items: BreadcrumbItem[];
  separator?: string;  // default: '/'
}
```

#### Component Location

```
apps/web/src/lib/components/ui/Breadcrumb/
  Breadcrumb.svelte
  index.ts
```

#### Component Implementation

```svelte
<!-- Breadcrumb.svelte -->
<script lang="ts">
  import { ChevronRightIcon } from '$lib/components/ui/Icon';

  interface BreadcrumbItem {
    label: string;
    href?: string;
  }

  interface Props {
    items: BreadcrumbItem[];
  }

  const { items }: Props = $props();
</script>

<nav class="breadcrumb" aria-label="Breadcrumb">
  <ol class="breadcrumb__list">
    {#each items as item, index (index)}
      <li class="breadcrumb__item">
        {#if index > 0}
          <ChevronRightIcon size={14} class="breadcrumb__separator" aria-hidden="true" />
        {/if}
        {#if item.href}
          <a href={item.href} class="breadcrumb__link">{item.label}</a>
        {:else}
          <span class="breadcrumb__current" aria-current="page">{item.label}</span>
        {/if}
      </li>
    {/each}
  </ol>
</nav>

<style>
  .breadcrumb {
    font-size: var(--text-sm);
  }

  .breadcrumb__list {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    list-style: none;
    padding: 0;
    margin: 0;
    flex-wrap: wrap;
  }

  .breadcrumb__item {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  :global(.breadcrumb__separator) {
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .breadcrumb__link {
    color: var(--color-text-secondary);
    text-decoration: none;
    font-weight: var(--font-medium);
    transition: var(--transition-colors);
  }

  .breadcrumb__link:hover {
    color: var(--color-interactive);
  }

  .breadcrumb__link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  .breadcrumb__current {
    color: var(--color-text);
    font-weight: var(--font-medium);
  }
</style>
```

#### Barrel Export

```typescript
// index.ts
export { default as Breadcrumb } from './Breadcrumb.svelte';
export type { BreadcrumbItem } from './Breadcrumb.svelte';
```

Also add to `apps/web/src/lib/components/ui/index.ts`:
```typescript
export { Breadcrumb } from './Breadcrumb/index';
```

#### Usage in Studio Pages

**Content Edit** (`studio/content/[contentId]/edit/+page.svelte`):
```svelte
<script lang="ts">
  import { Breadcrumb } from '$lib/components/ui';
  // ... existing code ...

  const breadcrumbs = $derived([
    { label: 'Content', href: '/studio/content' },
    { label: data.content.title },
  ]);
</script>

<Breadcrumb items={breadcrumbs} />
```

**Content New** (`studio/content/new/+page.svelte`):
```svelte
const breadcrumbs = [
  { label: 'Content', href: '/studio/content' },
  { label: 'New Content' },
];
```

**Settings > Branding** -- not needed because the Settings layout already has a tabbed navigation that clearly shows the current sub-page. Breadcrumbs would be redundant here.

**Settings layout itself** could optionally show breadcrumbs above the title:
```svelte
const breadcrumbs = [
  { label: 'Studio', href: '/studio' },
  { label: 'Settings' },
];
```

#### Accessibility

- Uses `<nav aria-label="Breadcrumb">` for landmark discovery.
- Uses `<ol>` for ordered list semantics.
- Last item has `aria-current="page"`.
- Chevron separators are `aria-hidden="true"`.
- Links have `:focus-visible` outlines.

---

### 5. Back to Top Button

A floating button that appears when the user scrolls past a threshold, and smooth-scrolls to the top of the page when clicked.

#### Component Location

```
apps/web/src/lib/components/ui/BackToTop/
  BackToTop.svelte
  index.ts
```

#### Component Implementation

```svelte
<!-- BackToTop.svelte -->
<script lang="ts">
  import { browser } from '$app/environment';
  import { ChevronUpIcon } from '$lib/components/ui/Icon';

  interface Props {
    threshold?: number;  // scroll distance in vh units before showing (default: 50)
  }

  const { threshold = 50 }: Props = $props();

  let visible = $state(false);

  function handleScroll() {
    const thresholdPx = (threshold / 100) * window.innerHeight;
    visible = window.scrollY > thresholdPx;
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
</script>

<svelte:window onscroll={handleScroll} />

{#if visible}
  <button
    class="back-to-top"
    onclick={scrollToTop}
    aria-label="Back to top"
    title="Back to top"
  >
    <ChevronUpIcon size={20} />
  </button>
{/if}

<style>
  .back-to-top {
    position: fixed;
    bottom: var(--space-6);
    right: var(--space-6);
    z-index: var(--z-sticky);
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-10);
    height: var(--space-10);
    border-radius: var(--radius-full);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    color: var(--color-text-secondary);
    box-shadow: var(--shadow-md);
    cursor: pointer;
    transition: var(--transition-colors), var(--transition-shadow),
      opacity var(--duration-normal) var(--ease-default);
    opacity: 0;
    animation: fade-in var(--duration-normal) var(--ease-default) forwards;
  }

  .back-to-top:hover {
    color: var(--color-text);
    border-color: var(--color-border-hover);
    box-shadow: var(--shadow-lg);
  }

  .back-to-top:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .back-to-top:active {
    transform: scale(0.95);
  }

  @keyframes fade-in {
    from {
      opacity: 0;
      transform: translateY(var(--space-2));
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* On mobile, push left slightly to avoid thumb zone conflicts */
  @media (--below-sm) {
    .back-to-top {
      bottom: var(--space-4);
      right: var(--space-4);
    }
  }
</style>
```

#### New Icon Required

- `ChevronUpIcon.svelte` -- upward-pointing chevron, matching the existing `ChevronDownIcon` pattern:

```svelte
<script lang="ts">
  import type { IconProps } from './types';
  import IconBase from './IconBase.svelte';
  const { size, ...restProps }: IconProps = $props();
</script>

<IconBase {size} {...restProps}>
  <polyline points="18 15 12 9 6 15" />
</IconBase>
```

#### Scroll Threshold

Default: `50` (vh). The button appears once the user has scrolled past half a viewport height. Using a viewport-relative threshold rather than a fixed pixel value ensures sensible behavior across screen sizes.

#### Position

- Fixed position, bottom-right corner.
- `bottom: var(--space-6)` / `right: var(--space-6)` on desktop.
- `bottom: var(--space-4)` / `right: var(--space-4)` on mobile.
- `z-index: var(--z-sticky)` -- same layer as the sticky header.

#### Animation

- Fade in with a subtle upward slide on appear (CSS `@keyframes fade-in`).
- Svelte `{#if visible}` handles mount/unmount. The animation plays on mount; unmount is instant (acceptable since the user is scrolling up and the button leaves the viewport naturally).

#### Accessibility

- `aria-label="Back to top"` for screen reader context.
- `title="Back to top"` for tooltip.
- `:focus-visible` outline for keyboard users.
- Smooth scroll via `behavior: 'smooth'` which respects `prefers-reduced-motion` at the OS level (browsers that support `scroll-behavior` also respect the motion preference).

#### Where to Place

Add `<BackToTop />` to:
- `apps/web/src/routes/_org/[slug]/(space)/explore/+page.svelte` -- long content listing.
- `apps/web/src/routes/(platform)/library/+page.svelte` -- long library listing.
- `apps/web/src/routes/_org/[slug]/(space)/library/+page.svelte` -- org library.

Do NOT add to studio pages (they have their own sidebar scroll context) or the org landing page (it is typically short).

---

## Implementation Plan

### Files to Create

| File | Purpose |
|------|---------|
| `apps/web/src/lib/components/ui/ViewToggle/ViewToggle.svelte` | Grid/list segmented control |
| `apps/web/src/lib/components/ui/ViewToggle/index.ts` | Barrel export |
| `apps/web/src/lib/components/ui/Breadcrumb/Breadcrumb.svelte` | Breadcrumb navigation |
| `apps/web/src/lib/components/ui/Breadcrumb/index.ts` | Barrel export |
| `apps/web/src/lib/components/ui/BackToTop/BackToTop.svelte` | Floating back-to-top button |
| `apps/web/src/lib/components/ui/BackToTop/index.ts` | Barrel export |
| `apps/web/src/lib/components/ui/Icon/LayoutGridIcon.svelte` | Grid view icon |
| `apps/web/src/lib/components/ui/Icon/LayoutListIcon.svelte` | List view icon |
| `apps/web/src/lib/components/ui/Icon/ChevronUpIcon.svelte` | Up chevron icon |

### Files to Modify

| File | Change |
|------|--------|
| `apps/web/src/lib/components/ui/index.ts` | Add exports for `ViewToggle`, `Breadcrumb`, `BackToTop` |
| `apps/web/src/lib/components/ui/Icon/index.ts` | Add exports for `LayoutGridIcon`, `LayoutListIcon`, `ChevronUpIcon` |
| `apps/web/src/lib/components/layout/Header/OrgHeader.svelte` | Import `page` from `$app/state`, add `isActive()` helper, add `nav-link--active` class + `aria-current`, add active state CSS |
| `apps/web/src/lib/components/layout/Header/MobileNav.svelte` | Import `page` from `$app/state`, add `isActive()` helper, add `nav-item--active` class + `aria-current`, add active state CSS |
| `apps/web/src/routes/_org/[slug]/(space)/explore/+page.svelte` | Add ViewToggle to controls, add `data-view` attribute to grid, add list mode CSS overrides, add BackToTop |
| `apps/web/src/routes/_org/[slug]/(space)/library/+page.svelte` | Add ViewToggle next to sort bar, add `data-view` attribute to grid, add list mode CSS overrides, add BackToTop |
| `apps/web/src/routes/(platform)/library/+page.svelte` | Add ViewToggle next to sort bar, add `data-view` attribute to grid, add list mode CSS overrides, add BackToTop |
| `apps/web/src/routes/_org/[slug]/studio/content/[contentId]/edit/+page.svelte` | Add Breadcrumb above ContentForm |
| `apps/web/src/routes/_org/[slug]/studio/content/new/+page.svelte` | Add Breadcrumb above ContentForm |

---

## Testing Notes

### View Toggle
- Verify grid/list toggle switches the layout visually on Explore and both Library pages.
- Verify `localStorage.getItem('codex-view-mode')` persists across page reloads.
- Verify default is `grid` when no localStorage value exists.
- Verify list mode reverts to stacked cards below `--breakpoint-sm`.
- Verify ContentCard thumbnails maintain correct aspect ratio in list mode.

### "View All" Links
- Verify the existing "View All" link on the org landing page navigates to `/explore` (already working).
- If new sections are added, verify each "View All" link includes the correct query params (e.g., `?type=video`).

### Active Nav Indicator
- Navigate to `/explore` on an org subdomain -- "Explore" link should show the active indicator.
- Navigate to `/library` -- "Library" link should show active.
- Navigate to `/` (org root) -- no nav link should show active (since `/` is not in the org nav links).
- Verify `aria-current="page"` is present on the active link and absent on others.
- Open the mobile drawer and verify the active link has the highlighted background (`--color-interactive-subtle`).
- Verify the StudioSidebar active states are not affected (they are independent).

### Breadcrumbs
- Navigate to `/studio/content/{id}/edit` -- breadcrumbs should show "Content > {content title}".
- Click "Content" in breadcrumbs -- should navigate to `/studio/content`.
- Navigate to `/studio/content/new` -- breadcrumbs should show "Content > New Content".
- Verify `aria-current="page"` is on the last (current) breadcrumb item.
- Verify screen reader announces "Breadcrumb" navigation landmark.

### Back to Top
- Scroll past half the viewport on Explore page -- button should fade in.
- Click the button -- page should smooth-scroll to top and button should disappear.
- Scroll slowly -- button should appear/disappear at exactly the threshold.
- Verify keyboard focus (`Tab` to the button, `Enter` to activate).
- Verify the button does not appear on studio pages.
- Verify the button does not overlap with the mobile nav hamburger or other fixed elements.
- Verify `prefers-reduced-motion: reduce` is respected by the smooth scroll (browser handles this natively).
