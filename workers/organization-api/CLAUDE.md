# Organization API Worker - Documentation

## Overview

The Organization API Worker provides RESTful endpoints for organization management in the Codex platform. Handles organization CRUD operations, slug-based lookups, availability checking, and advanced filtering with pagination.

**Deployment Target**: `organization-api.revelations.studio` (production), local port 42071 (development)

**Primary Responsibility**: Multi-tenant organization identity management and scoping

## Key Features

- Full organization CRUD lifecycle (create, read, update, soft delete)
- Slug-based lookups with uniqueness guarantee
- Real-time slug availability checking
- Advanced listing with full-text search, sorting, pagination
- Transaction safety for atomic operations
- Consistent error handling with domain-specific error codes

## Endpoints

| Method | Path | Purpose | Auth | Rate Limit |
|--------|------|---------|------|-----------|
| POST | `/api/organizations` | Create org | Required | 100/min |
| GET | `/api/organizations/:id` | Get by ID | Required | 100/min |
| GET | `/api/organizations/slug/:slug` | Get by slug | Required | 100/min |
| PATCH | `/api/organizations/:id` | Update | Required | 100/min |
| GET | `/api/organizations` | List with filters | Required | 100/min |
| DELETE | `/api/organizations/:id` | Soft delete | Required | 5/15min |
| GET | `/api/organizations/check-slug/:slug` | Check availability | Required | 100/min |
| GET | `/health` | Health check | None | None |

## Dependencies

- `@codex/identity` - OrganizationService
- `@codex/database` - PostgreSQL via Drizzle ORM
- `@codex/validation` - Zod schemas
- `@codex/security` - Auth middleware, rate limiting
- `@codex/worker-utils` - Worker setup utilities

## Development

```bash
# Start local dev server
pnpm dev  # http://localhost:42071

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
