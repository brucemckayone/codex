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
 *
 * There is deliberately only ONE TTL here. A `versionTtl` used to sit alongside
 * `ttl` at 144x its value, and correctness depended on the two staying in the
 * right order while being tuned in different places (Codex-kgrdp.5). Version
 * keys no longer expire at all, so a data TTL can never outlive the version key
 * that stales it — and there is no second number left to drift.
 */
export interface CacheOptions {
  /** Time-to-live for cached data in seconds (default: 600 = 10 minutes) */
  ttl?: number;
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
 * Hit/miss counters for ONE cache type within a {@link CacheStats} snapshot.
 *
 * The aggregate `hitRate` cannot say WHICH cached thing is missing, and that is
 * the only actionable half: an org's branding missing every time is a keying
 * bug, whereas a rarely-read collection missing is simply cold. Splitting by
 * type is what turns the ratio from a number into a diagnosis.
 */
export interface CacheTypeStats {
  /** Lookups for this type. */
  gets: number;
  /** Lookups for this type served from KV. */
  hits: number;
  /** Lookups for this type that fell through to the fetcher. */
  misses: number;
  /** Hit rate (0-1) for this type alone. */
  hitRate: number;
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
  /**
   * KV read operations issued. Workers Paid includes 10,000,000/MONTH per
   * ACCOUNT (the Free plan's figure is 100,000/day, and it fails closed).
   */
  reads: number;
  /**
   * KV mutating operations issued — puts AND deletes, which share one bucket of
   * 1,000,000/MONTH per ACCOUNT on Workers Paid. Still the scarcer of the two
   * by a factor of ten, and therefore the number to watch: a healthy `hitRate`
   * with a climbing `writes` still means the cache is losing.
   *
   * Note this is metered per MONTH and bills past the allowance rather than
   * failing. On the Free plan the same bucket is 1,000/DAY and exhausting it
   * makes writes ERROR, which is a different failure in kind — an outage
   * dressed as a slow app. Do not carry a Free-plan urgency onto a Paid
   * account, or the reverse.
   */
  writes: number;
  /** Hit rate (0-1) */
  hitRate: number;
  /**
   * Per-cache-type breakdown, keyed by the `type` argument passed to
   * {@link VersionedCache.get}. Present so one emitted line answers "which
   * cache is missing", not just "how often".
   */
  byType: Readonly<Record<string, CacheTypeStats>>;
}
