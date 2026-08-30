/**
 * Public CDN asset proxy (WP-2 · Codex-fc5oh.2).
 *
 * Cloudflare Worker routes take precedence over R2 custom domains on the same
 * hostname (documented behaviour). The web app's `*.revelations.studio/*`
 * production route therefore shadows the R2 custom domains
 * `cdn-assets.revelations.studio` and `cdn-platform.revelations.studio` — every
 * request for a thumbnail/logo/branding asset hits this worker and 500s in
 * SvelteKit instead of being served by R2. (Local dev has no wildcard route, so
 * the R2 custom domain serves directly — which is why it "worked locally".)
 *
 * Fix (approach B): when a request arrives for one of the PUBLIC CDN hosts,
 * serve the object straight from the bound R2 bucket — the worker acts as the
 * R2 origin. The wildcard route stays intact for org subdomains.
 *
 * SECURITY: only the PUBLIC buckets are proxied here. `cdn-media` and
 * `cdn-resources` are `publicAccess: false` in r2-infrastructure.json — they are
 * gated behind presigned-URL signatures. Serving those through a raw
 * `bucket.get(key)` binding would bypass signature verification and expose gated
 * content to anyone who guesses a key, so they are deliberately NOT handled here
 * and fall through to normal request handling.
 *
 * ONE NARROW EXCEPTION, added deliberately and gated hard (Codex-1g5lh.13):
 * the 30-second HLS PREVIEW clip. It is public by product design — it is what
 * an unauthenticated visitor watches to decide whether to buy — but RunPod
 * writes it into the PRIVATE media bucket along with the paid stream, because
 * it uploads the whole `hls_dir` in one call
 * (infrastructure/runpod/handler/main.py:1282-1290). Nothing bound to this
 * public host could serve it, so `ASSETS_BUCKET.get(previewKey)` returned null
 * and every hover/autoplay preview on every org landing page and Explore rail
 * 404'd on its manifest while its poster loaded fine — a play affordance that
 * does nothing, with no CSP violation to explain it. See
 * `isPublicMediaPreviewKey` below for the exact allowlist and what it excludes.
 */
import { CACHE_PRESETS } from '@codex/constants';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Public R2-backed CDN host prefix → the `platform.env` binding that serves it.
 * Matched against the first DNS label, so it covers the production host
 * (`cdn-assets`) and any env-suffixed variant (`cdn-assets-preview`, …).
 */
const PUBLIC_CDN_BINDINGS = {
  'cdn-assets': 'ASSETS_BUCKET',
  'cdn-platform': 'PLATFORM_BUCKET',
} as const satisfies Record<string, 'ASSETS_BUCKET' | 'PLATFORM_BUCKET'>;

type CdnBinding =
  (typeof PUBLIC_CDN_BINDINGS)[keyof typeof PUBLIC_CDN_BINDINGS];

/**
 * `platform.env` as this module reads it.
 *
 * `MEDIA_PREVIEW_BUCKET` is a read-only-BY-CONVENTION binding to the
 * otherwise-private media bucket, present only in environments whose wildcard
 * route shadows the assets host.
 *
 * "By convention" is the honest wording and the earlier "READ-ONLY" was not:
 * wrangler has no read-only mode for an R2 binding, so this handle also carries
 * `put()` and `delete()` over a bucket holding every creator original and every
 * paid rendition. This module calls only `.head()` and `.get()` — keep it that
 * way, and treat any new call as a security change rather than a feature.
 *
 * THE GATE BELOW HARDCODES A LAYOUT ANOTHER PACKAGE OWNS. `@codex/transcoding`
 * writes these keys (`packages/transcoding/src/paths.ts`), and apps/web does
 * not depend on it, so the prefix here is a RESTATEMENT that cannot be
 * type-checked against its source. The reciprocal pin lives in that package's
 * `__tests__/paths.test.ts` ("pinned against the public CDN gate"), which fails
 * if the layout moves. If you change either side, change both. It is declared here rather than in `app.d.ts` only because this branch
 * does not own that file — the canonical declaration belongs alongside
 * `ASSETS_BUCKET` / `PLATFORM_BUCKET` in `apps/web/src/app.d.ts`.
 */
type CdnEnv = NonNullable<NonNullable<RequestEvent['platform']>['env']> & {
  MEDIA_PREVIEW_BUCKET?: R2Bucket;
};

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  // `Range` is CORS-safelisted in current browsers, so a byte-range media
  // request does not preflight — but naming it here keeps an older or stricter
  // client's preflight from failing on the one asset class that needs Range.
  'access-control-allow-headers': 'range, if-none-match, if-modified-since',
};

/**
 * Resolve a hostname to a public-CDN bucket binding, or null when the host is
 * not a public CDN host (including the gated `cdn-media`/`cdn-resources`).
 */
function resolveCdnBinding(hostname: string): CdnBinding | null {
  const firstLabel = hostname.split('.')[0];
  for (const [prefix, binding] of Object.entries(PUBLIC_CDN_BINDINGS)) {
    if (firstLabel === prefix || firstLabel.startsWith(`${prefix}-`)) {
      return binding;
    }
  }
  return null;
}

/**
 * The ONLY media-bucket keys this public host may serve: the 30-second preview
 * clip's own directory, `{creatorId}/hls/{mediaId}/preview/…`
 * (`getHlsPreviewKey`, packages/transcoding/src/paths.ts:150-152).
 *
 * WHY THE WHOLE DIRECTORY AND NOT JUST `preview.m3u8`: the preview is built
 * with `-hls_flags single_file` (infrastructure/runpod/handler/main.py
 * `_build_preview_cmd`), so the directory holds exactly two objects —
 * `preview.m3u8` and the `stream.ts` its `EXT-X-BYTERANGE` entries point at.
 * Serving the manifest without the segment gives a manifest that loads and a
 * clip that still does not play.
 *
 * DELIBERATELY EXCLUDED — a reviewer must reject any widening of this test:
 *   `{creatorId}/hls/{mediaId}/master.m3u8`       the gated master playlist
 *   `{creatorId}/hls/{mediaId}/720p/index.m3u8`   every variant playlist
 *   `{creatorId}/hls/{mediaId}/720p/segment_*.ts` every full-length segment
 *   `{creatorId}/originals/{mediaId}/video.mp4`   the source upload
 * Those are the presigned-URL-gated paid streams (`publicAccess: false` in
 * .github/config/r2-infrastructure.json). A blanket "try the media bucket too"
 * fallback — which is what workers/dev-cdn does, and why this defect never
 * showed up locally — would turn this host into an unsigned reader for the
 * entire paid catalogue.
 *
 * `..` is rejected explicitly. R2 keys are opaque strings and R2 does not
 * normalise them, and `new URL()` already collapses dot segments in a
 * pathname, so a traversal out of the prefix is not reachable today; the check
 * is here so that stays true if a caller ever hands this a key it built itself.
 */
export function isPublicMediaPreviewKey(key: string): boolean {
  if (key.split('/').includes('..')) return false;
  return /^[^/]+\/hls\/[^/]+\/preview\//.test(key);
}

// ───────────────────────────────────────────────────────────────────────────
// HTTP Range support
//
// REQUIRED for the preview above, not a nicety: hls.js (and Safari's native
// player) fetch ONE `stream.ts` with `Range: bytes=…` per `EXT-X-BYTERANGE`
// entry. A server that ignores Range and answers 200 with the whole file hands
// back bytes from offset 0 for every segment, so playback dies after the first
// one. workers/dev-cdn learned this locally (Codex-bpjg5) and this proxy — which
// shadows the R2 custom domain and therefore replaces R2's own Range handling —
// never did. Real R2 honours Range, so honouring it here also makes the
// shadowed host behave like the origin it stands in for.
// ───────────────────────────────────────────────────────────────────────────

type RangeIntent =
  | { kind: 'range'; start: number; end: number | null }
  | { kind: 'suffix'; suffix: number };

/**
 * Parse a single-range HTTP Range header (`bytes=start-end` / `bytes=start-` /
 * `bytes=-suffix`). Anything else — a multi-range request, a non-`bytes` unit,
 * garbage — yields null, and the caller then serves the full object with 200,
 * which is the spec's sanctioned response to an unsatisfiable/ignored Range.
 */
function parseRangeHeader(header: string | null): RangeIntent | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (startStr === '' && endStr === '') return null;
  if (startStr === '') {
    const suffix = Number(endStr);
    return suffix > 0 ? { kind: 'suffix', suffix } : null;
  }
  const start = Number(startStr);
  const end = endStr === '' ? null : Number(endStr);
  if (end !== null && end < start) return null;
  return { kind: 'range', start, end };
}

/** Translate a parsed Range intent into R2's native range option. */
function toR2Range(intent: RangeIntent): R2Range {
  if (intent.kind === 'suffix') return { suffix: intent.suffix };
  return intent.end === null
    ? { offset: intent.start }
    : { offset: intent.start, length: intent.end - intent.start + 1 };
}

/** Resolve the served [start,end] byte bounds, clamped to the object size. */
function servedBounds(
  intent: RangeIntent,
  size: number
): { start: number; end: number } {
  if (intent.kind === 'suffix') {
    return { start: Math.max(0, size - intent.suffix), end: size - 1 };
  }
  const end = intent.end === null ? size - 1 : Math.min(intent.end, size - 1);
  return { start: intent.start, end };
}

/** Build response headers from an R2 object (metadata + CORS + cache). */
function buildAssetHeaders(object: R2Object): Headers {
  const headers = new Headers(CORS_HEADERS);
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  // Worker-served path bypasses the R2 custom-domain cache rule, so set a
  // public cache policy here (browser 1h, edge 1d). Public assets only.
  //
  // `CACHE_PRESETS.asset`, byte-identical to the value this line used to write
  // out. It used to say the value was deliberately outside the vocabulary
  // because it "has to keep matching r2-infrastructure.json rather than a
  // preset" — that coupling now lives ON the preset, which records the
  // buckets' own `edgeTtl: 86400` / `browserTtl: 3600` and the R2-egress
  // reasoning behind the 24x asymmetry. One decision, one place, and dev-cdn
  // reads the same one.
  if (!headers.has('cache-control')) {
    headers.set('cache-control', CACHE_PRESETS.asset);
  }
  return headers;
}

/**
 * If this request targets a public CDN host whose bucket is bound, serve the
 * object from R2 and return a Response. Otherwise return null so the caller
 * proceeds with normal SvelteKit handling.
 */
export async function tryServeCdnAsset(
  event: Pick<RequestEvent, 'url' | 'request' | 'platform'>
): Promise<Response | null> {
  const binding = resolveCdnBinding(event.url.hostname);
  if (!binding) return null;

  const env = event.platform?.env as CdnEnv | undefined;

  // Binding absent in this environment (e.g. dev, which has no shadowing
  // wildcard) → let the real R2 custom domain handle it.
  const bucket = env?.[binding] as R2Bucket | undefined;
  if (!bucket) return null;

  const { method } = event.request;

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  // R2 keys are the pathname without the leading slash, URL-decoded.
  const key = decodeURIComponent(event.url.pathname.slice(1));
  if (!key) {
    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  }

  // Second-chance bucket, consulted ONLY after the public bucket misses and
  // ONLY for the public-preview prefix. Resolved to `undefined` for every other
  // key, so there is no code path on which a gated stream reaches the media
  // binding — the gate is applied here, once, before any lookup.
  const previewBucket = isPublicMediaPreviewKey(key)
    ? env?.MEDIA_PREVIEW_BUCKET
    : undefined;

  if (method === 'HEAD') {
    const object =
      (await bucket.head(key)) ??
      (previewBucket ? await previewBucket.head(key) : null);
    if (!object) {
      return new Response(null, { status: 404, headers: CORS_HEADERS });
    }
    const headers = buildAssetHeaders(object);
    headers.set('content-length', String(object.size));
    return new Response(null, { status: 200, headers });
  }

  // GET — forward conditional headers (If-None-Match / If-Modified-Since) to R2
  // via `onlyIf` so a matching client cache yields a metadata-only 304, and the
  // parsed Range via `range` so byte-range media plays (see above).
  const range = parseRangeHeader(event.request.headers.get('range'));
  const options: R2GetOptions = { onlyIf: event.request.headers };
  if (range) options.range = toR2Range(range);

  const object =
    (await bucket.get(key, options)) ??
    (previewBucket ? await previewBucket.get(key, options) : null);
  if (!object) {
    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  }

  const headers = buildAssetHeaders(object);

  // Precondition failed (etag matched): R2 returns metadata only, no body.
  if (!('body' in object)) {
    return new Response(null, { status: 304, headers });
  }

  if (range) {
    // `object.size` is the FULL object size even on a ranged get, so the served
    // bounds come from the request intent clamped to it.
    const { start, end } = servedBounds(range, object.size);
    headers.set('content-range', `bytes ${start}-${end}/${object.size}`);
    headers.set('content-length', String(end - start + 1));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set('content-length', String(object.size));
  return new Response(object.body, { status: 200, headers });
}
