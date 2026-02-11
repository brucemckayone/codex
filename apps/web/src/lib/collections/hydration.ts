/**
 * SSR Hydration Utilities
 *
 * Helpers for hydrating TanStack DB collections with server-side data.
 * This prevents double-fetching when using SSR + client-side reactivity.
 *
 * Flow:
 * 1. Server fetches data in +page.server.ts
 * 2. Data passed to client via SvelteKit load
 * 3. onMount calls hydrateCollection() to populate cache
 * 4. useLiveQuery finds cached data - no refetch!
 */

import { queryClient } from './query-client';

/**
 * Collection keys used for hydration
 *
 * These must match the queryKey used in each collection's queryCollectionOptions.
 */
export const COLLECTION_KEYS = {
  content: ['content'] as const,
  library: ['library'] as const,
} as const;

export type CollectionKey = keyof typeof COLLECTION_KEYS;

/**
 * Hydrate a collection with server-side data
 *
 * Call this in onMount to populate the QueryClient cache
 * with data fetched on the server. This prevents double-fetching.
 *
 * @param collection - Which collection to hydrate
 * @param data - The array of items from server load
 *
 * @example
 * ```svelte
 * <!-- +page.server.ts -->
 * export async function load() {
 *   const library = await getUserLibrary({});
 *   return { library };
 * }
 *
 * <!-- +page.svelte -->
 * <script>
 *   import { onMount } from 'svelte';
 *   import { hydrateCollection, libraryCollection, useLiveQuery } from '$lib/collections';
 *
 *   let { data } = $props();
 *
 *   onMount(() => {
 *     hydrateCollection('library', data.library.items);
 *   });
 *
 *   const library = useLiveQuery((q) =>
 *     q.from({ item: libraryCollection })
 *   );
 * </script>
 * ```
 */
export function hydrateCollection<T>(
  collection: CollectionKey,
  data: T[]
): void {
  if (!queryClient) return;
  const queryKey = COLLECTION_KEYS[collection];
  queryClient.setQueryData(queryKey, data);
}

/**
 * Check if a collection is already hydrated
 *
 * Useful for conditional hydration - only hydrate if not already cached.
 *
 * @param collection - Which collection to check
 * @returns true if data exists in cache
 */
export function isCollectionHydrated(collection: CollectionKey): boolean {
  if (!queryClient) return false;
  const queryKey = COLLECTION_KEYS[collection];
  return queryClient.getQueryData(queryKey) !== undefined;
}

/**
 * Hydrate if not already cached
 *
 * Safe to call multiple times - only hydrates on first call.
 *
 * @param collection - Which collection to hydrate
 * @param data - The array of items from server load
 * @returns true if hydration occurred, false if already cached
 */
export function hydrateIfNeeded<T>(
  collection: CollectionKey,
  data: T[]
): boolean {
  if (!queryClient) return false;
  if (isCollectionHydrated(collection)) {
    return false;
  }
  hydrateCollection(collection, data);
  return true;
}

/**
 * Invalidate and refetch a collection
 *
 * Use after mutations that affect collection data.
 *
 * @param collection - Which collection to invalidate
 */
export async function invalidateCollection(
  collection: CollectionKey
): Promise<void> {
  if (!queryClient) return;
  const queryKey = COLLECTION_KEYS[collection];
  await queryClient.invalidateQueries({ queryKey });
}
