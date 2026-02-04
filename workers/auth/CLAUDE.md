# Auth Worker (42069)

Authentication & Session Management via BetterAuth.

## API
- **POST /register**: Email/Password signup.
- **POST /login**: Auth. Rate limit: 10/15m.
- **GET /session**: Validate cookie. Returns User+Session.
- **POST /signout**: Destroy session.
- **POST /verify-email**: Token check.
- **POST /reset-password**: Recovery flow.

## Architecture
- **Framework**: BetterAuth + Hono.
- **Storage**:
  - **Primary**: Postgres (`users`, `sessions`).
  - **Cache**: KV `AUTH_SESSION_KV` (5m TTL).
- **Security**: HttpOnly Cookie (`codex-session`), Bcrypt, Rate Limiting.

## Usage
Other workers call `GET /session` (internally or via middleware) to validate users.

## Standards
- **Validation**: Zod schema for every input.
- **Assert**: `invariant(ctx.user, "Auth required")`.
- **No Logic**: Route -> Service -> Response only.
- **Errors**: Map Service Errors to HTTP codes.
