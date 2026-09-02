import type { ObservabilityClient } from '@codex/observability';
import type { VersionedCache } from '../versioned-cache';

/**
 * Emit one cache-stats line for a request's cache instance.
 *
 * ## Why this is a free function and not a method
 *
 * `VersionedCache.getStats()` is deliberately EXPOSURE ONLY — its docstring
 * says a caller that wants the numbers logged must do that itself, at a cadence
 * it chooses, because a cache that logged its own stats would spend request
 * budget on telemetry nobody asked for. That design note is right, and this
 * helper honours it: the cache still logs nothing on its own, and the decision
 * to emit stays with the caller.
 *
 * Keeping it out of the class buys one more thing. A method would have to reach
 * `this.obs`, and `obs` is passed at ZERO of the ~38 `new VersionedCache(...)`
 * sites in this repo — the registry's six included. So an emit routed through
 * `this.obs` would have been silently dead everywhere, which is the same shape
 * as the bug `waitUntil` just fixed: an optional config field almost no call
 * site passes. Taking `obs` as an argument makes it impossible to call this
 * without a logger.
 *
 * ## Why `info` and not `debug`
 *
 * `ObservabilityClient.debug()` returns early unless `environment` is
 * `'development'`, so the `Cache hit` / `Cache miss` lines already in
 * `getWithResult` never reach production logs. An emit at `debug` would produce
 * a green-looking change that measures nothing in the only environment whose
 * numbers are in question.
 *
 * ## This never throws
 *
 * Every call site invokes it inline in the request path, so it swallows its own
 * failures and reports them through `obs` as `cache_stats_failed` instead. A
 * gauge is not worth a 500. Do not remove that guard to "surface problems" —
 * the report IS the surfacing, and the caller has no useful way to handle a
 * telemetry fault mid-request.
 *
 * ## Volume
 *
 * One line per request that actually touched the cache — requests that touched
 * nothing return early rather than logging a row of zeroes. On Workers Paid
 * (20,000,000 log events/month included) this account's ~46.5k monthly
 * invocations put the whole gauge around 0.5% of the allowance.
 *
 * @param cache - The request's cache instance
 * @param obs - Where to emit; required, see above
 * @param context - Extra fields to correlate the line (service, route, orgId)
 *
 * @example At the end of a request, after the response has been returned
 * ```typescript
 * executionCtx.waitUntil(
 *   Promise.resolve().then(() => logCacheStats(cache, obs, { route }))
 * );
 * ```
 */
export function logCacheStats(
  cache: Pick<VersionedCache, 'getStats'>,
  obs: ObservabilityClient,
  context: Record<string, unknown> = {}
): void {
  try {
    const stats = cache.getStats();

    // A request that never touched the cache has nothing to say, and a row of
    // zeroes would still cost a log event and dilute every aggregate computed
    // over these lines.
    if (stats.gets === 0 && stats.writes === 0 && stats.invalidations === 0) {
      return;
    }

    obs.info('cache stats', {
      signal: 'cache_stats',
      ...context,
      ...stats,
    });
  } catch (error) {
    // A BROKEN GAUGE MUST NOT BREAK THE REQUEST IT MEASURES.
    //
    // Every call site invokes this INLINE in the request path, not inside
    // `waitUntil` — `explore/+page.server.ts`, `account/notifications`,
    // `cached-read.ts`, `service-registry.ts`, `journeys.ts` (x2) and
    // `public.ts`. So an unguarded throw here fails a page that was otherwise
    // served correctly, turning telemetry into an outage. That is the same
    // contract `cacheWrite` carries in `org-helpers.ts`: a cache write must
    // never be the thing that turns an authorization lookup into a 500.
    //
    // Reported rather than swallowed, because a silently dead gauge is the
    // exact disease this helper was written to cure — `Codex-m59lj` existed
    // because `VersionedCache.stats` was maintained for months and never
    // emitted. A gauge that fails must say so.
    try {
      obs.error('cache stats emit failed', {
        signal: 'cache_stats_failed',
        ...context,
        error: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // `obs` itself is the failure. There is nothing left to report through,
      // and rethrowing would defeat the whole point of this catch.
    }
  }
}
