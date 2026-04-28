<!--
  @component Studio Content List Page

  Editorial content index for Studio creators. Mirrors the vocabulary
  established by ContentForm (sticky command bar, mono ordinals, narrative
  metadata) and the Dashboard (backdrop-blur, brand-tinted accents, restrained
  asymmetry). Replaces the generic `<PageHeader>` + `<Table>` treatment.

  Layout (top to bottom):
    · ContentListCommandBar  — sticky: breadcrumb + count, status segmented
                               filter, search, Create CTA
    · ContentFeatureSlab     — page 1, no search: the most-recent item as
                               a 16:9 hero with narrative strap + actions
    · ContentRow[]           — numbered rows ("02"..) with real thumbnails,
                               type + category + access chips, status pill,
                               publish toggle, edit action
    · Pagination             — when totalPages > 1

  URL state: `search`, `page`, `limit`, `status` — all preserved. Empty
  states split by origin (no content at all vs. no matching content).
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { listContent } from '$lib/remote/content.remote';
  import type { ContentWithRelations } from '$lib/types';
  import Pagination from '$lib/components/ui/Pagination/Pagination.svelte';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import { FileIcon, SearchIcon } from '$lib/components/ui/Icon';
  import ContentListCommandBar from '$lib/components/studio/content-list/ContentListCommandBar.svelte';
  import ContentFeatureSlab from '$lib/components/studio/content-list/ContentFeatureSlab.svelte';
  import ContentRow from '$lib/components/studio/content-list/ContentRow.svelte';
  import ContentListSkeleton from '$lib/components/studio/content-list/ContentListSkeleton.svelte';
  import { togglePublishStatus, type ContentStatus } from '$lib/components/studio/publish-toggle';

  type StatusFilter = 'all' | 'draft' | 'published' | 'archived';

  let { data } = $props();

  const fallbackPagination = { page: 1, limit: 20, total: 0, totalPages: 0 };

  // ── URL-param state (source of truth) ─────────────────────────────────────
  const urlPage = $derived(
    Math.max(1, parseInt(page.url.searchParams.get('page') || '1', 10) || 1)
  );
  const urlLimit = $derived(
    Math.min(
      100,
      Math.max(1, parseInt(page.url.searchParams.get('limit') || '20', 10) || 20)
    )
  );
  const urlSearch = $derived(
    page.url.searchParams.get('search')?.trim() || undefined
  );
  const urlStatus = $derived.by<StatusFilter>(() => {
    const raw = page.url.searchParams.get('status');
    if (raw === 'draft' || raw === 'published' || raw === 'archived') return raw;
    return 'all';
  });

  // Reactive query — re-runs when any URL param changes
  const contentQuery = $derived(
    listContent({
      organizationId: data.org.id,
      page: urlPage,
      limit: urlLimit,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
      ...(urlSearch && { search: urlSearch }),
      ...(urlStatus !== 'all' && { status: urlStatus as 'draft' | 'published' | 'archived' }),
    })
  );

  const items = $derived<ContentWithRelations[]>(contentQuery.current?.items ?? []);
  const pagination = $derived(contentQuery.current?.pagination ?? fallbackPagination);
  const currentPage = $derived(pagination.page);
  const totalPages = $derived(Math.max(1, pagination.totalPages));
  const total = $derived(pagination.total);

  // Show the feature slab only when we're looking at the full, unfiltered
  // first page — otherwise it's misleading to feature a non-first item.
  const showFeature = $derived(
    urlPage === 1 && !urlSearch && urlStatus === 'all' && items.length > 0
  );
  const featureItem = $derived(showFeature ? items[0] : null);
  const stackItems = $derived(showFeature ? items.slice(1) : items);
  const hasAny = $derived(items.length > 0);
  const hasFilter = $derived(!!urlSearch || urlStatus !== 'all');

  // ── Search state + debounce ───────────────────────────────────────────────
  let searchQuery = $state(page.url.searchParams.get('search') ?? '');
  let debounceTimer: ReturnType<typeof setTimeout>;

  // Keep the field in sync when the URL is changed externally (filter click,
  // back/forward, etc.)
  $effect(() => {
    searchQuery = page.url.searchParams.get('search') ?? '';
  });

  function handleSearchInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    searchQuery = value;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => navigateWith({ search: value }), 300);
  }

  function clearSearch() {
    searchQuery = '';
    clearTimeout(debounceTimer);
    navigateWith({ search: '' });
  }

  function setStatus(next: StatusFilter) {
    navigateWith({ status: next });
  }

  function navigateWith(changes: { search?: string; status?: StatusFilter }) {
    const params = new URLSearchParams(page.url.searchParams);

    if ('search' in changes) {
      const s = changes.search?.trim() ?? '';
      if (s) params.set('search', s);
      else params.delete('search');
    }

    if ('status' in changes) {
      const st = changes.status;
      if (!st || st === 'all') params.delete('status');
      else params.set('status', st);
    }

    // Any filter/search change resets pagination to page 1
    params.delete('page');

    const query = params.toString();
    goto(`/studio/content${query ? `?${query}` : ''}`, {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  }

  // ── Publish toggles (per-item optimistic state) ───────────────────────────
  let togglingId = $state<string | null>(null);
  let statusOverrides = $state<Record<string, ContentStatus>>({});

  function applyOverride<T extends ContentWithRelations>(item: T): T {
    const override = statusOverrides[item.id];
    if (!override) return item;
    return { ...item, status: override } as T;
  }

  const featureItemView = $derived(featureItem ? applyOverride(featureItem) : null);
  const stackItemsView = $derived(stackItems.map(applyOverride));

  async function handlePublishToggle(item: ContentWithRelations) {
    togglingId = item.id;
    const currentStatus = (statusOverrides[item.id] ?? item.status) as ContentStatus;
    try {
      const optimistic: ContentStatus =
        currentStatus === 'published' ? 'draft' : 'published';
      statusOverrides[item.id] = optimistic;
      await togglePublishStatus(item.id, currentStatus);
    } catch {
      delete statusOverrides[item.id];
    } finally {
      togglingId = null;
    }
  }

  // Ordinals start at 02 when a feature slab is shown (which consumes 01),
  // otherwise at 01.
  function ordinalFor(index: number): string {
    const base = showFeature ? index + 2 : index + 1;
    return base.toString().padStart(2, '0');
  }
</script>

<svelte:head>
  <title>{m.studio_content_title()} | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="content-page">
  <ContentListCommandBar
    {total}
    loading={contentQuery.loading}
    selectedStatus={urlStatus}
    searchValue={searchQuery}
    createHref="/studio/content/new"
    onSearchInput={handleSearchInput}
    onSearchClear={clearSearch}
    onStatusChange={setStatus}
  />

  <div class="content-body">
    {#if contentQuery.loading}
      <ContentListSkeleton showSlab={!hasFilter} rowCount={5} />
    {:else if hasAny}
      {#if featureItemView}
        <ContentFeatureSlab
          item={featureItemView}
          publishing={togglingId === featureItemView.id}
          onPublishToggle={() => handlePublishToggle(featureItemView)}
        />
      {/if}

      {#if stackItemsView.length > 0}
        <ol class="row-stack" role="list">
          {#each stackItemsView as row, i (row.id)}
            <li class="row-stack-item">
              <ContentRow
                ordinal={ordinalFor(i)}
                item={row}
                publishing={togglingId === row.id}
                onPublishToggle={() => handlePublishToggle(row)}
              />
            </li>
          {/each}
        </ol>
      {/if}

      {#if totalPages > 1}
        <div class="pagination-wrapper">
          <Pagination
            {currentPage}
            {totalPages}
            baseUrl="/studio/content{page.url.search}"
          />
        </div>
      {/if}
    {:else if hasFilter}
      <div class="empty-shell">
        <EmptyState
          title={m.studio_content_search_empty()}
          description={m.studio_content_search_empty_description()}
          icon={SearchIcon}
        >
          {#snippet action()}
            <button type="button" class="empty-cta" onclick={() => { clearSearch(); setStatus('all'); }}>
              {m.studio_content_search_clear_filter()}
            </button>
          {/snippet}
        </EmptyState>
      </div>
    {:else}
      <div class="empty-shell">
        <EmptyState
          title={m.studio_content_empty()}
          description={m.studio_content_empty_description()}
          icon={FileIcon}
        >
          {#snippet action()}
            <a href="/studio/content/new" class="empty-cta empty-cta--solid">
              {m.studio_content_create()}
            </a>
          {/snippet}
        </EmptyState>
      </div>
    {/if}
  </div>
</div>

<style>
  .content-page {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: var(--container-studio);
  }

  .content-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding-top: var(--space-5);
  }

  /* ── Row stack ────────────────────────────────────────────── */
  .row-stack {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .row-stack-item {
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  /* ── Pagination ───────────────────────────────────────────── */
  .pagination-wrapper {
    display: flex;
    justify-content: center;
    padding-top: var(--space-4);
  }

  /* ── Empty state ──────────────────────────────────────────── */
  .empty-shell {
    padding: var(--space-8) var(--space-4);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) dashed var(--color-border);
  }

  .empty-cta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-interactive);
    background: transparent;
    text-decoration: none;
    border: var(--border-width) var(--border-style) transparent;
    border-radius: var(--radius-full, 9999px);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .empty-cta:hover {
    background-color: var(--color-interactive-subtle);
    color: var(--color-interactive-hover);
  }

  .empty-cta:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .empty-cta--solid {
    color: var(--color-text-on-brand, var(--color-background));
    background-color: var(--color-interactive);
  }

  .empty-cta--solid:hover {
    color: var(--color-text-on-brand, var(--color-background));
    background-color: var(--color-interactive-hover);
  }
</style>
