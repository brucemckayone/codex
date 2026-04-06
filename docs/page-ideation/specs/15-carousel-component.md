# Horizontal Carousel Component -- Implementation Spec

## Summary

A reusable `Carousel` component that renders a horizontal scrollable row of items with CSS scroll-snap, navigation arrows, touch/swipe support, keyboard accessibility, and responsive item sizing. This replaces ad-hoc horizontal scroll patterns in the codebase (the `ContinueWatching` component being the primary precedent) with a single, configurable primitive.

The component accepts items via a Svelte 5 snippet prop (`renderItem`), making it agnostic to what it displays -- ContentCards, ContinueWatchingCards, CreatorCards, or any future card type.

**Scope ID**: 1.36 (from feasibility classification)

---

## Feasibility

### Pros

- **CSS scroll-snap does the heavy lifting.** No JS scroll library needed. `scroll-snap-type: x mandatory` + `scroll-snap-align: start` on children gives card-aligned snapping with native momentum on touch devices. All target browsers (Chrome 69+, Firefox 68+, Safari 11+) support it.
- **Proven pattern already in the codebase.** `ContinueWatching.svelte` already uses `overflow-x: auto` + `scroll-snap-type: x mandatory` + `-webkit-overflow-scrolling: touch`. The new component generalizes this into a reusable API.
- **No new dependencies.** Scroll position detection, arrow visibility, and keyboard navigation are all achievable with a single `scroll` event listener and `scrollLeft` / `scrollWidth` / `clientWidth` arithmetic. No Intersection Observer needed for the arrows.
- **Design tokens cover every CSS value.** Spacing (`--space-*`), borders (`--border-*`), radii (`--radius-*`), shadows (`--shadow-*`), transitions (`--transition-*`, `--duration-*`), z-index (`--z-*`), and breakpoints (`--breakpoint-sm/md/lg/xl`) are all defined. No hardcoded values required.
- **`prefers-reduced-motion` is already handled globally.** The `motion.css` token file sets all `--duration-*` tokens to `0.01ms` under `prefers-reduced-motion: reduce`, and applies `transition-duration: 0.01ms !important` to all elements. Smooth-scroll behavior inherits this automatically when driven by CSS transitions. For the JS `scrollTo({ behavior: 'smooth' })` calls, a runtime `matchMedia` check is needed.

### Gotchas & Risks

- **Scroll snap behavior varies across browsers.** Safari handles scroll-snap deceleration differently from Chrome -- items can "overshoot" the snap point on fast swipes. Mitigation: use `scroll-snap-type: x mandatory` (not `proximity`) so snapping is enforced, and use `scroll-padding` on the container to ensure visible alignment.
- **Arrow visibility requires scroll position polling.** The `scroll` event fires frequently during touch scrolling. Mitigation: use a passive `scroll` listener (the browser default for touch) and update arrow visibility via reactive state. Debouncing is unnecessary -- the computation is trivial (three property reads and two comparisons).
- **`scrollTo` smooth behavior and reduced motion.** The global `motion.css` overrides `transition-duration` on all elements, but `Element.scrollTo({ behavior: 'smooth' })` is a browser-native animation not governed by CSS transitions. The arrow click handler must check `window.matchMedia('(prefers-reduced-motion: reduce)').matches` and use `behavior: 'instant'` when the user prefers reduced motion.
- **Keyboard focus management.** When a user arrow-key-navigates, the scroll container must scroll to reveal the focused child. CSS `scroll-snap-align` handles this for mouse wheel / touch, but keyboard focus does not trigger snap. The component needs a `focusin` listener to `scrollIntoView({ block: 'nearest', inline: 'nearest' })` the focused child.
- **Container query vs media query for responsive item count.** Media queries base the item count on viewport width, not container width. If the carousel is placed in a sidebar or narrow column, media queries would show too many items. For now, media queries are sufficient since all planned usage sites are full-width or near-full-width. If container queries are needed later, the `itemMinWidth` prop already provides a natural breakpoint via CSS `min-width` + flex-shrink.
- **RTL (right-to-left) layouts.** The arrows and scroll direction reverse in RTL. CSS `overflow-x` handles RTL automatically (scrollLeft is negative in RTL in some browsers). This spec does not add RTL support but the design avoids hardcoded `left`/`right` in JS where possible, making future RTL work easier.

---

## Current State

### Existing Horizontal Scroll Patterns

**`ContinueWatching.svelte`** (`apps/web/src/lib/components/library/ContinueWatching.svelte`):
- Uses `overflow-x: auto`, `scroll-snap-type: x mandatory`, `-webkit-overflow-scrolling: touch`.
- Cards use `scroll-snap-align: start`, `min-width: 220px`, `max-width: 300px`, `flex-shrink: 0`.
- Custom thin scrollbar styling (`::-webkit-scrollbar`).
- Breaks out of scroll mode at `--breakpoint-sm` (sets `overflow-x: visible`, `scroll-snap-type: none`).
- No navigation arrows, no keyboard support, no "View All" link.
- Hardcoded to 4 items max, only for library progress items.

**Explore page filter pills** (`apps/web/src/routes/_org/[slug]/(space)/explore/+page.svelte`):
- Uses `overflow-x: auto` on the filter group container.
- No scroll snap, no arrows.

**Table containers** (CustomerTable, ContentTable, MemberTable, TopContentTable):
- Use `overflow-x: auto` for horizontal table scroll.
- Not relevant to the carousel pattern.

### What the Carousel Replaces

Once implemented, `ContinueWatching.svelte` should be refactored to use `Carousel` internally, replacing its hand-rolled scroll CSS with the standard component. This refactor is out of scope for this spec but is the natural follow-up.

---

## Design Spec

### Props Interface

```typescript
interface CarouselProps extends HTMLDivAttributes {
  /** Section title displayed above the row. Omit to render no header. */
  title?: string;

  /** URL for "View All" link in the header. Only rendered when title is also set. */
  viewAllHref?: string;

  /** Label text for the "View All" link. Defaults to "View all". */
  viewAllLabel?: string;

  /**
   * Snippet that renders a single item.
   * Receives the item and its index: {#snippet renderItem(item, index)}
   */
  renderItem: Snippet<[item: T, index: number]>;

  /** Array of items to render. */
  items: T[];

  /**
   * Minimum width for each item in the row.
   * Controls responsive item count: narrower containers show fewer items.
   * Use a CSS length value string.
   * @default '280px'
   */
  itemMinWidth?: string;

  /**
   * Gap between items. Must be a design token reference.
   * @default 'var(--space-4)'
   */
  gap?: string;

  /** Show left/right navigation arrows. @default true */
  showArrows?: boolean;

  /** Accessible label for the carousel region. @default title ?? 'Content carousel' */
  ariaLabel?: string;

  /**
   * Number of items to scroll per arrow click.
   * 'page' scrolls by the visible container width.
   * A number scrolls by that many item widths.
   * @default 'page'
   */
  scrollAmount?: 'page' | number;
}
```

The generic `T` is inferred from the `items` array. The `renderItem` snippet receives each item plus its index, giving consumers full control over card rendering.

### Layout & Scroll Behavior

The carousel container is a single flex row with horizontal overflow:

```css
.carousel__track {
  display: flex;
  gap: var(--carousel-gap, var(--space-4));
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scroll-behavior: smooth;
  scroll-padding-inline-start: var(--space-1);
  padding-block-end: var(--space-2); /* Room for scrollbar / shadow */
}
```

Each item wrapper enforces sizing and snap:

```css
.carousel__item {
  flex: 0 0 auto;
  min-width: var(--carousel-item-min-width, 280px);
  max-width: var(--carousel-item-max-width, 400px);
  scroll-snap-align: start;
}
```

The `itemMinWidth` prop is applied as a CSS custom property (`--carousel-item-min-width`) on the track element, avoiding inline style sprawl.

**Scrollbar styling**: Thin, subtle scrollbar matching the existing `ContinueWatching` pattern:

```css
.carousel__track::-webkit-scrollbar {
  height: 4px;
}

.carousel__track::-webkit-scrollbar-track {
  background: transparent;
}

.carousel__track::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: var(--radius-full);
}

/* Firefox */
.carousel__track {
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) transparent;
}
```

### Navigation Arrows

**Placement**: Absolutely positioned over the left and right edges of the scroll track, vertically centered. Layered above content with `z-index: var(--z-0)` (within the component's stacking context via `position: relative` on the wrapper).

**Appearance**: Semi-transparent circular buttons with a chevron icon. Background becomes more opaque on hover.

```css
.carousel__arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1; /* Local stacking context, no token needed */
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--space-10);
  height: var(--space-10);
  border-radius: var(--radius-full);
  border: var(--border-width) var(--border-style) var(--color-border);
  background: color-mix(in srgb, var(--color-surface) 85%, transparent);
  color: var(--color-text);
  cursor: pointer;
  transition: var(--transition-colors), var(--transition-opacity);
  backdrop-filter: blur(4px);
}

.carousel__arrow:hover {
  background: var(--color-surface);
  box-shadow: var(--shadow-md);
}

.carousel__arrow:focus-visible {
  outline: var(--border-width-thick) solid var(--color-focus);
  outline-offset: 2px;
}

.carousel__arrow--left {
  left: var(--space-2);
}

.carousel__arrow--right {
  right: var(--space-2);
}

.carousel__arrow[hidden] {
  display: none;
}
```

**Show/hide logic**: Driven by scroll position state, updated on the `scroll` event:

```typescript
let trackEl: HTMLDivElement | undefined = $state();
let canScrollLeft = $state(false);
let canScrollRight = $state(true);

function updateArrowVisibility() {
  if (!trackEl) return;
  const { scrollLeft, scrollWidth, clientWidth } = trackEl;
  canScrollLeft = scrollLeft > 1; // 1px threshold for sub-pixel rounding
  canScrollRight = scrollLeft + clientWidth < scrollWidth - 1;
}
```

Arrows are hidden with the HTML `hidden` attribute (not just CSS `display: none`) for accessibility -- hidden elements are removed from the tab order.

**Click behavior**: Scrolls by one "page" (the visible width of the container minus one item width for context):

```typescript
function scrollByDirection(direction: 'left' | 'right') {
  if (!trackEl) return;
  const prefersReducedMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scrollDistance =
    scrollAmount === 'page'
      ? trackEl.clientWidth * 0.85
      : scrollAmount * parseFloat(getComputedStyle(trackEl).getPropertyValue('--carousel-item-min-width'));

  trackEl.scrollBy({
    left: direction === 'left' ? -scrollDistance : scrollDistance,
    behavior: prefersReducedMotion ? 'instant' : 'smooth',
  });
}
```

The 0.85 multiplier ensures the last visible card on the current "page" remains partially visible after scrolling, giving the user spatial context.

### Touch & Swipe

No JS handling required. The combination of `overflow-x: auto` and `-webkit-overflow-scrolling: touch` provides native momentum scrolling on iOS and Android. `scroll-snap-type: x mandatory` ensures the scroll lands on a card boundary after the swipe decelerates.

On desktop, horizontal scroll via mouse wheel (shift+wheel on most platforms) and trackpad two-finger horizontal swipe both work natively with `overflow-x: auto`.

### Responsive Behavior

The carousel uses a fluid approach driven by `itemMinWidth` rather than fixed column counts. The browser's flex layout naturally fits as many items as possible:

| Viewport | `itemMinWidth: 280px` | `itemMinWidth: 220px` |
|---|---|---|
| < 640px (`--below-sm`) | 1 item visible, ~100px peek | 1-2 items visible |
| 640-768px (`--breakpoint-sm`) | 2 items visible | 2-3 items visible |
| 768-1024px (`--breakpoint-md`) | 2-3 items visible | 3 items visible |
| 1024-1280px (`--breakpoint-lg`) | 3-4 items visible | 4-5 items visible |
| 1280px+ (`--breakpoint-xl`) | 4 items visible | 5-6 items visible |

**Mobile arrow behavior**: Arrows are hidden on touch devices (they add clutter where swipe is the natural interaction). Detection uses `@media (hover: hover)` -- arrows only render when a fine pointer (mouse) is available:

```css
.carousel__arrow {
  display: none;
}

@media (hover: hover) and (pointer: fine) {
  .carousel__arrow {
    display: flex;
  }

  .carousel__arrow[hidden] {
    display: none;
  }
}
```

This is a progressive enhancement: touch-only devices get clean edges; mouse users get arrow affordances.

### Keyboard Accessibility

**ARIA attributes on the container**:

```svelte
<div
  class="carousel"
  role="region"
  aria-label={ariaLabel ?? title ?? 'Content carousel'}
  aria-roledescription="carousel"
>
```

**Arrow buttons**:

```svelte
<button
  class="carousel__arrow carousel__arrow--left"
  aria-label="Scroll left"
  hidden={!canScrollLeft}
  onclick={() => scrollByDirection('left')}
>
  <ChevronLeftIcon size={20} />
</button>
```

**Focus management**: When a focusable child inside the track receives focus (via Tab or arrow keys), the carousel scrolls to ensure it is visible:

```typescript
function handleFocusIn(event: FocusEvent) {
  const target = event.target as HTMLElement;
  if (target && trackEl?.contains(target)) {
    target.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'instant', // Always instant for focus -- no animation
    });
  }
}
```

**Arrow key navigation within the track**: The individual card items are naturally focusable (they are links or contain buttons). Standard Tab navigation moves between them. No additional `roving-tabindex` pattern is needed because the items are not a toolbar or menu -- they are independent links in a scrollable region.

**Skip link consideration**: If the carousel contains many items (e.g., 20+), keyboard users would need to Tab through all of them. For now, the items array is expected to be bounded (4-12 items in all planned usage). If this changes, a "Skip past carousel" link should be added.

### Reduced Motion

Two mechanisms work together:

1. **CSS transitions** (arrow hover effects, opacity changes): Already handled by the global `motion.css` `prefers-reduced-motion` override, which sets all `--duration-*` tokens to `0.01ms`.

2. **CSS `scroll-behavior: smooth`** on the track: This is a CSS property that the browser respects. Under `prefers-reduced-motion: reduce`, modern browsers automatically skip smooth scroll animations. However, not all browsers do this consistently. Add an explicit override:

```css
@media (prefers-reduced-motion: reduce) {
  .carousel__track {
    scroll-behavior: auto;
  }
}
```

3. **JS `scrollTo`/`scrollBy` in arrow click handlers**: The `scrollByDirection()` function already checks `window.matchMedia('(prefers-reduced-motion: reduce)').matches` and uses `behavior: 'instant'` when true (see Navigation Arrows section above).

---

## Implementation Plan

### Files to Create

#### 1. `apps/web/src/lib/components/ui/Carousel/Carousel.svelte`

The main component. Structure:

```svelte
<!--
  @component Carousel

  Horizontal scrollable row of items with CSS scroll-snap, navigation arrows,
  touch/swipe support, and keyboard accessibility.

  @prop {T[]} items - Array of items to render
  @prop {Snippet<[T, number]>} renderItem - Snippet to render each item
  @prop {string} title - Optional section title
  @prop {string} viewAllHref - Optional "View All" link URL
  @prop {string} viewAllLabel - Label for "View All" link
  @prop {string} itemMinWidth - Minimum item width (CSS length)
  @prop {string} gap - Gap between items (design token)
  @prop {boolean} showArrows - Show navigation arrows
  @prop {string} ariaLabel - Accessible label
  @prop {'page' | number} scrollAmount - Scroll distance per arrow click
-->
<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import type { HTMLDivAttributes } from 'svelte/elements';
  import { ChevronLeftIcon, ChevronRightIcon } from '$lib/components/ui/Icon';
  import { onMount } from 'svelte';

  interface Props extends HTMLDivAttributes {
    items: T[];
    renderItem: Snippet<[item: T, index: number]>;
    title?: string;
    viewAllHref?: string;
    viewAllLabel?: string;
    itemMinWidth?: string;
    gap?: string;
    showArrows?: boolean;
    ariaLabel?: string;
    scrollAmount?: 'page' | number;
  }

  const {
    items,
    renderItem,
    title,
    viewAllHref,
    viewAllLabel = 'View all',
    itemMinWidth = '280px',
    gap = 'var(--space-4)',
    showArrows = true,
    ariaLabel,
    scrollAmount = 'page',
    class: className,
    ...restProps
  }: Props = $props();

  let trackEl: HTMLDivElement | undefined = $state();
  let canScrollLeft = $state(false);
  let canScrollRight = $state(true);

  function updateArrowVisibility() {
    if (!trackEl) return;
    const { scrollLeft, scrollWidth, clientWidth } = trackEl;
    canScrollLeft = scrollLeft > 1;
    canScrollRight = scrollLeft + clientWidth < scrollWidth - 1;
  }

  function scrollByDirection(direction: 'left' | 'right') {
    if (!trackEl) return;
    const prefersReducedMotion =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let scrollDistance: number;
    if (scrollAmount === 'page') {
      scrollDistance = trackEl.clientWidth * 0.85;
    } else {
      const itemWidth = parseFloat(
        getComputedStyle(trackEl).getPropertyValue('--carousel-item-min-width')
      );
      const gapWidth = parseFloat(getComputedStyle(trackEl).gap) || 0;
      scrollDistance = scrollAmount * (itemWidth + gapWidth);
    }
    trackEl.scrollBy({
      left: direction === 'left' ? -scrollDistance : scrollDistance,
      behavior: prefersReducedMotion ? 'instant' : 'smooth',
    });
  }

  function handleFocusIn(event: FocusEvent) {
    const target = event.target as HTMLElement;
    if (target && trackEl?.contains(target)) {
      target.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'instant',
      });
    }
  }

  onMount(() => {
    updateArrowVisibility();
  });
</script>

{#if items.length > 0}
  <div
    class="carousel {className ?? ''}"
    role="region"
    aria-label={ariaLabel ?? title ?? 'Content carousel'}
    aria-roledescription="carousel"
    {...restProps}
  >
    {#if title}
      <div class="carousel__header">
        <h2 class="carousel__title">{title}</h2>
        {#if viewAllHref}
          <a href={viewAllHref} class="carousel__view-all">
            {viewAllLabel} &rarr;
          </a>
        {/if}
      </div>
    {/if}

    <div class="carousel__viewport">
      {#if showArrows}
        <button
          class="carousel__arrow carousel__arrow--left"
          aria-label="Scroll left"
          hidden={!canScrollLeft}
          onclick={() => scrollByDirection('left')}
        >
          <ChevronLeftIcon size={20} />
        </button>
        <button
          class="carousel__arrow carousel__arrow--right"
          aria-label="Scroll right"
          hidden={!canScrollRight}
          onclick={() => scrollByDirection('right')}
        >
          <ChevronRightIcon size={20} />
        </button>
      {/if}

      <div
        class="carousel__track"
        bind:this={trackEl}
        onscroll={updateArrowVisibility}
        onfocusin={handleFocusIn}
        style:--carousel-item-min-width={itemMinWidth}
        style:--carousel-gap={gap}
      >
        {#each items as item, index (index)}
          <div class="carousel__item">
            {@render renderItem(item, index)}
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .carousel {
    position: relative;
  }

  /* -- Header -- */
  .carousel__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
  }

  .carousel__title {
    font-family: var(--font-heading);
    font-size: var(--text-xl);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
  }

  .carousel__view-all {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    text-decoration: none;
    white-space: nowrap;
    transition: var(--transition-colors);
  }

  .carousel__view-all:hover {
    color: var(--color-interactive-hover);
  }

  .carousel__view-all:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  /* -- Viewport (arrow positioning context) -- */
  .carousel__viewport {
    position: relative;
  }

  /* -- Track -- */
  .carousel__track {
    display: flex;
    gap: var(--carousel-gap, var(--space-4));
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    scroll-behavior: smooth;
    scroll-padding-inline-start: var(--space-1);
    padding-block-end: var(--space-2);
  }

  /* Scrollbar styling */
  .carousel__track::-webkit-scrollbar {
    height: 4px;
  }

  .carousel__track::-webkit-scrollbar-track {
    background: transparent;
  }

  .carousel__track::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: var(--radius-full);
  }

  .carousel__track {
    scrollbar-width: thin;
    scrollbar-color: var(--color-border) transparent;
  }

  @media (prefers-reduced-motion: reduce) {
    .carousel__track {
      scroll-behavior: auto;
    }
  }

  /* -- Item -- */
  .carousel__item {
    flex: 0 0 auto;
    min-width: var(--carousel-item-min-width, 280px);
    scroll-snap-align: start;
  }

  /* -- Navigation Arrows -- */
  .carousel__arrow {
    display: none; /* Hidden by default (touch devices) */
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 1;
    align-items: center;
    justify-content: center;
    width: var(--space-10);
    height: var(--space-10);
    padding: 0;
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) var(--color-border);
    background: color-mix(in srgb, var(--color-surface) 85%, transparent);
    color: var(--color-text);
    cursor: pointer;
    transition: var(--transition-colors), var(--transition-opacity), var(--transition-shadow);
    backdrop-filter: blur(4px);
  }

  @media (hover: hover) and (pointer: fine) {
    .carousel__arrow {
      display: flex;
    }

    .carousel__arrow[hidden] {
      display: none;
    }
  }

  .carousel__arrow:hover {
    background: var(--color-surface);
    box-shadow: var(--shadow-md);
  }

  .carousel__arrow:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .carousel__arrow--left {
    left: var(--space-2);
  }

  .carousel__arrow--right {
    right: var(--space-2);
  }
</style>
```

#### 2. `apps/web/src/lib/components/ui/Carousel/index.ts`

Barrel export:

```typescript
export { default as Carousel } from './Carousel.svelte';
```

#### 3. Update `apps/web/src/lib/components/ui/index.ts`

Add the Carousel export to the UI barrel file:

```typescript
export { Carousel } from './Carousel';
```

### Icon Dependencies

The component uses `ChevronLeftIcon` and `ChevronRightIcon`. Verify these exist in `apps/web/src/lib/components/ui/Icon/`. If not, they need to be added -- they are standard chevron icons, likely already present given the 40+ icons in the directory.

### No New Design Tokens

All CSS values use existing tokens. No new tokens are introduced. The component uses CSS custom properties (`--carousel-item-min-width`, `--carousel-gap`) scoped to the component instance via the `style:` directive, which is the correct pattern for parameterized component styling.

---

## Usage Examples

### Org Landing -- New Releases Row

```svelte
<script lang="ts">
  import { Carousel } from '$lib/components/ui/Carousel';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';

  let { data } = $props();
  const newReleases = $derived(data.newReleases ?? []);
</script>

<Carousel
  items={newReleases}
  title={m.org_new_releases_title()}
  viewAllHref="/explore"
  viewAllLabel={m.org_view_all_content()}
  itemMinWidth="280px"
>
  {#snippet renderItem(item)}
    <ContentCard
      id={item.id}
      title={item.title}
      thumbnail={item.thumbnailUrl}
      description={item.description}
      contentType={item.contentType}
      duration={item.mediaItem?.durationSeconds}
      href={buildContentUrl(page.url, item)}
      price={item.priceCents != null
        ? { amount: item.priceCents, currency: 'GBP' }
        : null}
    />
  {/snippet}
</Carousel>
```

### Library -- Continue Watching (Refactored)

Shows how the existing `ContinueWatching` component could be simplified to use `Carousel` internally:

```svelte
<script lang="ts">
  import { Carousel } from '$lib/components/ui/Carousel';
  import ContinueWatchingCard from './ContinueWatchingCard.svelte';
  import * as m from '$paraglide/messages';

  interface Props {
    items: LibraryItem[];
  }
  const { items }: Props = $props();

  const continueWatchingItems = $derived.by(() => {
    return items
      .filter(
        (item) =>
          item.progress &&
          item.progress.positionSeconds > 0 &&
          !item.progress.completed
      )
      .sort((a, b) => {
        const aTime = a.progress?.updatedAt ?? '';
        const bTime = b.progress?.updatedAt ?? '';
        return bTime.localeCompare(aTime);
      })
      .slice(0, 8);
  });
</script>

<Carousel
  items={continueWatchingItems}
  title={m.library_continue_watching()}
  itemMinWidth="220px"
  gap="var(--space-4)"
>
  {#snippet renderItem(item)}
    <ContinueWatchingCard {item} />
  {/snippet}
</Carousel>
```

### Content Detail -- Related Content

```svelte
<Carousel
  items={relatedContent}
  title="Related Content"
  viewAllHref="/explore?category={content.category}"
  viewAllLabel="View more"
  itemMinWidth="240px"
>
  {#snippet renderItem(item)}
    <ContentCard
      id={item.id}
      title={item.title}
      thumbnail={item.thumbnailUrl}
      contentType={item.contentType}
      duration={item.mediaItem?.durationSeconds}
      href={buildContentUrl(page.url, item)}
    />
  {/snippet}
</Carousel>
```

### Creator Profile -- Content Showcase

```svelte
<Carousel
  items={creatorContent}
  title="Latest from {creator.name}"
  viewAllHref="/content"
  itemMinWidth="260px"
>
  {#snippet renderItem(item)}
    <ContentCard
      id={item.id}
      title={item.title}
      thumbnail={item.thumbnailUrl}
      contentType={item.contentType}
      duration={item.mediaItem?.durationSeconds}
      href={buildContentUrl(page.url, item)}
      price={item.priceCents != null
        ? { amount: item.priceCents, currency: 'GBP' }
        : null}
    />
  {/snippet}
</Carousel>
```

---

## Testing Notes

### Visual & Interaction

- **Desktop (mouse)**: Arrows visible. Left arrow hidden on initial load (scroll at start). Right arrow visible if content overflows. Clicking right arrow scrolls smoothly by ~85% of container width. After scrolling right, left arrow appears. At end of scroll, right arrow hides.
- **Mobile (touch)**: Arrows hidden (no `hover: hover` + `pointer: fine`). Swipe horizontally to scroll. Scroll snaps to card boundaries. Momentum scrolling works naturally.
- **Trackpad (laptop)**: Two-finger horizontal swipe scrolls the row. Scroll-snap engages after gesture completes. Arrows visible (trackpad reports `pointer: fine`).
- **Empty items array**: Component renders nothing (guarded by `{#if items.length > 0}`).
- **Single item**: Right arrow hidden (no overflow). No scroll behavior. Item renders normally.
- **Many items (20+)**: Arrows work correctly at both ends. Scrollbar appears. Performance remains smooth (no virtualization needed at these counts).

### Keyboard Accessibility

- **Tab through items**: Each card link receives focus in sequence. Carousel scrolls to reveal the focused card.
- **Arrow button focus**: Tab reaches the arrow buttons. Enter/Space activates them. Hidden arrows are removed from tab order (HTML `hidden` attribute).
- **Screen reader**: `role="region"` with `aria-label` announces the carousel. `aria-roledescription="carousel"` provides semantic context. Arrow buttons have explicit `aria-label` text.

### Responsive Breakpoints

- **< 640px**: 1 card visible with a peek of the next card edge (signaling scrollability). Title and "View All" link stack if space is tight.
- **640-1024px**: 2-3 cards visible depending on `itemMinWidth`.
- **1024px+**: 3-4 cards visible. Full arrow buttons on mouse devices.

### Reduced Motion

- **`prefers-reduced-motion: reduce`**: Arrow clicks use `behavior: 'instant'` (no smooth scroll animation). CSS `scroll-behavior` set to `auto`. Touch momentum scrolling is browser-native and respects OS-level reduced motion settings. All CSS transitions collapse to `0.01ms` via existing `motion.css` global override.

### Edge Cases

- **Scroll position after window resize**: The `scroll` event fires during resize if the track overflows differently. Arrow visibility updates automatically via the `onscroll` handler.
- **Dynamic items**: If `items` changes reactively (e.g., filter applied), the track re-renders. Arrow visibility should be rechecked -- use `$effect` to call `updateArrowVisibility()` when `items.length` changes.
- **Org branding density**: `itemMinWidth` is a raw CSS value, not a spacing token, so it is unaffected by `--brand-density-scale`. This is intentional -- item counts should remain stable across density settings. Internal card spacing (padding, gaps) already respects density via `--space-*` tokens.

### Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---|---|---|---|---|
| `scroll-snap-type: x mandatory` | 69+ | 68+ | 11+ | 79+ |
| `scroll-behavior: smooth` | 61+ | 36+ | 15.4+ | 79+ |
| `backdrop-filter: blur()` | 76+ | 103+ | 9+ | 79+ |
| `color-mix()` | 111+ | 113+ | 16.2+ | 111+ |
| `@media (hover: hover)` | 38+ | 64+ | 9+ | 12+ |
| `scrollbar-width: thin` | N/A | 64+ | N/A | N/A |

`backdrop-filter` and `color-mix()` are used for the arrow button styling. Both have good coverage. For `color-mix()` fallback, the component could use a simpler `background: var(--color-surface)` with `opacity: 0.85`, but given the target audience (modern browsers), this is acceptable as-is. The `scrollbar-width` property is Firefox-only -- Chrome/Safari use the `-webkit-scrollbar` pseudo-elements.
