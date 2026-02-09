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

import { QueryClient } from '@tanstack/query-core';

/**
 * Shared QueryClient for all TanStack DB collections
 *
 * This is the central cache for all collection data.
 * Collections use this to coordinate caching and invalidation.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data considered fresh for 5 minutes
      staleTime: 1000 * 60 * 5,

      // Keep inactive data in cache for 30 minutes
      gcTime: 1000 * 60 * 30,

      // Retry failed requests 3 times with exponential backoff
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
  },
});

// Re-export TanStack DB utilities for convenient imports
export {
  and,
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
export { useLiveQuery } from '@tanstack/svelte-db';

// Collection exports
export {
  contentCollection,
  loadContentForOrg,
  loadContentWithFilters,
} from './content';
// SSR Hydration utilities
export {
  COLLECTION_KEYS,
  type CollectionKey,
  hydrateCollection,
  hydrateIfNeeded,
  invalidateCollection,
  isCollectionHydrated,
} from './hydration';
export {
  type LibraryItem,
  type LibraryProgress,
  libraryCollection,
  markAsCompleted,
  resetProgress,
  updateProgress,
} from './library';
export {
  clearAllProgress,
  clearProgress,
  getProgress,
  mergeServerProgress,
  type PlaybackProgress,
  progressCollection,
  syncProgressToServer,
  updateLocalProgress,
} from './progress';
export {
  cleanupProgressSync,
  forceSync,
  initProgressSync,
} from './progress-sync';
