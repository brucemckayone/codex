# @codex/cloudflare-clients

Cloudflare service clients (R2, KV) for the Codex platform.

## Purpose

Infrastructure clients for Cloudflare services. Platform-specific, not business logic.

## Usage

```typescript
import { R2Client, KVClient } from '@codex/cloudflare-clients';

// Initialize R2 client
const r2 = new R2Client({
  accountId: env.R2_ACCOUNT_ID,
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
});

// Upload file
await r2.uploadFile('bucket-name', 'path/to/file.mp4', buffer);

// Generate signed URL
const url = await r2.getSignedUrl('bucket-name', 'path/to/file.mp4', 3600);

// KV operations
const kv = new KVClient(env.KV_NAMESPACE);
await kv.put('key', value, { ttl: 86400 });
const cached = await kv.get('key');
```

## Structure

- `src/r2/` - R2 client (upload, download, signed URLs)
- `src/kv/` - KV client (get, put, delete with TTL)
- `src/types/` - Common types
