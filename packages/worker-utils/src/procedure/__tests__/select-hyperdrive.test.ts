/**
 * Hyperdrive binding selection (Codex-s1i7h)
 *
 * Hyperdrive holds read queries for 60s plus a 15s stale-while-revalidate
 * window and does NOT purge on write, so a route that must observe its own
 * write has to connect through the cache-DISABLED config. With 199
 * `procedure()` call sites that choice cannot be a per-route judgement, so it
 * is derived from `policy.cache` — and this is the derivation.
 *
 * The failure this guards against is silent in the worst way: a stale read is
 * intermittent, correct-looking, and unattributable. Nothing throws.
 */

import type { Bindings } from '@codex/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { selectHyperdrive } from '../service-registry';

const CACHED = { connectionString: 'postgres://cached' };
const UNCACHED = { connectionString: 'postgres://uncached' };

/** Both bindings present — a fully migrated production worker. */
const bothBound = {
  HYPERDRIVE: CACHED,
  HYPERDRIVE_UNCACHED: UNCACHED,
} as unknown as Bindings;

describe('selectHyperdrive', () => {
  it('returns undefined when the worker declares no binding', () => {
    // The rollback lever and the local/CI path: no binding means the caller
    // falls back to the Neon driver against DATABASE_URL.
    expect(selectHyperdrive({} as Bindings, 'public')).toBeUndefined();
    expect(selectHyperdrive({} as Bindings, undefined)).toBeUndefined();
  });

  it.each([
    'public',
    'static',
    'asset',
  ] as const)('routes the shared-cacheable preset %s to the CACHED config', (preset) => {
    expect(selectHyperdrive(bothBound, preset)).toBe(CACHED);
  });

  it.each([
    'private',
    'fresh',
  ] as const)('routes the viewer-varying preset %s to the UNCACHED config', (preset) => {
    expect(selectHyperdrive(bothBound, preset)).toBe(UNCACHED);
  });

  it('routes an ABSENT preset to the UNCACHED config', () => {
    // The dangerous reading is the default. A route that never declared a
    // cache preset must not be opted into a 75-second staleness window by
    // omission — which is what a deny-list would have done.
    expect(selectHyperdrive(bothBound, undefined)).toBe(UNCACHED);
  });

  it('treats an unknown future preset as NOT cacheable', () => {
    // CACHE_PRESETS can grow. A preset added there but not listed in
    // SHARED_CACHEABLE_PRESETS must degrade to safe, not to cached.
    expect(selectHyperdrive(bothBound, 'someFuturePreset' as never)).toBe(
      UNCACHED
    );
  });

  describe('when HYPERDRIVE is declared without HYPERDRIVE_UNCACHED', () => {
    const halfBound = { HYPERDRIVE: CACHED } as unknown as Bindings;

    it('falls back to Neon rather than serving a private route from cache', () => {
      // Correct-but-unpooled beats fast-but-stale. Returning CACHED here
      // would be the bug this whole module exists to prevent.
      expect(selectHyperdrive(halfBound, 'private')).toBeUndefined();
      expect(selectHyperdrive(halfBound, undefined)).toBeUndefined();
    });

    it('still serves shared-cacheable routes through the cached config', () => {
      expect(selectHyperdrive(halfBound, 'public')).toBe(CACHED);
    });

    it('says so, because a split-driver worker is otherwise invisible', () => {
      const obs = { warn: vi.fn() };
      selectHyperdrive(
        halfBound,
        'private',
        obs as unknown as Parameters<typeof selectHyperdrive>[2]
      );
      expect(obs.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: 'hyperdrive_binding_incomplete' })
      );
    });
  });
});
