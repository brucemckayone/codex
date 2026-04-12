<script lang="ts">
  /**
   * Library Page (Platform) - Client-Side
   *
   * Fully client-side library page. No +page.server.ts needed:
   * - Auth check via parent layout data
   * - Data from localStorage-backed libraryCollection
   * - All filtering/sorting/search is client-side
   * - Return visits render instantly from localStorage cache
   */

  import { onMount } from 'svelte';
  import { goto, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import {
    libraryCollection,
    loadLibraryFromServer,
    useLiveQuery,
  } from '$lib/collections';
  import type { LibraryItem } from '$lib/collections';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import LibraryPageView from '$lib/components/library/LibraryPageView.svelte';
  import * as m from '$paraglide/messages';

  let { data } = $props();

  // Auth guard — redirect unauthenticated users client-side
  $effect(() => {
    if (!data.user) goto('/login?redirect=/library');
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

  const allItems = $derived((libraryQuery.data ?? []) as LibraryItem[]);

  // On mount: if collection is empty, fetch from server
  onMount(async () => {
    // Show success toast when redirected from subscription checkout
    if (page.url.searchParams.has('subscription') && page.url.searchParams.get('subscription') === 'success') {
      toast.success(
        m.subscription_success_title(),
        m.subscription_success_description()
      );
      // Clean up the query param so it doesn't re-trigger on refresh
      const cleanUrl = new URL(page.url);
      cleanUrl.searchParams.delete('subscription');
      replaceState(cleanUrl, {});
    }

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
  let progressStatus = $state('all');
  let accessType = $state('all');
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

  // Continue watching — in-progress items from the full set
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
  <title>{m.library_title()} - Codex</title>
</svelte:head>

<LibraryPageView
  title={m.library_title()}
  items={paginatedItems}
  {continueWatchingItems}
  error={loadError}
  errorCode={null}
  isLoading={isLoadingFromServer}
  {filters}
  currentSort={sort}
  {currentPage}
  {totalPages}
  emptyTitle={m.library_empty()}
  emptyDescription={m.library_empty_description()}
  browseHref="/discover"
  browseLabel={m.library_browse()}
  onSortChange={handleSortChange}
  onFilterChange={handleFilterChange}
  onClearFilters={handleClearFilters}
  onPageChange={handlePageChange}
  buildItemHref={(item) => buildContentUrl(page.url, item.content)}
/>
