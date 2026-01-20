# Identity API Worker - Documentation

## Status: Placeholder Worker

**IMPORTANT**: This is a placeholder Cloudflare Worker with minimal functionality. Organization management has been moved to the **organization-api** worker (port 42071). This worker currently provides only a health check endpoint.

**Deployment Target**: Local port 42074 (development), `identity-api.revelations.studio` (production - reserved for future)

**Current Responsibility**: Health monitoring only

---

## Overview

Identity-API is a minimal placeholder worker reserved for future user identity management features. Currently, it serves as a health check endpoint to monitor worker availability and backing service health (PostgreSQL, Cloudflare KV).

### Current State

- **Only 1 endpoint**: Health check (`GET /health`)
- **No user-facing API**: All identity operations deferred to future phases
- **No authentication required**: Health endpoint is public
- **Future roadmap**: User profile management, preferences, account settings (Phase 2+)

### Architecture Notes

This worker follows the standard Codex worker pattern:
- Built with Hono framework
- Uses `@codex/worker-utils` for standardized setup
- Middleware chain includes request tracking, security headers, CORS
- Health check monitors database and KV namespace availability
- Environment validation on first request (required vars: DATABASE_URL, RATE_LIMIT_KV)

---

## Endpoints

### Health Check

**GET /health**

Public endpoint for monitoring worker availability and backing service health.

**Request**:
```bash
curl http://localhost:42074/health
```

**Response** (200 - All services healthy):
```json
{
  "status": "healthy",
  "service": "identity-api",
  "version": "1.0.0",
  "timestamp": "2025-01-22T14:30:00Z",
  "checks": {
    "database": "healthy",
    "kv_rate_limit": "healthy"
  }
}
```

**Response** (503 - Database unavailable):
```json
{
  "status": "unhealthy",
  "service": "identity-api",
  "version": "1.0.0",
  "timestamp": "2025-01-22T14:30:00Z",
  "checks": {
    "database": "unhealthy",
    "kv_rate_limit": "healthy"
  }
}
```

**Status Codes**:
- **200 OK** - All checks pass (database + KV accessible)
- **503 Service Unavailable** - One or more checks failed (database down, KV inaccessible, etc.)

**Authentication**: None required (public endpoint)

**Rate Limiting**: None (health checks are monitoring endpoints)

**Use Case**: Uptime monitoring, load balancer health checks, infrastructure status dashboards

---

## Architecture

### Request Flow

```
1. HTTP Request → GET /health
   ↓
2. Middleware Chain (via createWorker)
   ├─ Request Tracking (generates UUID, captures IP, user agent)
   ├─ CORS Headers (allows cross-origin requests)
   ├─ Security Headers (CSP, X-Frame-Options, etc.)
   └─ Environment Validation (checks DATABASE_URL, RATE_LIMIT_KV exist)
   ↓
3. Health Check Handler
   ├─ Database Check: Executes simple query (e.g., SELECT 1)
   ├─ KV Check: Tests connectivity to RATE_LIMIT_KV namespace
   └─ Collects results
   ↓
4. Response: JSON health status + HTTP status code
```

### Dependency Graph

**External Services**:
- **Neon PostgreSQL** - DATABASE_URL connection (health check queries database)
- **Cloudflare KV** - RATE_LIMIT_KV namespace (health check verifies KV access)

**Internal Packages**:
- `@codex/worker-utils` - Worker factory (`createWorker`), health check helpers
- `@codex/database` - Database client for health check queries
- `@codex/security` - Security middleware (headers, rate limiting infrastructure)
- `@codex/shared-types` - Type definitions (HonoEnv, HealthCheckResponse)

**No Dependents** (This worker is not imported by other packages)

---

## Configuration

### Environment Variables

**Required** (wrangler.jsonc or secrets):
```
DATABASE_URL=postgresql://user:password@host:port/database
RATE_LIMIT_KV=<kv-namespace-binding>
```

**Optional** (wrangler.jsonc):
```
ENVIRONMENT=development|staging|production
WEB_APP_URL=https://codex.example.com
API_URL=https://api.example.com
```

### Cloudflare KV Namespaces

**RATE_LIMIT_KV**: Used by rate limiting middleware
- Default preset: `api` (100 requests/minute)
- Persists rate limit counters per IP address
- TTL-based expiry (cleanup after 15 minutes of inactivity)

### Bindings (wrangler.jsonc)

```toml
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "kv-namespace-id"
preview_id = "kv-namespace-preview-id"

# Database connection via environment secret
# DATABASE_URL is set via `wrangler secret put`
```

---

## Development

### Local Setup

**Prerequisites**:
```bash
# Install Node.js 18+
node --version

# Install dependencies (from project root)
pnpm install

# Set up local .env
cd workers/identity-api
cat > .env.local <<EOF
ENVIRONMENT=development
DATABASE_URL=postgresql://user:password@localhost:5432/codex_dev
WEB_APP_URL=http://localhost:5173
API_URL=http://localhost:8787
EOF
```

**Start Development Server**:
```bash
cd workers/identity-api
pnpm dev
# Server starts on http://localhost:42074
```

### Testing

**Run Tests**:
```bash
# Run all tests once
pnpm test

# Run in watch mode
pnpm test:watch

# Run with coverage
pnpm test:coverage

# Run specific test file
pnpm test src/index.test.ts
```

**Test Environment**:
- Uses `vitest` test runner
- Runs in Cloudflare Workers runtime (via `vitest-pool-workers`)
- Accesses environment bindings via `cloudflare:test` module
- Database may be unavailable in test environment (health check returns 503)

**Test Example**:
```bash
# Health check endpoint returns response (200 or 503)
curl http://localhost:42074/health
```

**Key Test Case**:
```typescript
// From src/index.test.ts
it('should return health check response', async () => {
  const response = await SELF.fetch('http://localhost/health');

  // Returns 200 if database available, 503 if not
  expect([200, 503]).toContain(response.status);

  const json = await response.json() as HealthCheckResponse;
  expect(json.service).toBe('identity-api');
  expect(['healthy', 'unhealthy']).toContain(json.status);
});
```

---

## Deployment

### Staging Deployment

```bash
# From project root or worker directory
pnpm deploy:staging

# Or via Wrangler directly
cd workers/identity-api && wrangler deploy --env staging

# Deploys to: identity-api-staging.revelations.studio
```

**Staging Secrets** (one-time setup):
```bash
wrangler secret put DATABASE_URL --env staging
# Enter staging PostgreSQL connection string

wrangler secret put RATE_LIMIT_KV --env staging
# Enter KV namespace binding ID
```

### Production Deployment

```bash
# From project root or worker directory
pnpm deploy:production

# Or via Wrangler directly
cd workers/identity-api && wrangler deploy --env production

# Deploys to: identity-api.revelations.studio
```

**Production Secrets** (one-time setup):
```bash
wrangler secret put DATABASE_URL --env production
wrangler secret put RATE_LIMIT_KV --env production
```

**Requirements**:
- All tests passing (`pnpm test`)
- Code reviewed and approved
- Staging verified working

### Rollback

```bash
# Rollback to previous version
wrangler rollback --env production

# View deployment history
wrangler deployments list
```

---

## Monitoring & Health

### Health Check Monitoring

**Manual Check**:
```bash
# Local
curl http://localhost:42074/health

# Staging
curl https://identity-api-staging.revelations.studio/health

# Production
curl https://identity-api.revelations.studio/health
```

**Response Headers**:
```
x-request-id: <uuid>           # Unique request identifier (for tracing)
x-content-type-options: nosniff
x-frame-options: SAMEORIGIN
```

### Monitoring Integration

Add to monitoring system (DataDog, New Relic, Uptime Robot):

```
Endpoint: GET /health
Expected Status: 200 (or 503 if database down)
Check Interval: 30 seconds
Alert Threshold: 3 consecutive failures
Timeout: 5 seconds
```

### Expected Behaviors

| Scenario | Status | Reason |
|----------|--------|--------|
| All services operational | 200 | Database + KV healthy |
| Database down | 503 | Cannot execute health check queries |
| KV namespace full/errors | 503 | Rate limiting infrastructure unavailable |
| Network latency | 200/503 | Depends on actual service state |

---

## Security

### Authentication

No authentication required on health endpoint. This is intentional:
- Health checks must be accessible to load balancers
- Monitoring systems cannot be expected to authenticate
- Health endpoint provides no sensitive information

### Authorization

Not applicable - no user-facing endpoints.

### Security Headers

Health endpoint automatically includes security headers via middleware:

| Header | Value | Purpose |
|--------|-------|---------|
| X-Content-Type-Options | nosniff | MIME sniffing prevention |
| X-Frame-Options | SAMEORIGIN | Clickjacking prevention |
| Content-Security-Policy | default-src 'self' | XSS protection |
| Referrer-Policy | strict-origin-when-cross-origin | Referrer leakage prevention |

### Rate Limiting

No rate limiting applied to health endpoint. Rate limiting infrastructure is tested but not enforced.

### Input Validation

Health endpoint accepts no input (GET request with no parameters or body).

---

## Related Workers & Packages

### Organization API (Port 42071)

**This is the active worker for organization management.**

Organization-API provides full endpoints for:
- Organization CRUD (`POST /api/organizations`, `GET /api/organizations/:id`, etc.)
- Organization settings (`/api/organizations/:id/settings`)
- Slug validation and uniqueness checking

See `/workers/organization-api/CLAUDE.md` for complete documentation.

### Package Dependencies

**@codex/worker-utils**:
- `createWorker()` - Worker setup with middleware chain
- `standardDatabaseCheck` - Health check implementation
- `createKvCheck()` - KV namespace availability check
- `createEnvValidationMiddleware()` - Environment variable validation

**@codex/database**:
- `dbHttp` - PostgreSQL HTTP client (used in health checks)
- Database schema and query helpers (not currently used beyond health check)

**@codex/security**:
- `securityHeaders()` - Apply security headers middleware
- Rate limiting infrastructure (configured but not enforced)

**@codex/shared-types**:
- `HonoEnv` - Hono environment type definitions
- `HealthCheckResponse` - Type for health check response

---

## Future Roadmap

This worker is reserved for future identity management features across multiple phases:

### Phase 2: User Profile Management
- `GET /api/users/:id` - Get user profile
- `PATCH /api/users/:id` - Update profile (name, avatar, bio)
- `DELETE /api/users/:id` - Delete account

### Phase 3: User Preferences
- `GET /api/users/:id/preferences` - Get user preferences
- `PUT /api/users/:id/preferences` - Update preferences (email notifications, language, theme)
- `POST /api/users/:id/preferences/email-notifications` - Email notification settings

### Phase 4: Account Security
- `POST /api/users/:id/change-password` - Change password
- `GET /api/users/:id/sessions` - List active sessions
- `DELETE /api/users/:id/sessions/:sessionId` - Revoke session
- `POST /api/users/:id/two-factor` - Enable 2FA

### Phase 5: User Search & Discovery
- `GET /api/users/search` - Search users by name/email
- `GET /api/users/:id/public-profile` - Public profile (limited info)

**Note**: Authentication for these endpoints will follow the same pattern as other workers:
- Session validation via Auth Worker
- User-scoped authorization (users can only access their own data)
- Rate limiting (100 req/min for authenticated users)

---

## Code Structure

```
workers/identity-api/
├── src/
│   ├── index.ts                    # Main worker entry point
│   │   ├── createWorker() setup
│   │   ├── Environment validation
│   │   └── Health check endpoint
│   ├── index.test.ts               # Tests
│   │   ├── Health check response test
│   │   ├── Security headers test
│   │   ├── Error handling test
│   │   └── Environment bindings test
│   └── (routes, middleware - future)
│
├── package.json                    # Dependencies, scripts
├── tsconfig.json                   # TypeScript config
├── vite.config.ts                  # Vite build config
├── vitest.config.ts                # Vitest test config
├── wrangler.jsonc                  # Cloudflare Workers config
├── CLAUDE.md                       # This file
└── README.md                       # Quick reference (if present)
```

### Key Files

**src/index.ts** (Main Entry Point)
- Worker initialization via `createWorker()`
- Service name: `identity-api`
- Version: `1.0.0`
- Health checks: Database + KV namespace
- Request tracking enabled
- Logging enabled
- CORS enabled
- Security headers enabled

**src/index.test.ts** (Unit Tests)
- Tests health endpoint status codes (200/503)
- Verifies security headers applied
- Tests error handling for unknown routes
- Validates environment bindings available

---

## Troubleshooting

### Health Check Returns 503

**Possible Causes**:
1. **Database Connection Failed**
   - Check DATABASE_URL is set correctly
   - Verify PostgreSQL is running and accessible
   - Check firewall rules (Neon connection pooling)

2. **KV Namespace Unavailable**
   - Verify RATE_LIMIT_KV binding in wrangler.jsonc
   - Check KV namespace ID is correct
   - Verify KV namespace hasn't been deleted

3. **Network Issues**
   - Check internet connectivity
   - Verify Cloudflare Workers platform is operational
   - Check request timeout isn't too short

**Debug Steps**:
```bash
# 1. Test database connectivity directly
psql $DATABASE_URL -c "SELECT 1;"

# 2. Check Cloudflare KV status
wrangler kv:key list --namespace-id=<kv-namespace-id>

# 3. Check worker logs
wrangler tail --env production

# 4. Restart worker
wrangler deploy --env production
```

### "Environment validation failed" Error

**Cause**: Required environment variable missing (DATABASE_URL or RATE_LIMIT_KV)

**Solution**:
```bash
# Check if secrets are set
wrangler secret list

# Set missing secret
wrangler secret put DATABASE_URL --env production

# Redeploy worker
wrangler deploy --env production
```

### Local Testing Fails

**Cause**: Test environment doesn't have real database/KV

**Expected Behavior**: Tests should pass even if health check returns 503
```typescript
// This is expected in test environment
expect([200, 503]).toContain(response.status);
```

**Solution**: Skip database tests in CI, or mock database responses
```bash
# Run tests with mock database
DATABASE_URL=mock://test pnpm test
```

---

## Performance Notes

### Health Check Performance

- **Response Time**: < 100ms (typically)
- **Database Query**: Simple `SELECT 1` (minimal overhead)
- **KV Check**: Single key read operation
- **No Caching**: Fresh check on every request (important for monitoring)

### Scaling Considerations

- Worker scales automatically via Cloudflare Workers platform
- Database connections pooled via Neon (up to 25 concurrent connections per pool)
- KV namespace scaled globally (no per-region limits for this minimal workload)

### Optimization Opportunities (Future)

When user identity endpoints are added:
- Implement user lookup caching (1-5 min TTL)
- Batch user preference queries
- Index common search patterns (email lookup, etc.)
- Consider database query optimization for list operations

---

## Testing Guide

### Unit Tests

**Run All Tests**:
```bash
pnpm test
```

**Run Specific Test**:
```bash
pnpm test src/index.test.ts
```

**Watch Mode**:
```bash
pnpm test --watch
```

### Integration Tests (Local)

```bash
# 1. Start worker
pnpm dev

# 2. In another terminal, test endpoint
curl http://localhost:42074/health

# 3. Verify response includes all required fields
# - status: "healthy" | "unhealthy"
# - service: "identity-api"
# - version: "1.0.0"
# - checks.database: "healthy" | "unhealthy"
# - checks.kv_rate_limit: "healthy" | "unhealthy"
```

### E2E Tests (Staging/Prod)

```bash
# Test staging health
curl https://identity-api-staging.revelations.studio/health

# Test production health
curl https://identity-api.revelations.studio/health

# Both should return 200 with status: "healthy"
```

---

## Common Operations

### Check Worker Status

```bash
# Local
curl http://localhost:42074/health | jq

# Staging
curl https://identity-api-staging.revelations.studio/health | jq

# Production
curl https://identity-api.revelations.studio/health | jq
```

### View Recent Deployments

```bash
wrangler deployments list --limit 10
```

### Stream Live Logs

```bash
# Staging logs
wrangler tail --env staging

# Production logs
wrangler tail --env production
```

### Roll Back Last Deployment

```bash
wrangler rollback --env production
```

### Check Environment Variables

```bash
# View what secrets are set (doesn't show values)
wrangler secret list --env production
```

---

## Getting Started

### For New Developers

1. **Understand this is a placeholder**: No user-facing endpoints yet
2. **Know where organization management is**: See organization-api worker (port 42071)
3. **Familiarize with health check pattern**: Template for future endpoints
4. **Run locally**:
   ```bash
   cd workers/identity-api
   pnpm dev
   curl http://localhost:42074/health
   ```

### For Operations/Monitoring

1. **Monitor health endpoint**: `GET /health` should return 200 when healthy
2. **Alert on 503**: Indicates database or KV connectivity issues
3. **Check staging before production**: Always test deployments in staging first
4. **Keep DATABASE_URL and RATE_LIMIT_KV secrets updated**: These are required for operation

### For Backend Development

1. **Don't modify this worker yet**: Wait for phase requirements
2. **Reference for patterns**: Look at organization-api worker for pattern examples
3. **When implementing new endpoints**: Follow procedure() pattern from content-api
4. **Tests required**: New endpoints must have unit tests

---

## Summary

**Current State**: Identity-API is a minimal placeholder worker providing only a health check endpoint. It monitors PostgreSQL and Cloudflare KV availability for infrastructure observability.

**Current Responsibility**: Health monitoring via `GET /health` endpoint

**Future Responsibility**: User profile management, preferences, account security (Phases 2+)

**Related**: Organization management has been moved to organization-api worker (port 42071)

**Architecture**: Follows standard Codex worker pattern (Hono + @codex/worker-utils + middleware chain)

**Deployment**: Staging (identity-api-staging.revelations.studio) and Production (identity-api.revelations.studio)

---

**Last Updated**: 2025-01-22
**Version**: 1.0.0 (Placeholder)
**Maintenance**: Monitor health checks, update DATABASE_URL/RATE_LIMIT_KV secrets as needed
