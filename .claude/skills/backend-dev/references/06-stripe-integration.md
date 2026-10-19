---
name: stripe-integration
description: >
  Deep reference for Stripe integration in Codex — platform architecture, checkout,
  subscriptions, Connect, webhook verification, idempotency, revenue splits, and
  the dev webhook router.
type: reference
---

# Stripe Integration

Stripe is the payment backbone of Codex. It handles:

- One-time content purchases
- Recurring subscription tiers per organization
- Stripe Connect for creator payouts (multi-party revenue splits)
- Automated webhook-driven state reconciliation

This reference covers **how Codex uses Stripe**. For generic Stripe SDK best
practices (not Codex-specific), load the `stripe-best-practices` skill.

Reference implementations:
- `packages/purchase/src/stripe-client.ts` — client factory + `verifyWebhookSignature`
- `packages/purchase/src/services/purchase-service.ts` — one-time purchases
- `packages/subscription/src/services/subscription-service.ts` — subscriptions, revenue transfers
- `packages/subscription/src/services/connect-account-service.ts` — Connect onboarding
- `packages/subscription/src/services/revenue-split.ts` — fee calculations
- `workers/ecom-api/src/routes/{checkout,subscriptions,connect}.ts` — routes
- `workers/ecom-api/src/handlers/{checkout,subscription-webhook,connect-webhook,payment-webhook}.ts` — webhook handlers
- `workers/ecom-api/src/middleware/verify-signature.ts` — signature middleware
- `workers/ecom-api/src/utils/{dev-webhook-router,error-classification}.ts` — utilities
- `packages/constants/src/commerce.ts` — `STRIPE_EVENTS`, `FEES`, `CURRENCY`

---

## 1. Platform Overview

**The behaviour spec is [docs/payments/](../../../../docs/payments/README.md)** —
what can be bought, how every sale is split, refunds, disputes, payouts and
access. Read it before changing money code; it marks every place the code does
not match yet with its bead. This reference keeps only the *coding patterns*.

Codex uses **separate charges and transfers**: the buyer is charged on the
platform account (Codex is merchant of record) and every other party is paid by
its own `transfers.create` with `source_transaction = chargeId`. Never use
destination charges, `application_fee_amount` or `transfer_data` — they can only
pay one connected account. Fees resolve through `FeeConfigService`
(`FEES` constants are the last fallback): platform 10% of gross; organisation 10%
(one-off) or 15% (subscriptions) of the post-platform pool; creators the rest,
or as set by revenue-share agreements. See
[fees-and-splits.md](../../../../docs/payments/fees-and-splits.md).

### Currency

**Everything is GBP (pence).** Not USD, not pounds. A `priceCentsSchema` value of
`999` means £9.99. Never convert; pass the pence value directly to Stripe.

```typescript
import { CURRENCY } from '@codex/constants';
// CURRENCY.GBP === 'gbp'

stripe.transfers.create({
  amount: 999,              // 999 pence = £9.99
  currency: CURRENCY.GBP,   // 'gbp'
  destination: connectAccountId,
});
```

### Integer-math invariants on money splits

Any function that splits a money amount into buckets (platform / org / creator)
MUST assert the buckets sum back to the input. Integer rounding is easy to get
wrong — `Math.floor(x * 0.15)` for three buckets can lose or gain a penny.

```typescript
// packages/subscription/src/services/revenue-split.ts — the canonical pattern
const sum = platformFeeCents + organizationFeeCents + creatorPayoutCents;
if (sum !== amountCents) {
  throw new InternalServiceError('Revenue split does not sum to input', {
    amountCents, platformFeeCents, organizationFeeCents, creatorPayoutCents,
  });
}
```

Catches rounding bugs at the source. Without this, you find out via ledger
reconciliation months later.

### Stripe SDK version

Pinned to `'2025-10-29.clover'` (Stripe Node v19.3.1). When upgrading, read the
Stripe changelog and use the `stripe-best-practices` skill which includes migration
guidance.

---

## 2. Stripe Client Setup

```typescript
// packages/purchase/src/stripe-client.ts
export function createStripeClient(apiKey: string): Stripe {
  return new Stripe(apiKey, { apiVersion: '2025-10-29.clover' });
}
```

The client is created once per request by the service registry
(`getStripeClient()` in `service-registry.ts`), shared by `purchase`, `subscription`,
`tier`, and `connect` services. You never construct it directly in a handler.

### Environment switching

`STRIPE_SECRET_KEY` is a single worker binding. There's no `STRIPE_SECRET_KEY_TEST`
vs `STRIPE_SECRET_KEY_LIVE` distinction at the code level — you switch by updating
the secret value in Cloudflare (`sk_test_*` vs `sk_live_*`).

**Detection:** if needed, `apiKey.startsWith('sk_test_')` indicates test mode. Most
of the code doesn't need to care — same flows either way.

---

## 3. One-Time Purchase Flow

Spec: [docs/payments/purchases.md](../../../../docs/payments/purchases.md).

```
POST /checkout/create (content) | POST /checkout/course   — auth required, rateLimit 'strict'
  → PurchaseService gates the item, resolves the buyer's ONE Stripe Customer
    (resolve-customer.ts), creates a mode:'payment' session with server-side price_data
checkout.session.completed → /webhooks/stripe/booking → handleCheckoutCompleted
  → completePurchase / completeCoursePurchase, one transaction:
      purchases row (unique stripe_payment_intent_id) + split snapshot + entitlement
  → after commit: platform_fee ledger row + creator / org transfers (or pending rows)
  → waitUntil: library cache bump + receipt email
```

Patterns:

- **Pass the resolved Customer** (`customer: cus_…` from `resolveOrCreateCustomer`
  / `withStaleCustomerRecovery`), never let Checkout create a fresh Customer per
  session. One Customer per user per environment.
- **The price comes from our DB**, never the client. GBP, pence, never £0.
- **Access is the entitlement**, written in the completion transaction.
  `content_access` is legacy and nothing reads it for access.
- Purchase rows are only ever inserted as `completed` (by the webhook); there is
  no `pending` purchase row during the redirect window.

### Redirect target: success page, not destination page

Stripe redirects the user to `success_url` **the moment it collects payment**,
which is strictly before the `checkout.session.completed` webhook lands. If
the success URL is the final destination (e.g. `/library?purchase=success`),
the page loads while the webhook is still in flight — any code that reads the
just-created purchase/subscription row finds nothing, and the
localStorage-backed library collection may merge that empty snapshot over any
stale cache the user already had.

**Always redirect to a verify-before-handoff page** (`/checkout/success`,
`/subscription/success`). That page calls a verify endpoint
(`GET /checkout/verify` or `GET /subscriptions/verify`) which retrieves the
Stripe session, asserts ownership via `metadata.customerId` /
`metadata.codex_user_id`, and looks up the DB row written by the webhook.
The page polls `invalidate('checkout:verify')` (or equivalent) on a 3s×10
retry loop until the DB row appears, then hands off to the final destination.

The service method for verification:
- takes `sessionId` + `userId` (auth'd user from `ctx.user.id`)
- throws `ForbiddenError` on metadata ownership mismatch (never let a user
  verify someone else's session)
- returns `{ sessionStatus: 'complete' | 'expired' | 'open', purchase?/subscription? }`
  — the presence of the nested row distinguishes "webhook landed" from
  "still in flight"
- treats a missing row as a transient "keep polling" state, not an error

Reference implementations:
- `PurchaseService.verifyCheckoutSession` → `GET /checkout/verify` → `/checkout/success/+page.{server.ts,svelte}`
- `SubscriptionService.verifyCheckoutSession` → `GET /subscriptions/verify` → `/subscription/success/+page.{server.ts,svelte}`


## 4. Subscription Flow

Spec: [docs/payments/subscriptions.md](../../../../docs/payments/subscriptions.md)
(lifecycle, tier and price changes, failed payments, refunds, billing portal) and
[connect-and-payouts.md](../../../../docs/payments/connect-and-payouts.md) (the
payouts ledger).

- Each tier has one Stripe Product and two Prices (monthly + annual) on the
  platform account. **Prices are immutable**: a price change creates new Prices
  and archives the old ones. Existing subscribers move only at their next renewal
  after 30 days' notice — never by an immediate `subscriptions.update` swap
  (that is the open defect `Codex-2hxff.3`).
- A tier with subscribers who have not cancelled cannot be deleted
  (`TierHasSubscribersError`).
- Subscriptions are created from `checkout.session.completed` (subscription mode);
  `customer.subscription.created` is not used. State transitions are
  webhook-driven — never change subscription state from a route handler except
  through the cancel/reactivate/resume/change-tier service methods.
- `invoice.payment_succeeded` splits the invoice and pays each slice with its own
  `transfers.create` (`source_transaction`, `transfer_group: sub_${subscriptionId}`,
  deterministic keys `${chargeId}_org_fee`, `${chargeId}_creator_${creatorId}`,
  `${chargeId}_creator_pool_owner`). A payee who is not payable gets a **pending
  row in the `payouts` ledger** (the old `pendingPayouts` table gets no new rows),
  drained when they become payable.
- The Billing Portal is always opened with an explicit locked `configuration`
  (payment methods + invoices only).


---

## 5. Stripe Connect

Spec: [docs/payments/connect-and-payouts.md](../../../../docs/payments/connect-and-payouts.md).

```typescript
await stripe.accounts.create({
  controller: {
    stripe_dashboard: { type: 'express' },
    fees: { payer: 'application' },       // the platform pays Stripe's fees
    losses: { payments: 'application' },  // the platform is liable for refunds/disputes
    requirement_collection: 'stripe',
  },
  capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
  country: 'GB',
  metadata: { codex_user_id: userId },     // + codex_env (Codex-2hxff.5)
}, { idempotencyKey: `connect_acct_${userId}` });
```

- **One Connect account per USER** (`uq_stripe_connect_user`), whatever
  organisations they belong to — never per (user × org).
- Onboarding and dashboard routes are **self-scoped**: `POST /connect/me/onboard`,
  `GET /connect/me/status`, `POST /connect/me/sync`, `POST /connect/me/dashboard`
  — each acts on `ctx.user.id` only. Only the account's owner may get an Express
  login link. Never take an organisation or account id from the request body for
  these (the org-level `/connect/dashboard` IDOR is `Codex-2hxff.1`).
- Account Links and login links are short-lived — generate fresh on click.


---

## 6. Webhook Signature Verification

**This is a security-critical path.** Mess it up and anyone can impersonate Stripe.

### The rules

1. Read the RAW body (`c.req.text()`) — parsing destroys the signature
2. Get signature from `stripe-signature` header
3. Use `stripe.webhooks.constructEventAsync()` — async because Workers use SubtleCrypto
4. Different endpoints use different secrets (see below)

### Route-based secret routing

Codex has separate webhook endpoints per domain, each with its own secret:

| Path | Purpose | Secret env var |
|------|---------|----------------|
| `/webhooks/stripe/booking` | One-time purchases (mode=payment) | `STRIPE_WEBHOOK_SECRET_BOOKING` |
| `/webhooks/stripe/payment` | Refunds, chargebacks | `STRIPE_WEBHOOK_SECRET_PAYMENT` |
| `/webhooks/stripe/subscription` | Subscription lifecycle | `STRIPE_WEBHOOK_SECRET_SUBSCRIPTION` |
| `/webhooks/stripe/connect` | Connect account events | `STRIPE_WEBHOOK_SECRET_CONNECT` |
| `/webhooks/stripe/customer` | Log-only stub — to be removed (`Codex-2hxff.24`) | `STRIPE_WEBHOOK_SECRET_CUSTOMER` |
| `/webhooks/stripe/dispute` | Disputes + early fraud warnings (`handlePaymentWebhook`) | `STRIPE_WEBHOOK_SECRET_DISPUTE` |
| `/webhooks/stripe/dev` | Dev all-events | `STRIPE_WEBHOOK_SECRET_BOOKING` (reused in dev) |

Separate secrets mean if one leaks, you rotate that endpoint's secret without
disrupting the others.

### Middleware

```typescript
// workers/ecom-api/src/middleware/verify-signature.ts (pseudo-code)
export const verifyStripeSignature = async (c, next) => {
  const rawBody = await c.req.text();               // MUST be raw, not parsed
  const signature = c.req.header('stripe-signature');
  if (!signature) return c.json({ error: 'Missing signature' }, 400);

  const secret = getWebhookSecret(c.env, c.req.path);  // Routes by path
  if (!secret) return c.json({ error: 'Secret not configured' }, 501);

  const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);
  try {
    const event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
    c.set('stripeEvent', event);
    c.set('stripe', stripe);
    await next();
  } catch {
    return c.json({ error: 'Invalid signature' }, 401);
  }
};
```

**Why `constructEventAsync` (not `constructEvent`):** Cloudflare Workers use
SubtleCrypto for HMAC, which is async. The sync version throws in Workers.

---

## 7. Webhook Handler Shape

Every handler follows the same defensive pattern:

```typescript
export async function handleCheckoutCompleted(event, stripe, c) {
  const session = event.data.object as Stripe.Checkout.Session;

  // 1. Filter by mode (both /booking and /subscription receive checkout.session.completed)
  if (session.mode !== 'payment') return;

  // 2. Validate metadata
  let meta;
  try {
    meta = checkoutSessionMetadataSchema.parse(session.metadata);
  } catch (err) {
    obs?.error('Invalid metadata', { sessionId: session.id });
    return;  // Permanent error — don't throw (would cause Stripe retries)
  }

  // 3. The registry's services (webhooks don't go through procedure()).
  // Never build a service by hand: `{ db, environment }` alone silently drops
  // fee config and emails (Codex-2hxff.7). The factory uses the webhook's own
  // Stripe client and stays on the Neon driver (Codex-2hxff.54).
  const { services, background, release } = await createWebhookServices(
    c.env,
    c.executionCtx,
    { obs, stripe }
  );
  try {
    const purchase = await services.purchase.completePurchase(paymentIntentId, { ... });

    // 4. Side effects after the response. DB work goes through `background`,
    // which holds the pool open until it settles; KV and email through
    // `waitUntil`.
    if (c.env.CACHE_KV) {
      const cache = new VersionedCache({
        kv: c.env.CACHE_KV,
        waitUntil: (p) => c.executionCtx.waitUntil(p),
        obs,
      });
      c.executionCtx.waitUntil(
        cache.invalidate(CacheType.COLLECTION_USER_LIBRARY(meta.customerId)).catch(() => {})
      );
    }
    sendEmailToWorker(c.env, c.executionCtx, { ... });
  } finally {
    release(); // closes the pool once `background` work settles; never awaited
  }
}
```

### Returning side-effect payloads from the service

Services can't call `executionCtx.waitUntil` — they don't receive the execution
context. But they know best what side-effects should run after their DB writes
settle. Pattern: services return a typed result carrying the info the handler
needs to dispatch waitUntil work.

```typescript
// In the service (subscription-service.ts)
export interface WebhookHandlerResult {
  userId?: string;
  organizationId?: string;
  email?: { to: string; templateName: string; data: unknown };
}

async handleSubscriptionCreated(...): Promise<WebhookHandlerResult> {
  const sub = await this.db.transaction(...);
  return {
    userId: sub.userId,
    organizationId: sub.organizationId,
    email: { to: user.email, templateName: 'subscription-created', data: {...} },
  };
}

// In the handler — it dispatches side-effects with executionCtx
const result = await service.handleSubscriptionCreated(...);
if (result.userId && c.env.CACHE_KV) {
  c.executionCtx.waitUntil(cache.invalidate(...).catch(() => {}));
}
if (result.email) {
  sendEmailToWorker(c.env, c.executionCtx, result.email);
}
```

This keeps the service pure (DB writes + return value) while leaving cache/email
dispatch in the handler where `executionCtx` lives.

### Why webhooks bypass `procedure()`

Webhooks read raw body before parsing, which `procedure()` doesn't support. They
also need explicit DB client lifecycle because the service registry doesn't run.

### Permanent vs transient errors

```
Permanent (return 200, Stripe stops retrying):
  - Invalid metadata (will fail forever on retry)
  - Business-logic rejection (e.g., tier not found)
  - An event about another environment's object, or an unknown event type

Transient (return 500, Stripe retries with backoff):
  - DB connection errors and timeouts
  - Stripe 5xx, rate limits, network errors
  - ...INCLUDING when a service has wrapped one of these in a ServiceError
```

`isTransientError()` (`workers/ecom-api/src/utils/error-classification.ts`) decides.
Today it treats every `ServiceError` as permanent, and `BaseService.handleError`
wraps unknown errors into one — so a DB outage inside a service is acked 200 and
never retried. That is the open defect `Codex-2hxff.6`; classify by the
underlying cause. Spec: [operations.md → Webhook error policy](../../../../docs/payments/operations.md#webhook-error-policy).

---

## 8. Idempotency Guarantees

Stripe retries a failed delivery for up to 3 days in live mode (fewer, faster
retries in test mode), and its idempotency keys expire after about 24 hours — so a
late retry cannot rely on the key alone. Codex defends against duplicate
processing at these layers:

| Layer | Mechanism |
|-------|-----------|
| DB unique constraint | `purchases.stripePaymentIntentId`, `subscriptions.stripeSubscriptionId` |
| Stripe idempotency key | On `stripe.transfers.create(...)` — replay returns same transfer |
| Check-before-insert | `completePurchase` returns existing row if found |
| Transaction safety | Concurrent duplicate webhooks serialize at DB |
| One ledger row per slice | Unique per charge + slice + payee, so a replay cannot add a second payout row (`Codex-2hxff.11`) |

**You do not need to implement idempotency in new handlers unless you're doing
something weird.** Inserting into a table with a unique constraint on the Stripe
ID is enough — the second insert fails with `isUniqueViolation`, you catch and
return the existing row.

### Unique-constraint-first idempotency (preferred over check-before-insert)

Two ways to write idempotent inserts:

```typescript
// Acceptable — check-before-insert (has TOCTOU race window with concurrent webhooks)
const existing = await tx.query.subscriptions.findFirst({
  where: eq(subscriptions.stripeSubscriptionId, sid),
});
if (existing) return existing;
const [sub] = await tx.insert(subscriptions).values({...}).returning();

// Preferred — unique-first (race-free, fewer round-trips)
try {
  const [sub] = await tx.insert(subscriptions).values({...}).returning();
  return sub;
} catch (err) {
  if (isUniqueViolation(err)) {
    return tx.query.subscriptions.findFirst({
      where: eq(subscriptions.stripeSubscriptionId, sid),
    });
  }
  throw err;
}
```

The check-before-insert form has a TOCTOU race when two webhook deliveries arrive
concurrently — both SELECTs miss, both INSERTs try, one wins with a unique
violation that the code doesn't handle. Unique-first skips the race by letting
the DB be the arbiter.

Use check-before-insert only when you need to return the existing row AND the
"already done" path is hot enough that the extra SELECT avoids mostly-unneeded INSERTs.

### Re-purchase after refund

A less obvious idempotency case: a user buys content, refunds, then buys again.
**Access** comes from the entitlement: the refund set `revokedAt` on the old one,
and the live-entitlement unique index only covers rows where `revokedAt IS NULL`,
so the new purchase simply inserts a fresh entitlement. The legacy
`contentAccess` row (still written, never read for access) is soft-deleted on
refund and must be revived rather than duplicated:

Pattern: `onConflictDoUpdate` against the `(userId, contentId)` unique constraint:

```typescript
await tx.insert(contentAccess).values({
  userId,
  contentId,
  accessType: 'purchased',
  purchaseId: newPurchase.id,
  deletedAt: null,  // explicitly revive
}).onConflictDoUpdate({
  target: [contentAccess.userId, contentAccess.contentId],
  set: {
    accessType: 'purchased',
    purchaseId: newPurchase.id,
    deletedAt: null,
    updatedAt: new Date(),
  },
});
```

The new purchase row is still a new insert (different `stripePaymentIntentId`).
It's the access grant that needs resurrection logic.

---

## 9. Metadata Conventions

All Stripe objects carry our metadata. Use consistent keys:

| Stripe object | Key | Value |
|---------------|-----|-------|
| Checkout session (purchase) | `customerId` | User UUID |
| Checkout session (purchase) | `contentId` | Content UUID |
| Checkout session (purchase) | `organizationId` | Org UUID (nullable) |
| Checkout session (purchase) | `creatorId` | Creator user id |
| Checkout session (purchase) | `contentTitle` | Display string for emails |
| Checkout session (course) | `kind`, `courseId`, `courseTitle` | `'course'` + course |
| Subscription | `codex_user_id` | User UUID |
| Subscription | `codex_organization_id` | Org UUID |
| Connect account | `codex_user_id` | The account owner (one account per user — no org id) |
| Every object we create | `codex_env` | The environment that created it — handlers skip other environments' objects (`Codex-2hxff.5`) |
| Transfer | `subscription_id` | Our subscription UUID |
| Transfer | `type` | `'organization_fee'` \| `'creator_payout'` \| `'creator_payout_to_owner'` |
| Transfer | `transfer_group` | `sub_${subscriptionId}` (groups period transfers) |

Always validate metadata on receipt — use `checkoutSessionMetadataSchema.parse(...)`.
A Stripe dashboard admin could in theory mess with metadata.

---

## 10. Dev Webhook Router

Stripe CLI (`stripe listen`) forwards ALL events to ONE URL with ONE secret.
Production has separate endpoints; dev needs a single endpoint that routes.

```
POST /webhooks/stripe/dev
  → dispatcher inspects event.type
  → routes to appropriate handler(s)
```

The dispatcher at `workers/ecom-api/src/utils/dev-webhook-router.ts`:

- `checkout.session.completed` → dual-dispatch to purchase + subscription handlers (each filters by `mode`)
- `customer.subscription.*`, `invoice.*` → subscription handler
- `charge.*`, `payment_intent.*` → payment handler
- `account.*` → connect handler
- `product.*`, `price.*` → **not routed today** — Dashboard tier sync-back never runs locally (`Codex-2hxff.24`)

**Production safety guard:**

```typescript
if (c.env.ENVIRONMENT === 'production') {
  return c.json({ error: 'Not found' }, 404);
}
```

Never accept `/dev` traffic in prod.

### Local setup

```bash
# Terminal 1: run the worker
pnpm dev

# Terminal 2: forward Stripe events
stripe listen --forward-to http://localhost:42072/webhooks/stripe/dev
```

The CLI prints a secret (`whsec_...`). Set every `STRIPE_WEBHOOK_SECRET_*` env
var to that same secret in `.dev.vars` — the CLI only generates one.

---

## 11. Cache Invalidation on Webhooks

When subscription/purchase state changes, invalidate the relevant KV version keys.
Fire-and-forget via `waitUntil`:

```typescript
const cache = new VersionedCache({ kv: c.env.CACHE_KV });
c.executionCtx.waitUntil(
  cache.invalidate(CacheType.COLLECTION_USER_LIBRARY(userId)).catch(() => {})
);
c.executionCtx.waitUntil(
  cache.invalidate(CacheType.COLLECTION_USER_SUBSCRIPTION(userId, orgId)).catch(() => {})
);
```

The version bump triggers cross-device sync — the user's other tab reads the new
version on next visibility check, refetches the library/subscription, and updates
the badges. See the `caching` skill for the full mechanism.

---

## 12. Adding a New Stripe Integration

When you're adding a new payment flow (e.g., one-time tip, course bundle purchase):

0. **Write the rule into the spec first** — [docs/payments/](../../../../docs/payments/README.md); agree it with the owner before coding
1. **Design the domain** — what's the Stripe object (session, subscription, etc)? What metadata do you need? (always `codex_env`)
2. **Add the Zod schema** — `packages/validation/src/schemas/purchase.ts` (or a new file)
3. **Add the service method** — `packages/purchase/src/services/` or a new subdomain
4. **Add the route** — `workers/ecom-api/src/routes/` with `rateLimit: 'strict'` and `auth: 'required'`
5. **Handle the webhook** — `workers/ecom-api/src/handlers/` with signature verification, building services with the registry's config
6. **Add idempotency** — unique constraint in DB + idempotency keys on Stripe API calls
7. **Plan the failure modes** — what if Connect account is suspended? What if refund arrives?
8. **Test with Stripe CLI** — `stripe trigger checkout.session.completed` etc.

---

## 13. Anti-Patterns

| Anti-pattern | Why it breaks | Fix |
|--------------|---------------|-----|
| Reading parsed body before signature verification | Signature check fails (body differs from raw) | `c.req.text()` first |
| Synchronous `constructEvent` in Workers | Throws — Workers need SubtleCrypto | `constructEventAsync` |
| Same webhook secret for all endpoints | One leak compromises all | Separate secret per endpoint |
| No idempotency on transfers | Duplicate webhooks → duplicate transfers | `idempotencyKey` on `transfers.create` |
| `throw` in webhook handler without intent | Stripe retries for up to 3 days | Return 200 for permanent errors, 500 only for transient |
| Hardcoded USD currency | Codex is GBP | Use `CURRENCY.GBP` from constants |
| Writing to DB in checkout route handler | Racy — webhook may arrive before response | Defer writes to webhook handler |
| Synchronous cache invalidation (no `waitUntil`) | Blocks response | `executionCtx.waitUntil(cache.invalidate(...).catch(...))` |
| `await cleanup()` in webhook `finally` block | Blocks the 200 response on Neon WS teardown (50–200ms latency added) | `c.executionCtx.waitUntil(cleanup())` — **disputed**: all five ecom-api handlers currently `await`; `Codex-ev3k` decides |
| `waitUntil(cache.invalidate(...))` without `.catch(() => {})` | Unhandled rejection — surfaces as invocation failure in Workers runtime | Always chain `.catch(() => {})` on the waitUntil payload |
| Catching all `transfers.create` errors as permanent → a pending/failed ledger row | Transient Stripe/network errors get buried and never retry | Check `err instanceof Stripe.errors.StripeConnectionError` → re-throw (Stripe webhook retry handles it); only invalid-request errors → pending |
| Reading Stripe metadata without Zod validation (raw `metadata.codex_user_id`) | Not inside `procedure()` pipeline — no validation happened | Define a `*MetadataSchema` in `@codex/validation` and `safeParse` at the top of the webhook handler |
| Bypassing metadata validation | Could be tampered with | `schema.parse(session.metadata)` every time |
| Webhook handler reading `stripeObject.metadata.*` directly after the service already validated it | Dual source of truth — handler layer sees unvalidated data, service sees Zod-validated data; `userId` used for cache key could differ across layers | Service returns `WebhookHandlerResult { userId, organizationId }` populated from validated metadata OR DB fallback; handler uses ONLY the result for all side-effects (cache, email) |
| Permissive `userIdSchema` regex `/^[a-zA-Z0-9]+$/` applied to metadata that must tolerate test user IDs (`test-user-...`) | Breaks tests against seeded users; or forces test factories to abandon hyphens | Metadata schemas use a broader pattern `/^[a-zA-Z0-9_-]+$/` with a length bound — accepts both real BetterAuth IDs (alphanumeric) and test user IDs (hyphenated) |
| Building a service in a webhook/cron with only `{ db, environment }` | Fee configuration and emails silently skipped | Pass the registry's config (`feeConfig`, `mailer`, `webAppUrl`, …) |
| Destination charges / `application_fee_amount` for a split | They pay only ONE connected account | Separate charges and transfers: one `transfers.create` per slice with `source_transaction` |
| Creating Stripe Price then mutating | Prices are immutable | Create new Price + archive old |
| Deleting a tier with active subscribers | Orphans their subscription | Throw `TierHasSubscribersError` |
| Using `fetch` to call Stripe API | Loses retry/rate-limit handling | Use the SDK client |
| Same `apiVersion` hardcoded in multiple files | Inconsistent SDK pin | Centralise in `stripe-client.ts` |
| Chain of `error instanceof Error && 'type' in error && error.type === 'StripeFooError'` branches duplicating the detection rule | Detection logic drifts as branches are added; noisy type narrowing | Define one `isStripeError(error)` type guard, dispatch the message per `error.type` from a small map — one detection rule, many branches feeding off it |

---

## 14. Debugging Stripe Issues

1. **Webhook returning 401** — signature verification failed. Check: raw body not mutated; correct secret; system clock not skewed.
2. **Webhook returning 400** — missing `stripe-signature` header. Event hitting wrong endpoint (e.g. payment event at `/webhooks/stripe/subscription`).
3. **Duplicate purchases** — check unique constraint exists on `stripePaymentIntentId`. Check `completePurchase` returns existing on conflict rather than throwing.
4. **Transfer failing** — Connect account not ready. Check `chargesEnabled && payoutsEnabled`. Pending payout should accumulate.
5. **Pending payouts never resolving** — `account.updated` handler not detecting transition. Check `handleAccountUpdated` fires `resolvePendingPayouts` only when `wasActive=false → isActive=true` — and that the account is not being skipped for lacking `codex_organization_id` metadata (per-user accounts never carry it; `Codex-2hxff.13`). Production also needs the connect endpoint to be a **connected-accounts** endpoint.
6. **Stripe CLI events not arriving** — `stripe listen` still running? Forwarding URL correct? Worker listening on that port?
7. **Amount seems wrong by 100x** — someone converted pence to pounds. Pence is the correct unit for Stripe.
8. **Subscription stuck in `incomplete`** — initial payment failed. User needs to complete payment via Stripe's hosted URL.

---

## When to Re-Verify This Reference

The behaviour spec is [docs/payments/](../../../../docs/payments/README.md); this file holds coding patterns only. Re-read this doc against current code if you see changes in:

- `packages/purchase/src/stripe-client.ts` (Stripe SDK version or client shape)
- `packages/subscription/src/services/subscription-service.ts` (revenue splits)
- `packages/subscription/src/services/revenue-split.ts` (fee percentages)
- `workers/ecom-api/src/middleware/verify-signature.ts` (secret routing)
- `workers/ecom-api/src/handlers/*.ts` (webhook logic)
- `packages/constants/src/commerce.ts` (`FEES`, `CURRENCY`, `STRIPE_EVENTS`)

Revenue split percentages (`FEES.PLATFORM_PERCENT`, `FEES.SUBSCRIPTION_ORG_PERCENT`)
can change via commercial decisions. Always read the constants, don't hardcode.
