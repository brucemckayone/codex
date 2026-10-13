# @codex/subscription

Organisation tiers, subscriptions, course subscription plans, Stripe Connect
accounts and the payouts ledger (transfers, pending payouts, drains).

**Behaviour lives in the payments spec — read it before changing money code:**
[docs/payments/subscriptions.md](../../docs/payments/subscriptions.md) (tiers,
lifecycle, tier and price changes, failed payments, refunds),
[docs/payments/connect-and-payouts.md](../../docs/payments/connect-and-payouts.md)
(Connect, ownership, ledger, drains) and
[docs/payments/fees-and-splits.md](../../docs/payments/fees-and-splits.md)
(invoice split maths). The spec describes the intended behaviour and marks every
place the code does not match yet with its bead.

## Key Exports

- **`TierService`** — tier CRUD and Stripe Product/Price sync
- **`SubscriptionService`** — subscription checkout, webhook handling, tier
  changes, cancellation, invoice transfers, pending-payout drains, earnings reads
- **`CourseSubscriptionService`** — course subscription plans and their webhooks
- **`ConnectAccountService`** — Connect onboarding, status, login links
- **`calculateRevenueSplit(amountCents, platformFeeBps, orgFeeBps)`** — integer
  three-way split; the platform and organisation round up, the creator pool takes
  the remainder

Errors (`src/errors.ts`): `TierNotFoundError`, `TierHasSubscribersError`,
`TierSortOrderConflictError`, `SubscriptionNotFoundError`,
`AlreadySubscribedError`, `SubscriptionCheckoutError`,
`SubscriptionPaymentRequiredError`, `CourseSubscriptionPlanNotFoundError`,
`CourseSubscriptionPlanExistsError`, `AlreadyCourseSubscribedError`,
`ConnectAccountNotFoundError`, `ConnectAccountNotReadyError`,
`CreatorConnectRequiredError`, `ConnectPlatformNotConfiguredError`.

## Construction

In `procedure()` handlers use `ctx.services.tier`, `ctx.services.subscription`,
`ctx.services.connect` — the registry
(`packages/worker-utils/src/procedure/service-registry.ts`) wires everything:

```ts
new SubscriptionService(
  { db, environment, cache, waitUntil, mailer, payoutMailer, webAppUrl, feeConfig },
  stripe // createStripeClient(secretKey) from @codex/purchase
);
```

Webhook handlers and the payouts cron build their own instances and must pass
the **same** config. Leaving out `feeConfig` silently applies the `FEES`
constants instead of fee configuration, and leaving out `payoutMailer` drops the
payout-released email — the open defects `Codex-2hxff.7` and `Codex-2hxff.13`.

## Tiers

- Scoped by `organizationId`. One Stripe Product plus a monthly and an annual
  Price, on the platform account.
- A price change creates new Prices (Prices are immutable) and archives the old
  ones. How existing subscribers move is specified in
  [subscriptions.md → Price changes](../../docs/payments/subscriptions.md#price-changes).
- If the DB insert fails, the new Stripe Product is archived (orphan prevention).
- One `isRecommended` tier per organisation (enforced in a transaction).
- `sortOrder` **is** the access hierarchy. Soft delete only; a tier with
  subscribers who have not cancelled cannot be deleted (`TierHasSubscribersError`).

### Archived tiers resolve on read paths

A soft-deleted tier is **archived, not gone**: it takes no new writes or
checkouts, but must still resolve for access checks, notification joins and
historic reads of subscriptions that predate the delete.

| Path | Helper | Filters `deletedAt` |
|---|---|---|
| Write (update, delete, new checkout, change tier) | private `getTierOrThrow` + inline write queries | Yes — strict |
| Read (access check, email/notification joins, historic reads) | public `TierService.getTierForAccessCheck(tierId)` | **No** — archived tiers resolve |
| Active-tier list (storefront, admin) | `listTiers` / `listAllTiers` | Yes — strict |

Pick the variant that matches the path. The strict helper on a read path breaks
subscribers whose tier was archived; the loose helper on a write path lets a
deleted tier take new subscriptions.

## Access hierarchy

`subscribers ⊇ followers ⊇ public`: an active subscription unlocks
followers-only content without a follower row (the follower row is the fallback
for ex-subscribers who still follow). Tier-gated content needs a tier whose
`sortOrder` is at least the content's minimum tier. The grant path is in
`ContentAccessService` (`packages/access/CLAUDE.md`); the full rules are in
[docs/payments/access.md](../../docs/payments/access.md).

## Webhook ordering (self-heal)

Stripe does not guarantee delivery order: `invoice.payment_succeeded` or
`invoice.payment_failed` can arrive before `checkout.session.completed` has
recorded the subscription. `SubscriptionService.ensureSubscriptionDataPresent`
is the single self-heal helper:

1. Fast path: the row exists → use it.
2. Slow path: retrieve the subscription from Stripe, validate the
   `codex_user_id` / `codex_organization_id` / `codex_tier_id` metadata, and insert
   the subscription, follower and membership rows in one transaction.
3. Unique violation → another handler won the race; re-select.
4. Stripe 404 or missing metadata → warn and exit with 200.
5. Stripe 5xx or a DB error → let it propagate so the webhook returns 500 and
   Stripe retries.

Subscriptions are created from `checkout.session.completed`;
`customer.subscription.created` is not handled. Invoice handlers never log
"unknown subscription" — they self-heal. Concurrent self-heal and completion
yield exactly one row.

## Payouts pipeline invariants

Read [connect-and-payouts.md](../../docs/payments/connect-and-payouts.md) before
touching `handleInvoicePaymentSucceeded`, `executeTransfers`,
`resolvePendingPayouts`, `sweepUnresolvedPayouts` or `assertGbpOnly`.

- **GBP only.** Every `stripe.transfers.create()` hard-codes `currency:
  CURRENCY.GBP` and is preceded by `assertGbpOnly(...)`. A new transfer call site
  without the guard and a test is a regression.
- **Deterministic idempotency keys.** `${chargeId}_org_fee`,
  `${chargeId}_creator_${creatorId}`, `${chargeId}_creator_pool_owner`,
  `payout_${payoutId}`. Never random or time-based keys.
- **Every slice gets a ledger row** — paid, or pending until the payee is payable.
  Never drop a slice with only a log line.
- **`wasActive` comes from our DB row** (`getAccountByStripeId`), not Stripe's
  `previous_attributes`, which is unreliable on capability-ricochet events.
- **Per-row error isolation** in `resolvePendingPayouts` and
  `sweepUnresolvedPayouts`: one bad row never stops the batch.
- The sweep is an ecom-api cron at `0 * * * *`, **production only**; minute `0`
  is load-bearing (shared database wake).

## Connect accounts

- **One account per user** (`uq_stripe_connect_user`), whatever organisations they
  belong to. Created with controller properties (Express-equivalent), key
  `connect_acct_${userId}`.
- Status (`active` = charges and payouts enabled) comes from `account.updated`.
- Only the account's owner gets an Express Dashboard login link. Every
  `ConnectAccountService` method that ACTS on an account (onboard, sync, login
  link) is keyed by the caller's own `userId`; the one org-keyed read,
  `getOrganizationPayoutStatus`, returns status fields only (`Codex-2hxff.1`).

## Strict Rules

- **MUST** scope tier and subscription queries by `organizationId`.
- **MUST** use transactions for multi-step DB writes.
- **MUST** check the organisation owner's Connect account is payable before
  creating a tier, a course plan or a subscription checkout.
- **MUST** use deterministic idempotency keys on Stripe calls.
- **MUST** check for an existing live subscription before creating a checkout
  (`AlreadySubscribedError`) — and handle a duplicate that completes anyway.
- **NEVER** process a webhook before the ecom-api worker has verified its
  signature.
- Amounts in **pence (GBP)**, never USD.

## Integration

- **Depends on**: `@codex/database`, `@codex/purchase`, `@codex/cache`,
  `@codex/service-errors`, `@codex/validation`, `@codex/constants`, Stripe SDK
- **Used by**: ecom-api (checkout, webhooks, Connect, payouts cron) and
  organization-api (tier management), via the service registry

## Reference Files

- `src/services/tier-service.ts`
- `src/services/subscription-service.ts`
- `src/services/course-subscription-service.ts`
- `src/services/connect-account-service.ts`
- `src/services/stripe-status-mapper.ts`
- `src/services/subscription-invalidation.ts`
- `src/services/revenue-split.ts`
- `src/errors.ts`
