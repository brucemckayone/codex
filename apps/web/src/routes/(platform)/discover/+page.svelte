<script lang="ts">
  /**
   * Discover page - filterable content grid with search
   */
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import { hydrateIfNeeded } from '$lib/collections';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { ContentCard } from '$lib/components/ui/ContentCard';
  import ErrorBanner from '$lib/components/ui/Feedback/ErrorBanner.svelte';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import * as m from '$paraglide/messages';

  const { data }: { data: PageData } = $props();

  onMount(() => {
    if (data.content?.items?.length) {
      hydrateIfNeeded('content', data.content.items);
    }
  });

  let searchValue = $derived(data.search);

  function handleSearch(event: Event) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (searchValue.trim()) {
      params.set('q', searchValue.trim());
    }
    goto(`/discover${params.toString() ? `?${params}` : ''}`, { replaceState: true });
  }
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

  <form class="search-bar" onsubmit={handleSearch}>
    <input
      type="search"
      bind:value={searchValue}
      placeholder={m.explore_search_placeholder()}
      class="search-input"
      aria-label={m.discover_search_aria()}
    />
    <button type="submit" class="search-btn">{m.discover_search_button()}</button>
  </form>

  {#if data.error}
    <ErrorBanner title={m.discover_error_title()} description={m.discover_error_description()} />
  {/if}

  <section class="content-grid" aria-label="Content results">
    {#if data.content.items && data.content.items.length > 0}
      {#each data.content.items as item (item.id)}
        <ContentCard
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
          contentAccessType={item.accessType}
        />
      {/each}
    {:else}
      <EmptyState title={data.search ? m.discover_empty_search({ query: data.search }) : m.discover_empty()} />
    {/if}
  </section>
</div>

<style>
  .discover {
    padding: var(--space-8) 0;
  }

  .discover-header {
    margin-bottom: var(--space-8);
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

  .search-bar {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-8);
  }

  .search-input {
    flex: 1;
    padding: var(--space-2) var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    background-color: var(--color-surface);
    color: var(--color-text);
  }

  .search-input:focus {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: -1px;
  }

  .search-btn {
    padding: var(--space-2) var(--space-4);
    background-color: var(--color-interactive);
    color: var(--color-text-inverse);
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .search-btn:hover {
    background-color: var(--color-interactive-hover);
  }
</style>
