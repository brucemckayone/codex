import {
  type CacheOptions,
  logCacheStats,
  VersionedCache,
  type VersionedCacheConfig,
} from '@codex/cache';
import type { ObservabilityClient } from '@codex/observability';

/**
 * The parts of a `procedure()` context this helper needs.
 *
 * Structural rather than the full `ProcedureContext` so the helper is callable
 * from a webhook handler or a test with a hand-built object, and so it cannot
 * accidentally reach for a service or the DB.
 */
export interface CachedReadContext {
  env: { CACHE_KV?: VersionedCacheConfig['kv'] };
  executionCtx?: { waitUntil: (promise: Promise<unknown>) => void };
  obs?: ObservabilityClient;
}

/**
 * Read through the versioned cache, and emit what it cost.
 *
 * ## Why this exists rather than a construction at each call site
 *
 * Every worker read path used to hand-write the same four things: a `CACHE_KV`
 * truthiness check, a `new VersionedCache({ kv, waitUntil })`, a `get`, and a
 * bare-fetcher fallback for the unbound case. Eight sites, one block, copied.
 *
 * That repetition is not a tidiness complaint — it is the mechanism behind two
 * shipped bugs. `connect-webhook.ts` omitted `waitUntil` from its construction
 * and nothing noticed (`Codex-03uh3`), because a field that most sites happen to
 * pass looks optional; and NO site passed `obs`, so the hit/miss counters
 * `VersionedCache` has always maintained were unreachable everywhere
 * (`Codex-m59lj`). When construction is a habit rather than a function, a site
 * that forgets a field is invisible. Here both are structural: a caller cannot
 * get a cache without `waitUntil` wired, and cannot read without the stats
 * being emitted.
 *
 * ## What it emits
 *
 * One `info` line per call, carrying the aggregate counters plus the per-type
 * split — see `logCacheStats`, which explains why `info` and not `debug`. The
 * cache instance is request-scoped and read once here, so emitting immediately
 * after the read IS end-of-request for it; no deferral hook is needed.
 *
 * ## When CACHE_KV is unbound
 *
 * The fetcher is called directly and nothing is emitted, matching what each
 * call site's hand-written fallback did. There is no cache, so there is no
 * hit-rate to report — logging a zeroed line would put requests that could
 * never hit into the denominator of the ratio.
 *
 * @param ctx - Procedure context (or anything with env/executionCtx/obs)
 * @param id - Entity id the version key is keyed on
 * @param type - Cache type; also the key of the per-type split in the emit
 * @param fetcher - Origin read, called on a miss and when KV is unbound
 * @param options - TTL and friends, passed through untouched
 *
 * @example
 * ```typescript
 * return cachedRead(ctx, slug, CacheType.ORG_CONFIG,
 *   () => fetchPublicOrgInfo(ctx, slug),
 *   { ttl: CACHE_TTL.ORG_PUBLIC_INFO_SECONDS });
 * ```
 */
export async function cachedRead<T>(
  ctx: CachedReadContext,
  id: string,
  type: string,
  fetcher: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  const kv = ctx.env.CACHE_KV;
  if (!kv) return fetcher();

  // Captured before building the cache so the closure cannot observe a later
  // reassignment of ctx.executionCtx, and so the "unbound executionCtx" rule
  // stays visible here rather than inside VersionedCache.
  const executionCtx = ctx.executionCtx;
  const cache = new VersionedCache({
    kv,
    prefix: 'cache',
    waitUntil: executionCtx
      ? (promise: Promise<unknown>) => executionCtx.waitUntil(promise)
      : undefined,
    obs: ctx.obs,
  });

  const { data } = await cache.getWithResult(id, type, fetcher, options);

  if (ctx.obs) logCacheStats(cache, ctx.obs, { cacheType: type });

  return data;
}
