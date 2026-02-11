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
// QueryClient is defined in ./query-client.ts to avoid circular dependencies.
// Collections import it directly from there; we re-export for external consumers.
export { queryClient } from './query-client';
