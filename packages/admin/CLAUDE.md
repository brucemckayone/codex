# @codex/admin

Admin dashboard services for platform owners. Analytics, cross-creator content management, and customer support tools. All operations scoped to `organizationId`.

## Key Exports

```typescript
import {
  AdminAnalyticsService,
  AdminContentManagementService,
  AdminCustomerManagementService,
} from '@codex/admin';
```

## `AdminAnalyticsService`

### Constructor

```typescript
const service = new AdminAnalyticsService({ db, environment });
```

### Methods

| Method | Signature | Notes |
|---|---|---|
| `getRevenueStats` | `(organizationId: string, options?: RevenueQueryOptions)` | Aggregate revenue: total, platform fee, org fee, creator payout, avg order value, daily breakdown. Only `COMPLETED` purchases. Optional `startDate`/`endDate` filter. |
| `getCustomerStats` | `(organizationId: string)` | Total unique customers + new customers in last `ANALYTICS.TREND_DAYS_DEFAULT` days. Uses CTE subquery. |
| `getTopContent` | `(organizationId: string, options?)` | Revenue-ranked content list. Default limit from `DEFAULT_TOP_CONTENT_LIMIT` constant. |
| `getRecentActivity` | `(organizationId: string, input: AdminActivityQueryInput)` | Paginated activity feed (purchases, etc.). |
| `getDashboardStats` | `(organizationId: string, options?: DashboardStatsOptions)` | Combined dashboard summary. |

## `AdminContentManagementService`

Scoped by `organizationId` — admin sees ALL content in the org across all creators.

### Constructor

```typescript
const service = new AdminContentManagementService({ db, environment });
service.setCache(cache); // Optional: inject VersionedCache for invalidation
```

### Methods

| Method | Signature | Notes |
|---|---|---|
| `listAllContent` | `(organizationId: string, options?)` | Paginated. Optional `status` filter. Returns `AdminContentItem` with creator info. |
| `publishContent` | `(contentId: string, organizationId: string)` | Transaction. Admin publish bypass (does NOT require media ready). |
| `unpublishContent` | `(contentId: string, organizationId: string)` | Transaction. Returns to draft. |
| `deleteContent` | `(contentId: string, organizationId: string)` | Transaction. Soft delete. |

## `AdminCustomerManagementService`

### Constructor

```typescript
const service = new AdminCustomerManagementService({ db, environment });
```

### Methods

| Method | Signature | Notes |
|---|---|---|
| `listCustomers` | `(organizationId: string, options?)` | Paginated customers (users with completed purchases). Filters: search, contentId, joinedWithin, minSpendCents, maxSpendCents. |
| `getCustomerDetails` | `(customerId: string, organizationId: string)` | Full customer profile with purchase history. |
| `grantContentAccess` | `(customerId: string, contentId: string, organizationId: string)` | Transaction. Grants complimentary access via `contentAccess` table — NOT a purchase record. |

## Important: Complimentary Access vs Purchases

`grantContentAccess()` writes to `contentAccess` table (not `purchases`). This keeps revenue analytics accurate — comps don't inflate purchase counts or revenue figures.

## Rules

- **MUST** scope ALL queries by `organizationId` — admin sees one org at a time
- **MUST** require `platform_owner` role for all admin-api endpoints (enforced in the worker, not the service)
- `publishContent()` bypasses the media-ready check — this is intentional for admin override capability
- Organization existence is validated by middleware (via org membership FK), not inside service methods

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/constants`, `@codex/cache` (optional)
- **Used by**: admin-api worker (port 42073)

## Reference Files

- `packages/admin/src/services/analytics-service.ts`
- `packages/admin/src/services/content-management-service.ts`
- `packages/admin/src/services/customer-management-service.ts`
- `packages/admin/src/constants.ts` — `DEFAULT_TOP_CONTENT_LIMIT`
