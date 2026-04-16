# @codex/cloudflare-clients

S3-compatible R2 client, standalone signing client, and Cloudflare CDN cache purge client.

## R2Service

Wraps `R2Bucket` binding with retry logic and optional presigned URL generation.

**Constructor**: `new R2Service(bucket: R2Bucket, opts?: R2Opts, signingConfig?: R2SigningConfig)`

- `signingConfig` is required only for presigned URL methods. Omit it for pure put/get/delete operations.
- Retries: automatic exponential backoff + jitter on 429/5xx.

| Method | Signature | Notes |
|---|---|---|
| `put(key, body, metadata?, httpMeta?)` | Upload object | `metadata` = custom metadata, `httpMeta` = `{ contentType, cacheControl, ... }` |
| `putJson(key, obj, metadata?)` | Upload JSON | Auto-sets `Content-Type: application/json` |
| `get(key)` | Retrieve object | Returns `R2ObjectBody \| null` |
| `delete(key)` | Delete object | |
| `list(options?)` | List objects | Supports prefix, cursor, limit |
| `createMultipartUpload(key, options?)` | Start multipart upload | For large files |
| `resumeMultipartUpload(key, uploadId)` | Resume multipart | |
| `generateSignedUrl(key, expirySeconds)` | Presigned GET URL | Requires `signingConfig` in constructor |
| `generateSignedUploadUrl(key, contentType, expirySeconds?)` | Presigned PUT URL | Requires `signingConfig`; default 3600s |

```ts
// Basic usage (no signing needed)
const r2 = new R2Service(env.MEDIA_BUCKET);
await r2.put('images/logo.png', buffer, {}, { contentType: 'image/png', cacheControl: 'public, max-age=31536000' });

// With signing (for presigned URLs)
const r2 = new R2Service(env.MEDIA_BUCKET, {}, {
  accountId: env.R2_ACCOUNT_ID,
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  bucketName: env.R2_BUCKET_MEDIA,
});
const url = await r2.generateSignedUrl('hls/abc/master.m3u8', 3600);
```

In development, `signingConfig` is skipped and the dev-cdn proxy is used instead.

## R2SigningClient

Standalone client — no `R2Bucket` binding required. Use in integration tests, scripts, or environments outside the Workers runtime.

```ts
import { R2SigningClient, createR2SigningClientFromEnv } from '@codex/cloudflare-clients';

// From env vars (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_MEDIA)
const client = createR2SigningClientFromEnv();

// Or direct
const client = new R2SigningClient({ accountId, accessKeyId, secretAccessKey, bucketName });
const url = await client.generateSignedUrl('key', 3600);
const uploadUrl = await client.generateSignedUploadUrl('key', 'video/mp4');
const exists = await client.objectExists('key');
```

## CachePurgeClient

Purges Cloudflare CDN cached URLs via the API. Fire-and-forget — errors are logged, never thrown.

```ts
import { CachePurgeClient } from '@codex/cloudflare-clients';

const purge = CachePurgeClient.create(env.CF_ZONE_ID, env.CF_API_TOKEN);
await purge.purgeByUrls(['https://example.com/image.jpg']); // batches at 30 per call
await purge.purgeEverything(); // purge all
```

If `zoneId` or `apiToken` are missing, `CachePurgeClient.create()` returns a no-op stub.

## KV

The `kv` module currently exports a placeholder. KV operations are handled directly via `KVNamespace` bindings in each package — see `@codex/cache` for KV-backed caching patterns and `@codex/security` for session/rate-limit KV patterns.

## R2 Key Conventions

- Media files: `originals/{mediaId}/...`, `hls/{mediaId}/...`, `thumbnails/{mediaId}/...`
- Avatars: `{userId}/avatar/...`
- Org logos: `logos/{orgId}/logo.{ext}`
- Content thumbnails: `{creatorId}/thumbnails/{contentId}/...`

Key builders are in `@codex/transcoding` (`getContentThumbnailKey`, `getOrgLogoKey`, `getUserAvatarKey`).

## Strict Rules

- **MUST** use `R2Service` for all R2 operations in Workers — NEVER use raw `R2Bucket` directly (misses retry)
- **MUST** set `Cache-Control` on uploads: immutable content (images, media) = `public, max-age=31536000, immutable`; mutable logos = `public, max-age=3600`
- **MUST** use `generateSignedUrl()` for client-facing stream/download URLs
- **NEVER** expose `R2SigningConfig` credentials in responses or logs
- **NEVER** use `R2SigningClient` inside the Workers runtime — use `R2Service` with `signingConfig` instead

## Integration

- **Depends on**: Cloudflare Workers Types, AWS SDK (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`)
- **Used by**: `@codex/content`, `@codex/access`, `@codex/image-processing`, `@codex/platform-settings`, service-registry in `@codex/worker-utils`

## Reference Files

- `packages/cloudflare-clients/src/r2/services/r2-service.ts`
- `packages/cloudflare-clients/src/r2/services/r2-signing-client.ts`
- `packages/cloudflare-clients/src/cache/client.ts` — CachePurgeClient
