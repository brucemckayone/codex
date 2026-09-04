# Library Improvements — Implementation Spec

## Summary

Three medium-effort improvements to the library experience across both the platform library (`(platform)/library/`) and the org-scoped library (`_org/[slug]/(space)/library/`):

1. **Library card variant** (1.20) — A progress-focused card designed for library context: shows progress bar overlay, time remaining or completion state, and NO price. Replaces the inline card markup currently duplicated in both library pages.
2. **Continue Watching as dominant first section** (1.21) — Elevate the existing `ContinueWatching` component to be the top-of-page hero section with larger cards and a "Resume" action. Auto-hides when the user has no in-progress items.
3. **Org-scoped library filter wiring** — The library API already supports `?organizationId=`, `?filter=in_progress|completed|not_started`, `?sortBy=recent|title|duration`, `?accessType=`, and `?search=`. The org library page already passes `organizationId` and wires all filters. Verify parity, ensure ContinueWatching is added, and adopt the new library card.

---

## Feasibility

### Pros

- **API is ready.** The `listUserLibrarySchema` already accepts `organizationId`, `filter` (progress status), `sortBy`, `contentType`, `accessType`, and `search`. The org library server loader already passes `organizationId` and all filter params. No backend changes are needed.
- **ContinueWatching component exists.** It filters in-progress items, sorts by `updatedAt`, and renders up to 4 `ContinueWatchingCard` items. The platform library already renders it — the org library just needs to add it.
- **ContentCard exists as a reference.** The shared `ContentCard` component already supports `progress`, `price`, `creator`, `duration`, `contentType`, and `loading` props. The new `LibraryCard` can follow the same prop pattern but omit price and emphasize progress.
- **Both library pages share identical card markup.** The inline `.content-card` markup in both `+page.svelte` files is nearly identical — extracting it into a reusable `LibraryCard` component is a clean refactor that reduces duplication.
- **Filter state is already URL-driven.** Both library pages use `goto()` with URL params for all filter/sort state. `LibraryFilters` already renders content type, progress status, access type, and search controls.

### Gotchas & Risks

- **Platform library data shape mismatch.** The platform library `+page.server.ts` returns `{ items, total, page, limit }` (flat), while the org library returns `{ items, pagination: { page, limit, total, totalPages } }`. The `LibraryCard` component must accept a `LibraryItem` regardless, but the platform page derives pagination differently from the org page. This existing inconsistency should not block the card extraction but should be noted.
- **ContinueWatching on org page requires live query data.** The platform library page uses `useLiveQuery` over `libraryCollection` to feed `ContinueWatching`. The org library page currently uses only server-loaded data (`data.library.items`). To add `ContinueWatching` to the org library, we can pass the server items directly (no live query needed since the org page shows a scoped subset, not the full cross-device-synced library). However, this means the org page's "Continue Watching" section will not update in real-time as the user watches content — it will reflect the state at page load. This is acceptable for the org-scoped view.
- **ContinueWatching card size increase.** Making the cards larger in the hero section means adjusting `min-width`/`max-width` on `ContinueWatchingCard` or creating a size variant. The current card has `min-width: 220px; max-width: 300px`. The hero treatment should allow wider cards.
- **Time remaining calculation.** The `UserLibraryItem` shape includes `progress.durationSeconds` and `progress.positionSeconds`. Calculating "X min left" requires `(durationSeconds - positionSeconds) / 60`. The `formatDurationHuman` utility already exists in `$lib/utils/format` and handles this conversion.

---

## Current State

### Platform Library Page (`(platform)/library/+page.svelte`)

**Layout order:**
1. Page title ("My Library")
2. Error banner (if error)
3. Loading skeleton (if loading and no items)
4. Empty state (if no items at all)
5. Sort dropdown (Select component, 4 options: recent purchase, recent watched, A-Z, Z-A)
6. `LibraryFilters` component (content type pills, progress status pills, search input)
7. `ContinueWatching` component (horizontal row of up to 4 in-progress cards)
8. Content grid (3-column responsive grid of inline card markup)
9. Pagination

**Data loading:**
- Server load fetches from `api.access.getUserLibrary(params)` with page, limit (12), sortBy, contentType, filter (progress status), and search.
- Client hydrates `libraryCollection` on mount, then uses `useLiveQuery` for the `ContinueWatching` section.
- Sort maps: `az`/`za` -> `title`, `watched`/`recent` -> `recent` (API sortBy).

**Card markup (inline):**
- 16:9 thumbnail with progress bar overlay at bottom.
- Card body: title (2-line clamp), description (2-line clamp), progress text ("X% complete" or "Completed" in green).
- No price display (correct for library).
- No creator info, no duration badge, no content type badge.

### Org Library Page (`_org/[slug]/(space)/library/+page.svelte`)

**Layout order:**
1. Header row: org name + "Library" title, "View full library" link
2. Error banner (if error)
3. Empty state (if no items and no filters)
4. Sort dropdown (same 4 options)
5. `LibraryFilters` component (content type, progress status, access type, search)
6. Content grid (identical inline card markup to platform page)
7. Pagination

**Differences from platform library:**
- **No ContinueWatching section** — this is the primary gap to address.
- **Has access type filter** (`purchased` / `membership`) — platform library does not expose this.
- **Passes `organizationId`** to the API — already wired in server loader.
- **No TanStack DB hydration** — uses server data directly (no `useLiveQuery`, no `onMount` hydration).
- **Inline card markup is duplicated** — same HTML structure as platform page.

### Library API Schema (`listUserLibrarySchema`)

```typescript
{
  page: number,           // pagination
  limit: number,          // pagination
  organizationId?: string,  // UUID, scopes to org
  filter: 'all' | 'in_progress' | 'completed' | 'not_started',  // default 'all'
  sortBy: 'recent' | 'title' | 'duration',                       // default 'recent'
  contentType: 'all' | 'video' | 'audio' | 'article',            // default 'all'
  accessType: 'all' | 'purchased' | 'membership',                // default 'all'
  search: string,         // max 200 chars, default ''
}
```

### Library Item Shape (`UserLibraryItem`)

```typescript
{
  content: {
    id: string;
    slug: string;
    title: string;
    description: string;
    thumbnailUrl: string | null;
    contentType: string;
    durationSeconds: number;
    organizationSlug: string | null;
  };
  accessType: 'purchased' | 'membership';
  purchase: {
    purchasedAt: string;
    priceCents: number;
  } | null;
  progress: {
    positionSeconds: number;
    durationSeconds: number;
    completed: boolean;
    percentComplete: number;
    updatedAt: string;
  } | null;
}
```

### Existing Components

| Component | Location | Role |
|-----------|----------|------|
| `ContinueWatching` | `$lib/components/library/ContinueWatching.svelte` | Horizontal row of up to 4 in-progress items, auto-hides when empty |
| `ContinueWatchingCard` | `$lib/components/library/ContinueWatchingCard.svelte` | Card with thumbnail, progress bar, title, "Resume from X:XX" |
| `ContentCard` | `$lib/components/ui/ContentCard/ContentCard.svelte` | General-purpose card with thumbnail, price badge, creator info, progress — used on explore pages |
| `LibraryFilters` | `$lib/components/library/LibraryFilters.svelte` | Content type, progress status, access type pills + search input |

---

## Design Spec

### 1. Library Card Variant

A new `LibraryCard` component that replaces the duplicated inline card markup in both library pages. This card is designed for the library context where the user already owns the content, so it emphasizes progress and time rather than price.

#### Visual Design

```
+------------------------------------------+
|  [16:9 Thumbnail]                        |
|  ┌──────────────── progress bar ───────┐ |
|  └─────────────────────────────────────┘ |
|                                          |
|  Content Title (2-line clamp)            |
|  Creator Name              [Video] 45m   |
|                                          |
|  ● 67% complete · 23 min left            |
|   — or —                                 |
|  ✓ Completed                             |
|   — or —                                 |
|  (no progress line for not_started)      |
+------------------------------------------+
```

#### Key Differences from ContentCard (Explore)

| Feature | ContentCard (Explore) | LibraryCard (Library) |
|---------|----------------------|-----------------------|
| Price badge | Yes (top-right overlay) | No — user owns it |
| Creator info | Avatar + name (linked) | Name only (text, no avatar) |
| Content type badge | Top-left overlay | Inline text beside duration |
| Duration | Bottom-right overlay on thumbnail | Inline text beside content type |
| Progress bar | Optional, thin overlay | Always shown (even at 0%) |
| Progress text | "X% complete" | "X% complete - Y min left" or "Completed" with checkmark |
| Completion badge | None | Green checkmark + "Completed" text |
| Description | 2-line clamp | Omitted — title and progress are enough context |

#### Props Interface

```typescript
interface Props {
  item: LibraryItem;
  href: string;
}
```

The component receives the full `LibraryItem` and extracts everything it needs from `item.content` and `item.progress`. This keeps the API surface minimal — the parent page is responsible for computing `href` via `buildContentUrl()`.

#### Progress Display Logic

```typescript
const progressPercent = $derived.by(() => {
  if (!item.progress) return 0;
  if (item.progress.completed) return 100;
  if (item.progress.percentComplete != null) return item.progress.percentComplete;
  if (item.progress.durationSeconds > 0) {
    return Math.round((item.progress.positionSeconds / item.progress.durationSeconds) * 100);
  }
  return 0;
});

const timeRemaining = $derived.by(() => {
  if (!item.progress || item.progress.completed) return null;
  const remaining = item.progress.durationSeconds - item.progress.positionSeconds;
  if (remaining <= 0) return null;
  return formatDurationHuman(remaining);
});

const isCompleted = $derived(item.progress?.completed ?? false);
const hasStarted = $derived(
  item.progress != null && item.progress.positionSeconds > 0
);
```

#### Progress State Display

| State | Progress bar | Text |
|-------|-------------|------|
| Not started (no progress) | Full track, no fill | No progress line shown |
| In progress | Partial fill at X% | "X% complete - Y min left" |
| Completed | Full fill (100%) with success color | Checkmark icon + "Completed" in `--color-success` |

#### CSS Structure

```css
.library-card {
  display: block;
  background-color: var(--color-surface);
  border-radius: var(--radius-lg);
  overflow: hidden;
  text-decoration: none;
  border: var(--border-width) var(--border-style) var(--color-border);
  transition: var(--transition-transform), var(--transition-shadow);
}

.library-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.library-card:focus-visible {
  outline: var(--border-width-thick) solid var(--color-focus);
  outline-offset: 2px;
}

.library-card__thumb {
  position: relative;
  aspect-ratio: 16 / 9;
  background-color: var(--color-surface-secondary);
  overflow: hidden;
}

.library-card__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.library-card__progress-track {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: var(--space-1);
  background: var(--color-overlay-light);
}

.library-card__progress-fill {
  height: 100%;
  background-color: var(--color-interactive);
  transition: width var(--duration-slow) var(--ease-default);
}

.library-card__progress-fill--completed {
  background-color: var(--color-success);
}

.library-card__body {
  padding: var(--space-3) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.library-card__title {
  margin: 0;
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  color: var(--color-text);
  line-height: var(--leading-tight);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.library-card:hover .library-card__title {
  color: var(--color-interactive);
  transition: var(--transition-colors);
}

.library-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.library-card__creator {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.library-card__type-duration {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  white-space: nowrap;
  flex-shrink: 0;
}

.library-card__progress-status {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--color-text-secondary);
}

.library-card__progress-status--completed {
  color: var(--color-success);
}
```

#### Markup

```svelte
<a {href} class="library-card">
  <div class="library-card__thumb">
    {#if item.content.thumbnailUrl}
      <img
        src={item.content.thumbnailUrl}
        alt={item.content.title}
        class="library-card__image"
        loading="lazy"
        onerror={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    {:else}
      <div class="library-card__placeholder">
        {#if item.content.contentType === 'video'}
          <PlayIcon size={32} />
        {:else if item.content.contentType === 'audio'}
          <MusicIcon size={32} />
        {:else}
          <FileTextIcon size={32} />
        {/if}
      </div>
    {/if}

    {#if hasStarted || isCompleted}
      <div
        class="library-card__progress-track"
        role="progressbar"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          class="library-card__progress-fill"
          class:library-card__progress-fill--completed={isCompleted}
          style="width: {progressPercent}%"
        ></div>
      </div>
    {/if}
  </div>

  <div class="library-card__body">
    <h3 class="library-card__title">{item.content.title}</h3>

    <div class="library-card__meta">
      {#if item.content.creator}
        <span class="library-card__creator">{item.content.creator}</span>
      {/if}
      <span class="library-card__type-duration">
        {contentTypeLabel}
        {#if item.content.durationSeconds}
          · {formatDurationHuman(item.content.durationSeconds)}
        {/if}
      </span>
    </div>

    {#if isCompleted}
      <div class="library-card__progress-status library-card__progress-status--completed">
        <CheckIcon size={14} />
        {m.content_progress_completed()}
      </div>
    {:else if hasStarted}
      <div class="library-card__progress-status">
        {m.content_progress_percent({ percent: progressPercent })}
        {#if timeRemaining}
          · {m.library_time_remaining({ time: timeRemaining })}
        {/if}
      </div>
    {/if}
  </div>
</a>
```

---

### 2. Continue Watching Prominence

The `ContinueWatching` component already exists and works correctly. The improvement is to make it the dominant first section of the library page, with larger visuals and a clearer call-to-action.

#### Current State

- Renders between `LibraryFilters` and the content grid (after filters and sort).
- Uses `ContinueWatchingCard` with `min-width: 220px; max-width: 300px`.
- Shows up to 4 items in a horizontal scroll row.
- Auto-hides when no in-progress items exist.

#### Target State

- Renders **above** the sort dropdown and filters — it is the first thing the user sees.
- Section title "Continue Watching" uses a larger heading size.
- Cards are wider (larger thumbnails) for visual prominence.
- Each card includes a "Resume" button (visual affordance, links to same content URL).
- The horizontal row adapts: 1 card per row on mobile, 2 on tablet, up to 4 on desktop.
- Auto-hides when empty (no change to this behavior).

#### Changes to `ContinueWatching.svelte`

Add a `variant` prop to support the prominent layout:

```typescript
interface Props {
  items: LibraryItem[];
  variant?: 'default' | 'prominent';
}

const { items, variant = 'default' }: Props = $props();
```

When `variant="prominent"`:
- Section title uses `--text-2xl` instead of `--text-xl`.
- The row uses CSS grid instead of flex for more controlled sizing.
- Cards are allowed to grow wider (`max-width: 400px`).
- A thin top border separator appears below the section (before filters).

#### Changes to `ContinueWatchingCard.svelte`

Add a `size` prop:

```typescript
interface Props {
  item: LibraryItem;
  size?: 'default' | 'large';
}

const { item, size = 'default' }: Props = $props();
```

When `size="large"`:
- Card `min-width` increases to `280px`, `max-width` to `400px`.
- Title allows 2-line clamp instead of 1.
- Add a "Resume" pseudo-button below the resume time text:

```svelte
{#if size === 'large'}
  <span class="cw-card__resume-btn">
    <PlayIcon size={14} />
    {m.library_resume()}
  </span>
{/if}
```

Styled as a small pill:

```css
.cw-card__resume-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-top: var(--space-2);
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--color-interactive);
  background-color: transparent;
  border: var(--border-width) var(--border-style) var(--color-interactive);
  border-radius: var(--radius-full);
  transition: var(--transition-colors);
}

.cw-card:hover .cw-card__resume-btn {
  background-color: var(--color-interactive);
  color: var(--color-text-inverse);
}
```

#### Layout Changes in Both Library Pages

Move `<ContinueWatching>` to render immediately after the page title, before the sort dropdown and filters:

```svelte
<!-- Before (current) -->
<LibraryFilters ... />
<ContinueWatching items={...} />
<div class="content-grid">...</div>

<!-- After -->
<ContinueWatching items={...} variant="prominent" />
<div class="sort-bar">...</div>
<LibraryFilters ... />
<div class="content-grid">...</div>
```

#### Prominent Row CSS (in `ContinueWatching.svelte`)

```css
.continue-watching--prominent .continue-watching__row {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-4);
  overflow-x: visible;
  scroll-snap-type: none;
}

@media (--breakpoint-sm) {
  .continue-watching--prominent .continue-watching__row {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (--breakpoint-lg) {
  .continue-watching--prominent .continue-watching__row {
    grid-template-columns: repeat(4, 1fr);
  }
}

.continue-watching--prominent {
  padding-bottom: var(--space-6);
  margin-bottom: var(--space-6);
  border-bottom: var(--border-width) var(--border-style) var(--color-border);
}

.continue-watching--prominent .continue-watching__title {
  font-size: var(--text-2xl);
}
```

---

### 3. Org Library Filter Wiring

The org library page already has all API parameters wired. This section documents the current wiring for verification and identifies the remaining work: adding `ContinueWatching` and adopting `LibraryCard`.

#### Already Wired (Verify Only)

| API Param | URL Param | Wired in Server Loader | Wired in LibraryFilters |
|-----------|-----------|----------------------|------------------------|
| `organizationId` | (from parent layout `org.id`) | Yes, line 65 | N/A (implicit) |
| `filter` | `?progress=in_progress\|completed\|not_started` | Yes, mapped from `progressStatus` | Yes, progress pills |
| `sortBy` | `?sort=recent\|az\|za\|watched` | Yes, via `parseSortParam()` | Yes, Sort Select |
| `contentType` | `?type=video\|audio\|article` | Yes | Yes, content type pills |
| `accessType` | `?access=purchased\|membership` | Yes | Yes, access type pills |
| `search` | `?q=term` | Yes | Yes, search input |
| `page` | `?page=N` | Yes | Via Pagination component |
| `limit` | (hardcoded 12) | Yes | N/A |

All filter parameters are already being passed to the API and represented in the UI. The `LibraryFilters` component handles all four filter dimensions (content type, progress, access type, search).

#### Remaining Work

1. **Add `ContinueWatching` to org library page.** Pass `filteredItems` (from `data.library.items`) as the `items` prop with `variant="prominent"`. Unlike the platform page, this does not need `useLiveQuery` — server data is sufficient for the org-scoped view.

2. **Replace inline card markup with `LibraryCard` component.** Both pages currently duplicate ~30 lines of card HTML. Replace with:

```svelte
{#each filteredItems as item (item.content.id)}
  <LibraryCard {item} href={buildContentUrl(page.url, item.content)} />
{/each}
```

3. **Verify URL param reset on filter change.** The org page's `handleFilterChange` does not explicitly reset `?page` when filters change (it relies on omitting the page param). Confirm this behaves correctly — if the user is on page 3 and changes a filter, they should land on page 1.

---

## Implementation Plan

### Files to Create

| File | Purpose |
|------|---------|
| `apps/web/src/lib/components/library/LibraryCard.svelte` | New progress-focused library card component. Receives `LibraryItem` + `href`. Renders thumbnail with progress bar, title, creator, type/duration, and progress status. No price. |

### Files to Modify

| File | Changes |
|------|---------|
| `apps/web/src/lib/components/library/ContinueWatching.svelte` | Add `variant` prop (`'default' \| 'prominent'`). When `variant="prominent"`: use `--text-2xl` title, CSS grid layout instead of flex, bottom border separator. Pass `size` prop through to `ContinueWatchingCard`. |
| `apps/web/src/lib/components/library/ContinueWatchingCard.svelte` | Add `size` prop (`'default' \| 'large'`). When `size="large"`: wider min/max-width, 2-line title clamp, "Resume" pill button. |
| `apps/web/src/routes/(platform)/library/+page.svelte` | (1) Move `ContinueWatching` above sort bar and filters, add `variant="prominent"`. (2) Replace inline `.content-card` markup with `<LibraryCard>` component. (3) Remove now-unused inline card CSS classes (`.content-card`, `.card-thumb`, `.card-body`, `.card-title`, `.card-desc`, `.card-progress`, `.progress-track`, `.progress-fill`). |
| `apps/web/src/routes/_org/[slug]/(space)/library/+page.svelte` | (1) Import and add `ContinueWatching` with `variant="prominent"`, passing `filteredItems`. (2) Replace inline card markup with `<LibraryCard>` component. (3) Remove duplicated inline card CSS. |

### i18n Messages to Add

| Key | English Value |
|-----|---------------|
| `library_time_remaining` | `"{time} left"` |
| `library_resume` | `"Resume"` |

Existing keys that are reused:
- `library_continue_watching` (section title)
- `library_resume_from` (with `{ time }` param, used in ContinueWatchingCard)
- `content_progress_completed` ("Completed")
- `content_progress_percent` (with `{ percent }` param)
- `library_no_thumbnail` (placeholder text)
- `content_type_video`, `content_type_audio`, `content_type_article` (type labels)

---

## Testing Notes

### Manual Testing

1. **LibraryCard rendering.** Navigate to the platform library with a mix of not-started, in-progress, and completed items. Verify:
   - Not-started items: no progress bar, no progress text line.
   - In-progress items: partial progress bar (correct percentage), text reads "X% complete - Y min left".
   - Completed items: full green progress bar, checkmark icon + "Completed" text in green.
   - All items: title (2-line clamp), creator name, content type + duration inline. No price badge anywhere.

2. **LibraryCard thumbnail states.** Verify cards with thumbnails show the image. Cards without thumbnails show the content-type icon placeholder (play/music/file icon). Verify the `onerror` handler hides a broken image gracefully.

3. **Continue Watching prominence.** On the platform library page:
   - With in-progress items: "Continue Watching" section appears first, before sort/filters. Cards are wider than before. Title uses larger heading. "Resume" pill appears on each card. Section has a bottom border separating it from the filter bar.
   - With no in-progress items: section does not render at all. Sort/filters appear immediately after the page title.

4. **Continue Watching on org library.** Navigate to an org library page where the user has in-progress content from that org. Verify "Continue Watching" appears with the prominent variant. Verify only items from that org appear (since the API response is already scoped by `organizationId`).

5. **Org library filters.** On the org library page:
   - Select "In Progress" progress filter. Verify URL updates to `?progress=in_progress`. Verify grid shows only in-progress items.
   - Select "Completed" filter. Verify grid shows only completed items with green checkmarks.
   - Select "Audio" content type. Verify URL updates to `?type=audio`. Verify grid filters to audio only.
   - Select "Membership" access type. Verify `?access=membership` in URL. Verify results filter.
   - Type a search term. Verify URL updates with `?q=term` after debounce. Verify results filter.
   - Change sort to "A-Z". Verify `?sort=az` in URL. Verify items reorder.
   - Apply multiple filters simultaneously. Verify all URL params coexist and results narrow correctly.
   - Click "Clear filters" button. Verify all params reset and full results return.

6. **Pagination with filters.** On org library, apply a filter, then navigate to page 2. Verify the filter persists in the URL. Change a filter — verify page resets to 1.

7. **Card hover states.** Hover over a `LibraryCard` — verify translateY lift, shadow, and title color change to interactive. Hover over a "Resume" pill in ContinueWatchingCard — verify it fills with interactive color.

8. **Keyboard accessibility.** Tab through library cards — verify focus ring appears (`--color-focus` outline). Tab to "Resume" pill — it is part of the card link, so focus ring should appear on the card `<a>` element.

9. **Mobile responsive.** On narrow viewport:
   - Content grid: 1 column.
   - Continue Watching (prominent): 1 column grid, cards stack vertically.
   - LibraryFilters: filter groups stack vertically.

10. **Empty states.** On org library with no purchases from that org: verify empty state with "Browse Content" link. On platform library with no content at all: verify empty state with "Browse" link. Neither should show ContinueWatching section.

### Edge Cases

- Library item with `progress: null` (never started): no progress bar, no progress text.
- Library item with `progress.durationSeconds === 0` (unknown duration): skip time-remaining calculation, show only percent.
- Library item with `progress.completed === true` but `percentComplete < 100` (manually marked complete): show as completed (trust the `completed` flag over the percentage).
- Library item with `content.thumbnailUrl` that 404s: `onerror` handler hides `<img>`, placeholder icon should show (verify the fallback placeholder `<div>` is rendered alongside the `<img>` with `display: none` and toggled on error, or restructure to use conditional rendering).
- Org library with user having 0 in-progress items from that org but in-progress items from other orgs: ContinueWatching section should be hidden (the items are already org-scoped from the API).
- "View full library" link on org page still works after layout changes and navigates to the platform library.
