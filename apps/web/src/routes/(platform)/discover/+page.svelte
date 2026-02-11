<script lang="ts">
  /**
   * Discover page - filterable content grid with search
   */
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import type { PageData } from './$types';
  import ErrorBanner from '$lib/components/ui/Feedback/ErrorBanner.svelte';

  const { data }: { data: PageData } = $props();

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
</svelte:head>

<div class="discover">
  <section class="discover-header">
    <h1>Discover Content</h1>
    <p class="subtitle">Browse premium content from creators and organizations.</p>
  </section>

  <form class="search-bar" onsubmit={handleSearch}>
    <input
      type="search"
      bind:value={searchValue}
      placeholder="Search content..."
      class="search-input"
      aria-label="Search content"
    />
    <button type="submit" class="search-btn">Search</button>
  </form>

  {#if data.error}
    <ErrorBanner title="Failed to load content" description="Some content could not be loaded. Please try refreshing the page." />
  {/if}

  <section class="content-grid" aria-label="Content results">
    {#if data.content.data && data.content.data.length > 0}
      {#each data.content.data as item (item.id)}
        <a href="/content/{item.id}" class="content-card">
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
              <p class="card-desc">{item.description}</p>
            {/if}
            {#if item.creator?.name}
              <span class="card-creator">{item.creator.name}</span>
            {/if}
          </div>
        </a>
      {/each}
    {:else}
      <div class="empty-state">
        <p>No content found{data.search ? ` for "${data.search}"` : ''}. Check back soon.</p>
      </div>
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
    outline: 2px solid var(--color-primary-500);
    outline-offset: -1px;
  }

  .search-btn {
    padding: var(--space-2) var(--space-4);
    background-color: var(--color-primary-500);
    color: white;
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .search-btn:hover {
    background-color: var(--color-primary-600);
  }

  .content-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-6);
  }

  @media (min-width: 640px) {
    .content-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (min-width: 1024px) {
    .content-grid {
      grid-template-columns: repeat(3, 1fr);
    }
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
    background-color: var(--color-neutral-100);
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
    background-color: var(--color-neutral-200);
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

  .empty-state {
    grid-column: 1 / -1;
    text-align: center;
    padding: var(--space-16) 0;
    color: var(--color-text-secondary);
  }
</style>
