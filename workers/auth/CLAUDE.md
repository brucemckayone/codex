# Auth Worker (port 42069)

Authentication and session management via BetterAuth. The only worker that doesn't use `procedure()` for most endpoints — BetterAuth owns the request/response contract.

## Endpoints

| Method | Path | Auth | Rate Limit | Response |
|---|---|---|---|---|
| POST | `/api/auth/email/register` | None | `auth` (5/15min) | `{ user, session }` + Set-Cookie |
| POST | `/api/auth/email/login` | None | `auth` (5/15min) | `{ user, session }` + Set-Cookie |
| GET | `/api/auth/session` | Cookie | — | `{ user, session }` or `null` |
| POST | `/api/auth/signout` | Cookie | — | Clear cookie |
| POST | `/api/auth/email/verify-email` | Token | — | Redirect |
| POST | `/api/auth/email/send-reset-password-email` | None | `auth` | — |
| POST | `/api/auth/email/reset-password` | Token | — | — |

## Architecture

- **Framework**: BetterAuth + Hono (BetterAuth handles auth logic, Hono provides HTTP layer)
- **Session storage**: PostgreSQL (`sessions` table) — authoritative source
- **Session cache**: KV (`AUTH_SESSION_KV`) — 5-minute TTL, fire-and-forget writes
- **Password hashing**: bcrypt (via BetterAuth)
- **Cookie**: `codex-session`, HttpOnly, Secure (prod), SameSite=Lax

## Session Validation Flow

Other workers validate sessions by calling `GET /api/auth/session` internally, but this is abstracted by the `procedure()` auth policy:

```
1. Cookie extracted from request
2. KV cache checked (AUTH_SESSION_KV, key: session:{token})
3. Cache hit → return user/session
4. Cache miss → query DB (sessions + users join)
5. DB hit → cache session in KV (fire-and-forget), return user/session
6. DB miss → return null (unauthenticated)
```

## Key Difference from Other Workers

This worker does NOT use `procedure()` for auth endpoints — BetterAuth provides its own handler that manages the full lifecycle (validation, password hashing, session creation, cookie setting). The health endpoint uses procedure().

## Email Provider

- **Production**: Resend (via notifications-api)
- **Development**: Console logging (emails printed to terminal)

## Strict Rules

- **MUST** use rate limiting (`auth` preset) on login/register — prevents brute force
- **MUST** use HttpOnly, Secure cookies — NEVER expose session tokens to JavaScript
- **MUST** hash passwords with bcrypt before storage — BetterAuth handles this
- **NEVER** log passwords, session tokens, or reset tokens
- **NEVER** return password hashes in API responses
- **NEVER** bypass BetterAuth for auth operations — it manages the security lifecycle

## Integration

- **Services**: BetterAuth (auth framework), `@codex/security` (session caching, headers)
- **Used by**: ALL other workers (session validation via `GET /api/auth/session`)
- **Config**: `BETTER_AUTH_SECRET`, `DATABASE_URL`, `AUTH_SESSION_KV`, `RATE_LIMIT_KV`

## Reference Files

- `workers/auth/src/index.ts` — main handler
- `workers/auth/src/auth-config.ts` — BetterAuth configuration
- `workers/auth/src/email.ts` — email sending integration
