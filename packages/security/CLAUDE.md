# @codex/security

Comprehensive security layer for Cloudflare Workers. Provides security headers, rate limiting, session authentication, and worker-to-worker authentication for all Codex services.

## Overview

The security package provides multiple overlapping defense mechanisms that combine to create a complete security layer for Cloudflare Workers:

- **Security Headers Middleware** - Content Security Policy, X-Frame-Options, HSTS, and other protective headers
- **Rate Limiting** - KV-backed distributed rate limiting with fallback to in-memory storage
- **Session Authentication** - User session validation with KV caching and database fallback
- **Worker Authentication** - HMAC-based signature verification for service-to-service communication

All components are built on Hono and integrate seamlessly into any Cloudflare Worker application. The package is designed for defense in depth, with each security mechanism protecting against different classes of attacks.

## Public API Reference

### Exported Functions

| Export | Type | Purpose |
|--------|------|---------|
| `securityHeaders()` | Middleware | Apply security headers (CSP, HSTS, X-Frame-Options, etc.) |
| `rateLimit()` | Middleware | Rate limit requests using KV or in-memory storage |
| `optionalAuth()` | Middleware | Validate user session if present (doesn't require auth) |
| `requireAuth()` | Middleware | Validate user session (requires authentication) |
| `workerAuth()` | Middleware | Validate worker-to-worker HMAC signatures |
| `generateWorkerSignature()` | Function | Generate HMAC signature for worker requests |
| `workerFetch()` | Function | Make authenticated worker-to-worker requests |

### Exported Types

| Type | Purpose |
|------|---------|
| `SecurityHeadersOptions` | Configuration for security headers middleware |
| `RateLimitOptions` | Configuration for rate limiting middleware |
| `SessionAuthConfig` | Configuration for session authentication |
| `SessionData` | Session information structure |
| `UserData` | Authenticated user information |
| `CachedSessionData` | Cached session and user data in KV |
| `WorkerAuthOptions` | Configuration for worker authentication |
| `CSPDirectives` | Content Security Policy directive configuration |

### Exported Constants

| Constant | Purpose |
|----------|---------|
| `RATE_LIMIT_PRESETS` | Pre-configured rate limit profiles (api, auth, strict, etc.) |
| `CSP_PRESETS` | Pre-configured CSP policies (stripe, api) |

---

## Security Headers Middleware

Applies security headers to all responses, protecting against common web vulnerabilities.

### Function Signature

```typescript
function securityHeaders(options?: SecurityHeadersOptions): MiddlewareHandler
```

### Configuration

```typescript
interface SecurityHeadersOptions {
  /**
   * Environment (production, preview, development)
   * HSTS is only enabled in production
   */
  environment?: string;

  /**
   * Custom CSP directives (merged with defaults)
   * Each key overrides the corresponding default directive
   */
  csp?: Partial<CSPDirectives>;

  /**
   * Disable X-Frame-Options header (defaults to DENY)
   * Set to true only if you need clickjacking for legitimate reasons
   */
  disableFrameOptions?: boolean;
}
```

### Headers Applied

| Header | Value | Purpose |
|--------|-------|---------|
| `Content-Security-Policy` | Dynamically built | Prevent XSS attacks by restricting resource loading |
| `X-Frame-Options` | `DENY` | Prevent clickjacking attacks |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing attacks |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Control referrer information |
| `Permissions-Policy` | Disabled features | Disable unnecessary browser features (geolocation, camera, etc.) |
| `Strict-Transport-Security` | 1 year max-age | Force HTTPS (production only) |

### Default CSP Policy

```typescript
const DEFAULT_CSP = {
  defaultSrc: ["'self'"],           // Only allow resources from same origin
  scriptSrc: ["'self'"],             // JavaScript must be same-origin
  styleSrc: ["'self'", "'unsafe-inline'"], // CSS from self, inline for components
  imgSrc: ["'self'", "data:", "https:"],   // Images from self, data URLs, HTTPS
  fontSrc: ["'self'"],               // Web fonts from same origin only
  connectSrc: ["'self'"],            // XHR/WebSocket from same origin
  frameSrc: ["'none'"],              // No iframe embedding
  frameAncestors: ["'none'"],        // Cannot be embedded in iframes
  baseUri: ["'self'"],               // Base URLs must be same origin
  formAction: ["'self'"],            // Form submissions to same origin
};
```

### Usage Examples

**Basic usage with defaults:**

```typescript
import { securityHeaders } from '@codex/security';

app.use('*', securityHeaders({
  environment: c.env.ENVIRONMENT,
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

// Stripe preset
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

Pre-configured CSP for Stripe.js and Stripe Elements integration:

```typescript
CSP_PRESETS.stripe = {
  scriptSrc: ["'self'", "https://js.stripe.com"],
  frameSrc: ["https://js.stripe.com", "https://hooks.stripe.com"],
  connectSrc: ["'self'", "https://api.stripe.com"],
};
```

#### api

Most restrictive policy for API-only workers with no frontend:

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

## Rate Limiting

Distribute rate limiting across worker instances using Cloudflare KV. Falls back to in-memory storage for local development.

### Function Signature

```typescript
function rateLimit(options?: RateLimitOptions): MiddlewareHandler
```

### Configuration

```typescript
interface RateLimitOptions {
  /**
   * Cloudflare KV namespace for storing rate limit data
   * If not provided, falls back to in-memory (not recommended for production)
   */
  kv?: KVNamespace;

  /**
   * Time window in milliseconds (default: 60000 = 1 minute)
   */
  windowMs?: number;

  /**
   * Maximum number of requests per window (default: 100)
   */
  maxRequests?: number;

  /**
   * Key prefix for KV storage (default: "rl:")
   * Allows different rate limit scopes (e.g., "rl:stream:" for streaming)
   */
  keyPrefix?: string;

  /**
   * Custom key generator function
   * Default: IP-based keying using CF-Connecting-IP header
   * Override for user-based or custom rate limiting
   */
  keyGenerator?: (c: Context) => string;

  /**
   * Custom handler when rate limit is exceeded
   * Default: Returns 429 with standard error format
   */
  handler?: (c: Context) => Response | Promise<Response>;

  /**
   * Skip rate limiting for certain requests
   * Useful for exempting health checks or internal requests
   */
  skip?: (c: Context) => boolean | Promise<boolean>;
}
```

### Response Headers

All rate-limited requests receive these headers:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-RateLimit-Limit` | Maximum requests | Total allowed requests in window |
| `X-RateLimit-Remaining` | Requests left | Requests remaining before limit |
| `X-RateLimit-Reset` | Unix timestamp | When the current window resets |

### Default Rate Limit Exceeded Response

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
  windowMs: 60000,     // 1 minute
  maxRequests: 100,
}));
```

**Apply to specific routes:**

```typescript
const authLimiter = rateLimit({
  kv: c.env.RATE_LIMIT_KV,
  ...RATE_LIMIT_PRESETS.auth,
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

**Skip health checks from rate limiting:**

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
      message: 'Too many requests. Please try again later.',
    }, 429);
  },
  ...RATE_LIMIT_PRESETS.auth,
}));
```

### Rate Limit Presets

Pre-configured rate limiting profiles for common scenarios:

#### auth

**Strictest limiting** - For authentication endpoints where abuse is high-risk.

- **Limit**: 5 requests per 15 minutes
- **Use case**: Login, signup, password reset endpoints
- **Rationale**: Brute force protection

```typescript
RATE_LIMIT_PRESETS.auth = {
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 5,
};
```

#### strict

**Strict limiting** - For sensitive operations.

- **Limit**: 20 requests per 1 minute
- **Use case**: Streaming URL generation, sensitive data access
- **Rationale**: Prevent abuse of expensive operations

```typescript
RATE_LIMIT_PRESETS.strict = {
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 20,
};
```

#### streaming

**Moderate limiting** - For presigned URL generation.

- **Limit**: 60 requests per 1 minute
- **Use case**: HLS/DASH streaming URL refresh
- **Rationale**: Allow legitimate segment refreshes but prevent abuse
- **Note**: Uses separate KV prefix to avoid interfering with other rate limits

```typescript
RATE_LIMIT_PRESETS.streaming = {
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 60,
  keyPrefix: 'rl:stream:',
};
```

#### api

**Standard limiting** - For general API endpoints.

- **Limit**: 100 requests per 1 minute
- **Use case**: CRUD operations, content access
- **Rationale**: Default protection against traffic spikes

```typescript
RATE_LIMIT_PRESETS.api = {
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 100,
};
```

#### webhook

**Permissive limiting** - For webhook endpoints.

- **Limit**: 1000 requests per 1 minute
- **Use case**: Stripe webhooks, external service callbacks
- **Rationale**: Webhooks are trusted and need high throughput

```typescript
RATE_LIMIT_PRESETS.webhook = {
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 1000,
};
```

#### web

**Moderate limiting** - For general web traffic.

- **Limit**: 300 requests per 1 minute
- **Use case**: Public pages, public APIs
- **Rationale**: Balance between protection and usability

```typescript
RATE_LIMIT_PRESETS.web = {
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 300,
};
```

### Implementation Details

#### KV-based Rate Limiting

When a KV namespace is provided, rate limit data is stored distributedly:

```typescript
// KV storage format
{
  "rl:192.0.2.1:/api/users": {
    "count": 42,
    "resetAt": 1700000000000  // Unix timestamp in milliseconds
  }
}
```

Each entry has a TTL set to the window size, so expired entries are automatically cleaned up.

#### In-Memory Fallback

If no KV namespace is provided, a warning is logged and in-memory storage is used:

```typescript
// Not recommended for production multi-instance deployments
// Each worker instance maintains its own counters
// Rate limits are not shared across instances
console.warn('[RateLimit] Using in-memory store (not recommended for production)...');
```

The in-memory store includes automatic cleanup when size exceeds 10,000 entries.

---

## Session Authentication

Validate user sessions with optional KV caching for performance.

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
   * If not provided, sessions are queried from database on every request
   * Caching significantly improves performance
   */
  kv?: KVNamespace;

  /**
   * Cookie name for session token (default: 'codex-session')
   */
  cookieName?: string;

  /**
   * Whether to log authentication failures (default: false)
   * When enabled, logs will NOT include sensitive session data
   */
  enableLogging?: boolean;
}
```

### Data Structures

#### SessionData

Information about an authenticated session:

```typescript
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

#### UserData

Information about the authenticated user:

```typescript
interface UserData {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}
```

#### CachedSessionData

Combined structure cached in KV:

```typescript
interface CachedSessionData {
  session: SessionData;
  user: UserData;
}
```

### optionalAuth - Optional Session Validation

Attempts to validate user session if present, but does NOT require authentication.

**Behavior**:
- If session cookie exists and is valid: Sets `session` and `user` on context, proceeds
- If session cookie exists but is invalid/expired: Logs warning (if enabled), proceeds without auth
- If session cookie missing: Proceeds without auth
- Always returns to next middleware (fail open)

**Security Features**:
- Validates session expiration from database (only non-expired sessions)
- Uses KV cache for performance (with automatic fallback to database)
- Gracefully handles cache failures (logs, continues with database)
- Gracefully handles database errors (logs, continues without auth)
- Never exposes sensitive data in errors
- Defense in depth: Validates expiration both from cache and client-side

#### Usage Example

```typescript
import { optionalAuth } from '@codex/security';

// Apply to all routes (user is available if authenticated)
app.use('*', optionalAuth({
  kv: c.env.AUTH_SESSION_KV,
  enableLogging: false,
}));

// In route handlers
app.get('/api/content/:id', (c) => {
  const user = c.get('user');        // UserData | undefined
  const session = c.get('session');  // SessionData | undefined

  if (!user) {
    // Public endpoint - user is optional
    return c.json({ public: true });
  }

  // User is authenticated
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    }
  });
});
```

#### Cache Behavior

When KV is configured:

1. **Cache Hit** (valid, non-expired): Uses cached session immediately
2. **Cache Miss** (first request): Queries database, caches result (async)
3. **Cache Miss** (database error): Continues without auth, doesn't crash
4. **Cache Stale** (cached but now expired): Clears cache entry, continues without auth

The cache uses the session token as the key with KV TTL set to the session's expiration time, ensuring automatic cleanup.

### requireAuth - Required Session Validation

Requires a valid user session. Returns 401 if session is missing or invalid.

**Behavior**:
- If session is valid: Sets `session` and `user` on context, proceeds to handler
- If session is missing or invalid: Returns 401 error, does NOT proceed

**Security Features**:
- All features from `optionalAuth`
- Fails closed (denies access) on authentication failure
- Returns standardized 401 error format

#### Usage Example

```typescript
import { requireAuth } from '@codex/security';

// Protect specific routes
app.use('/api/protected/*', requireAuth({
  kv: c.env.AUTH_SESSION_KV,
}));

// In protected route handlers
app.get('/api/protected/profile', (c) => {
  // User is guaranteed to exist here
  const user = c.get('user');  // UserData (guaranteed non-undefined)

  return c.json({
    profile: {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
    }
  });
});

// Protect with scope
app.post('/api/protected/content', (c) => {
  const user = c.get('user');  // UserData (guaranteed)
  const body = await c.req.json();

  // User ID is guaranteed to exist for ownership checks
  return contentService.create({
    ...body,
    creatorId: user.id,  // Safe - user is never undefined
  });
});
```

#### Error Response

When authentication is required but missing:

Status: `401 Unauthorized`

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required"
  }
}
```

### Session Validation Flow

**optionalAuth Flow:**

```
1. Extract session cookie from Cookie header
   ├─ If missing → proceed without auth
   │
2. Try cache (if KV available)
   ├─ Cache hit with valid session → set context, proceed
   ├─ Cache hit but expired → clear cache, query DB
   │
3. Query database
   ├─ Valid session found → set context, cache for next time, proceed
   ├─ Invalid or expired → log if enabled, proceed without auth
   ├─ Database error → log, proceed without auth
   │
4. Always proceed to next middleware
```

**requireAuth Flow:**

```
1. Run optionalAuth (all steps above)
2. Check if user was set
   ├─ User exists → proceed to handler
   ├─ User missing → return 401
```

---

## Worker-to-Worker Authentication

Secure service-to-service communication using HMAC signatures.

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
   * Shared secret for HMAC signature (stored in secrets)
   * Must be at least 32 characters
   */
  secret: string;

  /**
   * Allowed worker origins (e.g., ["https://auth.revelations.studio"])
   * If not provided, any origin with valid signature is accepted
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
   * Maximum age of request in seconds (default: 300 = 5 minutes)
   * Prevents replay attacks
   */
  maxAge?: number;
}
```

### Security Features

1. **HMAC Signature Verification**: SHA-256 based signature prevents tampering
2. **Timestamp Validation**: Prevents replay attacks (default 5-minute window)
3. **Clock Skew Tolerance**: Allows 60 seconds of clock difference
4. **Origin Whitelisting**: Optional origin validation
5. **Standard HTTP Headers**: Uses custom headers for authentication

### Implementation Details

#### Signature Generation

The signature is computed over: `{timestamp}:{payload}`

```typescript
// Signature format (Base64-encoded SHA-256 HMAC)
signature = base64(HMAC_SHA256(
  key: secret,
  message: `${timestamp}:${payload}`
))
```

#### Timestamp Format

Unix timestamp in seconds (not milliseconds):

```typescript
// Correct (seconds)
const timestamp = Math.floor(Date.now() / 1000);

// Wrong (milliseconds)
const timestamp = Date.now();  // Don't do this!
```

### Usage Example - Receiving Worker

```typescript
import { workerAuth } from '@codex/security';

// In wrangler.jsonc:
// [env.production]
// vars = { WORKER_SHARED_SECRET = "..." }

// Protect internal endpoints
app.use('/internal/*', workerAuth({
  secret: c.env.WORKER_SHARED_SECRET,
  allowedOrigins: ['https://auth.revelations.studio'],
  maxAge: 300,  // 5 minutes
}));

app.post('/internal/webhook', async (c) => {
  const body = await c.req.json();
  // Request has been validated - signature is correct
  // Origin is in whitelist
  // Timestamp is fresh
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

const timestamp = Math.floor(Date.now() / 1000);
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

#### Missing Authentication Headers

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

#### Request Too Old (Replay Attack)

Status: `401 Unauthorized`

```json
{
  "error": "Request timestamp expired",
  "maxAge": 300,
  "age": 450
}
```

#### Request Timestamp in Future

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

## Integration with Codex Workers

The security package is integrated into all Codex workers:

| Worker | Usage |
|--------|-------|
| **auth-worker** | Session authentication, rate limiting, security headers |
| **content-api** | Session authentication, rate limiting, security headers |
| **identity-api** | Session authentication, rate limiting, security headers |
| **ecom-api** | Worker-to-worker authentication, rate limiting |

### Integration with worker-utils

The `@codex/worker-utils` package provides a high-level worker factory that automatically applies security middleware:

```typescript
import { createWorker } from '@codex/worker-utils';

const app = createWorker({
  serviceName: 'my-worker',
  enableSecurityHeaders: true,   // Automatically applies securityHeaders()
  enableGlobalAuth: true,        // Automatically applies optionalAuth()
  // Rate limiting is applied at route level via withPolicy()
});
```

### Security Policy Pattern

Routes use `withPolicy()` from `@codex/worker-utils` to declare security requirements:

```typescript
import { withPolicy, POLICY_PRESETS } from '@codex/worker-utils';

// Public endpoint
app.get('/api/content/:id',
  withPolicy(POLICY_PRESETS.public()),
  getContentHandler
);

// Authenticated API endpoint with standard rate limiting
app.get('/api/profile',
  withPolicy(POLICY_PRESETS.authenticated()),
  getProfileHandler
);

// Creator-only with strict rate limiting
app.post('/api/content',
  withPolicy(POLICY_PRESETS.creator()),
  createContentHandler
);

// Internal worker-to-worker endpoint
app.post('/internal/webhook',
  withPolicy(POLICY_PRESETS.internal()),
  webhookHandler
);
```

---

## Security Layers - Defense in Depth

The security package provides multiple overlapping defense mechanisms that work together:

### Layer 1: Transport Security (HTTPS)

**Component**: `securityHeaders()` - HSTS header
- Enforces HTTPS in production
- Prevents downgrade attacks
- All other layers depend on this

### Layer 2: Content Security

**Component**: `securityHeaders()` - Content Security Policy
- Prevents XSS attacks by restricting script sources
- Prevents data exfiltration via fetch/XHR
- Prevents clickjacking via X-Frame-Options
- Prevents MIME sniffing via X-Content-Type-Options

### Layer 3: Rate Limiting

**Component**: `rateLimit()` - Request throttling
- Prevents brute force attacks (via auth preset)
- Prevents DoS attacks (via api/webhook presets)
- Prevents abuse of expensive operations (via strict preset)
- Distributes across worker instances via KV

### Layer 4: User Authentication

**Component**: `requireAuth()` / `optionalAuth()` - Session validation
- Ensures only authenticated users access protected endpoints
- Validates session expiration
- Caches sessions for performance
- Falls back to database on cache miss

### Layer 5: Service Authentication

**Component**: `workerAuth()` - Worker-to-worker HMAC
- Ensures only authorized services can call internal endpoints
- Prevents request tampering via HMAC signatures
- Prevents replay attacks via timestamp validation
- Optional origin whitelisting

### Combined Example

```typescript
import { securityHeaders, rateLimit, requireAuth, workerAuth } from '@codex/security';
import { withPolicy } from '@codex/worker-utils';

app.use('*', securityHeaders({
  environment: c.env.ENVIRONMENT,
}));

// Layer 3: Rate limiting
app.use('/api/*', rateLimit({
  kv: c.env.RATE_LIMIT_KV,
  ...RATE_LIMIT_PRESETS.api,
}));

// Layer 4: User authentication
app.use('/api/*', optionalAuth({
  kv: c.env.AUTH_SESSION_KV,
}));

// Protected endpoint with policy
app.post('/api/content',
  withPolicy({
    auth: 'required',
    rateLimit: 'strict',
  }),
  createContentHandler
);

// Internal endpoint with worker auth
app.use('/internal/*', workerAuth({
  secret: c.env.WORKER_SHARED_SECRET,
  allowedOrigins: ['https://auth.revelations.studio'],
}));

app.post('/internal/webhook', webhookHandler);
```

---

## Common Patterns

### Protecting Routes with Different Security Levels

```typescript
import { withPolicy } from '@codex/worker-utils';

// Public content endpoint
app.get('/api/content/public/:id',
  withPolicy({
    auth: 'none',
    rateLimit: 'web',
  }),
  getPublicContent
);

// User content (requires auth)
app.get('/api/content/:id',
  withPolicy({
    auth: 'required',
    rateLimit: 'api',
  }),
  getContent
);

// Creator only
app.post('/api/content',
  withPolicy({
    auth: 'required',
    roles: ['creator'],
    rateLimit: 'api',
  }),
  createContent
);

// Admin only with strict rate limiting
app.delete('/api/users/:id',
  withPolicy({
    auth: 'required',
    roles: ['admin'],
    rateLimit: 'auth',
  }),
  deleteUser
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

// Streaming URL generation (expensive operation)
app.get('/api/access/:id/stream-url', sensitiveLimiter, getStreamUrl);

// Password reset (sensitive, brute-force risk)
app.post('/api/auth/forgot-password', sensitiveLimiter, forgotPassword);
```

### Internal Webhook Handling

```typescript
import { workerAuth } from '@codex/security';
import { withPolicy } from '@codex/worker-utils';

// Internal webhook endpoints
app.post('/internal/webhook/:type',
  workerAuth({
    secret: c.env.WORKER_SHARED_SECRET,
    allowedOrigins: [
      'https://auth.revelations.studio',
      'https://stripe-webhook.revelations.studio',
    ],
  }),
  withPolicy({
    auth: 'worker',
    rateLimit: 'webhook',
  }),
  handleWebhook
);
```

---

## Error Handling

All middleware returns standardized error responses.

### Standard Error Format

```json
{
  "error": "Error message or error code",
  "message": "Detailed description (if applicable)",
  "code": "ERROR_CODE (if applicable)",
  "retryAfter": "Seconds to wait before retry (rate limit only)"
}
```

### Handling Rate Limit Errors

Client-side retry logic:

```typescript
async function fetchWithRetry(url: string, maxRetries = 3) {
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    const response = await fetch(url);

    if (response.status === 429) {
      const data = await response.json();
      const retryAfter = data.retryAfter || 60;
      console.log(`Rate limited. Waiting ${retryAfter}s...`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      continue;
    }

    if (response.ok) {
      return response;
    }

    lastError = response;
  }

  throw new Error(`Max retries exceeded. Last error: ${lastError.status}`);
}
```

### Handling Authentication Errors

```typescript
app.get('/api/profile', (c) => {
  const user = c.get('user');

  if (!user) {
    // This should not happen if requireAuth() is applied
    // But handle gracefully anyway
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      },
      401
    );
  }

  return c.json({ user });
});
```

---

## Performance Considerations

### KV Caching Strategy

The package uses intelligent caching to minimize database queries:

- **Session Caching**: KV cache with TTL = session expiration time
- **Cache-Aside Pattern**: Check cache first, fall back to database
- **Graceful Degradation**: Cache failures don't break authentication

Expected performance:

| Scenario | Latency | Notes |
|----------|---------|-------|
| Cache hit | <10ms | Most requests after first |
| Cache miss (DB available) | 50-200ms | First request or after cache expiration |
| Cache failure | 50-200ms | Falls back to database automatically |
| Database error | <5ms | Returns 401, doesn't crash |

### Rate Limit KV Operations

Each rate-limited request performs:
- 1 KV read (to get counter)
- 1 KV put (to increment counter)
- Minimal overhead: typically <5ms

For high-traffic endpoints, consider:
- Using custom key generator (user ID instead of IP) to reduce hotspots
- Increasing rate limit window to reduce KV operations
- Exempting health checks via `skip` function

### Security vs Performance Trade-offs

| Feature | Impact | Recommendation |
|---------|--------|-----------------|
| HSTS header | ~0ms | Always enable in production |
| CSP header | ~0ms | Always enable (only header building) |
| Rate limit KV | ~5ms per request | Use KV in production, in-memory in dev |
| Session caching | -150ms (database save) | Always use KV when available |
| Origin whitelisting | ~0ms | Minimal overhead, use when needed |

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
          "id": "your-rate-limit-kv-id",
          "preview_id": "your-rate-limit-preview-id"
        },
        {
          "binding": "AUTH_SESSION_KV",
          "id": "your-session-kv-id",
          "preview_id": "your-session-preview-id"
        }
      ],
      "vars": {
        "ENVIRONMENT": "production",
        "WORKER_SHARED_SECRET": "your-secret-key-min-32-chars"
      }
    }
  }
}
```

### Environment Variables Required

| Variable | Purpose | Example |
|----------|---------|---------|
| `ENVIRONMENT` | Controls HSTS (production only) | `production`, `staging`, `development` |
| `WORKER_SHARED_SECRET` | HMAC secret for worker auth | 32+ character secret |
| `DATABASE_URL` | Database connection (for session validation) | `postgres://...` |

### Security Best Practices

1. **Store secrets securely**: Use Cloudflare Secrets for `WORKER_SHARED_SECRET`
2. **HTTPS only**: Enable HSTS in production
3. **Rate limit strictness**: Start strict, loosen based on monitoring
4. **Origin whitelisting**: Use for internal endpoints
5. **Log sensitive operations**: Use `enableLogging` for security events
6. **Rotate secrets regularly**: WORKER_SHARED_SECRET should be rotated quarterly

---

## Testing

### Basic Security Header Tests

```typescript
import { describe, it, expect } from 'vitest';
import { securityHeaders } from '@codex/security';

describe('Security Headers', () => {
  it('should set CSP header', async () => {
    const middleware = securityHeaders({
      environment: 'production',
    });

    const mockContext = {
      header: vi.fn(),
    };

    await middleware(mockContext as any, vi.fn());

    expect(mockContext.header).toHaveBeenCalledWith(
      'Content-Security-Policy',
      expect.stringContaining('default-src')
    );
  });

  it('should set HSTS in production', async () => {
    const middleware = securityHeaders({
      environment: 'production',
    });

    const mockContext = {
      header: vi.fn(),
    };

    await middleware(mockContext as any, vi.fn());

    expect(mockContext.header).toHaveBeenCalledWith(
      'Strict-Transport-Security',
      expect.stringContaining('31536000')
    );
  });
});
```

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `hono` | ^4.0.0 | Web framework and middleware system |
| `@codex/database` | workspace:* | Session and user data queries |
| `drizzle-orm` | 0.44.7 | ORM for database queries |
| `@cloudflare/workers-types` | ^4.20251014.0 | TypeScript types for Cloudflare Workers |

---

## License

Internal use only - Codex platform.
