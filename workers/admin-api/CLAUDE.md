# Admin API

Platform Owner dashboard. Analytics, Content Mgmt, Support.

## Endpoints (Auth: `platform_owner`)
- **GET /analytics/revenue**: Sales, fees, payouts. Date range.
- **GET /analytics/customers**: User counts, LTV.
- **GET /analytics/top-content**: Revenue ranking.
- **GET /content**: List all org content.
- **POST /content/:id/publish**: Admin override.
- **GET /customers**: List purchasers.
- **POST /customers/:id/grant-access**: Complimentary access.

## Architecture
- **Worker**: Hono + `procedure()`.
- **Service**: `@codex/admin` (AnalyticsService, ContentMgmtService).
- **Security**: Requires `codex-session` AND `role='platform_owner'`.
- **Scoping**: All queries filtered by `organizationId`.

## Config
- `DATABASE_URL`, `BETTER_AUTH_SECRET`, `RATE_LIMIT_KV`.

## Standards
- **Validation**: Zod schema for every input.
- **Assert**: `invariant(ctx.user, "Auth required")`.
- **No Logic**: Route -> Service -> Response only.
- **Errors**: Map Service Errors to HTTP codes.
