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
 *     them; it runs right AFTER junkHostHook, so deferring here IS the
 *     ordering contract), the frontend aliases codex and creators with any
 *     suffix, and the staging/tunnel apexes;
 *   - the 404 is a constant edge-cacheable body, written into the Cache API
 *     on GET, and a cache failure never breaks the response.
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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPublicCdnHost } from '$lib/server/cdn-proxy';
import { junkHostHook, shouldShortCircuitHost } from './hooks.server';

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
    // …and the recognized apex aliases that render platform pages today.
    expect(shouldShortCircuitHost('staging.revelations.studio')).toBe(false);
    expect(shouldShortCircuitHost('local.revelations.studio')).toBe(false);
    expect(shouldShortCircuitHost('dev.revelations.studio')).toBe(false);
  });

  it('censuses EVERY reserved subdomain: junk unless something serves it', () => {
    // The exempted labels, derived from the same axes that generate them —
    // `assets`/`platform` mirror PUBLIC_CDN_BINDINGS in cdn-proxy.ts (the
    // public buckets); `www`/`dev` never reach the reserved branch at all
    // (www maps to platform, dev is its own apex in parseHost).
    const exempted = new Set([
      ...(['assets', 'platform'] as const).flatMap((type) =>
        CDN_HOST_SUFFIXES.map((suffix) => `cdn-${type}${suffix}`)
      ),
      ...APP_SUBDOMAINS.flatMap((app) =>
        [...DEPLOY_HOST_SUFFIXES, ...TRANSIENT_HOST_SUFFIXES].map(
          (suffix) => `${app}${suffix}`
        )
      ),
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
  it('answers a junk host with a constant cached 404 and runs nothing downstream', async () => {
    const { put } = stubCaches();
    const { input, resolve, request } = makeHookEvent({
      host: 'cdn-resources-dev.revelations.studio',
    });

    const response = await junkHostHook(input);

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe(
      'text/plain; charset=utf-8'
    );
    expect(response.headers.get('cache-control')).toBe(CACHE_PRESETS.asset);
    // Cheap termination: not one downstream hook (session, security, render)
    // may run for a junk host.
    expect(resolve).not.toHaveBeenCalled();

    // The cached copy is the 404 itself, keyed on the incoming request…
    expect(put).toHaveBeenCalledTimes(1);
    const [cachedRequest, cachedResponse] = put.mock.calls[0];
    expect(cachedRequest).toBe(request);
    expect(cachedResponse.status).toBe(404);
    expect(await cachedResponse.text()).toBe('Not Found');
    // …and cloning for the put left the returned body intact.
    expect(await response.text()).toBe('Not Found');
  });

  it('still returns the 404 when the edge-cache write fails', async () => {
    stubCaches(async () => {
      throw new Error('cache unavailable');
    });
    const { input, resolve } = makeHookEvent({
      host: 'cdn.revelations.studio',
    });

    const response = await junkHostHook(input);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not Found');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('still returns the 404 when there is no Cache API at all', async () => {
    // No vi.stubGlobal('caches') — jsdom has none; the typeof guard must hold.
    const { input } = makeHookEvent({ host: 'preview.revelations.studio' });
    const response = await junkHostHook(input);
    expect(response.status).toBe(404);
  });

  it('skips the cache write for non-GET requests (Cache API is GET-only)', async () => {
    const { put } = stubCaches();
    const { input } = makeHookEvent({
      host: 'cdn-dev.revelations.studio',
      method: 'POST',
    });

    const response = await junkHostHook(input);

    expect(response.status).toBe(404);
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
