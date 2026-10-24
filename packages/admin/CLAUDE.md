# @codex/admin

Admin dashboard services: analytics, cross-creator content management and customer support grants for an organisation's owners and admins, each scoped to `organizationId`; and platform support's refund screen (`SupportService`), which is platform-wide on purpose.

## Key Exports

```typescript
import {
  AdminAnalyticsService,
  AdminContentManagementService,
  AdminCustomerManagementService,
  SupportService,
} from '@codex/admin';
// The support screen's response types, for apps/web
import type { ChargeDetail, ChargeSummary, RefundPreview /* … */ } from '@codex/admin';
```

## `SupportService` (Codex-2hxff.28)

Platform support refunds payments and settles the queue of failed refunds and creator debts. Design: `docs/handover/phase3-sources/support-refunds/data-design.md` (owner decisions 2026-10-24). Routes: admin-api `/api/admin/support/*`, all `platform_owner`.

```typescript
new SupportService({ db, environment, stripe, purchase }); // registry: ctx.services.support
```

`stripe` is admin-api's own restricted key (owner decision Q4); `purchase` gives a re-paid failed refund's access back (`PurchaseService.restoreAfterFailedRefund`).

| Method | Notes |
|---|---|
| `searchCharges({ q, page, limit })` | `q` matched exactly: email (lower-cased), purchase or subscription id, `sub_`, `pi_`, `ch_`, `py_`. A purchase's rows and an invoice's (its platform-fee slice) in one `UNION ALL`, newest first |
| `getChargeDetail(chargeId)` | One answer: the charge (Stripe), its slices (the engine's own `sourceScope`, via `loadClawbackPlanInput`) with each slice's history, refunds, chargebacks, window, `refundable`, `refundCount` |
| `previewRefund(chargeId, amountCents)` | `planClawback`, never a copy of its rules. Writes nothing |
| `issueRefund(chargeId, input, requestedByUserId)` | §5's order: list, replay, `CHARGE_CHANGED`, window, chargeback, cap, `refunds.create`. Writes nothing: `charge.refunded` records it |
| `getQueueCounts()`, `listFailedRefunds()`, `listCreatorDebts()` | Through `idx_refunds_failed_open` and `idx_refund_reviews_open` |
| `resolveFailedRefund(refundId, input, userId)` | `refunded_elsewhere`: a guarded UPDATE. `creators_repaid`: ONE transaction, the refund row locked, `repayFailedRefund`, then the purchase's access back (Q5d). Returns `{ settled, restoredAccess }`; the route bumps the caches |
| `resolveCreatorDebt(reviewId, input, userId)` | A guarded UPDATE on an open review; `dispute_won` is never accepted |

- **The scope is the charge**: every read keys on a charge, purchase or subscription id, or payout ids found from them. A charge with no record of ours is a 404 before any refund (the Stripe sandbox is shared).
- **History rule** (`support-ledger.ts`, pure): never read `payout_reversals.status` alone. A `cancelled` step marked `moved_to_repay` is `taken_from_repay`, from the slice's re-pay rows, never "not taken".
- **Never sent**: an `acct_` id, card data beyond brand and last four, `refund_reviews.error_message` (the code plus a label made here), a raw Stripe error. A ServiceError's `context` holds codes, ids, counts and amounts only.
- **Stripe calls**: the complete list is in the file header; the restricted key (Codex-5vvwj.2) is built from it. Keep it complete when adding one.

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

- **MUST** scope every analytics, content and customer query by `organizationId` — an org admin sees one org at a time. `SupportService` is the one exception: platform-wide, scoped by the charge, and only ever behind `platform_owner`
- The worker enforces the role, not the service: org management (`requireOrgManagement`) for the org-scoped services, `platform_owner` for `SupportService`
- `publishContent()` checks media readiness and the creator's payouts, as a creator's publish does. It is scoped to the organisation, not the creator, so an admin can publish any of the organisation's content
- Organization existence is validated by middleware (via org membership FK), not inside service methods

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/constants`, `@codex/validation`, `@codex/cache` (optional); for `SupportService`, `@codex/payments` (the clawback plan, `issueRefund`, the re-pay), `@codex/purchase` (the access restore, `supportRequesterOf`) and `@codex/subscription` (`isCurrentPeriodPayment`). None of them depends on `@codex/admin`, so there is no cycle: keep it that way
- **Used by**: admin-api worker (port 42073); apps/web imports its types only

## Reference Files

- `packages/admin/src/services/analytics-service.ts`
- `packages/admin/src/services/content-management-service.ts`
- `packages/admin/src/services/customer-management-service.ts`
- `packages/admin/src/services/support-service.ts` — support refunds, with its Stripe call list
- `packages/admin/src/services/support-ledger.ts` — the history rule and the labels (pure)
- `packages/admin/src/support-types.ts` — the support routes' response shapes
- `packages/admin/src/constants.ts` — `DEFAULT_TOP_CONTENT_LIMIT`
