# Reusable ContentCard Component -- Implementation Spec

## Summary

Refactor the existing `ContentCard` component into a multi-variant component that serves every content display context in the app. Today there is one `ContentCard` component used on 4 pages (org landing, org explore, creator profile, creator content catalog), but 3 other pages (platform library, org library, platform discover) use hand-rolled inline card markup with different HTML structures and CSS. The ContinueWatching section also uses its own dedicated `ContinueWatchingCard` component. This spec unifies all of these under a single `ContentCard` with four distinct variants: `explore` (default), `library`, `featured`, and `compact`.

## Feasibility

### Pros

- **Eliminates ~300 lines of duplicated inline card markup** across platform library, org library, and discover pages.
- **Single source of truth** for card styling, hover states, focus management, loading skeletons, and progress bars -- changes propagate everywhere.
- **Existing ContentCard already handles 80% of the job**: thumbnail with srcset, duration badge, type icon, price badge, progress bar, creator line, loading skeleton. The variant system layers on top.
- **Library and discover pages already use the same data shapes** (`ContentWithRelations` from the API or `LibraryItem` from the access package) -- no new data plumbing needed.
- **ContinueWatchingCard becomes `variant="compact"`** -- removes a dedicated single-use component.

### Gotchas & Risks

- **Backward compatibility is mandatory.** The existing `ContentCard` is imported by 4 page files. The default variant (`explore`) must produce identical output to the current component with no prop changes required at call sites.
- **Library pages use a different data shape.** Library items wrap content inside `item.content` with a sibling `item.progress`. The component cannot accept raw `LibraryItem` objects -- callers must continue to map fields to props. This is the correct approach: the component stays data-agnostic.
- **The inline library cards use `<a>` as the root element**, while the current ContentCard uses `<article>` with an absolutely-positioned link overlay. The overlay pattern is better for accessibility (content inside the card remains selectable) but the migration must preserve existing focus-visible outlines.
- **ContinueWatchingCard has scroll-snap alignment** (`scroll-snap-align: start`) which is a parent layout concern, not a card concern. The compact variant must not include snap behavior -- the parent `ContinueWatching` component should apply it via a wrapper class.
- **i18n strings differ.** The inline library cards use `m.content_progress_completed()` and `m.content_progress_percent()` while the current ContentCard uses the same messages. The discover page has no progress at all. No new i18n keys are needed.
- **The brand editor preview** (`BrandEditorShape.svelte`) references `content-card` as a CSS class name for shape preview cards. This is a different usage and does NOT import `ContentCard` -- no impact.

## Current State

### Existing ContentCard Component

**Location:** `apps/web/src/lib/components/ui/ContentCard/ContentCard.svelte`

**Current Props Interface:**
```typescript
interface Props extends HTMLAttributes<HTMLDivElement> {
  id: string;
  title: string;
  thumbnail?: string | null;
  description?: string | null;
  contentType?: 'video' | 'audio' | 'article';
  duration?: number | null;
  creator?: {
    username?: string;
    displayName?: string;
    avatar?: string | null;
  };
  actions?: Snippet;
  href?: string;
  loading?: boolean;
  progress?: {
    positionSeconds?: number;
    durationSeconds?: number;
    completed?: boolean;
    percentComplete?: number;
  } | null;
  price?: {
    amount: number;
    currency: string;
  } | null;
}
```

**Current features:**
- Vertical card layout with 16:9 thumbnail
- Thumbnail with responsive `srcset` via `getThumbnailSrcset()`
- Fallback placeholder icon per content type (Play/Music/FileText)
- Duration badge (bottom-right of thumbnail)
- Content type label (top-left of thumbnail)
- Price badge (top-right of thumbnail, green for free)
- Progress bar (bottom of thumbnail, with aria progressbar role)
- Progress text in body ("X% complete" or "Completed")
- Creator line with avatar and display name (links to profile)
- Loading skeleton state
- Overlay link pattern (full-card clickable, inner links z-indexed above)
- Actions snippet slot at bottom

### Pages Using ContentCard (4 pages)

| Page | Path | Props Passed | Notes |
|------|------|-------------|-------|
| Org Landing | `_org/[slug]/(space)/+page.svelte` | id, title, thumbnail, description, contentType, duration, creator, href, price | Up to 6 featured items |
| Org Explore | `_org/[slug]/(space)/explore/+page.svelte` | id, title, thumbnail, description, contentType, duration, creator, href, price | Full grid with search/filter/pagination |
| Creator Profile | `_creators/[username]/+page.svelte` | id, title, thumbnail, description, contentType, duration, href, price | No creator prop (already on creator's page) |
| Creator Content | `_creators/[username]/content/+page.svelte` | id, title, thumbnail, description, contentType, duration, href, price | Full catalog with search/filter/pagination |

### Pages Using Inline Card Markup (3 pages)

| Page | Path | Key Differences from ContentCard |
|------|------|--------------------------------|
| Platform Library | `(platform)/library/+page.svelte` | Data shape is `item.content.*` + `item.progress`. No price, no creator, no type badge, no duration badge. Has progress bar + progress text. Uses `<a>` as root, `translateY(-2px)` hover. |
| Org Library | `_org/[slug]/(space)/library/+page.svelte` | Identical structure to platform library. Hardcoded English strings ("Completed", "No thumbnail") -- should use i18n. |
| Platform Discover | `(platform)/discover/+page.svelte` | Minimal card: thumbnail, title, description, creator name (text only, no avatar). No price, duration, type, or progress. |

### ContinueWatchingCard (dedicated component)

**Location:** `apps/web/src/lib/components/library/ContinueWatchingCard.svelte`

- Horizontal scroll item with fixed min/max width (220-300px)
- 16:9 thumbnail with progress bar
- Title (single-line clamp) + "Resume from X:XX" text
- No description, no creator, no price, no type badge
- `scroll-snap-align: start` (parent layout concern)

## Design Spec

### Props Interface

```typescript
interface Props extends HTMLAttributes<HTMLElement> {
  /** Unique content identifier */
  id: string;

  /** Content title (required) */
  title: string;

  /**
   * Display variant controlling layout and visible elements.
   * - 'explore': Default vertical card for browse/discovery grids
   * - 'library': Progress-focused vertical card (no price, shows completion)
   * - 'featured': Larger vertical card with description and CTA
   * - 'compact': Horizontal layout for sidebars and scroll rows
   */
  variant?: 'explore' | 'library' | 'featured' | 'compact';

  /** Thumbnail image URL (base URL -- srcset generated automatically) */
  thumbnail?: string | null;

  /** Content description text */
  description?: string | null;

  /** Content type -- controls placeholder icon and type badge */
  contentType?: 'video' | 'audio' | 'article';

  /** Duration in seconds -- shown as badge on thumbnail */
  duration?: number | null;

  /** Creator information -- shown as avatar + name line */
  creator?: {
    username?: string;
    displayName?: string;
    avatar?: string | null;
  };

  /** Category label -- shown as pill badge (explore/featured variants) */
  category?: string | null;

  /** Link URL for the card */
  href?: string;

  /** Show loading skeleton state */
  loading?: boolean;

  /** Playback progress data -- controls progress bar and completion text */
  progress?: {
    positionSeconds?: number;
    durationSeconds?: number;
    completed?: boolean;
    percentComplete?: number;
  } | null;

  /**
   * Price information.
   * - null: price badge hidden entirely
   * - { amount: 0, currency: 'GBP' }: shows "Free" badge
   * - { amount: 1500, currency: 'GBP' }: shows "£15.00" badge
   */
  price?: {
    amount: number;
    currency: string;
  } | null;

  /** CTA button text -- only rendered in 'featured' variant */
  ctaText?: string;

  /** Actions snippet slot -- rendered below the body */
  actions?: Snippet;

  /** Resume time text -- only rendered in 'compact' variant (e.g., "Resume from 12:34") */
  resumeText?: string | null;
}
```

### Variant: Explore (default)

This is the current ContentCard behavior, preserved exactly for backward compatibility.

**Layout:** Vertical card. 16:9 thumbnail on top, body below.

**Visible elements:**
- Thumbnail with responsive srcset
- Content type label (top-left overlay, uppercase)
- Duration badge (bottom-right overlay)
- Price badge (top-right overlay) -- only if `price` prop is non-null
- Category pill (below title, above creator) -- only if `category` prop is non-null
- Progress bar at bottom of thumbnail -- only if progress data exists
- Title (2-line clamp)
- Description (2-line clamp, if provided)
- Progress text ("X% complete" / "Completed") -- only if progress data exists
- Creator line (avatar + name, links to `/@username`)
- Actions slot

**Responsive behavior:**
- Cards fill grid columns determined by the parent container
- No card-internal breakpoints -- width is always 100% of its grid cell
- Minimum effective width ~220px (parent grid `minmax(280px, 1fr)` handles this)

**CSS specifics:**
- `background: var(--color-surface)`
- `border: var(--border-width) var(--border-style) var(--color-border)`
- `border-radius: var(--radius-lg)`
- Hover: `border-color: var(--color-border-hover)`, `box-shadow: var(--shadow-md)`
- Full-card link overlay pattern (existing)

### Variant: Library

**Layout:** Vertical card. Identical structure to explore but tuned for owned content.

**Visible elements:**
- Thumbnail with responsive srcset (NO type label, NO price badge)
- Duration badge (bottom-right overlay) -- only if provided
- Progress bar at bottom of thumbnail -- prominent, always shown if progress exists
- Title (2-line clamp)
- Description (2-line clamp, if provided)
- Progress text with completion state:
  - Not started (no progress): no text
  - In progress: "X% complete"
  - Completed: "Completed" in success color
- Creator line (avatar + name) -- only if provided

**Hidden elements (compared to explore):**
- Content type badge (top-left) -- NOT shown
- Price badge -- NEVER shown (user already owns it)
- Category pill -- NOT shown
- Actions slot -- NOT rendered

**Progress bar differences from explore:**
- Track uses `var(--color-surface-tertiary)` for higher contrast (user needs to see progress clearly)
- Fill uses `var(--color-interactive)`
- Completed state: fill uses `var(--color-success)` at 100%

**Responsive behavior:** Same as explore -- parent grid controls width.

**CSS specifics:**
- Hover: `transform: translateY(-2px)`, `box-shadow: var(--shadow-md)` (matches current inline library card hover)
- Progress text `.content-card__progress-text--completed` gets `color: var(--color-success)`

### Variant: Featured

**Layout:** Vertical card, larger. Same column flow but with more padding and a CTA button.

**Visible elements:**
- Thumbnail with responsive srcset (larger aspect ratio -- still 16:9 but parent grid gives more width)
- Content type label (top-left overlay)
- Duration badge (bottom-right overlay)
- Price badge (top-right overlay) -- if provided
- Title (2-line clamp, larger font: `var(--text-lg)`)
- Description (3-line clamp -- more visible than explore's 2 lines)
- Creator line (avatar + name)
- CTA button: rendered if `ctaText` prop is provided
  - Styled as `var(--color-interactive)` background, `var(--color-text-on-brand)` text
  - `border-radius: var(--radius-md)`, `padding: var(--space-2) var(--space-4)`
  - Hover: `var(--color-interactive-hover)`
  - Positioned at the bottom of the body, pushed down by `margin-top: auto`
  - The CTA link wraps the same `href` as the card overlay link (redundant for UX -- visible CTA is more inviting)

**Hidden elements (compared to explore):**
- Category pill -- NOT shown (featured cards rely on visual hierarchy, not labels)

**Responsive behavior:**
- On mobile (`@media (--below-sm)`): title drops to `var(--text-base)`, description clamps to 2 lines, CTA padding reduces to `var(--space-2) var(--space-3)`

**CSS specifics:**
- Body padding: `var(--space-4)` (vs `var(--space-3)` for explore)
- Title: `font-size: var(--text-lg)`, `font-weight: var(--font-bold)`
- Description: `-webkit-line-clamp: 3`
- CTA button: z-index 2 (above overlay link), `font-weight: var(--font-semibold)`

### Variant: Compact

**Layout:** Horizontal. Thumbnail on the left (fixed width), body on the right.

**Visible elements:**
- Thumbnail (fixed width, 16:9 aspect via height constraint, `border-radius` on left side only)
- Progress bar at bottom of thumbnail -- if progress exists
- Title (1-line clamp, `var(--text-sm)`)
- Resume text (e.g., "Resume from 12:34") -- only if `resumeText` prop is provided
- Description (1-line clamp, `var(--text-xs)`) -- only if provided and no resumeText
- Creator name (text only, no avatar, `var(--text-xs)`) -- only if provided and no resumeText

**Hidden elements (compared to explore):**
- Content type badge -- NOT shown
- Duration badge -- NOT shown
- Price badge -- NOT shown
- Category pill -- NOT shown
- Actions slot -- NOT rendered

**Responsive behavior:**
- Thumbnail width: `var(--space-24)` (96px) at `@media (--below-sm)`, `var(--space-32)` (128px) at `@media (--breakpoint-sm)` and above
- Entire card is a single `<a>` style link (no overlay pattern needed since all content is non-interactive)

**CSS specifics:**
```css
.content-card[data-variant="compact"] {
  flex-direction: row;
  align-items: stretch;
}

.content-card[data-variant="compact"] .content-card__thumbnail {
  width: var(--space-32);
  min-width: var(--space-32);
  aspect-ratio: auto;
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
}

.content-card[data-variant="compact"] .content-card__body {
  padding: var(--space-2) var(--space-3);
  justify-content: center;
}

.content-card[data-variant="compact"] .content-card__title {
  font-size: var(--text-sm);
  -webkit-line-clamp: 1;
}
```

### Shared Elements (all variants)

These elements are structurally present in every variant. Visibility is controlled via `display: none` per variant using `data-variant` attribute selectors.

**Thumbnail:**
- Always has `overflow: hidden`, `background: var(--color-surface-secondary)`
- Image uses `getThumbnailSrcset()` and `DEFAULT_SIZES` for responsive loading
- Fallback: content-type icon (PlayIcon/MusicIcon/FileTextIcon) centered in placeholder
- Image `onerror` handler hides the `<img>` and shows the placeholder

**Title:**
- Always an `<h3>` inside the body
- Inner `<a>` with `z-index: 2` (above card overlay) for direct text click
- `color: inherit`, hover: `color: var(--color-interactive)`

**Creator line:**
- Avatar component (24px / `var(--space-6)`) + display name
- Entire line is an `<a>` to `/@{username}` with `z-index: 2`
- `margin-top: auto` pushes it to the bottom of flex body
- Compact variant: name-only text span, no avatar, no link

**Progress bar:**
- Absolutely positioned at bottom of thumbnail
- Track: `height: var(--space-1)`, `background: var(--color-overlay-light)`
- Fill: `background: var(--color-interactive)`, `transition: width var(--duration-slow) var(--ease-default)`
- ARIA: `role="progressbar"`, `aria-valuenow`, `aria-valuemin=0`, `aria-valuemax=100`

**Loading skeleton:**
- Same skeleton structure regardless of variant
- Thumbnail: full-height `<Skeleton />`
- Body: 3 skeleton lines (75%, 50%, 60% width)
- Compact variant: horizontal skeleton with thumbnail-width block + 2 body lines

### Responsive Behavior

The card itself is always 100% width of its grid cell. Responsive layout is a **parent responsibility**. The grids across the codebase follow a consistent pattern:

```css
/* All pages use this same grid pattern */
.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-6);
}

@media (--breakpoint-sm) {
  .grid { grid-template-columns: repeat(2, 1fr); }
}

@media (--breakpoint-lg) {
  .grid { grid-template-columns: repeat(3, 1fr); }
}
```

**Card-internal responsive adjustments:**

| Breakpoint | Explore | Library | Featured | Compact |
|-----------|---------|---------|----------|---------|
| `--below-sm` | No changes | No changes | Title to `--text-base`, desc 2-line clamp, CTA padding reduced | Thumbnail width `var(--space-24)` |
| `--breakpoint-sm`+ | No changes | No changes | Full size | Thumbnail width `var(--space-32)` |

## Implementation Plan

### Variant Selection Mechanism

Use a `data-variant` attribute on the root element for CSS variant selection:

```svelte
<article
  class="content-card {className ?? ''}"
  data-variant={variant}
  data-loading={loading || undefined}
  {...rest}
>
```

CSS uses attribute selectors for variant-specific overrides:

```css
/* Base styles apply to all variants */
.content-card { ... }

/* Variant-specific overrides */
.content-card[data-variant="compact"] { flex-direction: row; }
.content-card[data-variant="featured"] .content-card__body { padding: var(--space-4); }
.content-card[data-variant="library"] .content-card__type { display: none; }
.content-card[data-variant="library"] .content-card__price-badge { display: none; }
```

This pattern is already used in the codebase (e.g., `Button` uses `data-variant`, `data-size`).

### Element Visibility per Variant

| Element | explore | library | featured | compact |
|---------|---------|---------|----------|---------|
| Thumbnail | yes | yes | yes | yes (fixed width) |
| Type label | yes | **no** | yes | **no** |
| Duration badge | yes | yes | yes | **no** |
| Price badge | if prop set | **no** | if prop set | **no** |
| Category pill | if prop set | **no** | **no** | **no** |
| Progress bar | if progress | if progress | if progress | if progress |
| Title | 2-line | 2-line | 2-line (larger) | 1-line |
| Description | 2-line | 2-line | 3-line | 1-line (if no resumeText) |
| Progress text | if progress | if progress | if progress | **no** |
| Resume text | **no** | **no** | **no** | if prop set |
| Creator (full) | if prop set | if prop set | if prop set | **no** |
| Creator (name) | **no** | **no** | **no** | if prop set (text only) |
| CTA button | **no** | **no** | if ctaText set | **no** |
| Actions slot | if snippet | **no** | if snippet | **no** |

Hidden elements use `display: none` via CSS `data-variant` selectors rather than Svelte `{#if}` blocks, keeping the template simple and avoiding variant-specific conditional nesting.

Exception: `ctaText`, `resumeText`, and `category` use `{#if}` because they are variant-exclusive content that has no markup in other variants.

### Files to Create

None. All changes are to existing files.

### Files to Modify

**1. `apps/web/src/lib/components/ui/ContentCard/ContentCard.svelte`**

The core change. Extend the Props interface with `variant`, `category`, `ctaText`, and `resumeText`. Add the `data-variant` attribute to the root element. Add CSS for variant overrides. Add the category pill markup, CTA button markup, and resume text markup (conditionally rendered).

Key implementation details:
- Default `variant` to `'explore'` for full backward compatibility
- The `explore` variant CSS must produce identical output to the current component
- Compact variant changes `flex-direction` to `row` on the root
- Featured variant increases body padding, title size, and description clamp
- Library variant hides type label and price badge via `display: none`

**2. `apps/web/src/lib/components/ui/ContentCard/ContentCard.stories.svelte`**

Add stories for each variant:
- "Library With Progress" -- shows progress bar and completion text
- "Library Completed" -- shows completed state
- "Featured With CTA" -- shows larger card with CTA button
- "Compact" -- shows horizontal layout
- "Compact With Resume" -- shows resume time text
- "All Variants Grid" -- shows all 4 variants side by side

**3. `apps/web/src/routes/(platform)/library/+page.svelte`**

Replace the inline card markup (lines 194-242) with `ContentCard` usage:
```svelte
<ContentCard
  variant="library"
  id={item.content.id}
  title={item.content.title}
  thumbnail={item.content.thumbnailUrl}
  description={item.content.description}
  contentType={item.content.contentType === 'written' ? 'article' : item.content.contentType}
  duration={item.content.durationSeconds}
  href={buildContentUrl(page.url, item.content)}
  progress={item.progress ? {
    positionSeconds: item.progress.positionSeconds,
    durationSeconds: item.progress.durationSeconds,
    completed: item.progress.completed,
    percentComplete: item.progress.percentComplete,
  } : null}
/>
```

Remove the following inline CSS classes from the page: `.content-card`, `.card-thumb`, `.thumb-img`, `.thumb-placeholder`, `.placeholder-text`, `.progress-track`, `.progress-fill`, `.card-body`, `.card-title`, `.card-desc`, `.card-progress`, `.progress-completed`, `.skeleton-card`, `.skeleton-thumb`, `.skeleton-line`, `.skeleton-line-title`, `.skeleton-line-subtitle`, and the `@keyframes pulse` block. Keep the `.content-grid`, `.library`, `.library-title`, sort/filter/pagination, and empty state styles.

Also replace the skeleton loading block (lines 143-151) with:
```svelte
{#each Array(6) as _}
  <ContentCard variant="library" id="" title="" loading />
{/each}
```

**4. `apps/web/src/routes/_org/[slug]/(space)/library/+page.svelte`**

Same migration as the platform library page. Replace inline card markup with `ContentCard variant="library"`. Remove duplicate inline CSS. This page also has hardcoded English strings ("Completed", "No thumbnail") that will be fixed by the migration since ContentCard uses i18n messages.

**5. `apps/web/src/routes/(platform)/discover/+page.svelte`**

Replace inline card markup (lines 61-79) with `ContentCard`:
```svelte
<ContentCard
  id={item.id}
  title={item.title}
  thumbnail={item.mediaItem?.thumbnailUrl}
  description={item.description}
  creator={item.creator?.name ? { displayName: item.creator.name } : undefined}
  href={buildContentUrl(page.url, { slug: item.slug, id: item.id, organizationSlug: item.organization?.slug })}
/>
```

Remove the inline CSS classes: `.content-card`, `.card-thumb`, `.thumb-img`, `.thumb-placeholder`, `.card-body`, `.card-title`, `.card-desc`, `.card-creator`. Keep `.discover`, `.content-grid`, search styles.

**6. `apps/web/src/lib/components/library/ContinueWatchingCard.svelte`**

Refactor to use `ContentCard variant="compact"`:
```svelte
<ContentCard
  variant="compact"
  id={item.content.id}
  title={item.content.title}
  thumbnail={item.content.thumbnailUrl}
  href={buildContentUrl(page.url, item.content)}
  progress={item.progress ? {
    positionSeconds: item.progress.positionSeconds,
    durationSeconds: item.progress.durationSeconds,
    completed: item.progress.completed,
    percentComplete: item.progress.percentComplete,
  } : null}
  resumeText={m.library_resume_from({ time: resumeTime })}
  class="cw-card-wrapper"
/>
```

The component file is kept (it handles the derived resume time calculation and the snap wrapper class), but its internal markup becomes a single `ContentCard` call. The `scroll-snap-align: start` and min/max width constraints move to a wrapping `<div>` or are applied via the `class` prop.

**7. `apps/web/src/routes/_org/[slug]/(space)/+page.svelte`** (no changes needed)

Already uses ContentCard correctly. The `explore` variant (default) matches current behavior exactly.

**8. `apps/web/src/routes/_org/[slug]/(space)/explore/+page.svelte`** (no changes needed)

Already uses ContentCard correctly.

**9. `apps/web/src/routes/_creators/[username]/+page.svelte`** (no changes needed)

Already uses ContentCard correctly.

**10. `apps/web/src/routes/_creators/[username]/content/+page.svelte`** (no changes needed)

Already uses ContentCard correctly.

### Migration Order

1. **Phase 1: Extend ContentCard** -- Add variant prop, new markup, and variant CSS. Verify `explore` (default) is pixel-identical to current output.
2. **Phase 2: Migrate library pages** -- Platform library, then org library. Both use the same data shape.
3. **Phase 3: Migrate discover page** -- Simpler migration (fewer fields).
4. **Phase 4: Migrate ContinueWatchingCard** -- Refactor to use compact variant.
5. **Phase 5: Update stories** -- Add all variant stories.

Each phase is independently deployable. Phase 1 introduces no breaking changes. Phases 2-4 can be done in any order.

## Testing Notes

- **Visual regression**: After Phase 1, the org landing, explore, creator profile, and creator content pages must render identically. No prop changes at call sites means zero visual diff.
- **Library migration**: After Phase 2, verify progress bars display correctly for in-progress, completed, and not-started states. Verify the hover effect matches the previous `translateY(-2px)` behavior. Verify i18n strings replace the hardcoded English in the org library page.
- **Discover migration**: After Phase 3, verify cards with and without thumbnails, with and without creator names, and with and without descriptions all render correctly.
- **Compact migration**: After Phase 4, verify the ContinueWatching horizontal scroll still works (snap alignment, min/max widths). Verify the resume time text appears correctly.
- **Accessibility**: All variants must maintain `role="progressbar"` with correct aria attributes. The overlay link pattern must have `sr-only` text. Focus-visible outlines must work on all interactive elements.
- **Loading states**: Test `loading={true}` on all 4 variants. The compact variant needs a horizontal skeleton layout.
- **Missing data**: Test all optional props as `null`/`undefined` on every variant. Cards must degrade gracefully (no empty badges, no broken layout from missing thumbnails).
- **Dark mode / org branding**: Verify all variants respect `--color-*` tokens and org brand overrides. No hardcoded colors.
