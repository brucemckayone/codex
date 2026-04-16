# Ecom-API Worker (port 42072)

Stripe e-commerce integration: checkout sessions, payment/subscription/connect webhooks, purchase management, subscription lifecycle, and Stripe Connect onboarding.

## Route Groups

### Checkout (`/checkout`)

| Method | Path | Policy | Rate Limit | Status | Response |
|---|---|---|---|---|---|
| POST | `/checkout/create` | `auth: 'required'` | `strict` | 200 | `{ data: { sessionUrl, sessionId } }` |
| POST | `/checkout/portal-session` | `auth: 'required'` | `strict` | 200 | `{ data: { url } }` |
| GET | `/checkout/verify` | `auth: 'required'` | `api` | 200 | `{ data: { sessionStatus, purchase?, content? } }` |

### Purchases (`/purchases`)

| Method | Path | Policy | Status | Response |
|---|---|---|---|---|
| GET | `/purchases` | `auth: 'required'` | 200 | `{ items, pagination }` |
| GET | `/purchases/:id` | `auth: 'required'` | 200 | `{ data: Purchase }` |

### Subscriptions (`/subscriptions`)

| Method | Path | Policy | Rate Limit | Status | Response |
|---|---|---|---|---|---|
| POST | `/subscriptions/checkout` | `auth: 'required'` | `strict` | 201 | `{ data: { checkoutUrl, sessionId } }` |
| GET | `/subscriptions/current` | `auth: 'required'` | — | 200 | `{ data: Subscription }` |
| GET | `/subscriptions/mine` | `auth: 'required'` | — | 200 | `{ items }` |
| POST | `/subscriptions/change-tier` | `auth: 'required'` | `strict` | 200 | `{ data: Subscription }` |
| POST | `/subscriptions/cancel` | `auth: 'required'` | — | 200 | `{ data: Subscription }` |
| POST | `/subscriptions/reactivate` | `auth: 'required'` | — | 200 | `{ data: Subscription }` |
| GET | `/subscriptions/stats` | `auth: 'required'`, `requireOrgManagement` | — | 200 | `{ data: Stats }` |
| GET | `/subscriptions/subscribers` | `auth: 'required'`, `requireOrgManagement` | — | 200 | `{ items, pagination }` |

### Connect (`/connect`)

| Method | Path | Policy | Rate Limit | Status | Response |
|---|---|---|---|---|---|
| POST | `/connect/onboard` | `auth: 'required'`, `requireOrgManagement` | `strict` | 201 | `{ data: { url } }` |
| GET | `/connect/status` | `auth: 'required'`, `requireOrgManagement` | — | 200 | `{ data: ConnectStatus }` |
| POST | `/connect/sync` | `auth: 'required'`, `requireOrgManagement` | `strict` | 200 | `{ data: ConnectStatus }` |
| POST | `/connect/dashboard` | `auth: 'required'`, `requireOrgManagement` | — | 200 | `{ data: { url } }` |

## Webhook Endpoints

All webhooks bypass `procedure()`. Flow: `verifyStripeSignature()` (HMAC) → `createWebhookHandler()` → handler. Rate limit: `webhook` preset (1000/min).

| Path | Env Var for Secret | Handler | Events |
|---|---|---|---|
| `/webhooks/stripe/booking` | `STRIPE_WEBHOOK_SECRET_BOOKING` | `handleCheckoutCompleted` | `checkout.session.completed` (payment mode) |
| `/webhooks/stripe/payment` | `STRIPE_WEBHOOK_SECRET_PAYMENT` | `handlePaymentWebhook` | `payment_intent.*`, `charge.*` (incl. refunds) |
| `/webhooks/stripe/subscription` | `STRIPE_WEBHOOK_SECRET_SUBSCRIPTION` | `handleSubscriptionWebhook` | `checkout.session.completed` (subscription mode), `customer.subscription.*`, `invoice.*` |
| `/webhooks/stripe/connect` | `STRIPE_WEBHOOK_SECRET_CONNECT` | `handleConnectWebhook` | `account.*`, `capability.*`, `person.*` |
| `/webhooks/stripe/customer` | `STRIPE_WEBHOOK_SECRET_CUSTOMER` | (logging stub) | `customer.*` |
| `/webhooks/stripe/dispute` | `STRIPE_WEBHOOK_SECRET_DISPUTE` | (logging stub) | `charge.dispute.*`, `radar.early_fraud_warning.*` |
| `/webhooks/stripe/dev` | `STRIPE_WEBHOOK_SECRET_BOOKING` | `routeDevWebhook` | All events — routes to correct handler. Returns 404 in production. |

Dev usage: `stripe listen --forward-to http://localhost:42072/webhooks/stripe/dev` — set all `STRIPE_WEBHOOK_SECRET_*` to the same CLI-generated value.

## Webhook Handler Architecture

```
verifyStripeSignature (HMAC) → createWebhookHandler (wraps handler, logs, returns { received: true })
  → handler(event, stripe, context)
    → createPerRequestDbClient (WebSocket for transactions)
    → service method (business logic)
    → waitUntil: cache invalidation + email dispatch (fire-and-forget)
    → cleanup() DB connection
```

Handlers are thin orchestrators. Business logic lives in `@codex/purchase` and `@codex/subscription`.

## Services Used

| Service | Package | Purpose |
|---|---|---|
| `PurchaseService` (`purchase`) | `@codex/purchase` | Checkout sessions, purchase completion, refunds, portal, verification |
| `SubscriptionService` (`subscription`) | `@codex/subscription` | Subscription CRUD, webhook handlers, tier changes, stats |
| `TierService` (`tier`) | `@codex/subscription` | Tier CRUD, Stripe Product/Price sync |
| `ConnectService` (`connect`) | `@codex/subscription` | Connect account creation, status, dashboard links |

## Key Flows

### Purchase Flow
```
POST /checkout/create → validate content → Stripe Checkout Session
  → User pays → /webhooks/stripe/booking → completePurchase (idempotent)
    → INSERT purchase + contentAccess (transaction) → bump library cache
```

### Subscription Flow
```
POST /subscriptions/checkout → validate tier + Connect account → Stripe Session
  → /webhooks/stripe/subscription (checkout.session.completed, subscription mode)
    → handleSubscriptionCreated → INSERT subscription + membership → email + cache
  → Renewal: invoice.payment_succeeded → update period + revenue
  → Cancel: customer.subscription.updated (cancel_at_period_end) → status=cancelling
  → Period end: customer.subscription.deleted → deactivate membership
```

### Refund Flow
```
Stripe Dashboard refund → /webhooks/stripe/payment (charge.refunded)
  → processRefund (idempotent) → purchase.status=refunded + soft-delete contentAccess
```

## Config Variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Neon PostgreSQL |
| `STRIPE_SECRET_KEY` | Yes | Stripe API key |
| `STRIPE_WEBHOOK_SECRET_BOOKING` | Yes | Booking webhook secret |
| `STRIPE_WEBHOOK_SECRET_PAYMENT` | Yes | Payment webhook secret |
| `STRIPE_WEBHOOK_SECRET_SUBSCRIPTION` | Yes | Subscription webhook secret |
| `STRIPE_WEBHOOK_SECRET_CONNECT` | Yes | Connect webhook secret |
| `STRIPE_WEBHOOK_SECRET_CUSTOMER` | No | Customer webhook secret (stub only) |
| `STRIPE_WEBHOOK_SECRET_DISPUTE` | No | Dispute webhook secret (stub only) |
| `RATE_LIMIT_KV` | Yes | Rate limiting |
| `AUTH_SESSION_KV` | Yes | Session validation (for `procedure()` routes) |
| `CACHE_KV` | No | Cache invalidation after purchase/subscription |
| `ENVIRONMENT` | No | `production` enables production guards (dev webhook 404) |
| `WEB_APP_URL` | No | App URL for email links |

## Strict Rules

- **MUST** verify Stripe webhooks with `verifyStripeSignature()` — NEVER process unverified webhooks
- **MUST** return `{ received: true }` to all Stripe webhooks — prevents retries
- **MUST** use idempotent operations — webhooks fire multiple times
- **MUST** use `createPerRequestDbClient` + `waitUntil(cleanup())` in webhook handlers
- **MUST** fire-and-forget cache invalidation and emails via `waitUntil` — never block webhook response
- **NEVER** expose Stripe secret keys in responses or logs
- **NEVER** put DB queries or email composition in webhook handlers — delegate to services

## Reference Files

- `workers/ecom-api/src/index.ts` — worker setup, route + webhook registration
- `workers/ecom-api/src/routes/checkout.ts` — create, portal-session, verify
- `workers/ecom-api/src/routes/purchases.ts` — purchase list + get
- `workers/ecom-api/src/routes/subscriptions.ts` — subscription management
- `workers/ecom-api/src/routes/connect.ts` — Stripe Connect routes
- `workers/ecom-api/src/handlers/checkout.ts` — booking webhook handler
- `workers/ecom-api/src/handlers/payment-webhook.ts` — payment/refund handler
- `workers/ecom-api/src/handlers/subscription-webhook.ts` — subscription lifecycle handler
- `workers/ecom-api/src/handlers/connect-webhook.ts` — Connect account handler
- `workers/ecom-api/src/middleware/verify-signature.ts` — Stripe HMAC verification
- `workers/ecom-api/src/utils/dev-webhook-router.ts` — dev event routing
- `workers/ecom-api/src/utils/webhook-handler.ts` — webhook handler factory
