# Ecom-API Worker (port 42072)

Stripe checkout, payment webhooks, and purchase management.

## Endpoints

| Method | Path | Policy | Input | Success | Response |
|---|---|---|---|---|---|
| POST | `/checkout/create` | `auth: 'required'` | body: `createCheckoutSchema` | 201 | `{ data: { checkoutUrl } }` |
| GET | `/purchases` | `auth: 'required'` | query: pagination | 200 | `{ items, pagination }` |
| POST | `/webhooks/stripe/booking` | Stripe HMAC | raw body | 200 | `{ received: true }` |

### Future Webhook Endpoints (scaffolded)
- `POST /webhooks/stripe/payment` — payment intent events
- `POST /webhooks/stripe/subscription` — subscription lifecycle
- `POST /webhooks/stripe/customer` — customer events
- `POST /webhooks/stripe/connect` — Connect account events
- `POST /webhooks/stripe/dispute` — dispute/fraud events

## Key Flows

### Checkout Flow
```
1. POST /checkout/create (user authenticated)
2. Validate: content exists, published, priced > 0, org exists
3. Create Stripe Checkout Session with metadata
4. Return { checkoutUrl } → redirect user to Stripe
```

### Webhook Flow
```
1. POST /webhooks/stripe/booking (Stripe sends event)
2. Verify stripe-signature header (HMAC-SHA256)
3. Extract checkout.session.completed event
4. PurchaseService.completePurchase(intentId, metadata):
   a. Check idempotency (stripePaymentIntentId unique constraint)
   b. Insert purchase record
   c. Grant contentAccess record
   d. Bump user library cache version
5. Return { received: true }
```

## Services Used

- `PurchaseService` (`@codex/purchase`) — checkout sessions, purchase completion, verification

## Special Notes

- **Webhooks do NOT use procedure()** — Stripe webhooks use custom signature verification middleware, not session auth
- **Idempotency**: `completePurchase` is idempotent via `stripePaymentIntentId` unique constraint — safe for Stripe retries
- **Revenue split**: 10% platform, 0% org, 90% creator (from `@codex/constants`)
- **Currency**: GBP (£) — all amounts in pence

## Strict Rules

- **MUST** verify Stripe webhook signatures — NEVER process unverified webhooks
- **MUST** return `{ received: true }` to Stripe webhooks — prevents Stripe retries
- **MUST** use idempotent purchase creation — webhooks may fire multiple times
- **NEVER** expose Stripe secret keys in responses or logs
- **NEVER** skip content validation before checkout creation

## Config

- `STRIPE_SECRET_KEY` — Stripe API key (secret, per environment)
- `STRIPE_WEBHOOK_SECRET_BOOKING` — webhook signing secret

## Reference Files

- `workers/ecom-api/src/routes/purchases.ts` — checkout and purchase routes
