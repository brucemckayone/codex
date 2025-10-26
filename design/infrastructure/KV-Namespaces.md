# Cloudflare KV Namespaces - Codex Platform

**Last Updated**: 2025-10-26
**Version**: 1.0
**Status**: Ready for Implementation

---

## Overview

This document defines all Cloudflare KV namespaces required for the Codex platform across all environments (development, staging, production). KV is used for high-performance caching and rate limiting to reduce database queries and protect against abuse.

**Architecture Philosophy**: KV is used as a **read-through cache** and **distributed counter store**, not as primary data storage. All critical data lives in Neon Postgres with KV providing performance optimization and security features.

---

## KV Namespace Summary

| Namespace ID | Purpose | Key Pattern | TTL Strategy | Size Estimate |
|-------------|---------|-------------|--------------|---------------|
| `AUTH_SESSION_KV` | Session caching | `session:{sessionToken}` | Matches session expiry (24h) | ~1KB per session |
| `RATE_LIMIT_KV` | Rate limiting counters | `rl:{endpoint}:{identifier}` | Window duration (15min-1h) | ~100B per counter |
| `CACHE_KV` | General application cache | `cache:{feature}:{key}` | Feature-specific (5min-24h) | Varies by feature |

**Total KV Namespaces**: 3
**Estimated Monthly Costs** (MVP): <$1/month (free tier covers ~100k operations/day)

---

## Namespace Definitions

### 1. AUTH_SESSION_KV

**Purpose**: Cache authenticated user sessions to avoid database queries on every request

**Binding Name**: `AUTH_SESSION_KV`

**Key Pattern**:
```
session:{sessionToken}
```

**Value Structure**:
```typescript
interface CachedSession {
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: string; // ISO 8601 timestamp
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
```

**TTL Strategy**:
- Set `expirationTtl` to match session expiry from database
- Automatic cache invalidation when session expires
- Manual deletion on logout or password change

**Performance Impact**:
- **Cache Hit**: ~5-10ms (no DB query)
- **Cache Miss**: ~50-100ms (DB query + cache population)
- **Expected Hit Rate**: >95% after warmup

**Access Patterns**:
```typescript
// Read (hooks.server.ts)
const cached = await AUTH_SESSION_KV.get(`session:${sessionToken}`, 'json');

// Write (on session creation or cache miss)
const ttl = Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000);
await AUTH_SESSION_KV.put(
  `session:${sessionToken}`,
  JSON.stringify({ session, user }),
  { expirationTtl: ttl }
);

// Delete (on logout)
await AUTH_SESSION_KV.delete(`session:${sessionToken}`);
```

**Environment Configuration**:
```bash
# Development
npx wrangler kv:namespace create AUTH_SESSION_KV --preview

# Production
npx wrangler kv:namespace create AUTH_SESSION_KV
```

**Related Documents**:
- [Auth TDD](../features/auth/ttd-dphase-1.md) - Session caching implementation
- [Rate Limiting Strategy](../security/RateLimiting.md) - Uses same KV namespace

---

### 2. RATE_LIMIT_KV

**Purpose**: Distributed rate limiting counters to prevent abuse and brute-force attacks

**Binding Name**: `RATE_LIMIT_KV` (can share `AUTH_SESSION_KV` in Phase 1 for cost efficiency)

**Key Pattern**:
```
rl:{endpoint}:{identifier}
```

Examples:
- `rl:login:192.168.1.1` - Login attempts from IP
- `rl:auth:192.168.1.1` - General auth endpoint rate limit
- `rl:api:user-uuid` - Per-user API rate limit
- `rl:upload:creator-uuid` - Upload rate limit per creator

**Value Structure**:
```typescript
interface RateLimitCounter {
  count: number;        // Current attempt count
  resetAt: number;      // Unix timestamp (ms) when window resets
}
```

**Rate Limit Targets** (from [RateLimiting.md](../security/RateLimiting.md)):

| Endpoint/Action | Limit | Window | Key Pattern |
|----------------|-------|--------|-------------|
| **Login** | 5 attempts | 15 min | `rl:login:{ip}` |
| **Registration** | 3 attempts | 1 hour | `rl:register:{ip}` |
| **Password Reset Request** | 3 attempts | 1 hour | `rl:password-reset:{ip}` |
| **Email Verification Resend** | 5 attempts | 1 hour | `rl:verify-email:{ip}` |
| **API Routes (general)** | 100 requests | 1 min | `rl:api:{ip}` |
| **Content Upload** | 10 uploads | 1 hour | `rl:upload:{userId}` |

**TTL Strategy**:
- Set `expirationTtl` to window duration
- Auto-cleanup when window expires
- No manual cleanup needed

**Access Pattern** (from RateLimiting.md):
```typescript
async function rateLimit(
  kv: KVNamespace,
  identifier: string,
  config: { limit: number; window: number; keyPrefix: string }
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const key = `${config.keyPrefix}${identifier}`;
  const now = Date.now();

  // Get current count
  const data = await kv.get(key, 'json') as { count: number; resetAt: number } | null;

  if (!data || now > data.resetAt) {
    // First request or window expired
    const resetAt = now + config.window * 1000;
    await kv.put(key, JSON.stringify({ count: 1, resetAt }), {
      expirationTtl: config.window,
    });
    return { allowed: true, remaining: config.limit - 1, resetAt };
  }

  // Check if limit exceeded
  if (data.count >= config.limit) {
    return { allowed: false, remaining: 0, resetAt: data.resetAt };
  }

  // Increment counter
  await kv.put(
    key,
    JSON.stringify({ count: data.count + 1, resetAt: data.resetAt }),
    { expirationTtl: Math.ceil((data.resetAt - now) / 1000) }
  );

  return { allowed: true, remaining: config.limit - data.count - 1, resetAt: data.resetAt };
}
```

**Related Documents**:
- [Rate Limiting Strategy](../security/RateLimiting.md) - Complete implementation details

---

### 3. CACHE_KV

**Purpose**: General-purpose application cache for expensive queries, API responses, and computed data

**Binding Name**: `CACHE_KV`

**Key Patterns**:
```
cache:content:published:{categoryId}      # Cached published content list per category
cache:content:featured                    # Cached featured content
cache:analytics:daily:{date}              # Daily analytics cache
cache:platform-settings                   # Platform settings (logo, branding)
cache:creator-buckets:{creatorId}         # Creator's R2 bucket names
cache:media:processing-status:{mediaId}   # Transcoding status polling
```

**Value Structure**: Varies by feature (JSON-serializable objects)

**TTL Strategy** (by use case):

| Cache Type | TTL | Rationale |
|-----------|-----|-----------|
| Published content lists | 5 minutes | Balance freshness with performance |
| Featured content | 30 minutes | Changes infrequently |
| Platform settings | 24 hours | Rarely changes, high read frequency |
| Creator bucket names | 24 hours | Never changes after creation |
| Transcoding status | 1 minute | Polling optimization during processing |
| Daily analytics | 24 hours | Expensive aggregation query |

**Access Patterns**:

**1. Content List Caching**:
```typescript
// Read-through cache pattern
async function getPublishedContent(categoryId: string): Promise<Content[]> {
  const cacheKey = `cache:content:published:${categoryId}`;

  // Try cache first
  const cached = await CACHE_KV.get(cacheKey, 'json');
  if (cached) {
    return cached as Content[];
  }

  // Cache miss: query database
  const content = await db.query.content.findMany({
    where: and(
      eq(content.categoryId, categoryId),
      eq(content.status, 'published')
    ),
  });

  // Populate cache (5 min TTL)
  await CACHE_KV.put(cacheKey, JSON.stringify(content), {
    expirationTtl: 300, // 5 minutes
  });

  return content;
}

// Invalidate on content publish/unpublish
async function invalidateContentCache(categoryId: string): Promise<void> {
  await CACHE_KV.delete(`cache:content:published:${categoryId}`);
  await CACHE_KV.delete(`cache:content:featured`); // Also invalidate featured
}
```

**2. Platform Settings Caching**:
```typescript
// Long-lived cache for infrequently changing data
async function getPlatformSettings(): Promise<PlatformSettings> {
  const cacheKey = 'cache:platform-settings';

  const cached = await CACHE_KV.get(cacheKey, 'json');
  if (cached) {
    return cached as PlatformSettings;
  }

  const settings = await db.query.platformSettings.findFirst();

  // Cache for 24 hours
  await CACHE_KV.put(cacheKey, JSON.stringify(settings), {
    expirationTtl: 86400, // 24 hours
  });

  return settings;
}
```

**3. Transcoding Status Polling**:
```typescript
// Short-lived cache to reduce polling load
async function getTranscodingStatus(mediaId: string): Promise<MediaStatus> {
  const cacheKey = `cache:media:processing-status:${mediaId}`;

  const cached = await CACHE_KV.get(cacheKey, 'json');
  if (cached) {
    return cached as MediaStatus;
  }

  const mediaItem = await db.query.mediaItems.findFirst({
    where: eq(mediaItems.id, mediaId),
  });

  // Cache for 1 minute (during processing, UI polls every 5 seconds)
  await CACHE_KV.put(cacheKey, JSON.stringify(mediaItem.status), {
    expirationTtl: 60, // 1 minute
  });

  return mediaItem.status;
}
```

**Cache Invalidation Strategy**:
- **On Write**: Delete relevant cache keys when data changes
- **On TTL**: Automatic expiration handles most cases
- **Manual Purge**: Admin endpoint to clear all cache if needed

**Related Documents**:
- [Content Management TDD](../features/content-management/ttd-dphase-1.md) - Content caching
- [Platform Settings TDD](../features/platform-settings/ttd-dphase-1.md) - Settings cache
- [Media Transcoding TDD](../features/media-transcoding/ttd-dphase-1.md) - Status polling

---

## Environment Setup

### Development (Local)

**Option 1: Remote KV (Recommended)**
```bash
# Create preview namespace (points to production KV)
npx wrangler kv:namespace create AUTH_SESSION_KV --preview

# Add to wrangler.toml
kv_namespaces = [
  { binding = "AUTH_SESSION_KV", id = "prod-id", preview_id = "preview-id" }
]
```

**Option 2: Miniflare (Local Development)**
```bash
# Use --kv flag with Miniflare
npx wrangler dev --kv AUTH_SESSION_KV

# Or configure in wrangler.toml
[miniflare]
kv_persist = true  # Persist KV data between restarts
```

### Staging

```bash
# Create staging namespaces
npx wrangler kv:namespace create AUTH_SESSION_KV --env staging
npx wrangler kv:namespace create CACHE_KV --env staging

# Configure in wrangler.toml
[env.staging]
kv_namespaces = [
  { binding = "AUTH_SESSION_KV", id = "staging-auth-session-id" },
  { binding = "CACHE_KV", id = "staging-cache-id" }
]
```

### Production

```bash
# Create production namespaces
npx wrangler kv:namespace create AUTH_SESSION_KV
npx wrangler kv:namespace create CACHE_KV

# Configure in wrangler.toml
[env.production]
kv_namespaces = [
  { binding = "AUTH_SESSION_KV", id = "production-auth-session-id" },
  { binding = "CACHE_KV", id = "production-cache-id" }
]
```

---

## Code Organization & Shared Packages

Following the monorepo structure defined in [CodeStructure.md](./CodeStructure.md), KV client logic should be organized in shared packages for reuse across the SvelteKit app and Cloudflare Workers.

### Package Structure

```
Codex/
├── packages/
│   ├── cloudflare-clients/          # ✅ KV clients live here
│   │   ├── src/
│   │   │   ├── kv/
│   │   │   │   ├── index.ts         # Export all KV clients
│   │   │   │   ├── session-cache.ts # Session caching client
│   │   │   │   ├── rate-limiter.ts  # Rate limiting client
│   │   │   │   └── cache.ts         # General cache client
│   │   │   ├── r2/
│   │   │   │   └── ...
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── auth/                         # Uses @codex/cloudflare-clients
│   │   └── src/
│   │       └── session-manager.ts   # Imports session cache client
│   │
│   └── core-services/                # Uses @codex/cloudflare-clients
│       └── src/
│           └── purchases/
│               └── service.ts       # Imports cache client
│
├── apps/web/                         # Imports @codex/cloudflare-clients
│   └── src/
│       ├── app.d.ts                 # Platform types
│       ├── hooks.server.ts          # Uses session cache
│       └── routes/
│
└── workers/                          # Imports @codex/cloudflare-clients
    ├── queue-consumer/              # Uses KV clients
    └── webhook-handler/             # Uses KV clients
```

### 1. Shared KV Clients (`packages/cloudflare-clients`)

**Purpose**: Framework-agnostic KV client implementations that can be used by both SvelteKit app and Workers.

#### Session Cache Client

**`packages/cloudflare-clients/src/kv/session-cache.ts`**:
```typescript
import type { KVNamespace } from '@cloudflare/workers-types';

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

export class SessionCacheClient {
  constructor(private kv: KVNamespace) {}

  /**
   * Get cached session by token
   */
  async get(sessionToken: string): Promise<CachedSession | null> {
    const key = `session:${sessionToken}`;
    const cached = await this.kv.get(key, 'json');
    return cached as CachedSession | null;
  }

  /**
   * Cache session with TTL matching expiry
   */
  async set(
    sessionToken: string,
    data: CachedSession
  ): Promise<void> {
    const key = `session:${sessionToken}`;
    const ttl = Math.floor(
      (new Date(data.session.expiresAt).getTime() - Date.now()) / 1000
    );

    await this.kv.put(key, JSON.stringify(data), {
      expirationTtl: Math.max(ttl, 60), // Min 1 minute
    });
  }

  /**
   * Invalidate session cache (on logout/password change)
   */
  async delete(sessionToken: string): Promise<void> {
    const key = `session:${sessionToken}`;
    await this.kv.delete(key);
  }

  /**
   * Invalidate all sessions for a user (password change)
   */
  async deleteUserSessions(userId: string): Promise<void> {
    // Note: KV doesn't support prefix deletion
    // Sessions will expire naturally via TTL
    // Alternative: Track session tokens in DB and delete individually
    console.warn('User session invalidation relies on TTL expiry');
  }
}
```

#### Rate Limiter Client

**`packages/cloudflare-clients/src/kv/rate-limiter.ts`**:
```typescript
import type { KVNamespace } from '@cloudflare/workers-types';

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

export class RateLimiterClient {
  constructor(private kv: KVNamespace) {}

  /**
   * Check and increment rate limit counter
   */
  async checkLimit(
    identifier: string,
    config: RateLimitConfig
  ): Promise<RateLimitResult> {
    const key = `${config.keyPrefix}${identifier}`;
    const now = Date.now();

    // Get current count
    const data = await this.kv.get(key, 'json') as {
      count: number;
      resetAt: number;
    } | null;

    // First request or window expired
    if (!data || now > data.resetAt) {
      const resetAt = now + config.window * 1000;
      await this.kv.put(key, JSON.stringify({ count: 1, resetAt }), {
        expirationTtl: config.window,
      });

      return {
        allowed: true,
        remaining: config.limit - 1,
        resetAt,
      };
    }

    // Check if limit exceeded
    if (data.count >= config.limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: data.resetAt,
      };
    }

    // Increment counter
    await this.kv.put(
      key,
      JSON.stringify({ count: data.count + 1, resetAt: data.resetAt }),
      { expirationTtl: Math.ceil((data.resetAt - now) / 1000) }
    );

    return {
      allowed: true,
      remaining: config.limit - data.count - 1,
      resetAt: data.resetAt,
    };
  }

  /**
   * Reset rate limit for identifier (admin override)
   */
  async reset(identifier: string, keyPrefix: string): Promise<void> {
    const key = `${keyPrefix}${identifier}`;
    await this.kv.delete(key);
  }
}
```

#### General Cache Client

**`packages/cloudflare-clients/src/kv/cache.ts`**:
```typescript
import type { KVNamespace } from '@cloudflare/workers-types';

export class CacheClient {
  constructor(private kv: KVNamespace) {}

  /**
   * Get cached value
   */
  async get<T>(key: string): Promise<T | null> {
    const cached = await this.kv.get(key, 'json');
    return cached as T | null;
  }

  /**
   * Set cached value with TTL
   */
  async set(
    key: string,
    value: any,
    ttlSeconds: number
  ): Promise<void> {
    await this.kv.put(key, JSON.stringify(value), {
      expirationTtl: ttlSeconds,
    });
  }

  /**
   * Delete cached value
   */
  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }

  /**
   * Delete multiple keys (batch invalidation)
   */
  async deleteMany(keys: string[]): Promise<void> {
    await Promise.all(keys.map(key => this.kv.delete(key)));
  }

  /**
   * Read-through cache pattern
   */
  async getOrSet<T>(
    key: string,
    ttlSeconds: number,
    fetchFn: () => Promise<T>
  ): Promise<T> {
    // Try cache first
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Cache miss: fetch data
    const data = await fetchFn();

    // Populate cache
    await this.set(key, data, ttlSeconds);

    return data;
  }
}
```

#### Package Exports

**`packages/cloudflare-clients/src/kv/index.ts`**:
```typescript
export { SessionCacheClient } from './session-cache';
export { RateLimiterClient } from './rate-limiter';
export { CacheClient } from './cache';
export type { CachedSession } from './session-cache';
export type { RateLimitConfig, RateLimitResult } from './rate-limiter';
```

**`packages/cloudflare-clients/src/index.ts`**:
```typescript
export * from './kv';
export * from './r2';
```

**`packages/cloudflare-clients/package.json`**:
```json
{
  "name": "@codex/cloudflare-clients",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@cloudflare/workers-types": "^4.20241127.0"
  }
}
```

---

### 2. SvelteKit App Integration (`apps/web`)

#### Type Definitions

**`apps/web/src/app.d.ts`**:
```typescript
import type { KVNamespace } from '@cloudflare/workers-types';

declare global {
  namespace App {
    interface Platform {
      env?: {
        // KV Namespaces
        AUTH_SESSION_KV: KVNamespace;
        CACHE_KV: KVNamespace;

        // Queues
        TRANSCODING_QUEUE: Queue;

        // Environment variables
        DATABASE_URL: string;
        AUTH_SECRET: string;
        // ... other env vars
      };
    }

    interface Locals {
      user: User | null;
      session: Session | null;
    }
  }
}

export {};
```

#### Server Hooks (Session Caching)

**`apps/web/src/hooks.server.ts`**:
```typescript
import { SessionCacheClient } from '@codex/cloudflare-clients';
import { auth } from '@codex/auth';
import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';

// Session validation with KV caching
const sessionHandler: Handle = async ({ event, resolve }) => {
  const sessionCookie = event.cookies.get('codex-session');

  if (!sessionCookie) {
    event.locals.session = null;
    event.locals.user = null;
    return resolve(event);
  }

  // Get KV namespace from platform
  const kv = event.platform?.env?.AUTH_SESSION_KV;

  if (kv) {
    // Use session cache client
    const sessionCache = new SessionCacheClient(kv);
    const cached = await sessionCache.get(sessionCookie);

    if (cached) {
      // Cache hit!
      event.locals.session = cached.session;
      event.locals.user = cached.user;
      return resolve(event);
    }
  }

  // Cache miss or KV unavailable: fetch from database
  try {
    const session = await auth.api.getSession({
      headers: event.request.headers,
    });

    if (session) {
      event.locals.session = session;
      event.locals.user = session.user;

      // Populate cache if KV available
      if (kv) {
        const sessionCache = new SessionCacheClient(kv);
        await sessionCache.set(sessionCookie, {
          session,
          user: session.user,
        });
      }
    } else {
      event.locals.session = null;
      event.locals.user = null;
    }
  } catch (error) {
    console.error('Session validation error:', error);
    event.locals.session = null;
    event.locals.user = null;
  }

  return resolve(event);
};

export const handle = sequence(sessionHandler);
```

#### API Route (Rate Limiting)

**`apps/web/src/routes/api/auth/login/+server.ts`**:
```typescript
import { RateLimiterClient } from '@codex/cloudflare-clients';
import { auth } from '@codex/auth';
import { fail, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({
  request,
  cookies,
  getClientAddress,
  platform,
  url,
}) => {
  const data = await request.formData();
  const email = data.get('email') as string;
  const password = data.get('password') as string;

  // Rate limiting
  const kv = platform?.env?.AUTH_SESSION_KV;
  if (kv) {
    const rateLimiter = new RateLimiterClient(kv);
    const ip = getClientAddress();

    const result = await rateLimiter.checkLimit(ip, {
      limit: 5,
      window: 900, // 15 minutes
      keyPrefix: 'rl:login:',
    });

    if (!result.allowed) {
      return fail(429, {
        error: 'Too many login attempts. Please try again in 15 minutes.',
      });
    }
  }

  // ... rest of login logic
};
```

#### API Route (Content Caching)

**`apps/web/src/routes/api/content/+server.ts`**:
```typescript
import { CacheClient } from '@codex/cloudflare-clients';
import { db } from '@codex/database';
import { content } from '@codex/database/schema';
import { eq, and } from 'drizzle-orm';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform }) => {
  const categoryId = url.searchParams.get('category');

  if (!categoryId) {
    return json({ error: 'Category ID required' }, { status: 400 });
  }

  const kv = platform?.env?.CACHE_KV;

  if (kv) {
    const cache = new CacheClient(kv);
    const cacheKey = `cache:content:published:${categoryId}`;

    // Read-through cache pattern
    const contentList = await cache.getOrSet(
      cacheKey,
      300, // 5 minutes
      async () => {
        return db.query.content.findMany({
          where: and(
            eq(content.categoryId, categoryId),
            eq(content.status, 'published')
          ),
        });
      }
    );

    return json(contentList);
  }

  // No cache: fetch directly
  const contentList = await db.query.content.findMany({
    where: and(
      eq(content.categoryId, categoryId),
      eq(content.status, 'published')
    ),
  });

  return json(contentList);
};
```

---

### 3. Worker Integration

#### Queue Consumer Worker

**`workers/queue-consumer/src/index.ts`**:
```typescript
import { CacheClient } from '@codex/cloudflare-clients';
import type { KVNamespace } from '@cloudflare/workers-types';

interface Env {
  TRANSCODING_QUEUE: Queue;
  CACHE_KV: KVNamespace;
  RUNPOD_API_KEY: string;
  // ... other env vars
}

export default {
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    const cache = new CacheClient(env.CACHE_KV);

    for (const message of batch.messages) {
      const job = message.body;

      // Update processing status in cache
      await cache.set(
        `cache:media:processing-status:${job.mediaId}`,
        'transcoding',
        60 // 1 minute TTL
      );

      // Process job...
    }
  },
};
```

#### Webhook Handler Worker

**`workers/webhook-handler/src/index.ts`**:
```typescript
import { SessionCacheClient } from '@codex/cloudflare-clients';
import { purchasesService } from '@codex/core-services';
import type { KVNamespace } from '@cloudflare/workers-types';

interface Env {
  AUTH_SESSION_KV: KVNamespace;
  STRIPE_WEBHOOK_SECRET: string;
  // ... other env vars
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Webhook handlers can use KV clients too
    const sessionCache = new SessionCacheClient(env.AUTH_SESSION_KV);

    // ... webhook processing logic

    return new Response('OK');
  },
};
```

---

### 4. Testing KV Clients

Following the testing structure from [CodeStructure.md](./CodeStructure.md), KV clients should have comprehensive unit tests.

#### Unit Tests for KV Clients

**`packages/cloudflare-clients/tests/unit/kv/session-cache.test.ts`**:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { SessionCacheClient } from '../../../src/kv/session-cache';

// Mock KV namespace
class MockKV {
  private store = new Map<string, { value: string; expiration: number }>();

  async get(key: string, type: 'json' | 'text' = 'text'): Promise<any> {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.expiration) {
      this.store.delete(key);
      return null;
    }
    return type === 'json' ? JSON.parse(item.value) : item.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiration = options?.expirationTtl
      ? Date.now() + options.expirationTtl * 1000
      : Date.now() + 86400000; // 24 hours default

    this.store.set(key, { value, expiration });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

describe('SessionCacheClient', () => {
  let kv: MockKV;
  let client: SessionCacheClient;

  beforeEach(() => {
    kv = new MockKV();
    client = new SessionCacheClient(kv as any);
  });

  it('should cache and retrieve session', async () => {
    const sessionData = {
      session: {
        id: 'session-123',
        userId: 'user-456',
        token: 'token-789',
        expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour
      },
      user: {
        id: 'user-456',
        email: 'test@example.com',
        name: 'Test User',
        role: 'customer' as const,
        emailVerified: true,
      },
    };

    await client.set('token-789', sessionData);

    const cached = await client.get('token-789');
    expect(cached).toEqual(sessionData);
  });

  it('should return null for non-existent session', async () => {
    const cached = await client.get('non-existent');
    expect(cached).toBeNull();
  });

  it('should delete session', async () => {
    const sessionData = {
      session: {
        id: 'session-123',
        userId: 'user-456',
        token: 'token-789',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
      user: {
        id: 'user-456',
        email: 'test@example.com',
        name: 'Test User',
        role: 'customer' as const,
        emailVerified: true,
      },
    };

    await client.set('token-789', sessionData);
    await client.delete('token-789');

    const cached = await client.get('token-789');
    expect(cached).toBeNull();
  });

  it('should set TTL based on session expiry', async () => {
    const expiresAt = new Date(Date.now() + 120000); // 2 minutes
    const sessionData = {
      session: {
        id: 'session-123',
        userId: 'user-456',
        token: 'token-789',
        expiresAt: expiresAt.toISOString(),
      },
      user: {
        id: 'user-456',
        email: 'test@example.com',
        name: 'Test User',
        role: 'customer' as const,
        emailVerified: true,
      },
    };

    await client.set('token-789', sessionData);

    // Should be cached
    const cached = await client.get('token-789');
    expect(cached).toEqual(sessionData);

    // Should respect TTL (test with mock time if needed)
  });
});
```

**`packages/cloudflare-clients/tests/unit/kv/rate-limiter.test.ts`**:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiterClient } from '../../../src/kv/rate-limiter';

describe('RateLimiterClient', () => {
  let kv: MockKV;
  let client: RateLimiterClient;

  beforeEach(() => {
    kv = new MockKV();
    client = new RateLimiterClient(kv as any);
  });

  it('should allow requests within limit', async () => {
    const result = await client.checkLimit('192.168.1.1', {
      limit: 5,
      window: 60,
      keyPrefix: 'rl:test:',
    });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('should block requests exceeding limit', async () => {
    // Make 5 requests (hit limit)
    for (let i = 0; i < 5; i++) {
      await client.checkLimit('192.168.1.1', {
        limit: 5,
        window: 60,
        keyPrefix: 'rl:test:',
      });
    }

    // 6th request should be blocked
    const result = await client.checkLimit('192.168.1.1', {
      limit: 5,
      window: 60,
      keyPrefix: 'rl:test:',
    });

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('should reset counter after window expires', async () => {
    // Make 5 requests
    for (let i = 0; i < 5; i++) {
      await client.checkLimit('192.168.1.1', {
        limit: 5,
        window: 1, // 1 second window
        keyPrefix: 'rl:test:',
      });
    }

    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 1100));

    // Should allow new request
    const result = await client.checkLimit('192.168.1.1', {
      limit: 5,
      window: 60,
      keyPrefix: 'rl:test:',
    });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('should track different identifiers separately', async () => {
    await client.checkLimit('192.168.1.1', {
      limit: 5,
      window: 60,
      keyPrefix: 'rl:test:',
    });

    const result = await client.checkLimit('192.168.1.2', {
      limit: 5,
      window: 60,
      keyPrefix: 'rl:test:',
    });

    expect(result.remaining).toBe(4); // Should start fresh for new IP
  });
});
```

**`packages/cloudflare-clients/tests/unit/kv/cache.test.ts`**:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { CacheClient } from '../../../src/kv/cache';

describe('CacheClient', () => {
  let kv: MockKV;
  let client: CacheClient;

  beforeEach(() => {
    kv = new MockKV();
    client = new CacheClient(kv as any);
  });

  it('should cache and retrieve value', async () => {
    await client.set('test-key', { foo: 'bar' }, 300);

    const cached = await client.get('test-key');
    expect(cached).toEqual({ foo: 'bar' });
  });

  it('should implement read-through cache pattern', async () => {
    let fetchCalled = false;
    const fetchFn = async () => {
      fetchCalled = true;
      return { data: 'from-source' };
    };

    // First call: cache miss, should fetch
    const result1 = await client.getOrSet('cache-key', 300, fetchFn);
    expect(result1).toEqual({ data: 'from-source' });
    expect(fetchCalled).toBe(true);

    // Second call: cache hit, should NOT fetch
    fetchCalled = false;
    const result2 = await client.getOrSet('cache-key', 300, fetchFn);
    expect(result2).toEqual({ data: 'from-source' });
    expect(fetchCalled).toBe(false);
  });

  it('should delete cached value', async () => {
    await client.set('test-key', { foo: 'bar' }, 300);
    await client.delete('test-key');

    const cached = await client.get('test-key');
    expect(cached).toBeNull();
  });

  it('should batch delete multiple keys', async () => {
    await client.set('key1', 'value1', 300);
    await client.set('key2', 'value2', 300);
    await client.set('key3', 'value3', 300);

    await client.deleteMany(['key1', 'key2']);

    expect(await client.get('key1')).toBeNull();
    expect(await client.get('key2')).toBeNull();
    expect(await client.get('key3')).toBe('value3'); // Not deleted
  });
});
```

#### Integration Tests (with Miniflare)

For integration testing with actual KV behavior, use Miniflare:

**`packages/cloudflare-clients/tests/integration/kv.test.ts`**:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Miniflare } from 'miniflare';
import { SessionCacheClient, RateLimiterClient, CacheClient } from '../../src/kv';

describe('KV Integration Tests', () => {
  let mf: Miniflare;
  let kv: KVNamespace;

  beforeEach(async () => {
    mf = new Miniflare({
      modules: true,
      kvNamespaces: ['TEST_KV'],
    });

    kv = await mf.getKVNamespace('TEST_KV');
  });

  it('should work with actual KV namespace', async () => {
    const cache = new CacheClient(kv);

    await cache.set('test', { value: 123 }, 60);
    const result = await cache.get('test');

    expect(result).toEqual({ value: 123 });
  });

  // More integration tests...
});
```

#### Package Testing Configuration

**`packages/cloudflare-clients/vitest.config.ts`**:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
    },
  },
});
```

---

### 5. Import Patterns

Following the monorepo import rules from [CodeStructure.md](./CodeStructure.md):

**✅ Good - Using shared package imports:**
```typescript
// In apps/web/src/hooks.server.ts
import { SessionCacheClient } from '@codex/cloudflare-clients';
import { auth } from '@codex/auth';
import { db } from '@codex/database';

// In workers/queue-consumer/src/index.ts
import { CacheClient } from '@codex/cloudflare-clients';
import { db } from '@codex/database';
```

**❌ Bad - Importing from apps/web into workers:**
```typescript
// NEVER do this in workers
import { something } from '../../../apps/web/src/lib/utils';
```

**✅ Good - Worker-specific code stays local:**
```typescript
// workers/queue-consumer/src/utils/helpers.ts
export function workerSpecificHelper() {
  // Worker-only logic
}

// workers/queue-consumer/src/index.ts
import { workerSpecificHelper } from './utils/helpers';
```

---

## Wrangler Configuration

**`wrangler.toml`**:
```toml
name = "codex-web"
main = "build/index.js"  # SvelteKit adapter output
compatibility_date = "2024-01-01"

# Development
[env.development]
kv_namespaces = [
  { binding = "AUTH_SESSION_KV", id = "dev-auth-session-id", preview_id = "dev-auth-session-preview-id" },
  { binding = "CACHE_KV", id = "dev-cache-id", preview_id = "dev-cache-preview-id" }
]

# Staging
[env.staging]
kv_namespaces = [
  { binding = "AUTH_SESSION_KV", id = "staging-auth-session-id" },
  { binding = "CACHE_KV", id = "staging-cache-id" }
]

# Production
[env.production]
kv_namespaces = [
  { binding = "AUTH_SESSION_KV", id = "prod-auth-session-id" },
  { binding = "CACHE_KV", id = "prod-cache-id" }
]

# Queue Bindings (for transcoding worker)
[[queues.producers]]
queue = "transcoding-queue"
binding = "TRANSCODING_QUEUE"
```

---

## Monitoring & Operations

### KV Metrics

**Cloudflare Dashboard Metrics**:
- Read operations / second
- Write operations / second
- Delete operations / second
- Storage usage (bytes)
- Cache hit rate (calculate from logs)

**Custom Monitoring** (optional):
```typescript
// Wrapper to track KV performance
class MonitoredKV {
  constructor(private kv: KVNamespace, private metric: string) {}

  async get(key: string, type?: 'text' | 'json'): Promise<any> {
    const start = Date.now();
    const result = await this.kv.get(key, type);
    const duration = Date.now() - start;

    console.log(`KV.get(${this.metric}:${key}): ${duration}ms, hit=${!!result}`);

    return result;
  }

  // Similar wrappers for put, delete...
}
```

### Debugging KV

**List Keys** (Wrangler CLI):
```bash
# List all keys in namespace
npx wrangler kv:key list --namespace-id=your-namespace-id

# List keys with prefix
npx wrangler kv:key list --namespace-id=your-namespace-id --prefix="session:"
```

**Get Value**:
```bash
npx wrangler kv:key get "session:abc123" --namespace-id=your-namespace-id
```

**Delete Key**:
```bash
npx wrangler kv:key delete "session:abc123" --namespace-id=your-namespace-id
```

**Bulk Delete** (clear all sessions):
```bash
# Get all session keys
npx wrangler kv:key list --namespace-id=your-namespace-id --prefix="session:" > sessions.json

# Delete each key (script required)
# Create delete-sessions.sh:
#!/bin/bash
cat sessions.json | jq -r '.[].name' | while read key; do
  npx wrangler kv:key delete "$key" --namespace-id=your-namespace-id
done
```

---

## Cost Estimation

**Cloudflare KV Pricing** (as of 2025):
- **Reads**: $0.50 per 10M operations
- **Writes**: $5.00 per 1M operations
- **Deletes**: $5.00 per 1M operations
- **Storage**: $0.50 per GB-month

**Free Tier**:
- 100,000 reads/day
- 1,000 writes/day
- 1,000 deletes/day
- 1 GB storage

**MVP Estimate** (100 daily active users):
- **Reads**: ~500k/month (session checks, rate limits, cache) → **Free**
- **Writes**: ~50k/month (session creation, rate limit updates) → **Free**
- **Deletes**: ~5k/month (session invalidation) → **Free**
- **Storage**: <100 MB → **Free**

**Total MVP Cost**: **$0/month** (within free tier)

**At Scale** (10,000 daily active users):
- **Reads**: ~50M/month → $0.25
- **Writes**: ~5M/month → $25
- **Deletes**: ~500k/month → $2.50
- **Storage**: ~5 GB → $2.50

**Total at Scale**: **~$30/month**

---

## Best Practices

### 1. Key Naming Conventions
- Use prefixes for namespacing: `session:`, `rl:`, `cache:`
- Include entity type and ID: `cache:content:{id}`
- Use colons (`:`) as separators (easy to filter/search)
- Keep keys short (max 512 bytes)

### 2. Value Size Limits
- **Max Value Size**: 25 MB
- **Recommended Max**: <100 KB per value (for performance)
- If storing large data, use R2 and cache the R2 URL in KV

### 3. TTL Strategy
- Always set `expirationTtl` to prevent stale data
- Use short TTLs for frequently changing data (1-5 min)
- Use long TTLs for static data (1-24 hours)
- Never use KV for data without TTL (use Postgres)

### 4. Graceful Degradation
```typescript
// Always handle KV unavailability
const kv = event.platform?.env?.AUTH_SESSION_KV;

if (!kv) {
  console.warn('KV not available, falling back to database');
  return await fetchFromDatabase();
}

// Use KV...
```

### 5. Cache Invalidation
- **Write-Through**: Update DB first, then invalidate cache
- **Lazy Invalidation**: Let TTL handle most cleanup
- **Targeted Invalidation**: Delete specific keys on data change
- **Avoid Cascading Deletes**: Design keys to minimize invalidation impact

### 6. Avoid Race Conditions
```typescript
// BAD: Race condition (read-modify-write without atomicity)
const data = await kv.get('counter', 'json');
await kv.put('counter', JSON.stringify({ count: data.count + 1 }));

// GOOD: Use TTL and accept eventual consistency
const resetAt = Date.now() + 900000; // 15 min
await kv.put('counter', JSON.stringify({ count: 1, resetAt }), {
  expirationTtl: 900,
});
```

---

## Future Enhancements (Phase 2+)

### User-Specific Caching
```
cache:user:{userId}:library          # Cached user library
cache:user:{userId}:purchases        # Cached purchase history
cache:user:{userId}:progress         # Playback progress
```

### Analytics Caching
```
cache:analytics:revenue:monthly:{month}     # Monthly revenue aggregates
cache:analytics:top-content:weekly:{week}   # Top content rankings
cache:analytics:user-cohorts:{cohortId}     # User cohort analysis
```

### Multi-Region Read Replicas
- KV automatically replicates globally
- No additional configuration needed
- ~50-100ms read latency worldwide

### KV as Distributed Lock (Phase 3)
```typescript
// Simple distributed lock using KV
async function acquireLock(key: string, ttl: number): Promise<boolean> {
  try {
    await kv.put(`lock:${key}`, 'locked', { expirationTtl: ttl });
    return true;
  } catch (error) {
    return false; // Lock already held
  }
}
```

---

## Related Documents

- [Auth TDD](../features/auth/ttd-dphase-1.md) - Session caching implementation
- [Rate Limiting Strategy](../security/RateLimiting.md) - Rate limit counters
- [Content Management TDD](../features/content-management/ttd-dphase-1.md) - Content caching
- [Media Transcoding TDD](../features/media-transcoding/ttd-dphase-1.md) - Status polling
- [Environment Management](./EnvironmentManagement.md) - Environment setup
- [Cloudflare Setup](./CloudflareSetup.md) - Overall Cloudflare configuration

---

**Document Version**: 1.0
**Last Updated**: 2025-10-26
**Status**: Ready for Implementation
