# @codex/cache

Versioned cache implementation for Cloudflare KV. Cache-aside pattern with version-based invalidation.

## Overview

Instead of deleting cache keys, we increment a version number. All old keys become stale immediately and expire via TTL.

**Benefits**:
- No need to track all cache keys for an entity
- Single atomic operation invalidates all entity data
- Works naturally across distributed workers
- Old keys expire automatically via TTL

## API

### `VersionedCache`

Constructor: `new VersionedCache({ kv, prefix?, obs? })`

**Methods**:
- `get<T>(id, type, fetcher, options?)`: Get with cache-aside (fetcher called on miss)
- `getWithResult<T>(id, type, fetcher, options?)`: Get with hit/miss tracking
- `invalidate(id)`: Invalidate all cache entries for an entity
- `delete(id, type)`: Delete specific cache entry
- `getStats()`: Get cache statistics
- `resetStats()`: Reset cache statistics

### `CacheType`

Enum of cache type identifiers:
- `USER_PROFILE`: User profile data
- `USER_PREFERENCES`: User notification preferences
- `ORG_CONFIG`: Organization configuration
- `ORG_MEMBERS`: Organization member lists
- `CONTENT_METADATA`: Content metadata
- `CONTENT_ACCESS`: Content access control data
- `USER_SESSION`: User session data

### Helper Functions

- `buildCacheKey(type, id)`: Build cache key without version
- `buildVersionKey(id)`: Build version key
- `buildVersionedCacheKey(prefix, type, id, version)`: Build fully-versioned key

## Usage

### Basic Cache-Aside

```typescript
import { VersionedCache } from '@codex/cache';
import { CacheType } from '@codex/cache';

const cache = new VersionedCache({ kv: env.CACHE_KV });

const profile = await cache.get(
  userId,
  CacheType.USER_PROFILE,
  () => fetchProfileFromDB(userId),
  { ttl: 600 } // 10 minutes
);
```

### Invalidation on Update

```typescript
async updateProfile(userId: string, input: ProfileUpdateInput) {
  // Update database
  const user = await db.update(/* ... */);

  // Invalidate all user cache
  await cache.invalidate(userId);

  return user;
}
```

### With Observability

```typescript
import { ObservabilityClient } from '@codex/observability';

const obs = new ObservabilityClient('identity-api', 'production');
const cache = new VersionedCache({ kv: env.CACHE_KV, obs });

// Cache operations are automatically logged
```

### Monitoring Cache Effectiveness

```typescript
const { data, hit } = await cache.getWithResult(
  userId,
  CacheType.USER_PROFILE,
  () => fetchProfileFromDB(userId)
);

console.log(`Cache ${hit ? 'hit' : 'miss'}`);

// Get overall statistics
const stats = cache.getStats();
console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
```

## Key Design

### Version-Based Invalidation

Instead of:
```typescript
// ❌ Need to track all keys
await kv.delete('cache:user:profile:123');
await kv.delete('cache:user:preferences:123');
await kv.delete('cache:user:session:123');
// ...forgot one?
```

We use:
```typescript
// ✅ Single atomic operation
await cache.invalidate('123');
// All cache:user:*:123 keys are now stale
```

### Cache Keys Structure

```
cache:version:{id}           → "1712345678" (current version)
cache:{type}:{id}:v{version} → actual cached data
```

Example:
```
cache:version:user-123              → "1712345678"
cache:user:profile:user-123:v1712345678  → { name: "...", email: "..." }
cache:user:preferences:user-123:v1712345678 → { emailMarketing: true }
```

When we invalidate, we increment the version:
```
cache:version:user-123              → "1712345999" (new version)
cache:user:profile:user-123:v1712345678  → stale (expires via TTL)
cache:user:profile:user-123:v1712345999  → fresh data
```

### Graceful Degradation

If KV fails, the cache falls back to the fetcher:
```typescript
const data = await cache.get(
  id,
  type,
  () => fetchFromDB(id) // Always called on KV failure
);
// No errors thrown, just slower
```

## Integration with Services

### Identity Service Example

```typescript
import { VersionedCache } from '@codex/cache';
import { BaseService, type ServiceConfig } from '@codex/service-errors';

interface IdentityServiceConfig extends ServiceConfig {
  cache: VersionedCache;
}

export class IdentityService extends BaseService {
  private cache: VersionedCache;

  constructor(config: IdentityServiceConfig) {
    super(config);
    this.cache = config.cache;
  }

  async getProfile(userId: string) {
    return this.cache.get(
      userId,
      'user:profile',
      () => this.fetchProfileFromDB(userId),
      { ttl: 600 }
    );
  }

  async updateProfile(userId: string, input: ProfileUpdateInput) {
    const user = await this.db.update(/* ... */);
    await this.cache.invalidate(userId);
    return user;
  }
}
```

## Patterns

### Cache Invalidation Timing

**Always invalidate AFTER successful database update**:
```typescript
// ✅ Correct
async updateProfile(userId: string, input: ProfileUpdateInput) {
  const user = await this.db.update(/* ... */);
  await this.cache.invalidate(userId); // After DB commit
  return user;
}

// ❌ Wrong - could serve stale data if DB update fails
async updateProfile(userId: string, input: ProfileUpdateInput) {
  await this.cache.invalidate(userId); // Too early!
  const user = await this.db.update(/* ... */);
  return user;
}
```

### TTL Guidelines

- **User data**: 5-15 minutes (profile, preferences)
- **Organization data**: 10-30 minutes (config, members)
- **Content metadata**: 5-10 minutes (title, description)
- **Access control**: 1-5 minutes (permissions, roles)

### Fire-and-Forget Writes

Cache writes don't block the response:
```typescript
const data = await fetcher();

// Fire-and-forget (don't await)
this.kv.put(cacheKey, JSON.stringify(data), { expirationTtl: ttl })
  .catch((err) => this.obs.warn('Cache write failed', { error: err }));

return data; // Return immediately
```

## Testing

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { VersionedCache } from '@codex/cache';

describe('VersionedCache', () => {
  let mockKV: KVNamespace;
  let cache: VersionedCache;

  beforeEach(() => {
    mockKV = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    } as unknown as KVNamespace;
    cache = new VersionedCache({ kv: mockKV });
  });

  it('should cache data on first call', async () => {
    const fetcher = vi.fn().mockResolvedValue({ name: 'Test' });
    mockKV.get = vi.fn().mockResolvedValue(null); // Cache miss

    const result = await cache.get('user-123', 'user:profile', fetcher);

    expect(result).toEqual({ name: 'Test' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(mockKV.put).toHaveBeenCalled();
  });

  it('should return cached data on subsequent calls', async () => {
    const cachedData = { name: 'Cached' };
    mockKV.get = vi.fn()
      .mockResolvedValueOnce('1712345678') // Version get
      .mockResolvedValueOnce(JSON.stringify(cachedData)); // Cache hit

    const fetcher = vi.fn().mockResolvedValue({ name: 'Fresh' });
    const result = await cache.get('user-123', 'user:profile', fetcher);

    expect(result).toEqual(cachedData);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
```

## Files

- `src/versioned-cache.ts`: Main VersionedCache class
- `src/cache-keys.ts`: Key builders and CacheType enum
- `src/types.ts`: TypeScript interfaces
- `src/index.ts`: Public exports
