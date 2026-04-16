/**
 * dev-cdn — Local Cloudflare CDN + S3-compatible R2 proxy for development.
 *
 * Two interfaces to the same Miniflare R2 storage:
 *
 * 1. CDN interface (existing) — serves objects for the browser/VideoPlayer:
 *      GET /{key}           → tries ASSETS_BUCKET, then MEDIA_BUCKET
 *      PUT /media/{key}     → MEDIA_BUCKET
 *      PUT /assets/{key}    → ASSETS_BUCKET
 *
 * 2. S3-compatible interface — allows the RunPod Docker container (boto3)
 *    to read/write Miniflare R2 without any code changes:
 *      GET  /{bucket}/{key}  → resolves bucket by name, returns object
 *      PUT  /{bucket}/{key}  → resolves bucket by name, stores object
 *      HEAD /{bucket}/{key}  → resolves bucket by name, returns metadata
 *
 *    boto3 config: endpoint_url="http://localhost:4100"
 *    SigV4 auth headers are accepted and ignored (local dev only).
 *
 * The two interfaces coexist by checking whether the first path segment
 * matches a known bucket name. If it does → S3 mode. Otherwise → CDN mode.
 *
 * THIS WORKER IS NEVER DEPLOYED. It has no `routes` in wrangler.jsonc.
 */

interface Env {
  ASSETS_BUCKET: R2Bucket;
  MEDIA_BUCKET: R2Bucket;
}

/**
 * Map of bucket names (as used in wrangler.jsonc preview_bucket_name and by
 * the Python handler's R2_BUCKET_NAME / ASSETS_BUCKET_NAME env vars) to
 * their R2 binding key in the Env interface.
 *
 * Both production and dev/test names are mapped so the same worker handles
 * either configuration without changes.
 */
const BUCKET_MAP: Record<
  string,
  keyof Pick<Env, 'MEDIA_BUCKET' | 'ASSETS_BUCKET'>
> = {
  // Dev/test names (preview_bucket_name in wrangler.jsonc)
  'codex-media-test': 'MEDIA_BUCKET',
  'codex-assets-test': 'ASSETS_BUCKET',
  // Production names (bucket_name in wrangler.jsonc)
  'codex-media-production': 'MEDIA_BUCKET',
  'codex-assets-production': 'ASSETS_BUCKET',
  // Short aliases for convenience
  media: 'MEDIA_BUCKET',
  assets: 'ASSETS_BUCKET',
};

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': '*',
};

/**
 * Try to resolve the first path segment as a known bucket name.
 * Returns the bucket binding and the remaining key, or null if not a bucket path.
 */
function resolveS3Path(
  pathname: string,
  env: Env
): { bucket: R2Bucket; key: string } | null {
  // pathname starts with / — split into segments: ['', bucketName, ...keyParts]
  const firstSlash = pathname.indexOf('/', 1);
  if (firstSlash === -1) return null;

  const bucketName = pathname.slice(1, firstSlash);
  const bindingKey = BUCKET_MAP[bucketName];
  if (!bindingKey) return null;

  const key = pathname.slice(firstSlash + 1);
  if (!key) return null;

  return { bucket: env[bindingKey], key };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight — accept everything (local dev only)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // ─────────────────────────────────────────────────────────────────────
    // S3-compatible interface: first path segment is a known bucket name
    // e.g. GET /codex-media-test/{creatorId}/originals/{mediaId}/media.mp4
    // ─────────────────────────────────────────────────────────────────────
    const s3Route = resolveS3Path(url.pathname, env);
    if (s3Route) {
      return handleS3Request(request, s3Route.bucket, s3Route.key);
    }

    // ─────────────────────────────────────────────────────────────────────
    // CDN interface: prefix-routed uploads (/media/*, /assets/*)
    // ─────────────────────────────────────────────────────────────────────
    if (request.method === 'PUT') {
      return handleCdnPut(url.pathname, request, env);
    }

    if (request.method === 'DELETE') {
      return handleCdnDelete(url.pathname, env);
    }

    // ─────────────────────────────────────────────────────────────────────
    // CDN interface: serve objects (GET / HEAD)
    // ─────────────────────────────────────────────────────────────────────
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const key = url.pathname.slice(1); // strip leading /
    if (!key) return new Response('Not Found', { status: 404 });

    // Try ASSETS_BUCKET first (avatars, logos, thumbnails), then MEDIA_BUCKET
    for (const bucket of [env.ASSETS_BUCKET, env.MEDIA_BUCKET]) {
      const object = await bucket.get(key);
      if (object) {
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('cache-control', 'public, max-age=3600');
        headers.set('access-control-allow-origin', '*');
        return new Response(object.body, { headers });
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// S3-compatible handlers (for boto3 / the RunPod container)
// ═══════════════════════════════════════════════════════════════════════════

async function handleS3Request(
  request: Request,
  bucket: R2Bucket,
  key: string
): Promise<Response> {
  switch (request.method) {
    case 'GET':
      return handleS3Get(bucket, key);
    case 'HEAD':
      return handleS3Head(bucket, key);
    case 'PUT':
      return handleS3Put(request, bucket, key);
    case 'DELETE':
      return handleS3Delete(bucket, key);
    default:
      return new Response('Method Not Allowed', { status: 405 });
  }
}

/** S3 GetObject — returns the object body with metadata headers */
async function handleS3Get(bucket: R2Bucket, key: string): Promise<Response> {
  const object = await bucket.get(key);
  if (!object) {
    return s3Error(
      'NoSuchKey',
      `The specified key does not exist: ${key}`,
      404
    );
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('content-length', String(object.size));
  headers.set('accept-ranges', 'bytes');
  headers.set('access-control-allow-origin', '*');

  return new Response(object.body, { status: 200, headers });
}

/** S3 HeadObject — returns metadata without body */
async function handleS3Head(bucket: R2Bucket, key: string): Promise<Response> {
  const object = await bucket.head(key);
  if (!object) {
    return s3Error(
      'NoSuchKey',
      `The specified key does not exist: ${key}`,
      404
    );
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('content-length', String(object.size));
  headers.set('accept-ranges', 'bytes');
  headers.set('access-control-allow-origin', '*');

  return new Response(null, { status: 200, headers });
}

/** S3 PutObject — stores the request body */
async function handleS3Put(
  request: Request,
  bucket: R2Bucket,
  key: string
): Promise<Response> {
  const contentType =
    request.headers.get('content-type') ?? 'application/octet-stream';
  const body = await request.arrayBuffer();

  await bucket.put(key, body, {
    httpMetadata: { contentType },
  });

  const headers = new Headers(CORS_HEADERS);
  headers.set('etag', `"${key}"`);

  return new Response(null, { status: 200, headers });
}

/** S3 DeleteObject */
async function handleS3Delete(
  bucket: R2Bucket,
  key: string
): Promise<Response> {
  await bucket.delete(key);
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Return an S3-style XML error response.
 * boto3 parses these to raise meaningful exceptions.
 */
function s3Error(code: string, message: string, status: number): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>${code}</Code>
  <Message>${message}</Message>
</Error>`;

  return new Response(xml, {
    status,
    headers: {
      'content-type': 'application/xml',
      ...CORS_HEADERS,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// CDN prefix-routed handlers (for frontend / local runner HTTP uploads)
// ═══════════════════════════════════════════════════════════════════════════

function resolveCdnRoute(
  pathname: string,
  env: Env
): { bucket: R2Bucket; key: string } | null {
  if (pathname.startsWith('/media/')) {
    return { bucket: env.MEDIA_BUCKET, key: pathname.slice('/media/'.length) };
  }
  if (pathname.startsWith('/assets/')) {
    return {
      bucket: env.ASSETS_BUCKET,
      key: pathname.slice('/assets/'.length),
    };
  }
  return null;
}

async function handleCdnPut(
  pathname: string,
  request: Request,
  env: Env
): Promise<Response> {
  const route = resolveCdnRoute(pathname, env);
  if (!route || !route.key) {
    return new Response('PUT requires /media/{key} or /assets/{key} path', {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  const contentType =
    request.headers.get('content-type') ?? 'application/octet-stream';
  const body = await request.arrayBuffer();

  await route.bucket.put(route.key, body, {
    httpMetadata: { contentType },
  });

  return new Response('OK', { status: 200, headers: CORS_HEADERS });
}

async function handleCdnDelete(pathname: string, env: Env): Promise<Response> {
  const route = resolveCdnRoute(pathname, env);
  if (!route || !route.key) {
    return new Response('DELETE requires /media/{key} or /assets/{key} path', {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  await route.bucket.delete(route.key);
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
