# Admin-API Worker (port 42073)

Org management dashboard: analytics, content management, and customer support for org owners/admins.

## Endpoints

All endpoints require `auth: 'required'` + `requireOrgManagement: true` — only org owners and admins can access their own org's data.

### Analytics
| Method | Path | Policy | Input | Success | Response |
|---|---|---|---|---|---|
| GET | `/analytics/revenue` | `requireOrgManagement` | query: date range | 200 | `{ data: RevenueAnalytics }` |
| GET | `/analytics/customers` | `requireOrgManagement` | query: date range | 200 | `{ data: CustomerAnalytics }` |
| GET | `/analytics/top-content` | `requireOrgManagement` | query: date range, limit | 200 | `{ data: TopContent[] }` |

### Content Management
| Method | Path | Policy | Input | Success | Response |
|---|---|---|---|---|---|
| GET | `/content` | `requireOrgManagement` | query: filters, pagination | 200 | `{ items, pagination }` |
| POST | `/content/:id/publish` | `requireOrgManagement` | params: `{ id: uuid }` | 200 | `{ data: Content }` |

### Customer Management
| Method | Path | Policy | Input | Success | Response |
|---|---|---|---|---|---|
| GET | `/customers` | `requireOrgManagement` | query: filters, pagination | 200 | `{ items, pagination }` |
| POST | `/customers/:id/grant-access` | `requireOrgManagement` | params + body: access grant | 201 | `{ data: AccessGrant }` |

## Services Used

- `AnalyticsService` (`@codex/admin`) — revenue, customer, content analytics
- Content management services (`@codex/admin`) — admin overrides

## Key Patterns

- **Org management auth**: `procedure({ policy: { auth: 'required', requireOrgManagement: true } })` — checks session + org membership with admin/owner role
- **Org scoping**: All analytics queries scoped by `organizationId` from resolved org context
- **Admin publish override**: Can publish content bypassing normal media-ready checks

## Strict Rules

- **MUST** use `requireOrgManagement: true` for ALL endpoints — org owners/admins only
- **MUST** scope all analytics queries by `ctx.organizationId`
- **NEVER** expose raw database queries or internal metrics
- **NEVER** allow admin operations without org management role verification

## Config

- `DATABASE_URL`, `BETTER_AUTH_SECRET`, `RATE_LIMIT_KV`

## Reference Files

- `workers/admin-api/src/index.ts` — main handler and routes
