# @codex/cloudflare-clients

S3-compatible R2 client and KV utilities for Cloudflare Workers.

## R2Service

Wraps Cloudflare `R2Bucket` binding with retry logic and signed URL generation.

| Method | Purpose | Notes |
|---|---|---|
| `put(key, body, meta?, httpMeta?)` | Upload object | Sets Content-Type, Cache-Control |
| `putJson(key, obj)` | Upload JSON object | Auto-serializes, sets Content-Type |
| `get(key)` | Retrieve object | Returns null if 404 |
| `delete(key)` | Delete object | |
| `list(options?)` | List objects | Pagination, prefix filtering |
| `createMultipartUpload(key)` | Start multipart upload | For large files |
| `resumeMultipartUpload(key, uploadId)` | Resume multipart | |
| `generateSignedUrl(key, expirySeconds)` | AWS SigV4 signed URL | For client-side streaming |

**Retry**: Automatic exponential backoff + jitter on 429/5xx responses.

## R2SigningClient

Standalone signing client — no R2Bucket binding needed. Uses AWS SDK directly.

| Method | Purpose |
|---|---|
| `generateSignedUrl(key, expirySeconds)` | For tests/scripts outside Workers |
| `objectExists(key)` | Check if object exists in R2 |

**Factory**: `createR2SigningClientFromEnv()` — reads `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` from env.

## KV Utilities

KV is actively used across the platform for:
- **Session caching** (`AUTH_SESSION_KV`) — 5min TTL session cache
- **Rate limiting** — per-IP request counting
- **Cache versioning** (`CACHE_KV`) — entity/collection version tracking
- **BetterAuth secondary storage** — KV adapter for auth sessions

> Note: KV operations are handled directly via Cloudflare's `KVNamespace` binding in each package that needs it. This package provides R2 wrappers; KV patterns are documented in `@codex/security` (rate limiting, sessions) and `@codex/cache` (version cache).

## Environment Variables
| Variable | Purpose |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 API key ID |
| `R2_SECRET_ACCESS_KEY` | R2 API secret |
| `R2_BUCKET_MEDIA` | Media bucket name |

## Strict Rules

- **MUST** use `R2Service` wrapper for all R2 operations — NEVER use raw R2Bucket binding directly (misses retry logic)
- **MUST** set appropriate Cache-Control headers when uploading:
  - Immutable content (images, media): `public, max-age=31536000, immutable`
  - Mutable content (SVG logos): `public, max-age=3600`
- **MUST** use `generateSignedUrl()` for client-facing URLs — NEVER expose raw R2 keys
- **NEVER** expose R2 credentials in responses or logs

## Integration

- **Depends on**: Cloudflare Workers SDK, AWS SDK (for signing)
- **Used by**: `@codex/content`, `@codex/access`, `@codex/image-processing`, `@codex/platform-settings`

## Reference Files

- `packages/cloudflare-clients/src/r2/services/r2-service.ts` — R2Service
- `packages/cloudflare-clients/src/r2/services/r2-signing-client.ts` — R2SigningClient
- `packages/cloudflare-clients/src/cache/client.ts` — cache utilities
