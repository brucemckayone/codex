# Worker Security Guide

Quick reference for building secure Cloudflare Workers in this project.

## Required Security Middleware

Every worker **must** apply these three middleware functions from `@codex/security`:

```typescript
import { securityHeaders, rateLimit, CSP_PRESETS, RATE_LIMIT_PRESETS } from '@codex/security';

// 1. Security Headers - REQUIRED
app.use('*', (c, next) => {
  return securityHeaders({
    environment: c.env?.ENVIRONMENT || 'development',
    csp: CSP_PRESETS.api, // Choose appropriate preset
  })(c, next);
});

// 2. Rate Limiting - REQUIRED
app.use('*', (c, next) => {
  return rateLimit({
    kv: c.env?.RATE_LIMIT_KV, // Falls back to in-memory if undefined
    ...RATE_LIMIT_PRESETS.webhook, // Choose appropriate preset
  })(c, next);
});

// 3. Observability - REQUIRED
app.use('*', async (c, next) => {
  const obs = new ObservabilityClient('worker-name', c.env?.ENVIRONMENT || 'development');
  const timer = createRequestTimer(obs, c.req);
  await next();
  timer.end(c.res.status);
});
```

## CSP Presets

Choose the right Content Security Policy for your worker:

- **`CSP_PRESETS.api`** - For API workers (JSON only, no frontend)
  - Most restrictive: `default-src 'none'`
  - Use for: webhook handlers, internal APIs

- **`CSP_PRESETS.web`** - For workers serving HTML/JS
  - Allows scripts, styles, images from same origin
  - Use for: authentication pages, admin panels

- **`CSP_PRESETS.stripe`** - For Stripe.js integration
  - Allows Stripe scripts and frames
  - Use for: payment pages, checkout flows

## Rate Limit Presets

Choose the right rate limit for your worker:

- **`RATE_LIMIT_PRESETS.auth`** - 10 requests/min
  - Use for: login, signup, password reset

- **`RATE_LIMIT_PRESETS.api`** - 100 requests/min
  - Use for: general API endpoints

- **`RATE_LIMIT_PRESETS.webhook`** - 1000 requests/min
  - Use for: external webhook handlers (Stripe, GitHub, etc.)

- **`RATE_LIMIT_PRESETS.web`** - 300 requests/min
  - Use for: web page requests

## Secret Management Rules

### ✅ DO

```typescript
// Use environment bindings
const secret = c.env.STRIPE_SECRET_KEY;

// Optional chaining for test safety
const kv = c.env?.RATE_LIMIT_KV;

// Verify secrets exist before use
if (!c.env.STRIPE_WEBHOOK_SECRET_PAYMENT) {
  return c.json({ error: 'Configuration error' }, 500);
}
```

### ❌ DON'T

```typescript
// ❌ Never hardcode secrets
const key = 'sk_live_abc123';

// ❌ Never log secrets
console.log('Key:', c.env.STRIPE_SECRET_KEY);

// ❌ Never return secrets in responses
return c.json({ config: c.env });

// ❌ Never access c.env without optional chaining
const env = c.env.ENVIRONMENT; // Crashes in tests
```

## Health Endpoint Pattern

```typescript
app.get('/health', (c) => {
  // ✅ SAFE: Only expose non-sensitive info
  return c.json({
    status: 'healthy',
    worker: 'my-worker-name',
    environment: c.env?.ENVIRONMENT || 'development',
    timestamp: new Date().toISOString(),
  });

  // ❌ NEVER expose:
  // - config: c.env
  // - hasDatabase: !!c.env.DATABASE_URL
  // - Any boolean flags revealing secrets
});
```

## Error Handling

```typescript
app.onError((err, c) => {
  const obs = new ObservabilityClient('worker-name', c.env?.ENVIRONMENT || 'development');

  // ✅ Log error with context (PII is auto-redacted)
  obs.trackError(err, {
    url: c.req.url,
    method: c.req.method
  });

  // ❌ Never expose error details to client
  return c.text('Internal Server Error', 500);

  // ❌ DON'T return:
  // - Stack traces
  // - File paths
  // - Environment variables
  // - Database errors
});
```

## Worker-to-Worker Authentication

When calling another worker:

```typescript
import { generateWorkerSignature, workerAuth } from '@codex/security';

// Calling worker (client)
const timestamp = Math.floor(Date.now() / 1000);
const payload = JSON.stringify({ action: 'doSomething' });
const signature = await generateWorkerSignature(
  payload,
  c.env.WORKER_SHARED_SECRET,
  timestamp
);

await fetch('https://other-worker.example.com/internal/action', {
  method: 'POST',
  headers: {
    'X-Worker-Signature': signature,
    'X-Worker-Timestamp': timestamp.toString(),
  },
  body: payload,
});

// Receiving worker (server)
app.post('/internal/*', workerAuth({
  secret: c.env.WORKER_SHARED_SECRET,
  allowedOrigins: ['https://calling-worker.example.com'],
}));
```

## Testing Security

```typescript
// Write integration tests for each worker
describe('Worker Security Integration', () => {
  it('should apply security headers', async () => {
    const res = await app.request('/test');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toBeTruthy();
  });

  it('should not expose secrets in responses', async () => {
    const res = await app.request('/health');
    const body = await res.json();
    expect(body).not.toHaveProperty('DATABASE_URL');
    expect(body).not.toHaveProperty('config');
  });
});
```

## Bindings Type Safety

Always define bindings type for TypeScript safety:

```typescript
type Bindings = {
  ENVIRONMENT?: string;
  DATABASE_URL?: string;
  STRIPE_SECRET_KEY?: string;
  RATE_LIMIT_KV?: KVNamespace;
  // Add all your worker bindings here
};

const app = new Hono<{ Bindings: Bindings }>();
```

## Common Vulnerabilities

### 1. Secret Exposure
**Risk:** Leaking API keys, database URLs, or tokens
**Fix:** Never log, return, or include secrets in responses

### 2. Missing Rate Limiting
**Risk:** DoS attacks, credential stuffing
**Fix:** Always apply `rateLimit()` middleware with appropriate preset

### 3. Permissive CSP
**Risk:** XSS attacks via script injection
**Fix:** Use strictest CSP preset possible (prefer `CSP_PRESETS.api`)

### 4. No Replay Protection
**Risk:** Replay attacks on worker-to-worker calls
**Fix:** Use `workerAuth()` middleware with timestamp validation

### 5. Missing HSTS in Production
**Risk:** Downgrade attacks, session hijacking
**Fix:** `securityHeaders()` automatically adds HSTS in production

## Quick Checklist

Before deploying a new worker:

- [ ] Applied `securityHeaders()` middleware
- [ ] Applied `rateLimit()` middleware with appropriate preset
- [ ] Applied observability middleware
- [ ] Defined Bindings type
- [ ] Used optional chaining for `c.env` access
- [ ] Health endpoint doesn't expose secrets
- [ ] Error handler doesn't leak stack traces
- [ ] Secrets verified before use
- [ ] Integration tests written
- [ ] CSP preset appropriate for worker type

## Example Worker Template

```typescript
import { Hono } from 'hono';
import { ObservabilityClient, createRequestTimer } from '@codex/observability';
import { securityHeaders, rateLimit, CSP_PRESETS, RATE_LIMIT_PRESETS } from '@codex/security';

type Bindings = {
  ENVIRONMENT?: string;
  RATE_LIMIT_KV?: KVNamespace;
  // Add your bindings here
};

const app = new Hono<{ Bindings: Bindings }>();

// Security middleware
app.use('*', (c, next) => {
  return securityHeaders({
    environment: c.env?.ENVIRONMENT || 'development',
    csp: CSP_PRESETS.api,
  })(c, next);
});

app.use('*', (c, next) => {
  return rateLimit({
    kv: c.env?.RATE_LIMIT_KV,
    ...RATE_LIMIT_PRESETS.api,
  })(c, next);
});

app.use('*', async (c, next) => {
  const obs = new ObservabilityClient('my-worker', c.env?.ENVIRONMENT || 'development');
  const timer = createRequestTimer(obs, c.req);
  await next();
  timer.end(c.res.status);
});

// Error handling
app.onError((err, c) => {
  const obs = new ObservabilityClient('my-worker', c.env?.ENVIRONMENT || 'development');
  obs.trackError(err, { url: c.req.url, method: c.req.method });
  return c.text('Internal Server Error', 500);
});

// Routes
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    worker: 'my-worker',
    environment: c.env?.ENVIRONMENT || 'development',
    timestamp: new Date().toISOString(),
  });
});

export default app;
```

## Additional Resources

- [Security Package Documentation](../packages/security/README.md)
- [Cloudflare Workers Security Best Practices](https://developers.cloudflare.com/workers/platform/security/)
- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)
