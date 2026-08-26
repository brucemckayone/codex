/**
 * Cache Package Types
 *
 * Type definitions for the versioned cache implementation.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import type { ObservabilityClient } from '@codex/observability';
import type { WaitUntilFn } from './helpers/invalidate';

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
  /**
   * `ExecutionContext.waitUntil` for the in-flight request.
   *
   * WITHOUT this the data-slot write in `get()`/`getWithResult()` is a bare
   * floating promise. The Workers runtime tears the request's IoContext down as
   * soon as the response is returned and cancels any un-awaited work, so on a
   * cache MISS the version key lands (it is awaited) and the data slot does
   * NOT — a permanent 0% hit rate (Codex-e32xz: production CACHE_KV held 62
   * version keys and 0 data keys).
   *
   * Supply it and the put is registered on the execution context: the response
   * still returns without waiting for KV (no added latency), but the runtime
   * keeps the context alive until the write completes.
   *
   * Optional so existing consumers without an ExecutionContext (unit tests,
   * SvelteKit dev, helper call sites that only `invalidate()`) keep working
   * unchanged — they retain the old non-blocking, best-effort behaviour.
   *
   * Pass a wrapped closure, NOT a bare method reference:
   * `(p) => ctx.executionCtx.waitUntil(p)`. An unbound
   * `executionCtx.waitUntil` throws "Illegal invocation" in workerd.
   */
  waitUntil?: WaitUntilFn;
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
