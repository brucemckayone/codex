/**
 * Tests for the junk-host short-circuit hook (measured 2026-08-31).
 *
 * Reserved-but-unmatched subdomains (cdn, cdn-dev, cdn-resources*, preview, …)
 * used to fall through the whole SSR pipeline and render a full 404 page —
 * 406 of 599 cdn* requests/24h were 404s on the account's most expensive
 * worker. These tests pin the contract that now terminates them:
 *
 *   - the exact measured junk hosts short-circuit;
 *   - everything real keeps its current path: apex/www/creators, org slugs
 *     (unknown ones included — they need DB resolution), the public CDN hosts
 *     cdn-assets and cdn-platform with any env suffix (cdnAssetHook serves
 *     them; it runs right after junkHostHook in the sequence), the frontend
 *     aliases codex and creators with any suffix, the platform frontends app
 *     and platform, and the staging/tunnel apexes;
 *   - the 404 is a constant edge-cacheable body, written into the Cache API
 *     on GET, and a cache failure never breaks the response;
 *   - the assembled `handle` sequence terminates junk hosts before any
 *     session work and carries real traffic through to the router.
 *
 * The census at the bottom is the durable form: it derives the expectation
 * for EVERY reserved subdomain, so a new reserved-hostname axis fails here
 * until its junk-or-served status is decided explicitly.
 */

import {
  APP_SUBDOMAINS,
  CACHE_PRESETS,
  CDN_HOST_SUFFIXES,
  DEPLOY_HOST_SUFFIXES,
  RESERVED_SUBDOMAINS,
  TRANSIENT_HOST_SUFFIXES,
} from '@codex/constants';
import type { Handle } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPublicCdnHost } from '$lib/server/cdn-proxy';
import { handle, junkHostHook, shouldShortCircuitHost } from './hooks.server';

// The real `sequence()` enters SvelteKit's per-request tracing store, which
// only exists inside a live request — `handle` cannot be driven from vitest
// directly. This mock reimplements its documented chaining (each hook's
// `resolve` is the next hook; the last resolves the input's own resolve),
// which is all the ordering tests need: the hooks arrive in the exact
// argument order of `sequence(...)` in hooks.server.ts, so reordering or
// deleting one there fails these tests.
vi.mock('@sveltejs/kit/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sveltejs/kit/hooks')>();
  const sequence =
    (...hooks: Handle[]) =>
    async (input: Parameters<Handle>[0]): Promise<Response> => {
      // `resolve` receives the EVENT (plus optional resolve options), exactly
      // as SvelteKit's own sequence passes it — hooks call `resolve(event)`.
      type Chained = (
        event: Parameters<Handle>[0]['event']
      ) => Promise<Response>;
      let next: Chained = input.resolve as unknown as Chained;
      for (let i = hooks.length - 1; i >= 0; i -= 1) {
        const downstream = next;
        const hook = hooks[i];
        next = async (event) => await hook({ event, resolve: downstream });
      }
      return next(input.event);
    };
  return { ...actual, sequence };
});

/** Minimal hook input: url + request + a resolve that stands in for the whole
 * rest of the chain (cdnAssetHook, sessionHook, securityHook, cdnRewriteHook). */
function makeHookEvent(opts: { host: string; method?: string }) {
  const url = new URL(`https://${opts.host}/some/probe/path`);
  const request = new Request(url, { method: opts.method ?? 'GET' });
  const resolve = vi.fn(async () => new Response('rendered page'));
  const input = {
    event: { url, request },
    resolve,
  } as unknown as Parameters<typeof junkHostHook>[0];
  return { input, resolve, request };
}

/** Minimal input for driving the real `handle` sequence end to end: the
 * resolve stand-in for the router plus the event pieces sessionHook and
 * securityHook touch (cookies.get returning undefined skips the auth call). */
function makeSequenceInput(opts: { host: string }) {
  const url = new URL(`https://${opts.host}/some/probe/path`);
  const event = {
    url,
    request: new Request(url),
    cookies: { get: vi.fn(() => undefined) },
    // Loosely typed: the assertions below read locals.requestId, which only
    // exists once the real sessionHook has run.
    locals: {} as Record<string, unknown>,
  };
  const resolve = vi.fn(async () => new Response('rendered page'));
  const input = {
    event,
    resolve,
  } as unknown as Parameters<typeof handle>[0];
  return { input, resolve, event };
}

/** Stub the global Cache API (`typeof caches` guard in the hook reads it). */
function stubCaches(
  putImpl: (
    request: Request,
    response: Response
  ) => Promise<void> = async () => {}
) {
  const put = vi.fn(putImpl);
  const open = vi.fn(async () => ({ put }));
  vi.stubGlobal('caches', { open });
  return { put, open };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shouldShortCircuitHost — the exact measured hosts', () => {
  const cases: [hostname: string, expected: boolean][] = [
    // Junk: reserved, nothing serves them → cheap 404
    ['cdn-resources-dev.revelations.studio', true],
    ['cdn.revelations.studio', true],
    ['cdn-dev.revelations.studio', true],
    ['preview.revelations.studio', true],
    // Public CDN → cdnAssetHook serves real assets
    ['cdn-assets.revelations.studio', false],
    ['cdn-platform-anything.revelations.studio', false],
    // Real traffic → byte-identical to today
    ['revelations.studio', false],
    ['www.revelations.studio', false],
    ['some-real-org.revelations.studio', false],
    ['app.revelations.studio', false],
    ['platform.revelations.studio', false],
  ];

  it.each(cases)('%s → %s', (hostname, expected) => {
    expect(shouldShortCircuitHost(hostname)).toBe(expected);
  });

  it('short-circuits the gated CDN hosts — the private-bucket 404 is the security control', () => {
    // cdn-resources / cdn-media are publicAccess:false buckets; their 404 is
    // the control WORKING (cdn-proxy.ts header). Same verdict, now cheap.
    expect(shouldShortCircuitHost('cdn-media.revelations.studio')).toBe(true);
    expect(shouldShortCircuitHost('cdn-resources.revelations.studio')).toBe(
      true
    );
    expect(
      shouldShortCircuitHost('cdn-resources-preview.revelations.studio')
    ).toBe(true);
  });

  it('never short-circuits a host this worker actually serves', () => {
    // Frontend aliases on dedicated routes in apps/web/wrangler.jsonc…
    expect(shouldShortCircuitHost('codex.revelations.studio')).toBe(false);
    expect(shouldShortCircuitHost('codex-staging.revelations.studio')).toBe(
      false
    );
    expect(shouldShortCircuitHost('creators.revelations.studio')).toBe(false);
    expect(shouldShortCircuitHost('creators-staging.revelations.studio')).toBe(
      false
    );
    // …the platform frontends, which render platform pages today (verified
    // 2026-08-31: app./platform. → 200 text/html). `app` is also a
    // PRODUCTION checkout-redirect domain (ALLOWED_REDIRECT_DOMAINS in
    // packages/validation/src/schemas/purchase.ts) — a cached 404 there
    // strands paying customers returning from Stripe.
    expect(shouldShortCircuitHost('app.revelations.studio')).toBe(false);
    expect(shouldShortCircuitHost('platform.revelations.studio')).toBe(false);
    // …and the recognized apex aliases that render platform pages today.
    expect(shouldShortCircuitHost('staging.revelations.studio')).toBe(false);
    expect(shouldShortCircuitHost('local.revelations.studio')).toBe(false);
    expect(shouldShortCircuitHost('dev.revelations.studio')).toBe(false);
  });

  it('censuses EVERY reserved subdomain: junk unless something serves it', () => {
    // The exempted labels, derived from the same axes that generate them —
    // `assets`/`platform` mirror PUBLIC_CDN_BINDINGS in cdn-proxy.ts (the
    // public buckets); `app`/`platform` are the platform frontends this
    // worker serves (see SERVED_RESERVED_SUBDOMAINS in hooks.server.ts);
    // `www`/`dev` never reach the reserved branch at all (www maps to
    // platform, dev is its own apex in parseHost).
    const exempted = new Set([
      ...(['assets', 'platform'] as const).flatMap((type) =>
        CDN_HOST_SUFFIXES.map((suffix) => `cdn-${type}${suffix}`)
      ),
      ...APP_SUBDOMAINS.flatMap((app) =>
        [...DEPLOY_HOST_SUFFIXES, ...TRANSIENT_HOST_SUFFIXES].map(
          (suffix) => `${app}${suffix}`
        )
      ),
      'app',
      'platform',
      'staging',
      'local',
      'www',
      'dev',
    ]);

    let junk = 0;
    for (const label of RESERVED_SUBDOMAINS) {
      const expected = !exempted.has(label);
      // The label is the assertion message: a failure names the hostname.
      expect(shouldShortCircuitHost(`${label}.revelations.studio`), label).toBe(
        expected
      );
      if (expected) junk += 1;
    }
    // The point of the hook: the junk class is non-empty and the exempted
    // class is real traffic, never empty.
    expect(junk).toBeGreaterThan(0);
    expect(exempted.size).toBeGreaterThan(0);
  });
});

describe('junkHostHook', () => {
  it('answers a junk host with a constant 404 and runs nothing downstream', async () => {
    const { input, resolve } = makeHookEvent({
      host: 'cdn-resources-dev.revelations.studio',
    });

    const response = await junkHostHook(input);

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe(
      'text/plain; charset=utf-8'
    );
    // The header is kept and binds the CLIENT. It does NOT make Cloudflare's
    // edge answer these — a Worker response is not edge-cached just because it
    // carries `s-maxage`; that would need a zone Cache Rule.
    expect(response.headers.get('cache-control')).toBe(CACHE_PRESETS.asset);
    expect(await response.text()).toBe('Not Found');
    // Cheap termination: not one downstream hook (session, security, render)
    // may run for a junk host. This is the whole saving — the worker invocation
    // itself is already paid before any hook can run.
    expect(resolve).not.toHaveBeenCalled();
  });

  it('writes NOTHING to the Cache API (Codex-viidc)', async () => {
    // The hook used to `put` the 404 into `caches.open('junk-host-404')` on
    // every GET. Nothing ever read it back — that was the only Cache API call
    // in apps/web and there is no `cache.match` anywhere — so the write was
    // pure cost, and being AWAITED it added latency to the response it was
    // meant to make cheap. This asserts it is gone, and will fail if anyone
    // reinstates a write without also adding the matching read.
    const { open, put } = stubCaches();
    const { input } = makeHookEvent({ host: 'cdn.revelations.studio' });

    const response = await junkHostHook(input);

    expect(response.status).toBe(404);
    expect(open).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('returns the 404 when there is no Cache API at all', async () => {
    // No vi.stubGlobal('caches') — jsdom has none. Now trivially true since the
    // hook never touches `caches`, but kept as the regression guard for the
    // runtime it was written for: this hook must not depend on a global that
    // vitest/jsdom lacks.
    const { input } = makeHookEvent({ host: 'preview.revelations.studio' });
    const response = await junkHostHook(input);
    expect(response.status).toBe(404);
  });

  it.each([
    'POST',
    'HEAD',
  ])('terminates %s on a junk host too, and writes nothing', async (method) => {
    // This used to read "skips the cache write for %s (Cache API is GET-only)".
    // That premise died with the write itself, but the METHOD coverage is still
    // a real contract: a junk host is junk whatever the verb, and no method may
    // reach a cache.
    const { open, put } = stubCaches();
    const { input, resolve } = makeHookEvent({
      host: 'cdn-dev.revelations.studio',
      method,
    });

    const response = await junkHostHook(input);

    expect(response.status).toBe(404);
    expect(resolve).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('passes real traffic through untouched — resolve() and nothing else', async () => {
    const hosts = [
      'revelations.studio',
      'www.revelations.studio',
      'creators.revelations.studio',
      'some-real-org.revelations.studio',
      'unknown-org-slug.revelations.studio',
      'codex.revelations.studio',
      'app.revelations.studio',
      'platform.revelations.studio',
      'staging.revelations.studio',
    ];
    for (const host of hosts) {
      const { put } = stubCaches();
      const { input, resolve } = makeHookEvent({ host });
      const response = await junkHostHook(input);
      expect(await response.text(), host).toBe('rendered page');
      expect(resolve, host).toHaveBeenCalledTimes(1);
      expect(put, host).not.toHaveBeenCalled();
    }
  });

  it('defers public CDN hosts so cdnAssetHook (next in the sequence) serves them', async () => {
    const hosts = [
      'cdn-assets.revelations.studio',
      'cdn-assets-preview.revelations.studio',
      'cdn-platform.revelations.studio',
      'cdn-platform-anything.revelations.studio',
    ];
    for (const host of hosts) {
      // Ordering contract: junkHostHook runs FIRST in `handle`; deferring
      // here is what lets the real asset path (cdnAssetHook, 163 x 200/day)
      // see the request.
      expect(isPublicCdnHost(host), host).toBe(true);
      expect(shouldShortCircuitHost(host), host).toBe(false);

      const { input, resolve } = makeHookEvent({ host });
      const response = await junkHostHook(input);
      expect(await response.text(), host).toBe('rendered page');
      expect(resolve, host).toHaveBeenCalledTimes(1);
    }
  });
});

describe('handle — the assembled sequence', () => {
  // The unit tests above drive junkHostHook alone; these drive the real
  // `handle` export so the ORDER is pinned, not just the deferral. `resolve`
  // stands in for the router, so "resolve never ran" means not one hook
  // behind junkHostHook (cdn assets, session validation, security, rewrite)
  // spent anything on the request.

  it('terminates a junk host before the router — no session work, no cache write', async () => {
    const { open, put } = stubCaches();
    const { input, resolve, event } = makeSequenceInput({
      host: 'cdn-resources-dev.revelations.studio',
    });

    const response = await handle(input);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not Found');
    // Ordering contract. `resolve` (the router) never running is only half
    // of it: sessionHook runs BEFORE the router, so the cheap-termination
    // claim is that it never ran either — observable as locals.requestId,
    // the first thing sessionHook writes. If junkHostHook moved behind
    // sessionHook, requestId would be set and this fails.
    expect(resolve).not.toHaveBeenCalled();
    expect(event.locals.requestId).toBeUndefined();
    // And nothing reaches the Cache API through the assembled sequence either.
    expect(open).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('carries real traffic through every hook to the router', async () => {
    stubCaches();
    const { input, resolve, event } = makeSequenceInput({
      host: 'app.revelations.studio',
    });

    const response = await handle(input);

    expect(await response.text()).toBe('rendered page');
    expect(resolve).toHaveBeenCalledTimes(1);
    // The full chain really ran — sessionHook stamped the request ID.
    expect(event.locals.requestId).toEqual(expect.any(String));
  });
});
