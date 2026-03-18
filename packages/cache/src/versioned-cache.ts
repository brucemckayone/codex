/**
 * Versioned Cache Implementation
 *
 * Cache-aside pattern with version-based invalidation.
 * Instead of deleting keys, incrementing a version number invalidates all old data.
 *
 * Benefits:
 * - No need to track all cache keys for an entity
 * - Single atomic operation invalidates all entity data
 * - Works naturally across distributed workers
 * - Old keys expire via TTL automatically
 *
 * @example
 * ```typescript
 * const cache = new VersionedCache({ kv: env.CACHE_KV });
 *
 * // Get with cache-aside (fetcher called on miss)
 * const profile = await cache.get(
 *   userId,
 *   'user:profile',
 *   () => fetchProfileFromDB(userId),
 *   { ttl: 600 }
 * );
 *
 * // Invalidate all user cache on update
 * await cache.invalidate(userId);
 * ```
 */

import type {
  KVNamespace,
  KVNamespacePutOptions,
} from '@cloudflare/workers-types';
import type { ObservabilityClient } from '@codex/observability';
import { buildVersionedCacheKey, buildVersionKey } from './cache-keys';
import type { CacheOptions, CacheResult, VersionedCacheConfig } from './types';

/**
 * Default TTL for cached data (10 minutes)
 */
const DEFAULT_TTL = 600;

/**
 * Default TTL for version keys (1 day)
 */
const DEFAULT_VERSION_TTL = 86400;

/**
 * Versioned Cache Class
 *
 * Implements cache-aside pattern with version-based invalidation.
 * Gracefully degrades on KV failures by falling back to the fetcher.
 */
export class VersionedCache {
  private readonly kv: KVNamespace;
  private readonly prefix: string;
  private readonly obs?: ObservabilityClient;

  // Cache statistics (per-instance, not persisted)
  private stats = {
    gets: 0,
    hits: 0,
    misses: 0,
    invalidations: 0,
  };

  constructor(config: VersionedCacheConfig) {
    this.kv = config.kv;
    this.prefix = config.prefix ?? 'cache';
    this.obs = config.obs;
  }

  /**
   * Get cached data with automatic versioning
   *
   * Uses the cache-aside pattern:
   * 1. Get current version (create if not exists)
   * 2. Try cache with versioned key
   * 3. On miss, call fetcher and cache the result
   * 4. On KV error, fallback to fetcher (graceful degradation)
   *
   * @param id - Entity identifier (userId, orgId, etc.)
   * @param type - Cache type (e.g., 'user:profile', 'org:config')
   * @param fetcher - Function to fetch data on cache miss
   * @param options - TTL options
   * @returns The fetched or cached data
   *
   * @example
   * ```typescript
   * const profile = await cache.get(
   *   'user-123',
   *   'user:profile',
   *   () => db.query.users.findFirst({ where: eq(users.id, 'user-123') }),
   *   { ttl: 600 }
   * );
   * ```
   */
  async get<T>(
    id: string,
    type: string,
    fetcher: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const { ttl = DEFAULT_TTL, versionTtl = DEFAULT_VERSION_TTL } = options;

    this.stats.gets++;

    try {
      // Step 1: Get or create version
      const versionKey = buildVersionKey(id);
      let version = await this.kv.get(versionKey, 'text');

      if (!version) {
        version = String(Date.now());
        await this.kv.put(versionKey, version, {
          expirationTtl: versionTtl,
        });
      }

      // Step 2: Try cache with versioned key
      const cacheKey = buildVersionedCacheKey(this.prefix, type, id, version);
      const cached = await this.kv.get(cacheKey, 'json');

      if (cached !== null) {
        this.stats.hits++;
        this.obs?.debug('Cache hit', { id, type, cacheKey });
        return cached as T;
      }

      // Step 3: Cache miss - fetch and cache
      this.stats.misses++;
      this.obs?.debug('Cache miss', { id, type, cacheKey });

      const data = await fetcher();

      // Fire-and-forget cache set (don't block on cache writes)
      this.kv
        .put(cacheKey, JSON.stringify(data), {
          expirationTtl: ttl,
        } as KVNamespacePutOptions)
        .catch((err) => {
          this.obs?.warn('Cache write failed', {
            id,
            type,
            error: err instanceof Error ? err.message : String(err),
          });
        });

      return data;
    } catch (error) {
      // Graceful degradation: log but don't fail
      this.obs?.error('Cache get failed, falling back to fetcher', {
        id,
        type,
        error: error instanceof Error ? error.message : String(error),
      });
      return fetcher();
    }
  }

  /**
   * Get cached data with hit/miss tracking
   *
   * Same as get() but returns a CacheResult with hit status.
   * Useful for monitoring cache effectiveness.
   *
   * @param id - Entity identifier
   * @param type - Cache type
   * @param fetcher - Function to fetch data on cache miss
   * @param options - TTL options
   * @returns CacheResult with data and hit status
   */
  async getWithResult<T>(
    id: string,
    type: string,
    fetcher: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<CacheResult<T>> {
    const { ttl = DEFAULT_TTL, versionTtl = DEFAULT_VERSION_TTL } = options;

    this.stats.gets++;

    try {
      const versionKey = buildVersionKey(id);
      let version = await this.kv.get(versionKey, 'text');

      if (!version) {
        version = String(Date.now());
        await this.kv.put(versionKey, version, {
          expirationTtl: versionTtl,
        });
      }

      const cacheKey = buildVersionedCacheKey(this.prefix, type, id, version);
      const cached = await this.kv.get(cacheKey, 'json');

      if (cached !== null) {
        this.stats.hits++;
        return { data: cached as T, hit: true };
      }

      this.stats.misses++;
      const data = await fetcher();

      this.kv
        .put(cacheKey, JSON.stringify(data), {
          expirationTtl: ttl,
        } as KVNamespacePutOptions)
        .catch((err) => {
          this.obs?.warn('Cache write failed', {
            id,
            type,
            error: err instanceof Error ? err.message : String(err),
          });
        });

      return { data, hit: false };
    } catch (error) {
      this.obs?.error('Cache get failed, falling back to fetcher', {
        id,
        type,
        error: error instanceof Error ? error.message : String(error),
      });
      const data = await fetcher();
      return { data, hit: false };
    }
  }

  /**
   * Invalidate all cache entries for an entity
   *
   * Single atomic write - all old keys become stale immediately.
   * Old keys will expire via TTL, so no manual cleanup needed.
   *
   * @param id - Entity identifier to invalidate
   *
   * @example
   * ```typescript
   * await cache.invalidate('user-123'); // All user-123 cache is now stale
   * ```
   */
  async invalidate(id: string): Promise<void> {
    const versionKey = buildVersionKey(id);
    const newVersion = String(Date.now());

    try {
      await this.kv.put(versionKey, newVersion, {
        expirationTtl: DEFAULT_VERSION_TTL,
      });

      this.stats.invalidations++;
      this.obs?.info('Cache invalidated', { id, version: newVersion });
    } catch (error) {
      this.obs?.error('Cache invalidation failed', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - invalidation failures are not critical
      // The old data will just serve until TTL expires
    }
  }

  /**
   * Get the current version string for an entity or collection.
   *
   * Used by layout servers to read version strings for SSR passthrough.
   * Works for both entity IDs (userId, orgId) and collection IDs
   * ('content:published', `org:${orgId}:content`).
   *
   * Returns null if the version key doesn't exist yet (no data has been
   * cached for this ID) or if KV lookup fails (graceful degradation).
   *
   * @param id - Entity or collection identifier
   */
  async getVersion(id: string): Promise<string | null> {
    const versionKey = buildVersionKey(id);
    try {
      const version = await this.kv.get(versionKey, 'text');
      this.obs?.debug('getVersion', { id, version: version ?? 'not-found' });
      return version;
    } catch (error) {
      this.obs?.error('getVersion failed', {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Explicitly delete a specific cache entry
   *
   * Note: This is less efficient than invalidate() for most cases.
   * Use invalidate() unless you need to delete a specific type only.
   *
   * @param id - Entity identifier
   * @param type - Cache type to delete
   */
  async delete(id: string, type: string): Promise<void> {
    try {
      const versionKey = buildVersionKey(id);
      const version = (await this.kv.get(versionKey, 'text')) || '0';
      const cacheKey = buildVersionedCacheKey(this.prefix, type, id, version);

      await this.kv.delete(cacheKey);
      this.obs?.debug('Cache entry deleted', { id, type, cacheKey });
    } catch (error) {
      this.obs?.error('Cache delete failed', {
        id,
        type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get current cache statistics
   *
   * Returns per-instance stats since cache creation.
   * Not persisted across restarts.
   *
   * @returns Cache statistics
   */
  getStats() {
    const { gets, hits, misses, invalidations } = this.stats;
    return {
      gets,
      hits,
      misses,
      invalidations,
      hitRate: gets > 0 ? hits / gets : 0,
    };
  }

  /**
   * Reset cache statistics
   *
   * Useful for periodic monitoring or testing.
   */
  resetStats(): void {
    this.stats = {
      gets: 0,
      hits: 0,
      misses: 0,
      invalidations: 0,
    };
  }
}
