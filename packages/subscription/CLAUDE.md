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

Revenue split defaults: Platform 10%, Org 15% of post-platform, Creators 75% of post-platform. Amounts are in pence (GBP). Defaults are **overridable** via the DB-configurable fee model — see `docs/payouts/fee-configuration.md`.

### Webhook ordering resilience (Codex-t7psp)

Stripe does **NOT** guarantee webhook delivery order. On a fresh subscription, `invoice.payment_succeeded` and `invoice.payment_failed` can arrive **before** `customer.subscription.created`. Without resilience the first payout (race #1) and the first past_due flip (race #2) were silently dropped.

`SubscriptionService.ensureSubscriptionDataPresent(stripeSubId, context)` is the central self-heal helper. It:

1. Fast-paths: SELECT subscription. If present → `{ subscription, justInserted: false }`.
2. Slow-path: retrieves the subscription from Stripe (or uses caller's `knownStripeSub`), validates `codex_user_id` / `codex_organization_id` / `codex_tier_id` metadata, and inserts `subscriptions` + `organizationFollowers` + `organizationMemberships` rows in one transaction.
3. On `isUniqueViolation`: another handler raced us — re-SELECT and return `justInserted: false`.
4. On Stripe 404 or missing metadata: WARN + return `null` (caller exits cleanly with 200).
5. On Stripe 5xx / DB error: bubble (caller returns 5xx, Stripe retries).

`handleSubscriptionCreated` always fires welcome-email + cache invalidation, even when `justInserted: false` — the old "swallow on unique-violation" was incompatible with self-heal because it silently dropped 5 side effects when self-heal pre-inserted the row. Cost: a rare Stripe redelivery of the create event may send the welcome email twice. Mitigated long-term by event-id dedupe (Layer D, Codex-257ia).

**Hard invariants** (regression-tested):
- Invoice handlers never log "Invoice for unknown subscription" — they self-heal instead.
- A `customer.subscription.created` arriving AFTER self-heal still emits welcome email + bumps caches.
- Concurrent self-heal + create-event yield exactly one row (unique constraint), both invocations complete cleanly.
- Stripe 404 / metadata-missing on retrieve never crashes the handler — they exit 200.

### Payout pipeline (audit closed 2026-05-13)

The invoice → transfer → pending-payout → drain flow is documented end-to-end in **`docs/payouts/payout-pipeline.md`**. Read that doc before touching any of:

- `handleInvoicePaymentSucceeded` — currency guard + split + transfers
- `executeTransfers` — fan-out + per-creator min-transfer floor
- `resolvePendingPayouts` — primary drain (webhook-triggered)
- `sweepUnresolvedPayouts` — safety-net drain (15-min cron)
- `assertGbpOnly` — single source of truth for the GBP-only currency guard

Hard invariants enforced by tests — do not regress:

- **GBP-only** (Codex-yv18n). Every `stripe.transfers.create()` call hardcodes `currency: CURRENCY.GBP` AND is preceded by `assertGbpOnly(source, context)`. New transfer call sites without a guard are a regression.
- **Idempotency keys** (Codex-90ocz). Org transfers use `${chargeId}_org_fee`, creator transfers use `${chargeId}_creator_${creatorId}`, pending-payout resolutions use `payout_${pendingPayoutId}`. Never use random/timestamp keys — they defeat replay safety.
- **Webhook `wasActive` source** (Codex-qigid). `connect-webhook.ts` reads prior state from the DB row via `getAccountByStripeId`, NOT from Stripe's `previous_attributes` (which is unreliable on capability-ricochet events).
- **Per-row error isolation** (Codex-vv77x). Both `resolvePendingPayouts` and `sweepUnresolvedPayouts` log per-row/per-group failures and continue. One bad row never poisons the batch.

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
