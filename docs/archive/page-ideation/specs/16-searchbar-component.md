# Global SearchBar Component -- Implementation Spec

## Summary

A reusable, scope-aware search component that lives in the header of every layout (PlatformHeader, OrgHeader, StudioHeader). Replaces the current per-page search forms with a persistent, always-accessible search bar featuring debounced input, live suggestion dropdown, recent search history, keyboard navigation, and a Cmd/Ctrl+K shortcut.

The component adapts its data source based on where it is rendered:
- **Org context**: searches published content within the current org via `getPublicContent(orgId, search=query)`
- **Platform context**: searches content across all orgs via `getDiscoverContent(search=query)`
- **Studio context**: searches the creator's own content via `api.content.list(search=query)`

This is a large effort because it introduces a new interactive pattern (combobox with live suggestions) not currently present in the codebase, requires integration into three separate headers, and demands careful attention to accessibility, keyboard handling, and mobile responsiveness.

---

## Feasibility

### Pros

- **All three search APIs already exist and support a `search` query parameter.** The content-api worker implements `ilike` matching on title and description. No backend changes are needed for the core search functionality.
- `getPublicContent` (remote function in `content.remote.ts`) accepts `search` as a validated parameter via `publicContentQueryParamsSchema`. `getDiscoverContent` and `api.content.list` both accept `search` via `URLSearchParams`. The data layer is fully ready.
- `SearchIcon` and `XIcon` already exist in the Icon library (`$lib/components/ui/Icon/`).
- The existing explore page search (`_org/[slug]/(space)/explore/+page.svelte`) and discover page search (`(platform)/discover/+page.svelte`) both use URL-param-driven search with form submit, so the pattern is understood. The SearchBar extends this to be header-level with live suggestions instead of full-page reload.
- All three headers follow the same structural pattern: `header > PageContainer > [brand, nav, actions]`. The SearchBar slots naturally between the nav and actions sections.
- The codebase already uses localStorage for persistent state (version manifest, view mode preferences), so recent search history fits an established pattern.
- No new backend endpoints are required -- the component fetches suggestions purely through existing APIs with a `limit=5` parameter to keep payloads small.

### Gotchas & Risks

- **Search is currently page-level with form submit, not header-level with live suggestions.** The existing pattern navigates to a results page (explore or discover) with `?q=` in the URL. The SearchBar must decide: does selecting a suggestion navigate to the content detail page, or does it navigate to the results page with the query pre-filled? **Decision: both.** Selecting a specific content suggestion navigates to its detail page. Pressing Enter without selecting a suggestion navigates to the appropriate results page with `?q=` set.
- **Client-side fetch from the header.** The SearchBar needs to make API calls from a component that is not a page. This means it cannot use `+page.server.ts` loads. It must call remote functions (`getPublicContent`, `listContent`) directly from the component. Since remote functions use `query()` which runs server-side via SvelteKit's remote function mechanism, this works but each keystroke (debounced) triggers a server round-trip. The 300ms debounce and a minimum 2-character query length mitigate excessive requests.
- **Rate limiting.** The content-api endpoints are public and do not have per-IP rate limits for read operations (only auth endpoints have `rateLimit: 'auth'`). However, rapid search queries could create load. The debounce, minimum character threshold, and small `limit` parameter (5 results) keep this manageable. If volume becomes a concern, a lightweight in-memory LRU cache on the client (keyed by scope+query) can be added later.
- **Cross-subdomain scoping.** On org subdomains, the SearchBar must know the current org's ID to pass to `getPublicContent`. This is available from the org layout data. On the platform domain, no org scoping is needed. The `scope` prop determines which API to call.
- **Header height constraint.** All headers use `height: var(--space-16)` (64px). The search input must fit within this height. The suggestion dropdown renders below the header via absolute positioning, overlaying page content. The dropdown needs a high `z-index` (above `--z-sticky` but below `--z-modal`).
- **Mobile space.** On mobile, the headers already hide the desktop nav and show a hamburger. There is no horizontal space for a full search input. The SearchBar must render as an icon button on mobile that, when tapped, opens a full-width search overlay.
- **SSR safety.** The SearchBar uses `$state`, `$effect`, and localStorage -- all client-only. The component renders the static input shell on the server (no suggestions, no recent searches). Suggestion fetching and localStorage access must be guarded behind `browser` checks or `onMount`.
- **Focus trapping in suggestions dropdown.** When the dropdown is open, focus must stay within the search context. Pressing Tab should close the dropdown. Pressing Escape should close the dropdown and return focus to the input. This requires careful `focusout` handling to distinguish "moved to suggestion" from "left the component entirely."
- **Conflict with other Cmd+K handlers.** If the platform adds other command-palette features in the future, the Cmd+K binding needs to be configurable or replaceable. For now, it is safe since no other global keyboard shortcuts exist.

---

## Current State

### How Search Works Today

Search is implemented as **page-level form submission** in two places:

1. **Org explore page** (`_org/[slug]/(space)/explore/+page.svelte`):
   - A `<form>` with a search `<input>` that calls `handleSearchSubmit` on submit.
   - On submit, the handler calls `updateFilter('q', searchInput)` which sets `?q=` in the URL via `goto()` with `replaceState: true`.
   - The `+page.server.ts` reads `url.searchParams.get('q')` and passes it to `getPublicContent({ orgId, search: q })`.
   - Results reload the entire page content grid.

2. **Platform discover page** (`(platform)/discover/+page.svelte`):
   - A `<form>` with a search input and a submit button.
   - On submit, navigates to `/discover?q=searchValue` via `goto()`.
   - The `+page.server.ts` reads `url.searchParams.get('q')` and passes it to `api.content.getDiscoverContent(params)`.

3. **Studio content list**: No search input exists in the studio header or content listing page currently.

**Key observation:** Both patterns are URL-driven. The user types a query, submits a form, and the page reloads with filtered results. There is no live suggestion / typeahead behaviour anywhere in the codebase.

### Headers Where SearchBar Will Be Integrated

| Header | File | Current Layout |
|--------|------|---------------|
| PlatformHeader | `$lib/components/layout/Header/PlatformHeader.svelte` | Logo -- [Discover, Pricing, Library] -- UserMenu/MobileNav |
| OrgHeader | `$lib/components/layout/Header/OrgHeader.svelte` | OrgBrand -- [Explore, Creators, Library] -- UserMenu/MobileNav |
| StudioHeader | `$lib/components/layout/Header/StudioHeader.svelte` | ContextBrand + Switcher -- UserMenu/MobileNav |

All headers are `sticky`, `top: 0`, `z-index: var(--z-sticky)`, height `var(--space-16)`.

---

## Design Spec

### Props Interface

```typescript
interface SearchBarProps {
  /** Determines which API to call and where Enter navigates */
  scope: 'platform' | 'org' | 'studio';

  /** Required when scope is 'org' -- the org's UUID for API scoping */
  orgId?: string;

  /** Required when scope is 'org' -- used for building content URLs */
  orgSlug?: string;

  /** Placeholder text (falls back to i18n default per scope) */
  placeholder?: string;

  /** Maximum number of suggestions to show (default: 5) */
  maxSuggestions?: number;

  /** Whether the Cmd/Ctrl+K shortcut is active (default: true) */
  enableShortcut?: boolean;
}
```

The component does NOT accept `children` or `class` -- it manages its own layout entirely.

### Input Behavior

**Debounce:** Input is debounced at 300ms. After the debounce period, if the trimmed query is at least 2 characters, a fetch fires. If the query is less than 2 characters, any open suggestions are replaced with the recent searches section.

**Clear button:** When the input has a value, a clear button (`XIcon`, 16px) appears on the right side of the input. Clicking it clears the input, clears the suggestion results, and refocuses the input. The clear button is `type="button"` to prevent form submission.

**Form submission:** The input is wrapped in a `<form>`. Pressing Enter (with no suggestion selected) submits the form, which navigates to the appropriate results page:
- `scope: 'platform'` navigates to `/discover?q={query}`
- `scope: 'org'` navigates to `/explore?q={query}`
- `scope: 'studio'` navigates to `/studio/content?search={query}`

The form uses `goto()` navigation, not a native form action, to preserve SvelteKit client-side routing.

**Minimum query length:** 2 characters. Below this threshold, no API call is made. The dropdown shows recent searches instead (if any exist).

**Loading state:** While a fetch is in flight, a subtle loading indicator (pulsing dot or spinner) appears in the input's right side, replacing the clear button temporarily.

### Suggestion Dropdown

The dropdown appears below the search input, overlaying page content. It has two sections:

#### 1. Recent Searches Section (shown when input is empty or < 2 chars)

- Header: "Recent searches" (muted text)
- Up to 5 most recent search queries, each shown as a clickable row with a `ClockIcon`
- Clicking a recent search populates the input and triggers a search
- A "Clear all" button in the section header removes all recent searches from localStorage
- Recent searches are stored in `localStorage` under key `codex-recent-searches` as a JSON array of strings, newest first, max 10 entries

#### 2. Content Suggestions Section (shown when query >= 2 chars and results exist)

Each suggestion row contains:
- **Thumbnail** (48x32px, `aspect-ratio: 3/2`, rounded corners) -- falls back to a coloured placeholder based on `contentType`
- **Title** (single line, truncated with ellipsis, `--text-sm`, `--font-medium`)
- **Content type badge** (small `Badge` component: "Video", "Audio", "Article")
- **Creator name** (if available, `--text-xs`, `--color-text-secondary`)

Maximum suggestions shown: `maxSuggestions` prop (default 5).

**No results state:** If the API returns 0 results for a valid query, show a single row: "No results for '{query}'" with a `SearchXIcon`.

**Footer row:** At the bottom of the suggestions, a "Search for '{query}'" row appears. Clicking it navigates to the full results page (same as pressing Enter). This ensures the user always has a path to the full results page.

#### Dropdown Positioning & Sizing

- `position: absolute`, anchored to the bottom of the search input wrapper
- `top: 100%` plus `var(--space-1)` gap
- `width: 100%` of the search input wrapper (NOT the full header)
- `max-height: 400px`, `overflow-y: auto`
- `z-index: var(--z-dropdown)` (or `calc(var(--z-sticky) + 1)` if no dropdown token exists)
- `border-radius: var(--radius-md)` on the dropdown container
- `border: var(--border-width) var(--border-style) var(--color-border)`
- `background: var(--color-surface)`
- `box-shadow: var(--shadow-lg)`

### Keyboard Navigation

The SearchBar implements the **ARIA combobox pattern** (WAI-ARIA 1.2):

| Key | Context | Action |
|-----|---------|--------|
| **ArrowDown** | Input focused, dropdown open | Move highlight to next suggestion (wraps to first) |
| **ArrowDown** | Input focused, dropdown closed | Open dropdown (show recent searches or trigger search if query exists) |
| **ArrowUp** | Input focused, dropdown open | Move highlight to previous suggestion (wraps to last) |
| **Enter** | No suggestion highlighted | Submit form (navigate to results page with `?q=`) |
| **Enter** | Suggestion highlighted | Navigate to the highlighted content's detail page |
| **Escape** | Dropdown open | Close dropdown, clear highlight, keep input text, return focus to input |
| **Escape** | Dropdown closed, input has text | Clear input text |
| **Tab** | Dropdown open | Close dropdown, move focus to next focusable element (default browser behavior) |
| **Home** | Dropdown open | Move highlight to first suggestion |
| **End** | Dropdown open | Move highlight to last suggestion |

**Highlight state:** A `highlightedIndex` state variable tracks which suggestion is highlighted (-1 means none). ArrowDown/ArrowUp increment/decrement this value. The highlighted suggestion receives `data-highlighted="true"` and a background color of `var(--color-surface-secondary)`. The input's `aria-activedescendant` is set to the highlighted suggestion's `id`.

**Implementation detail:** Keyboard navigation operates on a flat list that includes both recent search items and content suggestion items. The "Search for '{query}'" footer row is also navigable.

### Keyboard Shortcut (Cmd+K)

**Binding:** `Cmd+K` (macOS) / `Ctrl+K` (Windows/Linux).

**Behavior:**
1. When no input/textarea/contenteditable element is focused, pressing the shortcut focuses the SearchBar input and opens the dropdown (showing recent searches).
2. If the SearchBar is already focused, the shortcut closes the dropdown and blurs the input.
3. The shortcut is registered via `<svelte:window onkeydown={handleGlobalKeydown}>` at the component level.

**Guard logic:**
```typescript
function handleGlobalKeydown(e: KeyboardEvent) {
  if (!enableShortcut) return;
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    const active = document.activeElement;
    const isEditableTarget = active instanceof HTMLInputElement
      || active instanceof HTMLTextAreaElement
      || active?.getAttribute('contenteditable') === 'true';

    if (isEditableTarget && active !== inputRef) return;

    if (document.activeElement === inputRef) {
      closeDropdown();
      inputRef?.blur();
    } else {
      inputRef?.focus();
      openDropdown();
    }
  }
}
```

**Visual hint:** On desktop, the search input shows a keyboard shortcut badge on the right side: a small `<kbd>` element displaying the platform-appropriate shortcut. This badge fades out when the input receives focus and reappears when the input is empty and blurred.

**Platform detection:** Use `navigator.userAgent` or `navigator.platform` to detect macOS vs other and display the appropriate modifier key symbol.

### Mobile Behavior

On viewports below `--breakpoint-md` (768px), the SearchBar renders differently:

1. **Default state:** A single icon button (`SearchIcon`, same size as the hamburger button) appears in the header actions area.
2. **Tapped state:** The icon button opens a **full-screen search overlay** that covers the entire viewport.

**Overlay structure:**
```
[Full-screen overlay]
  [Header bar: back arrow | search input (autofocused) | clear button]
  [Scrollable body: recent searches OR suggestion results]
```

- The overlay uses `position: fixed; inset: 0; z-index: var(--z-modal)`.
- Background: `var(--color-surface)`.
- The input is autofocused on open (with a small delay to avoid iOS keyboard flicker).
- The back arrow (or X button) closes the overlay and returns to the previous state.
- Results scroll vertically in the body area.
- The overlay traps focus (only the back button, input, and suggestion items are focusable).

**Transition:** The overlay slides in from the top (`transform: translateY(-100%)` to `translateY(0)`) with `--duration-normal` timing.

### Responsive Layout

| Breakpoint | Behavior |
|-----------|----------|
| **Desktop** (`>= --breakpoint-md`) | Inline input in the header, between nav links and actions. Width: `flex: 0 1 320px` (shrinks but has a preferred width of 320px). Min-width: 200px. |
| **Tablet** (`>= --breakpoint-sm`, `< --breakpoint-md`) | Same as mobile -- icon trigger with full-screen overlay. Tablet headers already collapse nav to hamburger at this breakpoint. |
| **Mobile** (`< --breakpoint-sm`) | Icon trigger with full-screen overlay. |

**Desktop header layout adjustment:** The headers currently have three sections (brand, nav, actions). The SearchBar inserts as a fourth element between nav and actions. The header inner container already uses `display: flex; justify-content: space-between`, which needs to shift to explicit `gap` between items:

```css
/* Revised header inner layout */
:global(.header-inner) {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
```

The nav gets `flex: 1` to push the SearchBar and actions to the right, or the SearchBar gets `margin-left: auto` to sit between nav and actions. The exact approach depends on each header's existing flex layout.

### Accessibility

The SearchBar implements the **combobox pattern** per [WAI-ARIA Authoring Practices -- Combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).

**ARIA attributes on the input:**
```html
<input
  type="search"
  role="combobox"
  aria-expanded={isDropdownOpen}
  aria-controls="search-listbox"
  aria-activedescendant={highlightedId ?? undefined}
  aria-autocomplete="list"
  aria-haspopup="listbox"
  aria-label={ariaLabel}
  autocomplete="off"
/>
```

**ARIA attributes on the dropdown:**
```html
<ul
  id="search-listbox"
  role="listbox"
  aria-label="Search suggestions"
>
  {#each suggestions as suggestion, i}
    <li
      id="search-option-{i}"
      role="option"
      aria-selected={highlightedIndex === i}
    >
      ...
    </li>
  {/each}
</ul>
```

**Live region for result count:**
```html
<div aria-live="polite" aria-atomic="true" class="sr-only">
  {#if suggestions.length > 0}
    {suggestions.length} results available
  {:else if query.length >= 2}
    No results found
  {/if}
</div>
```

The `sr-only` class uses the standard visually-hidden pattern:
```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
```

**Focus management:**
- Selecting a suggestion (via Enter or click) closes the dropdown and navigates. Focus moves to the new page.
- Closing the dropdown via Escape returns focus to the input.
- Closing the mobile overlay returns focus to the trigger icon button.
- The mobile overlay traps focus using a `focusTrap` action (or manual first/last-element cycling).

**Screen reader announcements:**
- When the dropdown opens: "Search suggestions" (via the listbox label).
- When results load: "{N} results available" (via the live region).
- When highlight changes: The `aria-activedescendant` update causes screen readers to announce the highlighted option.
- When the dropdown closes: no announcement needed (focus returns to input).

---

## Implementation Plan

### Files to Create

#### 1. `apps/web/src/lib/components/ui/SearchBar/SearchBar.svelte`

The main component. Accepts `SearchBarProps`. Manages:
- Input state (`query`, `highlightedIndex`, `isOpen`)
- Debounced fetch via `$effect` watching the query
- Recent searches read/write to localStorage
- Keyboard event handling
- Dropdown open/close logic
- Desktop inline mode vs mobile icon trigger

Estimated lines: ~250-300 (template + script + scoped styles).

#### 2. `apps/web/src/lib/components/ui/SearchBar/SearchSuggestions.svelte`

The dropdown panel, rendered by SearchBar. Accepts:
```typescript
interface SearchSuggestionsProps {
  suggestions: ContentWithRelations[];
  recentSearches: string[];
  query: string;
  highlightedIndex: number;
  isLoading: boolean;
  onSelectSuggestion: (suggestion: ContentWithRelations) => void;
  onSelectRecent: (query: string) => void;
  onClearRecent: () => void;
  onSelectSearchAll: (query: string) => void;
}
```

Responsible for rendering the two-section layout (recent searches / content suggestions), the "no results" state, and the "Search for '{query}'" footer. Each row handles mouse hover (sets highlighted index) and click.

Estimated lines: ~150-200.

#### 3. `apps/web/src/lib/components/ui/SearchBar/SearchOverlay.svelte`

Mobile-only full-screen search overlay. Rendered conditionally by SearchBar when viewport is below `--breakpoint-md`. Contains its own input, suggestion list, and close button. The overlay manages its own focus trap.

Estimated lines: ~120-150.

#### 4. `apps/web/src/lib/components/ui/SearchBar/index.ts`

Barrel export:
```typescript
export { default as SearchBar } from './SearchBar.svelte';
```

#### 5. `apps/web/src/lib/hooks/use-search.ts`

A reusable search logic hook (plain TypeScript, not a Svelte component) that encapsulates:
- Debounce timer management
- API call dispatch based on scope
- Result caching (optional, simple Map with TTL)
- Recent searches localStorage read/write
- Abort controller for in-flight requests

```typescript
interface UseSearchOptions {
  scope: 'platform' | 'org' | 'studio';
  orgId?: string;
  debounceMs?: number;
  maxSuggestions?: number;
  minQueryLength?: number;
}

interface UseSearchReturn {
  results: ContentWithRelations[];
  isLoading: boolean;
  recentSearches: string[];
  search: (query: string) => void;
  addRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;
  abort: () => void;
}
```

This hook is called from SearchBar.svelte's `<script>` block. It uses `$state` and `$effect` internally for reactivity.

Estimated lines: ~100-130.

### Files to Modify

#### 1. `apps/web/src/lib/components/layout/Header/PlatformHeader.svelte`

- Import `SearchBar`
- Add `<SearchBar scope="platform" />` between the `desktop-nav` and `header-actions`
- Add the mobile search icon button inside `header-actions` (SearchBar handles this internally via media query)
- Adjust flex layout to accommodate the new element

#### 2. `apps/web/src/lib/components/layout/Header/OrgHeader.svelte`

- Import `SearchBar`
- Accept new prop: `orgId: string` (passed from layout)
- Add `<SearchBar scope="org" orgId={org.id} orgSlug={org.slug} />` between `desktop-nav` and `header-actions`
- Adjust flex layout

#### 3. `apps/web/src/lib/components/layout/Header/StudioHeader.svelte`

- Import `SearchBar`
- Accept new prop: `orgId?: string` (from layout data)
- Add `<SearchBar scope="studio" orgId={org?.id} />` in the header between left and actions sections
- Adjust flex layout

#### 4. `apps/web/src/lib/components/ui/SearchBar/` (new directory)

Create the directory for the new component files.

#### 5. Layout files that pass org data to headers

The OrgHeader already receives `org` (which includes `id`). If it does not currently include `id`, the org layout's data must be extended. Based on the current `LayoutOrganization` interface (`name`, `slug`, `logoUrl`), the `id` field is missing. Options:
- Extend `LayoutOrganization` to include `id` (preferred, minimal impact)
- Pass `orgId` as a separate prop to OrgHeader

This must be verified during implementation. The org layout server load (`_org/[slug]/+layout.server.ts`) already fetches the full org object which includes `id`.

#### 6. `apps/web/src/lib/components/ui/index.ts`

Add the SearchBar to the barrel export if UI components are re-exported from a central index.

#### 7. i18n messages (`apps/web/src/paraglide/messages/`)

New message keys needed:
- `search_placeholder_platform`: "Search content..."
- `search_placeholder_org`: "Search {orgName}..."
- `search_placeholder_studio`: "Search your content..."
- `search_recent_header`: "Recent searches"
- `search_recent_clear`: "Clear all"
- `search_no_results`: "No results for '{query}'"
- `search_all_results`: "Search for '{query}'"
- `search_results_count`: "{count} results available"
- `search_shortcut_label`: "Search"
- `search_close_overlay`: "Close search"
- `search_aria_label`: "Search content"

---

## Data Flow

### Suggestion Fetch Sequence

```
User types "intro" (debounced 300ms)
  |
  v
use-search.ts: query.length >= 2, start fetch
  |
  +-- scope='org'      --> getPublicContent({ orgId, search: 'intro', limit: 5 })
  +-- scope='platform' --> getDiscoverContent(new URLSearchParams({ search: 'intro', limit: '5' }))
  +-- scope='studio'   --> listContent({ search: 'intro', limit: 5, status: 'published' })
  |
  v
API returns ContentWithRelations[]
  |
  v
SearchSuggestions.svelte renders results
  |
  v
User clicks suggestion OR presses Enter
  |
  +-- Click on content item --> goto(buildContentUrl(page.url, item))
  +-- Enter (no highlight)  --> goto('/discover?q=intro') (or /explore?q= or /studio/content?search=)
  +-- Enter (highlighted)   --> goto(buildContentUrl(page.url, highlightedItem))
```

### Recent Searches Persistence

```
localStorage key: 'codex-recent-searches'
Format: JSON array of strings, e.g. ["intro to coding", "javascript", "svelte"]
Max entries: 10 (FIFO -- oldest removed when full)
Write trigger: user submits a search (Enter or selects "Search for '{query}'")
Read trigger: component mount, input focus when query is empty
```

Operations:
- `addRecentSearch(query)`: Prepend to array, deduplicate, trim to 10
- `clearRecentSearches()`: Set to empty array
- `getRecentSearches()`: Parse from localStorage, return array (empty on error)

---

## Detailed Component Behavior

### State Machine

The SearchBar operates in the following states:

| State | Input | Dropdown | Trigger |
|-------|-------|----------|---------|
| **Idle** | Blurred, may have text | Closed | Default state |
| **Focused (empty)** | Focused, empty | Open with recent searches (if any) | Click/focus input, or Cmd+K |
| **Focused (typing)** | Focused, < 2 chars | Open with recent searches | User typing |
| **Searching** | Focused, >= 2 chars | Open with loading indicator | Debounce fired |
| **Results** | Focused, >= 2 chars | Open with suggestions | API returned |
| **Navigating** | Focused, highlight active | Open with highlighted item | ArrowDown/ArrowUp |
| **No results** | Focused, >= 2 chars | Open with "no results" message | API returned empty |

Transitions:
- `Idle` -- [focus / Cmd+K] --> `Focused (empty)` or `Focused (typing)` (depending on input value)
- `Focused (*)` -- [Escape / blur / Tab] --> `Idle`
- `Focused (typing)` -- [query >= 2 chars, debounce fires] --> `Searching`
- `Searching` -- [results arrive] --> `Results` or `No results`
- `Results` -- [ArrowDown/Up] --> `Navigating`
- `Navigating` -- [Enter] --> `Idle` (navigates away)
- `*` -- [clear button] --> `Focused (empty)`

### Abort on New Query

When a new debounced query fires while a previous fetch is still in flight, the previous fetch is aborted via `AbortController`. This prevents stale results from appearing after newer results.

```typescript
let controller: AbortController | null = null;

function search(query: string) {
  controller?.abort();
  controller = new AbortController();
  // ... fetch with { signal: controller.signal }
}
```

Note: Since the search uses SvelteKit remote functions (`query()`), direct AbortController support depends on whether the remote function mechanism supports it. If not, the hook can track a request ID and discard results from stale requests:

```typescript
let latestRequestId = 0;

async function search(query: string) {
  const requestId = ++latestRequestId;
  const results = await getPublicContent({ orgId, search: query, limit: 5 });
  if (requestId !== latestRequestId) return; // stale, discard
  suggestions = results?.items ?? [];
}
```

### Click Outside to Close

The dropdown closes when the user clicks outside the SearchBar component. This is implemented via a `focusout` event handler on the wrapper element, with a `relatedTarget` check:

```typescript
function handleFocusOut(e: FocusEvent) {
  // If focus moved to another element within the SearchBar, keep open
  if (wrapperRef?.contains(e.relatedTarget as Node)) return;
  closeDropdown();
}
```

This is more reliable than `click` outside detection because it handles keyboard navigation (Tab) as well.

---

## CSS Architecture

### Design Token Usage

All styles MUST use design tokens per project rules. Key token mappings:

| Element | Token(s) |
|---------|----------|
| Input background | `var(--color-surface-secondary)` (slightly recessed from header) |
| Input border | `var(--color-border)` |
| Input focus border | `var(--color-border-focus)` |
| Input focus ring | `var(--shadow-focus-ring)` |
| Input text | `var(--color-text)` |
| Input placeholder | `var(--color-text-muted)` |
| Dropdown background | `var(--color-surface)` |
| Dropdown border | `var(--color-border)` |
| Dropdown shadow | `var(--shadow-lg)` |
| Suggestion hover/highlight | `var(--color-surface-secondary)` |
| Recent search icon | `var(--color-text-muted)` |
| Keyboard shortcut badge | `var(--color-surface-tertiary)` background, `var(--color-text-muted)` text |
| Suggestion title | `var(--color-text)`, `var(--text-sm)`, `var(--font-medium)` |
| Suggestion creator | `var(--color-text-secondary)`, `var(--text-xs)` |
| Loading spinner | `var(--color-interactive)` |
| Mobile overlay background | `var(--color-surface)` |

### Scoped Styles

All component styles use scoped `<style>` blocks. No `:global()` usage except when styling the `PageContainer` class (established pattern in existing headers).

---

## Testing Notes

### Unit Tests (Vitest)

1. **use-search.ts hook:**
   - Debounce fires after specified delay, not before
   - Queries below minimum length do not trigger fetch
   - Abort/discard logic prevents stale results
   - Recent searches: add, deduplicate, FIFO eviction at max, clear all
   - localStorage read/write with error handling (blocked localStorage)

2. **Keyboard navigation:**
   - ArrowDown increments highlighted index, wraps at end
   - ArrowUp decrements highlighted index, wraps at start
   - Enter with no highlight submits form
   - Enter with highlight navigates to item
   - Escape closes dropdown
   - Home/End jump to first/last

3. **Scope-aware API routing:**
   - `scope='platform'` calls `getDiscoverContent`
   - `scope='org'` calls `getPublicContent` with `orgId`
   - `scope='studio'` calls `listContent` with auth

### Integration Tests (Playwright)

1. **Desktop flow:**
   - Click search input, type "test", verify dropdown appears after debounce
   - Verify suggestion items show title, thumbnail placeholder, content type badge
   - Press ArrowDown, verify first item highlighted
   - Press Enter, verify navigation to content detail page
   - Clear input, verify recent searches section shows "test"
   - Press Escape, verify dropdown closes

2. **Cmd+K shortcut:**
   - Press Cmd+K, verify search input receives focus
   - Press Cmd+K again, verify input blurs
   - Focus a textarea, press Cmd+K, verify no action (guard active)

3. **Mobile flow:**
   - Set viewport to mobile width
   - Verify search input is hidden, search icon button is visible
   - Tap search icon, verify full-screen overlay appears
   - Type query, verify suggestions appear in overlay
   - Tap back button, verify overlay closes

4. **Accessibility:**
   - Verify `role="combobox"` on input
   - Verify `role="listbox"` on dropdown
   - Verify `aria-expanded` toggles correctly
   - Verify `aria-activedescendant` updates on arrow key navigation
   - Verify live region announces result count
   - Run axe accessibility audit on the component in both open and closed states

5. **No results:**
   - Type a query that returns 0 results
   - Verify "No results" message appears
   - Verify "Search for '{query}'" footer is still present

6. **Cross-scope behavior:**
   - On org subdomain: verify search hits org API, Enter navigates to `/explore?q=`
   - On platform domain: verify search hits discover API, Enter navigates to `/discover?q=`
   - In studio: verify search hits content list API, Enter navigates to `/studio/content?search=`
