# P1-FE-ACCESS-001: Library

**Priority**: P1
**Status**: 🚧 Not Started
**Estimated Effort**: 3-4 days
**Beads Task**: Codex-vw8.5

---

## Table of Contents

- [Overview](#overview)
- [System Context](#system-context)
- [Library Page](#library-page)
- [Filtering & Search](#filtering--search)
- [Content Cards](#content-cards)
- [Remote Functions](#remote-functions)
- [Dependencies](#dependencies)
- [Implementation Checklist](#implementation-checklist)
- [Testing Strategy](#testing-strategy)

---

## Overview

This work packet implements the user's content library - a platform-level page aggregating all purchased content across all organizations. The library is accessed at `revelations.studio/library` (not org-scoped) and provides filtering, search, and progress indicators.

Key features:
- **Cross-org aggregation**: Shows content from all orgs user has purchased from
- **Progress tracking**: Visual indicators for not started, in progress, completed
- **Filtering**: By org, content type, progress status
- **Search**: Title and creator search
- **Responsive grid**: Adapts to screen size

---

## System Context

### Upstream Dependencies

| System | What We Consume |
|--------|-----------------|
| **Access-API** (port 4001) | Library content list, progress data |
| **P1-FE-FOUNDATION-001** | Project setup, hooks |
| **P1-FE-FOUNDATION-002** | Card, Badge, Input, Skeleton |
| **P1-FE-CONTENT-001** | ContentCard component (shared) |

### Downstream Consumers

| System | What We Provide |
|--------|-----------------|
| N/A | End-user feature |

### Data Flow

```
User visits /library (must be authenticated)
    │
    ▼
+page.server.ts → redirect if not authenticated
    │
    ▼
Fetch library from Access-API
    │
    ▼
Render grid with filters
    │
    ▼
User clicks content → Navigate to org content page
```

---

## Library Page

### Route Structure

```
src/routes/(platform)/library/
├── +page.svelte           # Library page
├── +page.server.ts        # Server load (auth check, initial data)
└── library.remote.ts      # Remote functions (filter, search)
```

### +page.server.ts

```typescript
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createServerApi } from '$lib/server/api';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
  // Require authentication
  if (!locals.user) {
    redirect(302, `/login?redirect=${encodeURIComponent('/library')}`);
  }

  const api = createServerApi(platform);
  const sessionCookie = locals.session?.id;

  // Parse query params for initial filter state
  const filters = {
    org: url.searchParams.get('org') ?? undefined,
    type: url.searchParams.get('type') as 'video' | 'written' | undefined,
    status: url.searchParams.get('status') as 'not_started' | 'in_progress' | 'completed' | undefined,
    search: url.searchParams.get('q') ?? undefined,
    page: parseInt(url.searchParams.get('page') ?? '1', 10)
  };

  // Fetch library
  const library = await api.fetch<LibraryResponse>(
    'access',
    `/api/access/user/library?${new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v !== undefined) as [string, string][]
    )}`,
    sessionCookie
  );

  // Fetch user's organizations for filter dropdown
  const orgs = await api.fetch<Organization[]>(
    'org',
    '/api/users/me/organizations',
    sessionCookie
  );

  return {
    library,
    orgs,
    filters
  };
};

interface LibraryResponse {
  data: LibraryItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
}

interface LibraryItem {
  id: string;
  contentId: string;
  title: string;
  type: 'video' | 'written';
  thumbnailUrl: string;
  duration: number | null;
  organization: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
  };
  creator: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
  progress: {
    position: number;
    percentage: number;
    completed: boolean;
    lastWatched: string | null;
  };
  purchasedAt: string;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
}
```

### +page.svelte

```svelte
<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { LibraryGrid } from '$lib/components/library/LibraryGrid.svelte';
  import { LibraryFilters } from '$lib/components/library/LibraryFilters.svelte';
  import { LibrarySearch } from '$lib/components/library/LibrarySearch.svelte';
  import { Pagination } from '$lib/components/ui/Pagination/Pagination.svelte';
  import { EmptyState } from '$lib/components/feedback/EmptyState.svelte';
  import * as m from '$paraglide/messages';

  let { data } = $props();
  let { library, orgs, filters } = data;

  async function handleFilterChange(newFilters: typeof filters) {
    const params = new URLSearchParams();
    Object.entries(newFilters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        params.set(key, String(value));
      }
    });
    await goto(`/library?${params}`, { replaceState: true });
  }
</script>

<svelte:head>
  <title>{m.library_title()} | Revelations</title>
</svelte:head>

<main class="library-page">
  <header class="library-header">
    <h1>{m.library_title()}</h1>
    <p class="library-subtitle">
      {m.library_subtitle({ count: library.pagination.totalCount })}
    </p>
  </header>

  <div class="library-toolbar">
    <LibrarySearch
      value={filters.search}
      onchange={(value) => handleFilterChange({ ...filters, search: value, page: 1 })}
    />

    <LibraryFilters
      {orgs}
      {filters}
      onchange={handleFilterChange}
    />
  </div>

  {#if library.data.length === 0}
    <EmptyState
      icon="library"
      title={filters.search || filters.org || filters.status
        ? m.library_no_results()
        : m.library_empty()}
      description={filters.search || filters.org || filters.status
        ? m.library_no_results_hint()
        : m.library_empty_hint()}
      action={filters.search || filters.org || filters.status
        ? { label: m.library_clear_filters(), onclick: () => handleFilterChange({}) }
        : { label: m.library_discover(), href: '/discover' }}
    />
  {:else}
    <LibraryGrid items={library.data} />

    {#if library.pagination.totalPages > 1}
      <Pagination
        currentPage={library.pagination.page}
        totalPages={library.pagination.totalPages}
        onchange={(page) => handleFilterChange({ ...filters, page })}
      />
    {/if}
  {/if}
</main>

<style>
  .library-page {
    max-width: 1200px;
    margin: 0 auto;
    padding: var(--space-6);
  }

  .library-header {
    margin-bottom: var(--space-6);
  }

  .library-header h1 {
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    margin-bottom: var(--space-2);
  }

  .library-subtitle {
    color: var(--color-text-secondary);
  }

  .library-toolbar {
    display: flex;
    gap: var(--space-4);
    margin-bottom: var(--space-6);
    flex-wrap: wrap;
  }

  @media (max-width: 640px) {
    .library-toolbar {
      flex-direction: column;
    }
  }
</style>
```

---

## Filtering & Search

### LibraryFilters.svelte

```svelte
<!-- src/lib/components/library/LibraryFilters.svelte -->
<script lang="ts">
  import Select from '$lib/components/ui/Select/Select.svelte';
  import * as m from '$paraglide/messages';

  interface Props {
    orgs: { id: string; name: string; slug: string }[];
    filters: {
      org?: string;
      type?: 'video' | 'written';
      status?: 'not_started' | 'in_progress' | 'completed';
    };
    onchange: (filters: typeof filters) => void;
  }

  let { orgs, filters, onchange }: Props = $props();

  const typeOptions = [
    { value: '', label: m.filter_all_types() },
    { value: 'video', label: m.filter_type_video() },
    { value: 'written', label: m.filter_type_written() }
  ];

  const statusOptions = [
    { value: '', label: m.filter_all_status() },
    { value: 'not_started', label: m.filter_status_not_started() },
    { value: 'in_progress', label: m.filter_status_in_progress() },
    { value: 'completed', label: m.filter_status_completed() }
  ];

  const orgOptions = [
    { value: '', label: m.filter_all_orgs() },
    ...orgs.map(org => ({ value: org.slug, label: org.name }))
  ];
</script>

<div class="filters">
  <Select
    label={m.filter_organization()}
    options={orgOptions}
    value={filters.org ?? ''}
    onchange={(value) => onchange({ ...filters, org: value || undefined, page: 1 })}
  />

  <Select
    label={m.filter_content_type()}
    options={typeOptions}
    value={filters.type ?? ''}
    onchange={(value) => onchange({ ...filters, type: value || undefined, page: 1 })}
  />

  <Select
    label={m.filter_progress_status()}
    options={statusOptions}
    value={filters.status ?? ''}
    onchange={(value) => onchange({ ...filters, status: value || undefined, page: 1 })}
  />
</div>

<style>
  .filters {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
</style>
```

### LibrarySearch.svelte

```svelte
<!-- src/lib/components/library/LibrarySearch.svelte -->
<script lang="ts">
  import Input from '$lib/components/ui/Input/Input.svelte';
  import * as m from '$paraglide/messages';

  interface Props {
    value?: string;
    onchange: (value: string) => void;
  }

  let { value = '', onchange }: Props = $props();

  let searchValue = $state(value);
  let debounceTimer: ReturnType<typeof setTimeout>;

  function handleInput(e: Event) {
    searchValue = (e.target as HTMLInputElement).value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      onchange(searchValue);
    }, 300);
  }
</script>

<div class="search">
  <Input
    type="search"
    placeholder={m.library_search_placeholder()}
    value={searchValue}
    oninput={handleInput}
    icon="search"
  />
</div>

<style>
  .search {
    flex: 1;
    min-width: 200px;
    max-width: 400px;
  }
</style>
```

---

## Content Cards

### LibraryGrid.svelte

```svelte
<!-- src/lib/components/library/LibraryGrid.svelte -->
<script lang="ts">
  import { LibraryCard } from './LibraryCard.svelte';

  interface Props {
    items: LibraryItem[];
  }

  let { items }: Props = $props();
</script>

<div class="library-grid">
  {#each items as item (item.id)}
    <LibraryCard {item} />
  {/each}
</div>

<style>
  .library-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--space-4);
  }
</style>
```

### LibraryCard.svelte

```svelte
<!-- src/lib/components/library/LibraryCard.svelte -->
<script lang="ts">
  import Badge from '$lib/components/ui/Badge/Badge.svelte';
  import ProgressBar from '$lib/components/ui/ProgressBar/ProgressBar.svelte';
  import * as m from '$paraglide/messages';

  interface Props {
    item: LibraryItem;
  }

  let { item }: Props = $props();

  function getProgressLabel() {
    if (item.progress.completed) return m.progress_completed();
    if (item.progress.percentage > 0) {
      return m.progress_percent({ percent: item.progress.percentage });
    }
    return m.progress_not_started();
  }

  function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    return m.content_duration({ minutes: mins });
  }
</script>

<a
  href="https://{item.organization.slug}.revelations.studio/content/{item.contentId}"
  class="library-card"
>
  <div class="thumbnail">
    <img src={item.thumbnailUrl} alt="" loading="lazy" />

    {#if item.duration}
      <span class="duration">{formatDuration(item.duration)}</span>
    {/if}

    {#if item.progress.percentage > 0 && !item.progress.completed}
      <ProgressBar value={item.progress.percentage} class="card-progress" />
    {/if}

    {#if item.progress.completed}
      <div class="completed-badge">
        <Badge variant="success">{m.progress_completed()}</Badge>
      </div>
    {/if}
  </div>

  <div class="content">
    <div class="org-badge">
      {#if item.organization.logoUrl}
        <img src={item.organization.logoUrl} alt={item.organization.name} />
      {/if}
      <span>{item.organization.name}</span>
    </div>

    <h3 class="title">{item.title}</h3>

    <p class="creator">{item.creator.name}</p>

    {#if item.progress.lastWatched}
      <p class="last-watched">
        {m.library_last_watched({
          date: new Date(item.progress.lastWatched).toLocaleDateString()
        })}
      </p>
    {/if}
  </div>
</a>

<style>
  .library-card {
    display: block;
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    overflow: hidden;
    transition: var(--transition-shadow), var(--transition-transform);
    text-decoration: none;
    color: inherit;
  }

  .library-card:hover {
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }

  .thumbnail {
    position: relative;
    aspect-ratio: 16 / 9;
    background: var(--color-neutral-200);
  }

  .thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .duration {
    position: absolute;
    bottom: var(--space-2);
    right: var(--space-2);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
  }

  .card-progress {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
  }

  .completed-badge {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
  }

  .content {
    padding: var(--space-4);
  }

  .org-badge {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }

  .org-badge img {
    width: 20px;
    height: 20px;
    border-radius: var(--radius-full);
  }

  .org-badge span {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .title {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    margin-bottom: var(--space-1);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .creator {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .last-watched {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin-top: var(--space-2);
  }
</style>
```

---

## "Continue Watching" Section

```svelte
<!-- Optional: src/lib/components/library/ContinueWatching.svelte -->
<script lang="ts">
  import * as m from '$paraglide/messages';

  interface Props {
    items: LibraryItem[];
  }

  let { items }: Props = $props();

  // Get items that are in progress, sorted by last watched
  const inProgress = $derived(
    items
      .filter(item => item.progress.percentage > 0 && !item.progress.completed)
      .sort((a, b) => {
        const aDate = new Date(a.progress.lastWatched ?? 0).getTime();
        const bDate = new Date(b.progress.lastWatched ?? 0).getTime();
        return bDate - aDate;
      })
      .slice(0, 4)
  );
</script>

{#if inProgress.length > 0}
  <section class="continue-section">
    <h2>{m.library_continue_watching()}</h2>
    <div class="continue-grid">
      {#each inProgress as item (item.id)}
        <LibraryCard {item} />
      {/each}
    </div>
  </section>
{/if}
```

---

## i18n Messages

```json
{
  "library_title": "My Library",
  "library_subtitle": "{count} items",
  "library_search_placeholder": "Search your library...",
  "library_continue_watching": "Continue Watching",
  "library_last_watched": "Last watched {date}",
  "library_empty": "Your library is empty",
  "library_empty_hint": "Content you purchase will appear here",
  "library_discover": "Discover Content",
  "library_no_results": "No matching content",
  "library_no_results_hint": "Try adjusting your filters",
  "library_clear_filters": "Clear Filters",

  "filter_organization": "Organization",
  "filter_all_orgs": "All organizations",
  "filter_content_type": "Type",
  "filter_all_types": "All types",
  "filter_type_video": "Video",
  "filter_type_written": "Written",
  "filter_progress_status": "Progress",
  "filter_all_status": "All progress",
  "filter_status_not_started": "Not started",
  "filter_status_in_progress": "In progress",
  "filter_status_completed": "Completed",

  "progress_completed": "Completed",
  "progress_percent": "{percent}% complete",
  "progress_not_started": "Not started"
}
```

---

## Dependencies

### Required

| Dependency | Status | Description |
|------------|--------|-------------|
| P1-FE-FOUNDATION-001 | ✅ | Project setup |
| P1-FE-FOUNDATION-002 | ✅ | UI components |
| Access-API | ✅ | Library endpoint |
| Organization-API | ✅ | User's orgs for filter |

---

## Implementation Checklist

- [ ] **Route Setup**
  - [ ] Create (platform)/library/ route
  - [ ] Implement auth redirect in +page.server.ts
  - [ ] Fetch library data with pagination

- [ ] **Components**
  - [ ] LibraryGrid (responsive grid)
  - [ ] LibraryCard (thumbnail, progress, org badge)
  - [ ] LibraryFilters (org, type, status dropdowns)
  - [ ] LibrarySearch (debounced search)
  - [ ] ContinueWatching (optional section)
  - [ ] Pagination

- [ ] **Filtering**
  - [ ] URL-based filter state
  - [ ] Combined filtering logic
  - [ ] Empty state for no results

- [ ] **i18n**
  - [ ] Add all library message keys
  - [ ] Format dates locally

- [ ] **Testing**
  - [ ] Unit tests for filter logic
  - [ ] Integration tests for pagination
  - [ ] Visual tests for grid/cards

---

## Testing Strategy

### Unit Tests

```typescript
describe('LibraryFilters', () => {
  it('updates URL when filter changes');
  it('maintains other filters when one changes');
  it('resets to page 1 when filters change');
});
```

### Integration Tests

```typescript
describe('Library Page', () => {
  it('redirects unauthenticated users');
  it('shows empty state when no content');
  it('filters by organization');
  it('filters by progress status');
  it('paginates results');
});
```

---

## Notes

### Performance

- Lazy load images with `loading="lazy"`
- Debounce search input (300ms)
- Pre-fetch next page on hover

### UX Considerations

- Show "Continue Watching" section at top
- Preserve scroll position when filtering
- Quick "clear all filters" action

---

**Last Updated**: 2026-01-12
**Template Version**: 1.0
