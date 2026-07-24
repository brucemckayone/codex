<script lang="ts">
  /**
   * Discover page - filterable content grid with search.
   *
   * Renders directly from SSR data (data.content.items). No client-side
   * collection hydration: the contentCollection is org-scoped and this
   * page is platform-wide (cross-org). Seeding any single-org cache from
   * here is a category error.
   */
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import { deriveContentAccessKind } from '$lib/utils/content-access';
  import ErrorBanner from '$lib/components/ui/Feedback/ErrorBanner.svelte';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import { Pagination } from '$lib/components/ui/Pagination';
  import DiscoverFilters, {
    type DiscoverFilterValues,
  } from '$lib/components/discover/DiscoverFilters.svelte';
  import * as m from '$paraglide/messages';

  const { data }: { data: PageData } = $props();

  function updateFilters(next: DiscoverFilterValues) {
    const params = new URLSearchParams();
    if (next.q.trim()) params.set('q', next.q.trim());
    if (next.type !== 'all') params.set('type', next.type);
    if (next.sort !== 'newest') params.set('sort', next.sort);
    const qs = params.toString();
    goto(`/discover${qs ? `?${qs}` : ''}`, {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  }

  // Pagination baseUrl keeps active filter params, strips `page` —
  // the Pagination component appends `?page=N` (or `&page=N`) per link.
  const paginationBaseUrl = $derived.by(() => {
    const url = new URL(page.url);
    url.searchParams.delete('page');
    return `${url.pathname}${url.search}`;
  });
  const currentPage = $derived(data.content.pagination?.page ?? 1);
  const totalPages = $derived(data.content.pagination?.totalPages ?? 1);
</script>

<svelte:head>
  <title>Discover Content - Codex</title>
  <meta name="description" content="Browse and discover premium content from independent creators on Codex." />
  <meta property="og:title" content="Discover Content - Codex" />
  <meta property="og:description" content="Browse and discover premium content from independent creators." />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="Discover Content - Codex" />
  <meta name="twitter:description" content="Browse and discover premium content from independent creators." />
</svelte:head>

<div class="discover">
  <section class="discover-header">
    <h1>{m.discover_title()}</h1>
    <p class="subtitle">{m.discover_subtitle()}</p>
  </section>

  <DiscoverFilters
    values={data.filters}
    resultCount={data.content.pagination?.total}
    onChange={updateFilters}
  />

  {#if data.error}
    <ErrorBanner title={m.discover_error_title()} description={m.discover_error_description()} />
  {/if}

  <section class="content-grid content-grid--masonry" aria-label="Content results">
    {#if data.content.items && data.content.items.length > 0}
      {#each data.content.items as item (item.id)}
        <ContentCard
          shape="3:4"
          titleInCover
          id={item.id}
          title={item.title}
          thumbnail={item.mediaItem?.thumbnailUrl ?? null}
          contentType={(item.contentType === 'written' ? 'article' : item.contentType) as 'video' | 'audio' | 'article'}
          duration={item.mediaItem?.durationSeconds ?? null}
          creator={item.creator ? {
            username: item.creator.name ?? undefined,
            displayName: item.creator.name ?? undefined,
          } : undefined}
          href={buildContentUrl(page.url, { slug: item.slug, id: item.id, organizationSlug: item.organization?.slug })}
          price={item.priceCents != null ? {
            amount: item.priceCents,
            currency: 'GBP',
          } : null}
          contentAccessType={deriveContentAccessKind(item)}
          featured={item.featured ?? false}
        />
      {/each}
    {:else}
      <EmptyState title={data.search ? m.discover_empty_search({ query: data.search }) : m.discover_empty()} />
    {/if}
  </section>

  {#if totalPages > 1}
    <div class="discover__pagination">
      <Pagination
        {currentPage}
        {totalPages}
        baseUrl={paginationBaseUrl}
      />
    </div>
  {/if}
</div>

<style>
  .discover {
    padding: var(--space-8) 0;
  }

  .discover-header {
    margin-bottom: var(--space-6);
  }

  .discover-header h1 {
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin-bottom: var(--space-2);
  }

  .subtitle {
    font-size: var(--text-base);
    color: var(--color-text-secondary);
  }

  .discover__pagination {
    display: flex;
    justify-content: center;
    padding-top: var(--space-6);
  }
</style>
