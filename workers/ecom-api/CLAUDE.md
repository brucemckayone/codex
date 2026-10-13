# Ecom-API Worker (port 42072)

Stripe commerce: checkout, purchases and sales, subscriptions, course
monetisation, Stripe Connect, revenue-share agreements, the Stripe webhooks and
the payouts cron.

**Behaviour lives in the payments spec — read it before changing money code:**
[docs/payments/](../../docs/payments/README.md). Webhook endpoints, events,
secrets, the error policy and the Stripe Dashboard settings are in
[docs/payments/operations.md](../../docs/payments/operations.md). The spec
describes the intended behaviour and marks every place the code does not match
yet with its bead.

## Routes

All routes use `procedure()`. Mounted in `src/index.ts`:

| Mount | File | Routes |
|---|---|---|
| `/checkout` | `routes/checkout.ts` | `POST /create`, `/course`, `/course-subscription`, `/portal-session` · `GET /verify` |
| `/purchases` | `routes/purchases.ts` | `GET /`, `/:id` (the buyer's own) |
| `/sales` | `routes/sales.ts` | `GET /`, `/stats` (organisation management) |
| `/subscriptions` | `routes/subscriptions.ts` | `POST /checkout`, `/preview-tier-change`, `/change-tier`, `/cancel`, `/reactivate`, `/resume` · `GET /verify`, `/current`, `/mine` · organisation management: `GET /stats`, `/subscribers`, `/payouts`, `/payouts/summary`, `/payouts/by-creator` · self: `GET /me/payouts`, `/me/earnings-summary` |
| `/courses` | `routes/courses.ts` | `GET /:courseId/offer` |
| `/studio/courses` | `routes/course-monetisation.ts` | `PUT`/`DELETE /:courseId/subscription-plan`, `PUT /:courseId/tier-access` |
| `/connect` | `routes/connect.ts` | self: `POST /me/onboard`, `/me/sync`, `/me/dashboard` · `GET /me/status`. Org, read-only, any member: `GET /organization-status` (status fields only). The old organisation routes (`/onboard`, `/status`, `/sync`, `/dashboard`) are retired — `/dashboard` was an IDOR (`Codex-2hxff.1`); never add an org-keyed route that acts on a Connect account |
| `/agreements` | `routes/agreements.ts` | see [agreements.md → Routes](../../docs/payments/agreements.md#routes) |

## Webhooks

Mounted in `src/index.ts`, outside `procedure()`:
`verifyStripeSignature()` (secret chosen by path) → `createWebhookHandler()` →
handler.

| Path | Secret | Handler |
|---|---|---|
| `/webhooks/stripe/booking` | `STRIPE_WEBHOOK_SECRET_BOOKING` | `handleCheckoutCompleted` (`handlers/checkout.ts`) |
| `/webhooks/stripe/payment` | `STRIPE_WEBHOOK_SECRET_PAYMENT` | `handlePaymentWebhook` (`handlers/payment-webhook.ts`) |
| `/webhooks/stripe/dispute` | `STRIPE_WEBHOOK_SECRET_DISPUTE` | `handlePaymentWebhook` |
| `/webhooks/stripe/subscription` | `STRIPE_WEBHOOK_SECRET_SUBSCRIPTION` | `handleSubscriptionWebhook` (`handlers/subscription-webhook.ts`) |
| `/webhooks/stripe/connect` | `STRIPE_WEBHOOK_SECRET_CONNECT` | `handleConnectWebhook` (`handlers/connect-webhook.ts`) |
| `/webhooks/stripe/customer` | `STRIPE_WEBHOOK_SECRET_CUSTOMER` | log-only stub, to be removed (`Codex-2hxff.24`) |
| `/webhooks/stripe/dev` | `STRIPE_WEBHOOK_SECRET_BOOKING` | `routeDevWebhook` — all events, by type; 404 outside development/staging |

Local: `stripe listen --forward-to http://localhost:42072/webhooks/stripe/dev`
with every `STRIPE_WEBHOOK_SECRET_*` set to the CLI's secret.

The payouts sweep runs from `scheduled` (`handlers/payouts-sweep.ts`), cron
`0 * * * *`, production only.

## Handler shape

```
verifyStripeSignature → createWebhookHandler (logs; 200, or 500 on a transient error)
  → handler(event, stripe, c)
    → createWebhookDbClient(env) — per-request WebSocket client for transactions
    → service method (business logic lives in @codex/purchase / @codex/subscription)
    → waitUntil: cache invalidation + emails (fire-and-forget)
    → finally: await cleanup()
```

## Strict Rules

- **MUST** verify every Stripe webhook with `verifyStripeSignature()` — never
  process an unverified payload.
- **MUST** return **500 for transient failures** (database, Stripe outage, network)
  so Stripe retries, and 200 `{ received: true }` only when the event was
  processed, deliberately skipped, or failed permanently. A `ServiceError` that
  wraps a transient cause is still transient (`Codex-2hxff.6`).
- **MUST** make every handler idempotent — Stripe delivers at least once.
- **MUST** build services in webhook and cron code with the **same** config as the
  service registry (`feeConfig`, `mailer`, `payoutMailer`, `webAppUrl`, `cache`,
  `waitUntil`) — otherwise fee configuration and emails are silently skipped
  (`Codex-2hxff.7`).
- **MUST** ignore events about Stripe objects created by another environment —
  production and local development share one sandbox (`Codex-2hxff.5`).
- **MUST** use `createWebhookDbClient(env)` and release it in a `finally` block.
  Every handler `await`s `cleanup()` today; whether it should be
  `waitUntil(cleanup())` instead is open in `Codex-ev3k` (webhook lifecycle
  hygiene).
- **MUST** fire-and-forget cache invalidation and emails through `waitUntil`;
  never block the webhook response on them.
- **NEVER** put DB queries or email composition in handlers — delegate to services.
- **NEVER** expose Stripe secret keys, or raw Stripe error messages, in responses
  or logs.
- Webhooks are deliberately not rate-limited (the HMAC is the auth). Any preset a
  route uses needs its binding (`RATE_LIMIT_STRICT`, `RATE_LIMIT_API`) in
  `wrangler.jsonc`, or it fails open.

## Configuration

Secrets and vars are listed in
[docs/payments/operations.md → Secrets and configuration](../../docs/payments/operations.md#secrets-and-configuration-ecom-api).
Production secrets live in the GitHub environment `production` and reach the
worker (`ecom-api-production`) at deploy time.

## Reference Files

- `src/index.ts` — worker setup, route + webhook mounts, required env
- `src/routes/*.ts` — the route files above
- `src/handlers/checkout.ts`, `payment-webhook.ts`, `subscription-webhook.ts`,
  `connect-webhook.ts`, `payouts-sweep.ts`
- `src/middleware/verify-signature.ts` — HMAC verification, secret per path
- `src/utils/webhook-handler.ts`, `src/utils/error-classification.ts` — the 200/500 policy
- `src/utils/dev-webhook-router.ts` — local event routing
