# Rate Limiting Strategy

## Overview

Rate limiting protects the platform from abuse, brute-force attacks, and excessive API usage. This document defines rate limiting strategies for Phase 1 MVP.

## Phase 1: Cloudflare KV-Based Rate Limiting

### Why Cloudflare KV?

- **Distributed**: Works across all Cloudflare edge locations
- **Fast**: Sub-millisecond read/write operations
- **Persistent**: Data survives server restarts
- **Integrated**: Native Cloudflare Pages/Workers integration

### Rate Limiting Targets

| Endpoint/Action                                                      | Limit        | Window     | Rationale                   |
| -------------------------------------------------------------------- | ------------ | ---------- | --------------------------- |
| **Login** (`POST /api/auth/login`)                                   | 5 attempts   | 15 minutes | Prevent brute-force attacks |
| **Registration** (`POST /api/auth/register`)                         | 3 attempts   | 1 hour     | Prevent spam accounts       |
| **Password Reset Request** (`POST /api/auth/forgot-password`)        | 3 attempts   | 1 hour     | Prevent email bombing       |
| **Email Verification Resend** (`POST /api/auth/resend-verification`) | 5 attempts   | 1 hour     | Prevent email spam          |
| **API Routes** (general)                                             | 100 requests | 1 minute   | Prevent API abuse           |
| **Content Upload** (`POST /api/content/upload`)                      | 10 uploads   | 1 hour     | Prevent storage abuse       |

### Implementation Strategy

#### 1. Rate Limiter Utility (`packages/web/src/lib/server/rateLimit.ts`)

```typescript
import type { KVNamespace } from '@cloudflare/workers-types';

interface RateLimitConfig {
  limit: number; // Max attempts
  window: number; // Window in seconds
  keyPrefix: string; // KV key prefix (e.g., 'rl:login:')
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // Unix timestamp
}

export async function rateLimit(
  kv: KVNamespace,
  identifier: string, // IP address, user ID, etc.
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const key = `${config.keyPrefix}${identifier}`;
  const now = Date.now();

  // Get current count from KV
  const data = (await kv.get(key, 'json')) as {
    count: number;
    resetAt: number;
  } | null;

  if (!data) {
    // First request in window
    const resetAt = now + config.window * 1000;
    await kv.put(key, JSON.stringify({ count: 1, resetAt }), {
      expirationTtl: config.window,
    });

    return {
      allowed: true,
      remaining: config.limit - 1,
      resetAt,
    };
  }

  // Check if window expired
  if (now > data.resetAt) {
    // Window expired, reset counter
    const resetAt = now + config.window * 1000;
    await kv.put(key, JSON.stringify({ count: 1, resetAt }), {
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
  await kv.put(
    key,
    JSON.stringify({ count: data.count + 1, resetAt: data.resetAt }),
    {
      expirationTtl: Math.ceil((data.resetAt - now) / 1000),
    }
  );

  return {
    allowed: true,
    remaining: config.limit - data.count - 1,
    resetAt: data.resetAt,
  };
}
```

#### 2. Rate Limit Middleware (`hooks.server.ts`)

```typescript
import { rateLimit } from '$lib/server/rateLimit';
import { error } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  // Get Cloudflare KV from platform
  const kv = event.platform?.env?.KV;

  if (!kv) {
    console.warn('KV namespace not available - rate limiting disabled');
    return resolve(event);
  }

  // Get client IP
  const ip = event.getClientAddress();

  // Apply rate limiting to sensitive routes
  if (event.url.pathname.startsWith('/api/auth/')) {
    const result = await rateLimit(kv, ip, {
      limit: 10, // General auth rate limit
      window: 60, // 1 minute
      keyPrefix: 'rl:auth:',
    });

    if (!result.allowed) {
      throw error(429, {
        message: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
      });
    }

    // Add rate limit headers
    event.setHeaders({
      'X-RateLimit-Limit': '10',
      'X-RateLimit-Remaining': result.remaining.toString(),
      'X-RateLimit-Reset': result.resetAt.toString(),
    });
  }

  return resolve(event);
};
```

#### 3. Route-Specific Rate Limiting

```typescript
// Example: Login route with stricter rate limiting
// packages/web/src/routes/api/auth/login/+server.ts

import { rateLimit } from '$lib/server/rateLimit';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({
  request,
  platform,
  getClientAddress,
}) => {
  const kv = platform?.env?.KV;
  const ip = getClientAddress();

  if (kv) {
    // Stricter rate limit for login attempts
    const result = await rateLimit(kv, ip, {
      limit: 5,
      window: 900, // 15 minutes
      keyPrefix: 'rl:login:',
    });

    if (!result.allowed) {
      throw error(429, {
        message: 'Too many login attempts. Please try again in 15 minutes.',
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
      });
    }
  }

  // ... handle login
};
```

### Testing Rate Limiting

```typescript
// packages/web/src/lib/server/rateLimit.test.ts

describe('rateLimit', () => {
  let mockKV: MockKVNamespace;

  beforeEach(() => {
    mockKV = createMockKV();
  });

  it('allows requests within limit', async () => {
    const result = await rateLimit(mockKV, '192.168.1.1', {
      limit: 5,
      window: 60,
      keyPrefix: 'rl:test:',
    });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('blocks requests exceeding limit', async () => {
    // Make 5 requests (hit limit)
    for (let i = 0; i < 5; i++) {
      await rateLimit(mockKV, '192.168.1.1', {
        limit: 5,
        window: 60,
        keyPrefix: 'rl:test:',
      });
    }

    // 6th request should be blocked
    const result = await rateLimit(mockKV, '192.168.1.1', {
      limit: 5,
      window: 60,
      keyPrefix: 'rl:test:',
    });

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('resets counter after window expires', async () => {
    // Make 5 requests
    for (let i = 0; i < 5; i++) {
      await rateLimit(mockKV, '192.168.1.1', {
        limit: 5,
        window: 60,
        keyPrefix: 'rl:test:',
      });
    }

    // Simulate time passing (61 seconds)
    vi.advanceTimersByTime(61000);

    // Should allow new request
    const result = await rateLimit(mockKV, '192.168.1.1', {
      limit: 5,
      window: 60,
      keyPrefix: 'rl:test:',
    });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });
});
```

---

## Environment Setup

### Cloudflare KV Namespace

**Development**:

```bash
# Create KV namespace for local development
npx wrangler kv:namespace create RATE_LIMIT_KV --preview

# Add to wrangler.toml
kv_namespaces = [
  { binding = "KV", id = "your-kv-id", preview_id = "your-preview-id" }
]
```

**Production**:

```bash
# Create production KV namespace
npx wrangler kv:namespace create RATE_LIMIT_KV

# Bind to Cloudflare Pages project
# (or add via Cloudflare dashboard)
```

### SvelteKit Adapter Configuration

```typescript
// svelte.config.js
import adapter from '@sveltejs/adapter-cloudflare';

export default {
  kit: {
    adapter: adapter({
      // KV namespace bindings
      routes: {
        include: ['/*'],
        exclude: ['<all>'],
      },
    }),
  },
};
```

---

## User Experience

### Error Messages

When rate limit is exceeded:

**Login**:

```json
{
  "error": "Too many login attempts. Please try again in 15 minutes.",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 900
}
```

**Registration**:

```json
{
  "error": "Too many registration attempts. Please try again later.",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 3600
}
```

### Response Headers

All rate-limited endpoints include:

```
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 3
X-RateLimit-Reset: 1698765432
```

---

## Future Enhancements (Phase 2+)

### User-Based Rate Limiting

Currently uses IP-based rate limiting. Future phases can add:

- **Authenticated User Rate Limiting**: Track by user ID instead of IP
- **Per-User + Per-IP**: Combine both for stricter control

### Adaptive Rate Limiting

- **Suspicious Activity Detection**: Reduce limits for suspicious IPs
- **Trusted Users**: Increase limits for verified, trusted users
- **Geographic Rate Limiting**: Different limits based on region

### DDoS Protection

- **Cloudflare DDoS Protection**: Leverage Cloudflare's built-in DDoS mitigation
- **CAPTCHA Integration**: Add CAPTCHA for repeated violations
- **IP Reputation**: Block known malicious IPs

---

## Related Documents

- [Auth TDD](../features/auth/ttd-dphase-1.md) - Authentication rate limiting integration
- [Security Overview](./SecurityOverview.md) - General security strategy
- [Testing Strategy](../infrastructure/TestingStrategy.md) - Rate limit testing

---

**Document Version**: 1.0
**Last Updated**: 2025-10-20
**Status**: Draft - Awaiting Review
