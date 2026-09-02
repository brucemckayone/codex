/**
 * `cachedRead` — the read path that cannot forget `waitUntil` or the emit.
 *
 * Both of the bugs this helper exists to prevent were bugs of OMISSION at a
 * construction site, and both survived review because the field they omitted
 * was optional and most sites happened to pass it:
 *
 *  - `Codex-e32xz` / `Codex-03uh3` — a construction without `waitUntil` leaves
 *    the data-slot put un-awaited, so workerd cancels it when the response
 *    returns and the cache can NEVER hit. Production held 62 version keys and
 *    zero data keys.
 *  - `Codex-m59lj` — no site passed `obs`, so the hit/miss counters were
 *    unreachable and the ratio was unobservable.
 *
 * So the assertions here are about what the helper GUARANTEES, not about what
 * it happens to do: a data-slot write is always parked on `waitUntil`, and a
 * read always emits. A test that only checked the returned value would pass
 * against both bugs.
 */

import { CacheType } from '@codex/cache';
import type { ObservabilityClient } from '@codex/observability';
import { describe, expect, it, vi } from 'vitest';
import { type CachedReadContext, cachedRead } from '../cached-read';

type LogFn = (message: string, metadata?: Record<string, unknown>) => void;

/**
 * Local stub rather than `@codex/test-utils` — worker-utils does not depend on
 * that package, and a test double is not worth a new package dependency.
 */
function fakeObs() {
  return {
    debug: vi.fn<LogFn>(),
    info: vi.fn<LogFn>(),
    warn: vi.fn<LogFn>(),
    error: vi.fn<LogFn>(),
  };
}

/** In-memory KV double recording every operation it is asked to perform. */
function fakeKv(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [] })),
  };
}

function ctxWith(
  kv: ReturnType<typeof fakeKv> | undefined,
  obs?: ObservabilityClient
) {
  const parked: Promise<unknown>[] = [];
  const ctx = {
    env: { CACHE_KV: kv as unknown as CachedReadContext['env']['CACHE_KV'] },
    executionCtx: {
      waitUntil: (promise: Promise<unknown>) => {
        parked.push(promise);
      },
    },
    obs,
  } satisfies CachedReadContext;
  return { ctx, parked, drain: () => Promise.all(parked) };
}

/** Metadata of the first info call that carries a `signal`. */
function signalOf(obs: ReturnType<typeof fakeObs>) {
  const call = obs.info.mock.calls.find((c) => c[1]?.signal !== undefined);
  return call?.[1] as Record<string, unknown> | undefined;
}

describe('cachedRead', () => {
  it('parks the data-slot write on waitUntil, so a miss can become a hit', async () => {
    const kv = fakeKv();
    const { ctx, parked, drain } = ctxWith(kv);

    const value = await cachedRead(ctx, 'org-1', CacheType.ORG_CONFIG, () =>
      Promise.resolve({ name: 'Acme' })
    );
    expect(value).toEqual({ name: 'Acme' });

    // The put must be REGISTERED, not merely issued: an un-awaited promise is
    // cancelled at response time, which is the whole of Codex-e32xz. If this
    // is 0, the cache is structurally incapable of a hit.
    expect(parked.length).toBeGreaterThan(0);
    await drain();

    const dataKeys = [...kv.store.keys()].filter(
      (k) => !k.startsWith('cache:version:')
    );
    expect(dataKeys.length).toBeGreaterThan(0);
  });

  it('emits one info line per read, carrying the type it read', async () => {
    const kv = fakeKv();
    const obs = fakeObs();
    const { ctx, drain } = ctxWith(kv, obs as unknown as ObservabilityClient);

    await cachedRead(ctx, 'org-1', CacheType.ORG_CONFIG, () =>
      Promise.resolve({ name: 'Acme' })
    );
    await drain();

    expect(signalOf(obs)).toMatchObject({
      signal: 'cache_stats',
      cacheType: CacheType.ORG_CONFIG,
      gets: 1,
      misses: 1,
      hits: 0,
    });
    // The STATS line must be `info`, never `debug`.
    //
    // VersionedCache's own 'Cache hit'/'Cache miss' debug lines DO land on this
    // stub, and that is the point: the environment gate lives inside the real
    // `ObservabilityClient.debug()`, not at the call site, so a stub cannot see
    // it and a test asserting "debug was never called" would be asserting the
    // wrong thing. What matters is that the cache_stats signal is not routed
    // through the one level production discards.
    expect(
      obs.debug.mock.calls.some((c) => c[1]?.signal === 'cache_stats')
    ).toBe(false);
  });

  it('reports the hit on a second read of the same key', async () => {
    const kv = fakeKv();
    const obs = fakeObs();
    const fetcher = vi.fn(() => Promise.resolve({ name: 'Acme' }));

    const first = ctxWith(kv, obs as unknown as ObservabilityClient);
    await cachedRead(first.ctx, 'org-1', CacheType.ORG_CONFIG, fetcher);
    await first.drain();

    // A fresh context, because `env` is rebuilt per request — the cache
    // instance and therefore its counters do NOT survive, which is why the
    // emit has to happen per request rather than being accumulated.
    obs.info.mockClear();
    const second = ctxWith(kv, obs as unknown as ObservabilityClient);
    await cachedRead(second.ctx, 'org-1', CacheType.ORG_CONFIG, fetcher);
    await second.drain();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(signalOf(obs)).toMatchObject({
      gets: 1,
      hits: 1,
      misses: 0,
      hitRate: 1,
    });
  });

  it('falls through to the fetcher and emits nothing when CACHE_KV is unbound', async () => {
    const obs = fakeObs();
    const { ctx } = ctxWith(undefined, obs as unknown as ObservabilityClient);
    const fetcher = vi.fn(() => Promise.resolve({ name: 'Acme' }));

    await expect(
      cachedRead(ctx, 'org-1', CacheType.ORG_CONFIG, fetcher)
    ).resolves.toEqual({ name: 'Acme' });

    expect(fetcher).toHaveBeenCalledTimes(1);
    // Requests that COULD not hit must stay out of the ratio's denominator, or
    // an unbound binding reads as a cache performance problem. `apps/web`
    // staging declares no CACHE_KV at all (Codex-ujgil), so this is a real
    // deployment shape and not a hypothetical.
    expect(obs.info).not.toHaveBeenCalled();
  });

  it('propagates a fetcher error rather than reporting a cache event', async () => {
    const kv = fakeKv();
    const obs = fakeObs();
    const { ctx } = ctxWith(kv, obs as unknown as ObservabilityClient);
    const boom = new Error('origin down');

    await expect(
      cachedRead(ctx, 'org-1', CacheType.ORG_CONFIG, () => Promise.reject(boom))
    ).rejects.toBe(boom);

    // The typed ServiceError has to reach `procedure()` untouched, and a failed
    // origin read is not a cache statistic.
    expect(signalOf(obs)).toBeUndefined();
  });

  it('works without an executionCtx, as unit tests and vite dev have none', async () => {
    const kv = fakeKv();
    const obs = fakeObs();
    const ctx: CachedReadContext = {
      env: { CACHE_KV: kv as unknown as CachedReadContext['env']['CACHE_KV'] },
      obs: obs as unknown as ObservabilityClient,
    };

    await expect(
      cachedRead(ctx, 'org-1', CacheType.ORG_CONFIG, () =>
        Promise.resolve({ name: 'Acme' })
      )
    ).resolves.toEqual({ name: 'Acme' });

    // Degrades to best-effort writes rather than throwing: `platform.context`
    // is absent under `vite dev`, and a missing execution context must not
    // break a page load.
    expect(signalOf(obs)).toMatchObject({ signal: 'cache_stats', gets: 1 });
  });
});
