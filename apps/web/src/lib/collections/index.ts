/**
 * TanStack DB Collections
 *
 * This module provides the shared QueryClient and collection exports
 * for reactive data management using TanStack DB.
 *
 * Architecture:
 * - QueryClient: Central cache for all collections
 * - Collections: Local stores synced via Remote Functions
 * - useLiveQuery: Reactive SQL-like queries over collections
 */

// Re-export TanStack DB utilities for convenient imports
export {
  createCollection,
  eq,
  gt,
  gte,
  lt,
  lte,
  not,
  or,
} from '@tanstack/db';
export { queryCollectionOptions } from '@tanstack/query-db-collection';
// Collection exports
export { contentCollection } from './content';
// SSR Hydration utilities
export {
  COLLECTION_KEYS,
  hydrateCollection,
  hydrateIfNeeded,
  invalidateCollection,
  isCollectionHydrated,
} from './hydration';
export {
  type LibraryItem,
  libraryCollection,
  loadLibraryFromServer,
} from './library';
export { progressCollection } from './progress';
// QueryClient is defined in ./query-client.ts to avoid circular dependencies.
// Collections import it directly from there; we re-export for external consumers.
export { queryClient } from './query-client';
export {
  loadSubscriptionFromServer,
  type SubscriptionItem,
  subscriptionCollection,
} from './subscription';
/**
 * SSR-safe useLiveQuery wrapper.
 * Replaces the vanilla @tanstack/svelte-db export to handle SSR gracefully.
 *
 * Overload signatures:
 *  1. `useLiveQuery(queryFn, deps?, ssrOptions?)` — query function with optional deps
 *  2. `useLiveQuery(config, deps?, ssrOptions?)` — config object with optional deps
 *  3. `useLiveQuery(collection, ssrOptions?)` — pre-created collection (has `.state` property)
 *
 * During SSR, returns static data from `ssrOptions.ssrData` (or empty array).
 * On the client, delegates to the real `@tanstack/svelte-db` useLiveQuery.
 */
export { useLiveQuerySSR as useLiveQuery } from './use-live-query-ssr';
