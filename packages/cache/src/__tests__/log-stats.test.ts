/**
 * `logCacheStats` — the emit that makes the cache-aside ratio observable.
 *
 * These cases exist because the failure this helper was written to end is a
 * SILENT one. `VersionedCache.stats` has been maintained since the class was
 * written and never emitted, so the hit ratio was computable and unobserved for
 * its entire life; the two mechanisms that kept it invisible were an `obs` that
 * no call site passes and a `debug()` that returns early outside development.
 * A test suite that only checked "does it log" would pass against both of those
 * bugs, so the level and the early-return are asserted explicitly.
 */

import type { ObservabilityClient } from '@codex/observability';
import { createMockObservability } from '@codex/test-utils/mocks';
import { describe, expect, it } from 'vitest';
import { logCacheStats } from '../helpers/log-stats';
import type { CacheStats } from '../types';

/** A stats snapshot shaped like `getStats()` returns, with overrides. */
function statsFixture(overrides: Partial<CacheStats> = {}): CacheStats {
  return {
    gets: 0,
    hits: 0,
    misses: 0,
    invalidations: 0,
    reads: 0,
    writes: 0,
    hitRate: 0,
    byType: {},
    ...overrides,
  };
}

function cacheReporting(stats: CacheStats) {
  return { getStats: () => stats };
}

describe('logCacheStats', () => {
  it('emits at info, so the line survives outside development', () => {
    const { obs } = createMockObservability();
    const cache = cacheReporting(
      statsFixture({ gets: 4, hits: 3, misses: 1, reads: 8, hitRate: 0.75 })
    );

    logCacheStats(cache, obs as unknown as ObservabilityClient);

    // `ObservabilityClient.debug()` returns early unless environment is
    // 'development'. An emit routed through it would measure nothing in the
    // only environment whose numbers are in question, while looking correct in
    // every local test run — so the level is the assertion, not an incidental.
    expect(obs.info).toHaveBeenCalledTimes(1);
    expect(obs.debug).not.toHaveBeenCalled();
  });

  it('carries the ratio, the KV op counts and the per-type split', () => {
    const { obs } = createMockObservability();
    const cache = cacheReporting(
      statsFixture({
        gets: 3,
        hits: 2,
        misses: 1,
        invalidations: 1,
        reads: 6,
        writes: 2,
        hitRate: 2 / 3,
        byType: {
          'org:config': { gets: 2, hits: 2, misses: 0, hitRate: 1 },
          'org:tiers': { gets: 1, hits: 0, misses: 1, hitRate: 0 },
        },
      })
    );

    logCacheStats(cache, obs as unknown as ObservabilityClient);

    expect(obs.info).toHaveBeenCalledWith(
      'cache stats',
      expect.objectContaining({
        signal: 'cache_stats',
        gets: 3,
        hits: 2,
        misses: 1,
        invalidations: 1,
        reads: 6,
        writes: 2,
        hitRate: 2 / 3,
        byType: {
          'org:config': { gets: 2, hits: 2, misses: 0, hitRate: 1 },
          'org:tiers': { gets: 1, hits: 0, misses: 1, hitRate: 0 },
        },
      })
    );
  });

  it('merges caller context so a line can be attributed', () => {
    const { obs } = createMockObservability();
    const cache = cacheReporting(statsFixture({ gets: 1, misses: 1 }));

    logCacheStats(cache, obs as unknown as ObservabilityClient, {
      organizationId: 'org-1',
    });

    expect(obs.info).toHaveBeenCalledWith(
      'cache stats',
      expect.objectContaining({ organizationId: 'org-1', gets: 1 })
    );
  });

  it('stays silent for a request that never touched the cache', () => {
    const { obs } = createMockObservability();

    logCacheStats(
      cacheReporting(statsFixture()),
      obs as unknown as ObservabilityClient
    );

    // A row of zeroes costs a log event and dilutes every ratio computed over
    // these lines — a cache the request never used must not appear in the
    // denominator. The registry builds a cache per service, so most requests
    // hold several instances that were never read.
    expect(obs.info).not.toHaveBeenCalled();
  });

  it('still emits when a request only wrote or only invalidated', () => {
    const { obs } = createMockObservability();

    logCacheStats(
      cacheReporting(statsFixture({ writes: 1 })),
      obs as unknown as ObservabilityClient
    );
    logCacheStats(
      cacheReporting(statsFixture({ invalidations: 1 })),
      obs as unknown as ObservabilityClient
    );

    // A mutation path spends the scarce resource (writes) while producing no
    // `gets`. Gating the emit on `gets` alone would hide exactly the traffic
    // that the write allowance is measured against.
    expect(obs.info).toHaveBeenCalledTimes(2);
  });
});
