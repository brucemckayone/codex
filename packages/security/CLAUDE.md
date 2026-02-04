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
