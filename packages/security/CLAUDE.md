# @codex/security

Security middleware and utilities for all Cloudflare Workers.

## API

### Middleware
| Middleware | Purpose |
|---|---|
| `securityHeaders(options?)` | CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy |
| `rateLimit(preset)` | KV-backed rate limiting with configurable presets |
| `optionalAuth(options)` | Session validation (fail-open) — sets `c.get('user')` if valid, continues if not |
| `requireAuth(options)` | Session validation (fail-closed) — returns 401 if no valid session |
| `workerAuth(options)` | HMAC-SHA256 worker-to-worker authentication with replay prevention |

### Utilities
| Export | Purpose |
|---|---|
| `generateWorkerSignature(payload, secret, timestamp)` | Create HMAC signature for worker-to-worker calls |
| `workerFetch(url, options)` | Fetch with automatic HMAC signature headers |
| `constantTimeEqual(a, b)` | Timing-safe string comparison (prevents timing attacks) |
| `createKVSecondaryStorage()` | BetterAuth KV session adapter |
| `extractSessionCookie(cookieHeader)` | Parse session token from cookie string |

## Security Patterns (MANDATORY)

### Session Authentication

**How it works** (two-tier validation):
1. **KV Cache (primary)**: `AUTH_SESSION_KV` with 5-minute TTL. Key: `session:{token}`. Fails gracefully.
2. **Database (authoritative)**: Queries `sessions` table with `expiresAt > now`. Includes user join.
3. **Cache write**: Fire-and-forget via async — never blocks the response.

**Usage in workers**:
```ts
// Via procedure (preferred — auto-validates and types ctx.user)
procedure({ policy: { auth: 'required' } })

// Via middleware (manual — for non-procedure routes)
app.use('/api/*', requireAuth({ kv: env.AUTH_SESSION_KV }));
```

**Cookie security**: HttpOnly, Secure (production), SameSite=Lax, managed by BetterAuth.

### Rate Limiting

KV-backed with per-IP tracking. Key format: `rl:{ip}:{route}`.

| Preset | Limit | Window | Use Case |
|---|---|---|---|
| `api` | 100 req | 60s | Standard API endpoints |
| `auth` | 5 req | 900s (15min) | Login, register, password reset |
| `strict` | 20 req | 60s | Sensitive operations |
| `streaming` | 60 req | 60s | Presigned URL generation |
| `webhook` | 1000 req | 60s | Incoming webhooks |
| `web` | 300 req | 60s | General web traffic |

**Response headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

**Usage**:
```ts
// Via procedure (preferred)
procedure({ policy: { rateLimit: 'auth' } })

// Via middleware
app.use('/api/auth/*', rateLimit(RATE_LIMIT_PRESETS.auth));
```

### Worker-to-Worker Auth (HMAC-SHA256)

**Protocol**:
- Signature: `HMAC-SHA256(timestamp:payload, shared_secret)` → base64
- Headers: `X-Worker-Signature` + `X-Worker-Timestamp`
- Replay prevention: ±60s clock skew, 300s (5min) max age
- Comparison: `constantTimeEqual()` — prevents timing attacks

**Usage**:
```ts
// Receiving worker (validates incoming request)
procedure({ policy: { auth: 'worker' } })

// Calling worker (signs outgoing request)
import { workerFetch } from '@codex/security';
await workerFetch(url, { method: 'POST', body, secret: env.WORKER_SHARED_SECRET });
```

### Security Headers

Applied via `createWorker({ enableSecurityHeaders: true })` (automatic).

| Header | Value |
|---|---|
| `Content-Security-Policy` | Configurable directives, preset for Stripe |
| `X-Frame-Options` | `DENY` (clickjacking prevention) |
| `X-Content-Type-Options` | `nosniff` (MIME sniffing prevention) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | Disables geolocation, microphone, camera, payment |
| `Strict-Transport-Security` | Production only: `max-age=31536000; includeSubDomains; preload` |

**CSP Presets**:
- `CSP_PRESETS.stripe` — allows Stripe.js and Elements
- `CSP_PRESETS.api` — restrictive for API workers

### Input Validation (XSS/Injection Prevention)

- **All POST/PATCH**: Validate with Zod schemas before processing
- **SVG uploads**: Use `@codex/validation` `sanitizeSvgContent()` (DOMPurify-based)
- **User text**: Use `createSanitizedStringSchema(min, max)` (auto-trims, bounds length)
- **URLs**: Use `urlSchema` (blocks `javascript:`, `data:` protocols)

### PII Protection

- **NEVER** log passwords, session tokens, full emails, or payment data
- **MUST** use `redactSensitiveData()` from `@codex/observability` for request/response logs
- **MUST** include only IDs (not user data) in error context

## Strict Rules

- **MUST** use `procedure({ policy: { auth: 'required' } })` for ANY endpoint that accesses user data
- **MUST** use `rateLimit: 'auth'` on ALL authentication endpoints (login, register, reset)
- **MUST** use `policy: { auth: 'worker' }` for ALL worker-to-worker calls — NEVER call internal workers without HMAC
- **MUST** use `constantTimeEqual()` for any secret comparison — NEVER use `===` for secrets/tokens
- **NEVER** log PII (passwords, tokens, emails, payment data) — use ObservabilityClient with redaction
- **NEVER** expose internal error details (stack traces, SQL, DB URLs) in API responses
- **NEVER** skip security headers — they're applied automatically by `createWorker()`
- **NEVER** disable rate limiting in production

## Integration

- **Depends on**: `@codex/database` (session lookup), `@codex/observability` (logging)
- **Used by**: `@codex/worker-utils` (procedure policy enforcement), all workers

## Reference Files

- `packages/security/src/session-auth.ts` — `optionalAuth`, `requireAuth`, session validation
- `packages/security/src/worker-auth.ts` — `workerAuth`, `generateWorkerSignature`, `workerFetch`
- `packages/security/src/rate-limit.ts` — `rateLimit`, `RATE_LIMIT_PRESETS`
- `packages/security/src/security-headers.ts` — `securityHeaders`, CSP presets
