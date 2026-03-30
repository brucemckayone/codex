# Admin-API Worker (port 42073)

Platform owner dashboard: analytics, content management, and customer support.

## Endpoints

All endpoints require `auth: 'platform_owner'` — only platform owners can access.

### Analytics
| Method | Path | Policy | Input | Success | Response |
|---|---|---|---|---|---|
| GET | `/analytics/revenue` | `auth: 'platform_owner'` | query: date range | 200 | `{ data: RevenueAnalytics }` |
| GET | `/analytics/customers` | `auth: 'platform_owner'` | query: date range | 200 | `{ data: CustomerAnalytics }` |
| GET | `/analytics/top-content` | `auth: 'platform_owner'` | query: date range, limit | 200 | `{ data: TopContent[] }` |

### Content Management
| Method | Path | Policy | Input | Success | Response |
|---|---|---|---|---|---|
| GET | `/content` | `auth: 'platform_owner'` | query: filters, pagination | 200 | `{ items, pagination }` |
| POST | `/content/:id/publish` | `auth: 'platform_owner'` | params: `{ id: uuid }` | 200 | `{ data: Content }` |

### Customer Management
| Method | Path | Policy | Input | Success | Response |
|---|---|---|---|---|---|
| GET | `/customers` | `auth: 'platform_owner'` | query: filters, pagination | 200 | `{ items, pagination }` |
| POST | `/customers/:id/grant-access` | `auth: 'platform_owner'` | params + body: access grant | 201 | `{ data: AccessGrant }` |

## Services Used

- `AnalyticsService` (`@codex/admin`) — revenue, customer, content analytics
- Content management services (`@codex/admin`) — admin overrides

## Key Patterns

- **platform_owner auth**: `procedure({ policy: { auth: 'platform_owner' } })` — checks session + role
- **Org scoping**: All analytics queries scoped by `organizationId`
- **Admin publish override**: Can publish content bypassing normal media-ready checks

## Strict Rules

- **MUST** use `auth: 'platform_owner'` for ALL endpoints — NEVER weaker auth
- **MUST** scope all analytics queries by `organizationId`
- **NEVER** expose raw database queries or internal metrics
- **NEVER** allow admin operations without platform_owner role verification

## Config

- `DATABASE_URL`, `BETTER_AUTH_SECRET`, `RATE_LIMIT_KV`

## Reference Files

- `workers/admin-api/src/index.ts` — main handler and routes
