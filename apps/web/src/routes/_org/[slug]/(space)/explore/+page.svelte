<!--
  @component OrgExplorePage

  Organization explore page with search, type filtering, category pills, sorting,
  filter chips, content grid, and pagination.

  Type and category filters are client-side (instant, no network request) via
  useLiveQuery + contentCollection. Search and sort remain server-side via URL params.
  Pagination is server-driven.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { deriveContentAccessKind } from '$lib/utils/content-access';
  import { CreatorExploreBanner } from '$lib/components/ui/CreatorCard';
  import { Pagination } from '$lib/components/ui/Pagination';
  import { getContentCollection, hydrateCollection, useLiveQuery } from '$lib/collections';
  import { filterContentItemsByOrg } from '$lib/content/filter-by-org';
  import { followingStore } from '$lib/client/following.svelte';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { SearchXIcon, FileIcon } from '$lib/components/ui/Icon';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import { ViewToggle } from '$lib/components/ui/ViewToggle';
  import { BackToTop } from '$lib/components/ui/BackToTop';
  import { StickyToolbar } from '$lib/components/ui/StickyToolbar';
  import { SearchPill } from '$lib/components/ui/SearchPill';
  import { FilterTriggerButton } from '$lib/components/ui/FilterTriggerButton';
  import {
    ActiveFiltersStrip,
    type ActiveFilterChip,
  } from '$lib/components/ui/ActiveFiltersStrip';
  import { useViewMode } from '$lib/utils/view-mode.svelte';
  import { useAccessContext } from '$lib/utils/access-context.svelte';
  import { StructuredData } from '$lib/components/seo';
  import ExploreFilterDrawer from '$lib/components/explore/ExploreFilterDrawer.svelte';
  import type { PageData } from './$types';


  const { data }: { data: PageData } = $props();

  // Access context — tiers from server, subscription from client store (subscriptionCollection)
  const access = useAccessContext(() => ({
    subscriptionContext: data.subscriptionContext,
    isFollowing: followingStore.get(data.org.id),
    orgId: data.org.id,
  }));

  // Client-side filter state for instant type/category filtering
  // svelte-ignore state_referenced_locally — user-controlled filters, reset explicitly on server data change
  let localType = $state(data.filters.type || '');
  // svelte-ignore state_referenced_locally
  let localCategory = $state(data.filters.category || '');

  // The server load is the source of truth for /explore. Always overwrite
  // the org-scoped ['content', orgId] cache on mount with the SSR payload
  // so cross-org cache contamination cannot mask the org catalogue.
  onMount(() => {
    if (data.content?.items && data.org?.id) {
      hydrateCollection(
        { kind: 'content', orgId: data.org.id },
        data.content.items
      );
    }
  });

  // Re-hydrate when server data changes (search/sort/page navigation).
  // Compare a stable signature, not array identity: on initial mount the
  // array reference and `prevSignature` are both seeded from the same
  // `data.content?.items`, and reference equality would always be true
  // there — but signature equality correctly recognises *content* changes
  // when navigating between filter combinations.
  // Plain variable (not $state) — read as a comparison key, not a reactive
  // dependency. $state() would wrap in a Proxy, breaking the comparison.
  // svelte-ignore state_referenced_locally
  let prevSignature = signatureOf(data.content?.items);
  $effect(() => {
    const currentItems = data.content?.items;
    const currentSignature = signatureOf(currentItems);
    if (currentItems && currentSignature !== prevSignature && data.org?.id) {
      hydrateCollection(
        { kind: 'content', orgId: data.org.id },
        currentItems
      );
      prevSignature = currentSignature;
      localType = data.filters.type || '';
      localCategory = data.filters.category || '';
    }
  });

  function signatureOf(items: readonly unknown[] | undefined): string {
    if (!items || items.length === 0) return '';
    const first = (items[0] as { id?: string } | undefined)?.id ?? '';
    const last = (items[items.length - 1] as { id?: string } | undefined)?.id ?? '';
    return `${items.length}:${first}:${last}`;
  }

  // Org-scoped content collection — keyed ['content', orgId] so visiting
  // another org cannot return this org's cached data and vice versa.
  const orgContentCollection = $derived(
    data.org?.id ? getContentCollection(data.org.id) : undefined
  );

  // Reactive query over the org-scoped collection for client-side filtering.
  // Re-runs when the org changes (cross-subdomain navigation) — deps is an
  // array of getter functions, not a single getter returning an array.
  const contentQuery = useLiveQuery(
    (q) => q.from({ item: orgContentCollection }),
    [() => data.org?.id],
    // svelte-ignore state_referenced_locally — ssrData is only used for initial SSR render
    { ssrData: data.content?.items ?? [] }
  );

  const orgName = $derived(data.org?.name ?? 'Organization');
  // Source-selection rule:
  // The live query reports `data: []` whenever the org-scoped collection
  // hasn't yet observed the latest `setQueryData` — TanStack Query's
  // observer notification is microtask-scheduled, so there is always a
  // window where the sync hydrate has landed but the live query still
  // reads as empty. This window re-opens on every sort/filter goto()
  // because the $effect re-hydrates the cache atomically.
  // Disambiguate by comparing to the SSR payload: if SSR has items but
  // the live query is empty, the collection is mid-hydrate — render SSR.
  // Only trust an empty live query when SSR is also empty (genuinely
  // empty result set).
  // The org-equality filter is defense in depth against cache poisoning
  // (mirrors filterLibraryItemsByOrg, Codex-q3zuf).
  const items = $derived.by(() => {
    const liveItems = contentQuery.data ?? [];
    const ssrItems = data.content?.items ?? [];
    const source = liveItems.length === 0 && ssrItems.length > 0
      ? ssrItems
      : liveItems;
    return filterContentItemsByOrg(source, data.org?.id);
  });
  const total = $derived(data.content?.total ?? 0);
  const filters = $derived(data.filters);
  const limit = $derived(data.limit ?? 12);
  const isAuthenticated = $derived(!!data.user);

  // Category extraction from loaded items (before type filtering, so all categories show)
  const categories = $derived(
    [...new Set(items.map((item: { category?: string | null }) => item.category).filter(Boolean))]
      .sort((a, b) => (a as string).localeCompare(b as string)) as string[]
  );

  // Client-side filtered items — instant type + category filtering
  const displayItems = $derived.by(() => {
    let filtered = items;
    if (localType) {
      filtered = filtered.filter((item: { contentType?: string }) => item.contentType === localType);
    }
    if (localCategory) {
      filtered = filtered.filter((item: { category?: string | null }) => item.category === localCategory);
    }
    return filtered;
  });

  const totalPages = $derived(Math.max(1, Math.ceil(total / limit)));

  // Auth-aware sort options
  const sortOptions = $derived([
    { value: 'newest', label: m.explore_sort_newest() },
    { value: 'oldest', label: m.explore_sort_oldest() },
    { value: 'title', label: m.explore_sort_title() },
    ...(isAuthenticated ? [
      { value: 'popular', label: m.explore_sort_popular() },
      { value: 'top-selling', label: m.explore_sort_top_selling() },
    ] : []),
  ]);

  // Filter chips — type/category use local state; search/sort use URL params.
  // Removal dispatches via `removeChip` keyed by chip.key.
  const activeFilterChips = $derived.by<ActiveFilterChip[]>(() => {
    const chips: ActiveFilterChip[] = [];

    if (filters.q) {
      chips.push({ key: 'q', label: `Search: "${filters.q}"` });
    }
    if (localType) {
      const typeLabel = typeOptions.find((o) => o.value === localType)?.label ?? localType;
      chips.push({ key: 'type', label: `Type: ${typeLabel}` });
    }
    if (localCategory) {
      chips.push({ key: 'category', label: `Category: ${localCategory}` });
    }
    if (filters.sort && filters.sort !== 'newest') {
      const sortLabel = sortOptions.find((o) => o.value === filters.sort)?.label ?? filters.sort;
      chips.push({ key: 'sort', label: `Sort: ${sortLabel}` });
    }
    if (data.creator) {
      chips.push({ key: 'creator', label: `Creator: ${data.creator.name}` });
    }
    if (filters.featured === true) {
      chips.push({ key: 'featured', label: m.explore_filter_featured() });
    }

    return chips;
  });

  function removeChip(chip: ActiveFilterChip) {
    switch (chip.key) {
      case 'q':
        updateFilter('q', null);
        break;
      case 'type':
        localType = '';
        break;
      case 'category':
        localCategory = '';
        break;
      case 'sort':
        updateFilter('sort', null);
        break;
      case 'creator':
        updateFilter('creator', null);
        break;
      case 'featured':
        updateFilter('featured', null);
        break;
    }
  }

  const hasActiveFilters = $derived(
    !!filters.q || !!localType || !!localCategory || (filters.sort !== 'newest') || !!data.creator || filters.featured === true
  );

  function updateFilter(key: string, value: string | null) {
    const url = new URL(page.url);
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
    if (key !== 'page') {
      url.searchParams.delete('page');
    }
    goto(url.toString(), { replaceState: true, noScroll: true });
  }

  function handleSearchSubmit(value: string) {
    const trimmed = value.trim();
    updateFilter('q', trimmed || null);
  }

  function clearFilters() {
    localType = '';
    localCategory = '';
    const url = new URL(page.url);
    url.searchParams.delete('q');
    url.searchParams.delete('type');
    url.searchParams.delete('sort');
    url.searchParams.delete('category');
    url.searchParams.delete('creator');
    url.searchParams.delete('featured');
    url.searchParams.delete('page');
    goto(url.toString(), { replaceState: true });
  }

  const paginationBaseUrl = $derived.by(() => {
    const url = new URL(page.url);
    url.searchParams.delete('page');
    return `${url.pathname}${url.search}`;
  });

  const typeOptions = [
    { value: '', label: m.explore_filter_all() },
    { value: 'video', label: m.explore_filter_video() },
    { value: 'audio', label: m.explore_filter_audio() },
    { value: 'written', label: m.explore_filter_article() },
  ] as const;

  const { viewMode, handleViewChange } = useViewMode();

  // Featured filter — backend publicContentQuerySchema supports `featured: boolean`.
  // Toggle exposes creator-flagged featured items only.
  const featuredActive = $derived(filters.featured === true);
  function toggleFeatured() {
    updateFilter('featured', featuredActive ? null : 'true');
  }

  // ── Filter drawer ─────────────────────────────────────────────────
  // Drawer holds Sort + Type + Featured. Search stays in the toolbar;
  // Category strip stays inline (distinct horizontal discovery surface).
  let drawerOpen = $state(false);
  function setDrawerOpen(next: boolean) {
    if (drawerOpen === next) return; // Melt echo guard
    drawerOpen = next;
  }

  // Drawer callbacks route to the existing write paths:
  //   • type is client-side (localType, instant)
  //   • featured is URL-driven (updateFilter, navigation)
  //   • sort is URL-driven (updateFilter)
  function handleDrawerFilterChange(next: { type: string; featured: boolean }) {
    if (next.type !== localType) localType = next.type;
    if (next.featured !== featuredActive) {
      updateFilter('featured', next.featured ? 'true' : null);
    }
  }
  function handleDrawerSortChange(value: string | undefined) {
    updateFilter('sort', value ?? null);
  }

  // Filter button shows a dot when ANY non-default facet is active.
  // (Search, category, creator are also non-default but they have their
  // own UI; the dot reflects the in-drawer facet state specifically.)
  const drawerActiveCount = $derived(
    (localType ? 1 : 0) +
      (featuredActive ? 1 : 0) +
      (filters.sort !== 'newest' ? 1 : 0)
  );

  // ── SEO ──────────────────────────────────────────────────────────
  // Canonical URL strategy: preserve meaningful filter params (type,
  // category, creator) that represent distinct indexable collections.
  // Drop transient params (q, sort, page) which would otherwise explode
  // into thousands of low-value URL variants and dilute crawl budget.
  const canonicalUrl = $derived.by(() => {
    const url = new URL(page.url);
    url.searchParams.delete('q');
    url.searchParams.delete('sort');
    url.searchParams.delete('page');
    return `${url.origin}${url.pathname}${url.search}`;
  });

  // Robots: noindex search result URLs (?q=…) to avoid crawl traps and
  // internal search appearing in SERPs. Filter/category/creator URLs
  // remain indexable since they link the canonical catalogue shape.
  const noindex = $derived(!!filters.q);

  // Build a human-friendly description that reflects the active filter
  // state. Generic fallback when browsing the full catalogue.
  const pageDescription = $derived.by(() => {
    const parts: string[] = [];
    if (filters.type) parts.push(filters.type);
    if (filters.category) parts.push(filters.category);
    const scope = parts.length > 0 ? parts.join(' + ') : 'all';
    if (data.creator) {
      return `Content by ${data.creator.name} on ${orgName}`;
    }
    return `Browse ${scope} content from ${orgName}.`;
  });

  // CollectionPage JSON-LD — tells search engines this page is a
  // listing of items, helps with sitelinks and rich results.
  const collectionSchema = $derived<Record<string, unknown>>({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${m.explore_title()} | ${orgName}`,
    description: pageDescription,
    url: canonicalUrl,
    isPartOf: {
      '@type': 'WebSite',
      name: orgName,
      url: page.url.origin,
    },
    ...(total > 0 && {
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: total,
      },
    }),
  });
</script>

<svelte:head>
  <title>{m.explore_title()} | {orgName}</title>
  <link rel="canonical" href={canonicalUrl} />
  {#if noindex}
    <meta name="robots" content="noindex, follow" />
  {/if}
  <meta name="description" content={pageDescription} />
  <meta property="og:title" content="{m.explore_title()} | {orgName}" />
  <meta property="og:description" content={pageDescription} />
  <meta property="og:type" content="website" />
  <meta property="og:url" content={canonicalUrl} />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="{m.explore_title()} | {orgName}" />
  <meta name="twitter:description" content={pageDescription} />
</svelte:head>

<StructuredData data={collectionSchema} />

<div class="explore">
  <!--
    Creator feature banner — rendered only when the page is filtered by
    creator (?creator=<username>). Acts as a profile spread for that
    contributor, with the filtered content grid below it serving as
    their catalogue. Avoids a separate /creators/[username] route.
  -->
  {#if data.creator}
    <CreatorExploreBanner
      name={data.creator.name}
      avatarUrl={data.creator.avatarUrl}
      bio={data.creator.bio}
      role={data.creator.role}
      contentCount={data.creator.contentCount}
      socialLinks={data.creator.socialLinks}
      onClear={() => updateFilter('creator', null)}
    />
  {/if}

  <!-- Header -->
  <header class="explore__header">
    <h1 class="explore__title">{m.explore_title()}</h1>
    {#if total > 0}
      <p class="explore__count">
        {#if localType || localCategory}
          {m.explore_showing_filtered({ count: String(displayItems.length), total: String(total) })}
        {:else}
          {m.explore_results_count({ count: String(total) })}
        {/if}
      </p>
    {/if}
  </header>

  <!-- Sticky command bar: search + filter trigger + view toggle. Type,
       Featured, and Sort live inside the drawer. -->
  <StickyToolbar>
    <SearchPill
      value={filters.q ?? ''}
      placeholder={m.explore_search_placeholder()}
      onSubmit={handleSearchSubmit}
    />

    <FilterTriggerButton
      activeCount={drawerActiveCount}
      onClick={() => setDrawerOpen(true)}
      expanded={drawerOpen}
      ariaLabel={`${m.explore_filters_and_sort()}${drawerActiveCount > 0 ? ` (${drawerActiveCount} active)` : ''}`}
      title={m.explore_filters_and_sort()}
    />

    <div class="explore__view-toggle">
      <ViewToggle value={viewMode} onchange={handleViewChange} />
    </div>
  </StickyToolbar>

  <!-- Category Strip -->
  {#if categories.length >= 2}
    <nav class="explore__categories" aria-label="Filter by category">
      <button
        class="explore__category-pill"
        class:explore__category-pill--active={!localCategory}
        onclick={() => { localCategory = ''; }}
        aria-pressed={!localCategory}
      >
        {m.explore_filter_all()}
      </button>
      {#each categories as cat (cat)}
        <button
          class="explore__category-pill"
          class:explore__category-pill--active={localCategory === cat}
          onclick={() => { localCategory = cat; }}
          aria-pressed={localCategory === cat}
        >
          {cat}
        </button>
      {/each}
    </nav>
  {/if}

  <!-- Active Filter Chips -->
  <ActiveFiltersStrip
    chips={activeFilterChips}
    onRemove={removeChip}
    onClearAll={clearFilters}
    clearAllLabel={m.explore_clear_filters()}
    requireMultipleForClear
  />

  <!-- Content Grid -->
  {#if displayItems.length > 0}
    <div class="content-grid explore__grid" data-view={viewMode}>
      {#each displayItems as item (item.id)}
        <ContentCard
          variant={viewMode === 'list' ? 'list' : 'grid'}
          shape={viewMode === 'list' ? undefined : '3:4'}
          titleInCover={viewMode === 'list' ? undefined : true}
          chrome="transparent"
          id={item.id}
          title={item.title}
          thumbnail={item.mediaItem?.thumbnailUrl ?? item.thumbnailUrl ?? null}
          description={item.description}
          contentType={(item.contentType === 'written' ? 'article' : item.contentType) as 'video' | 'audio' | 'article'}
          duration={item.mediaItem?.durationSeconds ?? null}
          creator={item.creator ? {
            username: item.creator.name ?? undefined,
            displayName: item.creator.name ?? undefined,
          } : undefined}
          href={buildContentUrl(page.url, item)}
          price={item.priceCents != null ? {
            amount: item.priceCents,
            currency: 'GBP',
          } : null}
          contentAccessType={deriveContentAccessKind(item)}
          included={access.isIncluded(item)}
          isFollower={access.isFollowing}
          tierName={access.getTierName(item)}
          category={item.category ?? null}
          featured={item.featured ?? false}
        />
      {/each}
    </div>

    {#if totalPages > 1}
      <div class="explore__pagination">
        <Pagination
          currentPage={filters.page}
          {totalPages}
          baseUrl={paginationBaseUrl}
        />
      </div>
    {/if}
  {:else if hasActiveFilters}
    <EmptyState title={m.explore_no_results()} icon={SearchXIcon}>
      {#snippet action()}
        <button class="explore__clear-btn" onclick={clearFilters}>
          {m.explore_clear_filters()}
        </button>
      {/snippet}
    </EmptyState>
  {:else}
    <EmptyState title={m.explore_no_content()} description={m.explore_no_content_description()} icon={FileIcon} />
  {/if}
</div>

<ExploreFilterDrawer
  open={drawerOpen}
  onOpenChange={setDrawerOpen}
  filters={{ type: localType, featured: featuredActive }}
  sort={filters.sort}
  {sortOptions}
  {typeOptions}
  onFilterChange={handleDrawerFilterChange}
  onSortChange={handleDrawerSortChange}
  onClearAll={clearFilters}
/>

<BackToTop />

<style>
  /* ── Layout ── */
  .explore {
    max-width: 1200px;
    width: 100%;
    margin: 0 auto;
    padding: var(--space-8) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  /* ── Header ── */
  .explore__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .explore__title {
    margin: 0;
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    line-height: var(--leading-tight);
  }

  .explore__count {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  /* Push the view toggle to the trailing edge of the sticky bar row. */
  .explore__view-toggle {
    display: inline-flex;
    align-items: center;
    margin-inline-start: auto;
  }

  /* ── Category Strip ── */
  .explore__categories {
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    padding: var(--space-1) 0;
    mask-image: linear-gradient(
      to right,
      transparent 0,
      black var(--space-4),
      black calc(100% - var(--space-4)),
      transparent 100%
    );
  }

  .explore__categories::-webkit-scrollbar {
    display: none;
  }

  /* Ghost pills — transparent by default, subtle border, filled-on-active
     uses surface-elevated rather than interactive so the strip whispers
     and lets the content grid lead. */
  .explore__category-pill {
    flex-shrink: 0;
    padding: var(--space-1-5) var(--space-3);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    background: transparent;
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-full);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background-color var(--duration-fast) var(--ease-default),
      color var(--duration-fast) var(--ease-default),
      border-color var(--duration-fast) var(--ease-default);
  }

  .explore__category-pill:hover {
    color: var(--color-text);
    background: var(--color-surface-secondary);
  }

  .explore__category-pill:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset, 1px);
  }

  .explore__category-pill--active {
    color: var(--color-text);
    background: var(--color-surface-elevated);
    border-color: var(--color-border-strong);
  }

  .explore__category-pill--active:hover {
    background: var(--color-surface-elevated);
  }

  /* List view layout is handled by the ContentCard `variant="list"` treatment
     (horizontal row) — see the viewMode-driven props above. The grid container
     collapses to a single column via the shared `.content-grid[data-view='list']`
     utility, so no page-level card overrides are needed here. */

  /* ── Pagination ── */
  .explore__pagination {
    display: flex;
    justify-content: center;
    padding-top: var(--space-4);
  }

  /* ── Empty States ── */
  .explore__clear-btn {
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    background: transparent;
    border: var(--border-width) var(--border-style) var(--color-interactive);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default),
      color var(--duration-fast) var(--ease-default);
  }

  .explore__clear-btn:hover {
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  /* ── Responsive ── */
  @media (--below-sm) {
    .explore {
      padding: var(--space-6) var(--space-4);
    }

    .explore__title {
      font-size: var(--text-2xl);
    }

    /* Mobile: hide ViewToggle — the drawer is the all-in-one surface,
       grid is the default. */
    .explore__view-toggle {
      display: none;
    }
  }
</style>
