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
 */
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

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
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

/** Build response headers from an R2 object (metadata + CORS + cache). */
function buildAssetHeaders(object: R2Object): Headers {
  const headers = new Headers(CORS_HEADERS);
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  // Worker-served path bypasses the R2 custom-domain cache rule, so set a sane
  // public cache policy here (browser 1h, edge 1d). Public assets only.
  if (!headers.has('cache-control')) {
    headers.set('cache-control', 'public, max-age=3600, s-maxage=86400');
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

  // Binding absent in this environment (e.g. dev, which has no shadowing
  // wildcard) → let the real R2 custom domain handle it.
  const bucket = event.platform?.env?.[binding] as R2Bucket | undefined;
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

  if (method === 'HEAD') {
    const object = await bucket.head(key);
    if (!object) {
      return new Response(null, { status: 404, headers: CORS_HEADERS });
    }
    const headers = buildAssetHeaders(object);
    headers.set('content-length', String(object.size));
    return new Response(null, { status: 200, headers });
  }

  // GET — forward conditional headers (If-None-Match / If-Modified-Since) to R2
  // via `onlyIf` so a matching client cache yields a metadata-only 304.
  const object = await bucket.get(key, { onlyIf: event.request.headers });
  if (!object) {
    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  }

  const headers = buildAssetHeaders(object);

  // Precondition failed (etag matched): R2 returns metadata only, no body.
  if (!('body' in object)) {
    return new Response(null, { status: 304, headers });
  }

  headers.set('content-length', String(object.size));
  return new Response(object.body, { status: 200, headers });
}
