# @codex/subscription

Subscription tier management, checkout lifecycle, Stripe Connect account onboarding, and revenue split calculation.

## Key Exports

**Services**:
- **`TierService`** — Subscription tier CRUD with Stripe Product/Price sync
- **`SubscriptionService`** — Checkout sessions, webhook handling, tier changes, cancellation
- **`ConnectAccountService`** — Stripe Express Connect onboarding and account management

**Utilities**:
- **`calculateRevenueSplit(amountCents, platformFeePercent, orgFeePercent)`** — Three-way revenue split (platform → org → creator pool). Integer math only (pence). Returns `RevenueSplit: { platformFeeCents, organizationFeeCents, creatorPayoutCents }`.

**Error classes**: `TierNotFoundError`, `TierHasSubscribersError`, `TierSortOrderConflictError`, `SubscriptionNotFoundError`, `AlreadySubscribedError`, `SubscriptionCheckoutError`, `ConnectAccountNotFoundError`, `ConnectAccountNotReadyError`, `CreatorConnectRequiredError`

**Validation schemas** (re-exported from `@codex/validation`): `createTierSchema`, `updateTierSchema`, `reorderTiersSchema`, `createSubscriptionCheckoutSchema`, `cancelSubscriptionSchema`, `changeTierSchema`, `connectOnboardSchema`, `listSubscribersQuerySchema`, etc.

## Constructor Pattern

All three services take `(config: ServiceConfig, stripe: Stripe)`:

```ts
import { TierService, SubscriptionService, ConnectAccountService } from '@codex/subscription';
import { createStripeClient } from '@codex/purchase';

const stripe = createStripeClient(env.STRIPE_SECRET_KEY);
const tier = new TierService({ db, environment }, stripe);
const subscription = new SubscriptionService({ db, environment }, stripe);
const connect = new ConnectAccountService({ db, environment }, stripe);
```

In `procedure()` handlers, access via `ctx.services.tier`, `ctx.services.subscription`, `ctx.services.connect` — the service registry handles construction.

## TierService Responsibilities

- Create / update / delete / list / reorder tiers scoped by `organizationId`
- Sync tiers to Stripe: `stripe.products.create()` + 2x `stripe.prices.create()` (monthly + annual)
- Price changes create new Stripe Prices (immutable) and archive old ones
- Idempotency keys on all Stripe create calls — safe to retry
- Orphan prevention: if DB insert fails, archives the Stripe Product
- Only one tier per org can have `isRecommended: true` (enforced in a transaction)
- Soft delete only; cannot delete tiers with active subscribers (`TierHasSubscribersError`)

### Archived-tier semantic (Q8 product decision)

Soft-deleted tiers behave as **archived, not gone**. They are excluded from active-tier listings and cannot receive new writes or new subscription checkouts, but they **must still resolve for read/historic paths**: access-control checks, subscription → tier joins in notification/reporting code, and any query that resolves tier metadata for a subscription that predates the delete.

| Path | Helper | Filters `deletedAt` |
|---|---|---|
| Write (update, delete, new checkout, change tier) | private `getTierOrThrow` + inline write queries | Yes — strict |
| Read (access check, email/notification joins, historic reads) | public `TierService.getTierForAccessCheck(tierId)` | **No** — archived tiers resolve |
| Active-tier list (storefront, admin) | `listTiers` / `listAllTiers` | Yes — strict |

Callers MUST pick the variant that matches their path. Using the strict helper for a read path silently breaks subscribers whose tier was archived after they subscribed; using the loose helper for a write path lets a deleted tier silently receive new subscriptions.

## SubscriptionService Responsibilities

- Create Stripe Checkout sessions in `subscription` mode
- Handle Stripe webhook events: `customer.subscription.created/updated/deleted`, `invoice.payment_succeeded/failed`
- Execute multi-party revenue transfers on `invoice.payment_succeeded`:
  1. `stripe.transfers.create()` to org Connect account
  2. `stripe.transfers.create()` to each creator's Connect account
  3. Platform retains its fee in Stripe balance
- Tier changes (upgrade/downgrade) via `stripe.subscriptions.update()` with proration
- Cancel / reactivate subscriptions
- Query subscriber stats and current subscription

### Access hierarchy (Codex-xybr3)

The platform's access hierarchy is **`subscribers ⊇ followers ⊇ public`**: an active subscription to an org grants followers-only content access automatically — subscribers do **not** need an explicit follower row for `accessType='followers'` content. The follower row remains as a fallback so ex-subscribers (status=cancelled) who are still following continue to see the content.

Tier-gated (`accessType='subscribers'`) content is **orthogonal** to this hierarchy: a subscription only unlocks tier-gated content if the subscriber's tier `sortOrder >= content.minimumTierId.sortOrder`. The grant path is implemented in `ContentAccessService` (see `packages/access/CLAUDE.md`).

Revenue split defaults: Platform 10%, Org 15% of post-platform, Creators 75% of post-platform. Amounts are in pence (GBP).

## ConnectAccountService Responsibilities

- Create Express-equivalent Connect accounts (new Stripe API with `controller` properties)
- Generate Account Link URLs for onboarding
- Handle `account.updated` webhooks to track `chargesEnabled` + `payoutsEnabled`
- Generate Express Dashboard login links
- One account per user per org (unique constraint enforced)

Onboarding flow: `createAccount()` → user completes Stripe-hosted flow → `account.updated` webhook → `isReady()` returns `true`

## calculateRevenueSplit

```ts
import { calculateRevenueSplit } from '@codex/subscription';

// FEES.PLATFORM_PERCENT and FEES.ORG_PERCENT come from @codex/constants
const split = calculateRevenueSplit(1000, 1000, 1500);
// { platformFeeCents: 100, organizationFeeCents: 135, creatorPayoutCents: 765 }
// All amounts in pence; sum equals input exactly
```

Fee percentages are in basis points (10000 = 100%).

## Strict Rules

- **MUST** scope all tier and subscription queries by `organizationId`
- **MUST** use transactions for multi-step DB + Stripe operations
- **MUST** validate org's Connect account is ready before allowing subscription creation
- **MUST** use idempotency keys for Stripe API calls
- **MUST** handle `AlreadySubscribedError` — check before creating checkout session
- **NEVER** store raw Stripe webhook payloads — verify HMAC first (handled in ecom-api worker)
- All amounts in **pence (GBP)** — default currency is GBP, never USD

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/validation`, `@codex/constants`, Stripe SDK
- **Used by**: ecom-api worker (checkout, webhooks), organization-api worker (tier management, Connect onboarding), via `ctx.services.tier`, `ctx.services.subscription`, `ctx.services.connect`
- **Registered in**: `packages/worker-utils/src/procedure/service-registry.ts`

## Reference Files

- `packages/subscription/src/services/tier-service.ts`
- `packages/subscription/src/services/subscription-service.ts`
- `packages/subscription/src/services/connect-account-service.ts`
- `packages/subscription/src/services/revenue-split.ts`
- `packages/subscription/src/errors.ts`
