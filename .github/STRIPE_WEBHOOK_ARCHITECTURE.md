# Stripe Webhook Architecture for Codex Platform

**API Version**: `2025-09-30.clover`
**Last Updated**: 2025-01-30

---

## Overview

This document defines the webhook architecture for the Codex creator platform. The platform uses **multiple webhook endpoints** for scalability, maintainability, and clear separation of concerns.

### Why Multiple Endpoints?

1. **Separation of Concerns**: Each endpoint handles a specific business domain
2. **Independent Scaling**: High-traffic endpoints (payments) can scale independently
3. **Easier Debugging**: Clear logs and traces per domain
4. **Security**: Different secrets per endpoint
5. **Maintainability**: Smaller, focused handlers
6. **Testing**: Can test domains in isolation

---

## Webhook Endpoints

### 1. **Payment Webhooks**
**URL**: `https://stripe-webhook-handler-production.workers.dev/webhooks/payments`
**Purpose**: Handle direct payments for content and offerings

#### Events
```typescript
payment_intent.succeeded      // Payment completed successfully
payment_intent.payment_failed // Payment failed
payment_intent.canceled       // Payment canceled by customer
charge.succeeded              // Charge created (after payment intent)
charge.refunded               // Refund processed
charge.dispute.created        // Customer disputed charge
charge.dispute.closed         // Dispute resolved
```

#### Business Logic
- **payment_intent.succeeded**:
  - Grant immediate access to purchased content
  - Create offering registration/booking
  - Send purchase confirmation email
  - Create transaction record in database
  - Trigger revenue split calculation for Media Owner content

- **charge.refunded**:
  - Revoke content/offering access
  - Update transaction status
  - Send refund confirmation
  - Adjust Media Owner payouts if needed

- **charge.dispute.created**:
  - Alert admin
  - Flag transaction for review
  - Optionally revoke access (configurable)

#### Database Updates
```sql
-- Update purchases table
UPDATE purchases
SET status = 'completed', completed_at = NOW()
WHERE stripe_payment_intent_id = ?;

-- Grant content access
INSERT INTO user_content_access (user_id, content_id, access_type, granted_at)
VALUES (?, ?, 'purchased', NOW());

-- Create transaction record
INSERT INTO transactions (user_id, amount, type, status, stripe_charge_id)
VALUES (?, ?, 'content_purchase', 'completed', ?);
```

---

### 2. **Subscription Webhooks**
**URL**: `https://stripe-webhook-handler-production.workers.dev/webhooks/subscriptions`
**Purpose**: Manage subscription lifecycle and credit allocation

#### Events
```typescript
customer.subscription.created     // New subscription started
customer.subscription.updated     // Subscription tier changed
customer.subscription.deleted     // Subscription canceled
customer.subscription.trial_will_end // Trial ending soon (7 days)
invoice.payment_succeeded         // Subscription renewed successfully
invoice.payment_failed            // Renewal payment failed
invoice.upcoming                  // Renewal coming up (3 days warning)
```

#### Business Logic
- **customer.subscription.created**:
  - Grant access to all categories in subscription tier
  - Allocate initial monthly credits
  - Send welcome email with tier benefits
  - Create subscription record in database
  - Schedule first credit expiration

- **customer.subscription.updated**:
  - Update category access (upgrade/downgrade)
  - Adjust credit allocation for new tier
  - Prorate credits if mid-cycle change
  - Send tier change confirmation

- **invoice.payment_succeeded** (renewal):
  - Allocate new monthly credits
  - Reset credit expiration
  - Send renewal confirmation
  - Track MRR (Monthly Recurring Revenue)

- **invoice.payment_failed**:
  - Start dunning process
  - Send payment failure email
  - After 3 failed attempts: suspend access
  - Don't allocate new credits

- **customer.subscription.deleted**:
  - Revoke category access
  - Stop credit allocation
  - Mark credits as expired
  - Send cancellation confirmation
  - Offer win-back incentive

#### Database Updates
```sql
-- Create subscription record
INSERT INTO subscriptions (user_id, tier_id, stripe_subscription_id, status, started_at)
VALUES (?, ?, ?, 'active', NOW());

-- Grant category access
INSERT INTO user_category_access (user_id, category_id, access_source, expires_at)
SELECT ?, category_id, 'subscription', NULL
FROM subscription_tier_categories
WHERE tier_id = ?;

-- Allocate monthly credits
INSERT INTO user_credits (user_id, credits, source, expires_at)
VALUES (?, ?, 'monthly_subscription', NOW() + INTERVAL '30 days');
```

#### Credit System Logic
```typescript
// When subscription renews
async function allocateMonthlyCredits(userId: string, tierId: string) {
  // Get tier's credit allocation
  const tier = await db.subscriptionTiers.findById(tierId);

  // Expire old credits (if not rollover policy)
  if (tier.creditPolicy === 'expire_monthly') {
    await db.userCredits.update({
      where: { userId, source: 'monthly_subscription' },
      data: { expired: true }
    });
  }

  // Add new credits
  await db.userCredits.create({
    userId,
    credits: tier.monthlyCredits,
    source: 'monthly_subscription',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  });

  // Send notification
  await sendEmail({
    to: user.email,
    template: 'credits_allocated',
    data: { credits: tier.monthlyCredits, expiresAt: ... }
  });
}
```

---

### 3. **Connect (Revenue Sharing) Webhooks**
**URL**: `https://stripe-webhook-handler-production.workers.dev/webhooks/connect`
**Purpose**: Handle Media Owner payouts and connected account events

#### Events
```typescript
account.updated                     // Media Owner account status changed
account.external_account.created    // Media Owner added bank account
payout.created                      // Payout initiated to Media Owner
payout.paid                         // Payout successfully sent
payout.failed                       // Payout failed
transfer.created                    // Transfer to Media Owner created
application_fee.created             // Platform fee collected
```

#### Business Logic
- **account.updated**:
  - Check if charges_enabled/payouts_enabled changed
  - Update Media Owner status in database
  - If enabled: Send onboarding completion email
  - If disabled: Alert admin, suspend new content

- **payout.created**:
  - Track payout in database
  - Send "payout initiated" email to Media Owner
  - Update pending balance

- **payout.paid**:
  - Mark payout as completed
  - Send "payout completed" email
  - Update Media Owner's total earned
  - Generate payout receipt

- **payout.failed**:
  - Alert Media Owner
  - Log failure reason
  - Retry payout (if transient failure)
  - Request updated bank details if needed

- **transfer.created**:
  - Track transfer to Media Owner
  - Associate with specific content sale
  - Calculate platform fee (application_fee)
  - Update earnings dashboard

#### Revenue Split Calculation
```typescript
// When content is purchased
async function calculateRevenueSplit(charge: Charge) {
  const content = await db.content.findById(charge.metadata.contentId);
  const mediaOwner = await db.mediaOwners.findById(content.mediaOwnerId);

  // Calculate split
  const totalAmount = charge.amount;
  const platformFee = totalAmount * mediaOwner.platformFeePercent / 100;
  const mediaOwnerAmount = totalAmount - platformFee;

  // Create Stripe transfer to Media Owner's connected account
  await stripe.transfers.create({
    amount: mediaOwnerAmount,
    currency: 'usd',
    destination: mediaOwner.stripeConnectedAccountId,
    source_transaction: charge.id,
    metadata: {
      contentId: content.id,
      mediaOwnerId: mediaOwner.id,
      platformFee: platformFee.toString()
    }
  });

  // Record in database
  await db.earnings.create({
    mediaOwnerId: mediaOwner.id,
    contentId: content.id,
    chargeId: charge.id,
    totalAmount,
    platformFee,
    earned: mediaOwnerAmount,
    status: 'pending_payout'
  });
}
```

#### Database Updates
```sql
-- Track Media Owner earnings
INSERT INTO media_owner_earnings (
  media_owner_id, content_id, charge_id,
  total_amount, platform_fee, earned_amount, status
)
VALUES (?, ?, ?, ?, ?, ?, 'pending_payout');

-- Update Media Owner balance
UPDATE media_owners
SET pending_balance = pending_balance + ?,
    total_earned = total_earned + ?
WHERE id = ?;

-- Record payout
INSERT INTO payouts (
  media_owner_id, stripe_payout_id, amount, status, initiated_at
)
VALUES (?, ?, ?, 'initiated', NOW());
```

---

### 4. **Customer Webhooks**
**URL**: `https://stripe-webhook-handler-production.workers.dev/webhooks/customers`
**Purpose**: Manage customer account changes

#### Events
```typescript
customer.created              // New customer in Stripe
customer.updated              // Customer details changed
customer.deleted              // Customer deleted (GDPR)
customer.source.created       // Payment method added
customer.source.updated       // Payment method updated
customer.source.expiring      // Card expiring soon
payment_method.attached       // New payment method added
payment_method.detached       // Payment method removed
```

#### Business Logic
- **customer.created**:
  - Sync Stripe customer with database user
  - Update user record with stripe_customer_id
  - Create default billing info

- **customer.source.expiring**:
  - Send email reminder to update card
  - Show banner in customer dashboard
  - If subscribed: extra urgency

- **customer.deleted**:
  - Cancel all subscriptions
  - Revoke all access
  - Anonymize personal data (GDPR)
  - Keep transaction history (anonymized)

#### Database Updates
```sql
-- Sync customer
UPDATE users
SET stripe_customer_id = ?, stripe_synced_at = NOW()
WHERE email = ?;

-- Track payment method expiration
UPDATE user_payment_methods
SET expiring_soon = true, expires_at = ?
WHERE stripe_source_id = ?;
```

---

### 5. **Booking Webhooks**
**URL**: `https://stripe-webhook-handler-production.workers.dev/webhooks/bookings`
**Purpose**: Handle offering bookings and credit usage

#### Events
```typescript
checkout.session.completed              // Offering purchased via Checkout
checkout.session.expired                // Checkout abandoned
checkout.session.async_payment_succeeded // Bank transfer completed
checkout.session.async_payment_failed    // Bank transfer failed
```

#### Business Logic
- **checkout.session.completed**:
  - Check if paid with credits or money
  - If credits: deduct from user balance
  - If money: follow payment flow
  - Create offering booking/registration
  - Send booking confirmation with calendar invite
  - Provision offering portal access
  - Send join instructions 24h before event

- **checkout.session.expired**:
  - Track abandoned bookings
  - Send reminder email with recovery link
  - Retarget with discount (if configured)

#### Credit Usage Flow
```typescript
async function handleOfferingBooking(session: CheckoutSession) {
  const userId = session.metadata.userId;
  const offeringId = session.metadata.offeringId;
  const paidWithCredits = session.metadata.paidWithCredits === 'true';

  if (paidWithCredits) {
    const offering = await db.offerings.findById(offeringId);

    // Deduct credits
    await db.userCredits.update({
      where: { userId, expired: false },
      data: {
        credits: { decrement: offering.creditCost },
        usedAt: new Date()
      }
    });

    // Track credit usage
    await db.creditTransactions.create({
      userId,
      offeringId,
      credits: offering.creditCost,
      type: 'debit',
      source: 'offering_booking'
    });
  }

  // Create booking
  await db.offeringBookings.create({
    userId,
    offeringId,
    status: 'confirmed',
    paymentMethod: paidWithCredits ? 'credits' : 'payment',
    checkoutSessionId: session.id
  });

  // Send confirmation
  await sendBookingConfirmation(userId, offeringId);
}
```

#### Database Updates
```sql
-- Deduct credits
UPDATE user_credits
SET credits = credits - ?,
    used_at = NOW()
WHERE user_id = ? AND expired = false
LIMIT 1;

-- Create booking
INSERT INTO offering_bookings (
  user_id, offering_id, status, payment_method, checkout_session_id
)
VALUES (?, ?, 'confirmed', ?, ?);

-- Grant offering portal access
INSERT INTO offering_portal_access (
  user_id, offering_id, granted_at, expires_at
)
VALUES (?, ?, NOW(), ?);
```

---

### 6. **Dispute Webhooks**
**URL**: `https://stripe-webhook-handler-production.workers.dev/webhooks/disputes`
**Purpose**: Handle chargebacks and fraud alerts

#### Events
```typescript
charge.dispute.created            // Customer filed dispute
charge.dispute.updated            // Dispute status changed
charge.dispute.closed             // Dispute resolved
radar.early_fraud_warning.created // Fraud detected
radar.early_fraud_warning.updated // Fraud alert updated
review.opened                     // Stripe opened review
review.closed                     // Review closed
```

#### Business Logic
- **charge.dispute.created**:
  - Alert admin immediately
  - Flag user account
  - Optionally revoke access (configurable)
  - Auto-submit evidence if available
  - Track dispute in database

- **charge.dispute.closed**:
  - If won: keep access, close ticket
  - If lost: refund issued, revoke access
  - Update fraud score
  - Learn from dispute for future prevention

- **radar.early_fraud_warning.created**:
  - Block user from new purchases
  - Flag for manual review
  - Send alert to admin
  - Increase security checks

#### Database Updates
```sql
-- Record dispute
INSERT INTO disputes (
  charge_id, user_id, stripe_dispute_id, status, reason, amount
)
VALUES (?, ?, ?, 'open', ?, ?);

-- Flag user
UPDATE users
SET fraud_flag = true, flagged_at = NOW(), flag_reason = ?
WHERE id = ?;

-- Revoke access if configured
UPDATE user_content_access
SET revoked = true, revoked_at = NOW(), revoke_reason = 'dispute'
WHERE user_id = ? AND content_id = ?;
```

---

## Implementation Details

### Webhook Signature Verification

**Critical**: Every webhook endpoint MUST verify Stripe signatures to prevent spoofing.

```typescript
import Stripe from 'stripe';

async function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string
): Promise<Stripe.Event> {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  try {
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      secret
    );
    return event;
  } catch (err) {
    throw new Error(`Webhook signature verification failed: ${err.message}`);
  }
}

// Usage in handler
app.post('/webhooks/payments', async (c) => {
  const signature = c.req.header('stripe-signature');
  const rawBody = await c.req.text();
  const secret = c.env.STRIPE_WEBHOOK_SECRET_PAYMENTS;

  const event = await verifyWebhookSignature(rawBody, signature, secret);

  // Handle event...
});
```

### Idempotency

**Stripe may send the same event multiple times**. Protect against duplicate processing:

```typescript
async function processWebhook(event: Stripe.Event, db: Database) {
  // Check if already processed
  const existing = await db.processedWebhooks.findById(event.id);
  if (existing) {
    return { success: true, message: 'Already processed', duplicate: true };
  }

  // Process the event
  await handleEvent(event);

  // Mark as processed
  await db.processedWebhooks.create({
    id: event.id,
    type: event.type,
    processedAt: new Date()
  });

  return { success: true, message: 'Processed', duplicate: false };
}
```

### Error Handling

**Stripe will retry failed webhooks**. Return appropriate status codes:

```typescript
app.post('/webhooks/payments', async (c) => {
  try {
    const event = await verifyWebhookSignature(...);
    const result = await processWebhook(event);

    // Success
    return c.json(result, 200);
  } catch (err) {
    if (err.message.includes('signature verification')) {
      // Don't retry on signature failures
      return c.json({ error: 'Invalid signature' }, 400);
    }

    // Transient errors - Stripe will retry
    obs.trackError(err);
    return c.json({ error: 'Processing failed' }, 500);
  }
});
```

### Async Processing

**Don't block webhook responses**. Queue heavy operations:

```typescript
app.post('/webhooks/subscriptions', async (c) => {
  const event = await verifyWebhookSignature(...);

  // Immediately acknowledge receipt
  c.json({ received: true }, 200);

  // Queue async processing (don't await)
  c.executionCtx.waitUntil(
    processSubscriptionEvent(event)
  );

  return c.res;
});
```

---

## Webhook Secrets Management

Each endpoint needs its own webhook secret:

### Environment Variables
```bash
# Production secrets
STRIPE_WEBHOOK_SECRET_PAYMENTS=whsec_...
STRIPE_WEBHOOK_SECRET_SUBSCRIPTIONS=whsec_...
STRIPE_WEBHOOK_SECRET_CONNECT=whsec_...
STRIPE_WEBHOOK_SECRET_CUSTOMERS=whsec_...
STRIPE_WEBHOOK_SECRET_BOOKINGS=whsec_...
STRIPE_WEBHOOK_SECRET_DISPUTES=whsec_...

# Test mode secrets (for development)
STRIPE_WEBHOOK_SECRET_PAYMENTS_TEST=whsec_...
STRIPE_WEBHOOK_SECRET_SUBSCRIPTIONS_TEST=whsec_...
# ... etc
```

### Setting Secrets
```bash
# Production
echo 'whsec_...' | gh secret set STRIPE_WEBHOOK_SECRET_PAYMENTS
echo 'whsec_...' | gh secret set STRIPE_WEBHOOK_SECRET_SUBSCRIPTIONS
# etc.

# Or via wrangler
wrangler secret put STRIPE_WEBHOOK_SECRET_PAYMENTS --env production
```

---

## Stripe Dashboard Configuration

### Create Webhooks

For each endpoint, create a webhook in Stripe Dashboard:

1. Go to **Developers → Webhooks → Add endpoint**
2. **Endpoint URL**: `https://stripe-webhook-handler-production.workers.dev/webhooks/payments`
3. **API Version**: Select `2025-09-30.clover`
4. **Events to send**: Select specific events (see tables above)
5. Click **Add endpoint**
6. **Copy the Signing secret** (starts with `whsec_`)
7. Set as environment variable

Repeat for each of the 6 endpoints.

---

## Testing Strategy

### 1. Local Testing with Stripe CLI

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local dev
stripe listen --forward-to localhost:8787/webhooks/payments \
  --events payment_intent.succeeded,charge.succeeded

# Trigger test event
stripe trigger payment_intent.succeeded
```

### 2. Unit Tests

```typescript
// Example test
describe('Payment Webhook Handler', () => {
  it('should grant content access on payment_intent.succeeded', async () => {
    const event = createTestEvent('payment_intent.succeeded', {
      metadata: { userId: '123', contentId: '456' }
    });

    const result = await handlePaymentWebhook(event, mockEnv);

    expect(result.success).toBe(true);
    expect(mockDb.userContentAccess.create).toHaveBeenCalled();
  });

  it('should revoke access on charge.refunded', async () => {
    const event = createTestEvent('charge.refunded', {
      metadata: { userId: '123', contentId: '456' }
    });

    const result = await handlePaymentWebhook(event, mockEnv);

    expect(result.success).toBe(true);
    expect(mockDb.userContentAccess.revoke).toHaveBeenCalled();
  });
});
```

### 3. Integration Tests

Test with real Stripe test mode events:

```typescript
// In CI/CD
test('processes subscription renewal end-to-end', async () => {
  // Create test subscription
  const subscription = await stripe.subscriptions.create({
    customer: testCustomerId,
    items: [{ price: testPriceId }]
  });

  // Wait for webhook
  await waitForWebhook('customer.subscription.created');

  // Verify database state
  const dbSub = await db.subscriptions.findByStripeId(subscription.id);
  expect(dbSub.status).toBe('active');

  // Verify credits allocated
  const credits = await db.userCredits.findByUserId(testUserId);
  expect(credits.credits).toBe(2); // tier's monthly credits
});
```

---

## Monitoring & Alerting

### Metrics to Track

1. **Webhook Receipt Rate**: Events/minute per endpoint
2. **Processing Time**: p50, p95, p99 latency
3. **Error Rate**: Failed events / total events
4. **Duplicate Rate**: Duplicate events received
5. **Signature Failures**: Invalid signature attempts

### Alerts to Configure

- Webhook processing time > 5 seconds (p95)
- Error rate > 5% (5-minute window)
- No webhooks received in 1 hour (production)
- Signature verification failures > 10/hour
- Dispute created (immediate alert)

### Logging

```typescript
// Structured webhook logging
obs.info('Webhook received', {
  eventId: event.id,
  eventType: event.type,
  livemode: event.livemode,
  endpoint: '/webhooks/payments'
});

obs.info('Webhook processed', {
  eventId: event.id,
  duration: processingTime,
  success: true,
  actionsT taken: ['granted_access', 'sent_email']
});
```

---

## Database Schema

### Tables Needed

```sql
-- Track processed webhooks (idempotency)
CREATE TABLE processed_webhooks (
  id VARCHAR(255) PRIMARY KEY,  -- Stripe event ID
  type VARCHAR(100) NOT NULL,
  processed_at TIMESTAMP NOT NULL,
  endpoint VARCHAR(100) NOT NULL,
  INDEX idx_processed_at (processed_at)
);

-- Track disputes
CREATE TABLE disputes (
  id SERIAL PRIMARY KEY,
  stripe_dispute_id VARCHAR(255) UNIQUE NOT NULL,
  charge_id VARCHAR(255) NOT NULL,
  user_id UUID NOT NULL,
  amount INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL,
  reason VARCHAR(100),
  created_at TIMESTAMP NOT NULL,
  closed_at TIMESTAMP,
  INDEX idx_user_disputes (user_id),
  INDEX idx_charge_disputes (charge_id)
);

-- Track media owner earnings
CREATE TABLE media_owner_earnings (
  id SERIAL PRIMARY KEY,
  media_owner_id UUID NOT NULL,
  content_id UUID NOT NULL,
  charge_id VARCHAR(255) NOT NULL,
  total_amount INTEGER NOT NULL,
  platform_fee INTEGER NOT NULL,
  earned_amount INTEGER NOT NULL,
  status VARCHAR(50) NOT NULL,
  payout_id VARCHAR(255),
  created_at TIMESTAMP NOT NULL,
  INDEX idx_media_owner (media_owner_id),
  INDEX idx_payout (payout_id)
);

-- Track credit transactions
CREATE TABLE credit_transactions (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  offering_id UUID,
  credits INTEGER NOT NULL,
  type VARCHAR(20) NOT NULL, -- 'credit' or 'debit'
  source VARCHAR(50) NOT NULL, -- 'subscription', 'purchase', 'offering_booking'
  transaction_date TIMESTAMP NOT NULL,
  INDEX idx_user_credits (user_id),
  INDEX idx_offering (offering_id)
);
```

---

## Rollout Plan

### Phase 1: Core Payments (Week 1)
- ✅ Implement `/webhooks/payments` endpoint
- ✅ Handle `payment_intent.succeeded` and `charge.refunded`
- ✅ Test with real purchases
- ✅ Monitor for errors

### Phase 2: Subscriptions (Week 2)
- ✅ Implement `/webhooks/subscriptions` endpoint
- ✅ Handle subscription lifecycle
- ✅ Implement credit allocation logic
- ✅ Test tier changes and renewals

### Phase 3: Connect/Revenue Sharing (Week 3)
- ✅ Implement `/webhooks/connect` endpoint
- ✅ Handle Media Owner payouts
- ✅ Test revenue splits
- ✅ Verify payout tracking

### Phase 4: Remaining Endpoints (Week 4)
- ✅ Implement `/webhooks/customers`
- ✅ Implement `/webhooks/bookings`
- ✅ Implement `/webhooks/disputes`
- ✅ Full integration testing

---

## Troubleshooting

### Common Issues

**1. Signature verification fails**
- Check raw body is passed (not parsed JSON)
- Verify correct secret for endpoint
- Check Stripe API version matches

**2. Duplicate events**
- Ensure idempotency check is working
- Check `processed_webhooks` table

**3. Webhook not receiving events**
- Verify endpoint URL is accessible
- Check Stripe Dashboard → Webhooks → Recent deliveries
- Verify events are selected for endpoint

**4. Processing timeout**
- Move heavy operations to async queue
- Return 200 response immediately
- Use `waitUntil` for background processing

---

## Security Best Practices

1. **Always verify signatures** - Never skip this step
2. **Use HTTPS** - Webhooks must be over HTTPS
3. **Rate limiting** - Prevent abuse
4. **Idempotency** - Protect against duplicate processing
5. **Least privilege** - Each endpoint only needs specific events
6. **Secret rotation** - Rotate webhook secrets periodically
7. **Audit logging** - Log all webhook receipts
8. **Error handling** - Don't expose internal errors in responses

---

## Next Steps

1. **Review this architecture** with team
2. **Set up Stripe webhooks** in Dashboard
3. **Implement payment webhook** first (highest priority)
4. **Add comprehensive logging** for debugging
5. **Create monitoring dashboard** for webhook health
6. **Document error codes** and recovery procedures
7. **Train team** on webhook architecture

---

**Questions? Issues?**

See [DEPLOYMENT_GUIDE.md](.github/DEPLOYMENT_GUIDE.md) or [RUNBOOK.md](.github/RUNBOOK.md) for operational procedures.

**Last Updated**: 2025-01-30
**Maintainer**: Development Team
