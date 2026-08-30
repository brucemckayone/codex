import { CACHE_PRESETS, type CachePresetName } from '@codex/constants';
import { describe, expect, it } from 'vitest';
import { CACHE_HEADERS } from './cache';

/**
 * Drift guard for the apps/web view of the shared cache vocabulary.
 *
 * The table in `cache.ts` used to hold its own Cache-Control strings, and one of
 * them leaked: `DYNAMIC_PUBLIC_REVALIDATE` was
 * `public, max-age=0, s-maxage=300, stale-while-revalidate=3600`, where
 * `max-age=0` fixes only the BROWSER half and `s-maxage=300` still lets a shared
 * cache hand one viewer's stored render to the next — shared caches key on URL
 * and NEVER on Cookie. These assertions exist so that leak cannot be re-typed.
 *
 * WHAT CHANGED, AND WHY THIS FILE IS NOW SHORTER ON EXEMPTIONS. `STATIC_PUBLIC`
 * used to be asserted as "outside the vocabulary, unchanged and uncalled", with
 * a by-name skip in the window test. That was a convention with nothing
 * enforcing it: the drift gate flagged the hand-written string the moment it
 * ran, `CACHE_PRESETS.static` was added, and the entry adopted it byte for byte.
 * So the mapping below is TOTAL — every entry of `CACHE_HEADERS` is a named
 * shared preset, and a new entry is a compile error here until it is mapped.
 */
describe('CACHE_HEADERS', () => {
  /**
   * apps/web name -> shared preset name. `Record<keyof typeof CACHE_HEADERS,
   * CachePresetName>` is the load-bearing part: adding an entry to
   * `CACHE_HEADERS` without adding it here does not compile, so this guard
   * cannot silently cover five of six entries.
   */
  const MAPPED: Record<keyof typeof CACHE_HEADERS, CachePresetName> = {
    DYNAMIC_PUBLIC: 'public',
    STATIC_PUBLIC: 'static',
    PER_VIEWER: 'per-viewer',
    PRIVATE: 'private',
    FRESH: 'fresh',
  };

  /**
   * Who reads the response this entry is set on.
   *
   * `page-response` — reachable by a human through `setHeaders()` in a load, so
   * a shared window is a window in which one viewer's render can be handed to
   * the next AND in which a publish is invisible.
   * `crawler-only` — a document whose only readers are crawlers, on their own
   * multi-hour cadence. This is the ONLY licence for a window longer than the
   * KV-invalidation bound, and it is a fact about the reader, not a shorter
   * number.
   *
   * Total for the same reason as `MAPPED`, and the runtime check below fails
   * CLOSED: an entry missing from here is treated as `page-response`.
   */
  const AUDIENCE: Record<
    keyof typeof CACHE_HEADERS,
    'page-response' | 'crawler-only'
  > = {
    DYNAMIC_PUBLIC: 'page-response',
    STATIC_PUBLIC: 'crawler-only',
    PER_VIEWER: 'page-response',
    PRIVATE: 'page-response',
    FRESH: 'page-response',
  };

  const KV_INVALIDATION_BOUND_SECONDS = 60;

  it('takes every value from CACHE_PRESETS, not from a local string', () => {
    for (const [name, preset] of Object.entries(MAPPED)) {
      expect(
        CACHE_HEADERS[name as keyof typeof MAPPED]['Cache-Control'],
        `${name} must be CACHE_PRESETS['${preset}'], byte for byte`
      ).toBe(CACHE_PRESETS[preset]);
    }
  });

  it('maps and classifies EVERY entry — no entry escapes this file', () => {
    // vitest transpiles without typechecking, so the two Records above are only
    // a build-time guarantee under `pnpm --filter web typecheck`. This is the
    // runtime half, so an unmapped entry fails here too rather than being
    // skipped by the loops.
    const entries = Object.keys(CACHE_HEADERS).sort();
    expect(Object.keys(MAPPED).sort()).toEqual(entries);
    expect(Object.keys(AUDIENCE).sort()).toEqual(entries);
  });

  it('spells the header key exactly "Cache-Control" on every entry', () => {
    for (const [name, headers] of Object.entries(CACHE_HEADERS)) {
      expect(Object.keys(headers), `${name} header key`).toEqual([
        'Cache-Control',
      ]);
    }
  });

  it('has retired DYNAMIC_PUBLIC_REVALIDATE', () => {
    expect(CACHE_HEADERS).not.toHaveProperty('DYNAMIC_PUBLIC_REVALIDATE');
  });

  it('never puts an s-maxage on a preset that can vary by viewer', () => {
    // The whole point of `per-viewer`: a shared cache may store the body but
    // must revalidate before reuse. An s-maxage would license blind reuse.
    expect(CACHE_HEADERS.PER_VIEWER['Cache-Control']).not.toMatch(/s-maxage/);
    expect(CACHE_HEADERS.PRIVATE['Cache-Control']).not.toMatch(
      /s-maxage|public/
    );
    expect(CACHE_HEADERS.FRESH['Cache-Control']).not.toMatch(/s-maxage|public/);
  });

  it('keeps every page-response shared window inside the KV bound, and SWR off it entirely', () => {
    // A shared window is a window during which a publish is INVISIBLE: no KV
    // version bump can reach a CDN or a browser. 60s is the bound content-api
    // already chose on those grounds. `stale-while-revalidate` extends that
    // invisible window with no purge path, so no page response may carry it.
    for (const [name, headers] of Object.entries(CACHE_HEADERS)) {
      const audience =
        AUDIENCE[name as keyof typeof AUDIENCE] ?? 'page-response';
      if (audience !== 'page-response') continue;
      const value = headers['Cache-Control'];
      const shared = /s-maxage=(\d+)/.exec(value);
      if (shared)
        expect(Number(shared[1]), `${name} s-maxage`).toBeLessThanOrEqual(
          KV_INVALIDATION_BOUND_SECONDS
        );
      expect(
        value,
        `${name} must not carry stale-while-revalidate`
      ).not.toMatch(/stale-while-revalidate/);
    }
  });

  it('licenses the one long window by audience, and only for the crawler-only entry', () => {
    // The positive half of the rule above: STATIC_PUBLIC really does carry a
    // window the KV bound would forbid, and it is the ONLY entry that does. If
    // a second entry is ever classified `crawler-only`, this fails and someone
    // has to argue for it in the constants file first.
    const crawlerOnly = Object.entries(AUDIENCE)
      .filter(([, audience]) => audience === 'crawler-only')
      .map(([name]) => name);
    expect(crawlerOnly).toEqual(['STATIC_PUBLIC']);

    const value = CACHE_HEADERS.STATIC_PUBLIC['Cache-Control'];
    expect(value).toBe(CACHE_PRESETS.static);
    const shared = /s-maxage=(\d+)/.exec(value);
    expect(Number(shared?.[1])).toBeGreaterThan(KV_INVALIDATION_BOUND_SECONDS);
    expect(value).toMatch(/stale-while-revalidate/);
  });
});
