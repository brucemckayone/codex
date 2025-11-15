# @codex/security

Shared security utilities for Cloudflare Workers in the Codex platform.

## Features

- **Session Authentication** - Cookie-based user session authentication with KV caching
- **Security Headers** - Automatic CSP, HSTS, X-Frame-Options, and more
- **Rate Limiting** - KV-based distributed rate limiting with presets
- **Worker Auth** - HMAC-based authentication for worker-to-worker communication
- **Minimal Dependencies** - Only requires `hono` and `@codex/database`

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

### Session Authentication

Authenticate users based on session cookies stored in the database with optional KV caching for performance.

**Setup KV Namespace** (optional, recommended for performance):

```toml
# wrangler.toml
[[kv_namespaces]]
binding = "AUTH_SESSION_KV"
id = "your-session-kv-namespace-id"
```

**Optional Authentication** (user may or may not be authenticated):

```typescript
import { optionalAuth } from '@codex/security';

// Apply to all routes
app.use('*', optionalAuth({
  kv: c.env.AUTH_SESSION_KV,  // Optional: KV cache for performance
  cookieName: 'codex-session', // Optional: default is 'codex-session'
  enableLogging: false,        // Optional: enable auth logging
}));

// In route handlers, check if user is authenticated
app.get('/api/content', async (c) => {
  const user = c.get('user');      // UserData | undefined
  const session = c.get('session'); // SessionData | undefined

  if (user) {
    // Return personalized content
    return c.json({ content: await getContentFor(user.id) });
  } else {
    // Return public content
    return c.json({ content: await getPublicContent() });
  }
});
```

**Required Authentication** (401 if not authenticated):

```typescript
import { requireAuth } from '@codex/security';

// Protect specific routes
app.use('/api/protected/*', requireAuth({
  kv: c.env.AUTH_SESSION_KV,
}));

// User is guaranteed to exist in protected routes
app.get('/api/protected/profile', (c) => {
  const user = c.get('user');      // UserData (guaranteed to exist)
  const session = c.get('session'); // SessionData (guaranteed to exist)

  return c.json({
    profile: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
    }
  });
});

// Returns 401 with standard error format if not authenticated
// {
//   "error": {
//     "code": "UNAUTHORIZED",
//     "message": "Authentication required"
//   }
// }
```

**Session Data Types:**

```typescript
// Available on context after authentication
interface UserData {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface SessionData {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date | string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}
```

**Performance Features:**

- KV caching reduces database queries (cache TTL matches session expiration)
- Graceful degradation to database-only mode if KV fails
- Automatic cache invalidation for expired sessions
- Fire-and-forget cache writes (don't block request)

**Security Features:**

- Session expiration validation from database (defense in depth)
- Automatic expired session cleanup
- No sensitive data exposed in error messages
- Parameterized queries prevent SQL injection
- Cookie extraction uses regex (no eval/injection risks)

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

## API Reference

### Session Authentication

#### `optionalAuth(config?: SessionAuthConfig)`

Middleware that sets session and user on context if valid session cookie exists. Always proceeds to next middleware (fail open).

**Parameters:**
```typescript
{
  kv?: KVNamespace;           // Optional: KV for session caching
  cookieName?: string;        // Default: 'codex-session'
  enableLogging?: boolean;    // Default: false
}
```

**Context Variables:**
- `c.get('user')` - `UserData | undefined`
- `c.get('session')` - `SessionData | undefined`

#### `requireAuth(config?: SessionAuthConfig)`

Middleware that requires valid session. Returns 401 if session missing or invalid (fail closed).

**Parameters:** Same as `optionalAuth`

**Context Variables:**
- `c.get('user')` - `UserData` (guaranteed to exist)
- `c.get('session')` - `SessionData` (guaranteed to exist)

**Error Response (401):**
```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required"
  }
}
```

### Security Headers

#### `securityHeaders(options?: SecurityHeadersOptions)`

Middleware to add security headers to responses.

**Parameters:**
```typescript
{
  environment?: string;           // 'production' enables HSTS
  csp?: Partial<CSPDirectives>;   // Custom CSP directives
  disableFrameOptions?: boolean;  // Disable X-Frame-Options
}
```

**CSP Directives:**
```typescript
{
  defaultSrc: string[];
  scriptSrc: string[];
  styleSrc: string[];
  imgSrc: string[];
  fontSrc: string[];
  connectSrc: string[];
  frameSrc: string[];
  frameAncestors: string[];
  baseUri: string[];
  formAction: string[];
}
```

#### `CSP_PRESETS`

Pre-configured CSP policies:
- `CSP_PRESETS.api` - Restrictive policy for API-only workers
- `CSP_PRESETS.stripe` - Allows Stripe.js and Elements

### Rate Limiting

#### `rateLimit(options?: RateLimitOptions)`

KV-based rate limiting middleware with distributed counter.

**Parameters:**
```typescript
{
  kv?: KVNamespace;              // Optional: KV for distributed rate limiting
  windowMs?: number;              // Default: 60000 (1 minute)
  maxRequests?: number;           // Default: 100
  keyPrefix?: string;             // Default: 'rl:'
  keyGenerator?: (c: Context) => string;  // Default: IP + path
  handler?: (c: Context) => Response;     // Custom 429 handler
  skip?: (c: Context) => boolean;         // Skip rate limiting
}
```

**Response Headers:**
- `X-RateLimit-Limit` - Max requests per window
- `X-RateLimit-Remaining` - Requests remaining
- `X-RateLimit-Reset` - Unix timestamp (seconds)
- `Retry-After` - Seconds to wait (when rate limited)

**Error Response (429):**
```json
{
  "error": "Too many requests",
  "message": "Rate limit exceeded. Try again in 60 seconds.",
  "retryAfter": 60
}
```

#### `RATE_LIMIT_PRESETS`

Pre-configured rate limit policies:
- `RATE_LIMIT_PRESETS.auth` - 5 req / 15 min (authentication)
- `RATE_LIMIT_PRESETS.api` - 100 req / 1 min (API endpoints)
- `RATE_LIMIT_PRESETS.webhook` - 1000 req / 1 min (webhooks)
- `RATE_LIMIT_PRESETS.web` - 300 req / 1 min (web traffic)

### Worker Authentication

#### `workerAuth(options: WorkerAuthOptions)`

HMAC-based authentication middleware for worker-to-worker communication.

**Parameters:**
```typescript
{
  secret: string;                // Required: Shared HMAC secret
  allowedOrigins?: string[];     // Optional: Origin allowlist
  signatureHeader?: string;      // Default: 'X-Worker-Signature'
  timestampHeader?: string;      // Default: 'X-Worker-Timestamp'
  maxAge?: number;               // Default: 300 (5 minutes)
}
```

#### `generateWorkerSignature(payload: string, secret: string, timestamp: number)`

Generate HMAC-SHA256 signature for request payload.

**Returns:** Base64-encoded signature string

#### `workerFetch(url: string, init: RequestInit, secret: string, options?)`

Helper to make authenticated worker-to-worker requests.

**Parameters:**
```typescript
url: string                     // Target URL
init: RequestInit & { body: string }  // Request config with body
secret: string                  // Shared HMAC secret
options?: {
  signatureHeader?: string;
  timestampHeader?: string;
}
```

**Returns:** `Promise<Response>`

## Example: Complete Worker Setup

```typescript
import { Hono } from 'hono';
import { ObservabilityClient, createRequestTimer } from '@codex/observability';
import {
  optionalAuth,
  requireAuth,
  securityHeaders,
  CSP_PRESETS,
  rateLimit,
  RATE_LIMIT_PRESETS,
  workerAuth
} from '@codex/security';

type Bindings = {
  ENVIRONMENT: string;
  AUTH_SESSION_KV: KVNamespace;
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

// 2. Optional authentication (for all routes)
app.use('*', (c, next) => {
  return optionalAuth({
    kv: c.env.AUTH_SESSION_KV,
  })(c, next);
});

// 3. Rate limiting
app.use('*', (c, next) => {
  return rateLimit({
    kv: c.env.RATE_LIMIT_KV,
    ...RATE_LIMIT_PRESETS.api,
  })(c, next);
});

// 4. Worker-to-worker auth (internal endpoints only)
app.use('/internal/*', workerAuth({
  secret: c.env.WORKER_SHARED_SECRET,
  allowedOrigins: ['https://auth.revelations.studio'],
}));

// 5. Request timing
app.use('*', async (c, next) => {
  const obs = new ObservabilityClient('my-worker', c.env.ENVIRONMENT);
  const timer = createRequestTimer(obs, c.req);
  await next();
  timer.end(c.res.status);
});

// Public endpoint (user may or may not be authenticated)
app.get('/api/content', async (c) => {
  const user = c.get('user');

  if (user) {
    return c.json({ content: await getContentFor(user.id) });
  } else {
    return c.json({ content: await getPublicContent() });
  }
});

// Protected endpoint (requires authentication)
app.use('/api/protected/*', requireAuth({
  kv: c.env.AUTH_SESSION_KV,
}));

app.get('/api/protected/profile', async (c) => {
  const user = c.get('user'); // Guaranteed to exist
  return c.json({
    profile: {
      id: user.id,
      email: user.email,
      name: user.name,
    }
  });
});

// Protected internal endpoint (worker-to-worker only)
app.post('/internal/action', async (c) => {
  // Only accessible with valid worker signature
  const body = await c.req.json();
  // ... process action
  return c.json({ success: true });
});

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'healthy' });
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
