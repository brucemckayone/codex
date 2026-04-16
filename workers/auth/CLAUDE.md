# Auth Worker (port 42069)

Authentication and session management via BetterAuth. The only worker that doesn't use `procedure()` for most endpoints — BetterAuth owns the request/response lifecycle.

## Endpoints

| Method | Path | Auth | Rate Limit | Notes |
|---|---|---|---|---|
| POST | `/api/auth/sign-up/email` | None | `auth` (5/15min) | Register; sends verification email |
| POST | `/api/auth/sign-in/email` | None | `auth` (5/15min) | Login; requires email verified |
| GET | `/api/auth/session` | Cookie | — | Returns `{ user, session }` or `null` |
| POST | `/api/auth/sign-out` | Cookie | — | Clears session cookie |
| POST | `/api/auth/verify-email` | Token | — | Verifies email, auto-signs-in |
| POST | `/api/auth/send-reset-password-email` | None | `auth` (5/15min) | Sends password reset link (1h expiry) |
| POST | `/api/auth/reset-password` | Token | — | Resets password |
| GET | `/api/test/verification-token/:email` | None | — | DEV/TEST ONLY — returns KV-stored token |
| POST | `/api/test/fast-register` | None | — | DEV/TEST ONLY — register + verify in one call |

Rate-limited paths are: sign-up/email, sign-in/email, send-reset-password-email, reset-password.

## Architecture

- **Framework**: BetterAuth + Hono. BetterAuth handles all `/api/auth/*` via its own handler; Hono provides the HTTP layer.
- **Session storage**: PostgreSQL (`sessions` table) — authoritative
- **Session cache**: `AUTH_SESSION_KV` via `createKVSecondaryStorage()` — BetterAuth `secondaryStorage`. 5-minute cookie cache (`cookieCache.maxAge = 300`).
- **Session expiry**: 24h, renewed every 24h
- **Cookie name**: from `COOKIES.SESSION_NAME` constant; HttpOnly, Secure (non-dev), SameSite=Lax
- **Cross-subdomain**: `crossSubDomainCookies` enabled — `.lvh.me` in dev, `.{ip}.nip.io` for LAN, `.revelations.studio` in prod

## Session Validation Flow (used by all other workers)

```
Request with cookie → procedure() auth middleware
  → @codex/security reads cookie → checks AUTH_SESSION_KV
  → cache hit: return user/session
  → cache miss: query DB → write KV (fire-and-forget) → return user/session
```

## Email

Auth emails (verification, password reset, welcome) are sent via `POST /internal/send` on the **notifications-api** using `workerFetch` (HMAC). Errors are swallowed — email failure does not block registration/login. Verification tokens are also stored in `AUTH_SESSION_KV` keyed `verification:{email}` (5min TTL) for E2E tests.

## Bindings / Env

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Neon PostgreSQL |
| `BETTER_AUTH_SECRET` | Yes | BetterAuth signing secret |
| `AUTH_SESSION_KV` | Yes | Session cache + verification token storage |
| `RATE_LIMIT_KV` | Yes | Rate limiting |
| `ENVIRONMENT` | Yes | `development` / `test` / `production` |
| `WEB_APP_URL` | No | App base URL (cookie domain, email links) |
| `API_URL` | No | Trusted origin for CORS |
| `WORKER_SHARED_SECRET` | No | HMAC secret for notifications-api calls |
| `RESEND_API_KEY` | No | Resend (prod email) |
| `FROM_EMAIL` / `FROM_NAME` | No | Email sender identity |
| `USE_MOCK_EMAIL` | No | `"true"` → console logging instead of Resend |

## Key Differences from Other Workers

- `enableGlobalAuth: false` — BetterAuth owns auth, not `procedure()`
- `enableSecurityHeaders: false` — applied manually via `securityHeaders()` middleware on `/api/*`
- Rate limiting applied via `createAuthRateLimiter()` middleware, not `procedure()` policy
- Test endpoints (`/api/test/*`) return 404 in staging/production

## Strict Rules

- **MUST** use rate limiting (`auth` preset) on login, register, and password reset
- **MUST** use HttpOnly, Secure cookies — NEVER expose session tokens to JavaScript
- **NEVER** log passwords, session tokens, or reset tokens
- **NEVER** return password hashes in API responses
- **NEVER** bypass BetterAuth for auth operations

## Reference Files

- `workers/auth/src/index.ts` — worker setup, BetterAuth delegation, test endpoints
- `workers/auth/src/auth-config.ts` — BetterAuth configuration (cookie, session, email verification)
- `workers/auth/src/email.ts` — email helpers (verification, reset, welcome, password changed)
- `workers/auth/src/middleware/rate-limiter.ts` — auth rate limiter middleware
- `workers/auth/src/types.ts` — `AuthBindings`, `AuthEnv`
