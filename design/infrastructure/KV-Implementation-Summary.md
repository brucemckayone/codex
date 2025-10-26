# KV Implementation Summary - Codex Platform

**Last Updated**: 2025-10-26
**Version**: 1.0

This document provides a high-level overview of the Cloudflare KV implementation strategy for the Codex platform.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Cloudflare KV Namespaces                     │
├─────────────────────────────────────────────────────────────────┤
│  • AUTH_SESSION_KV  - Session caching (95%+ hit rate)           │
│  • CACHE_KV         - General app cache (content, settings)      │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │
                ┌─────────────┴─────────────┐
                │                           │
        ┌───────┴────────┐         ┌───────┴────────┐
        │  KV Clients    │         │   KV Clients   │
        │  (Shared Pkg)  │         │  (Shared Pkg)  │
        └───────┬────────┘         └───────┬────────┘
                │                           │
        ┌───────┴────────┐         ┌───────┴────────┐
        │  SvelteKit App │         │    Workers     │
        │  (apps/web)    │         │  (queue, etc)  │
        └────────────────┘         └────────────────┘
```

---

## Package Organization

### Shared Packages Approach

Following the **monorepo structure** from [CodeStructure.md](./CodeStructure.md):

```
packages/cloudflare-clients/
├── src/
│   ├── kv/
│   │   ├── session-cache.ts      # SessionCacheClient
│   │   ├── rate-limiter.ts       # RateLimiterClient
│   │   ├── cache.ts              # CacheClient (general)
│   │   └── index.ts              # Exports
│   ├── r2/
│   │   └── ...                   # R2 clients (separate concern)
│   └── index.ts
├── tests/
│   ├── unit/                     # Unit tests with mocks
│   └── integration/              # Integration tests with Miniflare
└── package.json
```

**Key Benefits**:
- ✅ **Reusable** across SvelteKit app and Workers
- ✅ **Type-safe** with TypeScript
- ✅ **Testable** with unit and integration tests
- ✅ **Framework-agnostic** - no SvelteKit dependencies

---

## KV Namespace Usage

### 1. AUTH_SESSION_KV

**Purpose**: Cache user sessions to avoid database queries on every request

**Performance**:
- **Cache Hit**: ~5-10ms (no DB query)
- **Cache Miss**: ~50-100ms (DB query + cache population)
- **Hit Rate**: >95% expected

**Used By**:
- `apps/web/src/hooks.server.ts` - Session validation middleware
- `apps/web/src/routes/api/auth/login/+server.ts` - Rate limiting login attempts
- `workers/webhook-handler` - Potential session validation

**Client**: `SessionCacheClient`

**Key Pattern**: `session:{sessionToken}`

---

### 2. CACHE_KV

**Purpose**: General application cache for expensive queries

**Use Cases**:
- **Content Lists**: `cache:content:published:{categoryId}` (5 min TTL)
- **Platform Settings**: `cache:platform-settings` (24 hour TTL)
- **Transcoding Status**: `cache:media:processing-status:{mediaId}` (1 min TTL)
- **Creator Buckets**: `cache:creator-buckets:{creatorId}` (24 hour TTL)
- **Daily Analytics**: `cache:analytics:daily:{date}` (24 hour TTL)

**Used By**:
- `apps/web/src/routes/api/content/+server.ts` - Content list caching
- `apps/web/src/routes/api/platform-settings/+server.ts` - Settings cache
- `workers/queue-consumer` - Processing status updates

**Client**: `CacheClient`

**Key Pattern**: `cache:{feature}:{key}`

---

## Client Implementations

### SessionCacheClient

```typescript
import { SessionCacheClient } from '@codex/cloudflare-clients';

const kv = event.platform?.env?.AUTH_SESSION_KV;
const cache = new SessionCacheClient(kv);

// Get cached session
const session = await cache.get(sessionToken);

// Cache session
await cache.set(sessionToken, { session, user });

// Invalidate session
await cache.delete(sessionToken);
```

**Methods**:
- `get(sessionToken)` - Retrieve cached session
- `set(sessionToken, data)` - Cache session with TTL
- `delete(sessionToken)` - Invalidate session

---

### RateLimiterClient

```typescript
import { RateLimiterClient } from '@codex/cloudflare-clients';

const kv = event.platform?.env?.AUTH_SESSION_KV;
const limiter = new RateLimiterClient(kv);

const result = await limiter.checkLimit(ipAddress, {
  limit: 5,
  window: 900, // 15 minutes
  keyPrefix: 'rl:login:',
});

if (!result.allowed) {
  throw error(429, 'Too many attempts');
}
```

**Methods**:
- `checkLimit(identifier, config)` - Check and increment counter
- `reset(identifier, keyPrefix)` - Reset limit (admin override)

**Returns**:
- `allowed` - Boolean
- `remaining` - Number of attempts left
- `resetAt` - Timestamp when window resets

---

### CacheClient

```typescript
import { CacheClient } from '@codex/cloudflare-clients';

const kv = event.platform?.env?.CACHE_KV;
const cache = new CacheClient(kv);

// Read-through cache pattern
const content = await cache.getOrSet(
  `cache:content:published:${categoryId}`,
  300, // 5 minutes TTL
  async () => {
    return db.query.content.findMany({ /* ... */ });
  }
);

// Manual cache management
await cache.set('key', value, 300);
const value = await cache.get('key');
await cache.delete('key');
```

**Methods**:
- `get<T>(key)` - Get cached value
- `set(key, value, ttl)` - Set cached value
- `delete(key)` - Delete cached value
- `deleteMany(keys)` - Batch delete
- `getOrSet(key, ttl, fetchFn)` - Read-through cache pattern

---

## Import Patterns

### ✅ Correct Usage

**In SvelteKit app**:
```typescript
// apps/web/src/hooks.server.ts
import { SessionCacheClient } from '@codex/cloudflare-clients';
import { auth } from '@codex/auth';
import { db } from '@codex/database';
```

**In Workers**:
```typescript
// workers/queue-consumer/src/index.ts
import { CacheClient } from '@codex/cloudflare-clients';
import { db } from '@codex/database';
```

### ❌ Incorrect Usage

**Never import from apps/web in workers**:
```typescript
// NEVER DO THIS
import { something } from '../../../apps/web/src/lib/utils';
```

---

## Testing Strategy

### Unit Tests (with Mocks)

```typescript
// packages/cloudflare-clients/tests/unit/kv/session-cache.test.ts
import { SessionCacheClient } from '../../../src/kv/session-cache';

describe('SessionCacheClient', () => {
  let mockKV: MockKV;
  let client: SessionCacheClient;

  it('should cache and retrieve session', async () => {
    // Test implementation
  });
});
```

### Integration Tests (with Miniflare)

```typescript
// packages/cloudflare-clients/tests/integration/kv.test.ts
import { Miniflare } from 'miniflare';
import { SessionCacheClient } from '../../src/kv';

describe('KV Integration Tests', () => {
  let mf: Miniflare;
  let kv: KVNamespace;

  beforeEach(async () => {
    mf = new Miniflare({ kvNamespaces: ['TEST_KV'] });
    kv = await mf.getKVNamespace('TEST_KV');
  });

  it('should work with actual KV', async () => {
    // Test with real KV behavior
  });
});
```

---

## Environment Setup

### Development (Local)

```bash
# Create preview namespaces
npx wrangler kv:namespace create AUTH_SESSION_KV --preview
npx wrangler kv:namespace create CACHE_KV --preview
```

### Staging

```bash
npx wrangler kv:namespace create AUTH_SESSION_KV --env staging
npx wrangler kv:namespace create CACHE_KV --env staging
```

### Production

```bash
npx wrangler kv:namespace create AUTH_SESSION_KV
npx wrangler kv:namespace create CACHE_KV
```

---

## Cost Estimation

**Free Tier Limits**:
- 100,000 reads/day
- 1,000 writes/day
- 1,000 deletes/day
- 1 GB storage

**MVP Usage** (100 daily active users):
- Reads: ~500k/month → **$0** (within free tier)
- Writes: ~50k/month → **$0** (within free tier)
- Deletes: ~5k/month → **$0** (within free tier)

**Total MVP Cost**: **$0/month**

**At Scale** (10,000 daily active users):
- Reads: ~50M/month → $0.25
- Writes: ~5M/month → $25
- Deletes: ~500k/month → $2.50
- Storage: ~5GB → $2.50

**Total at Scale**: **~$30/month**

---

## Best Practices

### 1. Always Set TTL
```typescript
// ✅ Good - TTL set
await cache.set('key', value, 300); // 5 minutes

// ❌ Bad - No TTL (will stay forever)
await cache.set('key', value); // Don't do this
```

### 2. Graceful Degradation
```typescript
const kv = platform?.env?.AUTH_SESSION_KV;

if (!kv) {
  console.warn('KV unavailable, using database');
  return await fetchFromDatabase();
}

// Use KV...
```

### 3. Key Naming Conventions
```typescript
// ✅ Good - Clear namespace and structure
'session:abc123'
'rl:login:192.168.1.1'
'cache:content:published:cat-uuid'

// ❌ Bad - Unclear structure
'sessionabc123'
'login_limit_ip'
'contentcat'
```

### 4. Cache Invalidation
```typescript
// Update database first
await db.update(content).set({ title: 'New Title' });

// Then invalidate cache
await cache.delete(`cache:content:published:${categoryId}`);
```

### 5. Read-Through Pattern
```typescript
// ✅ Good - Use getOrSet helper
const data = await cache.getOrSet('key', 300, async () => {
  return expensiveQuery();
});

// ❌ Bad - Manual cache logic (prone to race conditions)
let data = await cache.get('key');
if (!data) {
  data = await expensiveQuery();
  await cache.set('key', data, 300);
}
```

---

## Common Patterns

### Session Caching in Hooks

```typescript
// apps/web/src/hooks.server.ts
export const handle: Handle = async ({ event, resolve }) => {
  const sessionCookie = event.cookies.get('codex-session');
  if (!sessionCookie) return resolve(event);

  const kv = event.platform?.env?.AUTH_SESSION_KV;
  if (kv) {
    const cache = new SessionCacheClient(kv);
    const cached = await cache.get(sessionCookie);

    if (cached) {
      event.locals.session = cached.session;
      event.locals.user = cached.user;
      return resolve(event);
    }
  }

  // Fallback to database...
};
```

### Rate Limiting in API Routes

```typescript
// apps/web/src/routes/api/auth/login/+server.ts
export const POST: RequestHandler = async ({ platform, getClientAddress }) => {
  const kv = platform?.env?.AUTH_SESSION_KV;

  if (kv) {
    const limiter = new RateLimiterClient(kv);
    const result = await limiter.checkLimit(getClientAddress(), {
      limit: 5,
      window: 900,
      keyPrefix: 'rl:login:',
    });

    if (!result.allowed) {
      return fail(429, { error: 'Too many attempts' });
    }
  }

  // Process login...
};
```

### Content List Caching

```typescript
// apps/web/src/routes/api/content/+server.ts
export const GET: RequestHandler = async ({ url, platform }) => {
  const categoryId = url.searchParams.get('category');
  const kv = platform?.env?.CACHE_KV;

  if (kv) {
    const cache = new CacheClient(kv);
    return json(await cache.getOrSet(
      `cache:content:published:${categoryId}`,
      300, // 5 min
      async () => db.query.content.findMany({ /* ... */ })
    ));
  }

  // No cache: direct query
  return json(await db.query.content.findMany({ /* ... */ }));
};
```

---

## Migration Path

### Phase 1 (MVP) - Current
- ✅ `AUTH_SESSION_KV` - Session caching
- ✅ `CACHE_KV` - General cache (can share `AUTH_SESSION_KV` initially)
- ✅ Rate limiting uses `AUTH_SESSION_KV`

### Phase 2 - Optimization
- Split rate limiting into separate namespace
- Add user-specific caching
- Add analytics caching

### Phase 3 - Scale
- Multi-region cache warming
- Advanced cache invalidation strategies
- Distributed locking (if needed)

---

## Related Documents

- **[KV-Namespaces.md](./KV-Namespaces.md)** - Complete namespace definitions and implementation details
- **[CodeStructure.md](./CodeStructure.md)** - Monorepo structure and import patterns
- **[Auth TDD](../features/auth/ttd-dphase-1.md)** - Session caching implementation
- **[Rate Limiting Strategy](../security/RateLimiting.md)** - Rate limiting implementation
- **[Environment Management](./EnvironmentManagement.md)** - Environment setup

---

## Quick Start Checklist

### Setup KV Namespaces
- [ ] Create `AUTH_SESSION_KV` namespace in Cloudflare
- [ ] Create `CACHE_KV` namespace in Cloudflare (or share with AUTH_SESSION_KV)
- [ ] Add namespace IDs to `wrangler.toml`
- [ ] Configure bindings in SvelteKit adapter

### Implement KV Clients Package
- [ ] Create `packages/cloudflare-clients` directory
- [ ] Implement `SessionCacheClient`
- [ ] Implement `RateLimiterClient`
- [ ] Implement `CacheClient`
- [ ] Write unit tests with mocks
- [ ] Write integration tests with Miniflare

### Integrate in Apps/Workers
- [ ] Update `apps/web/src/app.d.ts` with KV types
- [ ] Implement session caching in `hooks.server.ts`
- [ ] Add rate limiting to auth routes
- [ ] Add content caching to API routes
- [ ] Configure workers to use KV clients

### Testing & Deployment
- [ ] Run unit tests for KV clients
- [ ] Run integration tests with Miniflare
- [ ] Test in local development with Wrangler
- [ ] Deploy to staging and verify KV bindings
- [ ] Monitor KV metrics in Cloudflare dashboard
- [ ] Deploy to production

---

**Document Version**: 1.0
**Last Updated**: 2025-10-26
**Status**: Ready for Implementation
