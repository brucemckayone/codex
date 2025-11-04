# @codex/security

Shared security utilities for Cloudflare Workers in the Codex platform.

## Features

- **Security Headers** - Automatic CSP, HSTS, X-Frame-Options, and more
- **Rate Limiting** - KV-based distributed rate limiting with presets
- **Worker Auth** - HMAC-based authentication for worker-to-worker communication
- **Zero Dependencies** - Only requires `hono` (already in your workers)

## Installation

This package is already available in the monorepo workspace:

```json
{
  "dependencies": {
    "@codex/security": "workspace:*"
  }
}
```

## Usage

### Security Headers

Apply security headers to all routes:

```typescript
import { Hono } from 'hono';
import { securityHeaders, CSP_PRESETS } from '@codex/security';

const app = new Hono<{ Bindings: Bindings }>();

// Apply to all routes
app.use('*', (c, next) => {
  return securityHeaders({
    environment: c.env.ENVIRONMENT,
    csp: CSP_PRESETS.api, // or CSP_PRESETS.stripe for Stripe integration
  })(c, next);
});
```

**Custom CSP:**

```typescript
app.use('*', (c, next) => {
  return securityHeaders({
    environment: c.env.ENVIRONMENT,
    csp: {
      scriptSrc: ["'self'", 'https://js.stripe.com'],
      frameSrc: ['https://js.stripe.com'],
      connectSrc: ["'self'", 'https://api.stripe.com'],
    },
  })(c, next);
});
```

**Headers Applied:**

- `Content-Security-Policy` - Prevents XSS and code injection
- `X-Frame-Options: DENY` - Prevents clickjacking
- `X-Content-Type-Options: nosniff` - Prevents MIME sniffing
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` - Disables unnecessary browser features
- `Strict-Transport-Security` - HTTPS enforcement (production only)

### Rate Limiting

Rate limit endpoints using Cloudflare KV:

**Setup KV Namespace** (in `wrangler.toml`):

```toml
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "your-kv-namespace-id"
```

**Apply Rate Limiting:**

```typescript
import { rateLimit, RATE_LIMIT_PRESETS } from '@codex/security';

// Use preset (auth: 5 req/15min, api: 100 req/min, webhook: 1000 req/min)
app.use('*', (c, next) => {
  return rateLimit({
    kv: c.env.RATE_LIMIT_KV,
    ...RATE_LIMIT_PRESETS.auth,
  })(c, next);
});

// Or custom configuration
const loginLimiter = rateLimit({
  kv: c.env.RATE_LIMIT_KV,
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5,
});

app.post('/login', loginLimiter, async (c) => {
  // ... login logic
});
```

**Fallback (Development):**

If KV is not bound, rate limiting falls back to in-memory storage (not recommended for production with multiple worker instances).

**Response Headers:**

- `X-RateLimit-Limit` - Max requests per window
- `X-RateLimit-Remaining` - Requests remaining
- `X-RateLimit-Reset` - Unix timestamp when limit resets
- `Retry-After` - Seconds to wait (when rate limited)

### Worker-to-Worker Authentication

Secure communication between workers using HMAC signatures:

**Setup Shared Secret** (in GitHub Secrets):

```bash
# Generate secret
openssl rand -base64 32

# Add to GitHub Secrets as WORKER_SHARED_SECRET
# Then deploy to all workers via wrangler
```

**Receiving Worker** (e.g., `stripe-webhook-handler`):

```typescript
import { workerAuth } from '@codex/security';

// Protect internal endpoints
app.use('/internal/*', workerAuth({
  secret: c.env.WORKER_SHARED_SECRET,
  allowedOrigins: [
    'https://auth.revelations.studio',
    'https://codex.revelations.studio'
  ],
}));

app.post('/internal/webhook', async (c) => {
  // Only accessible with valid signature from allowed origins
  // ... webhook logic
});
```

**Calling Worker** (e.g., `auth` worker):

```typescript
import { workerFetch } from '@codex/security';

const response = await workerFetch(
  'https://api.revelations.studio/internal/webhook',
  {
    method: 'POST',
    body: JSON.stringify({ userId: '123', event: 'login' }),
  },
  c.env.WORKER_SHARED_SECRET
);
```

**Security Features:**

- HMAC-SHA256 signatures
- Timestamp-based replay protection (5-minute window)
- Origin validation (optional allowlist)
- Clock skew tolerance (60 seconds)

## CSP Presets

```typescript
import { CSP_PRESETS } from '@codex/security';

// API Worker (restrictive, no frontend)
CSP_PRESETS.api

// Stripe Integration (allows Stripe.js and Elements)
CSP_PRESETS.stripe
```

## Rate Limit Presets

```typescript
import { RATE_LIMIT_PRESETS } from '@codex/security';

RATE_LIMIT_PRESETS.auth      // 5 requests / 15 minutes
RATE_LIMIT_PRESETS.api       // 100 requests / 1 minute
RATE_LIMIT_PRESETS.webhook   // 1000 requests / 1 minute
RATE_LIMIT_PRESETS.web       // 300 requests / 1 minute
```

## Example: Complete Worker Setup

```typescript
import { Hono } from 'hono';
import { ObservabilityClient, createRequestTimer } from '@codex/observability';
import { securityHeaders, CSP_PRESETS, rateLimit, RATE_LIMIT_PRESETS, workerAuth } from '@codex/security';

type Bindings = {
  ENVIRONMENT: string;
  RATE_LIMIT_KV: KVNamespace;
  WORKER_SHARED_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// 1. Security headers
app.use('*', (c, next) => {
  return securityHeaders({
    environment: c.env.ENVIRONMENT,
    csp: CSP_PRESETS.api,
  })(c, next);
});

// 2. Rate limiting
app.use('*', (c, next) => {
  return rateLimit({
    kv: c.env.RATE_LIMIT_KV,
    ...RATE_LIMIT_PRESETS.webhook,
  })(c, next);
});

// 3. Worker-to-worker auth (internal endpoints only)
app.use('/internal/*', workerAuth({
  secret: c.env.WORKER_SHARED_SECRET,
  allowedOrigins: ['https://auth.revelations.studio'],
}));

// 4. Request timing
app.use('*', async (c, next) => {
  const obs = new ObservabilityClient('my-worker', c.env.ENVIRONMENT);
  const timer = createRequestTimer(obs, c.req);
  await next();
  timer.end(c.res.status);
});

// Public endpoint
app.get('/health', (c) => {
  return c.json({ status: 'healthy' });
});

// Protected internal endpoint
app.post('/internal/action', async (c) => {
  // Only accessible with valid worker signature
  const body = await c.req.json();
  // ... process action
  return c.json({ success: true });
});

export default app;
```

## Security Best Practices

1. **Always apply security headers** - Use `securityHeaders()` on all workers
2. **Rate limit auth endpoints** - Use `RATE_LIMIT_PRESETS.auth` for login/register
3. **Use worker auth for internal APIs** - Never expose internal endpoints publicly
4. **Bind KV for rate limiting** - In-memory fallback is not production-safe
5. **Keep CSP strict** - Only add exceptions when necessary (e.g., Stripe.js)
6. **Rotate secrets regularly** - WORKER_SHARED_SECRET should be rotated quarterly

## Testing

```typescript
import { describe, it, expect } from 'vitest';
import app from './index';

describe('Security Headers', () => {
  it('should include CSP header', async () => {
    const res = await app.request('/health');
    const csp = res.headers.get('content-security-policy');

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('should include X-Frame-Options', async () => {
    const res = await app.request('/health');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });
});

describe('Rate Limiting', () => {
  it('should rate limit after max requests', async () => {
    // Make 1001 requests (webhook preset is 1000/min)
    for (let i = 0; i < 1001; i++) {
      const res = await app.request('/webhook', { method: 'POST' });
      if (i < 1000) {
        expect(res.status).not.toBe(429);
      } else {
        expect(res.status).toBe(429);
      }
    }
  });
});
```

## Troubleshooting

**CSP Blocking Resources:**

If your CSP is blocking legitimate resources, check browser console for violations and update your CSP:

```typescript
securityHeaders({
  csp: {
    scriptSrc: ["'self'", 'https://trusted-cdn.com'],
  },
})
```

**Rate Limiting Not Working:**

1. Verify KV namespace is bound in `wrangler.toml`
2. Check worker logs for "Using in-memory store" warning
3. Ensure multiple worker instances are using the same KV namespace

**Worker Auth Failing:**

1. Verify `WORKER_SHARED_SECRET` is identical in all workers
2. Check timestamp is within 5-minute window (clock skew)
3. Ensure request body is identical to what was signed

## License

Internal use only - Codex platform.
