# Stripe Connect Subscription System -- API Reference

> **Purpose**: Exhaustive API reference for building multi-party subscription payments on Codex.
> **Status**: Research document -- not implementation code.
> **Date**: 2026-04-05
> **Currency**: GBP (all amounts in pence)

---

## Table of Contents

1. [Business Model & Architecture Decision](#1-business-model--architecture-decision)
2. [Connect Account Types & Recommendation](#2-connect-account-types--recommendation)
3. [Account Onboarding Flow](#3-account-onboarding-flow)
4. [Products and Prices for Subscription Tiers](#4-products-and-prices-for-subscription-tiers)
5. [Subscription Checkout Session](#5-subscription-checkout-session)
6. [Multi-Party Splits on Recurring Payments](#6-multi-party-splits-on-recurring-payments)
7. [Webhook Events for Subscriptions](#7-webhook-events-for-subscriptions)
8. [Subscription Lifecycle Management](#8-subscription-lifecycle-management)
9. [Refunds and Transfer Reversals](#9-refunds-and-transfer-reversals)
10. [Customer Portal](#10-customer-portal)
11. [Idempotency and Error Handling](#11-idempotency-and-error-handling)
12. [Codex Integration Notes](#12-codex-integration-notes)

---

## 1. Business Model & Architecture Decision

### Three Parties Per Transaction

```
Customer subscribes to Org Tier (e.g., GBP 19.99/month)
  |
  v
+----------------------------------------------------------+
|  Stripe processes GBP 19.99 charge on PLATFORM account   |
+----------------------------------------------------------+
  |            |                    |
  v            v                    v
Platform    Organization          Creator
(10%)       (configurable %)      (remainder)
GBP 2.00    GBP 3.60             GBP 14.39
            (20% of post-fee)    (80% of post-fee)
```

### Why "Separate Charges and Transfers" is the ONLY viable approach

| Approach | 2-Party | 3-Party | Subscriptions | Verdict |
|---|---|---|---|---|
| **Direct Charges** | Yes | No | Yes | Charge lives on connected account. Only supports platform + 1 connected account. Cannot split to a second party (creator). |
| **Destination Charges** | Yes | No | Yes | `transfer_data.destination` accepts only ONE account. Platform keeps `application_fee_amount`. No way to route to a third party. |
| **Separate Charges & Transfers** | Yes | **YES** | Yes | Charge lives on platform. Platform creates multiple `stripe.transfers.create()` calls to different connected accounts. This is the ONLY approach that supports 3+ party splits. |

**Decision: Use Separate Charges and Transfers.**

The charge is created on the platform's Stripe account (via subscription invoices). After each `invoice.payment_succeeded` event, the platform creates two separate transfers:
1. Transfer to the Organization's connected account
2. Transfer to the Creator's connected account
3. Platform retains the remainder (its 10% fee)

### Stripe Fee Responsibility

With separate charges and transfers, Stripe processing fees (1.5% + 20p for UK cards) are deducted from the platform account balance. The platform must account for this when calculating its actual margin.

```
Customer pays: GBP 19.99
Stripe processing fee: ~GBP 0.50 (1.5% + 20p)
Net to platform balance: GBP 19.49
Platform fee (10% of gross): GBP 2.00
Transfer to Org: GBP 3.60
Transfer to Creator: GBP 14.39
Platform actual retention: GBP 2.00 - GBP 0.50 = GBP 1.50
```

> **Important**: `application_fee_percent` on subscriptions works with destination charges (2-party only). For 3-party, we CANNOT use `application_fee_percent` -- we must manually calculate and transfer after each invoice payment.

---

## 2. Connect Account Types & Recommendation

### Legacy Types vs Controller Properties

As of 2025, Stripe has deprecated the legacy Express/Standard/Custom type system in favour of **controller properties**. New integrations should use controller properties.

| Legacy Type | Controller Equivalent | Stripe Dashboard | Onboarding | Fee Payer |
|---|---|---|---|---|
| **Express** | `controller.stripe_dashboard.type: 'express'` | Express Dashboard (limited) | Stripe-hosted | `application` (platform pays processing) |
| **Standard** | `controller.stripe_dashboard.type: 'full'` | Full Dashboard | Stripe-hosted | `account` (connected account pays) |
| **Custom** | `controller.stripe_dashboard.type: 'none'` | No Dashboard | Platform-built or Stripe-hosted | `application` (platform pays processing) |

### Recommendation for Codex: Express-equivalent via Controller Properties

**Why Express-equivalent:**
- Stripe handles identity verification, tax forms, compliance -- minimal platform burden
- Connected accounts get a lightweight dashboard for payout visibility
- Stripe-hosted onboarding (Account Links) reduces integration surface
- Platform controls the fee structure

**Why NOT Standard:**
- Standard accounts have full Stripe Dashboard access -- they can create their own products, prices, subscriptions. This conflicts with Codex controlling the subscription model.
- Standard accounts pay their own Stripe fees, which complicates the revenue split math.

**Why NOT Custom:**
- Custom requires building your own onboarding UI for identity verification, bank account collection, etc. Significant compliance burden.
- Additional Stripe fees apply.

### Exact Account Creation Call

```typescript
const account = await stripe.accounts.create({
  // Controller properties (new approach, replaces type: 'express')
  controller: {
    stripe_dashboard: {
      type: 'express',  // Connected accounts get Express Dashboard
    },
    fees: {
      payer: 'application',  // Platform pays Stripe processing fees
    },
    losses: {
      payments: 'application',  // Platform liable for payment losses
    },
    requirement_collection: 'stripe',  // Stripe collects KYC requirements
  },

  // Capabilities to request
  capabilities: {
    card_payments: { requested: true },
    transfers: { requested: true },
  },

  // Account details
  country: 'GB',  // UK-based platform, can also be 'US', 'DE', etc.
  email: org.contactEmail,

  // Business profile
  business_profile: {
    name: org.name,
    url: `https://${org.slug}.codex.tv`,
    mcc: '5815',  // Digital goods
  },

  // Metadata for our records
  metadata: {
    codex_organization_id: org.id,
    codex_type: 'organization',  // vs 'creator' for individual creator accounts
  },
});
```

### Required Capabilities

| Capability | Purpose | Required |
|---|---|---|
| `card_payments` | Accept card payments | Yes |
| `transfers` | Receive transfers from platform | Yes |
| `tax_reporting_us_1099_k` | US tax reporting | Only if US connected accounts |
| `tax_reporting_us_1099_misc` | US tax reporting | Only if US connected accounts |

### Country Support

With `controller.fees.payer: 'application'`, cross-border transfers are supported between:
- United States
- Canada
- **United Kingdom** (our platform)
- EEA countries (EU + Norway, Iceland, Liechtenstein)
- Switzerland

Connected accounts outside these regions must be in the same country as the platform.

### Stripe Connect Pricing

| Fee Type | Amount | Notes |
|---|---|---|
| Standard processing | 1.5% + 20p (UK cards) | Charged to fee payer (platform with `application`) |
| European cards | 2.5% + 20p | Cross-border within EEA |
| International cards | 3.25% + 20p | Cards from outside EEA |
| Active account fee | Included | No separate per-account fee for Express-equivalent |
| Instant Payouts | 1% (min 50p) | Optional, if connected accounts want instant payouts |

> Ref: https://stripe.com/connect/pricing, https://stripe.com/pricing

---

## 3. Account Onboarding Flow

### Step 1: Create Account (already shown above)

Save the returned `account.id` (format: `acct_xxxxxxxxxxxx`) to the organization record in our database.

### Step 2: Create Account Link for Onboarding

```typescript
const accountLink = await stripe.accountLinks.create({
  account: account.id,  // acct_xxxxxxxxxxxx
  refresh_url: 'https://studio.codex.tv/settings/payments?refresh=true',
  return_url: 'https://studio.codex.tv/settings/payments?onboarding=complete',
  type: 'account_onboarding',
  // collection_options is optional -- controls what info to collect upfront
  collection_options: {
    fields: 'eventually_due',  // Collect all requirements upfront (recommended)
    // Alternative: 'currently_due' -- only collect minimum needed now
  },
});

// accountLink.url -> redirect org admin here
// accountLink.expires_at -> link expires (typically within minutes)
```

### Key Parameters

| Parameter | Value | Notes |
|---|---|---|
| `type` | `'account_onboarding'` | Full onboarding flow. Alternative: `'account_update'` for returning users |
| `refresh_url` | URL on your site | Where Stripe redirects if link expires or user needs to restart |
| `return_url` | URL on your site | Where Stripe redirects after user completes onboarding |
| `collection_options.fields` | `'eventually_due'` or `'currently_due'` | `eventually_due` = collect everything upfront (better UX). `currently_due` = minimum viable. |

### Step 3: Check Onboarding Status

After the user returns to your `return_url`, verify their account status:

```typescript
const account = await stripe.accounts.retrieve(stripeAccountId);

const onboardingStatus = {
  charges_enabled: account.charges_enabled,     // Can accept payments
  payouts_enabled: account.payouts_enabled,     // Can receive payouts to bank
  details_submitted: account.details_submitted, // User completed the form
  
  // Detailed requirements
  currently_due: account.requirements?.currently_due,      // Must provide now
  eventually_due: account.requirements?.eventually_due,    // Must provide later
  past_due: account.requirements?.past_due,                // Overdue (may disable account)
  disabled_reason: account.requirements?.disabled_reason,  // Why account is disabled
  
  // Capability status
  card_payments_status: account.capabilities?.card_payments,  // 'active', 'pending', 'inactive'
  transfers_status: account.capabilities?.transfers,          // 'active', 'pending', 'inactive'
};
```

### Onboarding Status Matrix

| `charges_enabled` | `payouts_enabled` | `details_submitted` | Meaning |
|---|---|---|---|
| false | false | false | Not started or abandoned |
| false | false | true | Submitted but under review |
| true | false | true | Can accept charges but cannot payout yet |
| true | true | true | Fully onboarded -- ready to receive funds |

### Step 4: Listen for `account.updated` Webhook

```typescript
// This fires when:
// - User completes onboarding steps
// - Verification status changes (approved/rejected)
// - Requirements change (new docs needed)
// - Capabilities change (enabled/disabled)
// - Payout schedule changes

// Event payload (key fields):
{
  "type": "account.updated",
  "data": {
    "object": {
      "id": "acct_xxxxxxxxxxxx",
      "charges_enabled": true,
      "payouts_enabled": true,
      "details_submitted": true,
      "requirements": {
        "currently_due": [],
        "eventually_due": [],
        "past_due": [],
        "disabled_reason": null
      },
      "capabilities": {
        "card_payments": "active",
        "transfers": "active"
      }
    }
  }
}
```

### Abandoned Onboarding Handling

If a user abandons onboarding halfway:
1. The account still exists in Stripe (with `details_submitted: false`)
2. `charges_enabled` and `payouts_enabled` will be `false`
3. To resume: create a **new** Account Link (old ones expire quickly)
4. Stripe remembers what the user already filled in -- they pick up where they left off
5. No data is lost; the account just remains in an incomplete state

```typescript
// Resume onboarding for an existing account
const newLink = await stripe.accountLinks.create({
  account: existingAccountId,
  refresh_url: '...',
  return_url: '...',
  type: 'account_onboarding',
});
```

> Ref: https://docs.stripe.com/connect/hosted-onboarding, https://docs.stripe.com/connect/express-accounts

---

## 4. Products and Prices for Subscription Tiers

### Creating a Product (Subscription Tier)

Each org subscription tier maps to a Stripe Product.

```typescript
const product = await stripe.products.create({
  name: 'Pro Membership',
  description: 'Full access to all premium content',
  
  // Optional but recommended
  images: ['https://cdn.codex.tv/org-logo.png'],
  
  // Metadata for our records
  metadata: {
    codex_organization_id: org.id,
    codex_tier_id: tier.id,
    codex_tier_slug: 'pro',
  },
  
  // Tax code for digital services (optional, for Stripe Tax)
  tax_code: 'txcd_10401100',  // Digital services - SaaS
});
```

### Creating Prices (Monthly and Annual)

```typescript
// Monthly price
const monthlyPrice = await stripe.prices.create({
  product: product.id,
  unit_amount: 1999,  // GBP 19.99 in pence
  currency: 'gbp',
  recurring: {
    interval: 'month',
    interval_count: 1,  // Every 1 month (default)
    // usage_type: 'licensed',  // Default -- fixed price per interval
  },
  
  metadata: {
    codex_organization_id: org.id,
    codex_tier_id: tier.id,
    codex_interval: 'monthly',
  },
});

// Annual price (typically discounted)
const annualPrice = await stripe.prices.create({
  product: product.id,
  unit_amount: 19990,  // GBP 199.90 in pence (2 months free)
  currency: 'gbp',
  recurring: {
    interval: 'year',
    interval_count: 1,
  },
  
  metadata: {
    codex_organization_id: org.id,
    codex_tier_id: tier.id,
    codex_interval: 'annual',
  },
});
```

### Price Immutability

**Prices in Stripe are immutable.** Once created, you cannot change the `unit_amount`, `currency`, or `recurring` interval of a Price. To change pricing:

1. **Create a new Price** with the updated amount
2. **Archive the old Price** (prevents new subscriptions using it)
3. **Migrate existing subscribers** (optional -- can grandfather them)

```typescript
// Archive old price (existing subscribers keep it)
await stripe.prices.update(oldPriceId, { active: false });

// Create new price
const newPrice = await stripe.prices.create({
  product: product.id,
  unit_amount: 2499,  // New price: GBP 24.99
  currency: 'gbp',
  recurring: { interval: 'month' },
});
```

### Migrating Existing Subscribers to New Price

```typescript
// Option 1: Migrate immediately (creates prorations)
await stripe.subscriptions.update(subscriptionId, {
  items: [
    {
      id: existingSubscriptionItemId,
      price: newPriceId,
    },
  ],
  proration_behavior: 'create_prorations',
  // 'always_invoice' to charge immediately
  // 'none' to skip proration
});

// Option 2: Schedule migration at next renewal
// Use subscription schedules to switch at period end
const schedule = await stripe.subscriptionSchedules.create({
  from_subscription: subscriptionId,
});

await stripe.subscriptionSchedules.update(schedule.id, {
  phases: [
    {
      items: [{ price: currentPriceId }],
      start_date: schedule.phases[0].start_date,
      end_date: schedule.phases[0].end_date,
    },
    {
      items: [{ price: newPriceId }],
      iterations: 1,  // Or leave undefined for indefinite
    },
  ],
});
```

> Ref: https://docs.stripe.com/products-prices/manage-prices, https://docs.stripe.com/billing/subscriptions/upgrade-downgrade

---

## 5. Subscription Checkout Session

### Creating a Checkout Session for Subscriptions

Since we are using **Separate Charges and Transfers**, the subscription and charge live on the **platform's** Stripe account. We do NOT use `transfer_data` or `application_fee_percent` on the Checkout Session.

```typescript
const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  
  line_items: [
    {
      price: priceId,  // pre-created Price ID (price_xxxx)
      quantity: 1,
    },
  ],
  
  // Customer management
  customer: stripeCustomerId,  // If existing customer
  // OR
  customer_email: user.email,  // For new customers (Stripe creates customer)
  
  // URLs
  success_url: `https://${org.slug}.codex.tv/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `https://${org.slug}.codex.tv/subscribe/cancel`,
  
  // Subscription-specific data
  subscription_data: {
    metadata: {
      codex_organization_id: org.id,
      codex_tier_id: tier.id,
      codex_customer_id: user.id,
      // For determining transfers on invoice.payment_succeeded:
      codex_org_stripe_account_id: org.stripeAccountId,
      codex_creator_stripe_account_id: creator.stripeAccountId,
      codex_platform_fee_bps: '1000',
      codex_org_fee_bps: '2000',
    },
    // Optional: trial period
    // trial_period_days: 14,
  },
  
  // Session metadata (separate from subscription metadata)
  metadata: {
    codex_organization_id: org.id,
    codex_customer_id: user.id,
    codex_tier_id: tier.id,
  },
  
  // Payment method collection
  payment_method_types: ['card'],
  
  // Allow promotion codes (optional)
  allow_promotion_codes: true,
  
  // Billing address collection (needed for tax/compliance)
  billing_address_collection: 'auto',
  
  // Customer update permissions (let Stripe update stored info)
  // Only works when `customer` is set (not `customer_email`)
  // customer_update: {
  //   address: 'auto',
  //   name: 'auto',
  // },
});

// session.url -> redirect customer here
// session.id -> store for verification
```

### Key Points About Subscription Checkout

1. **`mode: 'subscription'`** -- creates a Subscription + first Invoice + first PaymentIntent
2. **`subscription_data.metadata`** -- this metadata persists on the Subscription object and is available in ALL future `invoice.payment_succeeded` events. This is where we store the split configuration.
3. **`application_fee_percent`** -- we do NOT use this. It only works with destination charges. For separate charges and transfers, the platform receives the full charge and manually transfers.
4. **`transfer_data`** -- we do NOT use this. It only supports one destination. We need two (org + creator).
5. **Maximum 20 recurring line items** per Checkout Session.

### What Checkout Session Returns

```typescript
{
  id: 'cs_test_xxxx',
  object: 'checkout.session',
  url: 'https://checkout.stripe.com/c/pay/cs_test_xxxx',
  mode: 'subscription',
  status: 'open',  // 'open' | 'complete' | 'expired'
  
  // After completion:
  subscription: 'sub_xxxx',     // Subscription ID
  customer: 'cus_xxxx',         // Customer ID
  payment_intent: 'pi_xxxx',    // First payment intent
  payment_status: 'paid',       // 'paid' | 'unpaid' | 'no_payment_required'
  
  // Our metadata
  metadata: {
    codex_organization_id: '...',
    codex_customer_id: '...',
    codex_tier_id: '...',
  },
}
```

> Ref: https://docs.stripe.com/api/checkout/sessions/create, https://docs.stripe.com/connect/subscriptions

---

## 6. Multi-Party Splits on Recurring Payments

**THIS IS THE CRITICAL SECTION.**

### Architecture: Platform Charges + Manual Transfers

```
                    SUBSCRIPTION RENEWAL
                          |
                          v
              +------------------------+
              |  Stripe creates Invoice |
              |  on PLATFORM account   |
              +------------------------+
                          |
                          v
              +------------------------+
              |  Invoice auto-charged  |
              |  (PaymentIntent)       |
              +------------------------+
                          |
                          v
              +------------------------+
              |  invoice.payment_      |
              |  succeeded webhook     |
              +------------------------+
                          |
           +--------------+--------------+
           |              |              |
           v              v              v
     +-----------+  +-----------+  +-----------+
     | Platform  |  | Transfer  |  | Transfer  |
     | retains   |  | to Org    |  | to Creator|
     | 10%       |  | account   |  | account   |
     +-----------+  +-----------+  +-----------+
```

### The Transfer Flow (On Every invoice.payment_succeeded)

```typescript
// Inside the invoice.payment_succeeded webhook handler:

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  // Step 1: Get the subscription to access our metadata
  const subscription = await stripe.subscriptions.retrieve(
    invoice.subscription as string
  );
  
  const metadata = subscription.metadata;
  const orgStripeAccountId = metadata.codex_org_stripe_account_id;
  const creatorStripeAccountId = metadata.codex_creator_stripe_account_id;
  const platformFeeBps = parseInt(metadata.codex_platform_fee_bps);
  const orgFeeBps = parseInt(metadata.codex_org_fee_bps);
  
  // Step 2: Calculate split
  const amountPaid = invoice.amount_paid;  // In pence (integer)
  const chargeId = invoice.charge as string;  // ch_xxxx
  
  const platformFeeCents = Math.ceil((amountPaid * platformFeeBps) / 10000);
  const remainingAfterPlatform = amountPaid - platformFeeCents;
  const orgFeeCents = Math.ceil((remainingAfterPlatform * orgFeeBps) / 10000);
  const creatorPayoutCents = amountPaid - platformFeeCents - orgFeeCents;
  
  // Step 3: Create transfer group for tracking
  const transferGroup = `sub_${subscription.id}_inv_${invoice.id}`;
  
  // Step 4: Transfer to Organization
  if (orgFeeCents > 0 && orgStripeAccountId) {
    await stripe.transfers.create({
      amount: orgFeeCents,
      currency: 'gbp',
      destination: orgStripeAccountId,    // acct_xxxx (org's connected account)
      source_transaction: chargeId,        // Links transfer to the specific charge
      transfer_group: transferGroup,
      metadata: {
        codex_type: 'org_revenue_share',
        codex_invoice_id: invoice.id,
        codex_subscription_id: subscription.id,
        codex_organization_id: metadata.codex_organization_id,
      },
    });
  }
  
  // Step 5: Transfer to Creator
  if (creatorPayoutCents > 0 && creatorStripeAccountId) {
    await stripe.transfers.create({
      amount: creatorPayoutCents,
      currency: 'gbp',
      destination: creatorStripeAccountId, // acct_xxxx (creator's connected account)
      source_transaction: chargeId,
      transfer_group: transferGroup,
      metadata: {
        codex_type: 'creator_payout',
        codex_invoice_id: invoice.id,
        codex_subscription_id: subscription.id,
        codex_creator_id: metadata.codex_creator_id,
      },
    });
  }
  
  // Platform keeps the remainder (platformFeeCents) -- no transfer needed,
  // it stays in the platform's Stripe balance.
}
```

### Transfer API: Exact Parameters

```typescript
const transfer = await stripe.transfers.create({
  // Required
  amount: 1439,                           // Positive integer in smallest currency unit
  currency: 'gbp',                        // Three-letter ISO
  destination: 'acct_xxxxxxxxxxxx',       // Connected account ID
  
  // Strongly recommended
  source_transaction: 'ch_xxxxxxxxxxxx',  // The charge ID from the invoice
  // When set, transfer automatically succeeds and executes when charge funds
  // become available. Transfer amount cannot exceed charge amount.
  
  transfer_group: 'sub_xxx_inv_xxx',      // String to group related transfers
  // Does not affect functionality -- purely for tracking/reporting
  
  // Optional
  description: 'Revenue share for January 2026',
  metadata: { /* up to 50 key-value pairs */ },
});
```

### How to Get the Charge ID from an Invoice

The `invoice.payment_succeeded` event payload contains:

```typescript
{
  "object": {
    "id": "in_xxxx",
    "object": "invoice",
    "charge": "ch_xxxxxxxxxxxx",          // <-- THIS IS THE CHARGE ID
    "payment_intent": "pi_xxxxxxxxxxxx",  // PaymentIntent ID
    "subscription": "sub_xxxxxxxxxxxx",   // Subscription ID
    "amount_paid": 1999,                  // Amount in pence
    "currency": "gbp",
    "status": "paid",
    "customer": "cus_xxxxxxxxxxxx",
    // ... more fields
  }
}
```

The `charge` field on the Invoice object is the charge ID you pass as `source_transaction` to `stripe.transfers.create()`.

> **Gotcha**: For the very first invoice of a subscription created via Checkout, the `charge` field may be on the PaymentIntent rather than directly on the Invoice. Always check both:
> ```typescript
> const chargeId = invoice.charge 
>   ?? (await stripe.paymentIntents.retrieve(invoice.payment_intent as string)).latest_charge;
> ```

### Multiple Transfers from One Charge: Confirmed

Stripe explicitly supports creating multiple transfers from a single charge. From the docs:

> "You can split a single charge between multiple transfers... a one-to-many relationship where a payment needs to be split between multiple parties."

There is no limit on the number of transfers per charge, but the total transferred amount cannot exceed the original charge amount.

### Transfer Timing

When `source_transaction` is specified:
- The transfer request **succeeds immediately** (returns a Transfer object)
- The actual fund movement happens when the charge's funds become **available** in the platform balance
- For UK cards, funds are typically available after **7 business days** (configurable in Stripe Dashboard)
- The connected account receives the funds according to their payout schedule

### What If the Charge Hasn't Settled Yet?

Using `source_transaction` handles this automatically. Stripe queues the transfer and executes it when funds are available. You do NOT need to wait or poll.

> Ref: https://docs.stripe.com/connect/separate-charges-and-transfers, https://docs.stripe.com/api/transfers/create

---

## 7. Webhook Events for Subscriptions

### Event Catalog

| Event | When It Fires | Key Payload Fields |
|---|---|---|
| `checkout.session.completed` | Customer completes Checkout | `subscription`, `customer`, `payment_intent`, `metadata` |
| `customer.subscription.created` | New subscription created | `id`, `status`, `customer`, `items`, `metadata` |
| `customer.subscription.updated` | Sub modified (plan change, etc.) | `id`, `status`, `items`, `cancel_at_period_end`, previous_attributes |
| `customer.subscription.deleted` | Sub fully cancelled/expired | `id`, `status: 'canceled'`, `ended_at` |
| `customer.subscription.paused` | Sub paused (if enabled) | `id`, `status: 'paused'` |
| `customer.subscription.resumed` | Sub resumed from pause | `id`, `status: 'active'` |
| `customer.subscription.trial_will_end` | Trial ending in 3 days | `id`, `trial_end` |
| `invoice.created` | New invoice generated (draft) | `id`, `subscription`, `amount_due`, `status: 'draft'` |
| `invoice.finalized` | Invoice finalized, ready for payment | `id`, `status: 'open'` |
| `invoice.payment_succeeded` | Payment collected successfully | `id`, `charge`, `subscription`, `amount_paid`, `payment_intent` |
| `invoice.payment_failed` | Payment attempt failed | `id`, `subscription`, `attempt_count`, `next_payment_attempt` |
| `invoice.paid` | Invoice marked as paid | Same as `payment_succeeded` (use either, not both) |
| `charge.succeeded` | Underlying charge succeeded | `id`, `amount`, `payment_intent`, `invoice` |

### Event Ordering (Critical)

**Stripe does NOT guarantee event delivery order.** Your handlers MUST be idempotent and order-independent.

That said, the typical observed sequence is:

#### New Subscription (via Checkout)

```
1. checkout.session.completed
   - subscription ID is set
   - payment_status: 'paid'

2. customer.subscription.created
   - status: 'active'
   - metadata from subscription_data

3. invoice.created
   - First invoice for the subscription

4. invoice.finalized
   - Invoice ready for payment

5. invoice.payment_succeeded
   - charge ID available
   - THIS is where you create transfers

6. charge.succeeded
   - Low-level charge confirmation
```

#### Monthly Renewal

```
1. invoice.created
   - New invoice for the billing period

2. invoice.finalized

3. invoice.payment_succeeded   <-- CREATE TRANSFERS HERE
   - charge: 'ch_xxxx'
   - amount_paid: 1999

4. charge.succeeded
```

#### Failed Renewal

```
1. invoice.created
2. invoice.finalized
3. invoice.payment_failed
   - attempt_count: 1
   - next_payment_attempt: <unix timestamp>
   - subscription status -> 'past_due'

   Stripe retries automatically:
   - Retry 1: ~3 days after first failure
   - Retry 2: ~5 days after first failure
   - Retry 3: ~7 days after first failure
   (configurable in Stripe Dashboard > Billing > Automatic collection)

4. If all retries fail:
   - customer.subscription.updated (status: 'past_due' -> 'unpaid' or 'canceled')
   - customer.subscription.deleted (if configured to cancel after all retries)
```

#### Upgrade/Downgrade

```
1. customer.subscription.updated
   - items changed (old price -> new price)
   - previous_attributes shows what changed

2. invoice.created  (proration invoice, if applicable)
3. invoice.finalized
4. invoice.payment_succeeded  <-- Proration charge + transfer

5. On next billing cycle:
   - invoice.created (new price amount)
   - invoice.payment_succeeded  <-- Full new price transfer
```

#### Cancellation (at period end)

```
1. customer.subscription.updated
   - cancel_at_period_end: true
   - status: 'active'  (still active until period ends!)

2. [At period end]
   customer.subscription.deleted
   - status: 'canceled'
   - ended_at: <unix timestamp>
```

#### Immediate Cancellation

```
1. customer.subscription.deleted
   - status: 'canceled'
   - ended_at: <now>
```

### Recommended Webhook Subscriptions

For the subscription system, listen to these events:

```typescript
const SUBSCRIPTION_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'account.updated',  // Connect onboarding status
] as const;
```

### invoice.payment_succeeded Payload (Detailed)

```typescript
{
  "id": "evt_xxxxxxxxxxxx",
  "type": "invoice.payment_succeeded",
  "data": {
    "object": {
      "id": "in_xxxxxxxxxxxx",
      "object": "invoice",
      "account_country": "GB",
      "amount_due": 1999,
      "amount_paid": 1999,
      "amount_remaining": 0,
      "billing_reason": "subscription_cycle",  // or 'subscription_create'
      "charge": "ch_xxxxxxxxxxxx",             // <-- For source_transaction
      "collection_method": "charge_automatically",
      "currency": "gbp",
      "customer": "cus_xxxxxxxxxxxx",
      "customer_email": "user@example.com",
      "lines": {
        "data": [
          {
            "amount": 1999,
            "description": "1x Pro Membership (Jan 5 - Feb 5, 2026)",
            "price": {
              "id": "price_xxxxxxxxxxxx",
              "unit_amount": 1999,
              "recurring": {
                "interval": "month",
                "interval_count": 1
              }
            },
            "subscription": "sub_xxxxxxxxxxxx"
          }
        ]
      },
      "paid": true,
      "payment_intent": "pi_xxxxxxxxxxxx",
      "period_end": 1738713600,
      "period_start": 1736035200,
      "status": "paid",
      "subscription": "sub_xxxxxxxxxxxx",     // <-- To get metadata
      "subtotal": 1999,
      "total": 1999
    }
  }
}
```

> Ref: https://docs.stripe.com/billing/subscriptions/webhooks, https://docs.stripe.com/api/events/types

---

## 8. Subscription Lifecycle Management

### Upgrade/Downgrade (Changing Price)

```typescript
// Get current subscription items
const subscription = await stripe.subscriptions.retrieve(subscriptionId);
const currentItemId = subscription.items.data[0].id;

await stripe.subscriptions.update(subscriptionId, {
  items: [
    {
      id: currentItemId,     // Existing subscription item ID (si_xxxx)
      price: newPriceId,     // New price to switch to
    },
  ],
  
  // Proration behavior (CRITICAL decision)
  proration_behavior: 'create_prorations',
  // Options:
  // 'create_prorations'  -- Calculate credit for unused time, charge for new price. 
  //                         Applied to next invoice (not charged immediately).
  // 'always_invoice'     -- Same as above BUT immediately generates and charges an invoice.
  // 'none'               -- No proration. New price takes effect at next renewal.
  
  // Optional: set proration date
  // proration_date: Math.floor(Date.now() / 1000),  // Default: now
  
  // Keep our metadata up to date
  metadata: {
    ...subscription.metadata,
    codex_tier_id: newTierId,
  },
});
```

### Proration Behaviour Explained

| `proration_behavior` | What Happens | When to Use |
|---|---|---|
| `create_prorations` | Credit + charge calculated, applied to next invoice | Default. Fair to customer. |
| `always_invoice` | Credit + charge calculated, new invoice generated and charged immediately | When you want immediate billing. |
| `none` | No proration. Old price until period end, new price at renewal. | For downgrades where you want to grandfather the current period. |

### Proration Example

Customer upgrades from GBP 9.99/month to GBP 19.99/month on day 15 of 30:

```
Credit for unused Basic: -GBP 5.00 (15/30 * GBP 9.99)
Charge for remaining Pro: +GBP 10.00 (15/30 * GBP 19.99)
Net proration: GBP 5.00 added to next invoice
```

### Cancel at Period End

```typescript
await stripe.subscriptions.update(subscriptionId, {
  cancel_at_period_end: true,
});

// Result:
// - status remains 'active'
// - cancel_at_period_end: true
// - cancel_at: <period end timestamp>
// - Customer retains access until period end
// - Fires: customer.subscription.updated
// - At period end fires: customer.subscription.deleted
```

### Reactivate Before Period End

```typescript
// Only works if status is still 'active' (cancel_at_period_end was true)
await stripe.subscriptions.update(subscriptionId, {
  cancel_at_period_end: false,
});

// Result:
// - cancel_at_period_end: false
// - cancel_at: null
// - Subscription continues as normal
// - Fires: customer.subscription.updated
```

### Immediate Cancellation

```typescript
await stripe.subscriptions.cancel(subscriptionId);

// Result:
// - status: 'canceled'
// - ended_at: <now>
// - No more invoices generated
// - Fires: customer.subscription.deleted
// - CANNOT be reactivated -- must create new subscription
```

> **Important**: You cannot reactivate a fully canceled subscription (`status: 'canceled'`). You must create a new subscription. Only subscriptions with `cancel_at_period_end: true` (still `status: 'active'`) can be reactivated.

### Pause and Resume (Optional Feature)

```typescript
// Pause (requires pause_collection to be enabled on the subscription)
await stripe.subscriptions.update(subscriptionId, {
  pause_collection: {
    behavior: 'void',  // 'void' (skip invoices) or 'mark_uncollectible'
    // resumes_at: <unix timestamp>,  // Optional: auto-resume date
  },
});

// Resume
await stripe.subscriptions.update(subscriptionId, {
  pause_collection: '',  // Empty string to resume
});
```

### Subscription Status State Machine

```
                  +---> trialing --+
                  |                |
    incomplete ---+---> active <---+---> past_due ---> unpaid ---> canceled
         |                |                                           ^
         v                |                                           |
    incomplete_expired    +---> paused (optional) --->+               |
                          |                           |               |
                          +---> cancel_at_period_end  +---------------+
                          |    (still 'active')       
                          +---> canceled (immediate)
```

> Ref: https://docs.stripe.com/billing/subscriptions/change, https://docs.stripe.com/billing/subscriptions/cancel, https://docs.stripe.com/billing/subscriptions/overview

---

## 9. Refunds and Transfer Reversals

### Refunding a Subscription Charge

```typescript
const refund = await stripe.refunds.create({
  charge: 'ch_xxxxxxxxxxxx',  // The specific invoice charge to refund
  // OR
  payment_intent: 'pi_xxxxxxxxxxxx',
  
  // Full refund (default) or partial
  amount: 999,  // Partial refund in pence. Omit for full refund.
  
  reason: 'requested_by_customer',
  // Options: 'duplicate', 'fraudulent', 'requested_by_customer'
  
  // IMPORTANT for Connect:
  reverse_transfer: true,  // Reverse associated transfers
  // Only works if transfers were created with source_transaction
  
  metadata: {
    codex_subscription_id: subscriptionId,
    codex_reason: 'Customer requested refund for current period',
  },
});
```

### Transfer Reversal Behaviour

**With `reverse_transfer: true`:**
- If FULL refund: Stripe automatically reverses ALL transfers associated with the charge (proportionally)
- If PARTIAL refund: Stripe reverses a proportional amount from each transfer

**Without `reverse_transfer: true`:**
- Transfers are NOT automatically reversed
- You must manually create transfer reversals

### Manual Transfer Reversal

```typescript
const reversal = await stripe.transfers.createReversal(
  'tr_xxxxxxxxxxxx',  // Transfer ID to reverse
  {
    amount: 500,  // Partial reversal in pence. Omit for full reversal.
    description: 'Refund for subscription period',
    metadata: {
      codex_refund_id: refund.id,
      codex_reason: 'Subscription refund',
    },
  }
);
```

### Transfer Reversal Gotchas

1. **Transfers are NOT auto-reversed on refund** (unless `reverse_transfer: true` is set)
2. **Connected account must have sufficient balance** -- if the connected account has already withdrawn funds, the reversal creates a negative balance. Stripe will deduct from future payouts.
3. **Partial reversals** are only allowed for transfers to Stripe Accounts (connected accounts).
4. **Timing**: If the original transfer hasn't settled yet (pending `source_transaction`), the reversal cancels the pending transfer.

### Refund + Reversal Sequence for Subscriptions

```
1. Customer requests refund for current billing period
2. Platform creates refund:
   stripe.refunds.create({ charge: chargeId, reverse_transfer: true })
3. Stripe auto-reverses proportional amounts from org + creator transfers
4. Platform records refund in database
5. Platform revokes access (if appropriate) or allows access until period end
```

> Ref: https://docs.stripe.com/refunds, https://docs.stripe.com/api/transfer_reversals, https://docs.stripe.com/connect/separate-charges-and-transfers

---

## 10. Customer Portal

### Creating a Portal Session

```typescript
const portalSession = await stripe.billingPortal.sessions.create({
  customer: stripeCustomerId,  // cus_xxxxxxxxxxxx
  return_url: `https://${org.slug}.codex.tv/account/billing`,
  
  // Optional: use a specific portal configuration
  // configuration: 'bpc_xxxxxxxxxxxx',
});

// portalSession.url -> redirect customer here
```

### Portal Capabilities

Customers can:
- View billing history and invoices
- Update payment method
- Cancel subscription (if allowed in configuration)
- Switch plans (upgrade/downgrade, if allowed)
- Update billing address
- View upcoming invoices

### Portal Configuration

```typescript
const configuration = await stripe.billingPortal.configurations.create({
  business_profile: {
    headline: 'Manage your subscription',
    privacy_policy_url: 'https://codex.tv/privacy',
    terms_of_service_url: 'https://codex.tv/terms',
  },
  
  features: {
    // Subscription cancellation
    subscription_cancel: {
      enabled: true,
      mode: 'at_period_end',  // 'at_period_end' or 'immediately'
      cancellation_reason: {
        enabled: true,
        options: [
          'too_expensive',
          'missing_features',
          'switched_service',
          'unused',
          'other',
        ],
      },
      // Optional: offer a coupon to retain
      // proration_behavior: 'create_prorations',
    },
    
    // Subscription plan switching
    subscription_update: {
      enabled: true,
      default_allowed_updates: ['price'],  // What customers can change
      proration_behavior: 'create_prorations',
      products: [
        {
          product: 'prod_xxxx',  // Which products to show
          prices: ['price_monthly', 'price_annual'],  // Available prices
        },
      ],
    },
    
    // Payment method update
    payment_method_update: {
      enabled: true,
    },
    
    // Invoice history
    invoice_history: {
      enabled: true,
    },
    
    // Customer update (name, email, etc.)
    customer_update: {
      enabled: true,
      allowed_updates: ['email', 'address', 'phone'],
    },
  },
});
```

### Portal with Connect

The billing portal works with platform-level subscriptions (our model). Since our subscriptions live on the platform account (separate charges and transfers), the portal manages subscriptions normally. The customer interacts with the platform's portal, not the connected account's.

**One consideration**: If you want org-specific branding in the portal, create separate portal configurations per org.

> Ref: https://docs.stripe.com/customer-management, https://docs.stripe.com/api/customer_portal/sessions/create, https://docs.stripe.com/customer-management/configure-portal

---

## 11. Idempotency and Error Handling

### Idempotency Keys

```typescript
// On subscription-related API calls
const subscription = await stripe.subscriptions.create(
  { /* params */ },
  {
    idempotencyKey: `create_sub_${userId}_${tierId}_${Date.now()}`,
    // Keys are valid for 24 hours
    // Same key + same params = returns cached result
    // Same key + different params = returns error
  }
);

// On transfers (critical -- webhook may fire multiple times)
await stripe.transfers.create(
  { /* params */ },
  {
    idempotencyKey: `transfer_${invoiceId}_${destinationAccountId}`,
    // This prevents duplicate transfers if webhook fires twice
  }
);
```

### Webhook Deduplication

```typescript
async function handleWebhook(event: Stripe.Event) {
  // Step 1: Check if we already processed this event
  const existing = await db.query.webhookEvents.findFirst({
    where: eq(webhookEvents.stripeEventId, event.id),
  });
  
  if (existing) {
    // Already processed -- return 200 to Stripe
    return { received: true, deduplicated: true };
  }
  
  // Step 2: Record the event (idempotency marker)
  await db.insert(webhookEvents).values({
    stripeEventId: event.id,
    eventType: event.type,
    processedAt: new Date(),
  });
  
  // Step 3: Process the event
  // ... handle based on event.type
}
```

### Stripe Retry Policy

| Attempt | Timing | Notes |
|---|---|---|
| 1 | Immediate | First delivery attempt |
| 2 | ~5 minutes | If endpoint returns non-2xx or times out |
| 3 | ~30 minutes | |
| 4 | ~2 hours | |
| 5 | ~5 hours | |
| 6+ | Exponential | Up to 3 days total in live mode |

After 3 days of failures, Stripe stops retrying and marks the event as failed. You can manually retry from the Stripe Dashboard.

**Your webhook endpoint MUST respond within 20 seconds** (5 seconds recommended). For heavy processing, return 200 immediately and process asynchronously.

### What If a Transfer Fails After Invoice Payment Succeeds?

This is a critical edge case:

1. **Insufficient platform balance**: Rarely happens with `source_transaction` (Stripe waits for funds). But if the charge is disputed before transfer settles, the transfer fails.
2. **Connected account issue**: If the connected account is deactivated or has compliance holds, the transfer fails.
3. **Currency mismatch**: Transfer currency must be a currency the connected account can receive.

**Handling strategy:**

```typescript
try {
  await stripe.transfers.create({ /* params */ });
} catch (error) {
  // Log the failure
  obs.error('Transfer failed', {
    invoiceId,
    destination: accountId,
    error: error.message,
  });
  
  // Store in a retry queue (database table)
  await db.insert(failedTransfers).values({
    invoiceId,
    destinationAccountId: accountId,
    amount,
    errorMessage: error.message,
    retryCount: 0,
    nextRetryAt: new Date(Date.now() + 3600000),  // Retry in 1 hour
  });
  
  // DO NOT return error to Stripe webhook -- return 200
  // Handle retries via a scheduled job
}
```

### Error Types from Stripe

| Error Type | HTTP | Meaning | Action |
|---|---|---|---|
| `StripeCardError` | 402 | Card declined | Notify customer |
| `StripeInvalidRequestError` | 400 | Invalid parameters | Fix code bug |
| `StripeAPIError` | 500 | Stripe server error | Retry with backoff |
| `StripeConnectionError` | - | Network failure | Retry with backoff |
| `StripeAuthenticationError` | 401 | Invalid API key | Check configuration |
| `StripeRateLimitError` | 429 | Too many requests | Exponential backoff |
| `StripeIdempotencyError` | 400 | Idempotency key reuse with different params | Use new key |

> Ref: https://docs.stripe.com/api/idempotent_requests, https://docs.stripe.com/webhooks, https://docs.stripe.com/error-low-level

---

## 12. Codex Integration Notes

### Existing Codebase State

The current Codex codebase has a one-time purchase system. Key existing components:

| Component | Location | Current State |
|---|---|---|
| `PurchaseService` | `packages/purchase/src/services/purchase-service.ts` | One-time `mode: 'payment'` Checkout |
| `revenue-calculator.ts` | `packages/purchase/src/services/revenue-calculator.ts` | 3-party split in basis points (works for subscriptions too) |
| `ecommerce.ts` schema | `packages/database/src/schema/ecommerce.ts` | Has `purchases`, `contentAccess`, fee config tables |
| `checkout.ts` routes | `workers/ecom-api/src/routes/checkout.ts` | POST `/checkout/create`, GET `/checkout/verify`, POST `/checkout/portal-session` |
| `webhook-handler.ts` | `workers/ecom-api/src/utils/webhook-handler.ts` | Generic webhook handler factory |
| Commerce constants | `packages/constants/src/commerce.ts` | `FEES.PLATFORM_PERCENT: 1000`, `CURRENCY.GBP` |

### What Needs to Be Added/Changed

1. **New DB tables**: `subscriptions`, `subscription_tiers`, `stripe_connected_accounts`, `subscription_payments`, `webhook_events` (idempotency), `failed_transfers` (retry queue)
2. **Schema changes to `contentAccess`**: Add `subscriptionId` foreign key, handle `accessType: 'subscription'` with `expiresAt`
3. **New service**: `SubscriptionService` (or extend `PurchaseService`)
4. **New Connect service**: `ConnectService` for account creation/onboarding
5. **New webhook handlers**: `invoice.payment_succeeded`, `customer.subscription.*`, `account.updated`
6. **Revenue calculator**: Already supports 3-party splits -- can be reused directly for subscription payments
7. **Stripe client**: Already exists at `packages/purchase/src/stripe-client.ts` -- may need Connect-specific configuration

### Revenue Calculator Compatibility

The existing `calculateRevenueSplit(amountCents, platformFeeBps, orgFeeBps)` function works perfectly for subscription payments. It returns `{ platformFeeCents, organizationFeeCents, creatorPayoutCents }` with the same basis-point system needed for transfers.

### Webhook Event Constants to Add

```typescript
// Add to packages/constants/src/commerce.ts
export const STRIPE_EVENTS = {
  // Existing
  CHECKOUT_COMPLETED: 'checkout.session.completed',
  
  // New for subscriptions
  SUBSCRIPTION_CREATED: 'customer.subscription.created',
  SUBSCRIPTION_UPDATED: 'customer.subscription.updated',
  SUBSCRIPTION_DELETED: 'customer.subscription.deleted',
  SUBSCRIPTION_PAUSED: 'customer.subscription.paused',
  SUBSCRIPTION_RESUMED: 'customer.subscription.resumed',
  INVOICE_PAYMENT_SUCCEEDED: 'invoice.payment_succeeded',
  INVOICE_PAYMENT_FAILED: 'invoice.payment_failed',
  
  // Connect
  ACCOUNT_UPDATED: 'account.updated',
} as const;
```

---

## Appendix A: Complete Subscription Payment Sequence

```
INITIAL SUBSCRIPTION
====================

Platform                    Stripe                      Customer
   |                          |                            |
   |  1. POST /checkout/create |                           |
   |  (mode: 'subscription')  |                            |
   |------------------------->|                            |
   |  <-- session.url         |                            |
   |                          |  2. Checkout page          |
   |                          |<---------------------------|
   |                          |  3. Customer pays          |
   |                          |<---------------------------|
   |                          |                            |
   |  4. checkout.session.completed (webhook)              |
   |<-------------------------|                            |
   |  [Create local subscription record]                   |
   |  [Grant access with expiresAt]                        |
   |                          |                            |
   |  5. invoice.payment_succeeded (webhook)               |
   |<-------------------------|                            |
   |  [Calculate 3-party split]                            |
   |  [Transfer to Org: stripe.transfers.create()]         |
   |  [Transfer to Creator: stripe.transfers.create()]     |
   |  [Record payment in subscription_payments table]      |
   |                          |                            |


MONTHLY RENEWAL
===============

Platform                    Stripe                      Customer
   |                          |                            |
   |                          |  1. Auto-create invoice    |
   |                          |  2. Auto-charge card       |
   |                          |                            |
   |  3. invoice.payment_succeeded (webhook)               |
   |<-------------------------|                            |
   |  [Calculate 3-party split using subscription metadata]|
   |  [Transfer to Org]                                    |
   |  [Transfer to Creator]                                |
   |  [Extend access expiresAt]                            |
   |  [Record payment]                                     |
   |                          |                            |


FAILED RENEWAL
==============

Platform                    Stripe                      Customer
   |                          |                            |
   |                          |  1. Auto-charge fails      |
   |                          |                            |
   |  2. invoice.payment_failed (webhook)                  |
   |<-------------------------|                            |
   |  [Update subscription status: 'past_due']             |
   |  [Send notification to customer]                      |
   |  [DO NOT extend access]                               |
   |                          |                            |
   |                          |  3. Stripe retries (3x)    |
   |                          |  4. If succeeds:           |
   |  5. invoice.payment_succeeded                         |
   |<-------------------------|                            |
   |  [Process normally]                                   |
   |                          |                            |
   |                          |  4. If all retries fail:   |
   |  5. customer.subscription.deleted                     |
   |<-------------------------|                            |
   |  [Revoke access]                                      |
   |  [Update subscription: 'canceled']                    |
   |                          |                            |


CANCELLATION (AT PERIOD END)
============================

Platform                    Stripe                      Customer
   |                          |                            |
   |  1. PATCH /subscription/:id/cancel                    |
   |  stripe.subscriptions.update({cancel_at_period_end})  |
   |------------------------->|                            |
   |                          |                            |
   |  2. customer.subscription.updated (webhook)           |
   |<-------------------------|                            |
   |  [Update local record: cancel_at_period_end = true]   |
   |  [Customer retains access until period end]           |
   |                          |                            |
   |                          |  3. [Period ends]          |
   |  4. customer.subscription.deleted (webhook)           |
   |<-------------------------|                            |
   |  [Revoke access]                                      |
   |  [Update subscription: 'canceled']                    |
   |                          |                            |
```

---

## Appendix B: Gotchas and Edge Cases

1. **Event ordering is NOT guaranteed.** You may receive `invoice.payment_succeeded` before `customer.subscription.created`. Design handlers to be order-independent.

2. **Subscription metadata vs session metadata.** `subscription_data.metadata` on the Checkout Session persists to the Subscription object and is available on every future invoice event. Session-level `metadata` is only on the Checkout Session.

3. **First invoice charge ID.** For subscriptions created via Checkout, the first invoice's `charge` field should be available, but always have a fallback via `payment_intent.latest_charge`.

4. **Transfer amount limits.** Total transfers from a charge cannot exceed the charge amount. If Stripe fees are deducted from the charge (which they are with `fees.payer: 'application'`), the transferable amount is the GROSS charge amount, not the net. Stripe deducts fees separately from the platform balance.

5. **Connected account payout timing.** Even after a transfer, funds are not instantly available to the connected account. They follow the connected account's payout schedule (default: 7 business days for UK).

6. **Proration with 3-party splits.** When a customer upgrades mid-cycle, a proration invoice is created. This invoice may have a different amount than the regular subscription amount. Your transfer logic must handle varying amounts (use `invoice.amount_paid`, not a hardcoded tier price).

7. **Zero-amount invoices.** Some subscription changes produce zero-amount invoices (e.g., applying a 100% coupon, or a proration that exactly cancels out). Your handler should skip transfers when `amount_paid === 0`.

8. **Webhook timeout.** Stripe expects a response within 20 seconds. If your transfer logic takes longer, return 200 immediately and process asynchronously (queue the work).

9. **Negative invoice line items.** Proration credits appear as negative line items. The `amount_paid` is the net amount actually charged. Always use `amount_paid` for transfer calculations.

10. **Currency matching.** Transfers must use the same currency as the charge. Since we use GBP throughout, this is straightforward, but verify `invoice.currency` before transferring.

11. **Connected account balance for reversals.** If you reverse a transfer and the connected account has already paid out those funds, it creates a negative balance. Stripe deducts from future payouts, which can cause issues if the connected account stops receiving payments.

12. **Subscription schedule vs direct update.** For scheduled price changes (e.g., "new price takes effect next billing cycle"), use Subscription Schedules rather than immediate updates. Direct updates with `proration_behavior: 'none'` also work but are less explicit.

---

## Appendix C: Key Stripe Documentation Links

- [Connect Overview](https://docs.stripe.com/connect)
- [Connect Account Types](https://docs.stripe.com/connect/accounts)
- [Controller Properties Migration](https://docs.stripe.com/connect/migrate-to-controller-properties)
- [Separate Charges and Transfers](https://docs.stripe.com/connect/separate-charges-and-transfers)
- [Subscriptions with Connect](https://docs.stripe.com/connect/subscriptions)
- [Subscription Webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)
- [Subscription Lifecycle](https://docs.stripe.com/billing/subscriptions/overview)
- [Upgrade/Downgrade](https://docs.stripe.com/billing/subscriptions/upgrade-downgrade)
- [Cancel Subscriptions](https://docs.stripe.com/billing/subscriptions/cancel)
- [Prorations](https://docs.stripe.com/billing/subscriptions/prorations)
- [Products and Prices](https://docs.stripe.com/products-prices/how-products-and-prices-work)
- [Checkout Sessions API](https://docs.stripe.com/api/checkout/sessions/create)
- [Transfers API](https://docs.stripe.com/api/transfers/create)
- [Transfer Reversals API](https://docs.stripe.com/api/transfer_reversals)
- [Refunds](https://docs.stripe.com/refunds)
- [Customer Portal](https://docs.stripe.com/customer-management)
- [Idempotent Requests](https://docs.stripe.com/api/idempotent_requests)
- [Webhook Best Practices](https://docs.stripe.com/webhooks)
- [Connect Pricing](https://stripe.com/connect/pricing)
- [Account Capabilities](https://docs.stripe.com/connect/account-capabilities)
- [Hosted Onboarding](https://docs.stripe.com/connect/hosted-onboarding)
