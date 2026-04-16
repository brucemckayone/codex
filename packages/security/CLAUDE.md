# @codex/security

Security middleware and utilities for all Cloudflare Workers.

## Exports

| Export | Type | Purpose |
|---|---|---|
| `securityHeaders(options?)` | Middleware | CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy |
| `CSP_PRESETS` | Constant | `{ stripe, api }` — CSP preset configurations |
| `rateLimit(options)` | Middleware | KV-backed rate limiting |
| `RATE_LIMIT_PRESETS` | Constant | `{ auth, strict, streaming, api, webhook, web }` |
| `requireAuth(options)` | Middleware | Fail-closed session validation — 401 if no valid session |
| `optionalAuth(options)` | Middleware | Fail-open session validation — continues even if no session |
| `workerAuth(options)` | Middleware | HMAC-SHA256 worker-to-worker validation on receiving side |
| `workerFetch(url, init, secret, options?)` | Function | Signs outgoing worker-to-worker requests |
| `generateWorkerSignature(payload, secret, timestamp)` | Function | Low-level HMAC signature generation |
| `createKVSecondaryStorage()` | Function | BetterAuth KV session adapter |

`constantTimeEqual` is used internally but not exported — don't implement your own.

## Session Auth

Two-tier validation: KV cache (5-min TTL) → database fallback (authoritative).

```ts
// Preferred: via procedure policy (auto-validates, types ctx.user)
procedure({ policy: { auth: 'required' } })

// Manual: via middleware for non-procedure routes
app.use('/api/*', requireAuth({ kv: env.AUTH_SESSION_KV }));
```

`requireAuth` sets `c.get('user')` and `c.get('session')`. Returns 401 if no valid session.
`optionalAuth` sets them if valid but always calls `next()`.

## Rate Limiting

KV-backed, per-IP per-route. Key format: `rl:{ip}:{route}`. Falls back to in-memory if no KV (dev only).

| Preset | Limit | Window |
|---|---|---|
| `auth` | 5 req | 15 min |
| `strict` | 20 req | 60 s |
| `streaming` | 60 req | 60 s |
| `api` | 100 req | 60 s |
| `web` | 300 req | 60 s |
| `webhook` | 1000 req | 60 s |

```ts
// Preferred: via procedure policy
procedure({ policy: { rateLimit: 'auth' } })

// Manual: via middleware
app.use('/auth/*', rateLimit({ kv: env.RATE_LIMIT_KV, ...RATE_LIMIT_PRESETS.auth }));
```

Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

## Worker-to-Worker Auth (HMAC-SHA256)

Signature: `HMAC-SHA256(timestamp:body, WORKER_SHARED_SECRET)` → base64
Headers: `X-Worker-Signature` + `X-Worker-Timestamp`
Replay prevention: ±60s clock skew, 300s (5min) max age

```ts
// Receiving worker — validates incoming request
procedure({ policy: { auth: 'worker' } })
// or as middleware:
app.use('/internal/*', workerAuth({ secret: env.WORKER_SHARED_SECRET }));

// Calling worker — signs outgoing request
const response = await workerFetch(
  getServiceUrl('ecom', env),
  { method: 'POST', body: JSON.stringify(payload) },
  env.WORKER_SHARED_SECRET
);
// Note: body MUST be a string (not undefined) — serialize before calling workerFetch
```

## Security Headers

Applied automatically via `createWorker({ enableSecurityHeaders: true })`. Headers set:

| Header | Value |
|---|---|
| `Content-Security-Policy` | Configurable; `CSP_PRESETS.stripe` for payment workers |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Strict-Transport-Security` | Production only: `max-age=31536000; includeSubDomains; preload` |

## Strict Rules

- **MUST** use `procedure({ policy: { auth: 'required' } })` for any endpoint that accesses user data
- **MUST** use `rateLimit: 'auth'` on ALL auth endpoints (login, register, password reset)
- **MUST** use `policy: { auth: 'worker' }` for ALL worker-to-worker calls — NEVER skip HMAC
- **NEVER** compare secrets/tokens with `===` — the timing-safe implementation is internal
- **NEVER** log PII (passwords, tokens, emails) — use `ObservabilityClient` with redaction
- **NEVER** expose internal error details in responses — `mapErrorToResponse()` handles this

## Reference Files

- `packages/security/src/session-auth.ts` — `requireAuth`, `optionalAuth`, `SessionAuthConfig`
- `packages/security/src/worker-auth.ts` — `workerAuth`, `workerFetch`, `generateWorkerSignature`
- `packages/security/src/rate-limit.ts` — `rateLimit`, `RATE_LIMIT_PRESETS`
- `packages/security/src/headers.ts` — `securityHeaders`, `CSP_PRESETS`
- `packages/security/src/kv-secondary-storage.ts` — `createKVSecondaryStorage`
