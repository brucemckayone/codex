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
 * 4. useLiveQuery finds cached data — no refetch
 *
 * The `content` target is **org-scoped**: hydration calls must include
 * an orgId so the QueryClient cache key encodes the org. This is the
 * load-bearing invariant that prevents cross-org data leakage on org
 * subdomain pages.
 *
 *   hydrateCollection({ kind: 'content', orgId }, items)   // ✓ org-scoped
 *   hydrateCollection('library', items)                    // ✓ user-scoped (localStorage)
 *   hydrateCollection('subscription', items)               // ✓ org-keyed entries
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
 * Collection key resolvers. `content` is a function of orgId because
 * each org has its own QueryClient cache entry (`['content', orgId]`).
 * Library and subscription remain unscoped here — library is per-user
 * via localStorage, subscription is keyed per-row by organizationId.
 */
export const COLLECTION_KEYS = {
  content: (orgId: string) => ['content', orgId] as const,
  library: ['library'] as const,
  subscription: ['subscription'] as const,
} as const;

/**
 * Discriminated target shape for collection helpers.
 * - `'library'` / `'subscription'` — string literal targets (no extra args)
 * - `{ kind: 'content'; orgId }` — content target requires an orgId
 */
export type CollectionTarget =
  | 'library'
  | 'subscription'
  | { kind: 'content'; orgId: string };

function isContentTarget(
  target: CollectionTarget
): target is { kind: 'content'; orgId: string } {
  return typeof target === 'object' && target.kind === 'content';
}

/**
 * Hydrate a collection with server-side data.
 *
 * For 'library': inserts/upserts into localStorage collection.
 * For content: sets QueryClient cache at `['content', orgId]`.
 */
export function hydrateCollection<T>(
  target: CollectionTarget,
  data: T[]
): void {
  if (target === 'library') {
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

  if (isContentTarget(target)) {
    if (!queryClient) return;
    queryClient.setQueryData(COLLECTION_KEYS.content(target.orgId), data);
    return;
  }

  // 'subscription' has no server-hydration path today (entries are
  // populated lazily via loadSubscriptionFromServer per orgId). Keeping
  // the target accepted so callers can still invalidate it uniformly.
}

/**
 * Check if a collection is already hydrated.
 */
export function isCollectionHydrated(target: CollectionTarget): boolean {
  if (target === 'library') {
    return (libraryCollection?.state.size ?? 0) > 0;
  }
  if (isContentTarget(target)) {
    if (!queryClient) return false;
    return (
      queryClient.getQueryData(COLLECTION_KEYS.content(target.orgId)) !==
      undefined
    );
  }
  return false;
}

/**
 * Hydrate if not already cached.
 *
 * Safe to call multiple times — only hydrates on first call.
 *
 * NOTE: `/explore` deliberately does NOT use this helper anymore. The
 * SSR payload there is the source of truth and must always overwrite
 * the cache (use `hydrateCollection` directly). `hydrateIfNeeded` is
 * still appropriate for localStorage-backed collections (library) where
 * the localStorage entries are the source of truth across sessions.
 */
export function hydrateIfNeeded<T>(
  target: CollectionTarget,
  data: T[]
): boolean {
  if (isCollectionHydrated(target)) {
    return false;
  }
  hydrateCollection(target, data);
  return true;
}

/**
 * Invalidate and refetch a collection.
 *
 * For 'library': fetches fresh data from server and reconciles localStorage.
 * For 'subscription': reconciles every tracked org subscription entry.
 * For content: invalidates the org-scoped QueryClient query.
 */
export async function invalidateCollection(
  target: CollectionTarget
): Promise<void> {
  if (target === 'library') {
    await loadLibraryFromServer();
    return;
  }
  if (target === 'subscription') {
    if (!subscriptionCollection) return;
    const orgIds = Array.from(subscriptionCollection.state.keys());
    if (orgIds.length === 0) return;
    await Promise.all(orgIds.map((orgId) => loadSubscriptionFromServer(orgId)));
    return;
  }
  if (isContentTarget(target)) {
    if (!queryClient) return;
    await queryClient.invalidateQueries({
      queryKey: COLLECTION_KEYS.content(target.orgId),
    });
  }
}
