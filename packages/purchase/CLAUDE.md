# @codex/purchase

One-off purchases (content and courses): Stripe Checkout, purchase completion,
refunds and disputes, Stripe Customer resolution, fee configuration and the
revenue split.

**Behaviour lives in the payments spec — read it before changing money code:**
[docs/payments/purchases.md](../../docs/payments/purchases.md) (checkout,
completion, refunds, disputes) and
[docs/payments/fees-and-splits.md](../../docs/payments/fees-and-splits.md) (fee
configuration and split maths). The spec describes the intended behaviour and
marks every place the code does not match yet with its bead.

## Key Exports

```typescript
import {
  PurchaseService, FeeConfigService,
  calculateRevenueSplit, applyMinPlatformFeeFloor,
  createStripeClient, verifyWebhookSignature,
  resolveOrCreateCustomer, withStaleCustomerRecovery,
  findActiveCreatorAgreementShare,
  supportRequesterOf, STANDING_REFUND_STATUSES,
} from '@codex/purchase';
```

Errors (`src/errors.ts`): `PurchaseNotFoundError`, `AlreadyPurchasedError`,
`ContentNotPurchasableError`, `CourseNotPurchasableError`,
`CourseAlreadyOwnedError`, `PaymentProcessingError`, `RevenueCalculationError`.

## Construction

In `procedure()` handlers use `ctx.services.purchase` — the registry
(`packages/worker-utils/src/procedure/service-registry.ts`) wires everything:

```typescript
new PurchaseService(
  { db, environment, feeConfig, mailer, webAppUrl },
  stripe // createStripeClient(secretKey) — pinned API version
);
```

Code outside `procedure()` (webhooks, crons) gets the same graph from
`createWebhookServices` (Codex-2hxff.54). `feeConfig` (a `FeeResolver`: the
read side of `FeeConfigService`) and `mailer` are **required** in the types
(Codex-2hxff.55, docs/payments/architecture.md rule A4), so a service built
with only `{ db, environment }` does not compile. Tests spread
`createTestMoneyDeps()` from `@codex/test-utils`.

## `PurchaseService` methods

| Method | Purpose |
|---|---|
| `createCheckoutSession(input, customerId)` / course equivalent | Gate the item, resolve the buyer's Stripe Customer, create a `mode: 'payment'` Checkout Session with server-side `price_data` |
| `completePurchase(paymentIntentId, metadata)` / `completeCoursePurchase` | Called by the booking webhook. One transaction: purchase row + split snapshot + entitlement. Then the payouts (platform fee row, creator and organisation transfers). Idempotent on the payment intent. |
| `verifyPurchase(contentId, customerId)` | A completed, undisputed purchase exists. Used by `@codex/access`. |
| `getPurchaseHistory`, `getPurchase` | The buyer's own purchases, content and course |
| `listSales`, `getSalesStats` / `listMySales`, `getMySalesStats` | An organisation's sales ledger / a solo creator's own orgless sales; one shared query, so both have the same rows and filters |
| `verifyCheckoutSession(sessionId, customerId)` | Success-page check; only the buyer who started the session |
| `processRefund(paymentIntentId, details?)` | Called by the `charge.refunded` webhook. **Records** a refund made in Stripe and reverses transfers — it never issues one. |
| `recordRefund(refund)` / `recordChargeRefunds(charge)` | One `refunds` row per Stripe refund, forward only (`failed`/`canceled` are final). `requestedByUserId` (from `supportRequesterOf(refund)`, the `codex_requested_by` metadata) is written once and only if a user has that id, so an edited value never fails the webhook. A missing `purchase_id` is filled in, here and by `processRefund` for its charge; "standing" also counts a refund of the charge still without one |
| `restoreAfterFailedRefund(tx, purchaseId, chargeId)` | Support settles a failed FULL refund as `creators_repaid` (Codex-2hxff.28, Q5d): inside the caller's transaction, the purchase is `completed` again and its access restored. Otherwise `reason` (`RefundAccessKept`, logged at info): `partial`, `not_refunded`, `dispute_holds` (by purchase or charge), `duplicate`, `rebought`, `still_refunded`; after the last two the refund fields are still restated |
| `restateStandingRefunds(paymentIntentId, chargeId)` | A refund that failed (2026-10-24) or was canceled (2026-10-25) returned nothing: a part-refunded (`completed`) purchase's refund amount, id and reason are restated from the refunds still standing (`STANDING_REFUND_STATUSES`), the same restatement as above. `refund.updated` runs it after `processRefund`, which only ever raises the amount |
| `processDispute(...)` | Called by the dispute webhook |
| `createPortalSession(email, userId, returnUrl)` | Stripe billing portal session |

## Rules

- **MUST** verify Stripe webhook signatures with `verifyWebhookSignature()` —
  never trust an unverified payload.
- **MUST** keep completion idempotent: the unique `stripe_payment_intent_id`
  makes a redelivered webhook a no-op.
- **MUST** resolve fees through `FeeConfigService`; never hard-code percentages.
  `FEES` constants are only its last fallback, when no fee row exists; the
  service itself has no constant fallback (Codex-2hxff.55).
- **MUST** take the price from the database, never from the client; GBP only;
  never a £0 price.
- **MUST** use a deterministic idempotency key on every money-moving Stripe call
  (`${chargeId}_creator`, `${chargeId}_org_fee`, `${transferId}_reversal_${refundId}`).
- **MUST** spread `stripeEnvMetadata(this.environment)` (`@codex/constants`) into
  the metadata of every Stripe object created — and into `payment_intent_data` /
  `subscription_data` on a Checkout Session. Production and local dev share one
  Stripe sandbox; an untagged object's events are processed by BOTH
  (`Codex-2hxff.5`, docs/payments/operations.md → Environments).
- **MUST** write the entitlement for every completed purchase. `content_access` is
  not an access source — never add a reader.
- The charge model is **separate charges and transfers** (never destination
  charges): the buyer is charged on the platform account and each slice is a
  `transfers.create` with `source_transaction`. See
  [docs/payments/README.md](../../docs/payments/README.md#how-money-moves).
- **NEVER** expose Stripe secret keys or raw Stripe error messages in responses
  or logs.
- **NEVER** send a buyer the org's fee split. `getPurchase` answers the buyer
  (ecom-api `GET /purchases/:id`), so it excludes `BUYER_HIDDEN_COLUMNS`: the
  three fee columns, both agreement ids, `duplicateOfPurchaseId`,
  `disputeReason` and `stripeDisputeId` (owner, 2026-10-27, Codex-kn94e). Its
  return type is `BuyerPurchase`.

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/validation`,
  `@codex/constants`, `@codex/cache`, Stripe SDK
- **Used by**: ecom-api (checkout routes, booking/payment/dispute webhooks),
  `@codex/access` (purchase verification), `@codex/subscription` (customer
  resolution, Stripe client)

## Reference Files

- `src/services/purchase-service.ts` — checkout, completion, refunds, disputes, payouts
- `src/services/fee-config-service.ts` — 3-tier fee lookup
- `src/services/revenue-calculator.ts` — split maths and minimum platform fee
- `src/services/resolve-customer.ts` — one Stripe Customer per user
- `src/services/entitlement-writer.ts` — purchase entitlements
- `src/services/agreement-share.ts` — agreement lookup for one-off sales
- `src/stripe-client.ts` — pinned Stripe client and webhook verification
