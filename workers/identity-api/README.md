# Identity API Worker

Cloudflare Worker providing RESTful API endpoints for identity and organization management.

## Features

- ✅ **Organization Management** - Full CRUD for organizations
- ✅ **Authentication** - Session-based auth on all routes
- ✅ **Security** - Rate limiting, CORS, security headers
- ✅ **Type Safety** - Full TypeScript support
- ✅ **Error Handling** - Standardized error responses
- ✅ **Validation** - Zod schema validation

## Architecture

- **Framework**: Hono (Cloudflare Workers)
- **Database**: Neon PostgreSQL (via @codex/database)
- **Services**: @codex/identity (OrganizationService)
- **Validation**: Zod schemas from @codex/validation
- **Auth**: Session middleware from @codex/security

## API Endpoints

### Public Routes

- `GET /health` - Health check (no auth required)

### Organization Management

All endpoints require authentication:

- `POST /api/organizations` - Create organization
- `GET /api/organizations/:id` - Get organization by ID
- `GET /api/organizations/slug/:slug` - Get organization by slug
- `PATCH /api/organizations/:id` - Update organization
- `GET /api/organizations` - List organizations with filters
- `DELETE /api/organizations/:id` - Soft delete organization
- `GET /api/organizations/check-slug/:slug` - Check slug availability

## Development

```bash
# Install dependencies
pnpm install

# Start local development server
pnpm dev

# Type check
pnpm typecheck

# Build
pnpm build
```

## Deployment

```bash
# Deploy to staging
pnpm deploy:staging

# Deploy to production
pnpm deploy:production
```

## Environment Variables

Create a `.dev.vars` file for local development (see `.dev.vars.example`):

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/db
ENVIRONMENT=development
DB_METHOD=LOCAL
WEB_APP_URL=http://localhost:3000
API_URL=http://localhost:8787
```

## Security

- **Session Authentication** - All `/api/*` routes require valid session cookie
- **CORS** - Configured for allowed origins
- **Security Headers** - CSP, X-Frame-Options, X-Content-Type-Options, etc.
- **Rate Limiting** - KV-based rate limiting
- **Input Validation** - Zod schemas validate all inputs
- **Error Sanitization** - No internal details exposed in production

## Response Format

### Success Response

```json
{
  "data": {
    // Resource data
  }
}
```

### Error Response

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {} // Optional additional context
  }
}
```

## Related Packages

- `@codex/identity` - Organization service layer
- `@codex/database` - Database client and schema
- `@codex/validation` - Zod validation schemas
- `@codex/security` - Authentication middleware
