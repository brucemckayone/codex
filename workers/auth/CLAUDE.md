# Auth Worker - Complete Documentation

Centralized authentication and session management for all Codex API services. Built on Better-auth framework with email/password authentication, session caching via Cloudflare KV, and strict rate limiting to prevent brute force attacks on login endpoints.

**Deployment Target**: `auth.revelations.studio` (production), `auth-staging.revelations.studio` (staging), `http://localhost:42069` (local development)

## Overview

The Auth Worker is the single source of truth for user authentication across the Codex platform. It handles user registration, login, session validation, email verification, and password reset. Built on the Better-auth framework with Neon PostgreSQL persistence and Cloudflare KV session caching.

**Primary Responsibility**: User authentication, session lifecycle management, email verification, password reset

**Business Value**: Enables secure, multi-tenant user access control for all Codex services while reducing database load through KV session caching

**Deployment Target**:
- Production: `auth.revelations.studio`
- Staging: `auth-staging.revelations.studio`
- Development: `http://localhost:42069`

## Public API

All endpoints are delegated to Better-auth. Complete endpoint listing below.

### Health Check

#### GET /health

Service health and dependency status endpoint.

**Authentication**: Not required

**Rate Limit**: None

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

**Status Codes**:
- 200: All dependencies healthy
- 503: One or more dependencies unavailable

**Example**:
```bash
curl https://auth.revelations.studio/health
```

### User Registration

#### POST /api/auth/email/register

Create new user account with email and password. Sends verification email. User must verify email before accessing authenticated endpoints.

**Authentication**: Not required

**Rate Limit**: IP-based (RATE_LIMIT_PRESETS.auth thresholds)

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "name": "John Doe"
}
```

**Request Fields**:
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| email | string | Yes | Unique, converted to lowercase, RFC 5322 format |
| password | string | Yes | Case-sensitive, hashed via bcrypt before storage |
| name | string | No | User display name, 1-255 characters |

**Response** (200):
```json
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
```

Response includes session cookie via Set-Cookie header. User must verify email before logging in again.

**Possible Errors**:
| Status | Code | Cause |
|--------|------|-------|
| 400 | INVALID_REQUEST | Email already exists or invalid format |
| 422 | VALIDATION_ERROR | Password too weak (min 8 chars, mixed case recommended) |
| 500 | INTERNAL_ERROR | Database or Better-auth error |

**Example**:
```bash
curl -X POST https://auth.revelations.studio/api/auth/email/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!",
    "name": "John Doe"
  }' \
  -c cookies.txt

# Response includes Set-Cookie header
# Set-Cookie: codex-session=<token>; Path=/; HttpOnly; Secure; SameSite=Strict
```

### User Login

#### POST /api/auth/email/login

Authenticate existing user and establish session. Email must be verified first.

**Authentication**: Not required

**Rate Limit**: Strict (10 attempts per 15 minutes per IP via RATE_LIMIT_PRESETS.auth). Anti-brute-force measure.

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Request Fields**:
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| email | string | Yes | Registered email address (case-insensitive lookup) |
| password | string | Yes | Original password (case-sensitive), compared against bcrypt hash |

**Response** (200):
```json
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

Session cached in AUTH_SESSION_KV (5-minute TTL) for subsequent requests.

**Possible Errors**:
| Status | Code | Cause | Recovery |
|--------|------|-------|----------|
| 400 | INVALID_REQUEST | Email/password invalid or not found | Check credentials |
| 401 | UNAUTHORIZED | Email not verified | Check email for verification link |
| 429 | RATE_LIMIT_EXCEEDED | Too many failed login attempts | Wait 15 minutes |
| 500 | INTERNAL_ERROR | Database error | Retry after delay |

**Example**:
```bash
curl -X POST https://auth.revelations.studio/api/auth/email/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!"
  }' \
  -c cookies.txt
```

### Session Validation

#### GET /api/auth/session

Retrieve authenticated user and session info. Called by other workers to validate sessions. Results cached in KV.

**Authentication**: Required (codex-session cookie)

**Rate Limit**: None

**Request Parameters**: None (uses codex-session cookie)

**Response** (200):
```json
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

Session retrieved from KV cache if available (5min TTL), otherwise loaded from database.

**Possible Errors**:
| Status | Code | Cause |
|--------|------|-------|
| 401 | UNAUTHORIZED | No valid session cookie |
| 404 | NOT_FOUND | Session expired or invalid |

**Example**:
```bash
curl https://auth.revelations.studio/api/auth/session \
  -H "Cookie: codex-session=<session-token>"
```

### Sign Out

#### POST /api/auth/signout

Invalidate user session and sign out. Deletes session from database and KV cache.

**Authentication**: Required (codex-session cookie)

**Rate Limit**: None

**Request Parameters**: None (uses codex-session cookie)

**Response** (200):
```json
{
  "success": true
}
```

**Possible Errors**:
| Status | Code | Cause |
|--------|------|-------|
| 401 | UNAUTHORIZED | No valid session cookie |
| 500 | INTERNAL_ERROR | Database deletion error |

**Example**:
```bash
curl -X POST https://auth.revelations.studio/api/auth/signout \
  -H "Cookie: codex-session=<session-token>"
```

### Email Verification

#### GET/POST /api/auth/verify-email

Verify user email address using token from registration email. Marks email as verified in database.

**Authentication**: Not required (token acts as authentication)

**Rate Limit**: IP-based (RATE_LIMIT_PRESETS.auth thresholds)

**Request Parameters**:
| Parameter | Type | Location | Notes |
|-----------|------|----------|-------|
| token | string | query or body | Verification token from registration email |

**Response** (200):
```json
{
  "success": true,
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "name": "John Doe",
    "emailVerified": true,
    "createdAt": "2025-11-23T12:34:56Z"
  }
}
```

User can now log in after verification.

**Possible Errors**:
| Status | Code | Cause |
|--------|------|-------|
| 400 | INVALID_REQUEST | Invalid or expired verification token |
| 404 | NOT_FOUND | User associated with token not found |

**Example**:
```bash
# Via query parameter
curl "https://auth.revelations.studio/api/auth/verify-email?token=abc123def456"

# Via POST body
curl -X POST https://auth.revelations.studio/api/auth/verify-email \
  -H "Content-Type: application/json" \
  -d '{"token": "abc123def456"}'
```

### Password Reset Request

#### POST /api/auth/email/send-reset-password-email

Request password reset. Sends reset link with token to user's registered email.

**Authentication**: Not required

**Rate Limit**: IP-based (RATE_LIMIT_PRESETS.auth thresholds)

**Request Body**:
```json
{
  "email": "user@example.com"
}
```

**Request Fields**:
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| email | string | Yes | Registered email address |

**Response** (200):
```json
{
  "success": true
}
```

Email sent with reset link (currently logged to console; TODO: integrate notification service). Reset link contains verification token valid for 24 hours.

**Possible Errors**:
| Status | Code | Cause |
|--------|------|-------|
| 400 | INVALID_REQUEST | Email not registered in system |
| 500 | INTERNAL_ERROR | Email sending failed |

**Example**:
```bash
curl -X POST https://auth.revelations.studio/api/auth/email/send-reset-password-email \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com"}'
```

### Password Reset Completion

#### POST /api/auth/email/reset-password

Complete password reset using verification token from reset email. Creates new session.

**Authentication**: Not required (token acts as authentication)

**Rate Limit**: IP-based (RATE_LIMIT_PRESETS.auth thresholds)

**Request Body**:
```json
{
  "token": "abc123def456",
  "newPassword": "NewSecurePass456!"
}
```

**Request Fields**:
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| token | string | Yes | Verification token from reset email |
| newPassword | string | Yes | New password (case-sensitive, min 8 chars) |

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

Returns new session after password reset. Client receives Set-Cookie header with new session token.

**Possible Errors**:
| Status | Code | Cause |
|--------|------|-------|
| 400 | INVALID_REQUEST | Invalid or expired reset token |
| 422 | VALIDATION_ERROR | New password too weak |
| 500 | INTERNAL_ERROR | Database error during password update |

**Example**:
```bash
curl -X POST https://auth.revelations.studio/api/auth/email/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "token": "abc123def456",
    "newPassword": "NewSecurePass456!"
  }' \
  -c cookies.txt
```

### Test-Only Endpoint (Development/Test Only)

#### GET /api/test/verification-token/:email

Retrieve verification token for testing. Only available in development/test environments.

**Authentication**: Not required

**Rate Limit**: None

**Response** (200 in dev/test, 404 in staging/production):
```json
{
  "token": "verification-token-string",
  "email": "user@example.com"
}
```

**Possible Errors**:
| Status | Code | Cause |
|--------|------|-------|
| 404 | NOT_FOUND | Endpoint disabled in this environment or token not found |

Returns 404 in staging/production for security.

**Example**:
```bash
# Development only
curl "http://localhost:42069/api/test/verification-token/user@example.com"
```

## Core Architecture

### Request Flow

All requests flow through consistent middleware chain before Better-auth handling:

```
1. HTTP Request
   ↓
2. Environment Validation Middleware (createEnvValidationMiddleware)
   Validates: BETTER_AUTH_SECRET, DATABASE_URL, AUTH_SESSION_KV, RATE_LIMIT_KV
   Runs once per worker instance (cached result)
   Returns 500 CONFIGURATION_ERROR if any required var missing
   ↓
3. Standard Middleware Chain (createStandardMiddlewareChain)
   Request ID tracking (x-request-id header)
   X-Forwarded-For header normalization
   Observability context initialization
   Service name: 'auth-worker', version: '1.0.0'
   ↓
4. /api/* Route Handler
   ↓
5. Security Headers Middleware (securityHeadersMiddleware)
   Environment-aware headers
   X-Content-Type-Options: nosniff
   X-Frame-Options: SAMEORIGIN (dev) or DENY (staging/prod)
   X-XSS-Protection, Referrer-Policy, CSP, HSTS (prod only)
   ↓
6. Rate Limit Middleware (createAuthRateLimiter)
   ONLY applies to: POST /api/auth/email/login (exact match)
   Key: cf-connecting-ip (client IP address)
   Threshold: 10 requests per 15 minutes (RATE_LIMIT_PRESETS.auth)
   Storage: RATE_LIMIT_KV namespace
   Returns 429 immediately if exceeded
   ↓
7. Better-auth Handler (via Hono delegation)
   Creates auth instance: createAuthInstance({ env: c.env })
   BetterAuth session processing:
     a) Extract codex-session cookie
     b) Check BetterAuth internal cookie cache (5min TTL)
     c) If miss: Check AUTH_SESSION_KV (secondaryStorage)
     d) If miss: Query PostgreSQL sessions table
     e) If found: Cache in both memory and KV
   Routes to appropriate auth endpoint handler
   (register, login, session, verify-email, reset-password, signout)
   Handles request body parsing and validation
   ↓
8. Better-auth Response
   Returns JSON response with user/session data
   Sets Set-Cookie header for codex-session cookie
   (HttpOnly, Secure, SameSite=Strict)
   ↓
9. Error Handler (app.onError)
   Catches any unhandled errors from BetterAuth
   Logs error with request ID and context
   Returns standardized error response
   ↓
10. HTTP Response
    Status codes: 200, 400, 401, 404, 429, 500, 503
    Headers: Standard security headers, Set-Cookie (if applicable)
    Body: JSON (user/session data, error, or plain response)
```

**Session Caching Hierarchy** (Best to Worst Performance):
1. BetterAuth internal memory cache (5-min TTL) - 1ms lookup
2. AUTH_SESSION_KV (Cloudflare KV) - 10ms lookup
3. PostgreSQL database - 50ms lookup

### Middleware Chain

#### Environment Validation (createEnvValidationMiddleware)

**Purpose**: Validate required environment variables once per worker instance

**Location**: `src/utils/validate-env.ts` (119 lines)

**Required Variables**:
| Variable | Type | Purpose | Min Length |
|----------|------|---------|------------|
| BETTER_AUTH_SECRET | String (Secret) | BetterAuth signing key | 32 chars |
| DATABASE_URL | String (Secret) | PostgreSQL connection string (PRODUCTION/NEON_BRANCH modes) | Any |
| DATABASE_URL_LOCAL_PROXY | String (Secret) | PostgreSQL via local proxy (LOCAL_PROXY mode) | Any |
| AUTH_SESSION_KV | KV Namespace (Binding) | Session caching in KV | Required |
| RATE_LIMIT_KV | KV Namespace (Binding) | Rate limiting in KV | Required |

**Optional Variables** (Warn but don't fail):
- ENVIRONMENT: 'development' | 'staging' | 'production' (defaults to development)
- WEB_APP_URL: Frontend URL for trusted origins
- API_URL: API base URL for trusted origins

**Behavior**:
- Runs only on first request to worker instance
- Validation cached in memory (closure variable `validated`)
- If validation passes: Logs "✅ Environment validation passed"
- If validation fails: Returns 500 CONFIGURATION_ERROR with detailed recovery instructions
- Error includes: missing vars, required vars explanation, solutions (local, test, production)

**Example Error Response**:
```json
{
  "error": {
    "code": "CONFIGURATION_ERROR",
    "message": "Worker misconfigured - missing required environment variables",
    "details": "❌ Missing required environment variables: DATABASE_URL, BETTER_AUTH_SECRET\n\nRequired variables:\n  - DATABASE_URL: PostgreSQL connection string (DB_METHOD=PRODUCTION)\n  - BETTER_AUTH_SECRET: BetterAuth secret key (min 32 characters)\n  - AUTH_SESSION_KV: KV namespace binding for session caching\n  - RATE_LIMIT_KV: KV namespace binding for rate limiting\n\nSolutions:\n  • Local dev: Create .dev.vars file (see .dev.vars.example)\n  • Test env: Create .dev.vars.test file\n  • Production: Set via wrangler CLI: wrangler secret put <VAR_NAME> --env production"
  }
}
```
Status: 500

#### Security Headers (securityHeaders middleware)

**Purpose**: Apply environment-specific security headers

**Headers Applied**:
| Header | Development | Staging | Production |
|--------|-------------|---------|------------|
| X-Content-Type-Options | nosniff | nosniff | nosniff |
| X-Frame-Options | SAMEORIGIN | SAMEORIGIN | DENY |
| X-XSS-Protection | 1; mode=block | 1; mode=block | 1; mode=block |
| Referrer-Policy | strict-origin-when-cross-origin | strict-origin-when-cross-origin | strict-origin-when-cross-origin |
| Content-Security-Policy | Permissive | Strict | Strict |
| Strict-Transport-Security | None | max-age=31536000 | max-age=31536000 |

#### Rate Limiting (createAuthRateLimiter)

**Purpose**: Prevent brute force attacks on login endpoint

**Location**: `src/middleware/rate-limiter.ts` (46 lines)

**Target Endpoint**: POST /api/auth/email/login only (GET requests and other endpoints not rate limited)

**Rate Limit Configuration**:
| Setting | Value | Source |
|---------|-------|--------|
| Key Strategy | cf-connecting-ip header | Client IP address |
| Threshold | 10 requests per 15 minutes | RATE_LIMIT_PRESETS.auth from @codex/security |
| Storage | RATE_LIMIT_KV namespace | Cloudflare KV |
| Check Method | rateLimit() from @codex/security | KV-backed rate limiter |

**Implementation**:
```typescript
// From src/middleware/rate-limiter.ts
export function createAuthRateLimiter() {
  return async (c: Context<AuthEnv>, next: Next) => {
    // Only apply rate limiting to login endpoint
    if (c.req.path === '/api/auth/email/login' && c.req.method === 'POST') {
      const kv = c.env.RATE_LIMIT_KV;

      if (kv) {
        const success = await rateLimit({
          kv,
          keyGenerator: (c: Context) =>
            c.req.header('cf-connecting-ip') || '127.0.0.1',
          ...RATE_LIMIT_PRESETS.auth,
        })(c, next);

        if (!success) {
          return c.json({ error: 'Too many requests' }, 429);
        }

        await next();
        return undefined;
      }
    }
    await next();
    return undefined;
  };
}
```

**Behavior**:
1. Check if request is POST /api/auth/email/login
2. If not: Skip rate limiting, continue to next middleware
3. If yes: Call rateLimit() with KV namespace and IP key
4. If under threshold: Continue to BetterAuth handler
5. If exceeded: Return 429 immediately, don't call next middleware

**Response on Limit Exceeded**:
```json
{
  "error": "Too many requests"
}
```
Status: 429 Too Many Requests

**Implementation Notes**:
- Other auth endpoints (register, session, verify-email, reset-password) are NOT rate limited
- Only login attempt tracking prevents brute force
- Rate limit is per IP address (shared by all users from same IP in development)
- Threshold applies across all auth worker instances (KV is global)
- IP extracted via cf-connecting-ip header (set by Cloudflare)

#### Session Caching via BetterAuth secondaryStorage

**Purpose**: Cache sessions in Cloudflare KV to reduce database load on hot path (all authenticated requests)

**Implementation**: Uses BetterAuth's built-in `secondaryStorage` feature with @codex/security's `createKVSecondaryStorage` adapter

**Location**: Configured in `src/auth-config.ts` (lines 44-46)

**Configuration**:
```typescript
// From src/auth-config.ts
return betterAuth({
  database: drizzleAdapter(db, { ... }),

  // KV-backed secondary storage for session caching
  // This enables unified session caching across all workers
  secondaryStorage: createKVSecondaryStorage(env.AUTH_SESSION_KV),

  session: {
    expiresIn: 60 * 60 * 24,              // 24 hours
    updateAge: 60 * 60 * 24,              // Update session every 24 hours
    storeSessionInDatabase: true,         // Primary storage in PostgreSQL
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,                     // 5 minute BetterAuth internal cache
    },
  },
  // ... rest of config
});
```

**How It Works**:

1. **Session Lookup**: When user makes authenticated request with codex-session cookie:
   - BetterAuth checks its internal memory cache (5-minute TTL, enabled by cookieCache)
   - If miss: BetterAuth checks AUTH_SESSION_KV (KV secondaryStorage)
   - If miss: BetterAuth queries PostgreSQL sessions table
   - If found: Result cached in both internal memory and KV

2. **Cache Storage**: BetterAuth's secondaryStorage adapter stores:
   - Key: session:<session-token>
   - Value: Full session data structure (serialized)
   - TTL: Auto-calculated from session.expiresAt
   - Auto-expires when TTL reaches 0

3. **Cache Invalidation**:
   - Automatic: TTL-based expiry (max 24 hours)
   - On Signout: BetterAuth removes from KV
   - On Session Update: BetterAuth updates KV entry

**Benefits**:
- Cache hit rate: ~90% for authenticated requests (within session window)
- Response time: 10ms (KV) vs 50ms (database)
- Reduces database connection pool pressure significantly
- Scales to thousands of concurrent authenticated users
- Transparent: Handled entirely by BetterAuth, no custom middleware needed

**Key Difference from Custom Caching**:
- Old approach: Custom middleware with read-through cache pattern
- New approach: BetterAuth's native secondaryStorage with KV adapter
- Result: Simpler code, better integration, same performance benefits

**Note**: The `/api/auth/session` endpoint returns fresh data directly from BetterAuth (not cached separately). Session caching reduces load on other workers calling this endpoint, not on the auth worker itself.

### Better-auth Configuration

**Location**: `src/auth-config.ts` (133 lines)

**Initialization**: Better-auth instance created per-request via `createAuthInstance(options: { env: AuthBindings })`

**Core Configuration**:
```typescript
betterAuth({
  // Database Integration via Drizzle ORM
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,              // User accounts with email/password
      session: schema.sessions,        // Active sessions
      account: schema.accounts,        // OAuth provider accounts (future)
      verification: schema.verification, // Email verification tokens
    },
  }),

  // KV-backed secondary storage for distributed session caching
  // Enables unified session caching across all Codex workers
  secondaryStorage: createKVSecondaryStorage(env.AUTH_SESSION_KV),

  // Session Management
  session: {
    expiresIn: 60 * 60 * 24,              // 24 hours
    updateAge: 60 * 60 * 24,              // Update session every 24 hours
    cookieName: 'codex-session',          // Session cookie name
    storeSessionInDatabase: true,         // Primary storage in PostgreSQL
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,                     // 5 min BetterAuth internal memory cache
    },
  },

  // Email Verification Flow
  emailVerification: {
    sendVerificationEmail: async ({ user, token }, _request) => {
      // Store token in KV for E2E tests (dev/test only)
      if (env.AUTH_SESSION_KV &&
          (env.ENVIRONMENT === 'development' || env.ENVIRONMENT === 'test')) {
        // Auto-expire after 5 minutes
        await env.AUTH_SESSION_KV.put(`verification:${user.email}`, token, {
          expirationTtl: 300,
        });
      }
      // TODO: Integrate with notification service for production
    },
    autoSignInAfterVerification: true,   // Auto login after email verified
    sendOnSignUp: true,                  // Send verification email on registration
  },

  // Email & Password Authentication Plugin
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,      // Must verify email before login
    autoSignIn: true,                    // Auto sign-in after registration
  },

  // Custom User Fields (beyond base schema)
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: true,
        defaultValue: 'customer',        // New users: customer, creator, admin
      },
    },
  },

  // Logging Configuration
  logger: {
    level: 'debug',
    disabled: true,                      // Can enable for debugging
  },

  // Security Configuration
  secret: env.BETTER_AUTH_SECRET,        // 32+ char signing key for session tokens
  baseURL: env.WEB_APP_URL,              // Frontend URL for email links
  trustedOrigins: [
    env.WEB_APP_URL,
    env.API_URL,
    'http://localhost:42069',            // Auth worker itself (E2E tests)
  ].filter((url): url is string => Boolean(url)),
})
```

**Key Configuration Features**:

| Feature | Setting | Purpose |
|---------|---------|---------|
| Database | drizzleAdapter with Postgres | Type-safe ORM for PostgreSQL |
| Session Storage | Primary: PostgreSQL, Secondary: KV | Distributed caching |
| Session Expiry | 24 hours | Auto-refresh sessions daily |
| Cookie Security | HttpOnly, Secure, SameSite=Strict | CSRF protection |
| Email Verification | Required before login | Confirms email ownership |
| KV Cache | AUTH_SESSION_KV with BetterAuth adapter | Reduces database queries |
| Trusted Origins | WEB_APP_URL, API_URL, localhost:42069 | CORS-like validation |

**Schema Mapping** (Drizzle ORM):
| Better-auth Name | Codex Table | Purpose | Key Fields |
|------------------|-------------|---------|-----------|
| user | users | User accounts with email/password | id, email, password (bcrypt), emailVerified, role, createdAt |
| session | sessions | Active user sessions | id, userId (FK), expiresAt, token |
| verification | verification (verificationTokens) | Email verification & password reset tokens | id, userId (FK), token, type, expiresAt |
| account | accounts | OAuth provider accounts (future feature) | id, userId (FK), provider, providerAccountId |

**Session Cookie Configuration**:
- **Name**: codex-session
- **HttpOnly**: true (not accessible via JavaScript)
- **Secure**: true (HTTPS only in production)
- **SameSite**: Strict (prevents CSRF attacks)
- **Domain**: Set to request domain automatically
- **Path**: /
- **Expiry**: 24 hours from creation

**Email Verification Flow**:
1. User registers via POST /api/auth/email/register
2. BetterAuth generates verification token
3. sendVerificationEmail callback invoked
4. In development/test: Token stored in AUTH_SESSION_KV (5min TTL) for E2E tests
5. In production: Token sent via email (currently logged only - TODO)
6. User clicks email link with token
7. POST /api/auth/verify-email?token=<token>
8. BetterAuth validates token, marks emailVerified=true
9. onEmailVerification callback invoked
10. User can now login

**Password Reset Flow**:
1. User requests password reset via POST /api/auth/email/send-reset-password-email
2. BetterAuth generates reset token
3. sendResetPassword callback invoked (currently logged only - TODO)
4. User receives email link with reset token
5. User submits new password via POST /api/auth/email/reset-password with token
6. BetterAuth validates token, updates password hash
7. New session created and returned to user
8. User can login with new password

**Logging Output**:
```
[DEBUG] Auth event messages...
[INFO] Operational info...
[WARN] Warning messages...
[ERROR] Error messages...
```
All logged to console (viewable in `wrangler dev` output)

## Usage Examples

### Basic: Register, Verify Email, Login

```bash
# 1. Register
REGISTER=$(curl -s -X POST http://localhost:42069/api/auth/email/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "SecurePass123!",
    "name": "New User"
  }' \
  -c cookies.txt)

echo "Registration response: $REGISTER"

# 2. Get verification token from KV (test endpoint, dev only)
TOKEN=$(curl -s "http://localhost:42069/api/test/verification-token/newuser@example.com" \
  | jq -r '.token')

echo "Verification token: $TOKEN"

# 3. Verify email
curl -s "http://localhost:42069/api/auth/verify-email?token=$TOKEN" | jq '.'

# 4. Login
curl -s -X POST http://localhost:42069/api/auth/email/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "SecurePass123!"
  }' \
  -c cookies.txt | jq '.'

# 5. Verify session
curl -s http://localhost:42069/api/auth/session \
  -b cookies.txt | jq '.'
```

### Advanced: Session Caching Behavior

```bash
# Login to get session cookie
RESPONSE=$(curl -s -X POST http://localhost:42069/api/auth/email/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"SecurePass123!"}' \
  -c cookies.txt)

SESSION=$(echo $RESPONSE | jq -r '.session.id')
echo "Session created: $SESSION"

# First request hits database, caches in KV (5 min TTL)
curl -s http://localhost:42069/api/auth/session \
  -b cookies.txt | jq '.session.id'

# Subsequent requests (within 5 min) hit KV cache
# Response time reduced from ~50ms to ~10ms
time curl -s http://localhost:42069/api/auth/session \
  -b cookies.txt > /dev/null
```

### Advanced: Rate Limiting on Login

```bash
# Attempt 1-10: Succeed (under limit)
for i in {1..10}; do
  curl -s -X POST http://localhost:42069/api/auth/email/login \
    -H "Content-Type: application/json" \
    -d '{"email":"user@example.com","password":"wrong"}' \
    | jq '.error // .user.email'
done

# Attempt 11: Rate limit exceeded
curl -s -X POST http://localhost:42069/api/auth/email/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"wrong"}' \
  | jq '.'
# Response: { "error": "Too many requests" }
# Status: 429
```

### Integration: Called by Content Worker

```typescript
// In content-api worker route handler
import { type Context } from 'hono';
import type { HonoEnv } from '@codex/shared-types';

export async function getContentListHandler(c: Context<HonoEnv>) {
  // 1. Validate session by calling auth worker
  const sessionResponse = await fetch(
    'http://localhost:42069/api/auth/session',
    {
      headers: {
        Cookie: c.req.header('Cookie') || '',
      },
    }
  );

  if (sessionResponse.status === 401) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { user, session } = await sessionResponse.json();

  // 2. Set context variables for downstream services
  c.set('user', user);
  c.set('session', session);

  // 3. Load user's content from database (scoped by creatorId)
  const content = await contentService.listByCreator(user.id);

  return c.json({ content });
}
```

## Integration Points

### Workers Using Auth Worker

All workers validate sessions by calling `/api/auth/session`:

1. **Content-API Worker** (port 4001)
   - GET /api/auth/session before accessing content
   - Uses user context for query scoping

2. **Identity-API Worker** (port 42071)
   - GET /api/auth/session for user identity
   - Validates user is authenticated before org operations

3. **Any Worker Requiring Authentication**
   - Extract session cookie from request
   - Call GET /api/auth/session
   - Use returned user/session in context variables

### Service Layer Dependencies

Auth Worker coordinates with:

| Package | Purpose | Usage |
|---------|---------|-------|
| @codex/database | PostgreSQL via Drizzle ORM | Stores users, sessions, tokens |
| @codex/security | Security middleware, rate limiting | Rate limit presets, security headers, bcrypt |
| @codex/worker-utils | Error handling, health checks | standardDatabaseCheck, createErrorHandler |
| @codex/shared-types | Type definitions | SessionData, UserData, HonoEnv |
| better-auth | Authentication framework | Email/password auth, session mgmt |

### Data Flow: Full Login Lifecycle

```
1. Client: POST /api/auth/email/login
   ↓
2. Env Validation Middleware
   Check BETTER_AUTH_SECRET, DATABASE_URL, AUTH_SESSION_KV, RATE_LIMIT_KV
   Return 500 if any required var missing
   ↓
3. Standard Middleware
   Generate x-request-id UUID for request tracking
   Normalize X-Forwarded headers, initialize observability context
   ↓
4. Security Headers Middleware
   Apply environment-specific security headers
   (development vs staging vs production)
   ↓
5. Rate Limit Middleware
   Check RATE_LIMIT_KV for IP request count
   If >= 10 in 15min: Return 429 Too Many Requests
   Otherwise: Continue
   ↓
6. Better-auth Handler
   a) Parse JSON body { email, password }
   b) Query users table: SELECT * FROM users WHERE email = :email
   c) Verify password: bcrypt.compare(password, user.password_hash)
   d) If password mismatch: Return 401 Unauthorized
   e) If successful: Create session in PostgreSQL sessions table
      INSERT INTO sessions (id, userId, expiresAt, token, ...)
      expiresAt = now() + 24 hours
   f) Cache in AUTH_SESSION_KV via secondaryStorage:
      KEY: session:<token>
      VALUE: { session, user } (serialized)
      TTL: 86400 seconds (auto-calculated from expiresAt)
   g) Generate codex-session cookie (HttpOnly, Secure, SameSite=Strict)
   ↓
7. Response
   Return JSON:
   {
     "user": { id, email, name, role, emailVerified, createdAt },
     "session": { id, userId, expiresAt }
   }
   Set-Cookie: codex-session=<token>; HttpOnly; Secure; SameSite=Strict; Path=/
   ↓
8. Client
   Extract session cookie from Set-Cookie header
   Store in cookie jar
   Include Cookie header in subsequent authenticated requests
```

**Session Lifecycle After Login**:
```
Request 1 (within 5min of login):
  - BetterAuth checks internal memory cache → HIT
  - Return cached session immediately (1ms)

Request 2 (5-30min after login):
  - Internal cache expired (5min TTL)
  - BetterAuth checks AUTH_SESSION_KV → HIT
  - Load from KV (10ms), update memory cache
  - Return session

Request 3 (after KV expires, within 24 hours):
  - Both caches expired
  - BetterAuth queries PostgreSQL → HIT
  - Load from DB (50ms), update both caches
  - Return session

Request 4 (after 24 hours):
  - Session expiresAt < now
  - Return 401 Unauthorized
  - Client must re-login
```

## Data Models

### Users Table

PostgreSQL table storing user accounts:

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  emailVerified BOOLEAN DEFAULT false,
  password VARCHAR(255) NOT NULL, -- bcrypt hash, 60 chars
  role VARCHAR(50) DEFAULT 'customer', -- customer, admin, creator
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deletedAt TIMESTAMP NULL -- soft delete
);
```

**Key Fields**:
| Field | Type | Constraints | Notes |
|-------|------|-----------|-------|
| id | UUID | PK, unique | User identifier |
| email | VARCHAR(255) | UNIQUE, NOT NULL | Unique per platform, case-insensitive lookup |
| password | VARCHAR(255) | NOT NULL | Bcrypt hash (60 chars), never returned in API |
| emailVerified | BOOLEAN | DEFAULT false | Must be true to login |
| role | VARCHAR(50) | DEFAULT 'customer' | customer, creator, admin (extensible) |
| createdAt | TIMESTAMP | DEFAULT now | Account creation time |
| updatedAt | TIMESTAMP | DEFAULT now | Last profile update |
| deletedAt | TIMESTAMP | NULL | Soft delete marker |

**Scoping**: No scoping (global table)

**Soft Delete**: deletedAt field used for soft deletion

### Sessions Table

PostgreSQL table storing active user sessions:

```sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  userId UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expiresAt TIMESTAMP NOT NULL,
  token VARCHAR(255) UNIQUE NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Key Fields**:
| Field | Type | Constraints | Notes |
|-------|------|-----------|-------|
| id | UUID | PK, unique | Session identifier |
| userId | UUID | FK → users, cascade delete | User who owns session |
| expiresAt | TIMESTAMP | NOT NULL | Session expiry time (24 hours) |
| token | VARCHAR(255) | UNIQUE | Secure random token used in cookie |
| createdAt | TIMESTAMP | DEFAULT now | Session creation time |

**Session Lifecycle**:
- Created: On successful login or registration
- Cached: In AUTH_SESSION_KV with TTL = expiresAt - now
- Validated: Via /api/auth/session endpoint
- Expired: Automatically invalid when expiresAt < now
- Deleted: On /api/auth/signout or user deletion

**Scoping**: User-scoped (one session per user active at a time, multiple allowed per user across devices)

### Verification Tokens Table

PostgreSQL table storing email verification and password reset tokens:

```sql
CREATE TABLE verificationTokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  userId UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE NOT NULL,
  type VARCHAR(50) NOT NULL, -- 'email_verification', 'password_reset'
  expiresAt TIMESTAMP NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Key Fields**:
| Field | Type | Constraints | Notes |
|-------|------|-----------|-------|
| id | UUID | PK, unique | Token identifier |
| userId | UUID | FK → users, cascade delete | User token belongs to |
| token | VARCHAR(255) | UNIQUE | Secure random token |
| type | VARCHAR(50) | NOT NULL | 'email_verification' or 'password_reset' |
| expiresAt | TIMESTAMP | NOT NULL | Token expiry (typically 24 hours) |

**Token Lifecycle**:
- Created: On registration (email_verification) or password reset request
- Sent: Via email (currently console logged, TODO: notification service)
- Validated: Via /api/auth/verify-email or /api/auth/reset-password
- Expired: Automatically invalid when expiresAt < now
- Deleted: After successful use or expiry

**Scoping**: User-scoped

### Session Data (In-Memory/Cached)

Structure returned by /api/auth/session endpoint and cached in KV:

```typescript
interface SessionData {
  id: string;              // Session UUID
  userId: string;          // User UUID
  expiresAt: string;       // ISO 8601 timestamp
  token?: string;          // Not returned to client
}

interface UserData {
  id: string;              // User UUID
  email: string;           // User email (verified)
  name?: string;           // Display name
  role: string;            // 'customer', 'creator', 'admin'
  emailVerified: boolean;   // Must be true
  createdAt: string;       // ISO 8601
}
```

**Cached in AUTH_SESSION_KV**:
- Key: `session:<session-token>`
- Value: `{ session: SessionData, user: UserData }`
- TTL: Calculated from expiresAt (max 24 hours)

## Error Handling

### Error Response Format

All errors follow standardized format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {}
  }
}
```

### Common Error Codes

| Status | Code | Message | Cause | Recovery |
|--------|------|---------|-------|----------|
| 400 | INVALID_JSON | Request body contains invalid JSON | Malformed JSON in request | Fix JSON syntax |
| 400 | INVALID_REQUEST | Missing required fields or invalid format | Missing email/password or format error | Provide required fields |
| 401 | UNAUTHORIZED | No valid session or invalid credentials | Missing/expired cookie or wrong credentials | Log in again |
| 401 | EMAIL_NOT_VERIFIED | Email not verified | User registered but didn't verify email | Check email for verification link |
| 404 | NOT_FOUND | Endpoint not found | Unknown route path | Check endpoint URL |
| 404 | NOT_FOUND | Session expired or invalid | Session token not found in DB | Log in again |
| 422 | VALIDATION_ERROR | Password requirements not met | Password too weak | Use stronger password (8+ chars, mixed case) |
| 422 | VALIDATION_ERROR | Email already exists | Duplicate registration attempt | Use different email |
| 429 | RATE_LIMIT_EXCEEDED | Too many requests | Too many failed login attempts | Wait 15 minutes |
| 500 | CONFIGURATION_ERROR | Missing required environment variables | Worker not configured correctly | Contact system admin |
| 500 | INTERNAL_ERROR | Database or service error | PostgreSQL error or Better-auth error | Retry after delay |
| 503 | SERVICE_UNAVAILABLE | Database or KV not available | Critical dependency offline | Retry after delay |

### Specific Error Scenarios

**Invalid JSON in POST body**:
```json
{
  "error": {
    "code": "INVALID_JSON",
    "message": "Request body contains invalid JSON"
  }
}
```
Status: 400

**Rate Limit Exceeded**:
```json
{
  "error": "Too many requests"
}
```
Status: 429

**Email Already Exists**:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email already registered"
  }
}
```
Status: 422

**Authentication Required**:
```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "No valid session cookie"
  }
}
```
Status: 401

### Error Handling in Code

Services throw specific error classes; workers map to HTTP responses:

```typescript
// In Better-auth error handling (auth worker)
try {
  const response = await auth.handler(c.req.raw);
  if (!response) {
    return createErrorResponse(c, ERROR_CODES.NOT_FOUND, 'Auth endpoint not found', 404);
  }
  return response;
} catch (error) {
  console.error('BetterAuth handler error:', error);
  throw error; // Let global error handler deal with it
}
```

## Performance Notes

### Session Caching Strategy

**5-Minute KV Cache**: Dramatically reduces database load

- **First request**: Session loaded from PostgreSQL
- **Subsequent requests (< 5min)**: Served from AUTH_SESSION_KV (10ms vs 50ms)
- **Cache miss**: Automatically reloaded from database

**Benefits**:
- Reduces database queries for session validation by ~90%
- Improves response time for /api/auth/session endpoint
- Scales to support thousands of concurrent users

**Cache Invalidation**:
- Automatic: TTL based on session expiry (max 24 hours)
- Manual: Delete from KV via /api/auth/signout

### Rate Limiting Performance

**Per-Endpoint Limiting**: Only POST /api/auth/email/login rate limited

**KV Operations**:
- ~1ms per rate limit check
- Negligible impact on response time

**Threshold**: 10 requests per 15 minutes (highly tunable via RATE_LIMIT_PRESETS.auth)

### Database Connections

**HTTP Client (dbHttp)**: Uses Neon connection pooling
- Pooled connections reused across requests
- Automatic connection management
- ~50ms per PostgreSQL query (including network latency)

**Optimization**: Session cache reduces most common query (session lookup) from critical path

### Scaling Considerations

**Per-Worker Instance Limits**:
- KV: Unlimited reads/writes (Cloudflare Workers limit: 100 reqs/sec)
- Database: Pooling supports ~10 concurrent connections per worker
- Rate Limiting: Per-IP tracking (no shared state between workers)

**Horizontal Scaling**:
- Stateless workers: Deploy to multiple regions
- KV: Global, shared across all workers
- Database: Centralized, requires connection pooling

## Testing

### Test Structure

Tests run in actual Cloudflare Workers runtime (workerd) via `vitest-pool-workers`:

**Files**:
```
src/__test__/
├── index.test.ts         # Health checks, endpoints, errors, bindings
└── middleware.test.ts    # Rate limiting, session cache, environment logic
```

**Test Environment**:
- Uses `cloudflare:test` module to access real worker environment
- SELF binding provides fetch access to worker handler
- env binding provides access to environment (KV namespaces, vars)
- Real Cloudflare Workers runtime (workerd)
- Automatic storage isolation between tests

**Benefits**:
- Real Cloudflare Workers runtime (not Node.js emulation)
- Actual KV namespace bindings (isolated per test run)
- No mocking needed for worker internals
- Fast execution (~100ms per test)
- Catch runtime errors that mocks would hide

### Test Categories

**Health Check Tests** (index.test.ts):
```typescript
describe('Health Check', () => {
  it('should return healthy status', async () => {
    const response = await SELF.fetch('http://localhost/health');
    // Accept 200 (all healthy) or 503 (database not available in test)
    expect([200, 503]).toContain(response.status);

    const json = (await response.json()) as HealthCheckResponse;
    expect(json.service).toBe('auth-worker');
    expect(json.version).toBe('1.0.0');
    expect(json.timestamp).toBeDefined();
  });
});
```

**Security Headers Tests** (index.test.ts):
```typescript
describe('Security Headers', () => {
  it('should include security headers on auth endpoints', async () => {
    const response = await SELF.fetch('http://localhost/api/auth/session');

    // Auth endpoints should have security headers from middleware
    expect(response.headers.get('x-content-type-options')).toBeDefined();
    expect(response.headers.get('x-frame-options')).toBeDefined();
  });
});
```

**Endpoint Tests** (index.test.ts):
```typescript
describe('Authentication Endpoints', () => {
  it('should return proper response for session endpoint', async () => {
    const response = await SELF.fetch('http://localhost/api/auth/session');

    // Should get a valid response (BetterAuth handles internally)
    expect(response.status).toBeDefined();
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(600);
  });

  it('should return 404 for unknown routes', async () => {
    const response = await SELF.fetch('http://localhost/unknown-endpoint');
    expect(response.status).toBe(404);
  });
});
```

**Error Handling Tests** (index.test.ts):
```typescript
describe('Error Handling', () => {
  it('should handle malformed requests gracefully', async () => {
    const response = await SELF.fetch('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json{',
    });

    // BetterAuth handles malformed requests internally
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThanOrEqual(500);
  });
});
```

**KV Bindings Tests** (index.test.ts):
```typescript
describe('KV Namespace Bindings', () => {
  it('should have AUTH_SESSION_KV binding available', () => {
    expect(env.AUTH_SESSION_KV).toBeDefined();
  });

  it('should have RATE_LIMIT_KV binding available', () => {
    expect(env.RATE_LIMIT_KV).toBeDefined();
  });
});
```

**Middleware Logic Tests** (middleware.test.ts):
- Session cookie extraction via regex
- Rate limiter endpoint identification
- TTL calculation from expiration dates
- Trusted origins filtering for undefined values
- Handler sequencing and early return behavior

### Running Tests

```bash
# Run tests once
pnpm test

# Watch mode (rerun on file changes)
pnpm test:watch

# Coverage report
pnpm test:coverage

# Run specific test file
pnpm test src/__test__/index.test.ts

# Run specific test by name
pnpm test -- --grep "Health Check"
```

**Test Output Example**:
```
✓ Auth Worker > Health Check > should return healthy status (45ms)
✓ Auth Worker > Security Headers > should include security headers on auth endpoints (32ms)
✓ Auth Worker > Authentication Endpoints > should return proper response for session endpoint (28ms)
✓ Auth Worker > Authentication Endpoints > should return 404 for unknown routes (15ms)
✓ Auth Worker > Error Handling > should handle malformed requests gracefully (38ms)
✓ Auth Worker > KV Namespace Bindings > should have AUTH_SESSION_KV binding available (2ms)
✓ Auth Worker > KV Namespace Bindings > should have RATE_LIMIT_KV binding available (2ms)
✓ Auth Worker Middleware - Unit Tests > Sequence Handler > should execute handlers in sequence (5ms)
✓ Auth Worker Middleware - Unit Tests > Session Handler Logic > should extract session cookie from headers (2ms)
✓ Auth Worker Middleware - Unit Tests > Rate Limiter Logic > should identify login endpoint correctly (1ms)
✓ Auth Worker Middleware - Unit Tests > Environment Configuration > should filter out undefined values from trusted origins (2ms)

Test Files  2 passed (2)
Tests  11 passed (11)
Duration  425ms
```

### Testing Authentication Locally

**Full Flow**:
```bash
# Register
curl -X POST http://localhost:42069/api/auth/email/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!@#"}' \
  -c cookies.txt

# Get verification token (dev endpoint)
TOKEN=$(curl "http://localhost:42069/api/test/verification-token/test@example.com" | jq -r '.token')

# Verify email
curl "http://localhost:42069/api/auth/verify-email?token=$TOKEN"

# Login
curl -X POST http://localhost:42069/api/auth/email/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!@#"}' \
  -c cookies.txt

# Test session
curl http://localhost:42069/api/auth/session -b cookies.txt
```

### Testing Rate Limiting

```bash
# First 10 requests succeed
for i in {1..10}; do
  curl -X POST http://localhost:42069/api/auth/email/login \
    -H "Content-Type: application/json" \
    -d '{"email":"user@example.com","password":"wrong"}'
done

# 11th request rate limited
curl -X POST http://localhost:42069/api/auth/email/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"wrong"}'
# Response: {"error": "Too many requests"}
# Status: 429
```

### Testing Edge Cases

Key scenarios to test:

1. **Expired session**: Session cookie with expiresAt < now
2. **Invalid token**: Verification token not found or expired
3. **Concurrent registration**: Two registrations with same email (race condition)
4. **KV failure**: AUTH_SESSION_KV unavailable, database fallback
5. **Database failure**: PostgreSQL connection fails, 503 response
6. **Malformed JSON**: Invalid JSON in POST body
7. **Missing fields**: Registration without email or password
8. **Rate limit threshold**: Exactly 10th and 11th request

## Development & Deployment

### Local Development Setup

**Prerequisites**:
- Node.js 18+
- pnpm
- Cloudflare Wrangler CLI
- PostgreSQL/Neon database

**Installation**:
```bash
git clone <repo>
cd workers/auth
pnpm install
```

**Environment Configuration**:

Create `.dev.vars` file:
```
BETTER_AUTH_SECRET=your-secret-key-min-32-characters-here
SESSION_SECRET=your-session-secret-key-min-32-chars
DATABASE_URL=postgresql://user:password@localhost:5432/codex_dev
WEB_APP_URL=http://localhost:5173
API_URL=http://localhost:8787
ENVIRONMENT=development
DB_METHOD=LOCAL_PROXY
```

**Run Locally**:
```bash
pnpm dev
```

Starts on http://localhost:42069 with inspector at port 9231.

### Database Migrations

```bash
# From project root
pnpm db:migrate:dev

# Or generate migrations after schema changes
pnpm db:gen:drizzle
```

Creates users, sessions, verificationTokens tables with proper schema.

### Build

```bash
pnpm build
```

Outputs compiled worker to dist/index.js via Vite + esbuild.

### Staging Deployment

```bash
# Set secrets first
wrangler secret put DATABASE_URL --env staging
wrangler secret put BETTER_AUTH_SECRET --env staging

# Deploy
pnpm deploy:staging
# or
wrangler deploy --env staging
```

Deploys to `auth-staging.revelations.studio`

### Production Deployment

```bash
# Verify tests pass
pnpm test

# Set secrets
wrangler secret put DATABASE_URL --env production
wrangler secret put BETTER_AUTH_SECRET --env production

# Deploy
pnpm deploy:prod
# or
wrangler deploy --env production
```

Deploys to `auth.revelations.studio`

### Environment Variables by Stage

**Development** (local .dev.vars):
```
ENVIRONMENT=development
DB_METHOD=LOCAL_PROXY
WEB_APP_URL=http://localhost:5173
API_URL=http://localhost:8787
```

**Staging** (wrangler.jsonc):
```
ENVIRONMENT=staging
DB_METHOD=PRODUCTION
WEB_APP_URL=https://codex-staging.revelations.studio
API_URL=https://api-staging.revelations.studio
```

**Production** (wrangler.jsonc):
```
ENVIRONMENT=production
DB_METHOD=PRODUCTION
WEB_APP_URL=https://codex.revelations.studio
API_URL=https://api.revelations.studio
```

### Secrets Management

Three secrets required (never in wrangler.jsonc):

```bash
# Staging
wrangler secret put BETTER_AUTH_SECRET --env staging
wrangler secret put SESSION_SECRET --env staging
wrangler secret put DATABASE_URL --env staging

# Production
wrangler secret put BETTER_AUTH_SECRET --env production
wrangler secret put SESSION_SECRET --env production
wrangler secret put DATABASE_URL --env production
```

## File Structure

```
workers/auth/
├── src/
│   ├── __test__/
│   │   ├── index.test.ts              # 88 lines - Health, endpoints, errors, bindings
│   │   └── middleware.test.ts         # 167 lines - Middleware unit tests
│   ├── middleware/
│   │   ├── index.ts                   # 8 lines - Middleware exports
│   │   ├── rate-limiter.ts            # 46 lines - POST /api/auth/email/login rate limiting
│   │   └── session-cache.ts           # 80 lines - KV session caching (read-through pattern)
│   ├── utils/
│   │   └── validate-env.ts            # 119 lines - Environment variable validation
│   ├── auth-config.ts                 # 133 lines - BetterAuth instance creation
│   ├── index.ts                       # 166 lines - Main worker entry point
│   ├── types.ts                       # 41 lines - Auth-specific type definitions
│   └── env.d.ts                       # Test environment types
├── dist/                              # Compiled output (generated by vite build)
├── package.json                       # Dependencies, scripts (port 42069)
├── wrangler.jsonc                     # Cloudflare deployment config
├── tsconfig.json                      # TypeScript configuration
├── vitest.config.ts                   # Vitest runner configuration
├── vite.config.ts                     # Vite build configuration
└── build.js                           # Build script
```

**Key Files Description**:

**Core Application**:
- `src/index.ts` (166 lines): Main worker handler
  - Hono app setup with middleware chain
  - Environment validation on every request
  - /health endpoint (uses createHealthCheckHandler)
  - /api/test/verification-token/:email (dev-only)
  - Security headers middleware
  - Rate limiting and session caching middleware
  - BetterAuth handler delegation
  - Global error handler
  - 404 handler

- `src/auth-config.ts` (133 lines): BetterAuth configuration
  - betterAuth() instance creation with drizzle adapter
  - Database schema mapping (users, sessions, accounts, verification)
  - Session management (24hr expiry, codex-session cookie)
  - Email verification flow (token storage in KV for tests)
  - Password reset flow
  - Logging configuration
  - Custom user fields (role: customer/creator/admin)
  - Trusted origins configuration

- `src/types.ts` (41 lines): Type definitions
  - AuthBindings: Extends SharedBindings with SESSION_SECRET, BETTER_AUTH_SECRET, AUTH_SESSION_KV
  - AuthEnv: Hono context type (Bindings + Variables)

**Middleware**:
- `src/middleware/index.ts` (8 lines): Re-exports middleware functions
  - createAuthRateLimiter()
  - createSessionCacheMiddleware()

- `src/middleware/rate-limiter.ts` (46 lines): Rate limiting
  - Targets POST /api/auth/email/login only
  - Uses cf-connecting-ip header for key
  - RATE_LIMIT_PRESETS.auth (10/15min threshold)
  - Returns 429 on limit exceeded

- `src/middleware/session-cache.ts` (80 lines): Session caching
  - Extracts codex-session cookie
  - Checks AUTH_SESSION_KV cache (key: session:<token>)
  - Cache hit: Returns cached {session, user}, skips BetterAuth
  - Cache miss: Calls BetterAuth, caches result with TTL
  - TTL = (expiresAt - now) in seconds

**Utilities**:
- `src/utils/validate-env.ts` (119 lines): Environment validation
  - validateEnvironment(env) function
  - createEnvValidationMiddleware() that runs once per worker instance
  - Checks: BETTER_AUTH_SECRET, DATABASE_URL, AUTH_SESSION_KV, RATE_LIMIT_KV
  - Optional checks: ENVIRONMENT, WEB_APP_URL, API_URL
  - Returns 500 CONFIGURATION_ERROR with detailed recovery instructions

**Configuration**:
- `package.json`: Dependencies (better-auth, hono, zod), scripts
  - `pnpm dev`: Starts on port 42069 with inspector on 9231
  - `pnpm test`: Runs vitest
  - `pnpm build`: Vite build
  - `pnpm deploy`: Production deployment

- `wrangler.jsonc`: Cloudflare deployment configuration
  - KV namespaces: AUTH_SESSION_KV, RATE_LIMIT_KV
  - Environments: test, staging, production
  - Routes: Custom domains per environment
  - Compatibility: Node.js compatibility mode
  - Observability enabled

**Testing**:
- `src/__test__/index.test.ts` (88 lines)
  - Health check tests (200 or 503 status)
  - Security headers tests
  - Endpoint tests (session, 404)
  - Error handling (malformed JSON)
  - KV binding availability

- `src/__test__/middleware.test.ts` (167 lines)
  - Sequence handler execution
  - Session cookie extraction
  - Rate limiter endpoint detection
  - TTL calculation
  - Trusted origins filtering

## Summary

The Auth Worker provides the foundation for secure, scalable authentication across the Codex platform. Built on Better-auth with session caching and rate limiting, it handles user registration, login, session validation, email verification, and password reset. All requests flow through a consistent middleware chain applying security headers, rate limiting, and session caching before delegating to Better-auth for authentication logic.

**Key Architectural Principles**:
1. **Stateless**: Worker instances are ephemeral; all state in PostgreSQL and KV
2. **Performant**: 5-minute session cache reduces database load by ~90%
3. **Secure**: Rate limiting prevents brute force, security headers on all responses
4. **Observable**: Request tracking, health checks, comprehensive logging
5. **Extensible**: Better-auth handles additional auth providers; KV cache tunable

**To Get Started**:
- `pnpm install && pnpm dev` to start locally on port 42069
- `curl http://localhost:42069/health` to verify worker
- Test endpoints with provided curl examples
- Run `pnpm test` to verify test suite passes
