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

| Preset | Limit | Window | Store | Binding |
|---|---|---|---|---|
| `auth` | 5 req | 15 min | Durable Object | `RATE_LIMIT_DO` |
| `strict` | 20 req | 60 s | native binding | `RATE_LIMIT_STRICT` |
| `streaming` | 60 req | 60 s | native binding | `RATE_LIMIT_STREAMING` |
| `api` | 100 req | 60 s | native binding | `RATE_LIMIT_API` |
| `web` | 300 req | 60 s | native binding | `RATE_LIMIT_WEB` |

There is deliberately **no `webhook` preset**. Stripe and RunPod webhooks are
HMAC-authenticated, so a per-IP cap adds no security there and can only reject a
legitimate retry burst.

Counting no longer happens in KV (Codex-kgrdp.17). The KV limiter did a `get`
then a `put` on every request, which burned the account-wide 1,000-writes/day
free budget — and, being eventually consistent with no atomic increment, it
undercounted a burst at the same time.

```ts
// Preferred: via procedure policy. ENFORCED since Codex-kgrdp.9 — an omitted
// rateLimit means the `api` preset (100/min per subject), NOT "unlimited".
// `auth: 'worker'` routes are exempt: the caller is HMAC-authenticated and
// internal, so a per-hop cap can only break a legitimate fan-out.
procedure({ policy: { auth: 'required', rateLimit: 'strict' } })

// Manual: via middleware. `subject` is REQUIRED — there is no default.
app.use('/api/auth/sign-in/email', rateLimit({
  preset: 'auth',
  namespace: c.env.RATE_LIMIT_DO,
  subject: combineSubjects(credentialSubject(), trustedIpSubject()),
}));
```

### `subject` is required, and why

The old default keyed on `CF-Connecting-IP`. On any surface reached by a
worker-to-worker fetch that header holds the **calling worker's** Cloudflare
egress address, not the user's — one measured address was 78% of all traffic to
the auth host, collapsing every user into a single bucket. So:

- `credentialSubject()` — the submitted (normalised) identifier. The subject
  actually under attack in credential stuffing, and immune to egress collapse.
- `sessionSubject()` — the authenticated user id. Needs `c.get('user')`, so it
  names nothing in a middleware mounted ahead of auth; use
  `presentedSessionSubject()` there, which reads the forwarded session cookie.
- `trustedIpSubject()` — the transport address, and **only** where it is
  trustworthy (`trustedClientIp` withholds Cloudflare egress ranges).
- `combineSubjects(...)` — charges each its own bucket and blocks if **any** is
  exhausted. Note the consequence: a spent address bucket blocks a caller whose
  own session bucket is untouched.

Every subject value is SHA-256'd before it reaches a bucket key or a log line.

### Fail-open, loudly

An unavailable backend must never take sign-in down, so a missing binding, a
missing namespace, an unnameable subject or a throwing store all let the request
through — and every one emits `RATE_LIMIT_FAIL_OPEN_SIGNAL`
(`rate_limit.fail_open`) at **error** level, on every request. Alert on that
string: the KV limiter failed open on a `warn` nobody ever saw, which is how a
completely unenforced auth limiter sat in production unnoticed.

### Response headers

`X-RateLimit-Limit` / `-Remaining` / `-Reset` are emitted **only** by the
Durable Object store (i.e. the `auth` preset). The native binding returns
`{ success }` alone, so remaining and reset are genuinely unknowable and are
omitted rather than guessed. `Retry-After` is always set on a 429.

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
