# @codex/constants

Centralized constants and configuration helpers for the Codex platform. Single source of truth for environment detection, service URLs, cookie configuration, MIME types, and error codes.

## Overview

The `@codex/constants` package provides:
- **Environment detection**: `isDev()` function for environment-aware behavior
- **Service URL resolution**: `getServiceUrl()` with environment variable override support and URL validation
- **Cookie configuration**: `getCookieConfig()` with security-first defaults
- **Constants**: Ports, domains, MIME types, headers, limits, and error codes

**Why it exists**:
- Single source of truth for environment configuration
- Security-first URL validation (prevents SSRF attacks)
- Secure cookie defaults with flexible overrides
- Consistent MIME types and headers across workers

## Public API

### Environment (`env.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `isDev(env)` | Function | Returns `true` if running in development mode |
| `getServiceUrl(service, env)` | Function | Returns URL for a service with URL validation |
| `validateServiceUrl(url, requireHttps)` | Function | Validates URL protocol and format |
| `ServiceName` | Type | Union: `'auth' \| 'content' \| 'access' \| 'org' \| 'ecom' \| 'admin' \| 'identity' \| 'notifications' \| 'media'` |
| `Env` | Interface | Environment bindings interface |
| `COOKIE_DOMAIN` | Env Var | Optional: Override cookie domain (default: `.revelations.studio` in prod) |

### Cookies (`cookies.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `getCookieConfig(env, host, options)` | Function | Returns secure cookie configuration |
| `COOKIES.SESSION_NAME` | Const | `'codex-session'` |
| `COOKIES.SESSION_MAX_AGE` | Const | 7 days in seconds |
| `COOKIES.TOKEN_MAX_AGE` | Const | 5 minutes in seconds |
| `CookieConfig` | Interface | Cookie configuration options |

### URLs & Ports (`urls.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `SERVICE_PORTS` | Const | Local development ports for each worker |
| `DOMAINS.PROD` | Const | `'revelations.studio'` |
| `DOMAINS.STAGING` | Const | `'staging.revelations.studio'` |
| `DOMAINS.LOCAL` | Const | `'localhost'` |

### MIME Types & Headers (`mime.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `MIME_TYPES.VIDEO` | Const | Video MIME types (MP4, MP2T) |
| `MIME_TYPES.STREAMING` | Const | HLS streaming types (.m3u8) |
| `MIME_TYPES.IMAGE` | Const | Image MIME types (PNG, JPEG, WEBP, GIF, SVG) |
| `MIME_TYPES.APPLICATION` | Const | Application MIME types (JSON) |
| `HEADERS` | Const | Standard HTTP header names |

### Limits (`limits.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `LIMITS` | Const | File size, pagination, and other limits |

## Usage Examples

### Get Service URL

```typescript
import { getServiceUrl } from '@codex/constants';

// In worker context with env bindings
const authUrl = getServiceUrl('auth', env);

// Force dev mode
const devUrl = getServiceUrl('content', true);
```

### Cookie Configuration

```typescript
import { getCookieConfig, COOKIES } from '@codex/constants';

// Get secure cookie config (use host for localhost detection)
const config = getCookieConfig(env, request.headers.get('host'));

// Set a session cookie
setCookie(COOKIES.SESSION_NAME, token, config);
```

### URL Validation

```typescript
import { validateServiceUrl } from '@codex/constants';

// Validate a custom URL (HTTPS required in production)
const validUrl = validateServiceUrl(customUrl, !isDev(env));
```

## Security Features

### Cookie Security
- `secure: true` for all environments except localhost in dev mode
- `httpOnly: true` always (no JavaScript access)
- `sameSite: 'lax'` default (CSRF protection)
- Domain configurable via `COOKIE_DOMAIN` env var

### URL Validation (SSRF Prevention)
- Only `http://` and `https://` protocols allowed
- Rejects `javascript:`, `data:`, `file:`, `ftp:` protocols
- HTTPS required for service URLs in production
- Runtime validation of environment variable URLs (not compile-time)

## Integration

This package is used by:
- All workers for service URL resolution
- Auth worker for cookie configuration
- Any service needing environment-aware URLs

## Testing

```bash
pnpm test      # Run tests
pnpm typecheck # Type check
```

## Build

```bash
pnpm build     # Build package
```
