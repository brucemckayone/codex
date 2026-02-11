<script lang="ts">
  /**
   * Library Page
   *
   * Displays user's content library with SSR hydration.
   *
   * Hydration Flow:
   * 1. +page.server.ts fetches library data on server
   * 2. Page renders with server data (SSR)
   * 3. onMount hydrates QueryClient cache with server data
   * 4. useLiveQuery uses cached data (no refetch)
   * 5. Subsequent navigations use cached/live data
   */

  import { onMount } from 'svelte';
  import {
    hydrateIfNeeded,
    libraryCollection,
    useLiveQuery,
  } from '$lib/collections';
  import ErrorBanner from '$lib/components/ui/Feedback/ErrorBanner.svelte';

  let { data } = $props();

  // Hydrate collection with server data on mount
  onMount(() => {
    if (data.library?.items) {
      hydrateIfNeeded('library', data.library.items);
    }
  });

  // Live query over library collection
  // Initially uses hydrated data, then stays reactive
  const libraryQuery = useLiveQuery((q) =>
    q.from({ item: libraryCollection })
      .orderBy(({ item }) => item.progress?.updatedAt ?? '', 'desc')
  );
</script>

<svelte:head>
  <title>My Library</title>
</svelte:head>

<div class="library">
  <h1 class="library-title">My Library</h1>

  {#if data.error}
    <ErrorBanner title="Failed to load library" description="Your library could not be loaded. Please try refreshing the page." />
  {/if}

  {#if libraryQuery.isLoading && !data.library?.items?.length}
    <div class="content-grid">
      {#each Array(6) as _}
        <div class="skeleton-card">
          <div class="skeleton-thumb"></div>
          <div class="skeleton-line skeleton-line-title"></div>
          <div class="skeleton-line skeleton-line-subtitle"></div>
        </div>
      {/each}
    </div>
  {:else if libraryQuery.data?.length === 0}
    <div class="empty-state">
      <p class="empty-text">
        Your library is empty.
      </p>
      <a href="/discover" class="browse-btn">
        Browse Content
      </a>
    </div>
  {:else}
    <div class="content-grid">
      {#each libraryQuery.data ?? [] as item (item.content.id)}
        <a href="/content/{item.content.id}" class="content-card">
          {#if item.content.thumbnailUrl}
            <div class="card-thumb">
              <img
                src={item.content.thumbnailUrl}
                alt={item.content.title}
                class="thumb-img"
              />
              {#if item.progress}
                <div class="progress-track">
                  <div
                    class="progress-fill"
                    style="width: {item.progress.percentComplete}%"
                  ></div>
                </div>
              {/if}
            </div>
          {:else}
            <div class="card-thumb thumb-placeholder">
              <span class="placeholder-text">No thumbnail</span>
            </div>
          {/if}

          <div class="card-body">
            <h2 class="card-title">
              {item.content.title}
            </h2>

            {#if item.content.description}
              <p class="card-desc">
                {item.content.description}
              </p>
            {/if}

            {#if item.progress}
              <div class="card-progress">
                {#if item.progress.completed}
                  <span class="progress-completed">Completed</span>
                {:else}
                  {item.progress.percentComplete}% watched
                {/if}
              </div>
            {/if}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .library {
    padding: var(--space-8) 0;
  }

  .library-title {
    font-family: var(--font-heading);
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin-bottom: var(--space-8);
  }

  .content-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
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
    background-color: var(--color-surface);
    border-radius: var(--radius-lg);
    overflow: hidden;
    text-decoration: none;
    border: var(--border-width) var(--border-style) var(--color-border);
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
    position: relative;
  }

  .thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thumb-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--color-neutral-200);
  }

  .placeholder-text {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .progress-track {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 4px;
    background-color: var(--color-neutral-300);
  }

  .progress-fill {
    height: 100%;
    background-color: var(--color-primary-500);
  }

  .card-body {
    padding: var(--space-4);
  }

  .card-title {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    line-height: var(--leading-tight);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .content-card:hover .card-title {
    color: var(--color-primary-500);
    transition: var(--transition-colors);
  }

  .card-desc {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
    margin-top: var(--space-1);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .card-progress {
    margin-top: var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .progress-completed {
    color: var(--color-success);
  }

  .skeleton-card {
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  .skeleton-thumb {
    aspect-ratio: 16 / 9;
    background-color: var(--color-neutral-200);
    border-radius: var(--radius-lg);
    margin-bottom: var(--space-2);
  }

  .skeleton-line {
    background-color: var(--color-neutral-200);
    border-radius: var(--radius-sm);
    margin-bottom: var(--space-2);
  }

  .skeleton-line-title {
    height: 1rem;
    width: 75%;
  }

  .skeleton-line-subtitle {
    height: 0.75rem;
    width: 50%;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .empty-state {
    text-align: center;
    padding: var(--space-16) 0;
  }

  .empty-text {
    color: var(--color-text-secondary);
    margin-bottom: var(--space-4);
  }

  .browse-btn {
    display: inline-flex;
    align-items: center;
    padding: var(--space-2) var(--space-4);
    background-color: var(--color-primary-500);
    color: white;
    border-radius: var(--radius-lg);
    text-decoration: none;
    font-weight: var(--font-medium);
    transition: var(--transition-colors);
  }

  .browse-btn:hover {
    background-color: var(--color-primary-600);
  }
</style>
