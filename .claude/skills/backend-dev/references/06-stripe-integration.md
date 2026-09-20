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

Codex operates a **marketplace with multi-party payments**:

- **Platform** (Codex Ltd) — collects 10% platform fee on everything
- **Organizations** — 15% of subscription revenue (post-platform fee)
- **Creators** — 85% of subscription pool, distributed by per-creator agreement within org

One-time purchases have a simpler split (10% platform / 90% creator) because there's
no org entity taking a cut — one-time content is authored by a single creator.

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

The flow for buying a single piece of content (e.g. a course, a download):

```
1. Client → POST /checkout/create { contentId, successUrl, cancelUrl }
2. Worker creates Stripe Checkout session with metadata { customerId, contentId, organizationId, contentTitle }
3. Worker returns sessionUrl
4. Client redirects to Stripe-hosted checkout
5. User completes payment at Stripe
6. Stripe fires checkout.session.completed webhook → /webhooks/stripe/booking
7. Worker verifies signature, extracts metadata, calls PurchaseService.completePurchase()
8. Transactional write: purchases + contentAccess rows
9. Cache invalidation (COLLECTION_USER_LIBRARY) + receipt email (both via waitUntil)
10. Client hits successUrl (typically a /checkout/success page)
```

### Route: `POST /checkout/create`

```typescript
checkout.post('/create',
  procedure({
    policy: { auth: 'required', rateLimit: 'strict' },
    input: { body: createCheckoutSchema },
    handler: async (ctx) => {
      const session = await ctx.services.purchase.createCheckoutSession(
        ctx.input.body,
        ctx.user.id,
      );
      return { sessionUrl: session.sessionUrl, sessionId: session.sessionId };
    },
  })
);
```

Note `rateLimit: 'strict'` — payment endpoints are always strict (20/min).

### Service: `createCheckoutSession`

The service:
1. Loads content; enforces `status === 'published'` and `priceCents > 0`
2. Checks user hasn't already purchased it (via `contentAccess` table)
3. **Looks up the user's email from the `users` table** and passes it as
   `customer_email` on the Stripe session (see "Always forward customer_email"
   below)
4. Creates Stripe Checkout session with:
   - `mode: 'payment'` (not 'subscription')
   - `line_items` with the content's price
   - `metadata`: `{ customerId, contentId, organizationId, contentTitle }`
   - `success_url`, `cancel_url` from the caller
   - `customer_email` (conditional spread, only when the user row has one)
5. Returns session URL + ID

The `metadata` is what links the Stripe object back to our domain. Every webhook
handler starts by extracting and validating metadata.

### Always forward `customer_email`

When creating a Checkout Session for a user whose email we already know
(i.e. `createCheckoutSession` accepts `userId` and can look it up), pass
`customer_email` to `stripe.checkout.sessions.create`:

```typescript
const [user] = await this.db
  .select({ email: users.email })
  .from(users)
  .where(eq(users.id, userId))
  .limit(1);

const session = await this.stripe.checkout.sessions.create({
  mode: 'payment',
  // ...
  success_url,
  cancel_url,
  ...(user?.email && { customer_email: user.email }),
  metadata: { /* ... */ },
});
```

Two wins:
- **UX**: Stripe pre-fills the email field on the hosted checkout page so the
  user doesn't retype it — shaving a friction point at the highest-intent
  moment.
- **Customer dedup**: Stripe reuses its existing Customer object keyed by
  email across sessions. Without `customer_email`, Stripe creates a fresh
  Customer each time, and your user ends up mapped to N Customer records.
  That makes lifetime-value queries, refund histories, and Portal session
  continuity unnecessarily painful.

The subscription-mode path has done this since BUG-022. The purchase-mode path
was brought into line in commit c24ef625. Do this for any NEW checkout flow.

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

### Pending-status dedup across Stripe flows

Any "have they already got this?" check that spans the Stripe redirect window
(e.g. library deduplication across purchased / subscribed / membership arms,
upsell eligibility, access grant queries) MUST cover `status IN ('completed',
'pending')` — not `'completed'` alone.

The purchase row is inserted with `status: 'pending'` the moment the checkout
session is created, and flipped to `'completed'` only when the webhook lands.
Between those two moments — seconds in dev, tens of seconds in production —
a `status='completed'` dedup lets the same content surface under two
classifications with conflicting accessType tags, which then get persisted by
the client's localStorage layer.

Reference: `querySubscription` and `queryMembership` in
`ContentAccessService.listUserLibrary` — fix landed in commit 771e4303.

### Service: `completePurchase` (called from webhook)

```typescript
// Pseudo-code of the transactional pattern
return this.db.transaction(async (tx) => {
  // Idempotency: check if already completed
  const existing = await tx.query.purchases.findFirst({
    where: eq(purchases.stripePaymentIntentId, paymentIntentId),
  });
  if (existing) return existing;  // Return, don't throw — duplicate webhook is fine

  // Compute revenue split
  const split = calculateRevenueSplit(amountCents, FEES.PLATFORM_PERCENT, 0);

  // Insert purchase
  const [purchase] = await tx.insert(purchases).values({
    stripePaymentIntentId: paymentIntentId,
    userId,
    contentId,
    organizationId,
    amountPaidCents: amountCents,
    platformFeeCents: split.platformFeeCents,
    creatorPayoutCents: split.creatorPayoutCents,
    status: 'completed',
  }).returning();

  // Grant content access
  await tx.insert(contentAccess).values({
    userId,
    contentId,
    accessType: 'purchased',
    purchaseId: purchase.id,
  });

  return purchase;
});
```

**Idempotency:** `stripePaymentIntentId` has a unique constraint. Duplicate webhook
processing returns the existing row without re-inserting. Transaction safety means
concurrent webhooks don't double-insert.

### Fee reconciliation (observability gate)

After computing the split, fetch Stripe's actual `application_fee_amount` from
the PaymentIntent and compare. If they drift, log a warning — it's either a
config mismatch (our `FEES.PLATFORM_PERCENT` differs from the Checkout session's
`application_fee_percent`) or a rounding edge case. The purchase still completes,
but you want to know about the drift:

```typescript
const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
const stripeFee = paymentIntent.application_fee_amount ?? null;

if (stripeFee !== null && stripeFee !== split.platformFeeCents) {
  obs?.warn('Stripe application fee diverged from calculated split', {
    paymentIntentId,
    calculated: split.platformFeeCents,
    stripeCollected: stripeFee,
    delta: stripeFee - split.platformFeeCents,
  });
}
```

This won't block a successful purchase. It surfaces a configuration/code-drift
bug early rather than making you reconcile mismatched ledgers months later.

---

## 4. Subscription Flow

Subscriptions are recurring tier-based billing on an org:

- Each org has N tiers (Bronze, Silver, Gold, etc.)
- Each tier has TWO Stripe Prices: monthly + annual
- User subscribes via Stripe Checkout
- Stripe fires `invoice.payment_succeeded` monthly/annually
- Our webhook handler executes transfers to org + creator Connect accounts

### Tier management

```typescript
// packages/subscription/src/services/tier-service.ts
async createTier(orgId, input) {
  // 1. Create Stripe Product for the tier
  const product = await this.stripe.products.create({
    name: `${input.name} (${org.name})`,
    metadata: { codex_organization_id: orgId, codex_tier_id: localId },
  });

  // 2. Create TWO Prices — monthly and annual
  const [monthly, annual] = await Promise.all([
    this.stripe.prices.create({
      product: product.id,
      unit_amount: input.priceMonthly,
      currency: 'gbp',
      recurring: { interval: 'month' },
    }),
    this.stripe.prices.create({
      product: product.id,
      unit_amount: input.priceAnnual,
      currency: 'gbp',
      recurring: { interval: 'year' },
    }),
  ]);

  // 3. Save locally with both price IDs
  await this.db.insert(subscriptionTiers).values({
    organizationId: orgId,
    name: input.name,
    stripeProductId: product.id,
    stripePriceMonthlyId: monthly.id,
    stripePriceAnnualId: annual.id,
    ...
  });
}
```

**Immutability:** Stripe Prices are immutable. Changing a tier's price creates new
Prices and archives the old ones. Old subscribers stay on their grandfathered prices
unless you migrate them explicitly.

**Soft delete only:** You cannot delete a tier with active subscribers. Throw
`TierHasSubscribersError` to enforce this.

### Subscription checkout

```
1. Client → POST /subscriptions/checkout { tierId, interval: 'month' | 'year' }
2. Worker verifies org's Connect account is ready (chargesEnabled && payoutsEnabled)
3. Worker creates Stripe Checkout session with:
   - mode: 'subscription'
   - line_items with the tier's matching Price ID
   - metadata { codex_user_id, codex_organization_id }
4. User completes checkout
5. Stripe fires checkout.session.completed → handleSubscriptionCreated
6. Worker inserts subscription + organizationMembership (status: 'active')
7. Cache invalidation + welcome email
```

### Subscription states

| State | Meaning |
|-------|---------|
| `active` | Billing current, user has access |
| `past_due` | Last invoice failed, retry scheduled |
| `cancelling` | Scheduled to cancel at period end |
| `cancelled` | Fully cancelled, no access |
| `incomplete` | Initial payment failed |

Transitions are webhook-driven. Never change state from a route handler — always
through `handleSubscriptionUpdated` or `handleSubscriptionDeleted`.

### Revenue splits on `invoice.payment_succeeded`

This is the most complex webhook handler. It runs every time a subscription renews:

```typescript
// Pseudo-code
async function handleInvoicePaymentSucceeded(invoice, stripe, c) {
  // 1. Find our subscription by Stripe ID
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, invoice.subscription),
  });

  // 2. Update period dates
  await db.update(subscriptions).set({
    currentPeriodStart: new Date(invoice.period_start * 1000),
    currentPeriodEnd: new Date(invoice.period_end * 1000),
    lastPaymentAt: new Date(),
  }).where(...);

  // 3. Calculate split
  const split = calculateRevenueSplit(
    invoice.amount_paid,
    FEES.PLATFORM_PERCENT,        // 1000 bps = 10%
    FEES.SUBSCRIPTION_ORG_PERCENT, // 1500 bps = 15% of post-platform
  );

  // 4. Transfer org fee to org's Connect account
  try {
    await stripe.transfers.create({
      amount: split.organizationFeeCents,
      currency: 'gbp',
      destination: orgConnectAccountId,
      transfer_group: `sub_${subscription.id}`,
      metadata: { subscription_id: subscription.id, type: 'organization_fee' },
    }, {
      // Stripe SDK v19+: invoice.charge is deprecated — extract from payments
      idempotencyKey: `${chargeId}_org_fee`, // chargeId = invoice.payments?.data?.[0]?.payment?.charge
    });
  } catch (err) {
    // If org Connect not ready, accumulate in pendingPayouts for later
    await accumulatePendingPayout(subscription, split.organizationFeeCents, 'org', err);
  }

  // 5. Transfer to each creator per their agreement percentage
  for (const agreement of creatorAgreements) {
    const creatorShare = Math.floor(split.creatorPayoutCents * agreement.organizationFeePercentage / 10000);
    try {
      await stripe.transfers.create({
        amount: creatorShare,
        currency: 'gbp',
        destination: agreement.stripeConnectAccountId,
        transfer_group: `sub_${subscription.id}`,
        metadata: { subscription_id: subscription.id, type: 'creator_payout' },
      }, {
        idempotencyKey: `${chargeId}_creator_payout_${agreement.creatorId}`,
      });
    } catch (err) {
      await accumulatePendingPayout(subscription, creatorShare, 'creator', err);
    }
  }

  // 6. Fire renewal email (not for first payment — checkout handler sends welcome)
  if (invoice.billing_reason === 'subscription_cycle') {
    sendEmailToWorker(c.env, c.executionCtx, {
      to: user.email,
      templateName: 'subscription-renewed',
      ...
    });
  }
}
```

**Critical patterns:**

- **Stripe idempotency keys** (`idempotencyKey: '${chargeId}_org_fee'`) — replayed webhooks don't double-transfer. Stripe returns the original transfer.
- **Pending payouts** — if Connect account isn't ready when the invoice settles, accumulate in `pendingPayouts` table. When `account.updated` webhook later reports the account active, `resolvePendingPayouts()` fires the deferred transfers.
- **`transfer_group`** — all transfers for one subscription period share `sub_${id}` — lets you trace them together in Stripe dashboards.

---

## 5. Stripe Connect

Creators need Connect accounts to receive payouts. Codex uses the newer **Controller**
configuration (Express-equivalent):

```typescript
await stripe.accounts.create({
  controller: {
    stripe_dashboard: { type: 'express' },
    fees: { payer: 'application' },      // Codex collects fees
    losses: { payments: 'application' },  // Codex covers chargebacks
    requirement_collection: 'stripe',
  },
  capabilities: {
    card_payments: { requested: true },
    transfers: { requested: true },
  },
  country: 'GB',
  metadata: {
    codex_organization_id: orgId,
    codex_user_id: userId,
  },
});
```

One Connect account per (user × org). Stored in `stripeConnectAccounts` with unique
constraint on `(organizationId, userId)`.

### Onboarding flow

```
1. User clicks "Set up payouts" → POST /connect/onboard
2. Worker creates Connect account (if not exists)
3. Worker generates Account Link → stripe.accountLinks.create()
4. Client redirects to link.url (Stripe-hosted onboarding)
5. User completes identity verification, tax info, bank details
6. Stripe fires account.updated → handleAccountUpdated
7. Worker checks chargesEnabled && payoutsEnabled
8. If transitioning to active, fire resolvePendingPayouts (waitUntil)
```

### Dashboard link

```typescript
connect.post('/dashboard',
  procedure({
    policy: { auth: 'required', rateLimit: 'api' },
    handler: async (ctx) => {
      const link = await ctx.services.connect.generateDashboardLink(ctx.user.id);
      return { url: link.url };
    },
  })
);
```

Account Links are short-lived (few minutes). Always generate fresh on click.

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
| `/webhooks/stripe/customer` | Customer events (stub) | `STRIPE_WEBHOOK_SECRET_CUSTOMER` |
| `/webhooks/stripe/dispute` | Disputes / fraud (stub) | `STRIPE_WEBHOOK_SECRET_DISPUTE` |
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
  if (!secret) return c.json({ error: 'Secret not configured' }, 500);

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

  // 3. Per-request DB client (webhooks don't go through procedure())
  const { db, cleanup } = createPerRequestDbClient(c.env);
  try {
    const service = new PurchaseService({ db, environment: c.env.ENVIRONMENT }, stripe);
    const purchase = await service.completePurchase(paymentIntentId, { ... });

    // 4. Fire-and-forget side effects
    if (c.env.CACHE_KV) {
      const cache = new VersionedCache({ kv: c.env.CACHE_KV });
      c.executionCtx.waitUntil(
        cache.invalidate(CacheType.COLLECTION_USER_LIBRARY(meta.customerId)).catch(() => {})
      );
    }
    sendEmailToWorker(c.env, c.executionCtx, { ... });

  } finally {
    c.executionCtx.waitUntil(cleanup());
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
  - ServiceError subclasses you've thrown intentionally

Transient (return 500, Stripe retries with backoff):
  - DB connection errors
  - Network errors
  - Any error you didn't catch
```

The `isTransientError()` helper at `workers/ecom-api/src/utils/error-classification.ts`
codifies this. Default behavior: return 200 `{ received: true }` to prevent retries.
Only return 500 when you want Stripe to retry.

---

## 8. Idempotency Guarantees

Stripe retries webhooks for up to ~24 hours on 5xx responses. Codex defends against
duplicate processing at four layers:

| Layer | Mechanism |
|-------|-----------|
| DB unique constraint | `purchases.stripePaymentIntentId`, `subscriptions.stripeSubscriptionId` |
| Stripe idempotency key | On `stripe.transfers.create(...)` — replay returns same transfer |
| Check-before-insert | `completePurchase` returns existing row if found |
| Transaction safety | Concurrent duplicate webhooks serialize at DB |

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
The `contentAccess` row from the first purchase was soft-deleted on refund.
Re-granting access needs to revive that row, not create a duplicate that then
conflicts with the unique constraint.

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
| Checkout session (purchase) | `contentTitle` | Display string for emails |
| Subscription | `codex_user_id` | User UUID |
| Subscription | `codex_organization_id` | Org UUID |
| Connect account | `codex_organization_id` | Org UUID |
| Connect account | `codex_user_id` | Owner user UUID |
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

The CLI prints a secret (`whsec_...`). Set all four `STRIPE_WEBHOOK_SECRET_*` env
vars to that same secret in `.dev.vars` — the CLI only generates one.

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

1. **Design the domain** — what's the Stripe object (session, subscription, etc)? What metadata do you need?
2. **Add the Zod schema** — `packages/validation/src/schemas/purchase.ts` (or a new file)
3. **Add the service method** — `packages/purchase/src/services/` or a new subdomain
4. **Add the route** — `workers/ecom-api/src/routes/` with `rateLimit: 'strict'` and `auth: 'required'`
5. **Handle the webhook** — `workers/ecom-api/src/handlers/` with signature verification
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
| `throw` in webhook handler without intent | Stripe retries for 24h | Return 200 for permanent errors, 500 only for transient |
| Hardcoded USD currency | Codex is GBP | Use `CURRENCY.GBP` from constants |
| Writing to DB in checkout route handler | Racy — webhook may arrive before response | Defer writes to webhook handler |
| Synchronous cache invalidation (no `waitUntil`) | Blocks response | `executionCtx.waitUntil(cache.invalidate(...).catch(...))` |
| `await cleanup()` in webhook `finally` block | Blocks the 200 response on Neon WS teardown (50–200ms latency added) | `c.executionCtx.waitUntil(cleanup())` |
| `waitUntil(cache.invalidate(...))` without `.catch(() => {})` | Unhandled rejection — surfaces as invocation failure in Workers runtime | Always chain `.catch(() => {})` on the waitUntil payload |
| Catching all `transfers.create` errors as permanent → `pendingPayouts` | Transient Stripe/network errors get buried and never retry | Check `err instanceof Stripe.errors.StripeConnectionError` → re-throw (Stripe webhook retry handles it); only invalid-request errors → pending |
| Reading Stripe metadata without Zod validation (raw `metadata.codex_user_id`) | Not inside `procedure()` pipeline — no validation happened | Define a `*MetadataSchema` in `@codex/validation` and `safeParse` at the top of the webhook handler |
| Bypassing metadata validation | Could be tampered with | `schema.parse(session.metadata)` every time |
| Webhook handler reading `stripeObject.metadata.*` directly after the service already validated it | Dual source of truth — handler layer sees unvalidated data, service sees Zod-validated data; `userId` used for cache key could differ across layers | Service returns `WebhookHandlerResult { userId, organizationId }` populated from validated metadata OR DB fallback; handler uses ONLY the result for all side-effects (cache, email) |
| Permissive `userIdSchema` regex `/^[a-zA-Z0-9]+$/` applied to metadata that must tolerate test user IDs (`test-user-...`) | Breaks tests against seeded users; or forces test factories to abandon hyphens | Metadata schemas use a broader pattern `/^[a-zA-Z0-9_-]+$/` with a length bound — accepts both real BetterAuth IDs (alphanumeric) and test user IDs (hyphenated) |
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
5. **Pending payouts never resolving** — `account.updated` handler not detecting transition. Check `handleAccountUpdated` fires `resolvePendingPayouts` only when `wasActive=false → isActive=true`.
6. **Stripe CLI events not arriving** — `stripe listen` still running? Forwarding URL correct? Worker listening on that port?
7. **Amount seems wrong by 100x** — someone converted pence to pounds. Pence is the correct unit for Stripe.
8. **Subscription stuck in `incomplete`** — initial payment failed. User needs to complete payment via Stripe's hosted URL.

---

## When to Re-Verify This Reference

Re-read this doc against current code if you see changes in:

- `packages/purchase/src/stripe-client.ts` (Stripe SDK version or client shape)
- `packages/subscription/src/services/subscription-service.ts` (revenue splits)
- `packages/subscription/src/services/revenue-split.ts` (fee percentages)
- `workers/ecom-api/src/middleware/verify-signature.ts` (secret routing)
- `workers/ecom-api/src/handlers/*.ts` (webhook logic)
- `packages/constants/src/commerce.ts` (`FEES`, `CURRENCY`, `STRIPE_EVENTS`)

Revenue split percentages (`FEES.PLATFORM_PERCENT`, `FEES.SUBSCRIPTION_ORG_PERCENT`)
can change via commercial decisions. Always read the constants, don't hardcode.
