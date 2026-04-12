# Ecom-API Worker (port 42072)

Stripe e-commerce integration: checkout sessions, payment/subscription/connect webhooks, purchase management, and subscription lifecycle.

## Route Groups

### 1. Checkout (`/checkout`)
| Method | Path | Policy | Input | Status | Response |
|---|---|---|---|---|---|
| POST | `/checkout/create` | `auth: 'required'` | body: `createCheckoutSchema` | 201 | `{ data: { checkoutUrl, sessionId } }` |
| GET | `/checkout/verify/:sessionId` | `auth: 'required'` | params: sessionId | 200 | `{ data: { sessionStatus, purchase?, content? } }` |

### 2. Purchases (`/purchases`)
| Method | Path | Policy | Input | Status | Response |
|---|---|---|---|---|---|
| GET | `/purchases` | `auth: 'required'` | query: pagination + status filter | 200 | `{ items, pagination }` |
| GET | `/purchases/:id` | `auth: 'required'` | params: id | 200 | `{ data: Purchase }` |

### 3. Subscriptions (`/subscriptions`)
| Method | Path | Policy | Input | Status | Response |
|---|---|---|---|---|---|
| POST | `/subscriptions/checkout` | `auth: 'required'` | body: `createSubscriptionCheckoutSchema` | 201 | `{ data: { checkoutUrl, sessionId } }` |
| GET | `/subscriptions/current` | `auth: 'required'` | query: organizationId | 200 | `{ data: Subscription }` |
| GET | `/subscriptions/mine` | `auth: 'required'` | — | 200 | `{ items }` |
| POST | `/subscriptions/change-tier` | `auth: 'required'` | body: `changeTierSchema` | 200 | `{ data }` |
| POST | `/subscriptions/cancel` | `auth: 'required'` | body: `cancelSubscriptionSchema` | 200 | `{ data }` |
| POST | `/subscriptions/reactivate` | `auth: 'required'` | body: `reactivateSubscriptionSchema` | 200 | `{ data }` |
| GET | `/subscriptions/subscribers` | `auth: 'required'` | query: pagination + tierId + status | 200 | `{ items, pagination }` |
| GET | `/subscriptions/stats` | `auth: 'required'` | query: organizationId | 200 | `{ data: Stats }` |
| GET | `/subscriptions/tiers` | none (public) | query: organizationId | 200 | `{ items }` |
| POST | `/subscriptions/tiers` | `auth: 'required'` | body: `createTierSchema` | 201 | `{ data: Tier }` |
| PATCH | `/subscriptions/tiers/:id` | `auth: 'required'` | body: `updateTierSchema` | 200 | `{ data: Tier }` |
| DELETE | `/subscriptions/tiers/:id` | `auth: 'required'` | params: id | 204 | — |
| POST | `/subscriptions/tiers/reorder` | `auth: 'required'` | body: `reorderTiersSchema` | 200 | `{ data }` |

### 4. Connect (`/connect`)
| Method | Path | Policy | Input | Status | Response |
|---|---|---|---|---|---|
| POST | `/connect/onboard` | `auth: 'required'` | body: `connectOnboardSchema` | 201 | `{ data: { url } }` |
| GET | `/connect/status` | `auth: 'required'` | query: organizationId | 200 | `{ data: ConnectStatus }` |
| POST | `/connect/dashboard` | `auth: 'required'` | body: `connectDashboardSchema` | 200 | `{ data: { url } }` |

## Webhook Endpoints (7)

All webhooks use `verifyStripeSignature()` middleware (HMAC-SHA256), NOT `procedure()`.

| Path | Secret Env Var | Handler | Events Handled |
|---|---|---|---|
| `/webhooks/stripe/booking` | `STRIPE_WEBHOOK_SECRET_BOOKING` | `handleCheckoutCompleted` | `checkout.session.completed` (mode=payment) |
| `/webhooks/stripe/payment` | `STRIPE_WEBHOOK_SECRET_PAYMENT` | `handlePaymentWebhook` | `payment_intent.*`, `charge.*` (incl. refunds) |
| `/webhooks/stripe/subscription` | `STRIPE_WEBHOOK_SECRET_SUBSCRIPTION` | `handleSubscriptionWebhook` | `checkout.session.completed` (mode=subscription), `customer.subscription.*`, `invoice.*` |
| `/webhooks/stripe/connect` | `STRIPE_WEBHOOK_SECRET_CONNECT` | `handleConnectWebhook` | `account.*`, `capability.*`, `person.*` |
| `/webhooks/stripe/customer` | `STRIPE_WEBHOOK_SECRET_CUSTOMER` | (logging stub) | `customer.*` |
| `/webhooks/stripe/dispute` | `STRIPE_WEBHOOK_SECRET_DISPUTE` | (logging stub) | `charge.dispute.*`, `radar.early_fraud_warning.*` |
| `/webhooks/stripe/dev` | `STRIPE_WEBHOOK_SECRET_BOOKING` | `routeDevWebhook` | All events (dev-only, 404 in production) |

## Handler Architecture

```
Request → verifyStripeSignature (HMAC) → createWebhookHandler (wraps handler)
  → handler(event, stripe, context)
    → createPerRequestDbClient (WebSocket for transactions)
    → Service method (business logic)
    → Fire-and-forget: cache invalidation + email dispatch (via waitUntil)
    → cleanup() DB connection
```

Handlers are **thin orchestrators**: extract Stripe event data, call service methods, fire-and-forget cache invalidation and email dispatch. Business logic lives in `@codex/purchase`, `@codex/subscription`.

## Services Used

| Service | Package | Used For |
|---|---|---|
| `PurchaseService` | `@codex/purchase` | Checkout sessions, purchase completion, refunds, verification, portal |
| `SubscriptionService` | `@codex/subscription` | Subscription CRUD, webhook handlers, tier changes, stats |
| `TierService` | `@codex/subscription` | Tier CRUD, Stripe Product/Price sync, reordering |

## Config Variables

| Variable | Required | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | Yes | Stripe API key |
| `DATABASE_URL` | Yes | Neon PostgreSQL connection |
| `STRIPE_WEBHOOK_SECRET_BOOKING` | Yes | Booking webhook signing secret |
| `STRIPE_WEBHOOK_SECRET_PAYMENT` | Yes | Payment webhook signing secret |
| `STRIPE_WEBHOOK_SECRET_SUBSCRIPTION` | Yes | Subscription webhook signing secret |
| `STRIPE_WEBHOOK_SECRET_CONNECT` | Yes | Connect webhook signing secret |
| `STRIPE_WEBHOOK_SECRET_CUSTOMER` | No | Customer webhook signing secret (stub) |
| `STRIPE_WEBHOOK_SECRET_DISPUTE` | No | Dispute webhook signing secret (stub) |
| `RATE_LIMIT_KV` | Yes | KV namespace for rate limiting |
| `CACHE_KV` | No | KV namespace for cache invalidation |
| `ENVIRONMENT` | No | `production` / `development` / `test` |
| `WEB_APP_URL` | No | Web app URL for email links |

## Strict Rules

- **MUST** keep handlers thin — business logic belongs in service packages, not route handlers
- **MUST** verify Stripe webhook signatures with `verifyStripeSignature()` — NEVER process unverified webhooks
- **MUST** return `{ received: true }` to Stripe webhooks — prevents Stripe retries
- **MUST** use idempotent operations — webhooks may fire multiple times (unique constraints protect against duplicates)
- **MUST** use `createPerRequestDbClient` + `waitUntil(cleanup())` in webhook handlers for DB lifecycle
- **MUST** fire-and-forget cache invalidation and email dispatch via `waitUntil` — never block webhook response
- **NEVER** expose Stripe secret keys in responses or logs
- **NEVER** skip content validation before checkout creation
- **NEVER** put DB queries or email composition in webhook handlers — delegate to services

## Key Flows

### Purchase Flow
```
POST /checkout/create → validate content (published, priced) → Stripe Checkout Session
  → User pays → Stripe webhook /booking → completePurchase (idempotent)
    → Insert purchase + contentAccess (transaction) → Bump library cache
```

### Subscription Flow
```
POST /subscriptions/checkout → validate tier + Connect account → Stripe Checkout Session
  → User subscribes → Stripe webhook /subscription (checkout.session.completed mode=subscription)
    → handleSubscriptionCreated → Insert subscription + membership (transaction) → Email + cache
  → Renewal → invoice.payment_succeeded → Update period + revenue transfers
  → Cancel → customer.subscription.updated (cancel_at_period_end) → status=cancelling
  → Period end → customer.subscription.deleted → status=cancelled → Deactivate subscriber membership
```

### Refund Flow
```
Stripe Dashboard refund → Stripe webhook /payment (charge.refunded)
  → handlePaymentWebhook → processRefund (idempotent)
    → Update purchase status=refunded + soft-delete contentAccess (transaction)
```

## Reference Files

- `workers/ecom-api/src/index.ts` — Worker setup, route registration, webhook endpoints
- `workers/ecom-api/src/routes/checkout.ts` — Checkout routes
- `workers/ecom-api/src/routes/purchases.ts` — Purchase query routes
- `workers/ecom-api/src/routes/subscriptions.ts` — Subscription management routes
- `workers/ecom-api/src/routes/connect.ts` — Stripe Connect routes
- `workers/ecom-api/src/handlers/checkout.ts` — Checkout webhook handler
- `workers/ecom-api/src/handlers/payment-webhook.ts` — Payment/refund webhook handler
- `workers/ecom-api/src/handlers/subscription-webhook.ts` — Subscription webhook handler
- `workers/ecom-api/src/handlers/connect-webhook.ts` — Connect webhook handler
- `workers/ecom-api/src/middleware/verify-signature.ts` — Stripe HMAC verification
- `workers/ecom-api/src/utils/dev-webhook-router.ts` — Dev-only event routing
- `workers/ecom-api/src/utils/webhook-handler.ts` — Webhook handler factory
