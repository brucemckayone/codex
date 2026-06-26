/**
 * Tests for the public CDN asset proxy (WP-2 · Codex-fc5oh.2).
 *
 * Locks down the contract that fixes platform-wide image 404s and the security
 * boundary that keeps gated buckets out:
 *   - public hosts (cdn-assets / cdn-platform) serve straight from R2;
 *   - the gated cdn-media / cdn-resources hosts are NEVER proxied;
 *   - non-CDN hosts and unbound environments fall through to SvelteKit;
 *   - conditional GETs yield 304, HEAD yields metadata, bad methods 405.
 */
import { describe, expect, it, vi } from 'vitest';
import { tryServeCdnAsset } from './cdn-proxy';

/** Minimal fake R2 object body. */
function fakeObject(opts: {
  body?: string;
  etag?: string;
  contentType?: string;
  size?: number;
}) {
  const etag = opts.etag ?? 'v1';
  return {
    body: opts.body,
    size: opts.size ?? opts.body?.length ?? 0,
    httpEtag: `"${etag}"`,
    writeHttpMetadata(headers: Headers) {
      if (opts.contentType) headers.set('content-type', opts.contentType);
    },
  };
}

/**
 * Fake R2 bucket. `get` honours an If-None-Match that matches the stored etag
 * by returning a metadata-only object (no `body`) — exactly how R2's `onlyIf`
 * precondition behaves — so the 304 path is exercised realistically.
 */
function fakeBucket(store: Record<string, ReturnType<typeof fakeObject>>) {
  return {
    get: vi.fn(async (key: string, options?: { onlyIf?: Headers }) => {
      const object = store[key];
      if (!object) return null;
      const ifNoneMatch = options?.onlyIf?.get?.('if-none-match');
      if (ifNoneMatch && ifNoneMatch === object.httpEtag) {
        const { body: _body, ...metadataOnly } = object;
        return metadataOnly;
      }
      return object;
    }),
    head: vi.fn(async (key: string) => store[key] ?? null),
  } as unknown as R2Bucket;
}

function makeEvent(opts: {
  host: string;
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  env?: Record<string, unknown>;
}) {
  const url = new URL(`https://${opts.host}${opts.path ?? '/'}`);
  return {
    url,
    request: new Request(url, {
      method: opts.method ?? 'GET',
      headers: opts.headers,
    }),
    platform: { env: opts.env ?? {} },
  } as unknown as Parameters<typeof tryServeCdnAsset>[0];
}

describe('tryServeCdnAsset', () => {
  it('returns null for non-CDN hosts (normal SvelteKit handling)', async () => {
    const res = await tryServeCdnAsset(
      makeEvent({ host: 'revelations.studio', path: '/library' })
    );
    expect(res).toBeNull();
  });

  it('does NOT proxy the gated cdn-media host (security boundary)', async () => {
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-media.revelations.studio',
        path: '/secret/video.m3u8',
        // even if a bucket were bound under that name, the host must not resolve
        env: { ASSETS_BUCKET: fakeBucket({}) },
      })
    );
    expect(res).toBeNull();
  });

  it('does NOT proxy the gated cdn-resources host', async () => {
    const res = await tryServeCdnAsset(
      makeEvent({ host: 'cdn-resources.revelations.studio', path: '/x.pdf' })
    );
    expect(res).toBeNull();
  });

  it('falls through when the bucket binding is absent (e.g. dev)', async () => {
    const res = await tryServeCdnAsset(
      makeEvent({ host: 'cdn-assets.revelations.studio', path: '/logo.webp' })
    );
    expect(res).toBeNull();
  });

  it('serves a public asset from ASSETS_BUCKET (200 + body + headers)', async () => {
    const bucket = fakeBucket({
      'thumbnails/abc.webp': fakeObject({
        body: 'IMG',
        contentType: 'image/webp',
      }),
    });
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-assets.revelations.studio',
        path: '/thumbnails/abc.webp',
        env: { ASSETS_BUCKET: bucket },
      })
    );
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);
    expect(res?.headers.get('content-type')).toBe('image/webp');
    expect(res?.headers.get('cache-control')).toContain('public');
    expect(res?.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res?.text()).toBe('IMG');
  });

  it('serves cdn-platform from PLATFORM_BUCKET', async () => {
    const bucket = fakeBucket({
      'legal/terms.pdf': fakeObject({
        body: 'PDF',
        contentType: 'application/pdf',
      }),
    });
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-platform.revelations.studio',
        path: '/legal/terms.pdf',
        env: { PLATFORM_BUCKET: bucket },
      })
    );
    expect(res?.status).toBe(200);
    expect(res?.headers.get('content-type')).toBe('application/pdf');
  });

  it('resolves env-suffixed host variants (cdn-assets-preview)', async () => {
    const bucket = fakeBucket({
      'a.png': fakeObject({ body: 'X', contentType: 'image/png' }),
    });
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-assets-preview.revelations.studio',
        path: '/a.png',
        env: { ASSETS_BUCKET: bucket },
      })
    );
    expect(res?.status).toBe(200);
  });

  it('returns 404 for a missing key', async () => {
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-assets.revelations.studio',
        path: '/missing.webp',
        env: { ASSETS_BUCKET: fakeBucket({}) },
      })
    );
    expect(res?.status).toBe(404);
  });

  it('returns 304 when If-None-Match matches the stored etag', async () => {
    const bucket = fakeBucket({
      'logo.webp': fakeObject({
        body: 'IMG',
        etag: 'v1',
        contentType: 'image/webp',
      }),
    });
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-assets.revelations.studio',
        path: '/logo.webp',
        headers: { 'if-none-match': '"v1"' },
        env: { ASSETS_BUCKET: bucket },
      })
    );
    expect(res?.status).toBe(304);
    expect(await res?.text()).toBe('');
  });

  it('serves HEAD with metadata and no body', async () => {
    const bucket = fakeBucket({
      'logo.webp': fakeObject({
        body: 'IMG',
        size: 3,
        contentType: 'image/webp',
      }),
    });
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-assets.revelations.studio',
        path: '/logo.webp',
        method: 'HEAD',
        env: { ASSETS_BUCKET: bucket },
      })
    );
    expect(res?.status).toBe(200);
    expect(res?.headers.get('content-length')).toBe('3');
    expect(await res?.text()).toBe('');
  });

  it('rejects non-GET/HEAD methods with 405', async () => {
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-assets.revelations.studio',
        path: '/logo.webp',
        method: 'POST',
        env: { ASSETS_BUCKET: fakeBucket({}) },
      })
    );
    expect(res?.status).toBe(405);
  });
});
