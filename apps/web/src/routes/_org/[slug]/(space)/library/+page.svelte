<!--
  @component OrgLibraryPage

  User's content library scoped to this organization.
  Fully client-side: data from localStorage-backed libraryCollection,
  filtered to this org. No +page.server.ts needed.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    libraryCollection,
    loadLibraryFromServer,
    useLiveQuery,
  } from '$lib/collections';
  import type { LibraryItem } from '$lib/collections';
  import { buildContentUrl, buildPlatformUrl } from '$lib/utils/subdomain';
  import LibraryPageView from '$lib/components/library/LibraryPageView.svelte';
  import * as m from '$paraglide/messages';

  let { data } = $props();

  const orgName = $derived(data.org?.name ?? 'Organization');
  const orgSlug = $derived(data.org?.slug);

  // Build root domain library URL for the "view all" link
  const fullLibraryUrl = $derived(buildPlatformUrl(page.url, '/library'));

  // Auth guard — redirect unauthenticated users client-side
  $effect(() => {
    if (!data.user) goto(`/login?redirect=${encodeURIComponent(page.url.pathname)}`);
  });

  // Track loading state for initial fetch
  let isLoadingFromServer = $state(false);
  let loadError = $state(false);

  // Live query over library collection
  const libraryQuery = useLiveQuery(
    (q) =>
      q
        .from({ item: libraryCollection })
        .orderBy(({ item }) => item.progress?.updatedAt ?? '', 'desc'),
    undefined,
    { ssrData: [] as LibraryItem[] }
  );

  // All items from collection, filtered to this org
  const allItems = $derived(
    ((libraryQuery.data ?? []) as LibraryItem[]).filter(
      (item) => item.content?.organizationSlug === orgSlug
    )
  );

  // On mount: if collection is empty, fetch from server
  onMount(async () => {
    const hasData = (libraryCollection?.state.size ?? 0) > 0;
    if (!hasData) {
      isLoadingFromServer = true;
    }
    try {
      await loadLibraryFromServer();
    } catch {
      if (!hasData) loadError = true;
    } finally {
      isLoadingFromServer = false;
    }
  });

  // --- Client-side filter/sort/pagination state ---
  let sort = $state('recent');
  let contentType = $state('all');
  let accessType = $state('all');
  let progressStatus = $state('all');
  let search = $state('');
  let currentPage = $state(1);
  const ITEMS_PER_PAGE = 12;

  const filters = $derived({
    contentType,
    progressStatus,
    accessType,
    search,
  });

  // Filter
  const filteredItems = $derived.by(() => {
    let items = allItems;
    if (contentType !== 'all') {
      items = items.filter((item) => item.content?.contentType === contentType);
    }
    if (accessType !== 'all') {
      items = items.filter((item) => item.accessType === accessType);
    }
    if (progressStatus !== 'all') {
      if (progressStatus === 'in_progress') {
        items = items.filter(
          (item) =>
            item.progress &&
            !item.progress.completed &&
            item.progress.positionSeconds > 0
        );
      } else if (progressStatus === 'completed') {
        items = items.filter((item) => item.progress?.completed);
      } else if (progressStatus === 'not_started') {
        items = items.filter(
          (item) => !item.progress || item.progress.positionSeconds === 0
        );
      }
    }
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (item) =>
          item.content?.title?.toLowerCase().includes(q) ||
          item.content?.description?.toLowerCase().includes(q)
      );
    }
    return items;
  });

  // Sort
  const sortedItems = $derived.by(() => {
    const items = [...filteredItems];
    switch (sort) {
      case 'recent':
        return items.sort(
          (a, b) =>
            new Date(b.purchase?.purchasedAt ?? 0).getTime() -
            new Date(a.purchase?.purchasedAt ?? 0).getTime()
        );
      case 'oldest':
        return items.sort(
          (a, b) =>
            new Date(a.purchase?.purchasedAt ?? 0).getTime() -
            new Date(b.purchase?.purchasedAt ?? 0).getTime()
        );
      case 'watched':
        return items.sort(
          (a, b) =>
            new Date(b.progress?.updatedAt ?? 0).getTime() -
            new Date(a.progress?.updatedAt ?? 0).getTime()
        );
      case 'az':
        return items.sort((a, b) =>
          (a.content?.title ?? '').localeCompare(b.content?.title ?? '')
        );
      case 'za':
        return items.sort((a, b) =>
          (b.content?.title ?? '').localeCompare(a.content?.title ?? '')
        );
      default:
        return items;
    }
  });

  // Paginate
  const totalPages = $derived(
    Math.max(1, Math.ceil(sortedItems.length / ITEMS_PER_PAGE))
  );
  const paginatedItems = $derived(
    sortedItems.slice(
      (currentPage - 1) * ITEMS_PER_PAGE,
      currentPage * ITEMS_PER_PAGE
    )
  );

  // Continue watching — in-progress items from the org-filtered set
  const continueWatchingItems = $derived(
    allItems.filter(
      (item) =>
        item.progress &&
        !item.progress.completed &&
        item.progress.positionSeconds > 0
    )
  );

  // --- Handlers (update local $state, no goto) ---
  function handleSortChange(value: string | undefined) {
    if (!value) return;
    sort = value;
    currentPage = 1;
  }

  function handleFilterChange(newFilters: {
    contentType: string;
    progressStatus: string;
    accessType?: string;
    search: string;
  }) {
    contentType = newFilters.contentType ?? 'all';
    progressStatus = newFilters.progressStatus ?? 'all';
    accessType = newFilters.accessType ?? 'all';
    search = newFilters.search ?? '';
    currentPage = 1;
  }

  function handleClearFilters() {
    contentType = 'all';
    progressStatus = 'all';
    accessType = 'all';
    search = '';
    currentPage = 1;
  }

  function handlePageChange(newPage: number) {
    currentPage = newPage;
  }
</script>

<svelte:head>
  <title>My {orgName} Library</title>
  <!-- Private authenticated page — never index user's personal library
       state. Follow is fine so the crawler keeps navigating outbound
       links without storing this URL in the search index. -->
  <meta name="robots" content="noindex, follow" />
</svelte:head>

<LibraryPageView
  title="{orgName} Library"
  items={paginatedItems}
  {continueWatchingItems}
  error={loadError}
  errorCode={null}
  errorTitle="Failed to load library"
  errorMessages={{
    unauthorized: 'Your session may have expired. Please sign in again.',
    unavailable: 'The service is temporarily unavailable. Please try again shortly.',
    default: 'Your library could not be loaded. Please try refreshing the page.',
  }}
  isLoading={isLoadingFromServer}
  {filters}
  currentSort={sort}
  {currentPage}
  {totalPages}
  emptyTitle={m.org_library_empty()}
  emptyDescription={m.org_library_empty_description({ orgName })}
  browseHref="/explore"
  browseLabel={m.org_library_browse()}
  onSortChange={handleSortChange}
  onFilterChange={handleFilterChange}
  onClearFilters={handleClearFilters}
  onPageChange={handlePageChange}
  buildItemHref={(item) => buildContentUrl(page.url, item.content)}
>
  {#snippet headerExtra()}
    <a href={fullLibraryUrl} class="full-library-link">
      View full library &rarr;
    </a>
  {/snippet}
</LibraryPageView>

<style>
  .full-library-link {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    text-decoration: none;
    white-space: nowrap;
    transition: var(--transition-colors);
  }

  .full-library-link:hover {
    color: var(--color-interactive-hover);
  }
</style>
