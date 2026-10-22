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
| `publishContent` | `(contentId: string, organizationId: string)` | Transaction. Video and audio need ready media, as for a creator's publish. Content that earns money (`requiresPayoutsToPublish`) still needs its creator payout-ready — else this package's `CreatorPayoutsRequiredError`, a twin of `@codex/content`'s with the same message and code. |
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
| `grantContentAccess` | `(organizationId, customerId, contentId, grantedByUserId)` | Complimentary access — NOT a purchase record. Writes a `grant` entitlement; a re-grant of a live one is a no-op. Only paid or tier content (`isGrantableContent`, `@codex/constants`), else `ContentNotGrantableError` (422). |
| `listCustomerGrants` | `(organizationId, customerId, options?)` | The org's grants for the customer, newest first, live and revoked, with granter/revoker names. Paginated. |
| `revokeGrant` | `(organizationId, customerId, entitlementId, revokedByUserId)` | Sets `revokedAt`/`revokedByUserId`. Scoped to id + customer + org + `source = 'grant'`, else `NotFoundError`. Idempotent: returns `revoked: false` when already revoked. |

## Important: Complimentary Access vs Purchases

A comp is never a `purchases` row, so it never inflates purchase counts or revenue. It writes an `entitlements` row with source `grant` — that is what `@codex/access` reads. It never writes `contentAccess`, which nothing reads for access. A revoke never touches another source's entitlement. Rules: [docs/payments/access.md](../../docs/payments/access.md#support-grants). Revenue analytics must count every revenue type, not only one-off purchases (`Codex-2hxff.20`).

## Rules

- **MUST** scope ALL queries by `organizationId` — admin sees one org at a time
- **MUST** require `platform_owner` role for all admin-api endpoints (enforced in the worker, not the service)
- `publishContent()` checks media readiness and the creator's payouts, as a creator's publish does. It is scoped to the organisation, not the creator, so an admin can publish any of the organisation's content
- Organization existence is validated by middleware (via org membership FK), not inside service methods

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/constants`, `@codex/cache` (optional)
- **Used by**: admin-api worker (port 42073)

## Reference Files

- `packages/admin/src/services/analytics-service.ts`
- `packages/admin/src/services/content-management-service.ts`
- `packages/admin/src/services/customer-management-service.ts`
- `packages/admin/src/constants.ts` — `DEFAULT_TOP_CONTENT_LIMIT`
