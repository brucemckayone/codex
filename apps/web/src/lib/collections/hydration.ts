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
 *
 * Note: 'library' is localStorage-backed (libraryCollection).
 *       'content' is QueryClient-backed.
 */

import {
  type LibraryItem,
  libraryCollection,
  loadLibraryFromServer,
} from './library';
import { queryClient } from './query-client';
import {
  loadSubscriptionFromServer,
  subscriptionCollection,
} from './subscription';

/**
 * Collection keys — kept for content (QueryClient-backed).
 * Library and subscription use localStorage so these keys are content-only
 * in practice (QueryClient cache lookups).
 */
export const COLLECTION_KEYS = {
  content: ['content'] as const,
  library: ['library'] as const,
  subscription: ['subscription'] as const,
} as const;

export type CollectionKey = keyof typeof COLLECTION_KEYS;

/**
 * Hydrate a collection with server-side data
 *
 * For 'library': inserts/upserts into localStorage collection.
 * For 'content': sets QueryClient cache.
 *
 * @param collection - Which collection to hydrate
 * @param data - The array of items from server load
 */
export function hydrateCollection<T>(
  collection: CollectionKey,
  data: T[]
): void {
  if (collection === 'library') {
    if (!libraryCollection) return;
    for (const item of data as LibraryItem[]) {
      const key = item.content.id;
      if (libraryCollection.state.has(key)) {
        libraryCollection.update(key, () => item);
      } else {
        libraryCollection.insert(item);
      }
    }
    return;
  }

  // Query-backed collections (content)
  if (!queryClient) return;
  queryClient.setQueryData(COLLECTION_KEYS[collection], data);
}

/**
 * Check if a collection is already hydrated
 *
 * For 'library': checks localStorage collection state size.
 * For 'content': checks QueryClient cache.
 *
 * @param collection - Which collection to check
 * @returns true if data exists in cache/storage
 */
export function isCollectionHydrated(collection: CollectionKey): boolean {
  if (collection === 'library') {
    return (libraryCollection?.state.size ?? 0) > 0;
  }
  if (!queryClient) return false;
  return queryClient.getQueryData(COLLECTION_KEYS[collection]) !== undefined;
}

/**
 * Hydrate if not already cached
 *
 * Safe to call multiple times - only hydrates on first call.
 * On return visits, localStorage already has library data → no-op.
 *
 * @param collection - Which collection to hydrate
 * @param data - The array of items from server load
 * @returns true if hydration occurred, false if already cached
 */
export function hydrateIfNeeded<T>(
  collection: CollectionKey,
  data: T[]
): boolean {
  if (isCollectionHydrated(collection)) {
    return false;
  }
  hydrateCollection(collection, data);
  return true;
}

/**
 * Invalidate and refetch a collection
 *
 * For 'library': fetches fresh data from server and reconciles localStorage.
 * For 'content': invalidates QueryClient queries.
 *
 * @param collection - Which collection to invalidate
 */
export async function invalidateCollection(
  collection: CollectionKey
): Promise<void> {
  if (collection === 'library') {
    await loadLibraryFromServer();
    return;
  }
  if (collection === 'subscription') {
    // Reconcile every tracked org subscription. The user may be subscribed
    // to multiple orgs; each entry is keyed by organizationId so we fan out.
    if (!subscriptionCollection) return;
    const orgIds = Array.from(subscriptionCollection.state.keys());
    if (orgIds.length === 0) return;
    await Promise.all(orgIds.map((orgId) => loadSubscriptionFromServer(orgId)));
    return;
  }
  if (!queryClient) return;
  const queryKey = COLLECTION_KEYS[collection];
  await queryClient.invalidateQueries({ queryKey });
}
