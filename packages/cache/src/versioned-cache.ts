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
 * ## KV economics — read this before changing an op count
 *
 * The daily KV quota is billed PER CLOUDFLARE ACCOUNT, so every worker in the
 * account (including dev workers) draws on production's allowance. The two
 * buckets are wildly asymmetric:
 *
 * | bucket                      | free tier / day |
 * |-----------------------------|-----------------|
 * | keys read                   | 100,000         |
 * | keys written **+ deleted**  | 1,000           |
 *
 * A read is therefore worth 1/100th of a write. Two consequences drive the
 * shape of this class:
 *
 * 1. **The read path must never spend a write on bookkeeping.** A cache HIT
 *    costs 2 reads (version key, then versioned data key) and ZERO writes. The
 *    2 reads are inherent to entity-level version indirection — the reader
 *    cannot know which data key is current without reading the version first,
 *    and collapsing them would mean giving up one-write-invalidates-everything
 *    (Codex-kgrdp.4). At 2 reads per hit the read bucket supports ~50k hits/day,
 *    which is an order of magnitude more headroom than 1,000 writes gives. Reads
 *    are not the binding constraint; writes are. Do not contort the key layout
 *    chasing the second read.
 * 2. **A cache is most wasteful at LOW traffic**, which is the opposite of the
 *    usual intuition. Under sustained load a data slot is written once and read
 *    many times. At near-zero traffic each entity is read once, the slot expires
 *    unread, and the next read pays for the write all over again — the cache is
 *    pure overhead. Nothing in this class can fix that; it is a property of TTL
 *    caching. What this class MUST avoid is amplifying it, which is what
 *    Codex-kgrdp.5 was: see {@link VersionedCache.invalidate}.
 *
 * @example
 * ```typescript
 * // ALWAYS pass waitUntil on a READ path — without it the data-slot write is
 * // cancelled when the response returns and the cache never gets a hit
 * // (Codex-e32xz).
 * const cache = new VersionedCache({
 *   kv: env.CACHE_KV,
 *   waitUntil: (p) => ctx.executionCtx.waitUntil(p),
 * });
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
import {
  BASE_VERSION,
  buildVersionedCacheKey,
  buildVersionKey,
} from './cache-keys';
import type {
  CacheOptions,
  CacheResult,
  CacheStats,
  VersionedCacheConfig,
} from './types';

/**
 * Default TTL for cached data (10 minutes)
 */
const DEFAULT_TTL = 600;

/**
 * Outcome of the two-read version+data lookup.
 *
 * `cacheKey` is `null` ONLY when KV itself was unreachable. That distinction
 * matters: with no version read there is no way to name the current slot, so a
 * write would land under a key no reader will ever look up — a wasted write out
 * of a 1,000/day budget. A `null` cacheKey means "serve the fetcher, write
 * nothing".
 */
type CacheLookup =
  | { hit: true; value: unknown; cacheKey: string }
  | { hit: false; cacheKey: string | null };

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
  private readonly waitUntil?: VersionedCacheConfig['waitUntil'];

  // Cache statistics (per-instance, not persisted)
  private stats = {
    gets: 0,
    hits: 0,
    misses: 0,
    invalidations: 0,
    reads: 0,
    writes: 0,
  };

  constructor(config: VersionedCacheConfig) {
    this.kv = config.kv;
    this.prefix = config.prefix ?? 'cache';
    this.obs = config.obs;
    this.waitUntil = config.waitUntil;
  }

  /**
   * Write one data slot after a cache miss — NEVER awaited by the caller.
   *
   * Codex-e32xz. The put used to be a bare floating promise. In workerd the
   * request's IoContext is destroyed the moment the response is returned and
   * every un-awaited task is cancelled, so the write never reached KV: a
   * production census of `CACHE_KV_PRODUCTION` found 62 version keys (put with
   * `await`, three lines earlier in the same function) and ZERO data keys. The
   * cache therefore had a literal 0% hit rate and every request paid the full
   * DB cost while still paying for the KV reads.
   *
   * The fix is `waitUntil`, not `await`: awaiting inline would add KV write
   * latency to every miss response, which is precisely what the fire-and-forget
   * was there to avoid. `waitUntil` keeps the response fast AND keeps the
   * context alive until the put settles.
   *
   * When no `waitUntil` was supplied the promise is left floating exactly as
   * before — best-effort, non-blocking, and never throwing. That keeps every
   * existing consumer (unit tests, SvelteKit dev without a real
   * ExecutionContext, helper call sites) working unchanged.
   */
  private writeCacheSlot(
    cacheKey: string,
    data: unknown,
    ttl: number,
    id: string,
    type: string
  ): void {
    this.stats.writes++;
    const write = this.kv
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

    if (!this.waitUntil) return;

    // A caller-supplied waitUntil is foreign code. If it throws (a stale
    // ExecutionContext, a Hono context with no executionCtx) the miss must
    // still return its freshly fetched data — never re-enter the fetcher and
    // never surface a cache-plumbing failure to the request.
    try {
      this.waitUntil(write);
    } catch (err) {
      this.obs?.warn('Cache write could not be scheduled on waitUntil', {
        id,
        type,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Start the version-key put and park it on `waitUntil` — the write survives a
   * caller who never awaits the returned promise.
   *
   * Codex-mhoaz. Production services fire `void this.cache?.invalidate(...)`
   * after a successful DB mutation — eleven such call sites across
   * `@codex/content` and `@codex/admin` when this landed, and the count only
   * grows — deliberately: an invalidation must not add KV latency to a publish
   * response. But `void` in workerd does not mean "later", it means CANCELLED —
   * the request's IoContext is destroyed the moment the response is returned, so
   * a publish could commit to Postgres and never stale the cache, and the stale
   * listing then served until its TTL expired. This is the same defect class as
   * Codex-e32xz on the read path ({@link writeCacheSlot}), on the write path.
   *
   * The fix belongs HERE rather than at each call site: every one would
   * otherwise need its own `executionCtx` in scope inside a service, and the
   * next call site added would silently reintroduce the bug. Registering the put
   * on the instance's own `waitUntil` is what makes the callers' existing `void`
   * safe, with no change on their side.
   *
   * When no `waitUntil` was supplied nothing is registered and behaviour is
   * exactly as before — the returned promise still carries the put, which is all
   * an awaiting caller (or `invalidateUserLibrary`, which parks the whole
   * `invalidate()` call itself) ever needed.
   *
   * The put is STARTED here rather than passed in, for the same reason
   * {@link writeCacheSlot} starts its own: ownership of a KV write is only
   * checkable when the `put` and the `waitUntil` holding it sit in one place.
   * Hand a put in from elsewhere and rule 4 of
   * `scripts/checks/check-data-access-contract.mjs` correctly reports a floating
   * write, because at the `put` site nothing visibly holds it.
   */
  private startVersionWrite(
    versionKey: string,
    newVersion: string,
    id: string
  ): Promise<unknown> {
    const write = this.kv.put(versionKey, newVersion);
    if (!this.waitUntil) return write;

    try {
      // The task handed to the runtime MUST swallow: `invalidate()`'s own catch
      // logs the failure, and a rejecting waitUntil task is an unhandled
      // rejection in workerd. The returned `write` is a separate reference, so
      // the caller-visible error path is unaffected.
      this.waitUntil(write.catch(() => {}));
    } catch (err) {
      // A caller-supplied waitUntil is foreign code (a stale ExecutionContext,
      // a Hono context with no executionCtx). It must never turn a successful
      // mutation's invalidation into a thrown error.
      this.obs?.warn('Cache invalidation could not be scheduled on waitUntil', {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return write;
  }

  /**
   * Resolve the current version for an entity — READ ONLY, never writes.
   *
   * Returns {@link BASE_VERSION} when no version key exists, which is the
   * normal state for an entity that has never been invalidated. See
   * {@link invalidate} for why the read path must not mint one.
   */
  private async readVersion(id: string): Promise<string> {
    this.stats.reads++;
    const version = await this.kv.get(buildVersionKey(id), 'text');
    return version ?? BASE_VERSION;
  }

  /**
   * The two KV reads that back every `get()` — version key, then data key.
   *
   * Never throws: a KV failure resolves to a miss with a `null` cacheKey so the
   * caller serves the fetcher and skips the write.
   */
  private async lookup(id: string, type: string): Promise<CacheLookup> {
    try {
      const version = await this.readVersion(id);
      const cacheKey = buildVersionedCacheKey(this.prefix, type, id, version);

      this.stats.reads++;
      const cached = await this.kv.get(cacheKey, 'json');

      return cached === null
        ? { hit: false, cacheKey }
        : { hit: true, value: cached, cacheKey };
    } catch (error) {
      // Loud, and accurate about who failed: this branch is reached ONLY when a
      // KV operation threw. A fetcher failure is deliberately not caught here
      // — see getWithResult.
      this.obs?.error('Cache lookup failed, serving from the fetcher', {
        id,
        type,
        error: error instanceof Error ? error.message : String(error),
      });
      return { hit: false, cacheKey: null };
    }
  }

  /**
   * Get cached data with automatic versioning
   *
   * Uses the cache-aside pattern:
   * 1. Read the current version (BASE_VERSION when none exists — no write)
   * 2. Try cache with the versioned key
   * 3. On miss, call fetcher and cache the result
   * 4. On KV error, fall back to the fetcher (graceful degradation)
   *
   * Cost: 2 reads on a hit; 2 reads + 1 write on a miss; 2 reads and NO write
   * when the fetcher throws.
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
    const { data } = await this.getWithResult(id, type, fetcher, options);
    return data;
  }

  /**
   * Get cached data with hit/miss tracking
   *
   * Same as get() but returns a CacheResult with hit status.
   * Useful for monitoring cache effectiveness.
   *
   * This is the single implementation of the read path; `get()` delegates to
   * it. The two used to carry byte-identical copies of the same body, which is
   * how Codex-e32xz managed to exist twice and be fixed once.
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
    const { ttl = DEFAULT_TTL } = options;

    this.stats.gets++;

    const lookup = await this.lookup(id, type);

    if (lookup.hit) {
      this.stats.hits++;
      this.obs?.debug('Cache hit', { id, type, cacheKey: lookup.cacheKey });
      return { data: lookup.value as T, hit: true };
    }

    this.stats.misses++;
    this.obs?.debug('Cache miss', { id, type, cacheKey: lookup.cacheKey });

    // The fetcher runs OUTSIDE any catch, deliberately.
    //
    // This used to sit inside a try whose catch re-invoked the fetcher, so a
    // fetcher failure cost TWO round trips to the origin and logged "Cache get
    // failed" — blaming KV for a DB or service error. Both halves matter under
    // the bot traffic that opened this epic: `organizations.ts` uses the URL
    // slug as the cache `id`, so an enumeration scan of bogus slugs doubled the
    // DB queries AND buried the real NotFoundError signal. A fetcher error is
    // the caller's to handle; it propagates untouched so `procedure()` still
    // maps the typed ServiceError.
    const data = await fetcher();

    // `null` means the version read failed, so there is no key worth writing.
    if (lookup.cacheKey !== null) {
      this.writeCacheSlot(lookup.cacheKey, data, ttl, id, type);
    }

    return { data, hit: false };
  }

  /**
   * Write-through: put a known-fresh value straight into the current slot.
   *
   * For the "I just mutated this row and I already hold the new value" case.
   * Costs 1 read + 1 write, versus 2 writes + 2 reads for the
   * invalidate-then-re-read pattern it replaces (Codex-kgrdp.8) — which spent
   * its second write re-fetching from the DB a value the caller was already
   * holding.
   *
   * Deliberately does NOT bump the version. A write-through only claims to
   * refresh the ONE type it was handed; bumping would also stale every other
   * type sharing this `id`, forcing each of them to spend a write of its own on
   * its next read. When a mutation really does invalidate sibling types, call
   * {@link invalidate} instead — or call it as well, and accept the cost
   * knowingly.
   *
   * Awaits the put, so a caller's single `waitUntil(cache.set(...))` genuinely
   * covers the write. Never throws: a failed write costs at most `ttl` seconds
   * of staleness and must not fail the mutation that already succeeded.
   *
   * @param id - Entity identifier
   * @param type - Cache type to refresh
   * @param data - The value to store
   * @param options - TTL options
   */
  async set<T>(
    id: string,
    type: string,
    data: T,
    options: CacheOptions = {}
  ): Promise<void> {
    const { ttl = DEFAULT_TTL } = options;

    try {
      const version = await this.readVersion(id);
      const cacheKey = buildVersionedCacheKey(this.prefix, type, id, version);

      this.stats.writes++;
      await this.kv.put(cacheKey, JSON.stringify(data), {
        expirationTtl: ttl,
      } as KVNamespacePutOptions);

      this.obs?.debug('Cache slot written', { id, type, cacheKey });
    } catch (error) {
      this.obs?.warn('Cache set failed', {
        id,
        type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Invalidate all cache entries for an entity
   *
   * Single atomic write - all old keys become stale immediately.
   * Old keys will expire via TTL, so no manual cleanup needed.
   *
   * ## Version keys do not expire (Codex-kgrdp.5)
   *
   * This is the ONLY method that writes a version key, and it writes one with
   * no `expirationTtl`. Both halves of that are load-bearing.
   *
   * The class used to carry two independent TTLs — `DEFAULT_TTL` at 600s and a
   * `DEFAULT_VERSION_TTL` at 86400s, 144x larger — and the read path minted a
   * version key whenever it found none. That produced three separate faults:
   *
   * - **A write on the read path.** `get()` awaited a version-key put on every
   *   first read of an entity. Since `id` is sometimes caller-controlled (the
   *   org slug in `organizations.ts`), a bot enumerating slugs could burn the
   *   entire 1,000-write/day ACCOUNT budget in 1,000 requests — a remote quota
   *   DoS against production, from the read path, for entities that do not
   *   exist.
   * - **Spurious client invalidation.** A minted version is `Date.now()`. When
   *   the 86400s version key expired and the next read minted a fresh
   *   timestamp, `getVersion()` reported a changed version with no underlying
   *   data change, and every client tracking it refetched.
   * - **A drift-dependent staleness bug.** If a data TTL ever exceeded the
   *   version TTL, the version key could expire while data keys written before
   *   the last bump were still alive — and reads would fall back to a version
   *   that resurrected them. Correctness depended on two numbers, tuned in
   *   different places, staying in the right order.
   *
   * The fix is structural rather than a retune: there is now exactly ONE TTL in
   * this class. A version key is created only by an actual mutation and then
   * outlives every data key it stales, forever and by construction, so the two
   * cannot drift apart — there is no second number to drift. Reads resolve a
   * missing version key to {@link BASE_VERSION} instead of writing one, so the
   * read path spends zero writes and the enumeration vector closes.
   *
   * The cost is one permanent ~100-byte key per entity that has ever been
   * mutated, against a 1GB storage allowance. Storage is the abundant resource
   * here; writes are not.
   *
   * ## `void invalidate(id)` is safe when a waitUntil was supplied (Codex-mhoaz)
   *
   * The put is registered on the instance's `waitUntil` BEFORE it is awaited, so
   * the runtime holds the isolate open until it settles even when nobody awaits
   * the returned promise — see {@link startVersionWrite}.
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
      this.stats.writes++;
      // Starts the put and hands it to the runtime BEFORE this await. That
      // ordering is the whole fix: a caller doing `void invalidate(id)` never
      // awaits this promise, so without the registration the put is the
      // isolate's only claim on itself and teardown cancels it (Codex-mhoaz).
      await this.startVersionWrite(versionKey, newVersion, id);

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
   * Returns null if the version key doesn't exist yet (the entity has never
   * been invalidated) or if KV lookup fails (graceful degradation). Callers
   * treat the value as an opaque token, so a stable `null` is a stable
   * "unchanged" — which is the point: this no longer flips to a fresh timestamp
   * just because a version key expired.
   *
   * @param id - Entity or collection identifier
   */
  async getVersion(id: string): Promise<string | null> {
    const versionKey = buildVersionKey(id);
    try {
      this.stats.reads++;
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
   * Note: This is less efficient than invalidate() for most cases, and a KV
   * delete draws on the same 1,000/day bucket as a write.
   * Use invalidate() unless you need to delete a specific type only.
   *
   * @param id - Entity identifier
   * @param type - Cache type to delete
   */
  async delete(id: string, type: string): Promise<void> {
    try {
      const version = await this.readVersion(id);
      const cacheKey = buildVersionedCacheKey(this.prefix, type, id, version);

      this.stats.writes++;
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
   * `reads` and `writes` count actual KV operations, so they are the numbers to
   * reason about against the daily quota — `hitRate` alone cannot tell you
   * whether the cache is paying for itself. `writes` counts puts AND deletes
   * because both draw on the same 1,000/day bucket.
   *
   * Codex-kgrdp.1 (item 4) hardened the surface rather than creating it: the
   * method was already here, but its return type was inferred from an ad-hoc
   * object literal, so the exported {@link CacheStats} contract and what callers
   * actually received could drift apart silently. It is now declared against
   * that type, and the snapshot is FROZEN: a shallow copy taken at call time,
   * detached from `this.stats`, so it neither drifts as later operations run nor
   * lets a caller write back into the instance's counters through the object it
   * was handed.
   *
   * EXPOSURE ONLY, and cache-only. A caller that wants these numbers logged or
   * shipped must do that itself, deliberately, at a cadence it chooses — a cache
   * that logged its own stats would spend request budget on telemetry nobody
   * asked for. These counters also cover THIS instance and nothing else: the
   * account-wide KV budget picture belongs to `@codex/observability`
   * (`instrumentKvBindings` / `kvBudgetSnapshot`), which counts at the binding
   * level across every KV consumer rather than per cache instance.
   *
   * @returns Cache statistics — a frozen snapshot, safe to hold and to hand on
   */
  getStats(): Readonly<CacheStats> {
    const { gets, hits, misses, invalidations, reads, writes } = this.stats;
    return Object.freeze({
      gets,
      hits,
      misses,
      invalidations,
      reads,
      writes,
      hitRate: gets > 0 ? hits / gets : 0,
    });
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
      reads: 0,
      writes: 0,
    };
  }
}
