# @codex/purchase

Stripe Checkout integration, purchase lifecycle, webhook processing, and revenue split calculation.

## Key Exports

```typescript
import { PurchaseService, calculateRevenueSplit, createStripeClient, verifyWebhookSignature } from '@codex/purchase';
import { AlreadyPurchasedError, ContentNotPurchasableError, PaymentProcessingError } from '@codex/purchase';
```

## `PurchaseService`

### Constructor

```typescript
const service = new PurchaseService(
  { db, environment },
  stripe // Stripe instance from createStripeClient(secretKey)
);
```

### Methods

| Method | Signature | Notes |
|---|---|---|
| `createCheckoutSession` | `(input: CreateCheckoutInput, customerId: string)` | Validates content is published, priced, and org-scoped. Checks for existing purchase. Returns `{ sessionUrl, sessionId }`. |
| `completePurchase` | `(stripePaymentIntentId: string, metadata: CompletePurchaseMetadata)` | Transaction. **Idempotent** — returns existing if already processed. Calculates revenue split + creates purchase + grants `contentAccess`. |
| `verifyPurchase` | `(contentId: string, customerId: string)` | Returns `true` if user has a completed purchase. Used by access service. |
| `getPurchaseHistory` | `(customerId: string, input: PurchaseQueryInput)` | Paginated. Scoped to customerId. |
| `getPurchase` | `(purchaseId: string, customerId: string)` | Get single purchase. Scoped to customerId. |
| `verifyCheckoutSession` | `(sessionId: string, customerId: string)` | Verify Stripe session status. |
| `processRefund` | `(purchaseId: string, customerId: string, reason?: string)` | Transaction. Issues Stripe refund + marks purchase refunded. |
| `createPortalSession` | `(customerId: string, returnUrl: string)` | Stripe billing portal session for subscription management. |

## Utility Functions

| Export | Purpose |
|---|---|
| `createStripeClient(secretKey)` | Creates pinned Stripe SDK client |
| `verifyWebhookSignature(payload, sig, secret)` | HMAC verification for Stripe webhooks |
| `calculateRevenueSplit(amountCents, platformFeeBps, orgFeeBps)` | Returns `{ platformFeeCents, organizationFeeCents, creatorPayoutCents }` |
| `DEFAULT_PLATFORM_FEE_PERCENTAGE` | `1000` (10% in basis points) |
| `DEFAULT_ORG_FEE_PERCENTAGE` | `0` (0%) |

## Revenue Split

| Recipient | Default | Notes |
|---|---|---|
| Platform | 10% | `DEFAULT_PLATFORM_FEE_PERCENTAGE = 1000` bps |
| Organization | 0% | Reserved for future use |
| Creator | 90% | Remainder after platform fee |

**Currency: GBP (£), amounts in pence.**

## Purchase Flow

```
User clicks Buy
  → createCheckoutSession() → Stripe Checkout redirect
    → User pays → Stripe fires webhook
      → completePurchase(stripePaymentIntentId, metadata)
        → Idempotency check (return existing if found)
        → Calculate revenue split
        → INSERT purchase record
        → INSERT contentAccess record
        → COMMIT (atomic)
```

## Idempotency

`completePurchase()` uses `stripePaymentIntentId` as the unique key. If the Stripe webhook fires twice, the second call returns the existing purchase record without creating a duplicate.

## Phase 1 Constraint

Content MUST belong to an organization (`organizationId != null`) to be purchasable. Personal content (no org) cannot go through checkout.

## Custom Errors

| Error | HTTP | When |
|---|---|---|
| `ContentNotPurchasableError` | 422 | Content is free, not published, deleted, or has no org |
| `AlreadyPurchasedError` | 409 | Customer already purchased this content |
| `PaymentProcessingError` | 500 | Stripe session creation or charge failed |
| `PurchaseNotFoundError` | 404 | Purchase doesn't exist or not owned by customer |

## Rules

- **MUST** verify Stripe webhook signatures with `verifyWebhookSignature()` in webhook handler — NEVER trust unverified payloads
- **MUST** use `db.transaction()` in `completePurchase()` — purchase + access grant must be atomic
- **MUST** use idempotent purchase creation — webhooks fire multiple times
- **MUST** validate content is published and priced before creating checkout session
- **NEVER** expose Stripe secret keys in responses or logs
- Revenue split percentages come from `DEFAULT_*` constants — never hardcode

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/validation`, Stripe SDK, `@codex/constants`
- **Used by**: ecom-api worker (checkout/webhooks), `@codex/access` (purchase verification)

## Reference Files

- `packages/purchase/src/services/purchase-service.ts`
- `packages/purchase/src/services/revenue-calculator.ts`
- `packages/purchase/src/stripe-client.ts`
