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

Code outside `procedure()` (webhook handlers) must pass the **same** config.
Building it with only `{ db, environment }` silently drops fee configuration and
emails — the open defect `Codex-2hxff.7`.

## `PurchaseService` methods

| Method | Purpose |
|---|---|
| `createCheckoutSession(input, customerId)` / course equivalent | Gate the item, resolve the buyer's Stripe Customer, create a `mode: 'payment'` Checkout Session with server-side `price_data` |
| `completePurchase(paymentIntentId, metadata)` / `completeCoursePurchase` | Called by the booking webhook. One transaction: purchase row + split snapshot + entitlement. Then the payouts (platform fee row, creator and organisation transfers). Idempotent on the payment intent. |
| `verifyPurchase(contentId, customerId)` | A completed, undisputed purchase exists. Used by `@codex/access`. |
| `getPurchaseHistory`, `getPurchase` | The buyer's own purchases |
| `verifyCheckoutSession(sessionId, customerId)` | Success-page check; only the buyer who started the session |
| `processRefund(paymentIntentId, details?)` | Called by the `charge.refunded` webhook. **Records** a refund made in Stripe and reverses transfers — it never issues one. |
| `processDispute(...)` | Called by the dispute webhook |
| `createPortalSession(email, userId, returnUrl)` | Stripe billing portal session |

## Rules

- **MUST** verify Stripe webhook signatures with `verifyWebhookSignature()` —
  never trust an unverified payload.
- **MUST** keep completion idempotent: the unique `stripe_payment_intent_id`
  makes a redelivered webhook a no-op.
- **MUST** resolve fees through `FeeConfigService`; never hard-code percentages.
  `FEES` constants are only the last fallback.
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
