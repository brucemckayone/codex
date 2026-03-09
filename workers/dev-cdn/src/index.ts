/**
 * dev-cdn — Local Cloudflare CDN replacement for development.
 *
 * Serves objects from ASSETS_BUCKET and MEDIA_BUCKET so that URLs
 * constructed as http://localhost:4100/... work identically to
 * the real CDN (https://cdn.revelations.studio/...) in production.
 *
 * THIS WORKER IS NEVER DEPLOYED. It has no `routes` in wrangler.jsonc.
 */

interface Env {
  ASSETS_BUCKET: R2Bucket;
  MEDIA_BUCKET: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const key = url.pathname.slice(1); // strip leading /

    if (!key) return new Response('Not Found', { status: 404 });

    // Try ASSETS_BUCKET first (avatars, logos, thumbnails), then MEDIA_BUCKET
    for (const bucket of [env.ASSETS_BUCKET, env.MEDIA_BUCKET]) {
      const object = await bucket.get(key);
      if (object) {
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('access-control-allow-origin', '*');
        return new Response(object.body, { headers });
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};
