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
| `head(key)` | Object metadata, no body | Returns `R2Object \| null`; `uploaded` is when the key was last written |
| `delete(key)` | Delete object | |
| `list(options?)` | List objects | Supports prefix, cursor, limit |
| `createMultipartUpload(key, options?)` | Start multipart upload | For large files |
| `resumeMultipartUpload(key, uploadId)` | Resume multipart | |
| `generateSignedUrl(key, expirySeconds)` | Presigned GET URL | Requires `signingConfig` in constructor |
| `generateSignedUploadUrl(key, contentType, expirySeconds?)` | Presigned PUT URL | Requires `signingConfig`; default 3600s |

```ts
// Basic usage (no signing needed)
const r2 = new R2Service(env.MEDIA_BUCKET);
await r2.put('images/logo.png', buffer, {}, { contentType: 'image/png', cacheControl: R2_OVERWRITTEN_OBJECT_CACHE_CONTROL });

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

## Cache Purge

No cache-purge client exists in this package — the orphaned `src/cache/` subdir was removed in Codex-vwv5c (commit 5d9263a1). `CF_ZONE_ID`/`CF_API_TOKEN` in `@codex/shared-types` are vestigial.

## KV

The `kv` module currently exports a placeholder. KV operations are handled directly via `KVNamespace` bindings in each package — see `@codex/cache` for KV-backed caching patterns and `@codex/security` for session/rate-limit KV patterns.

## R2 Key Conventions

- Media files: `{creatorId}/originals/{mediaId}/...`, `{creatorId}/hls/{mediaId}/...`, `{creatorId}/thumbnails/{mediaId}/...` (all creator-scoped)
- Avatars: `avatars/{userId}/{size}.webp` (root-level `avatars/` folder, not per-user)
- Org logos: `logos/{orgId}/logo.{ext}`
- Content thumbnails: `{creatorId}/content-thumbnails/{contentId}/{size}.webp` (`thumbnails/` is auto-generated media thumbnails, keyed by mediaId)

Key builders are in `@codex/transcoding` (`getContentThumbnailKey`, `getOrgLogoKey`, `getUserAvatarKey`).

## Strict Rules

- **MUST** use `R2Service` for all R2 operations in Workers — NEVER use raw `R2Bucket` directly (misses retry)
- **MUST** set `cacheControl` on uploads from a NAMED CONSTANT, never a string written at the call site. The window is set by whether the KEY can be overwritten, not by what kind of file it is:
  - A key that is a pure function of an entity id — every image key in `@codex/image-processing`, and `logos/{orgId}/logo.{ext}` — is rewritten in place. Use **`R2_OVERWRITTEN_OBJECT_CACHE_CONTROL`** from `@codex/constants`, whose docblock carries the reasoning. `immutable` on such a key serves the REPLACED bytes until the window expires, with no purge path (Codex-p3rre; this rule used to prescribe `max-age=31536000, immutable` for "immutable content (images, media)", and that is what licensed the defect).
  - A year-long `immutable` window is available only to a key that encodes its own content — a content hash or a per-upload token in the key itself, so that new bytes are a new key. No key on this platform does that today, so there is no constant for it; add one, with its reasoning, next to the other in `packages/constants/src/limits.ts` if that ever changes.
  - These are R2 STORED-OBJECT metadata, deliberately NOT `CACHE_PRESETS` entries — those are per-request response policies indexed by viewer-variance, type-gated per auth level and read by the Hyperdrive selector. `scripts/checks/check-data-access-contract.mjs` RULE 3 draws the same line in its subject-exclusion (c).
- **MUST** use `generateSignedUrl()` for client-facing stream/download URLs
- **NEVER** expose `R2SigningConfig` credentials in responses or logs
- **NEVER** use `R2SigningClient` inside the Workers runtime — use `R2Service` with `signingConfig` instead

## Integration

- **Depends on**: Cloudflare Workers Types, AWS SDK (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`)
- **Used by**: `@codex/content`, `@codex/access`, `@codex/image-processing`, `@codex/platform-settings`, service-registry in `@codex/worker-utils`

## Reference Files

- `packages/cloudflare-clients/src/r2/services/r2-service.ts`
- `packages/cloudflare-clients/src/r2/services/r2-signing-client.ts`
- `packages/cloudflare-clients/src/kv/client.ts` — placeholder only (`kvPlaceholder`); no KV client implemented
