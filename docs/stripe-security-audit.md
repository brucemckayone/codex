# Stripe Integration Security Audit

> **Date**: 2026-04-08
> **Scope**: All Stripe Connect, webhook, checkout, and transfer code across the monorepo
> **Related**: [stripe-connect-subscription-reference.md](stripe-connect-subscription-reference.md) (API reference)

---

## 1. Architecture Overview

Codex is a Stripe Connect platform using the **separate charges and transfers** model. The platform charges customers directly, then transfers revenue to connected accounts (org owners and creators).

```
Customer ──pay──> Platform (ecom-api) ──transfer──> Connected Account (org/creator)
                      │
                      ├── 10% platform fee (retained)
                      ├── 15% org fee (transferred to org Connect account)
                      └── 75% creator pool (transferred to creator Connect accounts)
```

### Key Files

| Layer | File | Purpose |
|---|---|---|
| **Worker** | `workers/ecom-api/src/index.ts` | Route registration, middleware stack |
| **Webhook middleware** | `workers/ecom-api/src/middleware/verify-signature.ts` | HMAC-SHA256 signature verification |
| **Webhook factory** | `workers/ecom-api/src/utils/webhook-handler.ts` | Standard error handling (transient vs permanent) |
| **Error classification** | `workers/ecom-api/src/utils/error-classification.ts` | Decides Stripe retry behaviour |
| **Checkout handler** | `workers/ecom-api/src/handlers/checkout.ts` | One-time purchase webhook processing |
| **Subscription handler** | `workers/ecom-api/src/handlers/subscription-webhook.ts` | Subscription lifecycle webhooks |
| **Connect handler** | `workers/ecom-api/src/handlers/connect-webhook.ts` | Connect account status updates |
| **Dev router** | `workers/ecom-api/src/utils/dev-webhook-router.ts` | Local dev catch-all event routing |
| **Routes: checkout** | `workers/ecom-api/src/routes/checkout.ts` | Checkout session creation, verification |
| **Routes: subscriptions** | `workers/ecom-api/src/routes/subscriptions.ts` | Subscription lifecycle management |
| **Routes: connect** | `workers/ecom-api/src/routes/connect.ts` | Connect onboarding, sync, dashboard |
| **Purchase service** | `packages/purchase/src/services/purchase-service.ts` | Checkout + purchase completion logic |
| **Subscription service** | `packages/subscription/src/services/subscription-service.ts` | Subscription lifecycle + revenue transfers |
| **Connect service** | `packages/subscription/src/services/connect-account-service.ts` | Connect account onboarding + status |
| **Stripe client** | `packages/purchase/src/stripe-client.ts` | Client factory + webhook signature verification |
| **Revenue calculator** | `packages/purchase/src/services/revenue-calculator.ts` | Fee split calculation (purchases) |
| **Revenue split** | `packages/subscription/src/services/revenue-split.ts` | Fee split calculation (subscriptions) |
| **Validation schemas** | `packages/validation/src/schemas/subscription.ts` | Connect + subscription input schemas |
| **DB schema** | `packages/database/src/schema/subscriptions.ts` | Tiers, subscriptions, Connect accounts, pending payouts |

---

## 2. Security Controls (Verified)

### Webhook Signature Verification

All six webhook endpoints use `verifyStripeSignature()` middleware. The implementation:

- Uses `stripe.webhooks.constructEventAsync()` (async for Cloudflare Workers SubtleCrypto)
- Reads raw body with `c.req.text()` **before** any JSON parsing (critical for signature match)
- Per-endpoint signing secrets (6 total: payment, subscription, connect, customer, booking, dispute)
- Missing signature -> 400, invalid signature -> 401, missing secret -> 500

### Rate Limiting

| Endpoint | Preset | Limit |
|---|---|---|
| All `/webhooks/*` | `webhook` | 1000 req/min |
| `POST /checkout/create` | `auth` | 5 req/15min |
| `POST /connect/onboard` | `strict` | 20 req/min |
| `POST /subscriptions/checkout` | `auth` | 5 req/15min |

### Authentication & Authorization

| Route Group | Auth | Additional |
|---|---|---|
| Checkout routes | `auth: 'required'` | User ID from session, can only create for self |
| Subscription routes | `auth: 'required'` | Subscription ownership verified by userId + orgId |
| Connect routes | `auth: 'required'` | `requireOrgManagement: true` (org owner/admin only) |
| Webhook endpoints | Stripe HMAC | No session auth (Stripe signature is the auth) |

### Input Validation

- All route inputs validated with Zod schemas via `procedure({ input })` before handlers fire
- Redirect URLs (success, cancel, return, refresh) validated against domain whitelist
- UUIDs validated on all ID inputs
- Checkout session metadata validated via `checkoutSessionMetadataSchema`

### Idempotency

- **Purchases**: `stripePaymentIntentId` unique constraint on `purchases` table
- **Subscriptions**: `stripeSubscriptionId` unique constraint on `subscriptions` table
- Both handlers check-before-insert: duplicate webhooks return existing record, no error

### Connect Account Security

- Express-equivalent via `controller` properties (modern Stripe API, not legacy `type` field)
- `controller.losses.payments = 'application'` (platform assumes loss liability)
- `controller.fees.payer = 'application'` (platform pays Stripe processing fees)
- `controller.requirement_collection = 'stripe'` (Stripe handles KYC/compliance)
- Country locked to `GB`
- Capabilities: `card_payments` + `transfers` only

### Error Handling

- **Transient errors** (DB failures, network timeouts, Stripe 5xx) -> return HTTP 500 -> Stripe retries with exponential backoff over ~24h
- **Permanent errors** (business logic, Stripe 4xx, unknown) -> return HTTP 200 -> Stripe considers delivered
- Classification logic in `error-classification.ts` with conservative defaults (unknown = permanent)

### Revenue Integrity

- Database CHECK constraint enforces `amountCents = platformFeeCents + organizationFeeCents + creatorPayoutCents`
- Revenue split is immutably snapshotted at purchase/subscription creation
- Fee percentage changes don't retroactively affect existing records

---

## 3. Issues Found & Remediation Tracker

### Fixed (2026-04-08)

| Issue | Fix | Files Changed |
|---|---|---|
| Connect webhook swallowed transient errors (catch-all prevented Stripe retries) | Removed `catch` block, use `try/finally` like subscription handler | `connect-webhook.ts` |
| Booking handler crashed on subscription-mode checkout events (`payment_intent=null`) | Added `session.mode !== 'payment'` guard, skip non-payment sessions | `checkout.ts` |
| Dev webhook routing: Stripe CLI could only forward to one endpoint | Added `/webhooks/stripe/dev` catch-all that routes by event type | `dev-webhook-router.ts`, `index.ts`, `verify-signature.ts` |
| Mock checkout factory missing `mode` field causing test failures | Added `mode: 'payment'` default to `createMockStripeCheckoutEvent` | `factories.ts` |

### Open Issues

| ID | Priority | Title | Category |
|---|---|---|---|
| [Codex-bxy0](#codex-bxy0) | **P0** | One-time purchases don't transfer revenue to creators via Stripe | Business logic |
| [Codex-8yta](#codex-8yta) | **P1** | Move active webhook secrets from optional to required env vars | Deployment |
| [Codex-cknl](#codex-cknl) | **P1** | Add charge.refunded webhook handler | Business logic |
| [Codex-tjmk](#codex-tjmk) | **P2** | Remove localhost/127.0.0.1 from redirect domain whitelist in production | Security |
| [Codex-l1lz](#codex-l1lz) | **P2** | Handle account.application.deauthorized in Connect webhook | Robustness |
| [Codex-3jht](#codex-3jht) | **P2** | Verify Connect webhook endpoint has `connect:true` in Stripe Dashboard | Deployment |
| [Codex-zlrz](#codex-zlrz) | **P3** | Add connect webhook handler test suite | Test coverage |

---

### Codex-bxy0

**One-time purchases don't transfer revenue to creators via Stripe**

Priority: P0 | Type: bug

`PurchaseService.completePurchase()` calculates the revenue split (10% platform, 90% creator) and stores it in the DB, but never creates a Stripe transfer. The subscription flow has complete transfer logic (`executeTransfers()` in `subscription-service.ts`), but one-time purchases stop after recording the split.

**Impact**: Creators never receive their 90% share from one-time content sales. The platform holds 100% of funds.

**Recommended fix**: Use destination charges on the checkout session:

```typescript
// In PurchaseService.createCheckoutSession()
const session = await this.stripe.checkout.sessions.create({
  mode: 'payment',
  line_items: [{ ... }],
  payment_intent_data: {
    application_fee_amount: platformFeeCents,
    transfer_data: {
      destination: connectAccountId, // org's Connect account
    },
  },
  // ...
});
```

This has Stripe handle the split atomically -- the connected account receives `amount - application_fee_amount` automatically. No manual transfer step needed.

**Alternative**: Add post-webhook transfer logic similar to `subscription-service.ts:executeTransfers()`. This is more complex but supports multi-party splits (org + multiple creators) if needed for purchases.

**Dependencies**: Requires the org's Connect account to be active (`chargesEnabled && payoutsEnabled`). Add the same check that subscription checkout already does.

---

### Codex-8yta

**Move active webhook secrets from optional to required env vars**

Priority: P1 | Type: bug

In `workers/ecom-api/src/index.ts`, the environment validation middleware lists these as optional:

```typescript
optional: [
  'STRIPE_WEBHOOK_SECRET_PAYMENT',
  'STRIPE_WEBHOOK_SECRET_SUBSCRIPTION',
  'STRIPE_WEBHOOK_SECRET_CONNECT',
  'STRIPE_WEBHOOK_SECRET_CUSTOMER',
  'STRIPE_WEBHOOK_SECRET_DISPUTE',
],
```

The payment, subscription, and connect endpoints have active handlers. If these secrets aren't configured, real Stripe events get 500'd by the signature verification middleware (safe, but events are lost). The worker starts without error, giving no indication that webhooks are broken.

**Fix**: Move `_PAYMENT`, `_SUBSCRIPTION`, and `_CONNECT` to `required`. Keep `_CUSTOMER` and `_DISPUTE` as optional since they only have logging stubs.

---

### Codex-cknl

**Add charge.refunded webhook handler**

Priority: P1 | Type: feature

The `purchases` table has columns for refund tracking:

```sql
stripe_refund_id VARCHAR(255)
refund_reason TEXT
refund_amount_cents INTEGER
refunded_at TIMESTAMP
```

But there is no webhook handler for `charge.refunded` or `charge.refund.updated` events. If a refund is issued through the Stripe Dashboard, the local DB won't know -- the purchase stays `completed` and content access remains granted.

**Fix**: Add handler on the `/webhooks/stripe/payment` endpoint (currently a stub). Should:
1. Look up purchase by `charge.payment_intent`
2. Update purchase status to `refunded`, populate refund columns
3. Revoke `contentAccess` record
4. Bump user library cache version
5. If destination charges are used (Codex-bxy0), Stripe handles the transfer reversal automatically

---

### Codex-tjmk

**Remove localhost/127.0.0.1 from redirect domain whitelist in production**

Priority: P2 | Type: bug

`packages/validation/src/schemas/purchase.ts` line 37-38:

```typescript
const ALLOWED_REDIRECT_DOMAINS = [
  'revelations.studio',
  // ... production/staging domains
  'localhost',     // accessible in production
  '127.0.0.1',    // accessible in production
];
```

Used for checkout `successUrl`/`cancelUrl` and Connect `returnUrl`/`refreshUrl`. An attacker with a valid session could redirect post-payment to a local service on the user's machine.

**Fix**: Make environment-aware. The schema doesn't currently have access to env vars (it's a static Zod schema). Options:
1. Create a schema factory that takes `environment` param
2. Use a build-time env replacement
3. Move the whitelist to `@codex/constants` with an `isDev()` check

---

### Codex-l1lz

**Handle account.application.deauthorized in Connect webhook**

Priority: P2 | Type: feature

The Connect webhook handler only processes `account.updated`. If a connected account disconnects from the platform (e.g., creator removes Codex from their Stripe settings), the `account.application.deauthorized` event fires but is ignored.

**Impact**: The platform continues attempting transfers to a disconnected account, which fail silently and accumulate as pending payouts.

**Fix**: Add handler in `connect-webhook.ts`:
```typescript
case 'account.application.deauthorized': {
  // Set local account to disabled
  // Stop future transfer attempts
}
```

Also add this event to the Stripe Dashboard webhook configuration and `STRIPE_EVENTS` constants.

---

### Codex-3jht

**Verify Connect webhook endpoint has `connect:true` in Stripe Dashboard**

Priority: P2 | Type: task

Stripe has two webhook endpoint types:
- **Account webhooks** (`connect: false`): events on the platform's own account
- **Connect webhooks** (`connect: true`): events on connected accounts

The `/webhooks/stripe/connect` endpoint MUST be registered as a Connect webhook. If registered as an account webhook, `account.updated` events from connected accounts won't be received, and onboarding completion will never be detected.

**Action**: Verify in Stripe Dashboard for both staging and production. Add to deployment checklist.

---

### Codex-zlrz

**Add connect webhook handler test suite**

Priority: P3 | Type: task

`handleConnectWebhook` has no dedicated test file. The error-swallowing bug (fixed 2026-04-08) was caught in manual audit. The other webhook handlers have comprehensive tests:
- `checkout.test.ts` (87 tests)
- `subscription-webhook.test.ts` (15 tests)
- `verify-signature.test.ts` (13 tests)
- `webhook-handler.test.ts` (6 tests)

Test cases needed:
- `account.updated` with various requirement states (active, restricted, disabled, onboarding)
- Unknown `stripeAccountId` (should log warning, not throw)
- Transient DB errors propagate correctly (no catch block swallowing)
- Unhandled event types are logged but not processed

---

## 4. Webhook Endpoint Map

### Production (Stripe Dashboard)

| Stripe Endpoint | Worker Path | Secret Env Var | Events | Connect? |
|---|---|---|---|---|
| Payment events | `/webhooks/stripe/payment` | `STRIPE_WEBHOOK_SECRET_PAYMENT` | `payment_intent.*`, `charge.*` | No |
| Subscription events | `/webhooks/stripe/subscription` | `STRIPE_WEBHOOK_SECRET_SUBSCRIPTION` | `customer.subscription.*`, `invoice.*` | No |
| Connect events | `/webhooks/stripe/connect` | `STRIPE_WEBHOOK_SECRET_CONNECT` | `account.*`, `capability.*` | **Yes** |
| Customer events | `/webhooks/stripe/customer` | `STRIPE_WEBHOOK_SECRET_CUSTOMER` | `customer.created/updated/deleted` | No |
| Booking events | `/webhooks/stripe/booking` | `STRIPE_WEBHOOK_SECRET_BOOKING` | `checkout.session.completed` | No |
| Dispute events | `/webhooks/stripe/dispute` | `STRIPE_WEBHOOK_SECRET_DISPUTE` | `charge.dispute.*`, `radar.*` | No |

### Local Development (Stripe CLI)

Uses a single catch-all endpoint that routes by event type:

```bash
# Forward all events to the dev router
stripe listen --forward-to http://localhost:42072/webhooks/stripe/dev

# Set ALL STRIPE_WEBHOOK_SECRET_* in .dev.vars to the CLI's signing secret
```

| Event Type | Routed To |
|---|---|
| `checkout.session.completed` (mode=payment) | `handleCheckoutCompleted` |
| `customer.subscription.*`, `invoice.*` | `handleSubscriptionWebhook` |
| `account.*` | `handleConnectWebhook` |
| Everything else | Logged as unhandled |

---

## 5. Test Coverage

| File | Tests | Coverage |
|---|---|---|
| `handlers/__tests__/checkout.test.ts` | 20 | Metadata validation, idempotency, error paths, mode filtering |
| `handlers/__tests__/subscription-webhook.test.ts` | 15 | All 5 event types, missing subscription ID, error propagation |
| `middleware/__tests__/verify-signature.test.ts` | 13 | Missing/invalid signatures, path-based secret selection |
| `utils/__tests__/webhook-handler.test.ts` | 6 | Transient/permanent classification, success path |
| `utils/__tests__/error-classification.test.ts` | 24 | Stripe error types, network patterns, conservative defaults |
| `security.test.ts` | 7 | Rate limiting, security headers |
| `index.test.ts` | 2 | Health check |
| **handlers/__tests__/connect-webhook.test.ts** | **0** | **Missing** (Codex-zlrz) |
| `packages/purchase/src/__tests__/purchase-service.test.ts` | Integration | Checkout, completion, verification, history |
| `packages/subscription/src/services/__tests__/*.test.ts` | Integration | Subscription lifecycle, tier management, Connect accounts |
| `packages/validation/src/schemas/__tests__/purchase.test.ts` | 1000+ lines | Schema validation, XSS prevention, SQL injection |
