/**
 * Leak guard for `CACHE_PRESETS` (Codex-yf2fc).
 *
 * The one rule this vocabulary exists to enforce is that NO response which can
 * vary by viewer may carry an `s-maxage`. That is not a theoretical concern
 * here: apps/web's `DYNAMIC_PUBLIC_REVALIDATE` was
 * `public, max-age=0, s-maxage=300` and it leaked. `max-age=0` fixes only the
 * BROWSER half — `s-maxage=300` still lets the edge hand one viewer's stored
 * render to the next, because shared caches key on URL and NEVER on Cookie. CI
 * caught it deterministically on 2026-05-28 (miniflare's CF cache emulation
 * honours `s-maxage` for HTML by URL key alone) and it was removed from the
 * platform landing page.
 *
 * A comment saying "do not put an s-maxage back" is a convention, and a
 * convention does not survive its own author. These tests are the shape: giving
 * a shared-cache window to a preset that may vary by viewer fails the suite
 * instead of shipping.
 *
 * WHAT CHANGED WHEN `static` AND `asset` LANDED, AND WHY THE GUARD STILL BITES.
 * This file used to say "a shared window only on `public`" and "no
 * `stale-while-revalidate` on any preset". Both were the RIGHT invariant stated
 * at the WRONG altitude: they described the four values that happened to exist
 * rather than the property that makes a shared window safe, which is
 * VIEWER-INVARIANCE. `static` (crawler-read documents) and `asset`
 * (content-addressed R2 bytes) are viewer-invariant with much longer windows,
 * and the historical leak shape is no less forbidden than before — it is now
 * forbidden on THREE named presets instead of on "everything except one".
 *
 * The classification below is therefore TOTAL by construction:
 * `Record<CachePresetName, …>` makes a seventh preset a compile error in this
 * file until someone says which side of the line it falls on, and a runtime
 * test re-checks the same thing for the vitest run (which transpiles without
 * typechecking). "Uncovered" is not a state this guard can be in.
 */
import { describe, expect, it } from 'vitest';
import { CACHE_PRESETS, type CachePresetName } from '../limits';

/**
 * Which presets assert the body is identical for every viewer.
 *
 * This is THE licence for a shared-cache window — not the length of the
 * window. `viewer-invariant` means two different viewers requesting the same
 * URL would receive the same bytes, so a shared cache handing one viewer's
 * stored copy to the next is correct rather than a leak. `viewer-variant` means
 * it would not, and no shared window is admissible at any length.
 *
 * Typed as a TOTAL record on purpose: a new preset does not compile here until
 * it is classified, so it cannot arrive unguarded.
 */
const VARIANCE: Record<CachePresetName, 'viewer-invariant' | 'viewer-variant'> =
  {
    public: 'viewer-invariant',
    static: 'viewer-invariant',
    asset: 'viewer-invariant',
    'per-viewer': 'viewer-variant',
    private: 'viewer-variant',
    fresh: 'viewer-variant',
  };

/**
 * The largest `s-maxage` each viewer-invariant preset may declare, in seconds,
 * with the reason the number is that number. A preset absent from this table
 * may carry no shared window at all.
 *
 * - `public` — 60s. A shared-cache window is a window during which a publish is
 *   INVISIBLE. Freshness here is event-driven (a publish bumps one KV version
 *   and every `VersionedCache` entry for that org stales at once) and no such
 *   event can reach a CDN, which expires only on the clock. So the window must
 *   not outlive the mechanism meant to make the publish visible. 60s is the
 *   value content-api already chose on exactly these grounds.
 * - `static` — 3600s. The invisibility argument only bites when a HUMAN is
 *   waiting to see the change. These bodies (the sitemaps) are read by crawlers
 *   on their own hours-to-days cadence, so an hour of edge staleness is not
 *   observable by any reader that exists.
 * - `asset` — 86400s. Content-addressed: the R2 key changes when the bytes
 *   change, so a stored copy can never be stale, only superseded. There is no
 *   invisible-publish window to bound; the number is an R2 egress-cost decision
 *   and matches the buckets' own `edgeTtl`.
 */
const SHARED_WINDOW_CEILING_SECONDS: Partial<Record<CachePresetName, number>> =
  {
    public: 60,
    static: 3600,
    asset: 86400,
  };

/**
 * The ONLY preset permitted a `stale-while-revalidate`.
 *
 * It licenses a shared cache to serve an already-expired body for a further 24
 * hours while it refreshes in the background — an extension of the
 * invisible-publish window with no purge path. Admissible only where no human
 * is waiting on the body, which is true of crawler-read documents and of
 * nothing else in this vocabulary.
 */
const STALE_WHILE_REVALIDATE_PRESET: CachePresetName = 'static';

const entries = Object.entries(CACHE_PRESETS) as [CachePresetName, string][];

/** Directive names present in a header value, lower-cased. */
function directives(value: string): string[] {
  return value
    .split(',')
    .map((part) => (part.trim().split('=')[0] ?? '').toLowerCase());
}

/** The numeric argument of a directive, or undefined when it is absent. */
function directiveSeconds(value: string, name: string): number | undefined {
  for (const part of value.split(',')) {
    const [key, arg] = part.trim().split('=');
    if (key?.toLowerCase() === name) return Number(arg);
  }
  return undefined;
}

describe('CACHE_PRESETS', () => {
  it('covers exactly the six names in the contract', () => {
    expect(Object.keys(CACHE_PRESETS)).toEqual([
      'public',
      'static',
      'asset',
      'per-viewer',
      'private',
      'fresh',
    ]);
  });

  it('classifies every preset as viewer-invariant or viewer-variant', () => {
    // The type above makes this a compile error too, but vitest transpiles
    // without typechecking, so the totality is asserted at runtime as well:
    // an unclassified preset must not be able to slip through a green test run.
    expect(Object.keys(VARIANCE).sort()).toEqual(
      Object.keys(CACHE_PRESETS).sort()
    );
  });

  it('keys are the tokens an author writes in a route declaration', () => {
    // The string in the config and the key here must be the SAME token, or the
    // vocabulary has two spellings. Lower-case and hyphenated — deliberately
    // not SCREAMING_SNAKE like RATE_LIMIT_PRESETS.
    for (const [name] of entries) {
      expect(name).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it.each(entries)('%s is a non-empty Cache-Control value', (_name, value) => {
    expect(value.length).toBeGreaterThan(0);
    expect(value).toBe(value.trim());
    // A header value, not an object or a fragment: no stray quotes or newlines.
    expect(value).not.toMatch(/["'\n\r]/);
  });

  it('gives a shared-cache window ONLY to viewer-invariant presets', () => {
    // THE LEAK GUARD. Do not relax this to make a new preset fit: if a body can
    // differ between two viewers, no window length is safe, because a shared
    // cache keys on URL and never on Cookie.
    for (const [name, value] of entries) {
      if (VARIANCE[name] === 'viewer-invariant') continue;
      const found = directives(value);
      expect(
        found,
        `${name} may vary by viewer, so it must not carry a shared-cache window`
      ).not.toContain('s-maxage');
      expect(
        found,
        `${name} may vary by viewer, so it must not serve a stale shared copy`
      ).not.toContain('stale-while-revalidate');
    }
  });

  it('bounds every shared-cache window by a declared ceiling', () => {
    for (const [name, value] of entries) {
      const shared = directiveSeconds(value, 's-maxage');
      if (shared === undefined) continue;
      const ceiling = SHARED_WINDOW_CEILING_SECONDS[name];
      // No ceiling declared => no shared window allowed. This is the other half
      // of the leak guard: a preset cannot acquire an unargued window.
      expect(
        ceiling,
        `${name} carries s-maxage=${shared} but declares no ceiling — state the reason the number is safe`
      ).toBeDefined();
      expect(shared, `${name} s-maxage`).toBeLessThanOrEqual(ceiling as number);
    }
  });

  it('keeps public bounded by the invalidation mechanism at 60s', () => {
    // Named explicitly rather than left to the table: `public` is the preset an
    // author reaches for on a page a human is looking at, and 60s is the only
    // number the event-driven invalidation story supports. Widening it is the
    // failure this whole vocabulary was written to prevent — the long windows
    // live on `static`/`asset`, which are read by crawlers and by CDNs.
    expect(directiveSeconds(CACHE_PRESETS.public, 's-maxage')).toBe(60);
    expect(directiveSeconds(CACHE_PRESETS.public, 'max-age')).toBe(60);
  });

  it('carries stale-while-revalidate on static and on nothing else', () => {
    for (const [name, value] of entries) {
      const found = directives(value);
      if (name === STALE_WHILE_REVALIDATE_PRESET) {
        expect(found, name).toContain('stale-while-revalidate');
        continue;
      }
      expect(found, name).not.toContain('stale-while-revalidate');
    }
  });

  it('lets asset cache longer at the edge than in the browser', () => {
    // The asymmetry is the point: the shared copy is what bounds R2 egress, and
    // a content-addressed key cannot go stale, so the edge window is
    // deliberately far longer than the browser's. A change that flattened them
    // would mean someone stopped believing the key-addressing argument.
    const browser = directiveSeconds(CACHE_PRESETS.asset, 'max-age') as number;
    const shared = directiveSeconds(CACHE_PRESETS.asset, 's-maxage') as number;
    expect(shared).toBeGreaterThan(browser);
  });

  it.each([
    'public',
    'static',
    'asset',
  ] as const)('%s is addressed to shared caches as well as the browser', (name) => {
    const found = directives(CACHE_PRESETS[name]);
    expect(found).toContain('public');
    expect(found).not.toContain('private');
    expect(found).not.toContain('no-store');
  });

  it('keeps per-viewer revalidating rather than merely stale', () => {
    // `no-cache` is what makes per-viewer safe: RFC 9111 lets a shared cache
    // STORE the body but forbids serving it to any other request without
    // revalidating at origin. Without it, `max-age=0` alone is a freshness
    // hint, not a reuse barrier.
    expect(directives(CACHE_PRESETS['per-viewer'])).toContain('no-cache');
  });

  it.each([
    'private',
    'fresh',
  ] as const)('%s is addressed to the browser alone', (name) => {
    const found = directives(CACHE_PRESETS[name]);
    expect(found).toContain('private');
    expect(found).not.toContain('public');
  });

  it('stores nothing at all for fresh', () => {
    // Per-REQUEST bodies (HLS playlists embed a short-lived presigned URL and a
    // per-user token), so even the browser's own disk outlives the credential.
    expect(directives(CACHE_PRESETS.fresh)).toContain('no-store');
  });
});
