# @codex/purchase

Stripe integration, checkout sessions, webhook handling, and purchase verification.

## API

### `PurchaseService`
| Method | Purpose | Notes |
|---|---|---|
| `createCheckoutSession(input, userId)` | Create Stripe Checkout session | Validates content exists, published, priced |
| `completePurchase(intentId, metadata)` | Process successful payment | Idempotent. Creates purchase + access grant |
| `verifyPurchase(contentId, userId)` | Check if user owns content | Used by access service |
| `getPurchaseHistory(userId, options)` | List user's purchases | Paginated, scoped to user |

### Utilities
| Export | Purpose |
|---|---|
| `createStripeClient(secretKey)` | Creates pinned Stripe SDK client |
| `verifyWebhookSignature(payload, sig, secret)` | HMAC verification of Stripe webhooks |
| `calculateRevenueSplit(amountCents)` | Returns `{ platform, org, creator }` split |

## Revenue Split

| Recipient | Percentage | Notes |
|---|---|---|
| Platform | 10% | `PLATFORM_FEE_BPS = 1000` from `@codex/constants` |
| Organization | 0% | Currently zero — reserved for future |
| Creator | 90% | Remainder after platform fee |

**Currency**: GBP (£) — all amounts in pence (cents equivalent).

## Key Patterns

### Idempotency
`completePurchase()` uses `stripePaymentIntentId` as a unique constraint on the `purchases` table. If the webhook fires twice, the second call is a no-op (detects existing record).

### Purchase Flow
```
User clicks Buy → createCheckoutSession → Stripe Checkout page
  → User pays → Stripe webhook → completePurchase
    → Insert purchase record (idempotent)
    → Grant contentAccess record
    → Bump user library version in cache
```

### Validation Before Checkout
- Content MUST exist and be published
- Content MUST have price > 0 (free content doesn't go through checkout)
- Organization MUST exist
- User MUST be authenticated

## Strict Rules

- **MUST** verify Stripe webhook signatures with `verifyWebhookSignature()` — NEVER trust unverified webhooks
- **MUST** use idempotent purchase creation (unique `stripePaymentIntentId`) — webhooks may fire multiple times
- **MUST** use `db.transaction()` for `completePurchase` — purchase record + access grant must be atomic
- **MUST** validate content is published and priced before creating checkout session
- **NEVER** expose Stripe secret keys in responses or logs
- **NEVER** hardcode currency or fee percentages — use `@codex/constants`

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`, `@codex/validation`, Stripe SDK
- **Used by**: ecom-api worker, `@codex/access` (purchase verification)

## Reference Files

- `packages/purchase/src/services/purchase-service.ts` — PurchaseService
