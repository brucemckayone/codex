import { CACHE_PRESETS } from '@codex/constants';
import { describe, expect, it } from 'vitest';
import worker from './index';

/**
 * Codex-uome8: the CDN GET path must FILL Cache-Control only when the stored
 * object carries none, exactly like the production proxy
 * (apps/web/src/lib/server/cdn-proxy.ts). Before the fix it overwrote a stored
 * value, so a stored must-revalidate was invisible in local dev.
 */

const BYTES = new TextEncoder().encode('hello');

/** Minimal R2ObjectBody stand-in: only what objectResponse reads. */
function fakeObject(storedCacheControl?: string): R2ObjectBody {
  return {
    size: BYTES.byteLength,
    httpEtag: '"etag-1"',
    body: new Response(BYTES).body,
    writeHttpMetadata(headers: Headers) {
      headers.set('content-type', 'image/webp');
      if (storedCacheControl) headers.set('cache-control', storedCacheControl);
    },
  } as unknown as R2ObjectBody;
}

function envWith(object: R2ObjectBody | null) {
  const hit = { get: async () => object } as unknown as R2Bucket;
  const miss = { get: async () => null } as unknown as R2Bucket;
  return { ASSETS_BUCKET: hit, MEDIA_BUCKET: miss } as unknown as Parameters<
    typeof worker.fetch
  >[1];
}

async function get(object: R2ObjectBody, method = 'GET') {
  return worker.fetch(
    new Request('http://localhost/org/logo/md.webp', { method }),
    envWith(object)
  );
}

describe('dev-cdn CDN GET Cache-Control', () => {
  it('keeps a Cache-Control stored on the object', async () => {
    const stored = 'public, max-age=0, must-revalidate';
    const res = await get(fakeObject(stored));

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(stored);
  });

  it('keeps a stored Cache-Control on HEAD too', async () => {
    const stored = 'no-store';
    const res = await get(fakeObject(stored), 'HEAD');

    expect(res.headers.get('cache-control')).toBe(stored);
  });

  it('fills the shared asset preset when the object stores none', async () => {
    const res = await get(fakeObject());

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(CACHE_PRESETS.asset);
  });
});
