# @codex/purchase

Stripe integration & Purchase mgmt.

## API
### `PurchaseService`
- **createCheckoutSession(input, uid)**: Validates content, creates Stripe Session.
- **completePurchase(intentId, meta)**: Webhook handler. Idempotent. Creates Purchase + Access.
- **verifyPurchase(contentId, uid)**: Check ownership.
- **getPurchaseHistory(uid, opts)**: List purchases.

### Utils
- **createStripeClient**: Pinned API version.
- **verifyWebhookSignature**: HMAC check.
- **calculateRevenueSplit**: 10% Plat, 0% Org, 90% Creator.

## Logic
- **Idempotency**: `stripePaymentIntentId` unique constraint.
- **Access**: Grants `contentAccess` record on success.
- **Validation**: Checks price > 0, published, org exists.

## Usage
```ts
// Checkout
const res = await svc.createCheckoutSession({ contentId, ... }, uid);
// Webhook
await svc.completePurchase(intentId, metadata);
```

## Standards
- **Assert**: `invariant()` for preconditions/state.
- **Scope**: MANDATORY `where(eq(userId, ...))`.
- **Atomic**: `db.transaction()` for all multi-step mutations.
- **Inputs**: Validated DTOs only.
