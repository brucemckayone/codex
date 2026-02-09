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

<div class="container mx-auto px-4 py-8">
  <h1 class="text-3xl font-bold mb-8">My Library</h1>

  {#if libraryQuery.isLoading && !data.library?.items?.length}
    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {#each Array(6) as _}
        <div class="animate-pulse">
          <div class="bg-gray-200 dark:bg-gray-700 rounded-lg h-48 mb-2"></div>
          <div class="bg-gray-200 dark:bg-gray-700 rounded h-4 w-3/4 mb-2"></div>
          <div class="bg-gray-200 dark:bg-gray-700 rounded h-3 w-1/2"></div>
        </div>
      {/each}
    </div>
  {:else if libraryQuery.data?.length === 0}
    <div class="text-center py-12">
      <p class="text-gray-500 dark:text-gray-400 mb-4">
        Your library is empty.
      </p>
      <a
        href="/explore"
        class="inline-flex items-center px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
      >
        Browse Content
      </a>
    </div>
  {:else}
    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {#each libraryQuery.data ?? [] as item (item.content.id)}
        <a
          href="/content/{item.content.id}"
          class="group block bg-white dark:bg-gray-800 rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden"
        >
          {#if item.content.thumbnailUrl}
            <div class="aspect-video bg-gray-100 dark:bg-gray-700 relative">
              <img
                src={item.content.thumbnailUrl}
                alt={item.content.title}
                class="w-full h-full object-cover"
              />
              {#if item.progress}
                <div class="absolute bottom-0 left-0 right-0 h-1 bg-gray-300 dark:bg-gray-600">
                  <div
                    class="h-full bg-primary"
                    style="width: {item.progress.percentComplete}%"
                  ></div>
                </div>
              {/if}
            </div>
          {:else}
            <div class="aspect-video bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
              <span class="text-gray-400">No thumbnail</span>
            </div>
          {/if}

          <div class="p-4">
            <h2 class="font-semibold text-lg group-hover:text-primary transition-colors line-clamp-2">
              {item.content.title}
            </h2>

            {#if item.content.description}
              <p class="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                {item.content.description}
              </p>
            {/if}

            {#if item.progress}
              <div class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {#if item.progress.completed}
                  <span class="text-green-600 dark:text-green-400">✓ Completed</span>
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
