# Org Subscriptions: Phase 1 Technical Design

**Version**: 1.0
**Date**: 2026-04-05
**Status**: Approved
**Prerequisite Docs**: [PRD](./pdr-phase-1.md), [Stripe API Reference](../../../docs/stripe-connect-subscription-reference.md)

---

## 1. Database Schema

### 1.1 New Table: `subscription_tiers`

File: `packages/database/src/schema/ecommerce.ts`

```sql
CREATE TABLE subscription_tiers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                VARCHAR(100) NOT NULL,
  description         TEXT,
  sort_order          INTEGER NOT NULL,
  price_monthly       INTEGER NOT NULL,
  price_annual        INTEGER NOT NULL,
  stripe_product_id   VARCHAR(255),
  stripe_price_monthly VARCHAR(255),
  stripe_price_annual VARCHAR(255),
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,

  CONSTRAINT check_price_monthly_positive CHECK (price_monthly >= 0),
  CONSTRAINT check_price_annual_positive CHECK (price_annual >= 0),
  CONSTRAINT check_sort_order_positive CHECK (sort_order > 0)
);

CREATE UNIQUE INDEX idx_subscription_tiers_org_sort
  ON subscription_tiers (organization_id, sort_order)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_subscription_tiers_org_id ON subscription_tiers (organization_id);
CREATE INDEX idx_subscription_tiers_org_active ON subscription_tiers (organization_id, is_active)
  WHERE deleted_at IS NULL;
```

### 1.2 New Table: `subscriptions`

```sql
CREATE TABLE subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tier_id                  UUID NOT NULL REFERENCES subscription_tiers(id) ON DELETE RESTRICT,
  stripe_subscription_id   VARCHAR(255) NOT NULL UNIQUE,
  stripe_customer_id       VARCHAR(255) NOT NULL,
  status                   VARCHAR(50) NOT NULL,
  billing_interval         VARCHAR(10) NOT NULL,
  current_period_start     TIMESTAMPTZ NOT NULL,
  current_period_end       TIMESTAMPTZ NOT NULL,
  cancelled_at             TIMESTAMPTZ,
  cancel_reason            TEXT,
  amount_cents             INTEGER NOT NULL,
  platform_fee_cents       INTEGER NOT NULL DEFAULT 0,
  organization_fee_cents   INTEGER NOT NULL DEFAULT 0,
  creator_payout_cents     INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT check_subscription_status
    CHECK (status IN ('active', 'past_due', 'cancelling', 'cancelled', 'incomplete')),
  CONSTRAINT check_billing_interval
    CHECK (billing_interval IN ('month', 'year')),
  CONSTRAINT check_amount_positive CHECK (amount_cents >= 0),
  CONSTRAINT check_revenue_split
    CHECK (amount_cents = platform_fee_cents + organization_fee_cents + creator_payout_cents)
);

CREATE UNIQUE INDEX idx_subscriptions_user_org_active
  ON subscriptions (user_id, organization_id)
  WHERE status NOT IN ('cancelled');

CREATE INDEX idx_subscriptions_user_id ON subscriptions (user_id);
CREATE INDEX idx_subscriptions_org_id ON subscriptions (organization_id);
CREATE INDEX idx_subscriptions_tier_id ON subscriptions (tier_id);
CREATE INDEX idx_subscriptions_stripe_id ON subscriptions (stripe_subscription_id);
CREATE INDEX idx_subscriptions_status ON subscriptions (organization_id, status);
```

### 1.3 New Table: `stripe_connect_accounts`

```sql
CREATE TABLE stripe_connect_accounts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  user_id                  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_account_id        VARCHAR(255) NOT NULL UNIQUE,
  status                   VARCHAR(50) NOT NULL,
  charges_enabled          BOOLEAN NOT NULL DEFAULT false,
  payouts_enabled          BOOLEAN NOT NULL DEFAULT false,
  onboarding_completed_at  TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT check_connect_status
    CHECK (status IN ('onboarding', 'active', 'restricted', 'disabled'))
);

CREATE INDEX idx_stripe_connect_org ON stripe_connect_accounts (organization_id);
CREATE INDEX idx_stripe_connect_stripe_id ON stripe_connect_accounts (stripe_account_id);
```

### 1.4 Modified Table: `content`

```sql
ALTER TABLE content
  ADD COLUMN minimum_tier_id UUID REFERENCES subscription_tiers(id) ON DELETE SET NULL;

CREATE INDEX idx_content_minimum_tier ON content (minimum_tier_id)
  WHERE minimum_tier_id IS NOT NULL;
```

### 1.5 Modified Table: `feature_settings`

```sql
ALTER TABLE feature_settings
  ADD COLUMN enable_subscriptions BOOLEAN NOT NULL DEFAULT false;
```

---

## 2. New Package: `@codex/subscription`

Location: `packages/subscription/`

### 2.1 Package Structure

```
packages/subscription/
  package.json            "@codex/subscription"
  tsconfig.json
  CLAUDE.md
  src/
    index.ts              barrel exports
    errors.ts             TierNotFoundError, SubscriptionNotFoundError, etc.
    types.ts              SubscriptionTier, Subscription, ConnectAccount types
    services/
      tier-service.ts
      subscription-service.ts
      connect-account-service.ts
```

Dependencies: `@codex/database`, `@codex/service-errors`, `@codex/validation`, `stripe`

### 2.2 TierService

Extends `BaseService`. Constructor takes `ServiceConfig` + `Stripe` client.

| Method | Signature | Notes |
|---|---|---|
| `createTier` | `(orgId: string, input: CreateTierInput) => Promise<SubscriptionTier>` | Validates Connect account active. Creates Stripe Product + Prices. DB insert in transaction. |
| `updateTier` | `(tierId: string, orgId: string, input: UpdateTierInput) => Promise<SubscriptionTier>` | New Stripe Prices if amount changes (Prices are immutable). Archives old Prices. |
| `deleteTier` | `(tierId: string, orgId: string) => Promise<void>` | Soft delete. Throws `BusinessLogicError` if active subscribers exist. Archives Stripe Product. |
| `listTiers` | `(orgId: string) => Promise<SubscriptionTier[]>` | Ordered by sortOrder ASC. Filters `deletedAt IS NULL` and `isActive = true` for public. |
| `listAllTiers` | `(orgId: string) => Promise<SubscriptionTier[]>` | Admin view: includes inactive tiers. Still filters soft deleted. |
| `reorderTiers` | `(orgId: string, tierIds: string[]) => Promise<void>` | Validates all IDs belong to org. Updates sortOrder in transaction. |

**Security**: All methods scope by `orgId`. `createTier`/`updateTier`/`deleteTier`/`reorderTiers` require org management permission. `listTiers` is public (no auth required).

**Stripe sync**: On create, call `stripe.products.create()` then `stripe.prices.create()` x2 (monthly + annual). Store IDs on tier record. On price change, create new Prices and update record (old Prices are archived via `stripe.prices.update({ active: false })`).

### 2.3 SubscriptionService

Extends `BaseService`. Constructor takes `ServiceConfig` + `Stripe` client.

| Method | Signature | Notes |
|---|---|---|
| `createCheckoutSession` | `(userId, orgId, tierId, billingInterval, successUrl, cancelUrl) => Promise<{sessionUrl, sessionId}>` | Validates tier exists + active, Connect account active, user not already subscribed. Creates Stripe Checkout Session in subscription mode. |
| `handleSubscriptionCreated` | `(stripeSubscription: Stripe.Subscription) => Promise<void>` | **Webhook handler**. Idempotent via `stripeSubscriptionId` unique constraint. Inserts `subscriptions` row. Revenue split calculated and stored. |
| `handleInvoicePaymentSucceeded` | `(stripeInvoice: Stripe.Invoice) => Promise<void>` | **Webhook handler**. Extends `currentPeriodEnd`. Creates transfers to org + creator via `stripe.transfers.create()` with `source_transaction`. |
| `handleSubscriptionUpdated` | `(stripeSubscription: Stripe.Subscription) => Promise<void>` | **Webhook handler**. Detects tier/price changes. Updates `tierId`, `billingInterval`, `amountCents`. |
| `handleSubscriptionDeleted` | `(stripeSubscription: Stripe.Subscription) => Promise<void>` | **Webhook handler**. Sets status to 'cancelled', sets `cancelledAt`. |
| `changeTier` | `(userId, orgId, newTierId, billingInterval) => Promise<void>` | Calls `stripe.subscriptions.update()` with new price + `proration_behavior: 'create_prorations'`. |
| `cancelSubscription` | `(userId, orgId, reason?) => Promise<void>` | Calls `stripe.subscriptions.update({ cancel_at_period_end: true })`. Sets status to 'cancelling'. |
| `reactivateSubscription` | `(userId, orgId) => Promise<void>` | Reverses cancel_at_period_end if still in active period. |
| `getSubscription` | `(userId, orgId) => Promise<Subscription \| null>` | Returns current subscription with tier details. |
| `getUserSubscriptions` | `(userId) => Promise<SubscriptionWithOrg[]>` | All active/cancelling subscriptions with org info. |
| `listSubscribers` | `(orgId, filters) => Promise<PaginatedResult<Subscriber>>` | Admin: paginated subscriber list with tier/status filters. |
| `getSubscriptionStats` | `(orgId) => Promise<SubscriptionStats>` | Total/active subscribers, MRR, per-tier breakdown. |

**Idempotency**: Webhook handlers use `stripeSubscriptionId` unique constraint + check-before-insert pattern (same as `PurchaseService.completePurchase`).

**Revenue split (Phase 1 defaults)**:
- Platform: 10% of gross (1000 basis points)
- Organization: 15% of post-platform-fee amount (1500 basis points)
- Creator pool: 85% of post-platform-fee amount (remainder)

Reuses `calculateRevenueSplit()` from `@codex/purchase`. The org fee default changes from 0% (purchases) to 15% (subscriptions).

**Multi-creator split**: The creator pool is divided among org creators based on **fixed revenue share percentages** configured by the org owner per creator (stored in `creatorOrganizationAgreements`). If a single creator, they get the full pool. If multiple, each gets their configured %. Shares must sum to 100%.

**Phase 2**: Replace fixed % with view-proportional splitting (based on which creator's content subscribers actually watched).

**Creator Connect account requirements**:
- Creators MUST have an active Connect account to have content assigned to subscription tiers
- Setting `minimumTierId` on content validates the content's creator has `chargesEnabled = true`
- If a creator's Connect account becomes restricted/disabled after content is assigned, their share **accumulates** in the platform balance and is flagged in Studio dashboard as "pending payout — creator needs to reconnect Stripe"
- The org owner is NOT paid the creator's share as fallback — it is held until the creator resolves their account

**Transfer pattern**:
```typescript
// After invoice.payment_succeeded
const charge = invoice.charge as string;
const amount = invoice.amount_paid; // e.g., 1999 pence

// Step 1: Platform + org split
const platformFeeCents = Math.ceil(amount * 1000 / 10000);     // 10% = 200
const postPlatform = amount - platformFeeCents;                  // 1799
const orgFeeCents = Math.ceil(postPlatform * 1500 / 10000);     // 15% = 270
const creatorPoolCents = postPlatform - orgFeeCents;             // 1529

// Step 2: Transfer to org
await stripe.transfers.create({
  amount: orgFeeCents,
  currency: 'gbp',
  destination: orgConnectAccountId,
  source_transaction: charge,
  transfer_group: `sub_${subscriptionId}`,
  metadata: { subscription_id: subscriptionId, type: 'organization_fee' },
});

// Step 3: Split creator pool among creators by fixed %
// e.g., Creator A = 60%, Creator B = 40%
for (const creator of creatorShares) {
  const creatorAmount = Math.floor(creatorPoolCents * creator.sharePercent / 100);

  if (!creator.connectAccountReady) {
    // Accumulate — log pending payout, do NOT transfer
    await recordPendingPayout(subscriptionId, creator.id, creatorAmount);
    continue;
  }

  await stripe.transfers.create({
    amount: creatorAmount,
    currency: 'gbp',
    destination: creator.stripeAccountId,
    source_transaction: charge,
    transfer_group: `sub_${subscriptionId}`,
    metadata: { subscription_id: subscriptionId, creator_id: creator.id, type: 'creator_payout' },
  });
}

// Rounding remainder (1-2 pence) stays in platform balance
// Platform keeps platformFeeCents (200) automatically
```

**Solo creator case**: Org owner is both org and sole creator — receives 2 transfers to the same Connect account (org fee + creator payout). No special-casing in code.

### 2.4 ConnectAccountService

Extends `BaseService`. Constructor takes `ServiceConfig` + `Stripe` client.

| Method | Signature | Notes |
|---|---|---|
| `createAccount` | `(orgId, userId, returnUrl, refreshUrl) => Promise<{accountId, onboardingUrl}>` | Creates Express-equivalent account + Account Link. Stores in `stripe_connect_accounts`. |
| `getAccount` | `(orgId) => Promise<ConnectAccount \| null>` | Returns current status from DB. |
| `refreshOnboardingLink` | `(orgId, returnUrl, refreshUrl) => Promise<{onboardingUrl}>` | New Account Link for existing account (resume abandoned onboarding). |
| `handleAccountUpdated` | `(stripeAccount: Stripe.Account) => Promise<void>` | **Webhook handler**. Updates `chargesEnabled`, `payoutsEnabled`, `status`. |
| `createDashboardLink` | `(orgId) => Promise<{url}>` | Stripe Express dashboard login link. |
| `isReady` | `(orgId) => Promise<boolean>` | True if `chargesEnabled && payoutsEnabled`. |

---

## 3. Validation Schemas

File: `packages/validation/src/schemas/subscription.ts`

```typescript
// Tier schemas
export const createTierSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  priceMonthly: z.number().int().min(100),  // At least 100 pence (GBP 1.00)
  priceAnnual: z.number().int().min(100),
});

export const updateTierSchema = createTierSchema.partial();

export const reorderTiersSchema = z.object({
  tierIds: z.array(z.string().uuid()).min(1),
});

// Subscription checkout
export const createSubscriptionCheckoutSchema = z.object({
  tierId: z.string().uuid(),
  billingInterval: z.enum(['month', 'year']),
  successUrl: checkoutRedirectUrlSchema,
  cancelUrl: checkoutRedirectUrlSchema,
});

// Subscription management
export const changeTierSchema = z.object({
  newTierId: z.string().uuid(),
  billingInterval: z.enum(['month', 'year']),
});

export const cancelSubscriptionSchema = z.object({
  reason: z.string().max(500).optional(),
});

// Query schemas
export const listSubscribersQuerySchema = paginationSchema.extend({
  tierId: z.string().uuid().optional(),
  status: z.enum(['active', 'past_due', 'cancelling', 'cancelled']).optional(),
});

// Connect onboarding
export const connectOnboardSchema = z.object({
  returnUrl: z.string().url(),
  refreshUrl: z.string().url(),
});
```

Update `packages/validation/src/schemas/settings.ts`:
```typescript
export const DEFAULT_FEATURES = {
  enableSignups: true,
  enablePurchases: true,
  enableSubscriptions: false,  // NEW
};
```

Update content schema — add to `updateContentSchema`:
```typescript
minimumTierId: z.string().uuid().nullable().optional(),
```

---

## 4. API Endpoints

### 4.1 Tier Management (organization-api worker)

New file: `workers/organization-api/src/routes/tiers.ts`

| Method | Path | Policy | Input | Response |
|---|---|---|---|---|
| `POST` | `/organizations/:id/tiers` | `auth: 'required'`, `requireOrgManagement: true` | body: `createTierSchema` | 201: `{ data: SubscriptionTier }` |
| `GET` | `/organizations/:id/tiers` | `auth: 'optional'` | params: orgId | 200: `{ items: SubscriptionTier[] }` |
| `PATCH` | `/organizations/:id/tiers/:tierId` | `auth: 'required'`, `requireOrgManagement: true` | body: `updateTierSchema` | 200: `{ data: SubscriptionTier }` |
| `DELETE` | `/organizations/:id/tiers/:tierId` | `auth: 'required'`, `requireOrgManagement: true` | params | 204 |
| `POST` | `/organizations/:id/tiers/reorder` | `auth: 'required'`, `requireOrgManagement: true` | body: `reorderTiersSchema` | 204 |
| `GET` | `/organizations/:id/subscribers` | `auth: 'required'`, `requireOrgManagement: true` | query: `listSubscribersQuerySchema` | 200: `PaginatedResult<Subscriber>` |

### 4.2 Subscription Customer Endpoints (ecom-api worker)

New file: `workers/ecom-api/src/routes/subscriptions.ts`

| Method | Path | Policy | Input | Response |
|---|---|---|---|---|
| `POST` | `/subscriptions/checkout` | `auth: 'required'`, `rateLimit: 'auth'` | body: `createSubscriptionCheckoutSchema` | 201: `{ data: { sessionUrl, sessionId } }` |
| `GET` | `/subscriptions/current` | `auth: 'required'` | query: `{ organizationId }` | 200: `{ data: Subscription \| null }` |
| `GET` | `/subscriptions/mine` | `auth: 'required'` | — | 200: `{ items: SubscriptionWithOrg[] }` |
| `POST` | `/subscriptions/change-tier` | `auth: 'required'`, `rateLimit: 'auth'` | body: `changeTierSchema` + query: `{ organizationId }` | 200: `{ data: Subscription }` |
| `POST` | `/subscriptions/cancel` | `auth: 'required'` | body: `cancelSubscriptionSchema` + query: `{ organizationId }` | 200: `{ data: Subscription }` |
| `GET` | `/subscriptions/stats` | `auth: 'required'`, `requireOrgManagement: true` | query: `{ organizationId }` | 200: `{ data: SubscriptionStats }` |

### 4.3 Stripe Connect Endpoints (ecom-api worker)

New file: `workers/ecom-api/src/routes/connect.ts`

| Method | Path | Policy | Input | Response |
|---|---|---|---|---|
| `POST` | `/connect/onboard` | `auth: 'required'`, `requireOrgManagement: true` | body: `connectOnboardSchema` + query: `{ organizationId }` | 201: `{ data: { accountId, onboardingUrl } }` |
| `GET` | `/connect/status` | `auth: 'required'`, `requireOrgManagement: true` | query: `{ organizationId }` | 200: `{ data: ConnectAccountStatus }` |
| `POST` | `/connect/dashboard` | `auth: 'required'`, `requireOrgManagement: true` | query: `{ organizationId }` | 200: `{ data: { url } }` |

### 4.4 Webhook Handlers

Update: `workers/ecom-api/src/index.ts`

Wire handlers for existing routes:
- `/webhooks/stripe/subscription` → `handleSubscriptionWebhook` (new file: `handlers/subscription-webhook.ts`)
- `/webhooks/stripe/connect` → `handleConnectWebhook` (new file: `handlers/connect-webhook.ts`)

**Subscription webhook handler events**:
- `checkout.session.completed` (mode=subscription) → `subscriptionService.handleSubscriptionCreated()`
- `customer.subscription.updated` → `subscriptionService.handleSubscriptionUpdated()`
- `customer.subscription.deleted` → `subscriptionService.handleSubscriptionDeleted()`
- `invoice.payment_succeeded` (subscription invoice) → `subscriptionService.handleInvoicePaymentSucceeded()`
- `invoice.payment_failed` → log + update status to 'past_due'

**Connect webhook handler events**:
- `account.updated` → `connectAccountService.handleAccountUpdated()`

---

## 5. Access Control Updates

File: `packages/access/src/services/content-access-service.ts`

### 5.1 getStreamingUrl() — Add Subscription Check

Insert between purchase check and org membership check:

```typescript
// Step 3: Check subscription (NEW)
if (contentRecord.minimumTierId) {
  const subscription = await tx.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, userId),
      eq(subscriptions.organizationId, contentOrgId),
      inArray(subscriptions.status, ['active', 'cancelling']),
      gt(subscriptions.currentPeriodEnd, new Date()),
    ),
    with: { tier: true },
  });

  if (subscription) {
    const contentTier = await tx.query.subscriptionTiers.findFirst({
      where: eq(subscriptionTiers.id, contentRecord.minimumTierId),
    });

    if (contentTier && subscription.tier.sortOrder >= contentTier.sortOrder) {
      // Subscription grants access — proceed to generate streaming URL
      hasAccess = true;
    }
  }
}
```

### 5.2 listUserLibrary() — Add Subscription Source

Add third query source alongside purchased and membership content:

```typescript
// Query 3: SUBSCRIPTION content
if (accessType === 'all' || accessType === 'subscription') {
  const subscription = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, userId),
      eq(subscriptions.organizationId, orgId), // if org-scoped
      inArray(subscriptions.status, ['active', 'cancelling']),
      gt(subscriptions.currentPeriodEnd, new Date()),
    ),
    with: { tier: true },
  });

  if (subscription) {
    // Fetch all content where minimumTier.sortOrder <= subscription.tier.sortOrder
    const subscriptionContent = await db.query.content.findMany({
      where: and(
        isNotNull(content.minimumTierId),
        whereNotDeleted(content),
        eq(content.status, 'published'),
        // Join to check tier hierarchy
      ),
    });
  }
}
```

### 5.3 New Method: getAccessibleContentIds()

For "Free for me" explore filter:

```typescript
async getAccessibleContentIds(userId: string, orgId: string): Promise<string[]> {
  // Combine: purchased IDs + free content IDs + subscription-accessible IDs
  const [purchased, free, subscribed] = await Promise.all([
    this.getPurchasedContentIds(userId, orgId),
    this.getFreeContentIds(orgId),
    this.getSubscriptionAccessibleIds(userId, orgId),
  ]);
  return [...new Set([...purchased, ...free, ...subscribed])];
}
```

---

## 6. Frontend Routes

### 6.1 Studio Monetisation
- `apps/web/src/routes/_org/[slug]/studio/monetisation/+page.server.ts`
- `apps/web/src/routes/_org/[slug]/studio/monetisation/+page.svelte`

### 6.2 Org Pricing Page
- `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.server.ts`
- `apps/web/src/routes/_org/[slug]/(space)/pricing/+page.svelte`

### 6.3 Account Subscriptions
- `apps/web/src/routes/(platform)/account/subscriptions/+page.server.ts`
- `apps/web/src/routes/(platform)/account/subscriptions/+page.svelte`

### 6.4 Stripe Connect Return Pages
- `apps/web/src/routes/_org/[slug]/studio/monetisation/connect-return/+page.server.ts`
- `apps/web/src/routes/_org/[slug]/studio/monetisation/connect-return/+page.svelte`

---

## 7. Frontend Components

| Component | Path | Props |
|---|---|---|
| `TierCard` | `lib/components/subscription/TierCard.svelte` | `tier, billingPeriod, isCurrentPlan?, onSubscribe?, compact?` |
| `BillingToggle` | `lib/components/subscription/BillingToggle.svelte` | `value, onValueChange, savingsPercent?` |
| `PurchaseOrSubscribeModal` | `lib/components/subscription/PurchaseOrSubscribeModal.svelte` | `open, onOpenChange, content, orgTiers, userSubscription` |
| `SubscriptionBadge` | `lib/components/subscription/SubscriptionBadge.svelte` | `tierName` |
| `TierEditor` | `lib/components/studio/monetisation/TierEditor.svelte` | `tier?, orgId, onSave, onCancel` |
| `TierList` | `lib/components/studio/monetisation/TierList.svelte` | `tiers, onEdit, onDelete, onReorder` |
| `StripeConnectCard` | `lib/components/studio/monetisation/StripeConnectCard.svelte` | `status, onConnect` |

---

## 8. Security Checklist

| Requirement | Implementation |
|---|---|
| All tier queries scoped by orgId | `orgScopedNotDeleted(subscriptionTiers, orgId)` |
| All subscription queries scoped by userId | `eq(subscriptions.userId, userId)` in every query |
| Tier management requires org ownership | `procedure({ policy: { auth: 'required', requireOrgManagement: true } })` |
| Subscription checkout rate limited | `rateLimit: 'auth'` (5 req/15min) |
| Webhook signatures verified | Existing `verifyStripeSignature()` middleware with `STRIPE_WEBHOOK_SECRET_SUBSCRIPTION` |
| Revenue split immutable after creation | CHECK constraint on `subscriptions` table: `amount = platform + org + creator` |
| No PII in logs | Use `this.obs.info/warn/error` with IDs only, never email/name |
| Stripe secrets in env only | `c.env.STRIPE_SECRET_KEY`, never in code |
| Content access verified server-side | `ContentAccessService.getStreamingUrl()` is the single authority |
| Soft delete only | `deletedAt` column on `subscription_tiers`, never hard delete |
| Connect account scoped to org | UNIQUE constraint on `organizationId` in `stripe_connect_accounts` |

---

## 9. Error Types

New file: `packages/subscription/src/errors.ts`

```typescript
export class TierNotFoundError extends NotFoundError {
  constructor(tierId: string) {
    super(`Subscription tier not found: ${tierId}`, { tierId });
  }
}

export class SubscriptionNotFoundError extends NotFoundError {
  constructor(context: Record<string, unknown>) {
    super('Subscription not found', context);
  }
}

export class AlreadySubscribedError extends ConflictError {
  constructor(userId: string, orgId: string) {
    super('User already has an active subscription to this organization', { userId, orgId });
  }
}

export class ConnectAccountNotReadyError extends BusinessLogicError {
  constructor(orgId: string) {
    super('Stripe Connect account is not fully onboarded', { orgId });
  }
}

export class TierHasSubscribersError extends BusinessLogicError {
  constructor(tierId: string, subscriberCount: number) {
    super('Cannot delete tier with active subscribers', { tierId, subscriberCount });
  }
}

export class SubscriptionCheckoutError extends BusinessLogicError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, context);
  }
}
```

---

## 10. Implementation Sequence

| # | Task | Files | Depends On | Verification |
|---|---|---|---|---|
| 1 | Database schema + migration | `packages/database/src/schema/ecommerce.ts`, `settings.ts` | — | `pnpm db:generate && pnpm db:migrate && pnpm typecheck` |
| 2 | Validation schemas | `packages/validation/src/schemas/subscription.ts`, update `settings.ts`, `content.ts` | — | `pnpm typecheck` |
| 3 | Shared types + constants | `packages/shared-types/`, `packages/constants/` | — | `pnpm typecheck` |
| 4 | Feature settings update | `packages/platform-settings/` | 1, 2 | Toggle enableSubscriptions via API, verify read/write |
| 5 | `@codex/subscription` package: TierService | `packages/subscription/src/services/tier-service.ts` | 1, 2, 3 | Unit test: create/list/update/delete tier |
| 6 | `@codex/subscription` package: ConnectAccountService | `packages/subscription/src/services/connect-account-service.ts` | 1, 2, 3 | Unit test: create account, check status |
| 7 | `@codex/subscription` package: SubscriptionService | `packages/subscription/src/services/subscription-service.ts` | 1, 2, 3, 5, 6 | Unit test: checkout, webhook handlers, cancel, change tier |
| 8 | Tier API routes (organization-api) | `workers/organization-api/src/routes/tiers.ts` | 5 | `pnpm typecheck`, manual API test: CRUD tiers |
| 9 | Connect API routes (ecom-api) | `workers/ecom-api/src/routes/connect.ts` | 6 | `pnpm typecheck`, manual: onboard flow |
| 10 | Subscription API routes (ecom-api) | `workers/ecom-api/src/routes/subscriptions.ts` | 7 | `pnpm typecheck`, manual: checkout + webhook |
| 11 | Webhook handlers | `workers/ecom-api/src/handlers/` | 7, 10 | Manual: Stripe CLI webhook testing |
| 12 | Access control updates | `packages/access/src/services/content-access-service.ts` | 1, 7 | Manual: verify subscription grants streaming URL |
| 13 | Content update (minimumTierId) | `packages/content/`, `packages/validation/` | 1, 2, 5 | Manual: set tier on content, verify access |
| 14 | Frontend: types + API client + remote functions | `apps/web/src/lib/` | 8, 9, 10 | `pnpm typecheck` |
| 15 | Frontend: navigation updates | `apps/web/src/lib/config/navigation.ts`, sidebar | — | Visual: sidebar shows Monetisation |
| 16 | Frontend: Studio Monetisation page | `apps/web/src/routes/_org/[slug]/studio/monetisation/` | 14, 15 | Playwright: tier CRUD, Connect onboarding |
| 17 | Frontend: Org pricing page | `apps/web/src/routes/_org/[slug]/(space)/pricing/` | 14 | Playwright: tier display, subscribe CTA |
| 18 | Frontend: Content form tier selector | `apps/web/src/lib/components/studio/content-form/PublishSidebar.svelte` | 14 | Playwright: dropdown visible with tiers |
| 19 | Frontend: PurchaseOrSubscribeModal + access state | `apps/web/src/lib/components/subscription/`, `access-state.ts` | 14 | Playwright: modal on locked content |
| 20 | Frontend: Library badge + explore filter | `apps/web/src/lib/components/library/`, explore page | 14, 12 | Playwright: badge visible, "free for me" toggle |
| 21 | Frontend: Account subscriptions page | `apps/web/src/routes/(platform)/account/subscriptions/` | 14 | Playwright: subscription list |
| 22 | Code review + cleanup | All modified files | 1-21 | Duplicate code audit, pattern compliance |
| 23 | Final verification | All | 1-22 | Full end-to-end Playwright test: subscribe, access content, manage, cancel |
