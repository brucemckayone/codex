# Studio Chrome Improvements -- Implementation Spec

## Summary

Five studio-specific chrome and navigation improvements that make the creator dashboard more usable, informative, and efficient. Each item targets a different part of the studio shell (mobile nav, sidebar, switcher, content list) with no cross-dependencies between them.

1. **Mobile hamburger improvements** -- Full-screen overlay for the studio mobile header with all sidebar links, user menu, and search.
2. **Collapsible studio sidebar** -- Icon-only collapsed mode with a toggle button, preference saved in localStorage.
3. **Sidebar badge counts** -- Draft count badge on the Content nav item, pending-invite count badge on Team.
4. **Enhanced studio switcher** -- Org logo + role badge in the switcher dropdown, "View Public Site" link.
5. **Content list search in studio** -- Search input above the content table that filters via the existing `?search=` API parameter.

---

## Feasibility

### Pros

- The content-api already supports `?search=` as a query parameter on `GET /api/content` (wired through `ContentService.list()` using `ilike` on title and description). The frontend just needs to pass it through.
- `OrganizationWithRole` (from `getMyOrganizations()`) already includes `role`, `logoUrl`, `name`, and `slug` -- all data needed for the enhanced switcher is already loaded by the studio layout server load.
- The membership schema has a `status` column with `'invited'` as a valid value, so pending invite counts can be derived from an existing query (filtered by `status = 'invited'`).
- The existing `Badge` component (`apps/web/src/lib/components/ui/Badge/Badge.svelte`) supports multiple variants and can be reused for count badges with minimal styling additions.
- `SearchIcon` already exists in the Icon library.
- The studio layout already has a mobile hamburger with overlay/drawer pattern -- the improvement extends it rather than replacing it.
- localStorage preference persistence is a proven pattern in the codebase (see `codex-view-mode` in spec-02, version manifest in `$lib/client/version-manifest.ts`).

### Gotchas & Risks

- **Sidebar collapse + mobile interaction**: The sidebar is already `position: fixed` + `translateX(-100%)` on mobile. The collapsed mode only applies at desktop breakpoint (`--breakpoint-lg`). Mobile always uses the full-width drawer. The CSS must ensure these two modes do not interfere.
- **Sidebar width transition**: Transitioning from `240px` to icon-only (~56px) requires the `--sidebar-width` custom property to be dynamic. The `studio-main` content area currently uses `flex: 1` which will naturally fill the space, but the sticky sidebar height calc (`100vh - var(--space-16)`) must remain correct in both modes.
- **Badge count data source**: Draft counts and pending invite counts are not currently returned by the studio layout server load. The layout load must be extended with two additional API calls (content count by status, members with `status = 'invited'`). These should run in the existing `Promise.all` to avoid sequential waterfalls.
- **Content count API**: There is no dedicated "count by status" endpoint. The simplest approach is to call `api.content.list` with `status=draft&limit=1` and read `pagination.total`. This is lightweight (single row + count query) and avoids a new backend endpoint.
- **Pending invites count**: The org membership list endpoint (`api.org.getMembers`) does not currently filter by `status`. A new query parameter or a dedicated count endpoint would be needed. Alternatively, the layout load can fetch the full member list and count client-side if the org is small. For V1, fetching members with `limit=1&status=invited` is the cleanest approach, but requires adding `status` filter support to the members endpoint.
- **Search debounce**: The content list search must debounce input to avoid excessive server requests. A 300ms debounce is standard. The search term should sync to the URL as `?search=` so the state survives page refresh and works with pagination.
- **Switcher cross-origin navigation**: The StudioSwitcher already uses `buildOrgUrl()` for cross-org links. The "View Public Site" link also needs this for the current org's public site (different subdomain on production, same origin in dev).
- **i18n**: Several new message keys are needed (search placeholder, badge aria-labels, collapse button label, "View Public Site" label).

---

## Current State

### Studio Layout Structure

The studio shell is defined in `apps/web/src/routes/_org/[slug]/studio/+layout.svelte` and consists of:

1. **Mobile header** (`studio-header.mobile`): Shows at `< --breakpoint-lg`. Contains hamburger toggle, org brand link, and `StudioSwitcher`. Tapping the hamburger slides in the sidebar as a fixed overlay.
2. **Desktop header** (`studio-header.desktop`): Shows at `>= --breakpoint-lg`. Contains org brand link and `StudioSwitcher`. Sits above the sidebar + content area.
3. **Sidebar** (`studio-sidebar`): Fixed overlay on mobile (toggled by hamburger), sticky column on desktop. Renders `StudioSidebar` which has role-gated nav sections (base, admin, owner).
4. **Main content** (`studio-main`): Flex child that fills remaining horizontal space.

### Server Load (`+layout.server.ts`)

Loads in parallel:
- `getMyMembership(org.id)` -- returns `{ role, joinedAt }`
- `getMyOrganizations()` -- returns `OrganizationWithRole[]` with `{ id, name, slug, logoUrl, role }`

Returns: `{ org, userRole, userJoinedAt, orgs }`

### StudioSidebar Component

Located at `apps/web/src/lib/components/layout/StudioSidebar/StudioSidebar.svelte`.

- Receives `role` and `context` ('personal' | 'org') as props.
- Renders nav sections from `$lib/config/navigation.ts`: `SIDEBAR_BASE_LINKS`, `SIDEBAR_ADMIN_LINKS`, `SIDEBAR_OWNER_LINKS`.
- Each link has an icon (mapped via `ICON_MAP`), label text, and active state detection via `isActive()`.
- Width is set by `--sidebar-width` (default 240px), padding `var(--space-4) 0`.

### StudioSwitcher Component

Located at `apps/web/src/lib/components/layout/StudioSidebar/StudioSwitcher.svelte`.

- Uses `DropdownMenu` (Melt UI) with a trigger showing a `UsersIcon`, current org name, and chevron.
- Lists "Personal Studio" and all orgs from `orgs` prop.
- Each org shows a logo thumbnail or fallback initial, name, and a check icon if currently selected.
- Uses `buildOrgUrl()` for cross-origin navigation between org studios.

### MobileNav Component

Located at `apps/web/src/lib/components/layout/Header/MobileNav.svelte`.

- Generic drawer component used by OrgHeader (not studio).
- Slides from right, shows nav links + user section + logout.
- Accepts `variant`, `user`, `links`, and optional `actions` snippet.

### Content List Page

Located at `apps/web/src/routes/_org/[slug]/studio/content/+page.svelte`.

- Uses `PageHeader` with title and "New Content" button.
- Renders `ContentTable` with items from server load.
- `+page.server.ts` calls `api.content.list(params)` with `organizationId`, `page`, `limit`, `sortBy`, `sortOrder`.
- Does NOT currently pass `search` parameter.

---

## Design Spec

### 1. Mobile Nav Overlay

The current studio mobile experience opens the sidebar as a left-sliding drawer. This works for nav links but lacks the user context and quick actions that MobileNav provides for the org public site. The improvement brings the studio mobile drawer to parity.

#### Current Behavior

Hamburger button in `studio-header.mobile` toggles `mobileMenuOpen`, which slides the `studio-sidebar` aside in from the left with a backdrop overlay. The sidebar only shows nav links (StudioSidebar component). There is no user info, logout, or link to the public site.

#### Target Behavior

When the mobile menu is open, the drawer should show:

1. **Org brand** (logo + name) at the top of the drawer, linking to `/studio`.
2. **All sidebar nav links** (same as StudioSidebar, including role-gated sections).
3. **Divider**.
4. **"View Public Site"** link -- navigates to the org's public homepage (`/`).
5. **User section** at bottom -- name, email, "Account" link, "Log Out" button.

#### Implementation Approach

Rather than replacing the sidebar drawer, extend the existing `StudioSidebar` component with optional `user` and `showUserSection` props that render the additional content when in mobile context:

```svelte
<!-- In studio +layout.svelte, pass user data to sidebar -->
<StudioSidebar role={data.userRole} context="org" user={mobileMenuOpen ? data.user : undefined} />
```

Inside StudioSidebar, conditionally render below the nav sections:

```svelte
{#if user}
  <div class="sidebar-footer">
    <div class="section-divider"></div>
    <a href="/" class="nav-item footer-link">
      <GlobeIcon size={18} />
      {m.studio_view_public_site()}
    </a>
    <div class="section-divider"></div>
    <div class="user-info">
      <span class="user-name">{user.name}</span>
      <span class="user-email">{user.email}</span>
    </div>
    <a href="/account" class="nav-item footer-link">
      <UserIcon size={18} />
      {m.nav_account()}
    </a>
    <button class="nav-item logout-item" onclick={() => submitFormPost('/logout')}>
      {m.nav_log_out()}
    </button>
  </div>
{/if}
```

#### Props Change to StudioSidebar

```typescript
interface Props {
  role: string;
  context: 'personal' | 'org';
  user?: { name: string; email: string } | undefined;  // NEW -- only passed when mobile drawer is open
}
```

#### CSS Additions

```css
.sidebar-footer {
  margin-top: auto;
  padding-bottom: var(--space-4);
}

.footer-link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.user-info {
  display: flex;
  flex-direction: column;
  padding: var(--space-2) var(--space-6);
}

.user-name {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--color-text);
}

.user-email {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.logout-item {
  color: var(--color-error);
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  cursor: pointer;
}
```

The sidebar already uses `display: flex; flex-direction: column` for the sidebar-nav. The sidebar root element should get `display: flex; flex-direction: column; height: 100%` so the footer is pushed to the bottom via `margin-top: auto`.

#### Data Requirement

The studio layout already has access to `locals.user` (from the auth gate). The user data (name, email) needs to be included in the layout return. Currently the layout returns `org`, `userRole`, `userJoinedAt`, and `orgs`. Add:

```typescript
return {
  // ... existing fields ...
  user: {
    name: locals.user.name,
    email: locals.user.email,
  },
};
```

#### New i18n Keys

- `studio_view_public_site` -- "View Public Site"

---

### 2. Collapsible Sidebar

A toggle button that collapses the desktop sidebar to icon-only mode (approximately 56px wide). The preference is saved in localStorage so it persists across sessions.

#### Toggle Button

A small button positioned at the bottom of the sidebar (or inline with the section dividers). Uses a `ChevronsLeftIcon` when expanded and `ChevronsRightIcon` when collapsed.

Position: Bottom of the sidebar nav, below all link sections, above the mobile-only user footer. Visible only at desktop breakpoint.

```svelte
<!-- Inside StudioSidebar, after all nav sections -->
<button
  class="collapse-toggle"
  onclick={onToggleCollapse}
  aria-label={collapsed ? m.studio_sidebar_expand() : m.studio_sidebar_collapse()}
>
  {#if collapsed}
    <ChevronsRightIcon size={16} />
  {:else}
    <ChevronsLeftIcon size={16} />
    <span class="collapse-label">{m.studio_sidebar_collapse()}</span>
  {/if}
</button>
```

#### Props Change to StudioSidebar

```typescript
interface Props {
  role: string;
  context: 'personal' | 'org';
  user?: { name: string; email: string } | undefined;
  collapsed?: boolean;      // NEW
  onToggleCollapse?: () => void;  // NEW
}
```

#### localStorage Key

```
codex-studio-sidebar-collapsed
```

Value: `"true"` or absent (default expanded). Read in the studio layout:

```svelte
<script lang="ts">
  import { browser } from '$app/environment';

  const SIDEBAR_KEY = 'codex-studio-sidebar-collapsed';

  let sidebarCollapsed = $state(
    browser ? localStorage.getItem(SIDEBAR_KEY) === 'true' : false
  );

  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    if (browser) {
      if (sidebarCollapsed) {
        localStorage.setItem(SIDEBAR_KEY, 'true');
      } else {
        localStorage.removeItem(SIDEBAR_KEY);
      }
    }
  }
</script>
```

#### CSS Approach

Use a CSS custom property `--sidebar-width` that changes based on collapsed state, set on the `.studio-layout` container:

```svelte
<div
  class="studio-layout"
  style:--sidebar-width={sidebarCollapsed ? '56px' : '240px'}
>
```

In StudioSidebar, when collapsed:
- Hide label text (nav link text, section labels).
- Center icons in the available space.
- Show tooltips on hover (native `title` attribute is sufficient for V1).

```css
/* Collapsed mode -- applied via data-collapsed attribute on the sidebar */
.sidebar[data-collapsed='true'] .nav-item {
  justify-content: center;
  padding: var(--space-2);
}

.sidebar[data-collapsed='true'] .nav-item span,
.sidebar[data-collapsed='true'] .section-label,
.sidebar[data-collapsed='true'] .section-divider,
.sidebar[data-collapsed='true'] .collapse-label {
  display: none;
}

.sidebar[data-collapsed='true'] .collapse-toggle {
  justify-content: center;
}
```

Add `title={link.label}` to each nav item `<a>` element so hovering shows the label as a tooltip when collapsed.

#### Sidebar Width Transition

Add a smooth transition on the sidebar width change:

```css
.studio-sidebar {
  transition: width var(--duration-normal) var(--ease-default);
}
```

The `studio-main` area uses `flex: 1` and will naturally grow/shrink.

#### Mobile: No Change

On mobile (`< --breakpoint-lg`), the sidebar is always full-width when open and hidden when closed. The collapsed state has no effect. The toggle button is hidden below the desktop breakpoint:

```css
.collapse-toggle {
  display: none;
}

@media (--breakpoint-lg) {
  .collapse-toggle {
    display: flex;
  }
}
```

#### New Icons Required

- `ChevronsLeftIcon.svelte` -- double chevron pointing left (Lucide `chevrons-left`).
- `ChevronsRightIcon.svelte` -- double chevron pointing right (Lucide `chevrons-right`).

Both follow the existing `IconBase` pattern.

#### New i18n Keys

- `studio_sidebar_collapse` -- "Collapse"
- `studio_sidebar_expand` -- "Expand sidebar"

---

### 3. Sidebar Badge Counts

Show numeric count badges on specific sidebar nav items to surface actionable information at a glance.

#### Which Items Get Badges

| Nav Item | Badge Meaning | Data Source |
|----------|---------------|-------------|
| Content (`/studio/content`) | Number of draft content items | `api.content.list` with `status=draft&limit=1`, read `pagination.total` |
| Team (`/studio/team`) | Number of pending invites | `api.org.getMembers` with `status=invited&limit=1`, read `pagination.total` (requires adding status filter support) |

#### Data Loading

Extend the studio layout server load to fetch counts in the existing `Promise.all`:

```typescript
// In +layout.server.ts
const [membership, orgsResult, draftCountResult, pendingInviteResult] = await Promise.all([
  getMyMembership(org.id),
  getMyOrganizations(),
  getDraftContentCount(org.id),     // NEW remote function
  getPendingInviteCount(org.id),    // NEW remote function
]);

return {
  // ... existing fields ...
  badgeCounts: {
    draftContent: draftCountResult ?? 0,
    pendingInvites: pendingInviteResult ?? 0,
  },
};
```

The remote functions wrap lightweight API calls:

```typescript
// In a new or existing remote file
export async function getDraftContentCount(orgId: string): Promise<number> {
  const params = new URLSearchParams();
  params.set('organizationId', orgId);
  params.set('status', 'draft');
  params.set('limit', '1');
  params.set('page', '1');
  const api = createServerApi(platform, cookies);
  const result = await api.content.list(params);
  return result?.pagination?.total ?? 0;
}
```

For pending invites, this requires the members endpoint to support `status` filtering. If that is not feasible in V1, skip the Team badge and only ship the Content draft count badge (which works with the existing API).

#### Badge Component

Create a small `NavBadge` sub-component (or use inline markup). This is distinct from the general-purpose `Badge` component because it is a small circular count indicator, not a status label.

```svelte
<!-- NavBadge.svelte (inside StudioSidebar directory) -->
<script lang="ts">
  interface Props {
    count: number;
  }

  const { count }: Props = $props();
</script>

{#if count > 0}
  <span class="nav-badge" aria-label="{count} items">
    {count > 99 ? '99+' : count}
  </span>
{/if}

<style>
  .nav-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--space-5);
    height: var(--space-5);
    padding: 0 var(--space-1);
    border-radius: var(--radius-full);
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    line-height: var(--leading-none);
    margin-left: auto;
  }
</style>
```

#### Sidebar Integration

The `StudioSidebar` Props gain a `badgeCounts` prop:

```typescript
interface Props {
  role: string;
  context: 'personal' | 'org';
  user?: { name: string; email: string } | undefined;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  badgeCounts?: { draftContent: number; pendingInvites: number };  // NEW
}
```

In the nav item rendering, add the badge after the label:

```svelte
<a href={link.href} class="nav-item" ...>
  <Icon size={18} class="nav-icon" />
  <span class="nav-label">{link.label}</span>
  {#if link.icon === 'content' && badgeCounts?.draftContent}
    <NavBadge count={badgeCounts.draftContent} />
  {/if}
  {#if link.icon === 'team' && badgeCounts?.pendingInvites}
    <NavBadge count={badgeCounts.pendingInvites} />
  {/if}
</a>
```

The label text needs wrapping in a `<span>` with class `nav-label` (currently it is bare text) for proper flex layout: icon, label (flex: 1), badge (margin-left: auto).

#### Collapsed Mode

When the sidebar is collapsed, badges should render as a small dot indicator rather than a number (the space is too narrow for text). Use CSS to hide the text and show a dot:

```css
.sidebar[data-collapsed='true'] .nav-badge {
  min-width: var(--space-2);
  width: var(--space-2);
  height: var(--space-2);
  padding: 0;
  font-size: 0;
  position: absolute;
  top: var(--space-1);
  right: var(--space-1);
}

.sidebar[data-collapsed='true'] .nav-item {
  position: relative;
}
```

#### Caching

Badge counts are loaded on the studio layout server load (`depends('cache:studio')`). They refresh on hard refresh but NOT on sub-page navigation within studio (which is correct -- a count changing every click would be distracting). Counts will refresh when the user navigates away from studio and back.

---

### 4. Enhanced Studio Switcher

The current StudioSwitcher shows org names with a logo/initial and a check for the active one. The enhancement adds role information and a quick link to the public site.

#### Current State

The `StudioSwitcher` dropdown trigger shows: `UsersIcon` + org name + `ChevronDownIcon`. The dropdown lists "Personal Studio" and all orgs with logo/initial + name + check.

#### Target State

**Trigger**: Replace the generic `UsersIcon` with the current org's logo (if available) or the initial fallback. This gives immediate visual context:

```svelte
<DropdownMenuTrigger class="switcher-trigger">
  {#if currentOrg?.logoUrl}
    <img src={currentOrg.logoUrl} alt="" class="trigger-logo" />
  {:else}
    <span class="trigger-initial">{currentOrgName[0]}</span>
  {/if}
  <span class="switcher-label">{label}</span>
  <ChevronDownIcon size={14} class="switcher-chevron" />
</DropdownMenuTrigger>
```

**Dropdown items**: Add a role badge next to each org name. The `orgs` data already includes `role` (from `OrganizationWithRole`), but the current layout maps orgs to `{ name, slug, logoUrl }`, dropping the role. The layout needs to preserve it:

```typescript
// In +layout.server.ts, change the orgs mapping to include role
const orgs = (orgsResult ?? []).map((o) => ({
  name: o.name,
  slug: o.slug,
  logoUrl: o.logoUrl ?? undefined,
  role: o.role,  // NEW -- preserve for switcher
}));
```

In the dropdown, show the role as a small badge:

```svelte
{#each orgs as orgItem}
  <a href={buildOrgUrl(page.url, orgItem.slug, '/studio')}>
    <DropdownMenuItem>
      <span class="item-content">
        {#if orgItem.logoUrl}
          <img src={orgItem.logoUrl} alt="" class="org-icon" />
        {:else}
          <span class="org-icon-fallback">{orgItem.name[0]}</span>
        {/if}
        <span class="item-text">
          <span class="item-name">{orgItem.name}</span>
          <span class="item-role">{orgItem.role}</span>
        </span>
      </span>
      {#if currentSlug === orgItem.slug}
        <CheckIcon size={16} class="check" />
      {/if}
    </DropdownMenuItem>
  </a>
{/each}
```

**"View Public Site" link**: Add a separator and a link at the bottom of the dropdown:

```svelte
<DropdownMenuSeparator />
<a href="/">
  <DropdownMenuItem>
    <span class="item-content">
      <GlobeIcon size={16} />
      {m.studio_view_public_site()}
    </span>
  </DropdownMenuItem>
</a>
```

On org subdomains, `href="/"` is root-relative and navigates to the org's public landing page (correct per the subdomain routing rules).

#### Props Change to StudioSwitcher

```typescript
interface Props {
  currentContext: 'personal' | 'org';
  currentSlug?: string;
  orgs: Array<{           // CHANGED -- added role
    name: string;
    slug: string;
    logoUrl?: string;
    role: string;
  }>;
}
```

#### CSS Additions

```css
.trigger-logo {
  width: var(--space-5);
  height: var(--space-5);
  border-radius: var(--radius-sm);
  object-fit: contain;
}

.trigger-initial {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--space-5);
  height: var(--space-5);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-secondary);
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
}

.item-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
}

.item-name {
  font-weight: var(--font-medium);
}

.item-role {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  text-transform: capitalize;
}
```

#### New i18n Keys

(Reuses `studio_view_public_site` from section 1.)

---

### 5. Content List Search

A search input at the top of the studio content list that filters content by title/description using the existing `?search=` API parameter.

#### Placement

Between the `PageHeader` and the `ContentTable` (or empty state). Sits inside a new `.content-controls` bar that can later hold status filters, sort, etc.

```svelte
<div class="content-page">
  <PageHeader title={m.studio_content_title()}>
    {#snippet actions()}
      <a href="/studio/content/new" class="create-btn">
        <PlusIcon size={16} />
        {m.studio_content_create()}
      </a>
    {/snippet}
  </PageHeader>

  <!-- NEW: Controls bar with search -->
  <div class="content-controls">
    <div class="search-input-wrapper">
      <SearchIcon size={16} class="search-icon" />
      <input
        type="search"
        class="search-input"
        placeholder={m.studio_content_search_placeholder()}
        value={searchQuery}
        oninput={handleSearchInput}
      />
      {#if searchQuery}
        <button class="search-clear" onclick={clearSearch} aria-label={m.studio_content_search_clear()}>
          <XIcon size={14} />
        </button>
      {/if}
    </div>
  </div>

  {#if hasContent}
    <ContentTable items={data.content.items} />
    <!-- pagination ... -->
  {:else}
    <!-- empty state ... -->
  {/if}
</div>
```

#### Search Behavior

1. **Debounce**: 300ms debounce on input to avoid excessive requests.
2. **URL sync**: The search term is synced to the URL as `?search=`. This means:
   - Typing triggers `goto()` with the search param after debounce.
   - The server load reads `url.searchParams.get('search')` and passes it to the API.
   - Page refresh preserves the search term.
   - Clearing the input removes the `?search=` param.
3. **Pagination reset**: When the search term changes, reset to page 1.

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { SearchIcon, XIcon } from '$lib/components/ui/Icon';

  // Read initial search from URL
  let searchQuery = $state(page.url.searchParams.get('search') ?? '');
  let debounceTimer: ReturnType<typeof setTimeout>;

  function handleSearchInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    searchQuery = value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      navigateWithSearch(value);
    }, 300);
  }

  function clearSearch() {
    searchQuery = '';
    clearTimeout(debounceTimer);
    navigateWithSearch('');
  }

  function navigateWithSearch(search: string) {
    const params = new URLSearchParams(page.url.searchParams);
    if (search) {
      params.set('search', search);
    } else {
      params.delete('search');
    }
    params.delete('page'); // Reset to page 1 on search change
    const query = params.toString();
    goto(`/studio/content${query ? `?${query}` : ''}`, { replaceState: true, keepFocus: true });
  }
</script>
```

#### Server Load Change

In `+page.server.ts`, read the search param and pass it to the API:

```typescript
// After existing page/limit parsing
const search = url.searchParams.get('search')?.trim() || undefined;

// In the params builder
if (search) {
  params.set('search', search);
}
```

No backend changes needed -- `api.content.list` already forwards all URLSearchParams to the content-api, which supports `?search=` via `ilike` on title and description.

#### CSS

```css
.content-controls {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: var(--border-width) var(--border-style) var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface);
  transition: var(--transition-colors);
  width: 100%;
  max-width: 320px;
}

.search-input-wrapper:focus-within {
  border-color: var(--color-interactive);
  box-shadow: 0 0 0 var(--border-width) var(--color-interactive);
}

:global(.search-icon) {
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--text-sm);
  color: var(--color-text);
  font-family: var(--font-sans);
}

.search-input::placeholder {
  color: var(--color-text-muted);
}

/* Remove default search cancel button (browser-provided) */
.search-input::-webkit-search-cancel-button {
  display: none;
}

.search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-0-5);
  border: none;
  background: none;
  color: var(--color-text-muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: var(--transition-colors);
}

.search-clear:hover {
  color: var(--color-text);
  background-color: var(--color-surface-secondary);
}
```

#### Empty State for Search

When search returns no results but there IS content (i.e., a search is active and returns 0 items), show a search-specific empty state rather than the "no content" empty state:

```svelte
{#if hasContent}
  <ContentTable items={data.content.items} />
{:else if searchQuery}
  <EmptyState
    title={m.studio_content_search_empty()}
    description={m.studio_content_search_empty_description()}
    icon={SearchIcon}
  >
    {#snippet action()}
      <button class="empty-cta" onclick={clearSearch}>
        {m.studio_content_search_clear_filter()}
      </button>
    {/snippet}
  </EmptyState>
{:else}
  <EmptyState title={m.studio_content_empty()} icon={FileIcon}>
    <!-- existing "create content" CTA -->
  </EmptyState>
{/if}
```

The `hasContent` derived should also account for whether a search is active:

```typescript
const isSearchActive = $derived(!!searchQuery);
const hasContent = $derived(data.content.items.length > 0 || currentPage > 1);
```

#### New i18n Keys

- `studio_content_search_placeholder` -- "Search content..."
- `studio_content_search_clear` -- "Clear search"
- `studio_content_search_empty` -- "No matching content"
- `studio_content_search_empty_description` -- "Try a different search term or clear the filter."
- `studio_content_search_clear_filter` -- "Clear search"

---

## Implementation Plan

### Files to Create

| File | Purpose |
|------|---------|
| `apps/web/src/lib/components/layout/StudioSidebar/NavBadge.svelte` | Small count badge for sidebar nav items |
| `apps/web/src/lib/components/ui/Icon/ChevronsLeftIcon.svelte` | Double-left-chevron icon for sidebar collapse |
| `apps/web/src/lib/components/ui/Icon/ChevronsRightIcon.svelte` | Double-right-chevron icon for sidebar expand |

### Files to Modify

| File | Change |
|------|--------|
| **`apps/web/src/routes/_org/[slug]/studio/+layout.svelte`** | Add `sidebarCollapsed` state with localStorage read/write, pass `collapsed`, `onToggleCollapse`, `user`, and `badgeCounts` to StudioSidebar, set dynamic `--sidebar-width` via style binding |
| **`apps/web/src/routes/_org/[slug]/studio/+layout.server.ts`** | Add `user` (name, email) to return, add draft count + pending invite count to the `Promise.all`, return `badgeCounts` |
| **`apps/web/src/lib/components/layout/StudioSidebar/StudioSidebar.svelte`** | Add `user`, `collapsed`, `onToggleCollapse`, `badgeCounts` props, wrap nav label text in `<span class="nav-label">`, render `NavBadge` for content/team items, render collapse toggle button, render user footer section conditionally, add `data-collapsed` attribute, add corresponding CSS |
| **`apps/web/src/lib/components/layout/StudioSidebar/StudioSwitcher.svelte`** | Replace `UsersIcon` trigger with org logo/initial, add `role` display per org item, add "View Public Site" link at bottom of dropdown, update `orgs` prop type to include `role` |
| **`apps/web/src/routes/_org/[slug]/studio/content/+page.svelte`** | Add search input with debounce, `goto()` URL sync, clear button, search-specific empty state |
| **`apps/web/src/routes/_org/[slug]/studio/content/+page.server.ts`** | Read `search` from `url.searchParams`, pass to `api.content.list` params |
| **`apps/web/src/lib/components/ui/Icon/index.ts`** | Add exports for `ChevronsLeftIcon`, `ChevronsRightIcon` |
| **`apps/web/src/lib/config/navigation.ts`** | No change needed (link definitions stay the same) |
| **`apps/web/src/paraglide/messages/`** | Add new i18n keys listed in each section above |

### Backend Changes (Minimal)

| File | Change |
|------|--------|
| **Organization members endpoint** (if implementing Team badge) | Add optional `status` query parameter filter to the members list endpoint so `?status=invited&limit=1` returns the pending invite count. If this is deferred, skip the Team badge in V1 and only ship the Content draft count badge. |

---

## Testing Notes

### Mobile Nav Overlay
- Open studio on mobile viewport (< 1024px). Tap hamburger. Verify the drawer shows all nav links, "View Public Site", user name/email, Account link, and Log Out.
- Tap "View Public Site". Verify navigation to the org's public landing page.
- Tap "Log Out". Verify logout flow triggers.
- Tap a nav link. Verify drawer closes and navigation occurs.
- Press Escape. Verify drawer closes.
- Verify desktop viewport does NOT show the user footer section in the sidebar.

### Collapsible Sidebar
- On desktop, click the collapse toggle. Verify sidebar shrinks to icon-only width (~56px).
- Hover over an icon in collapsed mode. Verify tooltip shows the link label.
- Click toggle again. Verify sidebar expands back to full width.
- Refresh the page. Verify the collapsed/expanded state persists (check `localStorage.getItem('codex-studio-sidebar-collapsed')`).
- Verify the main content area fills the freed space smoothly (no layout jumps).
- On mobile, verify the collapse toggle is NOT visible.
- Verify active state styling works correctly in both collapsed and expanded modes.

### Sidebar Badge Counts
- Create several draft content items. Navigate to studio. Verify the Content nav item shows the correct draft count.
- Publish all drafts. Refresh. Verify the badge disappears (count = 0).
- Verify the badge renders as a small dot (not a number) when the sidebar is collapsed.
- Verify badge has proper `aria-label` for screen readers.
- Verify counts over 99 display as "99+".

### Enhanced Studio Switcher
- Open the switcher dropdown. Verify each org shows its logo (or initial fallback) and role badge.
- Verify the trigger shows the current org's logo instead of the generic `UsersIcon`.
- Verify "View Public Site" link appears at the bottom of the dropdown.
- Click "View Public Site". Verify navigation to the org's public page.
- Switch between orgs. Verify the check icon correctly indicates the current org.
- Verify the role text is correctly capitalized (e.g., "Owner", "Admin", "Creator").

### Content List Search
- Type a search term in the input. Verify the table updates after ~300ms debounce.
- Verify the URL updates to include `?search=term` (check address bar).
- Refresh the page with `?search=term` in the URL. Verify the search input is pre-filled and results are filtered.
- Clear the search (click X or delete text). Verify the URL param is removed and full results return.
- Search for a term with no results. Verify the search-specific empty state appears (not the "no content" empty state).
- Verify pagination resets to page 1 when search term changes.
- Verify the search input has proper focus ring styling.
- Verify the native browser search cancel button is hidden (`::-webkit-search-cancel-button`).
