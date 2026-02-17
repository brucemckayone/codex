# @codex/security

Security middleware & utilities.

## API
### Middleware
- **securityHeaders()**: CSP, HSTS, XFO.
- **rateLimit(opts)**: KV-backed. Presets: `api` (100/m), `auth` (5/15m), `webhook` (1000/m).
- **optionalAuth/requireAuth()**: Session check (Cookie -> KV -> DB). Sets `c.user`.
- **workerAuth()**: HMAC-SHA256 worker-to-worker auth.

### Utils
- **generateWorkerSignature**: Create HMAC sig.
- **createKVSecondaryStorage**: BetterAuth KV adapter.

## Security Patterns (MANDATORY)

### Session Authentication
- **Workers:** Use `procedure({ policy: { auth: 'required' } })` (auto-validates)
- **Middleware:** `requireAuth()` sets `ctx.user` and `ctx.session`
- **Session cache:** KV (5min TTL) + Database (authoritative)
- **Cookie security:** HttpOnly, Secure, SameSite=Strict (handled by BetterAuth)

### Rate Limiting
- **Auth endpoints:** `RATE_LIMIT_PRESETS.auth` (5 req/15min) - strict for login/register
- **API endpoints:** `RATE_LIMIT_PRESETS.api` (100 req/min) - standard
- **Webhooks:** `RATE_LIMIT_PRESETS.webhook` (1000 req/min) - high throughput
- **Usage:** `procedure({ policy: { rateLimit: 'auth' } })` or `app.use(rateLimit(preset))`

### Input Validation (XSS/Injection Prevention)
- **All POST/PATCH:** Validate with Zod schemas before processing
- **SVG uploads:** Use `@codex/validation` `svgSchema` (DOMPurify sanitization)
- **User text:** Use `createSanitizedStringSchema()` (auto-trims, bounds length)

### Security Headers
- **Production:** HSTS, strict CSP, X-Frame-Options: DENY
- **Usage:** `createWorker({ enableSecurityHeaders: true })` (applied automatically)
- **Custom headers:** For Stripe webhooks, use `HEADER_PRESETS.stripe` (allows Stripe.js)

### Worker-to-Worker Auth (HMAC)
- **Pattern:** `policy: { auth: 'worker' }` validates HMAC signature
- **Replay prevention:** Timestamp validation (±60s clock skew, 5min max age)
- **Usage:** Media transcoding callbacks, internal admin operations

### PII Protection
- **NEVER log:** Passwords, tokens, full emails, payment data
- **Use:** `redactSensitiveData()` from `@codex/observability` for request/response logs
- **Errors:** Context should include IDs only, not user data

## Patterns
- **Defense in Depth**: Headers + Rate Limit + Auth + Validation.
- **Session**: Cached in KV (5m).
- **Worker Auth**: Shared Secret + Timestamp.

## Usage
```ts
app.use('*', securityHeaders());
app.use('/api/*', rateLimit(RATE_LIMIT_PRESETS.api));
app.use('/api/*', requireAuth({ kv }));
```

## Standards
- **Assert**: Use `invariant()` for internal consistency.
- **Types**: Strict TS. Single Source of Truth.
- **Pure**: No side-effects or business logic.
