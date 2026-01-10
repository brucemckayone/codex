# Authentication

**Status**: Design
**Last Updated**: 2026-01-10

---

## Architecture

Authentication is owned entirely by the **Auth Worker** (BetterAuth). The frontend never implements auth logic—it delegates to the Auth Worker for all session operations.

```mermaid
graph LR
    subgraph "Frontend"
        SK[SvelteKit]
        Hook[hooks.server.ts]
    end

    subgraph "Auth Worker"
        AW[BetterAuth<br/>:42069]
    end

    subgraph "Storage"
        DB[(PostgreSQL)]
        KV[KV Cache]
    end

    SK --> Hook
    Hook -->|Validate Session| AW
    AW --> DB
    AW --> KV
```

**Key principle**: Frontend reads the session cookie and calls Auth Worker to validate. It never decodes or validates tokens itself.

---

## Session Cookie

The Auth Worker sets a cross-subdomain session cookie:

| Property | Value | Purpose |
|----------|-------|---------|
| Name | `codex-session` | Identifies the session |
| Domain | `.revelations.studio` | Shared across all subdomains |
| Path | `/` | Available on all paths |
| HttpOnly | `true` | JavaScript cannot access |
| Secure | `true` | HTTPS only |
| SameSite | `Lax` | CSRF protection, allows navigation |

### Why Cross-Subdomain?

Users navigate between:
- `yoga-studio.revelations.studio` (org space)
- `creators.revelations.studio/alice` (creator profile)
- `revelations.studio` (platform)

A single session cookie with `.revelations.studio` domain works across all these without re-authentication.

---

## Session Resolution Flow

On every request, the server hook validates the session:

```mermaid
sequenceDiagram
    participant Browser
    participant SvelteKit
    participant AuthWorker

    Browser->>SvelteKit: Request with cookie
    SvelteKit->>SvelteKit: Extract session cookie

    alt Has cookie
        SvelteKit->>AuthWorker: GET /api/auth/session
        AuthWorker->>AuthWorker: Validate session
        alt Valid
            AuthWorker->>SvelteKit: {user, session}
            SvelteKit->>SvelteKit: Set locals.user
        else Invalid/Expired
            AuthWorker->>SvelteKit: 401
            SvelteKit->>SvelteKit: Clear locals
        end
    end

    SvelteKit->>Browser: Render page
```

### Locals Population

After session resolution, `event.locals` contains:

| Property | Type | Description |
|----------|------|-------------|
| `userId` | `string \| null` | Authenticated user ID |
| `user` | `User \| null` | User object with profile |
| `session` | `Session \| null` | Session metadata |

---

## Auth Flows

### Login

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant AuthWorker

    User->>Frontend: Submit login form
    Frontend->>AuthWorker: POST /api/auth/email/login
    AuthWorker->>AuthWorker: Validate credentials

    alt Success
        AuthWorker->>Frontend: 200 + Set-Cookie
        Frontend->>Frontend: Redirect to /library
    else Failure
        AuthWorker->>Frontend: 401 {error}
        Frontend->>User: Show error message
    end
```

### Registration

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant AuthWorker

    User->>Frontend: Submit registration form
    Frontend->>AuthWorker: POST /api/auth/email/register
    AuthWorker->>AuthWorker: Create user
    AuthWorker->>AuthWorker: Send verification email
    AuthWorker->>Frontend: 200 + Set-Cookie
    Frontend->>User: Redirect to verification notice
```

### Logout

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant AuthWorker

    User->>Frontend: Click logout
    Frontend->>AuthWorker: POST /api/auth/signout
    AuthWorker->>AuthWorker: Invalidate session
    AuthWorker->>Frontend: Clear cookie
    Frontend->>User: Redirect to home
```

### Password Reset

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant AuthWorker

    User->>Frontend: Request password reset
    Frontend->>AuthWorker: POST /api/auth/forgot-password
    AuthWorker->>User: Send reset email
    User->>Frontend: Click email link
    Frontend->>User: Show reset form
    User->>Frontend: Submit new password
    Frontend->>AuthWorker: POST /api/auth/reset-password
    AuthWorker->>Frontend: Success
    Frontend->>User: Redirect to login
```

---

## Auth Worker Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth/session` | GET | Validate current session |
| `/api/auth/email/login` | POST | Email/password login |
| `/api/auth/email/register` | POST | Create new account |
| `/api/auth/signout` | POST | End session |
| `/api/auth/forgot-password` | POST | Request password reset |
| `/api/auth/reset-password` | POST | Set new password |
| `/api/auth/verify-email` | GET | Verify email address |

---

## Auth Pages

| Route | Purpose | Auth State |
|-------|---------|------------|
| `/login` | Login form | Redirect if authenticated |
| `/register` | Registration form | Redirect if authenticated |
| `/forgot-password` | Request reset | Public |
| `/reset-password` | Set new password | Token required |
| `/verify-email` | Email verification | Token required |

### Redirect Handling

Login and register pages accept a `redirect` query parameter. After successful auth, user is redirected to this URL (validated to be same-origin).

---

## Form Implementation

Auth forms use SvelteKit form actions with progressive enhancement:

1. **Without JavaScript**: Standard form POST, full page reload
2. **With JavaScript**: Enhanced with loading states, inline validation

Forms submit to SvelteKit form actions, which forward to Auth Worker. This keeps Auth Worker URLs internal and allows server-side response handling.

---

## Session Caching

The Auth Worker caches session data in KV for fast validation:

```mermaid
graph LR
    Request[Request] --> Check{Session in KV?}
    Check -->|Yes| Return[Return cached]
    Check -->|No| DB[Query PostgreSQL]
    DB --> Cache[Cache in KV]
    Cache --> Return
```

KV cache TTL is shorter than session expiry to balance performance and security.

---

## Security Considerations

### Cookie Security
- **HttpOnly**: Prevents XSS from stealing session
- **Secure**: Prevents transmission over HTTP
- **SameSite=Lax**: Prevents CSRF from external sites

### Session Validation
- Every protected request validates session with Auth Worker
- Session can be invalidated server-side (logout everywhere)
- Session tied to user agent/IP for anomaly detection (future)

### Rate Limiting
- Auth Worker applies rate limits to login attempts
- Prevents brute force attacks

---

## Related Documents

- [AUTHORIZATION.md](./AUTHORIZATION.md) - Role-based access after authentication
- [ROUTING.md](./ROUTING.md) - Protected routes and redirects
