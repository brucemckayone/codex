# ContentCard Visual Polish — Implementation Spec

## Summary

Four small visual enhancements to the existing `ContentCard` component that improve content discoverability and browsing experience:

1. **Content type icon overlay** — Adds a recognizable Video/Audio/Article icon in the bottom-left corner of the thumbnail, replacing the current text-only type label in the top-left.
2. **Duration badge** — Displays human-readable duration (e.g. "45m") in the bottom-right of the thumbnail, sourced from `mediaItem.durationSeconds`.
3. **PriceBadge sub-component** — Extracts the inline price badge into a reusable component with three visual variants: "Free" (success), "£29" (neutral), and "Purchased" (info + check icon).
4. **Card hover animations** — CSS-only: subtle scale-up, shadow elevation, and smooth transitions using existing design tokens.

**Effort estimate**: ~2-3 hours for an implementer familiar with the codebase. All changes are CSS/markup — no API or data layer work.

---

## Feasibility

### Pros

- All four enhancements are purely presentational — no backend changes, no new API calls, no schema changes.
- The component already has `contentType`, `duration`, and `price` props, so all data is already flowing in. The only new data is a `purchased` boolean for PriceBadge.
- The icon components needed (`PlayIcon`, `MusicIcon`, `FileTextIcon`, `CheckIcon`) already exist in `ui/Icon/`.
- The existing `formatDurationHuman()` utility in `$lib/utils/format.ts` already formats seconds into the desired "5m", "1h 5m" format and is already imported by ContentCard.
- The motion tokens (`--transition-transform`, `--transition-shadow`, `--duration-normal`, `--ease-out`) and the `prefers-reduced-motion` override are already defined in `tokens/motion.css`, so hover animations get automatic reduced-motion support for free.
- The existing Badge component (`ui/Badge/Badge.svelte`) provides a proven pattern for the PriceBadge variant system.

### Gotchas & Risks

- **Type icon vs type label conflict**: The current component renders a text label (`content-card__type`) in the top-left AND uses icon placeholders when there is no thumbnail. The new icon overlay in the bottom-left must not visually collide with the existing duration badge in the bottom-right. The spec removes the text label entirely and replaces it with the icon overlay.
- **"Purchased" state data**: ContentCard does not currently receive a `purchased` prop. Callers that want to show "Purchased" must pass it. The library page already knows purchase state; explore/landing pages do not (they would show "Free" or the price). This is fine — the PriceBadge gracefully falls back.
- **Hover scale on grid layout**: `transform: scale()` on a card inside a CSS grid can cause visual overlap with adjacent cards. This is handled by using a small scale factor (1.02) and ensuring `z-index` elevation on hover.
- **Icon overlay on dark thumbnails**: A semi-transparent dark overlay background ensures the white icon remains visible regardless of thumbnail colour. This matches the existing pattern used by `content-card__duration`.

---

## Current State

### Component location

```
apps/web/src/lib/components/ui/ContentCard/
  ContentCard.svelte   — Main component (428 lines)
  index.ts             — Barrel export
  ContentCard.stories.svelte — Storybook stories
```

### Current Props interface

```typescript
interface Props extends HTMLAttributes<HTMLDivElement> {
  id: string;
  title: string;
  thumbnail?: string | null;
  description?: string | null;
  contentType?: 'video' | 'audio' | 'article';
  duration?: number | null;
  creator?: { username?: string; displayName?: string; avatar?: string | null };
  actions?: Snippet;
  href?: string;
  loading?: boolean;
  progress?: { positionSeconds?: number; durationSeconds?: number; completed?: boolean; percentComplete?: number } | null;
  price?: { amount: number; currency: string } | null;
}
```

### Current thumbnail overlay elements (positioned absolutely inside `.content-card__thumbnail`)

| Element | Position | Purpose |
|---------|----------|---------|
| `content-card__type` | top-left | Text label: "VIDEO", "AUDIO", "ARTICLE" |
| `content-card__price-badge` | top-right | Price: "Free" (green) or "£29.00" (accent) |
| `content-card__duration` | bottom-right | Duration: "45m", "1h 5m" |
| `content-card__progress-track` | bottom edge, full width | Progress bar |

### Pages that use ContentCard

| Page | File | Notes |
|------|------|-------|
| Org landing | `_org/[slug]/(space)/+page.svelte` | Passes `price`, `duration`, `creator`, `contentType` |
| Org explore | `_org/[slug]/(space)/explore/+page.svelte` | Same props pattern |
| Creator profile | `_creators/[username]/+page.svelte` | Passes `price`, `duration`, no `creator` |
| Creator content catalog | `_creators/[username]/content/+page.svelte` | Same as creator profile |

Note: The org library page (`_org/[slug]/(space)/library/+page.svelte`) does NOT use ContentCard — it renders its own inline card markup. That is a separate refactor opportunity, not in scope here.

---

## Design Spec

### 1. Type Icon Overlay

**What changes**: Remove the existing text-only `content-card__type` badge from the top-left. Add an icon overlay in the **bottom-left** corner of the thumbnail area. The icon communicates content type at a glance without needing to read text.

**Placement**: Bottom-left of `.content-card__thumbnail`, offset by `--space-2` from both edges. This mirrors the duration badge's position in the bottom-right, creating a balanced bottom row.

**Icon mapping**:

| contentType | Icon component | Rationale |
|-------------|---------------|-----------|
| `video` | `PlayIcon` | Universal play triangle |
| `audio` | `MusicIcon` | Music note — already used in placeholder |
| `article` | `FileTextIcon` | Document with lines — already used in placeholder |

**Icon size**: 16px (`size={16}`). Small enough to not dominate the thumbnail, large enough to be recognisable.

**CSS approach**: Same pattern as `content-card__duration` — absolute positioned, semi-transparent dark background pill, white icon.

```css
.content-card__type-icon {
  position: absolute;
  bottom: var(--space-2);
  left: var(--space-2);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-1);
  background: var(--color-overlay);
  color: var(--color-text-inverse);
  border-radius: var(--radius-sm);
  line-height: 0; /* prevent icon from adding extra height */
}
```

**Accessibility**: Add `aria-label` with the content type name (e.g. `aria-label="Video"`), sourced from the existing `contentTypeLabels` map.

### 2. Duration Badge

**Current state**: Already implemented and working. The badge renders in the bottom-right via `.content-card__duration` using `formatDurationHuman(duration)`. No structural changes needed.

**Minor polish**: Add the `ClockIcon` (size 12) inline before the text for visual consistency with the new type icon overlay. This is optional and low priority — the duration text alone is already clear.

**Data source**: `duration` prop (seconds), sourced from `mediaItem.durationSeconds` by all callers. The `formatDurationHuman()` function from `$lib/utils/format.ts` handles all formatting:
- `< 60s` -> "45s"
- `< 3600s` -> "45m"
- `>= 3600s` -> "1h 5m"

**Fallback**: When `duration` is `null` or `0`, the badge is already hidden via `{#if duration}`. No change needed.

### 3. PriceBadge Component

**Why extract**: The price display logic currently lives inline in ContentCard with hardcoded CSS classes. A reusable PriceBadge enables consistent price rendering across ContentCard, content detail pages, and future components (e.g. search results, carousels).

**New file**: `apps/web/src/lib/components/ui/PriceBadge/PriceBadge.svelte`

**Props interface**:

```typescript
interface Props extends HTMLAttributes<HTMLSpanElement> {
  /** Price in minor units (pence). 0 = free. null = hide entirely. */
  amount: number | null;
  /** ISO 4217 currency code. Defaults to 'GBP'. */
  currency?: string;
  /** Whether the current user has purchased this content. */
  purchased?: boolean;
}
```

**Three visual variants**:

| Condition | Label | Background | Text colour | Icon |
|-----------|-------|------------|-------------|------|
| `purchased === true` | "Purchased" | `var(--color-info-50)` | `var(--color-info-700)` | `CheckIcon` (size 12) before text |
| `amount === 0` | "Free" | `var(--color-success-50)` | `var(--color-success-700)` | None |
| `amount > 0` | Formatted price (e.g. "£29.00") | `var(--color-surface-secondary)` | `var(--color-text)` | None |
| `amount === null` | Nothing rendered | — | — | — |

**Formatting**: Use `formatPrice()` from `$lib/utils/format.ts` (already exists, formats pence to `£XX.XX`). For "Free", use the existing i18n key `m.content_price_free()`.

**CSS approach**: Inline-flex span, pill shape, small text. Follows the Badge component pattern but uses `<span>` instead of `<div>` since it appears inline within thumbnail overlays.

```css
.price-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  border-radius: var(--radius-sm);
  line-height: var(--leading-none);
  white-space: nowrap;
}

.price-badge[data-variant="free"] {
  background: var(--color-success-50);
  color: var(--color-success-700);
  border: var(--border-width) var(--border-style) var(--color-success-200);
}

.price-badge[data-variant="purchased"] {
  background: var(--color-info-50);
  color: var(--color-info-700);
  border: var(--border-width) var(--border-style) var(--color-info-200);
}

.price-badge[data-variant="paid"] {
  background: var(--color-surface-secondary);
  color: var(--color-text);
  border: var(--border-width) var(--border-style) var(--color-border);
}
```

**Position within ContentCard**: Remains in the top-right of the thumbnail area (same as current `content-card__price-badge`). The ContentCard replaces its inline markup with `<PriceBadge>`, applying the same absolute positioning via a wrapper or the component's class prop.

**New i18n key needed**: `content_price_purchased` -> "Purchased"

### 4. Hover Animation

**What changes**: Enhance the existing hover state to include a subtle scale-up, elevated shadow, and smooth transition. The current hover only changes `border-color` and adds `box-shadow: var(--shadow-md)`.

**New hover behaviour**:

| Property | Resting | Hover | Token |
|----------|---------|-------|-------|
| `transform` | `none` | `scale(1.02)` | — (raw value, too small for a token) |
| `box-shadow` | `none` | `var(--shadow-lg)` | `--shadow-lg` (upgraded from `--shadow-md`) |
| `border-color` | `var(--color-border)` | `var(--color-border-hover)` | (unchanged) |
| `z-index` | `auto` | `1` | — (prevents adjacent card overlap during scale) |

**Transition**: Add `var(--transition-transform)` to the existing transition list on `.content-card`. The current component already has `transition: var(--transition-colors), var(--transition-shadow)` — append the transform transition.

```css
.content-card {
  /* existing */
  transition: var(--transition-colors), var(--transition-shadow), var(--transition-transform);
}

.content-card:hover {
  transform: scale(1.02);
  box-shadow: var(--shadow-lg);
  border-color: var(--color-border-hover);
  z-index: 1;
}
```

**Reduced-motion support**: Already handled globally by `tokens/motion.css`:

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-normal: 0.01ms;
  }
  *, *::before, *::after {
    transition-duration: 0.01ms !important;
  }
}
```

This means the scale/shadow transitions become effectively instant for users who prefer reduced motion — no additional code needed.

**Focus-visible**: Apply the same hover visual treatment on `:focus-within` (since the card contains an anchor link), so keyboard users see the elevation:

```css
.content-card:focus-within {
  transform: scale(1.02);
  box-shadow: var(--shadow-lg);
  border-color: var(--color-border-hover);
  z-index: 1;
}
```

---

## Implementation Plan

### Files to Create

#### 1. `apps/web/src/lib/components/ui/PriceBadge/PriceBadge.svelte`

New component. Full implementation:

```svelte
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import * as m from '$paraglide/messages';
  import { formatPrice } from '$lib/utils/format';
  import { CheckIcon } from '$lib/components/ui/Icon';

  interface Props extends HTMLAttributes<HTMLSpanElement> {
    amount: number | null;
    currency?: string;
    purchased?: boolean;
  }

  const {
    amount,
    currency = 'GBP',
    purchased = false,
    class: className,
    ...restProps
  }: Props = $props();

  const variant = $derived.by(() => {
    if (purchased) return 'purchased';
    if (amount === 0) return 'free';
    return 'paid';
  });

  const label = $derived.by(() => {
    if (purchased) return m.content_price_purchased();
    if (amount === 0) return m.content_price_free();
    if (amount != null) return formatPrice(amount);
    return '';
  });
</script>

{#if amount != null || purchased}
  <span class="price-badge {className ?? ''}" data-variant={variant} {...restProps}>
    {#if purchased}
      <CheckIcon size={12} />
    {/if}
    {label}
  </span>
{/if}
```

Scoped `<style>` block: use the CSS from the Design Spec section 3 above.

#### 2. `apps/web/src/lib/components/ui/PriceBadge/index.ts`

```typescript
export { default as PriceBadge } from './PriceBadge.svelte';
```

### Files to Modify

#### 1. `apps/web/src/lib/components/ui/ContentCard/ContentCard.svelte`

**Imports**: Add `PriceBadge` import, add `CheckIcon` if not already imported (it is not). Remove the `formatPrice` local function (replaced by PriceBadge).

```diff
+ import { PriceBadge } from '../PriceBadge';
```

**Props**: Add optional `purchased` prop.

```diff
  interface Props extends HTMLAttributes<HTMLDivElement> {
    // ... existing props ...
    price?: { amount: number; currency: string } | null;
+   purchased?: boolean;
  }
```

```diff
  const {
    // ... existing destructuring ...
    price = null,
+   purchased = false,
    class: className,
    ...rest
  }: Props = $props();
```

**Remove**: The local `formatPrice` function (lines 74-81). PriceBadge handles its own formatting.

**Template changes** inside `.content-card__thumbnail`:

a) **Replace type text label with icon overlay**. Remove the existing `<span class="content-card__type">` block (line 157). Add the new icon overlay after the duration badge:

```svelte
<!-- Type icon overlay — bottom-left -->
<span class="content-card__type-icon" aria-label={contentTypeLabels[contentType]}>
  {#if contentType === 'video'}
    <PlayIcon size={16} />
  {:else if contentType === 'audio'}
    <MusicIcon size={16} />
  {:else}
    <FileTextIcon size={16} />
  {/if}
</span>
```

b) **Replace inline price badge with PriceBadge component**. Remove the existing `{#if price != null}` block (lines 159-163). Replace with:

```svelte
{#if price != null || purchased}
  <PriceBadge
    amount={price?.amount ?? null}
    currency={price?.currency ?? 'GBP'}
    {purchased}
    class="content-card__price-badge"
  />
{/if}
```

**CSS changes**:

a) Remove `.content-card__type` styles (lines 294-305).

b) Add `.content-card__type-icon` styles (see Design Spec section 1).

c) Update `.content-card` base transition:

```diff
  .content-card {
    /* ... */
-   transition: var(--transition-colors), var(--transition-shadow);
+   transition: var(--transition-colors), var(--transition-shadow), var(--transition-transform);
  }
```

d) Update `.content-card:hover`:

```diff
  .content-card:hover {
    border-color: var(--color-border-hover);
-   box-shadow: var(--shadow-md);
+   box-shadow: var(--shadow-lg);
+   transform: scale(1.02);
+   z-index: 1;
  }
```

e) Add focus-within for keyboard users:

```css
.content-card:focus-within {
  transform: scale(1.02);
  box-shadow: var(--shadow-lg);
  border-color: var(--color-border-hover);
  z-index: 1;
}
```

f) Remove `.content-card__price-badge` and `.content-card__price-badge--free` styles (lines 308-323) — these are now handled by PriceBadge internally. Keep only the positioning rule applied via the class prop:

```css
/* Position PriceBadge within thumbnail */
:global(.content-card__price-badge) {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  z-index: 1;
}
```

#### 2. `apps/web/messages/en.json`

Add new i18n key:

```diff
  "content_price_free": "Free",
+ "content_price_purchased": "Purchased",
```

#### 3. `apps/web/src/lib/components/ui/ContentCard/ContentCard.stories.svelte`

Add new stories to exercise the new visual states:

- **"With Price (Paid)"** — shows a card with `price={{ amount: 2900, currency: 'GBP' }}`.
- **"With Price (Free)"** — shows a card with `price={{ amount: 0, currency: 'GBP' }}`.
- **"Purchased"** — shows a card with `price={{ amount: 2900, currency: 'GBP' }} purchased={true}`.
- **"Hover Animation"** — grid of cards to visually test hover scale/shadow (reuse "All Types Grid" story or add a note).

#### 4. `apps/web/src/lib/components/ui/ContentCard/index.ts`

No change needed — PriceBadge has its own barrel export.

#### 5. Caller pages (NO changes required)

The four pages that use ContentCard (`org landing`, `org explore`, `creator profile`, `creator content catalog`) do not need changes for items 1, 2, and 4 — those are purely internal to ContentCard.

For item 3 (PriceBadge "Purchased" variant): callers would need to pass `purchased={true}` when the user has purchased the content. This data is **not currently available** on the explore/landing pages (only the library page knows purchase state). Therefore:

- **No caller changes in this PR**. The `purchased` prop defaults to `false`, so existing behaviour is preserved.
- A follow-up task can wire the `purchased` prop once the explore page fetches user access state (e.g. via `libraryCollection` or a server-side join).

---

## Testing Notes

### Manual verification

1. **Type icon overlay**: Load any page with ContentCard grid. Verify:
   - Bottom-left of each thumbnail shows the correct icon (play triangle for video, music note for audio, document for article).
   - The old uppercase text label ("VIDEO", "AUDIO", "ARTICLE") in the top-left is gone.
   - Icon is visible on both dark and light thumbnails (semi-transparent background).
   - Icon does not overlap with progress bar when present.

2. **Duration badge**: Verify the badge still renders correctly in the bottom-right. Check that it does not collide with the new type icon in the bottom-left. Verify it hides when `duration` is null.

3. **PriceBadge variants**: Use Storybook or the org landing page:
   - Free content (priceCents = 0) -> green "Free" badge.
   - Paid content (priceCents = 2900) -> neutral "£29.00" badge.
   - Purchased content (via Storybook `purchased` prop) -> blue "Purchased" badge with check icon.
   - No price (priceCents = null, no price prop) -> no badge shown.

4. **Hover animation**: Hover over a card in the grid. Verify:
   - Card scales up subtly (1.02x) — should feel polished, not jarring.
   - Shadow elevates from none to `--shadow-lg`.
   - No visual overlap with adjacent cards (z-index elevation).
   - Transition is smooth (~200ms ease-out).
   - With `prefers-reduced-motion: reduce` in browser DevTools: transitions are effectively instant.
   - Keyboard: Tab to a card link, verify the card gets the same visual elevation via `:focus-within`.

5. **Loading state**: Verify skeleton state still works — no icon/badge/hover changes during loading.

### Accessibility checks

- Type icon has `aria-label` with content type name.
- Duration badge already has `aria-label` — verify it still reads correctly.
- PriceBadge text is readable by screen readers (it renders visible text, not just visual styling).
- Hover scale animation respects `prefers-reduced-motion`.

### Responsive checks

- Cards at mobile width (1 column): hover animation still works on touch (`:hover` may not trigger on pure touch devices — this is acceptable; the static card is already fully readable).
- Thumbnail overlay elements (type icon bottom-left, duration bottom-right, price top-right) do not overlap at narrow card widths.
