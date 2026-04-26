/**
 * @codex/cache
 *
 * Versioned cache implementation for Cloudflare KV.
 * Cache-aside pattern with version-based invalidation.
 */

// `Logger` and `InvalidationLogger` (alias) are canonically declared in
// `@codex/observability` (R11). Re-exported here so consumers of `@codex/cache`
// keep their import path. `WaitUntilFn` is canonically declared in this package.
export type { InvalidationLogger, Logger } from '@codex/observability';
export {
  buildCacheKey,
  buildVersionedCacheKey,
  buildVersionKey,
  CacheType,
} from './cache-keys';
export type {
  InvalidateUserLibraryArgs,
  WaitUntilFn,
} from './helpers/invalidate';
export { invalidateUserLibrary } from './helpers/invalidate';
export type {
  CacheEntry,
  CacheOptions,
  CacheResult,
  CacheStats,
  VersionedCacheConfig,
} from './types';
export { VersionedCache } from './versioned-cache';
