import type { KVNamespace } from '@cloudflare/workers-types';
import { VersionedCache } from '@codex/cache';
import { CACHE_PRESETS } from '@codex/constants';

/**
 * Invalidate a versioned cache entry if CACHE_KV is available.
 * Safely no-ops when the KV binding is missing (local dev without cache).
 */
export async function invalidateCache(
  platform: App.Platform | undefined,
  id: string
): Promise<void> {
  if (!platform?.env?.CACHE_KV) return;
  const cache = new VersionedCache({
    kv: platform.env.CACHE_KV as KVNamespace,
  });
  await cache.invalidate(id);
}

/**
 * Standard cache header presets for server-side load functions.
 *
 * THE VALUES LIVE IN `CACHE_PRESETS` (`@codex/constants`), NOT HERE. This object
 * is only a header-shaped view of that shared vocabulary, so a `setHeaders()`
 * call site stays a one-liner. To change a window, change
 * `packages/constants/src/limits.ts` — never by re-typing a string here.
 *
 * WHY THE VALUES CANNOT LIVE IN THIS FILE: a Worker has to be able to declare
 * the same vocabulary, and this module imports `@cloudflare/workers-types` and
 * `@codex/cache` for `invalidateCache` above, so no Worker can reach it.
 * `@codex/constants` has zero imports, which is why it holds the strings.
 *
 * The mapping, apps/web name -> shared preset name. EVERY entry is a shared
 * preset now; no Cache-Control value is written out in this file at all:
 *
 * | this object      | `CACHE_PRESETS` key | emitted value (a COPY, see below) |
 * |------------------|---------------------|-----------------------------------|
 * | `DYNAMIC_PUBLIC` | `public`            | `public, max-age=60, s-maxage=60` |
 * | `STATIC_PUBLIC`  | `static`            | 1h browser + 1h CDN + 1d SWR      |
 * | `PER_VIEWER`     | `per-viewer`        | `public, max-age=0, no-cache`     |
 * | `PRIVATE`        | `private`           | `private, no-cache`               |
 * | `FRESH`          | `fresh`             | `private, no-store`               |
 *
 * That value column is a copy kept for orientation only.
 * `packages/constants/src/limits.ts` is the source of truth, and `cache.test.ts`
 * asserts the NAME pairing above byte for byte — so a window change lands there
 * and cannot be made here.
 *
 * `CACHE_PRESETS.asset` deliberately has no entry: its only apps/web consumer is
 * `cdn-proxy.ts`, which sets the header on a `Headers` instance rather than
 * through `setHeaders()`, so a header-shaped view buys it nothing.
 *
 * `DYNAMIC_PUBLIC_REVALIDATE` USED TO BE AN ENTRY HERE AND IS GONE. It was
 * `public, max-age=0, s-maxage=300, stale-while-revalidate=3600`, and it leaked:
 * `max-age=0` fixes only the BROWSER half, while `s-maxage=300` still lets a
 * shared cache hand one viewer's stored render to the next, because shared
 * caches key on URL and NEVER on Cookie. CI caught it deterministically on
 * 2026-05-28 (miniflare's CF cache emulation honours `s-maxage` for HTML by URL
 * key alone) and it was removed from the platform landing page — the comment at
 * the top of `src/routes/(platform)/+page.server.ts` is the full record. Its
 * safe replacement is `PER_VIEWER`, which drops the `s-maxage` entirely; if you
 * are unsure whether a page varies by viewer, use `PRIVATE`.
 *
 * `stale-while-revalidate` LIVES ON EXACTLY ONE PRESET — `static` — and must
 * never reach a page response. A shared window is a window during which a
 * publish is INVISIBLE: content freshness here is event-driven (a publish bumps
 * one KV version and every `VersionedCache` entry for that org stales at once),
 * and no such event can reach a CDN or a browser. SWR extends that invisible
 * window with no purge path, which is why `DYNAMIC_PUBLIC_REVALIDATE`'s hour of
 * it went and why `public` carries none. `static` is licensed by a different
 * fact, not by a shorter window: only crawlers read a sitemap, on their own
 * multi-hour cadence, so no human is waiting on the body and an invisible
 * publish has nothing to spoil. The preset-side guard in
 * `packages/constants/src/__tests__/cache-presets.test.ts` pins SWR to that one
 * name, and `cache.test.ts` pins it to that one entry here.
 *
 * NOTE: No `Vary: Accept-Language` — Paraglide is configured with a single
 * language tag (`en`), so responses do not vary by locale. Adding Vary would
 * fragment the CDN cache across every user's Accept-Language string (many
 * unique variants per real-world traffic) with no benefit. If a second
 * language is ever added to project.inlang/settings.json, bring Vary back.
 */
export const CACHE_HEADERS = {
  /**
   * Crawler-only documents: 1 hour browser + CDN, 1 day SWR.
   *
   * `CACHE_PRESETS.static`, and byte-identical to the string this entry used to
   * write out for itself — adopting the preset changed no response. It USED to
   * say it was "deliberately outside the shared vocabulary"; that was a
   * convention with nothing enforcing it, the drift gate disagreed the moment it
   * ran, and the gate won. The window still outlives every invalidation path
   * this platform has, which is exactly why it is defensible only where no
   * user-facing surface reads the response.
   *
   * The two `sitemap.xml` routes name `CACHE_PRESETS.static` directly, because a
   * `new Response(body, { headers })` site needs the string and not a
   * header-shaped object. This entry is the `setHeaders()` view of that same
   * preset, for the next crawler-only route that happens to be a page load.
   *
   * NEVER put it on a response that can vary by viewer — that is the
   * `DYNAMIC_PUBLIC_REVALIDATE` leak with a window 12x longer.
   */
  STATIC_PUBLIC: { 'Cache-Control': CACHE_PRESETS.static },

  /**
   * Public catalogue pages — asserts the body is IDENTICAL for every viewer.
   *
   * `CACHE_PRESETS.public`. The window is 60s, where this preset used to write
   * 300s with a 1h `stale-while-revalidate`: 60s is the bound content-api already
   * chose on invalidation grounds (see the module comment), and 300s was five
   * times the KV window it would have papered over. No response changed when it
   * was re-pointed — the preset had zero callers.
   *
   * MUST be called only AFTER every `await` that could throw has succeeded, or a
   * thrown `error(404)` inherits it and CDNs cache the error page for every
   * subsequent visitor.
   */
  DYNAMIC_PUBLIC: { 'Cache-Control': CACHE_PRESETS.public },

  /**
   * A page whose response MAY vary by viewer (e.g. the same URL shows a purchase
   * CTA to an anonymous visitor and a stream button to a buyer).
   *
   * `CACHE_PRESETS['per-viewer']`. `no-cache` is doing the work: RFC 9111 lets a
   * shared cache STORE the body but forbids serving it to any other request
   * without revalidating at the origin, so an anonymous burst can still be
   * absorbed as 304s while a signed-in viewer always gets their own body.
   * `max-age=0` covers an intermediary that honours only the freshness
   * directive.
   *
   * Note the absent `s-maxage`, and do not put one back — that is exactly the
   * `DYNAMIC_PUBLIC_REVALIDATE` bug recorded in the module comment above.
   *
   * Same ordering rule as `DYNAMIC_PUBLIC`: set it after the awaits. Zero
   * callers today; `PRIVATE` is the right answer for every auth-varying page
   * currently in the app, because the org and platform layouts inject the
   * signed-in user into the SSR shell.
   */
  PER_VIEWER: { 'Cache-Control': CACHE_PRESETS['per-viewer'] },

  /**
   * Authenticated/private: the viewer's own browser only, revalidated on every
   * navigation. `CACHE_PRESETS.private` — byte-identical to what this preset has
   * always emitted, so re-pointing it changed nothing.
   *
   * Safe to call anywhere, including before an `await` that can throw:
   * `private, no-cache` is exactly what an error response should carry, so there
   * is no cache-poisoning risk.
   */
  PRIVATE: { 'Cache-Control': CACHE_PRESETS.private },

  /**
   * Stored nowhere, by anyone. `CACHE_PRESETS.fresh`.
   *
   * For a body that is not merely per-viewer but per-REQUEST — one that embeds a
   * short-lived credential, so a copy on the browser's own disk outlives the
   * credential in it (the HLS playlists content-api serves are the reference
   * case). Zero callers in apps/web; it completes the vocabulary so the next
   * such response does not get a hand-written string.
   */
  FRESH: { 'Cache-Control': CACHE_PRESETS.fresh },
} as const;
