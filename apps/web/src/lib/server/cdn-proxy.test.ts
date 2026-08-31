/**
 * Tests for the public CDN asset proxy (WP-2 · Codex-fc5oh.2).
 *
 * Locks down the contract that fixes platform-wide image 404s and the security
 * boundary that keeps gated buckets out:
 *   - public hosts (cdn-assets / cdn-platform) serve straight from R2;
 *   - the gated cdn-media / cdn-resources hosts are NEVER proxied;
 *   - non-CDN hosts and unbound environments fall through to SvelteKit;
 *   - conditional GETs yield 304, HEAD yields metadata, bad methods 405.
 *
 * And, from Codex-1g5lh.13, the ONE narrow widening of that boundary plus its
 * negative controls in both directions:
 *   - `{creatorId}/hls/{mediaId}/preview/…` falls through to the read-only
 *     media binding when the public bucket misses (that is the 30s preview);
 *   - `master.m3u8`, every variant playlist and every variant segment must
 *     STILL 404 with that binding present — they are the presigned-gated
 *     streams, and a fallback that served one would be a real vulnerability;
 *   - byte-range GETs answer 206, without which the single-file preview plays
 *     its first segment and stops.
 */
import { CACHE_PRESETS } from '@codex/constants';
import { describe, expect, it, vi } from 'vitest';
import { isPublicMediaPreviewKey, tryServeCdnAsset } from './cdn-proxy';

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
 *
 * `range` is honoured the way R2 does it too, and the detail matters: the
 * returned object's `body` is the SLICE while `size` stays the FULL object size.
 * A fake that shrank `size` would let a wrong Content-Range pass.
 */
function fakeBucket(store: Record<string, ReturnType<typeof fakeObject>>) {
  return {
    get: vi.fn(
      async (
        key: string,
        options?: { onlyIf?: Headers; range?: R2Range | Headers }
      ) => {
        const object = store[key];
        if (!object) return null;
        const ifNoneMatch = options?.onlyIf?.get?.('if-none-match');
        if (ifNoneMatch && ifNoneMatch === object.httpEtag) {
          const { body: _body, ...metadataOnly } = object;
          return metadataOnly;
        }
        const range = options?.range as
          | { offset?: number; length?: number; suffix?: number }
          | undefined;
        if (range && typeof object.body === 'string') {
          const size = object.body.length;
          const start =
            range.suffix === undefined
              ? (range.offset ?? 0)
              : Math.max(0, size - range.suffix);
          const end =
            range.suffix === undefined && range.length !== undefined
              ? start + range.length
              : size;
          return { ...object, body: object.body.slice(start, end) };
        }
        return object;
      }
    ),
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
    // Byte-exact against the shared preset: `toContain('public')` alone could
    // not tell a 60s window from a 24h one, and this response's whole point is
    // the long shared window.
    expect(res?.headers.get('cache-control')).toBe(CACHE_PRESETS.asset);
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

// ═══════════════════════════════════════════════════════════════════════════
// Codex-1g5lh.13 — the public 30s HLS preview
// ═══════════════════════════════════════════════════════════════════════════

const CREATOR = 'creator-1';
const MEDIA = 'media-1';
const PREVIEW_MANIFEST = `${CREATOR}/hls/${MEDIA}/preview/preview.m3u8`;
const PREVIEW_SEGMENT = `${CREATOR}/hls/${MEDIA}/preview/stream.ts`;
const GATED_MASTER = `${CREATOR}/hls/${MEDIA}/master.m3u8`;
const GATED_VARIANT = `${CREATOR}/hls/${MEDIA}/720p/index.m3u8`;
const GATED_SEGMENT = `${CREATOR}/hls/${MEDIA}/720p/segment_000.ts`;
const GATED_ORIGINAL = `${CREATOR}/originals/${MEDIA}/video.mp4`;

/** The media bucket as production really is: the whole HLS tree, one bucket. */
function fakeMediaBucket() {
  return fakeBucket({
    [PREVIEW_MANIFEST]: fakeObject({
      body: '#EXTM3U\n#EXT-X-BYTERANGE:1024@0\nstream.ts\n',
      contentType: 'application/vnd.apple.mpegurl',
    }),
    [PREVIEW_SEGMENT]: fakeObject({
      body: '0123456789',
      contentType: 'video/mp2t',
    }),
    [GATED_MASTER]: fakeObject({ body: 'PAID-MASTER' }),
    [GATED_VARIANT]: fakeObject({ body: 'PAID-VARIANT' }),
    [GATED_SEGMENT]: fakeObject({ body: 'PAID-SEGMENT' }),
    [GATED_ORIGINAL]: fakeObject({ body: 'PAID-ORIGINAL' }),
  });
}

describe('isPublicMediaPreviewKey — the allowlist itself', () => {
  it('admits the preview manifest and its single-file segment', () => {
    expect(isPublicMediaPreviewKey(PREVIEW_MANIFEST)).toBe(true);
    expect(isPublicMediaPreviewKey(PREVIEW_SEGMENT)).toBe(true);
  });

  it.each([
    ['master playlist', GATED_MASTER],
    ['variant playlist', GATED_VARIANT],
    ['variant segment', GATED_SEGMENT],
    ['source upload', GATED_ORIGINAL],
    // `preview` must be the media-id's own child, not any old path component.
    ['a "preview" folder one level too high', `${CREATOR}/preview/x.m3u8`],
    [
      'a "preview" folder one level too deep',
      `${CREATOR}/hls/${MEDIA}/a/preview/x`,
    ],
    ['a sibling named preview-ish', `${CREATOR}/hls/${MEDIA}/previews/x.ts`],
    ['a bare preview.m3u8 at the root', 'preview.m3u8'],
  ])('rejects the %s', (_label, key) => {
    expect(isPublicMediaPreviewKey(key)).toBe(false);
  });

  it('admits a REAL key shape taken from the dev database', () => {
    // Copied from media_items.hls_preview_key in the local dev DB: a 32-char
    // hex creator id and a v4 media uuid. Synthetic 'creator-1'/'media-1' ids
    // would not have caught a charset assumption.
    expect(
      isPublicMediaPreviewKey(
        'a62da3ad5c94736a88f90ff5c666143c/hls/39625c9a-ced0-46a9-8124-67443d65fb0e/preview/preview.m3u8'
      )
    ).toBe(true);
    // Its own master playlist, same media item, sits one level up and MUST NOT
    // pass. Verified live: both objects are in codex-media-test, and the assets
    // bucket holds neither.
    expect(
      isPublicMediaPreviewKey(
        'a62da3ad5c94736a88f90ff5c666143c/hls/39625c9a-ced0-46a9-8124-67443d65fb0e/master.m3u8'
      )
    ).toBe(false);
  });

  it('admits any segment filename under preview/, not just stream.ts', () => {
    // The RunPod handler emits `stream.ts` (single_file byte-ranges) while the
    // dev seeder emits `segment-000.ts`. Gating on the DIRECTORY rather than the
    // filename is what makes the fix work for both.
    expect(
      isPublicMediaPreviewKey(`${CREATOR}/hls/${MEDIA}/preview/stream.ts`)
    ).toBe(true);
    expect(
      isPublicMediaPreviewKey(`${CREATOR}/hls/${MEDIA}/preview/segment-000.ts`)
    ).toBe(true);
  });

  it('rejects a key with a `..` segment even under the preview prefix', () => {
    expect(
      isPublicMediaPreviewKey(`${CREATOR}/hls/${MEDIA}/preview/../master.m3u8`)
    ).toBe(false);
  });
});

describe('the media-preview fallback (media binding PRESENT)', () => {
  /** Production shape: assets host bound, plus the read-only media binding. */
  function env() {
    return {
      ASSETS_BUCKET: fakeBucket({
        'thumbnails/poster.webp': fakeObject({
          body: 'IMG',
          contentType: 'image/webp',
        }),
      }),
      MEDIA_PREVIEW_BUCKET: fakeMediaBucket(),
    };
  }

  it('serves the preview MANIFEST from the media binding after the assets miss', async () => {
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-assets.revelations.studio',
        path: `/${PREVIEW_MANIFEST}`,
        env: env(),
      })
    );
    expect(res?.status).toBe(200);
    expect(res?.headers.get('content-type')).toBe(
      'application/vnd.apple.mpegurl'
    );
    expect(await res?.text()).toContain('#EXTM3U');
  });

  it('serves the preview SEGMENT too — a manifest alone would not play', async () => {
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-assets.revelations.studio',
        path: `/${PREVIEW_SEGMENT}`,
        env: env(),
      })
    );
    expect(res?.status).toBe(200);
    expect(await res?.text()).toBe('0123456789');
  });

  // ── NEGATIVE CONTROLS. These are the whole safety argument. ──────────────
  it.each([
    ['master playlist', GATED_MASTER],
    ['variant playlist', GATED_VARIANT],
    ['variant segment', GATED_SEGMENT],
    ['source upload', GATED_ORIGINAL],
  ])('STILL 404s the %s with the media binding present (prefix gate holds)', async (_label, key) => {
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-assets.revelations.studio',
        path: `/${key}`,
        env: env(),
      })
    );
    expect(res?.status).toBe(404);
    expect(await res?.text()).not.toContain('PAID');
  });

  it('never even ASKS the media bucket for a gated key', async () => {
    const bound = env();
    await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-assets.revelations.studio',
        path: `/${GATED_MASTER}`,
        env: bound,
      })
    );
    // Stronger than the 404 above: the gate short-circuits before any lookup,
    // so an R2 bucket that later starts answering differently cannot leak.
    expect(bound.MEDIA_PREVIEW_BUCKET.get).not.toHaveBeenCalled();
    expect(bound.ASSETS_BUCKET.get).toHaveBeenCalledWith(
      GATED_MASTER,
      expect.anything()
    );
  });

  it('the ASSETS bucket still wins when it holds the key', async () => {
    const bound = env();
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-assets.revelations.studio',
        path: '/thumbnails/poster.webp',
        env: bound,
      })
    );
    expect(await res?.text()).toBe('IMG');
    expect(bound.MEDIA_PREVIEW_BUCKET.get).not.toHaveBeenCalled();
  });

  it('HEAD on the preview resolves through the fallback (the curl -sI check)', async () => {
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-assets.revelations.studio',
        path: `/${PREVIEW_MANIFEST}`,
        method: 'HEAD',
        env: env(),
      })
    );
    expect(res?.status).toBe(200);
    expect(res?.headers.get('content-type')).toBe(
      'application/vnd.apple.mpegurl'
    );
  });

  it('HEAD on a gated key STILL 404s', async () => {
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-assets.revelations.studio',
        path: `/${GATED_MASTER}`,
        method: 'HEAD',
        env: env(),
      })
    );
    expect(res?.status).toBe(404);
  });
});

describe('the media-preview fallback (media binding ABSENT)', () => {
  it('404s the preview when only ASSETS_BUCKET is bound — the pre-fix state', async () => {
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-assets.revelations.studio',
        path: `/${PREVIEW_MANIFEST}`,
        env: { ASSETS_BUCKET: fakeBucket({}) },
      })
    );
    // Documents the production failure this WP fixes, and proves the fallback
    // is the binding's doing rather than something the gate invented.
    expect(res?.status).toBe(404);
  });

  it('does NOT resolve a preview on the gated cdn-media host either', async () => {
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-media.revelations.studio',
        path: `/${PREVIEW_MANIFEST}`,
        env: {
          ASSETS_BUCKET: fakeBucket({}),
          MEDIA_PREVIEW_BUCKET: fakeMediaBucket(),
        },
      })
    );
    // The host allowlist is unchanged: cdn-media is still not proxied at all.
    expect(res).toBeNull();
  });
});

describe('byte-range GETs (single-file EXT-X-BYTERANGE playback)', () => {
  function env() {
    return {
      ASSETS_BUCKET: fakeBucket({}),
      MEDIA_PREVIEW_BUCKET: fakeMediaBucket(),
    };
  }

  it('answers 206 with the sliced body and a full-size Content-Range', async () => {
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-assets.revelations.studio',
        path: `/${PREVIEW_SEGMENT}`,
        headers: { range: 'bytes=2-5' },
        env: env(),
      })
    );
    expect(res?.status).toBe(206);
    expect(res?.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(res?.headers.get('content-length')).toBe('4');
    expect(await res?.text()).toBe('2345');
  });

  it('an open-ended range runs to the last byte', async () => {
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-assets.revelations.studio',
        path: `/${PREVIEW_SEGMENT}`,
        headers: { range: 'bytes=7-' },
        env: env(),
      })
    );
    expect(res?.status).toBe(206);
    expect(res?.headers.get('content-range')).toBe('bytes 7-9/10');
    expect(await res?.text()).toBe('789');
  });

  it('a suffix range reads from the end', async () => {
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-assets.revelations.studio',
        path: `/${PREVIEW_SEGMENT}`,
        headers: { range: 'bytes=-3' },
        env: env(),
      })
    );
    expect(res?.status).toBe(206);
    expect(res?.headers.get('content-range')).toBe('bytes 7-9/10');
    expect(await res?.text()).toBe('789');
  });

  it('an unparseable Range is ignored — full 200, never a bogus 206', async () => {
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-assets.revelations.studio',
        path: `/${PREVIEW_SEGMENT}`,
        headers: { range: 'bytes=0-1, 4-5' },
        env: env(),
      })
    );
    expect(res?.status).toBe(200);
    expect(res?.headers.get('content-range')).toBeNull();
    expect(await res?.text()).toBe('0123456789');
  });

  it('advertises accept-ranges on a plain 200 so a player knows to ask', async () => {
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-assets.revelations.studio',
        path: '/logo.webp',
        env: {
          ASSETS_BUCKET: fakeBucket({
            'logo.webp': fakeObject({ body: 'IMG', contentType: 'image/webp' }),
          }),
        },
      })
    );
    expect(res?.headers.get('accept-ranges')).toBe('bytes');
  });

  it('a Range does NOT unlock a gated key', async () => {
    const res = await tryServeCdnAsset(
      makeEvent({
        host: 'cdn-assets.revelations.studio',
        path: `/${GATED_SEGMENT}`,
        headers: { range: 'bytes=0-3' },
        env: env(),
      })
    );
    expect(res?.status).toBe(404);
  });
});
