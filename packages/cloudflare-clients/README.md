# @codex/cloudflare-clients

Framework-agnostic clients for Cloudflare services (R2 Object Storage and KV) used across the Codex platform.

## Overview

This package provides type-safe, reusable clients for interacting with Cloudflare's infrastructure services. It is designed to be consumed by both the SvelteKit application (`apps/web`) and Cloudflare Workers (`workers/*`), following the monorepo's shared package architecture.

**Key Principles:**
- **Framework-Agnostic**: Works in both SvelteKit and Cloudflare Workers environments
- **Type-Safe**: Full TypeScript support with Cloudflare Workers types
- **Reusable**: Single source of truth for Cloudflare service interactions
- **Testable**: Designed for easy mocking and testing with Vitest

## Installation

This package is part of the monorepo workspace. Import it using the package alias:

```typescript
import { R2Client, KVClient } from '@codex/cloudflare-clients';
```

## Package Structure

```
packages/cloudflare-clients/
├── src/
│   ├── r2/              # R2 object storage client
│   │   ├── client.ts    # R2Client implementation
│   │   ├── types.ts     # R2-specific types
│   │   └── index.ts     # Exports
│   ├── kv/              # KV store clients
│   │   ├── client.ts    # KVClient implementation
│   │   ├── types.ts     # KV-specific types
│   │   └── index.ts     # Exports
│   └── index.ts         # Main package exports
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## R2 Client (Planned)

### Purpose

The R2Client handles interactions with Cloudflare R2 object storage for:
- **Media Storage**: Original uploads and transcoded HLS streams
- **Resource Storage**: PDFs, workbooks, and downloadable files
- **Platform Assets**: Thumbnails, logos, and other media

### Architecture

The Codex platform uses a **unified bucket architecture** with per-creator folder organization:

**Bucket Structure:**
```
codex-media-production/
├── {creatorId}/
│   ├── originals/{mediaId}/original.mp4
│   ├── hls/{mediaId}/
│   │   ├── master.m3u8
│   │   ├── 1080p/playlist.m3u8
│   │   ├── 720p/playlist.m3u8
│   │   └── ...
│   └── audio/{mediaId}/audio.mp3
```

### Planned API

```typescript
import { R2Client } from '@codex/cloudflare-clients';

// Initialize client with AWS SDK credentials
const r2 = new R2Client({
  accountId: env.R2_ACCOUNT_ID,
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
});

// Upload a file
await r2.uploadFile({
  bucket: 'codex-media-production',
  key: `${creatorId}/originals/${mediaId}/original.mp4`,
  body: fileBuffer,
  contentType: 'video/mp4',
});

// Generate signed URL for secure access
const signedUrl = await r2.getSignedUrl({
  bucket: 'codex-media-production',
  key: `${creatorId}/hls/${mediaId}/master.m3u8`,
  expiresIn: 3600, // 1 hour
});

// Download a file
const file = await r2.downloadFile({
  bucket: 'codex-media-production',
  key: `${creatorId}/originals/${mediaId}/original.mp4`,
});

// Delete a file
await r2.deleteFile({
  bucket: 'codex-media-production',
  key: `${creatorId}/originals/${mediaId}/original.mp4`,
});

// Delete all files for a creator (prefix deletion)
await r2.deletePrefix({
  bucket: 'codex-media-production',
  prefix: `${creatorId}/`,
});

// List files in a bucket with prefix
const files = await r2.listFiles({
  bucket: 'codex-media-production',
  prefix: `${creatorId}/hls/${mediaId}/`,
});
```

### Integration with AWS SDK

R2 is S3-compatible, so this package uses the AWS SDK for S3 under the hood:
- `@aws-sdk/client-s3` - Core S3 operations
- `@aws-sdk/s3-request-presigner` - Generate signed URLs

**Configuration:**
```typescript
import { S3Client } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});
```

## KV Client (Planned)

### Purpose

The KV clients handle Cloudflare KV operations for:
- **Session Caching**: Cache authenticated sessions to reduce database queries
- **Rate Limiting**: Distributed rate limit counters for security
- **General Caching**: Application-level caching for expensive queries

### KV Namespace Architecture

The platform uses three KV namespaces:

| Namespace | Purpose | Key Pattern | TTL Strategy |
|-----------|---------|-------------|--------------|
| `AUTH_SESSION_KV` | Session caching | `session:{token}` | Matches session expiry (24h) |
| `RATE_LIMIT_KV` | Rate limiting | `rl:{endpoint}:{ip}` | Window duration (15min-1h) |
| `CACHE_KV` | General cache | `cache:{feature}:{key}` | Feature-specific (5min-24h) |

### Planned API: Session Cache Client

```typescript
import { SessionCacheClient } from '@codex/cloudflare-clients';

// Initialize with KV namespace binding
const sessionCache = new SessionCacheClient(env.AUTH_SESSION_KV);

// Cache a session
await sessionCache.set('session-token-123', {
  session: {
    id: 'session-id',
    userId: 'user-id',
    token: 'session-token-123',
    expiresAt: '2025-11-16T00:00:00Z',
  },
  user: {
    id: 'user-id',
    email: 'user@example.com',
    name: 'John Doe',
    role: 'creator',
    emailVerified: true,
  },
});

// Get cached session
const cached = await sessionCache.get('session-token-123');
if (cached) {
  console.log('Cache hit!', cached.user.email);
}

// Invalidate session (on logout)
await sessionCache.delete('session-token-123');
```

### Planned API: Rate Limiter Client

```typescript
import { RateLimiterClient } from '@codex/cloudflare-clients';

const rateLimiter = new RateLimiterClient(env.RATE_LIMIT_KV);

// Check and increment rate limit
const result = await rateLimiter.checkLimit('192.168.1.1', {
  limit: 5,           // Max 5 attempts
  window: 900,        // 15 minutes
  keyPrefix: 'rl:login:',
});

if (!result.allowed) {
  throw new Error('Rate limit exceeded');
}

console.log(`Remaining: ${result.remaining}, Resets at: ${new Date(result.resetAt)}`);

// Reset rate limit (admin override)
await rateLimiter.reset('192.168.1.1', 'rl:login:');
```

### Planned API: General Cache Client

```typescript
import { CacheClient } from '@codex/cloudflare-clients';

const cache = new CacheClient(env.CACHE_KV);

// Basic cache operations
await cache.set('cache:content:featured', featuredContent, 1800); // 30 min TTL
const cached = await cache.get<Content[]>('cache:content:featured');
await cache.delete('cache:content:featured');

// Read-through cache pattern
const content = await cache.getOrSet(
  'cache:content:published:category-123',
  300, // 5 min TTL
  async () => {
    // This function only runs on cache miss
    return await db.query.content.findMany({
      where: eq(content.categoryId, 'category-123'),
    });
  }
);

// Batch invalidation
await cache.deleteMany([
  'cache:content:featured',
  'cache:content:published:category-123',
]);
```

## Usage Examples

### In SvelteKit Application (apps/web)

**Session Caching in Server Hooks:**

```typescript
// apps/web/src/hooks.server.ts
import { SessionCacheClient } from '@codex/cloudflare-clients';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  const sessionToken = event.cookies.get('codex-session');

  if (!sessionToken) {
    event.locals.user = null;
    return resolve(event);
  }

  // Try cache first
  const kv = event.platform?.env?.AUTH_SESSION_KV;
  if (kv) {
    const sessionCache = new SessionCacheClient(kv);
    const cached = await sessionCache.get(sessionToken);

    if (cached) {
      event.locals.user = cached.user;
      event.locals.session = cached.session;
      return resolve(event);
    }
  }

  // Cache miss: fetch from database and populate cache
  const session = await fetchSessionFromDB(sessionToken);
  if (session && kv) {
    const sessionCache = new SessionCacheClient(kv);
    await sessionCache.set(sessionToken, session);
  }

  event.locals.user = session?.user ?? null;
  return resolve(event);
};
```

**Rate Limiting in API Routes:**

```typescript
// apps/web/src/routes/api/auth/login/+server.ts
import { RateLimiterClient } from '@codex/cloudflare-clients';
import { fail } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform, getClientAddress }) => {
  const kv = platform?.env?.RATE_LIMIT_KV;

  if (kv) {
    const rateLimiter = new RateLimiterClient(kv);
    const result = await rateLimiter.checkLimit(getClientAddress(), {
      limit: 5,
      window: 900,
      keyPrefix: 'rl:login:',
    });

    if (!result.allowed) {
      return fail(429, { error: 'Too many login attempts' });
    }
  }

  // Process login...
};
```

**Content Caching:**

```typescript
// apps/web/src/routes/api/content/+server.ts
import { CacheClient } from '@codex/cloudflare-clients';
import { db } from '@codex/database';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform }) => {
  const categoryId = url.searchParams.get('category');
  const kv = platform?.env?.CACHE_KV;

  if (!kv) {
    // No cache: fetch directly from database
    const content = await db.query.content.findMany({
      where: eq(content.categoryId, categoryId),
    });
    return json(content);
  }

  // Use read-through cache pattern
  const cache = new CacheClient(kv);
  const content = await cache.getOrSet(
    `cache:content:published:${categoryId}`,
    300, // 5 min TTL
    async () => db.query.content.findMany({
      where: eq(content.categoryId, categoryId),
    })
  );

  return json(content);
};
```

### In Cloudflare Workers

**Queue Consumer Worker:**

```typescript
// workers/queue-consumer/src/index.ts
import { CacheClient } from '@codex/cloudflare-clients';
import type { KVNamespace } from '@cloudflare/workers-types';

interface Env {
  TRANSCODING_QUEUE: Queue;
  CACHE_KV: KVNamespace;
}

export default {
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    const cache = new CacheClient(env.CACHE_KV);

    for (const message of batch.messages) {
      const job = message.body;

      // Update transcoding status in cache
      await cache.set(
        `cache:media:status:${job.mediaId}`,
        { status: 'transcoding', progress: 0 },
        60 // 1 min TTL
      );

      // Process transcoding job...
    }
  },
};
```

**Webhook Handler Worker:**

```typescript
// workers/webhook-handler/src/index.ts
import { SessionCacheClient } from '@codex/cloudflare-clients';
import type { KVNamespace } from '@cloudflare/workers-types';

interface Env {
  AUTH_SESSION_KV: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Invalidate session cache on webhook events
    const sessionCache = new SessionCacheClient(env.AUTH_SESSION_KV);
    await sessionCache.delete(sessionToken);

    return new Response('OK');
  },
};
```

## Type Definitions

### R2 Types (Planned)

```typescript
export interface R2UploadOptions {
  bucket: string;
  key: string;
  body: Buffer | ReadableStream;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface R2DownloadOptions {
  bucket: string;
  key: string;
}

export interface R2SignedUrlOptions {
  bucket: string;
  key: string;
  expiresIn: number; // seconds
}

export interface R2DeleteOptions {
  bucket: string;
  key: string;
}

export interface R2ListOptions {
  bucket: string;
  prefix?: string;
  maxKeys?: number;
}
```

### KV Types (Planned)

```typescript
export interface CachedSession {
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: string;
    ipAddress?: string;
    userAgent?: string;
  };
  user: {
    id: string;
    email: string;
    name: string;
    role: 'customer' | 'owner' | 'creator';
    emailVerified: boolean;
  };
}

export interface RateLimitConfig {
  limit: number;        // Max attempts
  window: number;       // Window in seconds
  keyPrefix: string;    // e.g., 'rl:login:'
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;      // Unix timestamp (ms)
}
```

## Dependencies

### Production Dependencies

- **`@aws-sdk/client-s3`** (^3.914.0): AWS S3 client for R2 operations
- **`@aws-sdk/s3-request-presigner`** (^3.914.0): Generate signed URLs for R2
- **`vite-plugin-dts`** (^4.5.4): TypeScript declaration generation

### Development Dependencies

- **`@cloudflare/workers-types`** (^4.20241127.0): Cloudflare Workers type definitions
- **`@types/node`** (^22.0.0): Node.js type definitions
- **`typescript`** (^5.6.3): TypeScript compiler
- **`vitest`** (^4.0.2): Testing framework

## Configuration

### TypeScript Configuration

The package uses strict TypeScript settings and includes Cloudflare Workers types:

```json
{
  "extends": "../../config/tsconfig/package.json",
  "compilerOptions": {
    "rootDir": "src",
    "types": ["@cloudflare/workers-types"]
  }
}
```

### Environment Variables

When using these clients, ensure the following environment variables are set:

**R2 Configuration:**
```bash
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
```

**KV Bindings (in wrangler.jsonc):**
```toml
kv_namespaces = [
  { binding = "AUTH_SESSION_KV", id = "your-kv-namespace-id" },
  { binding = "RATE_LIMIT_KV", id = "your-rate-limit-kv-id" },
  { binding = "CACHE_KV", id = "your-cache-kv-id" }
]
```

## Testing

Run tests with Vitest:

```bash
# Run tests once
pnpm test

# Watch mode
pnpm test:watch

# Coverage report
pnpm test:coverage
```

### Testing Strategy

**Unit Tests:**
- Mock KV namespaces with in-memory implementations
- Test individual client methods in isolation
- Verify TTL calculations and error handling

**Integration Tests (Planned):**
- Use Miniflare for realistic KV behavior
- Test with actual Cloudflare Workers runtime
- Verify end-to-end workflows

## Best Practices

### KV Usage

1. **Always Set TTLs**: Prevent stale data by always setting `expirationTtl`
2. **Graceful Degradation**: Handle KV unavailability by falling back to database
3. **Key Naming**: Use consistent prefixes (`session:`, `rl:`, `cache:`)
4. **Value Size**: Keep values under 100KB for optimal performance
5. **Cache Invalidation**: Update database first, then invalidate cache

### R2 Usage

1. **Organized Keys**: Use `{creatorId}/` prefix for easy batch operations
2. **Signed URLs**: Always use signed URLs for private content
3. **Content Types**: Set correct `Content-Type` for proper browser handling
4. **Cleanup**: Implement lifecycle policies for temporary files
5. **Multipart Uploads**: Use for files >100MB

### Error Handling

```typescript
try {
  const cached = await sessionCache.get(token);
} catch (error) {
  console.error('KV error, falling back to database:', error);
  // Fallback to database
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.token, token),
  });
}
```

## Roadmap

### Phase 1 (Current)
- ✅ Package structure and configuration
- ⏳ R2Client implementation
- ⏳ KV clients (SessionCache, RateLimiter, Cache)
- ⏳ Unit tests with mocked dependencies

### Phase 2 (Future)
- Integration tests with Miniflare
- Advanced R2 features (multipart uploads, lifecycle policies)
- KV analytics and monitoring helpers
- Performance optimization and batching

### Phase 3 (Future)
- R2 bucket lifecycle management
- Multi-region R2 replication
- Advanced KV patterns (distributed locks, atomic counters)

## Related Documentation

- [Code Structure](../../design/infrastructure/CodeStructure.md) - Monorepo organization
- [KV Namespaces](../../design/infrastructure/KV-Namespaces.md) - Complete KV architecture
- [R2 Bucket Structure](../../design/infrastructure/R2BucketStructure.md) - R2 organization
- [Content Management Work Packet](../../design/roadmap/work-packets/P1-CONTENT-001-content-service.md) - Usage context

## Contributing

When contributing to this package:

1. Maintain framework-agnostic design (no SvelteKit or Worker-specific code)
2. Use TypeScript strict mode and Cloudflare Workers types
3. Write comprehensive unit tests for all new features
4. Update type definitions and exports
5. Document new APIs with examples

## License

Private - Codex Platform
