# Admin-API Worker (port 42073)

Org management dashboard: analytics, content management, and customer support. All endpoints are restricted to org owners and admins.

## Endpoints

All endpoints EXCEPT `/api/admin/fees/*` require `auth: 'required'` + `requireOrgMembership: true` + `requireOrgManagement: true`, scoped by `ctx.organizationId` (resolved from org membership). The 9 `/api/admin/fees/*` endpoints (Codex-m644n, no web UI consumer) instead require `policy: { auth: 'platform_owner' }` with no org policy. Rate limited via `api` preset (100/min) on `/api/*`.

### Analytics

| Method | Path | Input | Response |
|---|---|---|---|
| GET | `/api/admin/analytics/revenue` | query: `adminRevenueQuerySchema` (date range) | `{ data: RevenueStats }` |
| GET | `/api/admin/analytics/customers` | — | `{ data: CustomerStats }` |
| GET | `/api/admin/analytics/top-content` | query: `adminTopContentQuerySchema` (limit) | `{ items, pagination }` |
| GET | `/api/admin/analytics/dashboard-stats` | query: `adminDashboardStatsQuerySchema` | `{ data: DashboardStats }` |
| GET | `/api/admin/activity` | query: `adminActivityQuerySchema` | `{ items, pagination }` |

### Content Management

| Method | Path | Input | Status | Response |
|---|---|---|---|---|
| GET | `/api/admin/content` | query: `adminContentListQuerySchema` (status, pagination) | 200 | `{ items, pagination }` |
| POST | `/api/admin/content/:contentId/publish` | params: contentId | 200 | `{ data: Content }` |
| POST | `/api/admin/content/:contentId/unpublish` | params: contentId | 200 | `{ data: Content }` |
| DELETE | `/api/admin/content/:contentId` | params: contentId | 204 | — |

### Customer Management

| Method | Path | Input | Status | Response |
|---|---|---|---|---|
| GET | `/api/admin/customers` | query: `adminCustomerListQuerySchema` | 200 | `{ items, pagination }` |
| GET | `/api/admin/customers/:id` | params: id | 200 | `{ data: CustomerDetails }` |
| POST | `/api/admin/customers/:customerId/grant-access/:contentId` | params: customerId + contentId | 200 | `{ success: true }` |

### Status

| Method | Path | Response |
|---|---|---|
| GET | `/api/admin/status` | `{ status: 'ok', user: { id, role } }` |

## Services Used

| Service | Package | Purpose |
|---|---|---|
| `AdminAnalyticsService` (`adminAnalytics`) | `@codex/admin` | Revenue, customer, top-content, dashboard, activity feed |
| `AdminContentManagementService` (`adminContent`) | `@codex/admin` | List, publish, unpublish, delete content (admin scope) |
| `AdminCustomerManagementService` (`adminCustomer`) | `@codex/admin` | List customers, get details, grant access |

## Auth Pattern

`requireOrgManagement: true` enforces org owner or admin role — not `platform_owner`. The resolved `ctx.organizationId` is used to scope all queries. The CLAUDE.md description "platform owner" is legacy; the current pattern checks org-level management role, not a global platform role.

## Bindings / Env

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Neon PostgreSQL |
| `AUTH_SESSION_KV` | Yes | Session validation |
| `RATE_LIMIT_API` | Yes | Native rate-limit binding the `/api/*` limiter counts in — `RATE_LIMIT_KV` was removed (Codex-kgrdp.17) |
| `ENVIRONMENT` | No | `development` / `test` / `production` (dev-webhook + guards) |

## Strict Rules

- **MUST** use `requireOrgManagement: true` for ALL endpoints — never expose cross-org data
- **MUST** scope all queries via `ctx.organizationId` from resolved org context
- **NEVER** expose raw DB queries or internal metrics
- Admin publish/unpublish/delete bypass the normal creator ownership check (org-scoped instead)

## Reference Files

- `workers/admin-api/src/index.ts` — all routes defined inline (no separate route files)
- `workers/admin-api/src/types.ts` — `AdminApiEnv` (only public type; `AdminVariables` is deliberately unexported)
