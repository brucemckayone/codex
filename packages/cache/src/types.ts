/**
 * Cache Package Types
 *
 * Type definitions for the versioned cache implementation.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import type { ObservabilityClient } from '@codex/observability';

/**
 * Options for cache operations
 */
export interface CacheOptions {
  /** Time-to-live for cached data in seconds (default: 600 = 10 minutes) */
  ttl?: number;
  /** Time-to-live for version key in seconds (default: 86400 = 1 day) */
  versionTtl?: number;
}

/**
 * Configuration for creating a VersionedCache instance
 */
export interface VersionedCacheConfig {
  /** KV namespace for storing cache data */
  kv: KVNamespace;
  /** Prefix for all cache keys (default: 'cache') */
  prefix?: string;
  /** Observability client for logging cache operations */
  obs?: ObservabilityClient;
}

/**
 * Cache entry metadata (for internal use)
 */
export interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  version: string;
}

/**
 * Result of a cache get operation
 */
export interface CacheResult<T> {
  /** The cached or fetched data */
  data: T;
  /** Whether the data came from cache (true) or was fetched (false) */
  hit: boolean;
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  /** Total number of get requests */
  gets: number;
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Number of invalidations */
  invalidations: number;
  /** Hit rate (0-1) */
  hitRate: number;
}
