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
  import { extractPlainText } from '@codex/validation';
  import ErrorBanner from '$lib/components/ui/Feedback/ErrorBanner.svelte';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import * as m from '$paraglide/messages';

  const { data }: { data: PageData } = $props();

  onMount(() => {
    if (data.content?.items?.length) {
      hydrateIfNeeded('content', data.content.items);
    }
  });

  let searchValue = $state(data.search);

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
        <a href={buildContentUrl(page.url, { slug: item.slug, id: item.id, organizationSlug: item.organization?.slug })} class="content-card">
          <div class="card-thumb">
            {#if item.mediaItem?.thumbnailUrl}
              <img src={item.mediaItem.thumbnailUrl} alt="" class="thumb-img" />
            {:else}
              <div class="thumb-placeholder"></div>
            {/if}
          </div>
          <div class="card-body">
            <h3 class="card-title">{item.title}</h3>
            {#if item.description}
              <p class="card-desc">{extractPlainText(item.description)}</p>
            {/if}
            {#if item.creator?.name}
              <span class="card-creator">{item.creator.name}</span>
            {/if}
          </div>
        </a>
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

  .content-card {
    display: block;
    border-radius: var(--radius-lg);
    overflow: hidden;
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    text-decoration: none;
    transition: var(--transition-transform);
  }

  .content-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }

  .card-thumb {
    aspect-ratio: 16 / 9;
    background-color: var(--color-surface-secondary);
    overflow: hidden;
  }

  .thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thumb-placeholder {
    width: 100%;
    height: 100%;
    background-color: var(--color-surface-tertiary);
  }

  .card-body {
    padding: var(--space-4);
  }

  .card-title {
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin-bottom: var(--space-1);
    line-height: var(--leading-tight);
  }

  .card-desc {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin-bottom: var(--space-2);
  }

  .card-creator {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }


</style>
