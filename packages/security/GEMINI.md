# @codex/security

Comprehensive security layer for Cloudflare Workers. Provides security headers, rate limiting, session authentication, and worker-to-worker authentication for all Codex services.

## Overview

Security package provides multiple overlapping defense mechanisms for complete protection:

- **Security Headers Middleware** - CSP, X-Frame-Options, HSTS, MIME sniffing prevention
- **Rate Limiting** - KV-backed distributed rate limiting (IP/user/custom based)
- **Session Authentication** - User session validation with KV caching + database fallback
- **Worker Authentication** - HMAC-SHA256 signatures for service-to-service communication
- **KV Secondary Storage** - Better Auth session caching adapter

All components are Hono middleware and integrate seamlessly into any Cloudflare Worker. Defense-in-depth architecture means multiple layers protect against different attack classes.

---

## Public API Reference

### Middleware Functions

| Export | Type | Purpose |
|--------|------|---------|
| `securityHeaders()` | Middleware | Apply security headers (CSP, HSTS, X-Frame-Options, etc.) |
| `rateLimit()` | Middleware | Rate limit requests using KV or in-memory storage |
| `optionalAuth()` | Middleware | Validate user session if present (fail open) |
| `requireAuth()` | Middleware | Validate user session (fail closed, returns 401) |
| `workerAuth()` | Middleware | Validate worker-to-worker HMAC signatures |

### Utility Functions

| Export | Type | Purpose |
|--------|------|---------|
| `generateWorkerSignature()` | Async function | Generate HMAC signature for worker requests |
| `workerFetch()` | Async function | Make authenticated worker-to-worker requests |
| `createKVSecondaryStorage()` | Function | Create Better Auth KV cache adapter |

### Types

| Type | Purpose |
|------|---------|
| `SecurityHeadersOptions` | Configuration for security headers |
| `RateLimitOptions` | Configuration for rate limiting |
| `SessionAuthConfig` | Configuration for session authentication |
| `SessionData` | Session information structure |
| `UserData` | Authenticated user information |
| `CachedSessionData` | Session + user data in KV cache |
| `WorkerAuthOptions` | Configuration for worker authentication |
| `CSPDirectives` | Content Security Policy directive configuration |
| `SecondaryStorage` | Better Auth secondary storage adapter interface |

### Constants

| Constant | Purpose |
|----------|---------|
| `RATE_LIMIT_PRESETS` | Pre-configured rate limit profiles (api, auth, strict, streaming, webhook, web) |
| `CSP_PRESETS` | Pre-configured CSP policies (stripe, api) |

---

## Security Headers Middleware

Applies security headers to protect against web vulnerabilities (XSS, clickjacking, MIME sniffing, etc).

### Function Signature

```typescript
function securityHeaders(options?: SecurityHeadersOptions): MiddlewareHandler
```

### Configuration

```typescript
interface SecurityHeadersOptions {
  /**
   * Environment (production, preview, development)
   * HSTS header only applied in production
   */
  environment?: string;

  /**
   * Custom CSP directives (merged with defaults, not replacing)
   */
  csp?: Partial<CSPDirectives>;

  /**
   * Disable X-Frame-Options header (defaults to DENY)
   * Set true only if legitimate need to be embedded in iframe
   */
  disableFrameOptions?: boolean;
}
```

### Headers Applied

| Header | Default Value | Purpose |
|--------|--------|---------|
| `Content-Security-Policy` | Dynamic CSP string | Prevent XSS attacks by restricting resource loading |
| `X-Frame-Options` | `DENY` | Prevent clickjacking attacks (disable with option) |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing attacks |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Control referrer information in requests |
| `Permissions-Policy` | Feature permissions | Disable unnecessary browser features (geolocation, camera, mic, payment) |
| `Strict-Transport-Security` | 1 year + subdomains | Force HTTPS (production environment only) |

### Default CSP Directives

```typescript
const DEFAULT_CSP = {
  defaultSrc: ["'self'"],                    // Only same-origin resources
  scriptSrc: ["'self'"],                     // JavaScript same-origin only
  styleSrc: ["'self'", "'unsafe-inline'"],   // CSS + inline (needed for component libraries)
  imgSrc: ["'self'", "data:", "https:"],     // Images from self, data URLs, HTTPS
  fontSrc: ["'self'"],                       // Web fonts same-origin only
  connectSrc: ["'self'"],                    // XHR/fetch/WebSocket same-origin
  frameSrc: ["'none'"],                      // No iframes allowed
  frameAncestors: ["'none'"],                // Cannot be embedded in iframes
  baseUri: ["'self'"],                       // Base URLs same-origin only
  formAction: ["'self'"],                    // Form submissions same-origin
};
```

### Usage Examples

**Basic usage with defaults:**

```typescript
import { securityHeaders } from '@codex/security';

app.use('*', securityHeaders({
  environment: c.env.ENVIRONMENT,  // 'production' enables HSTS
}));
```

**With Stripe integration:**

```typescript
import { securityHeaders } from '@codex/security';

app.use('*', securityHeaders({
  environment: c.env.ENVIRONMENT,
  csp: {
    scriptSrc: ["'self'", "https://js.stripe.com"],
    frameSrc: ["https://js.stripe.com", "https://hooks.stripe.com"],
    connectSrc: ["'self'", "https://api.stripe.com"],
  }
}));
```

**Using CSP presets:**

```typescript
import { securityHeaders, CSP_PRESETS } from '@codex/security';

// Apply Stripe preset
app.use('*', securityHeaders({
  environment: c.env.ENVIRONMENT,
  csp: CSP_PRESETS.stripe,
}));

// API-only worker (most restrictive)
app.use('*', securityHeaders({
  environment: c.env.ENVIRONMENT,
  csp: CSP_PRESETS.api,
}));
```

### CSP Presets

#### stripe

Pre-configured for Stripe.js and Stripe Elements:

```typescript
CSP_PRESETS.stripe = {
  scriptSrc: ["'self'", "https://js.stripe.com"],
  frameSrc: ["https://js.stripe.com", "https://hooks.stripe.com"],
  connectSrc: ["'self'", "https://api.stripe.com"],
};
```

#### api

Most restrictive - for API-only workers with no frontend:

```typescript
CSP_PRESETS.api = {
  defaultSrc: ["'none'"],
  scriptSrc: ["'none'"],
  styleSrc: ["'none'"],
  imgSrc: ["'none'"],
  fontSrc: ["'none'"],
  connectSrc: ["'self'"],
  frameSrc: ["'none'"],
  frameAncestors: ["'none'"],
  baseUri: ["'none'"],
  formAction: ["'none'"],
};
```

---

## Rate Limiting Middleware

Distribute rate limiting across worker instances using Cloudflare KV. Falls back to in-memory storage for local development.

### Function Signature

```typescript
function rateLimit(options?: RateLimitOptions): MiddlewareHandler
```

### Configuration

```typescript
interface RateLimitOptions {
  /**
   * Cloudflare KV namespace for rate limit storage
   * If not provided, falls back to in-memory (not recommended for production)
   */
  kv?: KVNamespace;

  /**
   * Time window in milliseconds (default: 60000 = 1 minute)
   */
  windowMs?: number;

  /**
   * Maximum requests per window (default: 100)
   */
  maxRequests?: number;

  /**
   * Key prefix for KV storage (default: "rl:")
   * Different prefixes allow separate rate limit buckets
   */
  keyPrefix?: string;

  /**
   * Custom key generator function
   * Default: IP-based using CF-Connecting-IP header
   * Override for user-based or custom scoping
   */
  keyGenerator?: (c: Context) => string;

  /**
   * Custom handler when rate limit exceeded
   * Default: Returns 429 with standard error format
   */
  handler?: (c: Context) => Response | Promise<Response>;

  /**
   * Skip rate limiting for certain requests
   * Useful for exempting health checks or internal routes
   */
  skip?: (c: Context) => boolean | Promise<boolean>;
}
```

### Response Headers (All Requests)

| Header | Value | Purpose |
|--------|-------|---------|
| `X-RateLimit-Limit` | Max requests | Total allowed requests in window |
| `X-RateLimit-Remaining` | Requests left | How many requests left before limit |
| `X-RateLimit-Reset` | Unix timestamp | When current window resets (seconds) |

### Exceeded Response Format

Status: `429 Too Many Requests`

```json
{
  "error": "Too many requests",
  "message": "Rate limit exceeded. Try again in 45 seconds.",
  "retryAfter": 45
}
```

Header: `Retry-After: 45`

### Usage Examples

**Apply to all routes:**

```typescript
import { rateLimit, RATE_LIMIT_PRESETS } from '@codex/security';

// Configure KV in wrangler.jsonc:
// [[kv_namespaces]]
// binding = "RATE_LIMIT_KV"
// id = "your-kv-namespace-id"

app.use('*', rateLimit({
  kv: c.env.RATE_LIMIT_KV,
  ...RATE_LIMIT_PRESETS.api,  // 100 req/min
}));
```

**Apply to specific routes:**

```typescript
const authLimiter = rateLimit({
  kv: c.env.RATE_LIMIT_KV,
  ...RATE_LIMIT_PRESETS.auth,  // 5 req/15min
});

app.post('/auth/login', authLimiter, loginHandler);
app.post('/auth/signup', authLimiter, signupHandler);
```

**Custom key generator (rate limit by user ID):**

```typescript
app.use('/api/*', rateLimit({
  kv: c.env.RATE_LIMIT_KV,
  keyGenerator: (c) => {
    const user = c.get('user');
    return user ? `user:${user.id}` : `ip:${c.req.header('cf-connecting-ip')}`;
  },
  ...RATE_LIMIT_PRESETS.api,
}));
```

**Skip specific routes:**

```typescript
app.use('*', rateLimit({
  kv: c.env.RATE_LIMIT_KV,
  skip: (c) => c.req.path === '/health',
  ...RATE_LIMIT_PRESETS.api,
}));
```

**Custom error handler:**

```typescript
app.use('*', rateLimit({
  kv: c.env.RATE_LIMIT_KV,
  handler: (c) => {
    return c.json({
      status: 'error',
      code: 'RATE_LIMITED',
      message: 'Please wait before trying again.',
    }, 429);
  },
  ...RATE_LIMIT_PRESETS.auth,
}));
```

### Rate Limit Presets

Pre-configured profiles for common scenarios:

#### auth

**Strictest protection** - Brute force resistance on authentication.

```typescript
RATE_LIMIT_PRESETS.auth = {
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 5,             // 5 requests max
};
```

**Use for**: Login, signup, password reset endpoints

#### strict

**Strict protection** - Sensitive operations.

```typescript
RATE_LIMIT_PRESETS.strict = {
  windowMs: 60 * 1000,  // 1 minute
  maxRequests: 20,      // 20 requests max
};
```

**Use for**: Streaming URL generation, sensitive data endpoints

#### streaming

**Moderate protection** - HLS/DASH segment refresh.

```typescript
RATE_LIMIT_PRESETS.streaming = {
  windowMs: 60 * 1000,        // 1 minute
  maxRequests: 60,            // 60 requests max
  keyPrefix: 'rl:stream:',    // Separate bucket from other limits
};
```

**Use for**: Presigned URL generation, video streaming requests

#### api

**Standard protection** - General API endpoints.

```typescript
RATE_LIMIT_PRESETS.api = {
  windowMs: 60 * 1000,  // 1 minute
  maxRequests: 100,     // 100 requests max
};
```

**Use for**: CRUD operations, content access, standard endpoints

#### webhook

**Permissive** - Trusted external callbacks.

```typescript
RATE_LIMIT_PRESETS.webhook = {
  windowMs: 60 * 1000,  // 1 minute
  maxRequests: 1000,    // 1000 requests max
};
```

**Use for**: Stripe webhooks, third-party service callbacks

#### web

**Moderate** - General web traffic.

```typescript
RATE_LIMIT_PRESETS.web = {
  windowMs: 60 * 1000,  // 1 minute
  maxRequests: 300,     // 300 requests max
};
```

**Use for**: Public pages, public APIs

### Implementation Details

#### KV Storage Format

Rate limit data stored in KV with auto-expiration:

```typescript
// Key: "rl:{ip}:{path}" (or custom via keyGenerator)
// Value:
{
  "count": 42,
  "resetAt": 1700000000000  // Unix timestamp ms
}
```

TTL set to window size - entries auto-cleanup on expiration.

#### In-Memory Fallback

If no KV namespace provided, in-memory store used (warning logged):

```
[RateLimit] Using in-memory store (not recommended for production).
Bind a KV namespace for distributed rate limiting.
```

Each worker instance has separate counters (not shared). Auto-cleanup when size > 10,000 entries.

---

## Session Authentication

Validate user sessions from cookies with optional KV caching.

### Function Signatures

```typescript
function optionalAuth(config?: SessionAuthConfig): MiddlewareHandler

function requireAuth(config?: SessionAuthConfig): MiddlewareHandler
```

### Configuration

```typescript
interface SessionAuthConfig {
  /**
   * KV namespace for session caching (optional)
   * If not provided, sessions queried from database every request
   * Caching significantly improves performance
   */
  kv?: KVNamespace;

  /**
   * Cookie name for session token (default: 'codex-session')
   * Also checks 'better-auth.session_token' for BetterAuth format
   */
  cookieName?: string;

  /**
   * Enable logging of auth failures (default: false)
   * Logs never include sensitive data
   */
  enableLogging?: boolean;
}
```

### Data Structures

#### SessionData

Session information structure:

```typescript
interface SessionData {
  id: string;                    // Session ID
  userId: string;                // User this session belongs to
  token: string;                 // Session token (from cookie)
  expiresAt: Date | string;      // Session expiration time
  ipAddress: string | null;      // IP where session created
  userAgent: string | null;      // User-Agent from creation
  createdAt: Date | string;      // When session created
  updatedAt: Date | string;      // Last updated
}
```

#### UserData

Authenticated user information:

```typescript
interface UserData {
  id: string;                 // User ID
  email: string;              // Email address
  name: string;               // Display name
  emailVerified: boolean;     // Email verification status
  image: string | null;       // Profile image URL
  role: string;               // User role
  createdAt: Date | string;   // Account creation time
  updatedAt: Date | string;   // Last update
}
```

#### CachedSessionData

Combined structure cached in KV:

```typescript
interface CachedSessionData {
  session: SessionData;  // Session info
  user: UserData;        // User info
}
```

### optionalAuth - Optional Session Validation

Attempt to authenticate user session if present (fail open).

**Behavior**:
- Session cookie present + valid → Sets `session` and `user`, proceeds
- Session cookie present + invalid/expired → Logs warning if enabled, proceeds without auth
- Session cookie missing → Proceeds without auth
- Database error → Proceeds without auth

**Always proceeds to next middleware (fail open)**

**Security Features**:
- Validates session expiration from database only (prevents replay)
- Uses KV cache for performance (auto-fallback to database)
- Graceful degradation on cache failures (logs, continues)
- Graceful degradation on database errors (logs, continues)
- Defense in depth: Validates expiration on both cache hit and client-side
- Never exposes sensitive data in error logs

#### Usage Example

```typescript
import { optionalAuth } from '@codex/security';

// Apply to all routes
app.use('*', optionalAuth({
  kv: c.env.AUTH_SESSION_KV,
  enableLogging: false,
}));

// In route handler
app.get('/api/content/:id', (c) => {
  const user = c.get('user');        // UserData | undefined
  const session = c.get('session');  // SessionData | undefined

  if (!user) {
    // Public content - user optional
    return c.json({ public: true });
  }

  // User authenticated - return personalized data
  return c.json({
    user: { id: user.id, email: user.email, name: user.name },
    authenticated: true,
  });
});
```

#### Cache Behavior

With KV namespace configured:

1. **Cache Hit** (valid, non-expired) → Use cached session immediately
2. **Cache Miss** (first request or expired) → Query database, cache for next time
3. **Cache Failure** (KV error) → Fall back to database query
4. **DB Error** → Continue without auth (fail gracefully)
5. **Stale Cache** (cached but expired) → Clear cache entry, continue without auth

Cache TTL = session expiration time (auto-cleanup).

### requireAuth - Required Session Validation

Require valid user session (fail closed).

**Behavior**:
- Session valid → Sets `session` and `user`, proceeds to handler
- Session missing or invalid → Returns 401, does NOT proceed

**All optionalAuth features + fails closed**

#### Usage Example

```typescript
import { requireAuth } from '@codex/security';

// Protect route group
app.use('/api/protected/*', requireAuth({
  kv: c.env.AUTH_SESSION_KV,
}));

// Handler - user guaranteed to exist
app.get('/api/protected/profile', (c) => {
  const user = c.get('user');  // UserData (never undefined)

  return c.json({
    profile: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
    }
  });
});

// Creator scope - user guaranteed
app.post('/api/protected/content', (c) => {
  const user = c.get('user');  // UserData (safe to use)
  const body = await c.req.json();

  return contentService.create({
    ...body,
    creatorId: user.id,  // Safe - never undefined
  });
});
```

#### Error Response

Status: `401 Unauthorized`

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required"
  }
}
```

### Validation Flow

**optionalAuth**:

```
1. Extract session cookie from headers
   └─ If missing → proceed without auth

2. Try cache (if KV available)
   ├─ Hit + valid → set context, proceed
   └─ Miss/expired → query database

3. Query database (request-scoped client)
   ├─ Valid → set context, cache for next time, proceed
   ├─ Invalid → log if enabled, proceed
   └─ DB error → log, proceed

4. Always proceed to next middleware
```

**requireAuth**:

```
1. Run optionalAuth (all above)
2. Check if user was set
   ├─ Yes → proceed
   └─ No → return 401
```

**Request-Scoped Database Client**:

Session middleware creates client per-request:

```typescript
// Inside middleware
const db = createDbClient(env);  // Uses c.env from request
const result = await db.query.sessions.findFirst({...});
```

Prevents connection pool exhaustion and ensures proper isolation.

---

## Worker-to-Worker Authentication

Secure service-to-service communication using HMAC signatures and timestamp validation.

### Function Signatures

```typescript
function workerAuth(options: WorkerAuthOptions): MiddlewareHandler

async function generateWorkerSignature(
  payload: string,
  secret: string,
  timestamp: number
): Promise<string>

async function workerFetch(
  url: string,
  init: RequestInit & { body: string },
  secret: string,
  options?: Pick<WorkerAuthOptions, 'signatureHeader' | 'timestampHeader'>
): Promise<Response>
```

### Configuration

```typescript
interface WorkerAuthOptions {
  /**
   * Shared secret for HMAC signature (store in secrets)
   * Must be at least 32 characters
   */
  secret: string;

  /**
   * Allowed worker origins (e.g., ["https://auth.revelations.studio"])
   * If not provided, any valid signature accepted
   */
  allowedOrigins?: string[];

  /**
   * Custom header name for signature (default: X-Worker-Signature)
   */
  signatureHeader?: string;

  /**
   * Custom header name for timestamp (default: X-Worker-Timestamp)
   */
  timestampHeader?: string;

  /**
   * Maximum request age in seconds (default: 300 = 5 minutes)
   * Prevents replay attacks
   */
  maxAge?: number;
}
```

### Security Features

1. **HMAC Signature** - SHA-256 based signature prevents tampering
2. **Timestamp Validation** - Prevents replay attacks (configurable window)
3. **Clock Skew** - Allows 60 seconds clock difference tolerance
4. **Origin Whitelisting** - Optional origin validation
5. **Standard Headers** - Custom HTTP headers for authentication

### Signature Computation

Signature computed over: `{timestamp}:{payload}` as Base64-encoded SHA-256 HMAC

```typescript
// Format
signature = base64(HMAC_SHA256(
  secret,
  `${timestamp}:${payload}`
))

// Timestamp format: Unix seconds (not milliseconds!)
const timestamp = Math.floor(Date.now() / 1000);  // Correct
const timestamp = Date.now();                      // Wrong!
```

### Usage Example - Receiving Worker

```typescript
import { workerAuth } from '@codex/security';

// Protect internal routes
app.use('/internal/*', workerAuth({
  secret: c.env.WORKER_SHARED_SECRET,
  allowedOrigins: ['https://auth.revelations.studio'],
  maxAge: 300,  // 5 minutes
}));

app.post('/internal/webhook', async (c) => {
  const body = await c.req.json();
  // Request validated - signature correct, timestamp fresh, origin whitelisted
  return c.json({ status: 'ok' });
});
```

### Usage Example - Calling Worker

#### Using workerFetch Helper

```typescript
import { workerFetch } from '@codex/security';

const response = await workerFetch(
  'https://api.revelations.studio/internal/webhook',
  {
    method: 'POST',
    body: JSON.stringify({ userId: '123', action: 'login' }),
  },
  c.env.WORKER_SHARED_SECRET
);

const result = await response.json();
```

#### Manual Signature Generation

```typescript
import { generateWorkerSignature } from '@codex/security';

const timestamp = Math.floor(Date.now() / 1000);  // Unix seconds
const body = JSON.stringify({ userId: '123', action: 'login' });
const signature = await generateWorkerSignature(
  body,
  c.env.WORKER_SHARED_SECRET,
  timestamp
);

const response = await fetch(
  'https://api.revelations.studio/internal/webhook',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Signature': signature,
      'X-Worker-Timestamp': timestamp.toString(),
    },
    body,
  }
);
```

### Error Responses

#### Missing Headers

Status: `401 Unauthorized`

```json
{
  "error": "Missing authentication headers",
  "required": ["X-Worker-Signature", "X-Worker-Timestamp"]
}
```

#### Invalid Timestamp Format

Status: `401 Unauthorized`

```json
{
  "error": "Invalid timestamp format"
}
```

#### Replay Attack (Too Old)

Status: `401 Unauthorized`

```json
{
  "error": "Request timestamp expired",
  "maxAge": 300,
  "age": 450
}
```

#### Future Timestamp

Status: `401 Unauthorized`

```json
{
  "error": "Request timestamp in future"
}
```

#### Invalid Signature

Status: `401 Unauthorized`

```json
{
  "error": "Invalid signature"
}
```

#### Origin Not Whitelisted

Status: `403 Forbidden`

```json
{
  "error": "Unauthorized origin"
}
```

---

## KV Secondary Storage for Better Auth

Adapter to integrate Cloudflare KV with Better Auth's session caching.

### Function Signature

```typescript
function createKVSecondaryStorage(
  kv: KVNamespace,
  obs?: ObservabilityClient
): SecondaryStorage
```

### Usage

```typescript
import { createKVSecondaryStorage } from '@codex/security';
import { betterAuth } from 'better-auth';

const kvStorage = createKVSecondaryStorage(env.AUTH_SESSION_KV, obs);

const auth = betterAuth({
  database: dbConnection,
  secondaryStorage: kvStorage,  // Better Auth will use KV for session caching
  // ... other config
});
```

### What It Does

Wraps Cloudflare KV to provide Better Auth's `SecondaryStorage` interface:

- `get(key)` - Retrieve cached value, returns parsed JSON or null
- `set(key, value, ttl?)` - Store value with optional TTL in seconds
- `delete(key)` - Remove cached value

### Error Handling

All operations graceful degrade on KV errors:

- Get error → Returns null (cache miss)
- Set error → Logs warning, continues (cache write optional)
- Delete error → Logs warning, continues (cleanup optional)

None of these errors break authentication flow.

---

## Integration with Codex Workers

All Codex workers use security package:

| Worker | Usage |
|--------|-------|
| **auth-worker** | Session auth, rate limiting, security headers, Better Auth integration |
| **content-api** | Session auth, rate limiting, security headers |
| **identity-api** | Session auth, rate limiting, security headers |
| **ecom-api** | Worker-to-worker auth for webhooks, rate limiting |

### Integration with worker-utils

The `@codex/worker-utils` package automatically applies security middleware:

```typescript
import { createWorker } from '@codex/worker-utils';

const app = createWorker({
  serviceName: 'my-worker',
  // Automatically applies:
  // - securityHeaders()
  // - optionalAuth()
  // - rateLimit()
});
```

Routes use `procedure()` to declare security requirements:

```typescript
import { procedure } from '@codex/worker-utils';

// Public endpoint
app.get('/api/content/:id',
  procedure({
    policy: { auth: 'none' },
    handler: async (ctx) => { /* ... */ },
  })
);

// Authenticated endpoint
app.get('/api/profile',
  procedure({
    policy: { auth: 'required' },
    handler: async (ctx) => { /* ... */ },
  })
);

// Internal worker-to-worker
app.post('/internal/webhook',
  procedure({
    policy: { auth: 'worker' },
    handler: async (ctx) => { /* ... */ },
  })
);
```

---

## Defense in Depth - Security Layers

Multiple overlapping mechanisms protect against different attack classes:

### Layer 1: Transport Security

**Component**: `securityHeaders()` - HSTS header
- Enforces HTTPS in production
- Prevents downgrade attacks
- All other layers depend on this

### Layer 2: Content Security

**Component**: `securityHeaders()` - CSP + additional headers
- Prevents XSS attacks (CSP restricts scripts)
- Prevents data exfiltration (CSP restricts connections)
- Prevents clickjacking (X-Frame-Options)
- Prevents MIME sniffing (X-Content-Type-Options)

### Layer 3: Rate Limiting

**Component**: `rateLimit()` - Request throttling
- Prevents brute force attacks (auth preset: 5/15min)
- Prevents DoS attacks (api/webhook presets)
- Prevents abuse of expensive operations (strict preset)
- Distributed across instances via KV

### Layer 4: User Authentication

**Component**: `requireAuth()` / `optionalAuth()` - Session validation
- Ensures only authenticated users access protected endpoints
- Validates session expiration
- Caches sessions for performance (KV)
- Falls back to database on cache miss

### Layer 5: Service Authentication

**Component**: `workerAuth()` - Worker-to-worker HMAC
- Ensures only authorized services call internal endpoints
- Prevents request tampering (HMAC signatures)
- Prevents replay attacks (timestamp validation)
- Optional origin whitelisting

### Combined Example

```typescript
import { securityHeaders, rateLimit, optionalAuth, workerAuth, RATE_LIMIT_PRESETS } from '@codex/security';

// Layer 1: Security headers (HTTPS, CSP, etc.)
app.use('*', securityHeaders({
  environment: c.env.ENVIRONMENT,
}));

// Layer 3: Global rate limiting
app.use('/api/*', rateLimit({
  kv: c.env.RATE_LIMIT_KV,
  ...RATE_LIMIT_PRESETS.api,
}));

// Layer 4: Optional user authentication
app.use('/api/*', optionalAuth({
  kv: c.env.AUTH_SESSION_KV,
}));

// Protected endpoint (declared via procedure)
app.post('/api/content',
  procedure({
    policy: { auth: 'required', rateLimit: 'strict' },
    handler: async (ctx) => { /* ... */ },
  })
);

// Layer 5: Internal worker-to-worker endpoints
app.use('/internal/*', workerAuth({
  secret: c.env.WORKER_SHARED_SECRET,
  allowedOrigins: ['https://auth.revelations.studio'],
}));

app.post('/internal/webhook',
  procedure({
    policy: { auth: 'worker' },
    handler: async (ctx) => { /* ... */ },
  })
);
```

---

## Common Patterns

### Protect Routes with Different Security Levels

```typescript
import { procedure } from '@codex/worker-utils';

// Public content - no auth required
app.get('/api/content/public/:id',
  procedure({
    policy: { auth: 'none', rateLimit: 'web' },
    handler: async (ctx) => { /* ... */ },
  })
);

// Authenticated user - standard rate limit
app.get('/api/content/:id',
  procedure({
    policy: { auth: 'required', rateLimit: 'api' },
    handler: async (ctx) => { /* ... */ },
  })
);

// Creator content - creator role required
app.post('/api/content',
  procedure({
    policy: { auth: 'required', roles: ['creator'], rateLimit: 'api' },
    handler: async (ctx) => { /* ... */ },
  })
);

// Admin only - strict rate limiting
app.delete('/api/users/:id',
  procedure({
    policy: { auth: 'required', roles: ['admin'], rateLimit: 'auth' },
    handler: async (ctx) => { /* ... */ },
  })
);
```

### Stricter Rate Limiting for Sensitive Operations

```typescript
const sensitiveLimiter = rateLimit({
  kv: c.env.RATE_LIMIT_KV,
  ...RATE_LIMIT_PRESETS.strict,  // 20 req/min
  keyGenerator: (c) => {
    const user = c.get('user');
    return user ? `user:${user.id}` : `ip:${c.req.header('cf-connecting-ip')}`;
  },
});

// Expensive operation
app.get('/api/access/:id/stream-url', sensitiveLimiter, getStreamUrl);

// High-risk operation
app.post('/api/auth/forgot-password', sensitiveLimiter, forgotPassword);
```

### Internal Webhook Handling

```typescript
import { workerAuth } from '@codex/security';

// Protect internal endpoints
app.use('/internal/*', workerAuth({
  secret: c.env.WORKER_SHARED_SECRET,
  allowedOrigins: [
    'https://auth.revelations.studio',
    'https://stripe-webhook.revelations.studio',
  ],
}));

// Process webhooks
app.post('/internal/webhook/:type',
  procedure({
    policy: { auth: 'worker', rateLimit: 'webhook' },
    handler: async (ctx) => {
      return await ctx.services.webhook.handle(
        ctx.input.params.type,
        ctx.input.body
      );
    },
  })
);
```

---

## Error Handling

All middleware returns standardized error responses.

### Standard Error Format

```json
{
  "error": "Error message",
  "message": "Detailed description (if applicable)",
  "code": "ERROR_CODE (if applicable)",
  "retryAfter": "Seconds to wait (rate limit only)"
}
```

### Client-Side Retry Logic

```typescript
async function fetchWithRetry(url: string, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const response = await fetch(url);

    if (response.status === 429) {
      const data = await response.json();
      const retryAfter = data.retryAfter || 60;
      console.log(`Rate limited. Waiting ${retryAfter}s...`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      continue;
    }

    if (response.ok) return response;
  }

  throw new Error('Max retries exceeded');
}
```

---

## Performance Considerations

### KV Caching Strategy

Intelligent caching minimizes database queries:

| Scenario | Latency | Notes |
|----------|---------|-------|
| Cache hit | <10ms | Most requests after first |
| Cache miss | 50-200ms | First request, after expiration |
| Cache error | 50-200ms | Graceful fallback to DB |
| DB error | <5ms | Returns error, doesn't crash |

Cache uses session token as key, TTL = session expiration time.

### Rate Limit KV Operations

Each rate-limited request does:
- 1 KV read (get counter)
- 1 KV put (increment + update TTL)
- Overhead: typically <5ms

### Security vs Performance

| Feature | Latency | Recommendation |
|---------|---------|-----------------|
| HSTS header | ~0ms | Always enable (production) |
| CSP header | ~0ms | Always enable |
| Rate limit KV | ~5ms | Use in production |
| Session caching | -150ms | Always use KV |
| Origin whitelist | ~0ms | Use when needed |

---

## Deployment

### Wrangler Configuration

```jsonc
{
  "env": {
    "production": {
      "kv_namespaces": [
        {
          "binding": "RATE_LIMIT_KV",
          "id": "rate-limit-kv-id",
          "preview_id": "rate-limit-preview-id"
        },
        {
          "binding": "AUTH_SESSION_KV",
          "id": "session-kv-id",
          "preview_id": "session-preview-id"
        }
      ],
      "vars": {
        "ENVIRONMENT": "production",
        "WORKER_SHARED_SECRET": "min-32-chars-secret-key-here"
      }
    }
  }
}
```

### Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `ENVIRONMENT` | Controls HSTS header | `production`, `staging`, `development` |
| `WORKER_SHARED_SECRET` | HMAC secret (32+ chars) | Random 32-char minimum |
| `DATABASE_URL` | Database for sessions | `postgres://...` |

### Security Best Practices

1. **Store secrets securely** - Use Cloudflare Secrets, not config files
2. **HTTPS only** - Enable HSTS in production via environment
3. **Start strict** - Begin with auth preset (5/15min), loosen based on monitoring
4. **Origin whitelist** - Use for internal endpoints
5. **Log sensitive events** - Enable `enableLogging` for security audits
6. **Rotate secrets** - WORKER_SHARED_SECRET should rotate quarterly

---

## Testing

### Testing Security Headers

```typescript
import { describe, it, expect } from 'vitest';
import { securityHeaders } from '@codex/security';

describe('Security Headers', () => {
  it('should set CSP header', async () => {
    const app = new Hono();
    app.use('*', securityHeaders({ environment: 'production' }));
    app.get('/', (c) => c.text('OK'));

    const res = await app.request('/');
    expect(res.headers.get('content-security-policy')).toBeTruthy();
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('should enable HSTS in production', async () => {
    const app = new Hono();
    app.use('*', securityHeaders({ environment: 'production' }));
    app.get('/', (c) => c.text('OK'));

    const res = await app.request('/');
    expect(res.headers.get('strict-transport-security')).toContain('31536000');
  });

  it('should disable HSTS in development', async () => {
    const app = new Hono();
    app.use('*', securityHeaders({ environment: 'development' }));
    app.get('/', (c) => c.text('OK'));

    const res = await app.request('/');
    expect(res.headers.get('strict-transport-security')).toBeNull();
  });
});
```

### Testing Rate Limiting

```typescript
import { describe, it, expect } from 'vitest';
import { rateLimit } from '@codex/security';

describe('Rate Limiting', () => {
  it('should allow requests under limit', async () => {
    const app = new Hono();
    app.use('*', rateLimit({ windowMs: 60000, maxRequests: 5 }));
    app.get('/', (c) => c.text('OK'));

    for (let i = 0; i < 5; i++) {
      const res = await app.request('/');
      expect(res.status).toBe(200);
    }
  });

  it('should block requests over limit', async () => {
    const app = new Hono();
    app.use('*', rateLimit({ windowMs: 60000, maxRequests: 3 }));
    app.get('/', (c) => c.text('OK'));

    for (let i = 0; i < 3; i++) {
      const res = await app.request('/');
      expect(res.status).toBe(200);
    }

    const limitedRes = await app.request('/');
    expect(limitedRes.status).toBe(429);
    const body = await limitedRes.json();
    expect(body.error).toBe('Too many requests');
  });

  it('should include rate limit headers', async () => {
    const app = new Hono();
    app.use('*', rateLimit({ windowMs: 60000, maxRequests: 10 }));
    app.get('/', (c) => c.text('OK'));

    const res = await app.request('/');
    expect(res.headers.get('x-ratelimit-limit')).toBe('10');
    expect(res.headers.get('x-ratelimit-remaining')).toBe('9');
    expect(res.headers.get('x-ratelimit-reset')).toBeTruthy();
  });
});
```

### Testing Session Authentication

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { optionalAuth, requireAuth } from '@codex/security';
import { Hono } from 'hono';

describe('Session Authentication', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
  });

  it('optionalAuth should proceed without session', async () => {
    app.use('*', optionalAuth());
    app.get('/', (c) => c.json({ user: c.get('user') || null }));

    const res = await app.request('/');
    const body = await res.json();
    expect(body.user).toBeNull();
  });

  it('requireAuth should return 401 without session', async () => {
    app.use('/api/*', requireAuth());
    app.get('/api/protected', (c) => c.json({ ok: true }));

    const res = await app.request('/api/protected');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
```

### Testing Worker Authentication

```typescript
import { describe, it, expect } from 'vitest';
import { generateWorkerSignature, workerAuth } from '@codex/security';

describe('Worker Authentication', () => {
  it('should generate valid signatures', async () => {
    const secret = 'test-secret-key-at-least-32-chars-long!';
    const payload = JSON.stringify({ userId: '123' });
    const timestamp = Math.floor(Date.now() / 1000);

    const signature = await generateWorkerSignature(payload, secret, timestamp);
    expect(typeof signature).toBe('string');
    expect(signature.length).toBeGreaterThan(0);
  });

  it('should validate correct signatures', async () => {
    const app = new Hono();
    const secret = 'test-secret-key-at-least-32-chars-long!';

    app.use('/internal/*', workerAuth({ secret }));
    app.post('/internal/webhook', (c) => c.json({ ok: true }));

    const payload = JSON.stringify({ userId: '123' });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await generateWorkerSignature(payload, secret, timestamp);

    const res = await app.request('/internal/webhook', {
      method: 'POST',
      headers: {
        'X-Worker-Signature': signature,
        'X-Worker-Timestamp': timestamp.toString(),
      },
      body: payload,
    });

    expect(res.status).toBe(200);
  });

  it('should reject invalid signatures', async () => {
    const app = new Hono();
    const secret = 'test-secret-key-at-least-32-chars-long!';

    app.use('/internal/*', workerAuth({ secret }));
    app.post('/internal/webhook', (c) => c.json({ ok: true }));

    const timestamp = Math.floor(Date.now() / 1000);
    const res = await app.request('/internal/webhook', {
      method: 'POST',
      headers: {
        'X-Worker-Signature': 'invalid-signature',
        'X-Worker-Timestamp': timestamp.toString(),
      },
      body: '{}',
    });

    expect(res.status).toBe(401);
  });
});
```

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `hono` | ^4.0.0 | Web framework and middleware |
| `@codex/database` | workspace:* | Session and user data queries |
| `drizzle-orm` | 0.44.7 | ORM for database access |
| `@cloudflare/workers-types` | ^4.20251014.0 | Cloudflare Worker types |

---

## License

Internal use only - Codex platform.
