# Ecom API (42072)

Stripe integration & Webhooks.

## Endpoints
- **POST /checkout/create**: Create Stripe Session (Auth req).
- **GET /purchases**: User history.
- **POST /webhooks/stripe/booking**: Handle `checkout.session.completed`.
  - Verifies Signature.
  - Idempotent (via intent ID).
  - Creates Purchase & Access.

## Architecture
- **Service**: `PurchaseService`.
- **Security**:
  - Checkout: Session Auth.
  - Webhook: HMAC-SHA256 (`stripe-signature`). 1000 req/min.
- **Data**: `purchases` table. Immutable revenue split.

## Config
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET_*`.

## Standards
- **Validation**: Zod schema for every input.
- **Assert**: `invariant(ctx.user, "Auth required")`.
- **No Logic**: Route -> Service -> Response only.
- **Errors**: Map Service Errors to HTTP codes.
