# Auth Worker

## Overview

The Auth Worker provides centralized authentication and session management for all Codex API services. Built on Better-auth, it handles user registration, login, session validation, and email verification via email/password authentication. Deployed on Cloudflare Workers at `auth.revelations.studio` (production) with session caching via KV and strict rate limiting on login endpoints to prevent brute force attacks.

## Architecture

### Route Structure

Auth Worker uses a delegating architecture where Better-auth handles all authentication logic:

- **Global Route**: `/api/*` - All auth operations delegated to Better-auth
- **Health Check**: `/health` - Service health and dependency status
- **404 Handler**: Unmatched routes return 404 Not Found

### Middleware Chain

Requests flow through middleware in sequence before reaching the Better-auth handler:

1. **Standard Middleware** (from worker-utils)
   - Request tracking (request ID generation)
   - X-Forwarded headers handling
   - Ensures observability across all requests

2. **Security Headers Middleware**
   - Applies environment-specific security headers
   - X-Content-Type-Options, X-Frame-Options, CSP policies
   - Configured via @codex/security package

3. **Auth Rate Limiter Middleware**
   - IP-based rate limiting on POST /api/auth/email/login
   - Uses RATE_LIMIT_KV for tracking request counts
   - Preset thresholds from @codex/security (RATE_LIMIT_PRESETS.auth)
   - Returns 429 Too Many Requests when limit exceeded

4. **Session Cache Middleware**
   - Checks AUTH_SESSION_KV for cached sessions before processing
   - Extracts session cookie `codex-session` from request
   - Populates `session` and `user` context variables if found
   - After request, caches new sessions with TTL matching expiry
   - Reduces database load for repeated session validations

5. **Better-auth Handler**
   - Validates JSON request bodies for POST/PUT/PATCH
   - Returns 400 Bad Request if JSON malformed
   - Delegates all auth operations to Better-auth instance
   - Returns 404 Not Found if Better-auth has no matching route

### Dependency Injection Pattern

```typescript
// Each request creates fresh Better-auth instance with environment bindings
const auth = createAuthInstance({ env: c.env });
const response = await auth.handler(c.req.raw);
```

The `createAuthInstance()` function (auth-config.ts) receives Cloudflare bindings and returns configured Better-auth instance with:
- Database adapter (Drizzle ORM pointing to Neon PostgreSQL)
- Session configuration (24-hour expiry, 5-minute cookie cache)
- Email/password plugin enabled with verification requirements
- Custom user fields (role field required, defaults to 'customer')

### Environment Integration

All workers that call auth endpoints (content, identity, access, etc.) trigger:
1. Request hits auth worker
2. Middleware chain applies
3. Session cache checked
4. Better-auth processes authentication
5. Response returned with Set-Cookie headers
6. Calling worker receives session/user in context variables

## Public Endpoints

### GET /health

**Purpose**: Service health check endpoint for monitoring and orchestration.

**Authentication**: Not required

**Rate Limit**: No rate limiting applied

**Response** (200 or 503):
```json
{
  "status": "healthy | degraded",
  "service": "auth-worker",
  "version": "1.0.0",
  "timestamp": "2025-11-23T12:34:56Z",
  "checks": {
    "kv_auth_session": "healthy | unhealthy",
    "kv_rate_limit": "healthy | unhealthy",
    "database": "healthy | unhealthy"
  }
}
```

**Possible Errors**:
- 503 Service Unavailable: One or more critical dependencies (KV namespaces, database) unavailable

**Example**:
```bash
curl https://auth.revelations.studio/health

# Response (200)
{
  "status": "healthy",
  "service": "auth-worker",
  "version": "1.0.0",
  "timestamp": "2025-11-23T12:34:56Z",
  "checks": {
    "kv_auth_session": "healthy",
    "kv_rate_limit": "healthy",
    "database": "healthy"
  }
}
```

### POST /api/auth/email/register

**Purpose**: Register new user account with email and password.

**Authentication**: Not required

**Rate Limit**: Applied via RATE_LIMIT_PRESETS.auth (see Security Model below)

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "name": "John Doe"
}
```

- `email` (string, required): User email address. Must be unique, will be converted to lowercase
- `password` (string, required): User password. Will be hashed via bcrypt before storage
- `name` (string, optional): User display name

**Response** (200):
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "customer",
    "emailVerified": false,
    "createdAt": "2025-11-23T12:34:56Z"
  },
  "session": {
    "id": "session-uuid",
    "userId": "user-uuid",
    "expiresAt": "2025-11-24T12:34:56Z",
    "token": "session-token"
  }
}
```

Returns user object and creates session. Client must store `Set-Cookie: codex-session=...` header. Email verification required before user can access protected resources.

**Possible Errors**:
- 400 Bad Request: Email already exists or validation failed
- 422 Unprocessable Entity: Invalid email format or weak password
- 500 Internal Server Error: Better-auth error during user creation

**Example**:
```bash
curl -X POST https://auth.revelations.studio/api/auth/email/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securePassword123",
    "name": "John Doe"
  }' \
  -c cookies.txt

# Response (200)
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "customer",
    "emailVerified": false,
    "createdAt": "2025-11-23T12:34:56Z"
  },
  "session": {
    "id": "session-550e8400",
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "expiresAt": "2025-11-24T12:34:56Z"
  }
}

# Set-Cookie header in response:
# codex-session=session-token-string; Path=/; HttpOnly; Secure; SameSite=Strict
```

### POST /api/auth/email/login

**Purpose**: Authenticate existing user and establish session.

**Authentication**: Not required (but user must exist)

**Rate Limit**: Strict rate limiting applied (10 attempts per 15 minutes per IP via RATE_LIMIT_PRESETS.auth)

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

- `email` (string, required): Registered user email
- `password` (string, required): User password (case-sensitive)

**Response** (200):
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "customer",
    "emailVerified": true,
    "createdAt": "2025-11-23T12:34:56Z"
  },
  "session": {
    "id": "session-uuid",
    "userId": "user-uuid",
    "expiresAt": "2025-11-24T12:34:56Z",
    "token": "session-token"
  }
}
```

Returns user object and creates session. Client receives `Set-Cookie: codex-session=...`. Session cached in AUTH_SESSION_KV for 5 minutes to reduce database queries.

**Possible Errors**:
- 400 Bad Request: Invalid email/password combination
- 401 Unauthorized: Email not verified (user must verify email first)
- 429 Too Many Requests: Rate limit exceeded on login endpoint (too many failed attempts)
- 500 Internal Server Error: Database error or Better-auth error

**Example**:
```bash
curl -X POST https://auth.revelations.studio/api/auth/email/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securePassword123"
  }' \
  -c cookies.txt

# Response (200)
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "customer",
    "emailVerified": true,
    "createdAt": "2025-11-23T12:34:56Z"
  },
  "session": {
    "id": "session-550e8400",
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "expiresAt": "2025-11-24T12:34:56Z"
  }
}
```

### POST /api/auth/email/send-reset-password-email

**Purpose**: Send password reset email to user's registered email address.

**Authentication**: Not required

**Rate Limit**: Applied via RATE_LIMIT_PRESETS.auth

**Request Body**:
```json
{
  "email": "user@example.com"
}
```

- `email` (string, required): User's registered email address

**Response** (200):
```json
{
  "success": true
}
```

Triggers email send (currently logs to console, TODO: integrate notification service). Email contains reset link with verification token. User clicks link to reset password.

**Possible Errors**:
- 400 Bad Request: Email not registered in system
- 500 Internal Server Error: Email sending failed

**Example**:
```bash
curl -X POST https://auth.revelations.studio/api/auth/email/send-reset-password-email \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'

# Response (200)
{"success": true}
```

### POST /api/auth/email/reset-password

**Purpose**: Reset user password using verification token from reset email.

**Authentication**: Not required (token acts as authentication)

**Rate Limit**: Applied via RATE_LIMIT_PRESETS.auth

**Request Body**:
```json
{
  "token": "verification-token-from-email",
  "newPassword": "newSecurePassword123"
}
```

- `token` (string, required): Verification token from password reset email
- `newPassword` (string, required): New password (case-sensitive)

**Response** (200):
```json
{
  "success": true,
  "session": {
    "id": "session-uuid",
    "userId": "user-uuid",
    "expiresAt": "2025-11-24T12:34:56Z"
  }
}
```

Creates new session after password reset. Client receives `Set-Cookie: codex-session=...`.

**Possible Errors**:
- 400 Bad Request: Invalid or expired token
- 422 Unprocessable Entity: Password too weak

**Example**:
```bash
curl -X POST https://auth.revelations.studio/api/auth/email/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "token": "abc123def456",
    "newPassword": "newSecurePassword123"
  }' \
  -c cookies.txt
```

### GET /api/auth/session

**Purpose**: Get current authenticated user's session and profile data.

**Authentication**: Required (must have valid codex-session cookie)

**Rate Limit**: No rate limiting

**Request Parameters**: None (uses session cookie)

**Response** (200):
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "customer",
    "emailVerified": true,
    "createdAt": "2025-11-23T12:34:56Z"
  },
  "session": {
    "id": "session-uuid",
    "userId": "user-uuid",
    "expiresAt": "2025-11-24T12:34:56Z"
  }
}
```

Returns authenticated user and session info. Session retrieved from KV cache if available, otherwise from database.

**Possible Errors**:
- 401 Unauthorized: No valid session cookie
- 404 Not Found: Session expired or invalid

**Example**:
```bash
curl https://auth.revelations.studio/api/auth/session \
  -H "Cookie: codex-session=session-token-string"

# Response (200)
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "customer",
    "emailVerified": true,
    "createdAt": "2025-11-23T12:34:56Z"
  },
  "session": {
    "id": "session-550e8400",
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "expiresAt": "2025-11-24T12:34:56Z"
  }
}
```

### POST /api/auth/signout

**Purpose**: Invalidate user's session and sign out.

**Authentication**: Required (must have valid codex-session cookie)

**Rate Limit**: No rate limiting

**Request Parameters**: None (uses session cookie)

**Response** (200):
```json
{
  "success": true
}
```

Deletes session from database and KV cache. Client should remove codex-session cookie.

**Possible Errors**:
- 401 Unauthorized: No valid session cookie
- 500 Internal Server Error: Database error during deletion

**Example**:
```bash
curl -X POST https://auth.revelations.studio/api/auth/signout \
  -H "Cookie: codex-session=session-token-string"

# Response (200)
{"success": true}
```

### GET/POST /api/auth/verify-email

**Purpose**: Verify user email address using verification token from registration email.

**Authentication**: Not required (token acts as authentication)

**Rate Limit**: Applied via RATE_LIMIT_PRESETS.auth

**Request Parameters**:
- `token` (string, query or body): Verification token from registration email

**Response** (200):
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "customer",
    "emailVerified": true,
    "createdAt": "2025-11-23T12:34:56Z"
  }
}
```

Marks email as verified. User can now log in and access protected resources.

**Possible Errors**:
- 400 Bad Request: Invalid or expired verification token
- 404 Not Found: User associated with token not found

**Example**:
```bash
curl "https://auth.revelations.studio/api/auth/verify-email?token=abc123def456"
```

## Better-auth Integration

### Configuration

Better-auth is instantiated per-request via `createAuthInstance()` in auth-config.ts:

```typescript
export function createAuthInstance(options: AuthConfigOptions) {
  const { env } = options;

  return betterAuth({
    database: drizzleAdapter(dbHttp, {
      provider: 'pg',
      schema: {
        ...schema,
        user: schema.users,
        session: schema.sessions,
        verification: schema.verificationTokens,
      },
    }),
    session: {
      expiresIn: 60 * 60 * 24,              // 24 hours
      updateAge: 60 * 60 * 24,              // Update every 24 hours
      cookieName: 'codex-session',
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,                      // 5 minutes
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendVerificationEmail: async ({ user, url }) => { /* ... */ },
      sendResetPasswordEmail: async ({ user, url }) => { /* ... */ },
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: true,
          defaultValue: 'customer',
        },
      },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.WEB_APP_URL,
    trustedOrigins: [env.WEB_APP_URL, env.API_URL].filter(Boolean),
  });
}
```

### Database Schema Mapping

Better-auth requires specific table names. Auth worker maps Better-auth's expected names to custom Codex schema:

| Better-auth Name | Codex Schema Name | Purpose |
|---|---|---|
| user | schema.users | User accounts with credentials |
| session | schema.sessions | Active user sessions |
| verification | schema.verificationTokens | Email verification and password reset tokens |

### Session Configuration

- **Session Expiry**: 24 hours
- **Cookie Name**: `codex-session` (HttpOnly, Secure, SameSite=Strict)
- **Cookie Cache**: Enabled, 5-minute maxAge (BetterAuth built-in optimization)
- **Session Update**: Auto-extends every 24 hours

### Email Verification

**Current**: Logs verification URLs to console (TODO: integrate with notification service)

**Flow**:
1. User registers with email
2. System generates verification token
3. Email sent with verification link containing token
4. User clicks link or hits /api/auth/verify-email with token
5. Email marked as verified in database

## Session Management

### Session Lifecycle

1. **Creation**
   - Created after successful registration or login
   - Stored in PostgreSQL sessions table
   - Cookie `codex-session` set with HttpOnly, Secure, SameSite=Strict flags

2. **Caching**
   - Session cache middleware extracts session ID from cookie
   - Looks up cached session in AUTH_SESSION_KV
   - If found, populates context variables (`c.set('session', ...)` and `c.set('user', ...)`)
   - If not found, Better-auth loads from database
   - After request, new sessions cached with TTL matching expiry

3. **Validation**
   - Session ID maps to user ID and expiry timestamp
   - Expired sessions rejected (expiresAt < now)
   - Invalid/missing sessions return 401 Unauthorized

4. **Expiration**
   - Sessions expire 24 hours after creation
   - Expired session cookies remain until browser clears or explicitly deleted
   - Database queries will reject expired sessions

### Token Structure

BetterAuth creates session tokens with:
- Unique session ID (UUID)
- User ID reference
- Expiry timestamp (24 hours from creation)
- Secure random token for cookie value

## Security Model

### Authentication

Auth Worker uses **session-based authentication** (not token-based):

1. User logs in with email/password
2. BetterAuth validates credentials against bcrypt-hashed passwords
3. Session created and stored in PostgreSQL
4. Session cookie `codex-session` returned in Set-Cookie header
5. Subsequent requests include cookie in Cookie header
6. Session cache or database validates session on each request

### Authorization

Auth Worker does not enforce authorization (no role checks on auth endpoints themselves). All auth endpoints are public or require only a valid session. Authorization enforcement happens in downstream workers (content, identity, access, etc.) via @codex/access package.

### Scoping

Sessions are user-scoped: Each session belongs to one user (session.userId). No organization-level scoping at auth layer.

### Rate Limiting

**Login Endpoint Only**: `/api/auth/email/login` (POST)

Uses IP-based rate limiting via RATE_LIMIT_KV:

```typescript
// From RATE_LIMIT_PRESETS.auth
{
  keyGenerator: (c: Context) => c.req.header('cf-connecting-ip') || '127.0.0.1',
  ...RATE_LIMIT_PRESETS.auth  // Preset thresholds (typically 10/15min)
}
```

- **Rate Limit Key**: Client IP (from Cloudflare CF-Connecting-IP header)
- **Thresholds**: Defined in @codex/security package RATE_LIMIT_PRESETS.auth
- **Response**: 429 Too Many Requests when exceeded
- **Storage**: RATE_LIMIT_KV namespace in Cloudflare Workers KV

Other endpoints (register, verify, reset-password) also rate limited but with less strict thresholds.

### Input Validation

All request bodies validated by BetterAuth:

- **Email Format**: RFC 5322 compliant
- **Password**: Required, case-sensitive, stored as bcrypt hash
- **JSON**: Validated before passing to Better-auth. Invalid JSON returns 400 Bad Request

### Security Headers

Applied by `securityHeaders()` middleware from @codex/security:

| Header | Value | Purpose |
|---|---|---|
| X-Content-Type-Options | nosniff | Prevent MIME sniffing |
| X-Frame-Options | DENY or SAMEORIGIN | Prevent clickjacking |
| X-XSS-Protection | 1; mode=block | XSS protection (legacy) |
| Referrer-Policy | strict-origin-when-cross-origin | Referrer leakage prevention |
| Content-Security-Policy | Varies by environment | Script/resource execution control |
| Strict-Transport-Security | max-age=31536000 | Force HTTPS (production only) |

Headers applied to all `/api/*` routes.

### Trusted Origins

CORS/origin validation:

```typescript
trustedOrigins: [env.WEB_APP_URL, env.API_URL].filter(Boolean)
```

- Production: https://codex.revelations.studio, https://api.revelations.studio
- Staging: https://codex-staging.revelations.studio, https://api-staging.revelations.studio

Requests from other origins will be rejected by BetterAuth.

### PII Handling

- **Passwords**: Never logged or exposed. Hashed via bcrypt before storage.
- **Email**: Stored plaintext in database (industry standard). Not included in error messages.
- **User Data**: Returned in API responses to authenticated users only.
- **Logs**: Request tracking logs PII redacted by observability middleware.

## Error Responses

All errors follow standard error response format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {}
  }
}
```

### Status Code Mapping

| Status | Code | Cause | Recovery |
|---|---|---|---|
| 400 | INVALID_JSON | Request body contains malformed JSON | Check JSON syntax |
| 400 | INVALID_REQUEST | Missing required fields or invalid format | Provide required fields with correct format |
| 401 | UNAUTHORIZED | Missing or invalid session cookie | Log in again |
| 401 | EMAIL_NOT_VERIFIED | User email not verified | Check email for verification link |
| 404 | NOT_FOUND | Unknown auth endpoint or resource | Check endpoint path |
| 422 | VALIDATION_ERROR | Password too weak or email already exists | Use stronger password or different email |
| 429 | RATE_LIMIT_EXCEEDED | Too many requests from IP | Wait 15 minutes before retrying |
| 500 | INTERNAL_ERROR | Database or BetterAuth error | Retry after delay, contact support if persists |
| 503 | SERVICE_UNAVAILABLE | Database or KV not available (health check) | Retry after delay |

### Common Error Scenarios

**Invalid JSON**
```json
{
  "error": {
    "code": "INVALID_JSON",
    "message": "Request body contains invalid JSON"
  }
}
```

**Endpoint Not Found**
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Auth endpoint not found"
  }
}
```

**Rate Limit Exceeded**
```json
{
  "error": "Too many requests"
}
```

**Authentication Required**
```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "No valid session"
  }
}
```

## Integration Points

### Workers Using Auth Worker

All workers validate sessions by calling auth endpoints:

1. **Content Worker** (`/workers/content`)
   - Calls GET /api/auth/session to validate session before accessing content
   - Uses authenticated user context for content queries

2. **Identity Worker** (`/workers/identity`)
   - Calls GET /api/auth/session to validate user identity
   - Manages user profile and organization membership

3. **Access Worker** (`/workers/access`)
   - Calls GET /api/auth/session to get current user
   - Determines user permissions for resources

4. **Any Worker Requiring Auth**
   - Receive session/user context variables from session cache middleware
   - Or make explicit calls to GET /api/auth/session if needed

### Downstream Service Integration

Auth Worker coordinates with services:

- **@codex/database** - Stores users, sessions, verification tokens in PostgreSQL
- **@codex/security** - Rate limiting, security headers, bcrypt password hashing
- **@codex/worker-utils** - Error handling, health checks, standard middleware
- **@codex/shared-types** - SessionData, UserData type definitions

### Data Flow on Login

```
1. Client: POST /api/auth/email/login
   ↓
2. Auth Worker: Rate limit check via RATE_LIMIT_KV
   ↓
3. Auth Worker: Validate JSON body
   ↓
4. Better-auth: Look up user in PostgreSQL users table
   ↓
5. Better-auth: Compare submitted password with bcrypt hash
   ↓
6. Better-auth: Create session in PostgreSQL sessions table
   ↓
7. Session Cache Middleware: Cache session to AUTH_SESSION_KV (5min TTL)
   ↓
8. Auth Worker: Return user + session + Set-Cookie header
   ↓
9. Client: Store codex-session cookie, make authenticated requests
```

## Dependencies

### Internal Packages

| Package | Purpose | Used For |
|---|---|---|
| @codex/database | PostgreSQL access via Drizzle ORM | User/session/token queries |
| @codex/security | Rate limiting, security headers, password hashing | IP-based rate limits, CORS headers |
| @codex/worker-utils | Error handling, health checks, middleware | Error responses, health endpoint |
| @codex/shared-types | Type definitions for sessions/users | SessionData, UserData types |
| @codex/validation | Zod schemas (optional) | Could be used for input validation |

### External Libraries

| Library | Version | Purpose |
|---|---|---|
| better-auth | ^1.3.34 | Authentication framework (email/password) |
| hono | ^4.6.20 | Web framework for routing and middleware |
| zod | ^3.24.1 | Runtime schema validation (optional) |
| drizzle-orm | (via @codex/database) | ORM for database queries |

### Cloudflare Services

| Service | Binding | Purpose |
|---|---|---|
| Workers KV | AUTH_SESSION_KV | Session caching (read-through cache) |
| Workers KV | RATE_LIMIT_KV | Login rate limiting storage |
| Neon PostgreSQL | DATABASE_URL | User/session/token persistence |

## Development & Deployment

### Local Development Setup

1. **Clone and Install**
```bash
git clone <repo>
cd workers/auth
pnpm install
```

2. **Environment Configuration**

Create `.env.local` with:
```
BETTER_AUTH_SECRET=your-secret-key-min-32-chars
SESSION_SECRET=your-session-secret-min-32-chars
DATABASE_URL=postgresql://user:password@neon.tech/codex_dev
WEB_APP_URL=http://localhost:5173
API_URL=http://localhost:8787
ENVIRONMENT=development
DB_METHOD=LOCAL
```

Note: For local development, use `DB_METHOD=LOCAL` to connect directly to PostgreSQL without connection pooling.

3. **Run Locally**
```bash
pnpm dev
```

Starts worker on http://localhost:42069 with inspector on port 9231.

4. **Database Setup**

Ensure Neon PostgreSQL database exists and migrations applied:
```bash
# From project root
pnpm run migrate:dev
```

This creates `users`, `sessions`, `verificationTokens` tables with proper schema.

### Testing Endpoints Locally

**Register**:
```bash
curl -X POST http://localhost:42069/api/auth/email/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!@#","name":"Test User"}'
```

**Login**:
```bash
curl -X POST http://localhost:42069/api/auth/email/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!@#"}' \
  -c cookies.txt
```

**Get Session**:
```bash
curl http://localhost:42069/api/auth/session \
  -b cookies.txt
```

**Health Check**:
```bash
curl http://localhost:42069/health
```

### Running Tests

```bash
# Run all tests once
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run with coverage report
pnpm test:coverage
```

Tests run in Cloudflare Workers runtime via vitest-pool-workers. They:
- Access real KV namespaces (storage isolated per test)
- Call SELF.fetch() to test worker handlers
- Validate health checks, security headers, error handling
- Located in `src/__test__/` directory

### Build Process

```bash
# Build for deployment
pnpm build

# Builds TypeScript to JavaScript in dist/
# Outputs: dist/index.js (main worker handler)
# Uses: Vite + esbuild for bundling
```

### Deployment

**To Staging**:
```bash
wrangler deploy --env staging
```

Deploys to `auth-staging.revelations.studio`

**To Production**:
```bash
wrangler deploy --env production
```

Deploys to `auth.revelations.studio`

### Environment Variables per Stage

**Development** (local):
```
ENVIRONMENT=development
DB_METHOD=LOCAL
WEB_APP_URL=http://localhost:5173
API_URL=http://localhost:8787
```

**Staging** (wrangler.jsonc):
```
ENVIRONMENT=staging
DB_METHOD=PRODUCTION  # Uses Neon connection pooling
WEB_APP_URL=https://codex-staging.revelations.studio
API_URL=https://api-staging.revelations.studio
```

**Production** (wrangler.jsonc):
```
ENVIRONMENT=production
DB_METHOD=PRODUCTION  # Uses Neon connection pooling
WEB_APP_URL=https://codex.revelations.studio
API_URL=https://api.revelations.studio
```

### Secrets Management

Three secrets must be set via CLI or CI/CD (not in wrangler.jsonc):

```bash
# Development (local .env)
BETTER_AUTH_SECRET=<32+ char random string>
SESSION_SECRET=<32+ char random string>
DATABASE_URL=postgresql://...

# Staging
wrangler secret put BETTER_AUTH_SECRET --env staging
wrangler secret put SESSION_SECRET --env staging
wrangler secret put DATABASE_URL --env staging

# Production
wrangler secret put BETTER_AUTH_SECRET --env production
wrangler secret put SESSION_SECRET --env production
wrangler secret put DATABASE_URL --env production
```

## Testing

### Test Structure

Tests are organized by feature/layer in `src/__test__/`:

- **index.test.ts**: Health checks, auth endpoints, error handling
- **middleware.test.ts**: Rate limiting, session caching middleware

### Testing Patterns

**Health Check Test**:
```typescript
it('should return healthy status', async () => {
  const response = await SELF.fetch('http://localhost/health');
  expect([200, 503]).toContain(response.status);
  const json = await response.json() as HealthCheckResponse;
  expect(json.service).toBe('auth-worker');
});
```

**Auth Endpoint Test**:
```typescript
it('should return proper response for session endpoint', async () => {
  const response = await SELF.fetch('http://localhost/api/auth/session');
  expect(response.status).toBeDefined();
  expect(response.status).toBeGreaterThanOrEqual(200);
});
```

**Error Handling Test**:
```typescript
it('should handle malformed requests gracefully', async () => {
  const response = await SELF.fetch('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'invalid json{',
  });
  expect(response.status).toBeGreaterThanOrEqual(400);
});
```

### Testing Authentication Locally

Use stored cookies to test authenticated endpoints:

```bash
# 1. Register and store session
curl -X POST http://localhost:42069/api/auth/email/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!@#"}' \
  -c cookies.txt

# 2. Use stored session cookie
curl http://localhost:42069/api/auth/session \
  -b cookies.txt

# 3. Or manually add cookie header
curl http://localhost:42069/api/auth/session \
  -H "Cookie: codex-session=<session-token-from-login>"
```

### Mocking in Tests

Current test approach uses actual Cloudflare Workers runtime:
- Real KV namespaces (isolated per test)
- Real worker handler via SELF.fetch()
- No mocking needed for most cases

For unit testing Better-auth separately, would use:
```typescript
// Mock Better-auth if needed
import { betterAuth } from 'better-auth';
vi.mock('better-auth', () => ({
  betterAuth: vi.fn(() => ({
    handler: vi.fn(),
  })),
}));
```

### Edge Cases to Test

- Invalid JSON in POST body
- Malformed email format
- Rate limit threshold (10th vs 11th request)
- Expired session tokens
- Missing required fields
- Empty request body
- KV namespace failures
- Database connection failures

## File Structure

```
workers/auth/
├── src/
│   ├── __test__/
│   │   ├── index.test.ts          # Health checks, endpoints, errors
│   │   └── middleware.test.ts     # Middleware tests
│   ├── middleware/
│   │   ├── index.ts               # Middleware exports
│   │   ├── rate-limiter.ts        # IP-based login rate limiting
│   │   └── session-cache.ts       # KV session caching
│   ├── auth-config.ts             # Better-auth configuration
│   ├── index.ts                   # Main worker handler
│   ├── types.ts                   # Auth-specific types
│   └── env.d.ts                   # Environment type declarations
├── dist/                          # Compiled output (generated)
├── package.json
├── wrangler.jsonc                 # Cloudflare deployment config
├── tsconfig.json
├── vitest.config.ts
├── vite.config.ts
└── build.js
```

## API Completeness

Better-auth provides additional endpoints beyond the documented public API. All endpoints are delegated to Better-auth handler:

- Additional provider integrations (if configured)
- Additional password reset flows
- Additional session management endpoints
- Additional user data modification endpoints

Check Better-auth documentation for full endpoint list: https://betterauth.dev/docs/api

This README documents the primary Codex-specific endpoints (email/password auth, session management). The auth worker acts as a transparent proxy for all Better-auth routes.
