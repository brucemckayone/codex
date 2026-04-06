# Command Palette --- Implementation Spec

## Summary

A keyboard-driven command palette for the studio, triggered by Cmd+K (macOS) or Ctrl+K (Windows/Linux). Provides instant access to studio pages, content items (via async search), and quick actions from a single full-screen overlay with grouped, keyboard-navigable results.

This is studio-only --- never rendered on public org pages, platform pages, or auth pages. The component mounts in the studio layout and listens for the global shortcut. When the input is empty, it shows recent items (last 5 visited studio pages, persisted in localStorage). As the user types, it filters static pages and actions immediately, then debounces an async content search against the existing `?search=` API parameter.

---

## Feasibility

### Pros

- **Content search API already exists.** The `GET /api/content?search=` parameter runs an `ilike` query on title and description in `ContentService.list()`. The frontend `listContent` remote function already accepts a `search` field. No backend changes are needed.
- **All studio routes are known statically.** The page navigation items come directly from `$lib/config/navigation.ts` (`SIDEBAR_BASE_LINKS`, `SIDEBAR_ADMIN_LINKS`, `SIDEBAR_OWNER_LINKS`), which are already role-gated in the sidebar. The command palette can reuse the same link definitions.
- **Dialog overlay pattern is proven.** The existing `Dialog` component (Melt UI `createDialog`) provides portalled rendering, backdrop overlay, focus trapping, and Escape-to-close. However, the command palette needs a custom layout (top-aligned search input, scrollable results) that diverges from the centered card Dialog. Building a standalone overlay component is cleaner than fighting the Dialog's opinionated structure.
- **`SearchIcon` and all sidebar icons already exist.** The Icon library has `SearchIcon`, `FileIcon`, `VideoIcon`, `LayoutDashboardIcon`, `SettingsIcon`, `TrendingUpIcon`, `UsersIcon`, `UserPlusIcon`, `CreditCardIcon`, `PlusIcon`, `UploadIcon`, `GlobeIcon`, and `EditIcon` --- all needed for result items.
- **Keyboard event pattern is established.** The studio layout already uses `window.addEventListener('keydown', ...)` for Escape handling. `MobileNav` uses `<svelte:window onkeydown={...} />`. Both patterns are proven.
- **localStorage pattern is established.** The codebase uses localStorage for sidebar collapse preference, view mode preference, and version manifest. Recent items follows the same pattern.
- **z-index tokens cover this use case.** `--z-modal-backdrop` (1040) and `--z-modal` (1050) are available and correct for a full-screen overlay.

### Gotchas & Risks

- **Must not conflict with browser shortcuts.** Cmd+K is used by some browsers (Safari address bar, Chrome address bar on some OS configs). The handler must call `e.preventDefault()` to suppress the browser default. If the user is focused in a contenteditable or input field outside the palette, the shortcut should still trigger (unlike typical hotkeys that defer to input focus). However, the shortcut must NOT fire if the user is in a rich text editor (TipTap/ProseMirror `contenteditable`), as Cmd+K means "insert link" there.
- **Content search is async and requires debounce.** Static page/action results appear instantly, but content search hits the server. A 300ms debounce prevents excessive requests. The UI must show a loading indicator in the Content section while the fetch is in-flight, and handle the case where the user clears the input before the response arrives (cancel or ignore stale responses).
- **Dialog component is not suitable as the base.** The existing `DialogContent.svelte` uses Melt UI's `createDialog` with a centered card layout, fixed max-width of 42rem, and an opinionated close button. The command palette needs: top-third vertical positioning, full-width search input, scrollable results list with dynamic height, and no close button (Escape is sufficient). Using Melt's dialog would require overriding most of its styling and fighting its focus management around the search input. A standalone overlay with manual focus trapping is more appropriate.
- **Focus management must be precise.** When the palette opens, focus must move to the search input immediately. When it closes (Escape or result selection), focus must return to the element that was focused before opening. Arrow key navigation must not scroll the page behind the overlay. Tab must be trapped within the palette.
- **Role-gated items.** Admin/owner links (Team, Customers, Settings, Billing) must only appear for users with the appropriate role. The `userRole` is available from the studio layout data. Actions like "Create Content" or "Upload Media" may also be role-gated.
- **Navigation must close the palette.** Selecting a result triggers `goto()` and must close the palette. The `$effect` in the studio layout that watches `page.url.pathname` for mobile menu close can be mirrored for the command palette.
- **Content results need sufficient context.** A content title alone may be ambiguous. Results should show content type (video/audio/written), status (draft/published/archived), and navigate to the edit page (`/studio/content/{id}/edit`).
- **Empty query vs no results.** When the input is empty, show Recent Items. When the input has text but no results match, show an empty state message. These are distinct visual states.
- **Body scroll lock.** When the overlay is open, the page behind must not scroll. Apply `overflow: hidden` to `document.body` on open, restore on close.

---

## Current State

### No command palette exists

There is no command palette, keyboard shortcut system, or quick-navigation feature anywhere in the codebase. The only keyboard listeners in the studio are Escape handlers for the mobile sidebar drawer.

### Studio layout structure

The studio shell lives at `apps/web/src/routes/_org/[slug]/studio/+layout.svelte`. It renders:
1. Mobile header (hamburger, brand link, switcher)
2. Desktop header (brand link, switcher)
3. Sidebar (`StudioSidebar` with role-gated nav sections)
4. Main content area (`{@render children()}`)

The layout receives `data.org`, `data.userRole`, and `data.orgs` from the server load. The `userRole` is a string (`'member'`, `'admin'`, or `'owner'`).

### Navigation config

All studio nav links are defined in `apps/web/src/lib/config/navigation.ts`:
- `SIDEBAR_BASE_LINKS`: Dashboard, Content, Media, Analytics (all roles)
- `SIDEBAR_ADMIN_LINKS`: Team, Customers, Settings (admin/owner)
- `SIDEBAR_OWNER_LINKS`: Billing (owner only)
- `SETTINGS_NAV`: General, Branding (sub-pages of Settings)

### Content search API

`listContent` in `apps/web/src/lib/remote/content.remote.ts` accepts `{ search: string }` and passes it as a URL param to `api.content.list()`. The backend runs `ilike` on title and description columns. Returns `{ items: ContentWithRelations[], pagination }`.

### Existing keyboard patterns

- **Studio layout**: `window.addEventListener('keydown', handleEscape)` inside `$effect`, cleaned up on teardown. Only active when mobile menu is open.
- **MobileNav**: `<svelte:window onkeydown={open ? handleKeydown : undefined} />` --- conditional global listener. Listens for Escape only.
- **VideoPlayer**: Inline `onkeydown` on the player container for space/arrow/M/F keys.
- **BubbleMenuBar/EditorToolbar**: `onkeydown` on specific input elements for Enter key handling.

No component uses Cmd/Ctrl modifier key combinations.

---

## Design Spec

### Trigger

**Keyboard shortcut:** `Cmd+K` (macOS) or `Ctrl+K` (Windows/Linux).

The global listener uses `<svelte:window onkeydown={handleGlobalKeydown} />` in the `CommandPalette` component itself, which is mounted in the studio layout. The handler checks:

```
1. Is key === 'k'?
2. Is metaKey (macOS) or ctrlKey (Windows/Linux) pressed?
3. Is the active element NOT inside a contenteditable (TipTap editor)?
4. If all true: preventDefault(), open palette.
```

The contenteditable check prevents hijacking Cmd+K from the rich text editor where it means "insert link". Detection: `document.activeElement?.closest('[contenteditable="true"]')`.

If the palette is already open and Cmd/Ctrl+K is pressed again, close it (toggle behavior).

### Overlay Layout

```
+--------------------------------------------------+
|  [backdrop: semi-transparent, blurred]           |
|                                                  |
|    +------------------------------------------+  |
|    |  [SearchIcon]  Search studio...      [/]  |  | <-- search input, top-third positioned
|    +------------------------------------------+  |
|    |                                          |  |
|    |  RECENT                                  |  | <-- shown when input is empty
|    |    Clock  Dashboard            /studio   |  |
|    |    Clock  Content              /stud...  |  |
|    |    Clock  Analytics            /stud...  |  |
|    |                                          |  |
|    |  PAGES                                   |  | <-- shown when input has text
|    |  > Dashboard                   /studio   |  |
|    |    Content                     /stud...  |  |
|    |                                          |  |
|    |  CONTENT                                 |  |
|    |    My First Video    video  published     |  |
|    |    Draft Article     written  draft       |  |
|    |                                          |  |
|    |  ACTIONS                                 |  |
|    |    Create Content                        |  |
|    |    Upload Media                          |  |
|    |                                          |  |
|    +------------------------------------------+  |
|    |  Up/Down navigate  Enter select  Esc close|  | <-- keyboard hints footer
|    +------------------------------------------+  |
|                                                  |
+--------------------------------------------------+
```

**Overlay**: Fixed, full viewport, `z-index: var(--z-modal-backdrop)`. Background: `var(--color-surface-overlay)` with `backdrop-filter: blur(4px)`. Clicking the backdrop closes the palette.

**Panel**: Centered horizontally, positioned in the top third of the viewport (`top: 20vh` on desktop, `top: var(--space-4)` on mobile). Max width `36rem`. Background `var(--color-surface)`, border `var(--border-width) var(--border-style) var(--color-border)`, border-radius `var(--radius-lg)`, shadow `var(--shadow-xl)`. `z-index: var(--z-modal)`.

**Search input**: Full width inside the panel. Left icon `SearchIcon`. Placeholder "Search studio..." (i18n: `m.command_palette_placeholder()`). No border on the input itself --- the panel border frames it. Bottom border separating input from results: `var(--border-width) var(--border-style) var(--color-border)`.

**Results area**: Below the search input. Max height `60vh`, scrollable via `overflow-y: auto`. Grouped by section (Recent, Pages, Content, Actions) with section headers.

**Footer**: Keyboard hints bar at the bottom of the panel. Shows modifier glyphs: up/down arrows for navigation, Enter to select, Escape to close. Muted text, small font size.

### Search Behavior

Three-phase matching on every keystroke (after debounce for content):

1. **Immediate: Pages** --- Filter `SIDEBAR_BASE_LINKS` + role-gated admin/owner links against the query using case-insensitive substring match on `label`. Always synchronous, no delay.

2. **Immediate: Actions** --- Filter the static actions list against the query using case-insensitive substring match on `label`. Always synchronous, no delay.

3. **Debounced: Content** --- After 300ms of no typing, call `listContent({ search: query, limit: 5 })` via the existing remote function. Show a spinner/skeleton in the Content section while loading. If the query changes before the response arrives, discard the stale response.

When the input is empty, skip all matching and show the Recent Items section instead.

Minimum query length for content search: 2 characters. Below that, only static pages and actions are filtered.

### Result Groups

Each group has a section header label in small, uppercase, muted text (matching the sidebar section label style). Groups are rendered in this order:

1. **Recent** (only when input is empty) --- Last 5 visited studio pages. Each item shows a `ClockIcon`, the page label, and a muted href hint.

2. **Pages** (when input has text) --- Matching studio navigation pages. Each item shows the page's sidebar icon (from `ICON_MAP`), the label, and a muted href hint. Role-gated: admin/owner links only appear if the user has the appropriate role.

3. **Content** (when input has text, >= 2 chars) --- Matching content items from the API. Each item shows a content type icon (`VideoIcon`, `MusicIcon`, `FileTextIcon`), the title, and a `Badge` showing status (draft/published/archived). Selecting navigates to `/studio/content/{id}/edit`.

4. **Actions** (when input has text, or always shown as a footer section) --- Quick actions. Each item shows an action-specific icon and label. Selecting either navigates (`goto()`) or executes a callback.

Empty groups are hidden entirely (no header, no "no results" within the group). If ALL groups are empty after a search, show a single centered empty state: "No results for '{query}'" with `SearchXIcon`.

### Keyboard Navigation

The command palette implements a flat, linearized keyboard navigation model. All visible result items across all groups form a single ordered list. The currently highlighted item is tracked by a numeric index into this flattened list.

| Key | Behavior |
|---|---|
| `ArrowDown` | Move highlight to next item. Wraps from last to first. `preventDefault()` to block page scroll. |
| `ArrowUp` | Move highlight to previous item. Wraps from first to last. `preventDefault()` to block page scroll. |
| `Enter` | Execute the highlighted item (navigate or run action). Close palette. |
| `Escape` | Close the palette. Restore focus to the previously focused element. |
| `Cmd/Ctrl+K` | Toggle --- close the palette if already open. |
| `Tab` | Move highlight down (same as ArrowDown). `preventDefault()` to trap focus in the palette. |
| `Shift+Tab` | Move highlight up (same as ArrowUp). `preventDefault()` to trap focus in the palette. |

**Focus stays on the search input at all times.** Arrow keys change the visual highlight, but the text cursor remains in the input so the user can continue editing their query without additional key presses. This follows the combobox (ARIA `role="combobox"`) interaction pattern.

**Scroll into view.** When the highlight moves to an item outside the visible scroll area, call `element.scrollIntoView({ block: 'nearest' })` to bring it into view without jarring jumps.

**Mouse interaction.** Hovering over a result item moves the highlight to that item. Clicking a result item selects it (same as Enter). Mouse and keyboard highlight are unified --- there is one `activeIndex` state.

### Page Navigation Items

Static list derived from the sidebar navigation config. Role-gated at render time using the `userRole` prop.

| Label | Href | Icon | Roles |
|---|---|---|---|
| Dashboard | `/studio` | `LayoutDashboardIcon` | all |
| Content | `/studio/content` | `FileIcon` | all |
| Media | `/studio/media` | `VideoIcon` | all |
| Analytics | `/studio/analytics` | `TrendingUpIcon` | all |
| Team | `/studio/team` | `UsersIcon` | admin, owner |
| Customers | `/studio/customers` | `UserPlusIcon` | admin, owner |
| Settings | `/studio/settings` | `SettingsIcon` | admin, owner |
| Branding | `/studio/settings/branding` | `EditIcon` | admin, owner |
| Billing | `/studio/billing` | `CreditCardIcon` | owner |

These are hardcoded in the command palette config rather than dynamically reading the sidebar constants, because the palette includes extra items (Branding as a direct link) and flattens the role-gated hierarchy into a single list with per-item role checks.

### Action Items

Static list of quick actions. Each action has a label, icon, and either an `href` (navigation) or an `action` callback.

| Label | Icon | Behavior | Roles |
|---|---|---|---|
| Create Content | `PlusIcon` | `goto('/studio/content/new')` | all |
| Upload Media | `UploadIcon` | `goto('/studio/media')` (media page handles uploads) | all |
| View Analytics | `TrendingUpIcon` | `goto('/studio/analytics')` | all |
| View Public Site | `GlobeIcon` | `window.open('/', '_blank')` (opens org public site in new tab) | all |
| Edit Brand | `EditIcon` | `goto('/studio/settings/branding')` | admin, owner |

### Content Search

When the user types >= 2 characters and 300ms have elapsed since the last keystroke:

1. Set `contentLoading = true`.
2. Call `listContent({ search: query, limit: 5 })`.
3. On response, if the query still matches (not stale), set results and `contentLoading = false`.
4. On error, silently fail --- show no content results, no error toast. Content search is a best-effort enhancement.

Each content result displays:
- **Icon**: `VideoIcon` for video, `MusicIcon` for audio, `FileTextIcon` for written.
- **Title**: Content title, truncated with ellipsis if too long.
- **Metadata**: `Badge` with status variant (`success` for published, `neutral` for draft, `warning` for archived).
- **Action**: Navigate to `/studio/content/{id}/edit`.

### Recent Items

Persisted in localStorage under the key `codex-command-palette-recent`.

**Data structure:**
```typescript
interface RecentItem {
  href: string;    // e.g. '/studio/content'
  label: string;   // e.g. 'Content'
  timestamp: number; // Date.now() when visited
}
```

**Storage:** JSON array, max 5 items, newest first. Deduplicated by `href` --- revisiting the same page moves it to the top.

**Recording visits:** The command palette component watches `page.url.pathname` via `$effect`. On each pathname change (within the studio), it records the visit if the path matches a known page from the page navigation items list. Unknown paths (e.g., `/studio/content/abc-123/edit`) are not recorded.

**Display:** Shown only when the search input is empty. Each item shows a `ClockIcon`, the label, and a muted path hint. Items are ordered by recency (newest first).

**Clearing:** No explicit "clear recents" UI in V1. Users can clear localStorage manually. A clear action can be added later.

---

## Implementation Plan

### Files to Create

#### `apps/web/src/lib/components/studio/CommandPalette/CommandPalette.svelte`

The main component. Mounted in the studio layout. Manages:
- Open/close state (`let isOpen = $state(false)`)
- Search query (`let query = $state('')`)
- Active highlight index (`let activeIndex = $state(0)`)
- Content search results (`let contentResults = $state([])`)
- Content loading state (`let contentLoading = $state(false)`)
- Recent items (read from localStorage on mount)
- Debounce timer ref for content search
- Body scroll lock (`document.body.style.overflow`)
- Previous focus element tracking

Props:
```typescript
interface Props {
  role: string; // 'member' | 'admin' | 'owner'
}
```

Lifecycle:
- `$effect` watches `query` --- filters static items immediately, debounces content search.
- `$effect` watches `page.url.pathname` --- records recent visits, closes palette on navigation.
- `$effect` watches `isOpen` --- manages body scroll lock and focus.
- Cleanup: clears debounce timer, restores body overflow.

Template structure:
```
<svelte:window onkeydown={handleGlobalKeydown} />

{#if isOpen}
  <div class="palette-backdrop" onclick={close}>
    <div class="palette-panel" onclick|stopPropagation role="combobox" ...>
      <div class="palette-search">
        <SearchIcon />
        <input bind:value={query} ... />
      </div>
      <div class="palette-results" role="listbox">
        {#each groups as group}
          <div class="result-group" role="group">
            <div class="group-label">{group.label}</div>
            {#each group.items as item, i}
              <CommandPaletteItem {item} active={flatIndex === activeIndex} ... />
            {/each}
          </div>
        {/each}
      </div>
      <div class="palette-footer">
        keyboard hints
      </div>
    </div>
  </div>
{/if}
```

#### `apps/web/src/lib/components/studio/CommandPalette/CommandPaletteItem.svelte`

A single result row. Receives the item data and active state. Handles mouse enter (highlight) and click (select).

Props:
```typescript
interface Props {
  icon: Component;
  label: string;
  hint?: string;        // muted secondary text (href, badge, etc.)
  badge?: { label: string; variant: string }; // for content status
  active: boolean;
  onselect: () => void;
  onhover: () => void;
}
```

Template: Horizontal flex row. Icon on the left, label + hint in the middle, optional badge on the right. Active state highlighted with `var(--color-interactive-subtle)` background and `var(--color-interactive)` text, matching the sidebar active link style.

Accessibility: `role="option"`, `aria-selected={active}`, `id` for `aria-activedescendant` linkage.

#### `apps/web/src/lib/components/studio/CommandPalette/command-palette-config.ts`

Configuration module exporting:
- `PAGE_ITEMS`: Static page navigation items with label, href, icon, and required roles.
- `ACTION_ITEMS`: Static action items with label, icon, href or callback, and required roles.
- `CONTENT_TYPE_ICON_MAP`: Maps `contentType` to icon component.
- `filterByRole(items, role)`: Utility to filter items by user role.
- `filterByQuery(items, query)`: Case-insensitive substring filter on label.
- `RECENT_STORAGE_KEY`: localStorage key constant (`'codex-command-palette-recent'`).
- `MAX_RECENT_ITEMS`: 5.
- `CONTENT_SEARCH_DEBOUNCE_MS`: 300.
- `MIN_CONTENT_SEARCH_LENGTH`: 2.

#### `apps/web/src/lib/components/studio/CommandPalette/index.ts`

Barrel export: `export { default as CommandPalette } from './CommandPalette.svelte';`

### Files to Modify

#### `apps/web/src/routes/_org/[slug]/studio/+layout.svelte`

Mount the `CommandPalette` component. Add it as a sibling of the existing layout elements, outside the `.studio-layout` div (since it portals to a fixed overlay anyway).

```diff
+ import { CommandPalette } from '$lib/components/studio/CommandPalette';

  <!-- After the studio-layout div -->
+ <CommandPalette role={data.userRole} />
```

No changes to the server load. The `userRole` is already available in `data.userRole`.

#### `apps/web/src/routes/_creators/studio/+layout.svelte`

Same change as the org studio layout --- mount `CommandPalette` with the appropriate role. This ensures the command palette works in the personal/creator studio context as well.

#### `apps/web/src/paraglide/messages/` (i18n)

New message keys:
- `command_palette_placeholder`: "Search studio..."
- `command_palette_no_results`: "No results for '{query}'"
- `command_palette_group_recent`: "Recent"
- `command_palette_group_pages`: "Pages"
- `command_palette_group_content`: "Content"
- `command_palette_group_actions`: "Actions"
- `command_palette_hint_navigate`: "to navigate"
- `command_palette_hint_select`: "to select"
- `command_palette_hint_close`: "to close"
- `command_palette_action_create_content`: "Create Content"
- `command_palette_action_upload_media`: "Upload Media"
- `command_palette_action_view_analytics`: "View Analytics"
- `command_palette_action_view_public_site`: "View Public Site"
- `command_palette_action_edit_brand`: "Edit Brand"

---

## Accessibility

### ARIA Roles and Properties

The command palette follows the [ARIA Combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) with a listbox popup:

| Element | Role / Attribute | Value |
|---|---|---|
| Search input | `role` | `combobox` |
| Search input | `aria-expanded` | `true` (always, while palette is open) |
| Search input | `aria-controls` | ID of the results listbox |
| Search input | `aria-activedescendant` | ID of the currently highlighted item |
| Search input | `aria-autocomplete` | `list` |
| Search input | `aria-label` | `m.command_palette_placeholder()` |
| Results container | `role` | `listbox` |
| Results container | `aria-label` | "Search results" |
| Group wrapper | `role` | `group` |
| Group wrapper | `aria-labelledby` | ID of the group label element |
| Group label | `role` | `presentation` (decorative, referenced by `aria-labelledby`) |
| Each result item | `role` | `option` |
| Each result item | `aria-selected` | `true` if highlighted, `false` otherwise |
| Each result item | `id` | Unique, stable ID (e.g., `cp-item-{index}`) |
| Backdrop | `aria-hidden` | `true` |

### Focus Management

1. **On open:** Save `document.activeElement` as `previousFocus`. Move focus to the search input via `input.focus()`. This happens in a microtask (`tick()`) to ensure the DOM is rendered.
2. **While open:** Focus remains on the search input. Arrow keys change `activeIndex` but do not move DOM focus. The `aria-activedescendant` attribute on the input tells screen readers which item is highlighted.
3. **On close:** Restore focus to `previousFocus` if it is still in the DOM. If not (e.g., element was removed during navigation), do not force focus anywhere.
4. **Focus trap:** Tab and Shift+Tab are intercepted and repurposed for item navigation. No focusable elements exist in the palette besides the search input, so a traditional focus trap is not needed --- the input is the only tab stop.

### Screen Reader Announcements

- When the palette opens, the search input's label announces "Search studio...".
- As `aria-activedescendant` changes, screen readers announce the newly highlighted item.
- When content search results load, a visually hidden live region (`aria-live="polite"`) announces "{N} content results" or "No content results".
- When the palette closes, focus returns silently to the previous element.

---

## Testing Notes

### Unit Tests (`CommandPalette.test.ts`)

- **Shortcut detection**: Verify that `Cmd+K` and `Ctrl+K` toggle the palette open state.
- **Contenteditable guard**: Verify the shortcut is ignored when `activeElement` is inside a `contenteditable`.
- **Static filtering**: Verify pages and actions filter correctly by query substring.
- **Role gating**: Verify admin/owner items are hidden for `member` role, visible for `admin` and `owner`.
- **Keyboard navigation**: Verify ArrowDown/ArrowUp cycle through items, wrap at boundaries, and update `activeIndex`.
- **Enter selection**: Verify selecting a page item calls `goto()` with the correct href.
- **Escape closes**: Verify Escape sets `isOpen` to false.
- **Recent items**: Verify localStorage read/write. Verify deduplication and max-5 limit. Verify newest-first ordering.
- **Empty state**: Verify "No results" message when query matches nothing.

### Integration Tests

- **Content search debounce**: Verify the remote function is not called until 300ms after the last keystroke. Verify stale responses are discarded.
- **Navigation closes palette**: Verify the palette closes after `goto()` resolves and the pathname changes.
- **Focus restoration**: Verify focus returns to the previously focused element after close.
- **Body scroll lock**: Verify `document.body.style.overflow` is set to `hidden` on open and restored on close.

### Manual / Playwright Checks

- Open palette with Cmd+K on macOS, Ctrl+K on Linux.
- Type a query, see page results instantly, content results after debounce.
- Arrow through all results across groups, verify highlight wraps.
- Press Enter on a content result, verify navigation to the edit page.
- Press Escape, verify palette closes and focus returns.
- Open palette on a page with a TipTap editor, verify Cmd+K does NOT open the palette when the editor is focused.
- Verify the palette does not appear on public org pages (`/explore`, `/content/...`).
- Verify role-gated items are hidden for a `member` user.
- Resize to mobile viewport, verify the palette is still usable and correctly positioned.
- Navigate to several studio pages, reopen the palette with empty input, verify recent items appear in order.
