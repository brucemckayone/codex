# @codex/cloudflare-clients

S3-compatible R2 and KV clients. `R2Service` (Workers) and `R2SigningClient` (Node/Test).

## R2Service
Wraps `R2Bucket` binding. Auto-retries (429/5xx).
- **put(key, body, meta, httpMeta)**: Upload.
- **putJson(key, obj)**: Upload JSON.
- **get(key)**: Retrieve. Returns null if 404.
- **delete(key)**: Delete.
- **list(opts)**: Pagination/prefix support.
- **createMultipartUpload/resume...**: Large files.
- **generateSignedUrl(key, expiry)**: AWS SigV4 signed URL.

## R2SigningClient
Standalone signing (no binding needed). Uses AWS SDK.
- **generateSignedUrl**: For tests/scripts.
- **objectExists**: Check existence.
- **Factory**: `createR2SigningClientFromEnv()`.

## KV
Placeholder `KVClient` (future).

## Config
- **Env**: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_MEDIA`.
- **Retry**: Exp backoff + jitter.

## Example
```ts
const r2 = new R2Service(env.BUCKET, {}, signingConfig);
const url = await r2.generateSignedUrl('key', 3600);
await r2.putJson('meta.json', { data: 1 });
```

## Standards
- **Assert**: Use `invariant()` for internal consistency.
- **Types**: Strict TS. Single Source of Truth.
- **Pure**: No side-effects or business logic.
