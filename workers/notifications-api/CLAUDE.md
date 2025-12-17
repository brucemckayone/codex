# Notifications API Worker - Documentation

## Overview

Minimal Cloudflare Worker placeholder for future notification endpoints. Currently provides only health check endpoint.

**Deployment Target**: `notifications-api.revelations.studio` (production), local port 42075 (development)

**Primary Responsibility**: Placeholder for future notification management features

## Key Features

- Health check endpoint with database and KV checks
- Security headers (CSP, XFO, etc.)
- Rate limiting infrastructure
- Request tracking and logging

## Endpoints

| Method | Path | Purpose | Auth | Rate Limit |
|--------|------|---------|------|-----------|
| GET | `/health` | Health check | None | None |

## Dependencies

- `@codex/database` - PostgreSQL via Drizzle ORM
- `@codex/security` - Security middleware
- `@codex/worker-utils` - Worker setup utilities

## Development

```bash
# Start local dev server
pnpm dev  # http://localhost:42075

# Run tests
pnpm test

# Deploy
pnpm deploy:staging
pnpm deploy:production
```

## Configuration

**Environment Variables** (wrangler.jsonc):
- `ENVIRONMENT`: development | staging | production
- `DB_METHOD`: LOCAL_PROXY | PRODUCTION
- `WEB_APP_URL`: Frontend URL
- `API_URL`: API base URL

**Secrets** (via wrangler secret put):
- `DATABASE_URL`: PostgreSQL connection string

**KV Namespaces**:
- `RATE_LIMIT_KV`: Rate limiting storage

## Future Features

This worker is a placeholder for future notification-related endpoints:
- Email notifications
- In-app notifications
- Push notifications
- Notification preferences
- Notification history
