# Admin-API Worker (port 42073)

Org management dashboard (analytics, content management, customer support grants) for org owners and admins, plus platform support's own routes: fee configuration, owner reassignment and support refunds.

## Endpoints

Two kinds of route, never mixed:

- **Org management** (analytics, content, customers, grants, status): `auth: 'required'` + `requireOrgMembership: true` + `requireOrgManagement: true`, scoped by `ctx.organizationId` (resolved from org membership).
- **Platform support**: the 9 `/api/admin/fees/*` endpoints (Codex-m644n, no web UI consumer), `/api/admin/organizations/:orgId/owner`, the 12 `/api/admin/support/*` endpoints and `POST /api/admin/media/:id/restore`. They take `policy: { auth: 'platform_owner' }` with NO org policy: platform-wide on purpose, gated by the role.

All are rate limited via the `api` preset (100/min) on `/api/*`, and by their own policy's preset.

`POST /api/admin/media/:id/restore` (Codex-6sbn1) undoes a creator's media delete inside its 30 days (`MediaItemService.restore`), `{ auth: 'platform_owner', cache: 'fresh', rateLimit: 'strict' }`, no screen. 409 once the daily purge has claimed the files, for a delete from before files were kept, or for an item not deleted.

`POST /api/admin/organizations/:orgId/owner` `{ userId, reason }` (Codex-2hxff.2) is also `platform_owner`-only, on the `strict` preset (`RATE_LIMIT_STRICT`, namespaces 1051/2051/3051): platform support assigns a new owner when a transfer is impossible. It withdraws any open offer, busts both users' membership caches, and logs `reason`. No screen yet (Codex-xyb7v).

### Support refunds (Codex-2hxff.28)

Platform support's refund screen and queue (the `/admin` pages in apps/web). Design: `docs/handover/phase3-sources/support-refunds/data-design.md`. Service: `ctx.services.support` (`SupportService`, `@codex/admin`). Every route is `{ auth: 'platform_owner', cache: 'fresh' }`; reads take the `api` preset, writes `strict`. Nothing is cached: every number changes with a refund, a webhook or a payout run.

| # | Method | Path | Input (`@codex/validation`) | Response |
|---|---|---|---|---|
| 1 | GET | `/api/admin/support/charges` | query `supportChargeSearchQuerySchema` (`lookup` matched exactly, never free text: email, purchase or subscription id, `sub_`/`pi_`/`ch_`/`py_`; limit ≤ 50) | `{ items: ChargeSummary[], pagination }` |
| 2 | GET | `/api/admin/support/charges/:chargeId` | params `supportChargeParamsSchema` | `{ data: ChargeDetail }` |
| 3 | GET | `/api/admin/support/charges/:chargeId/refund-preview` | + query `supportRefundPreviewQuerySchema` (`amountCents`) | `{ data: RefundPreview }` |
| 4 | POST | `/api/admin/support/charges/:chargeId/refunds` | body `supportIssueRefundSchema` (`amountCents`, `reason`, `expectedRefundCount`) | **200** `{ data: { refund, replayed } }` |
| 5 | GET | `/api/admin/support/queue/counts` | — | `{ data: { failedRefunds, creatorDebts, owedToCreators } }`: only items needing a person (open reviews, `to_invoice` people, open credits) |
| 6 | GET | `/api/admin/support/queue/failed-refunds` | query `supportQueueQuerySchema` | `{ items: FailedRefundItem[], pagination }` |
| 7 | GET | `/api/admin/support/queue/creator-debts` | query `supportQueueQuerySchema` | `{ items: CreatorDebtPerson[], pagination }`: one row per person, with Stripe's live balance (`live: false` = the 08:00 snapshot) and a collected-over-£50 debt (Codex-2hxff.30, .73) |
| 8 | POST | `/api/admin/support/refunds/:refundId/resolve` | body `supportResolveFailedRefundSchema` (a note is required for `creators_repaid`) | `{ data: ResolvedFailedRefund }` |
| 9 | POST | `/api/admin/support/creator-debts/:reviewId/resolve` | body `supportResolveCreatorDebtSchema` (never `dispute_won`; a note is required for `manually_reversed`) | `{ data: ResolvedCreatorDebt }` |
| 10 | GET | `/api/admin/support/queue/owed-to-creators` | query `supportQueueQuerySchema` | `{ items: OwedToCreatorItem[], pagination }`: late take-backs owed back to a payee (`payee_credits`, Codex-2hxff.73) |
| 11 | POST | `/api/admin/support/owed-to-creators/:creditId/resolve` | params `supportCreditIdParamsSchema`, body `supportResolveCreditSchema` (`action` repay / count_against_debt / not_owed; a note for not_owed and on a `needs_person` row) | `{ data: ResolvedOwedToCreator }` |
| 12 | POST | `/api/admin/support/owed-to-creators/:creditId/check` | params `supportCreditIdParamsSchema` (no body) | `{ data: CheckedOwedToCreator }`: Check Stripe again |

- **Route 4 writes nothing.** It only asks Stripe, in a fixed order: list the charge's refunds; one carrying this decision's key is answered `replayed: true`; a moved count is `CHARGE_CHANGED` (412); then the 14-day window, an open or lost chargeback, and the amount cap; then `refunds.create` with the key and `codex_requested_by`. `charge.refunded` records the refund and claws back the shares. 200, not 201: a repeat creates nothing. A spent key (Stripe holds an earlier refusal or 500 for it, 24 h) is `REFUND_KEY_SPENT` (409): change the amount or use the Dashboard.
- **Route 8**, `creators_repaid`, re-pays the payees in one transaction and, for a failed full purchase refund, gives the buyer access back. It is refused, `REPAY_BLOCKED_BY_LATER_CAUSE` (422), when a chargeback or a later refund was shared against the failed one (owner decision 2026-10-25). The route then bumps the buyer's library (`invalidateUserLibrary`) and clears their streaming block, as a won dispute's restore does.
- Every Stripe call `SupportService` makes is listed in its file header: the restricted key (Codex-5vvwj.2) is built from that list.

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
| POST | `/api/admin/customers/:customerId/grant-access/:contentId` | params: customerId + contentId | 200 | `{ success: true }` — writes a `grant` entitlement |
| GET | `/api/admin/customers/:customerId/grants` | params: customerId; query: `adminCustomerGrantsQuerySchema` (limit default 50) | 200 | `{ items: CustomerGrant[], pagination }` — live and revoked |
| DELETE | `/api/admin/customers/:customerId/grants/:entitlementId` | params: `adminRevokeGrantParamsSchema` | 204 | — (404 unless this org's `grant` for this customer) |

### Status

| Method | Path | Response |
|---|---|---|
| GET | `/api/admin/status` | `{ status: 'ok', user: { id, role } }` |

## Services Used

| Service | Package | Purpose |
|---|---|---|
| `AdminAnalyticsService` (`adminAnalytics`) | `@codex/admin` | Revenue, customer, top-content, dashboard, activity feed |
| `AdminContentManagementService` (`adminContent`) | `@codex/admin` | List, publish, unpublish, delete content (admin scope) |
| `AdminCustomerManagementService` (`adminCustomer`) | `@codex/admin` | List customers, get details, grant, list and revoke support grants |
| `SupportService` (`support`) | `@codex/admin` | Support refunds: search, charge detail, refund preview, refund, the queue and settling it |

## Auth Pattern

`requireOrgManagement: true` enforces org owner or admin role — not `platform_owner` — and the resolved `ctx.organizationId` scopes those routes' queries. The platform support routes take `auth: 'platform_owner'` instead, which an organisation owner does not pass: org management is not platform support.

## Bindings / Env

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Neon PostgreSQL |
| `AUTH_SESSION_KV` | Yes | Session validation |
| `CACHE_KV` | Yes | Library version bumps and the streaming block a settlement clears |
| `RATE_LIMIT_API` | Yes | Native rate-limit binding the `/api/*` limiter counts in — `RATE_LIMIT_KV` was removed (Codex-kgrdp.17) |
| `RATE_LIMIT_STRICT` | Yes | The `strict` preset the platform support writes take (namespaces 1051/2051/3051) |
| `STRIPE_SECRET_KEY` | For support refunds | admin-api's OWN restricted key (owner decision Q4, Codex-5vvwj.2), never ecom-api's: read charges, refunds, disputes, invoices and payment intents; write refunds. Test mode for dev and test, live for production. The registry resolves it lazily, so only a Stripe call needs it |
| `ENVIRONMENT` | No | `development` / `test` / `production` (dev-webhook + guards; tags every refund with `codex_env`) |

## Strict Rules

- **MUST** give an org-management route `requireOrgManagement: true` and scope it by `ctx.organizationId` — never expose cross-org data there
- **MUST** give a platform support route `auth: 'platform_owner'` and no org policy; it is the only kind allowed to read across organisations
- **MUST** declare `cache: 'fresh'` on a support route, and `rateLimit: 'strict'` on a support write
- **NEVER** send a connected account id (`acct_`), card data beyond brand and last four, `refund_reviews.error_message`, or a raw Stripe error from a support route
- **NEVER** expose raw DB queries or internal metrics
- Admin publish/unpublish/delete bypass the normal creator ownership check (org-scoped instead)

## Reference Files

- `workers/admin-api/src/index.ts` — all routes defined inline (no separate route files)
- `workers/admin-api/src/types.ts` — `AdminApiEnv` (only public type; `AdminVariables` is deliberately unexported)
