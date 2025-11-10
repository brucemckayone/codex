# Work Packet: P1-ECOM-002 - Stripe Webhook Handlers

**Status**: 🚧 To Be Implemented
**Priority**: P0 (Critical - purchase fulfillment)
**Estimated Effort**: 2-3 days
**Branch**: `feature/P1-ECOM-002-stripe-webhooks`

---

## Current State

**✅ Already Implemented:**
- Webhook worker skeleton with all endpoints (`workers/stripe-webhook-handler/src/index.ts`)
- Signature verification middleware (`workers/stripe-webhook-handler/src/middleware/verify-signature.ts`)
- Webhook event schemas for validation (`workers/stripe-webhook-handler/src/schemas/*.ts`)
- Security middleware (headers, rate limiting, CSP)
- Observability logging

**🚧 Needs Implementation:**
- Actual event handlers (currently just return `{ received: true }`)
- Link to purchase service from P1-ECOM-001
- Error handling and retry logic
- Tests

---

## Dependencies

### Required Work Packets
- **P1-ECOM-001** (Stripe Checkout) - MUST complete first for `purchaseService`

### Existing Code
```typescript
// Already available in workers/stripe-webhook-handler/src/index.ts
app.post('/webhooks/stripe/payment', verifyStripeSignature(), async (c) => {
  const event = c.get('stripeEvent') as Stripe.Event;
  // TODO: Implement handler
  return c.json({ received: true });
});
```

### Required Documentation
- Existing webhook handler: `workers/stripe-webhook-handler/src/index.ts`
- [E-Commerce TDD](../../features/e-commerce/ttd-dphase-1.md)
- [STANDARDS.md](../STANDARDS.md)

---

## Implementation Steps

### Step 1: Create Webhook Handlers Module

**Note**: Handlers are thin wrappers that route webhooks to purchase service. All business logic lives in `@codex/purchases` (separation of concerns).

**File**: `workers/stripe-webhook-handler/src/handlers/checkout.ts`

```typescript
import type Stripe from 'stripe';
import { getPurchaseService } from '@codex/purchases';
import { ObservabilityClient } from '@codex/observability';

/**
 * Handle checkout.session.completed webhook
 * Triggered when customer completes payment in Stripe Checkout
 */
export async function handleCheckoutSessionCompleted(
  event: Stripe.Event,
  env: { DATABASE_URL: string; STRIPE_SECRET_KEY: string; ENVIRONMENT: string }
): Promise<void> {
  const obs = new ObservabilityClient('stripe-webhook-checkout', env.ENVIRONMENT);

  const session = event.data.object as Stripe.Checkout.Session;

  obs.info('Processing checkout.session.completed', {
    eventId: event.id,
    sessionId: session.id,
    paymentStatus: session.payment_status,
  });

  // Skip if payment not completed yet
  if (session.payment_status !== 'paid') {
    obs.warn('Checkout session not paid yet', {
      sessionId: session.id,
      status: session.payment_status,
    });
    return; // Not an error - session might be processing
  }

  try {
    const purchaseService = getPurchaseService(env);
    await purchaseService.handleCheckoutCompleted(session);

    obs.info('Purchase fulfilled successfully', {
      sessionId: session.id,
      paymentIntentId: session.payment_intent as string,
      customerId: session.metadata?.customerId,
      contentId: session.metadata?.contentId,
    });
  } catch (err) {
    obs.trackError(err as Error, {
      sessionId: session.id,
      eventId: event.id,
      eventType: 'checkout.session.completed',
    });
    throw err; // Re-throw for Stripe retry (500 response)
  }
}

/**
 * Handle checkout.session.expired webhook
 * Triggered when checkout session expires (24h after creation)
 */
export async function handleCheckoutSessionExpired(
  event: Stripe.Event,
  env: { ENVIRONMENT: string }
): Promise<void> {
  const obs = new ObservabilityClient('stripe-webhook-checkout', env.ENVIRONMENT);

  const session = event.data.object as Stripe.Checkout.Session;

  obs.info('Checkout session expired', {
    eventId: event.id,
    sessionId: session.id,
    customerId: session.metadata?.customerId,
    contentId: session.metadata?.contentId,
  });

  // Note: We don't create purchase records until payment completes,
  // so expired sessions don't need cleanup. Just log for analytics.
}
```

### Step 2: Wire Up Handlers in Main Worker

**File**: `workers/stripe-webhook-handler/src/index.ts` (modify existing)

```typescript
import { handleCheckoutSessionCompleted, handleCheckoutSessionExpired } from './handlers/checkout';

// Replace existing payment webhook handler
app.post('/webhooks/stripe/payment', verifyStripeSignature(), async (c) => {
  const obs = new ObservabilityClient(
    'stripe-webhook-handler',
    c.env.ENVIRONMENT || 'development'
  );
  const event = c.get('stripeEvent') as Stripe.Event;

  obs.info('Payment webhook received', {
    type: event.type,
    id: event.id,
  });

  try {
    // Route to appropriate handler
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event, c.env);
        break;

      case 'checkout.session.expired':
        await handleCheckoutSessionExpired(event, c.env);
        break;

      case 'payment_intent.succeeded':
        obs.info('Payment intent succeeded', { id: event.data.object.id });
        // Additional logging, no action needed (checkout.session.completed is primary)
        break;

      case 'payment_intent.payment_failed':
        obs.warn('Payment intent failed', {
          id: event.data.object.id,
          error: event.data.object.last_payment_error?.message,
        });
        break;

      default:
        obs.info('Unhandled payment event type', { type: event.type });
    }

    return c.json({ received: true });
  } catch (err) {
    obs.trackError(err as Error, {
      eventType: event.type,
      eventId: event.id,
    });

    // Return 500 so Stripe will retry
    return c.json({
      error: { code: 'WEBHOOK_ERROR', message: 'Failed to process webhook' }
    }, 500);
  }
});
```

---

## Testing Strategy

**Test Specifications**: See `design/roadmap/testing/webhook-testing-definition.md` for comprehensive test patterns, including:
- Unit tests (handler logic, mocked purchase service)
- Integration tests (signature verification, full webhook flow)
- Webhook replay tests (idempotency, duplicate handling)
- Error handling tests (retry behavior, failure scenarios)
- Common testing patterns and mock webhook events

**To Run Tests**:
```bash
# Unit tests (fast, mocked purchase service)
pnpm --filter @workers/stripe-webhook-handler test

# Integration tests (with test DB, Stripe test signatures)
STRIPE_WEBHOOK_SECRET_PAYMENT=whsec_test_... DATABASE_URL=postgresql://... pnpm --filter @workers/stripe-webhook-handler test:integration

# All tests
pnpm test

# With coverage
pnpm test --coverage
```

---

## Definition of Done

### Code Implementation
- [ ] Webhook handlers created in `workers/stripe-webhook-handler/src/handlers/checkout.ts`
  - [ ] `handleCheckoutSessionCompleted()` - creates purchase via service
  - [ ] `handleCheckoutSessionExpired()` - logs expired sessions
  - [ ] Handlers call purchase service (separation of concerns)
  - [ ] Error handling returns 500 for Stripe retry
- [ ] Main worker updated in `workers/stripe-webhook-handler/src/index.ts`
  - [ ] Route `checkout.session.completed` to handler
  - [ ] Route `checkout.session.expired` to handler
  - [ ] Handle `payment_intent.succeeded` (log only)
  - [ ] Handle `payment_intent.payment_failed` (log warning)
  - [ ] Default case for unhandled events
- [ ] Signature verification working (already implemented, verified)

### Testing
- [ ] Unit tests passing (handler logic, mocked service)
  - [ ] `handleCheckoutSessionCompleted` - success case
  - [ ] `handleCheckoutSessionCompleted` - skip if not paid
  - [ ] `handleCheckoutSessionCompleted` - re-throw errors for retry
  - [ ] `handleCheckoutSessionExpired` - logs event
- [ ] Integration tests passing (full webhook flow)
  - [ ] Valid webhook with correct signature → 200
  - [ ] Invalid signature → 400
  - [ ] Missing signature → 400
  - [ ] Malformed payload → 400
  - [ ] Handler throws error → 500 (Stripe retries)
- [ ] Idempotency verified (duplicate webhooks handled by purchase service)

### Quality & Security
- [ ] Signature verification enforced (middleware already implemented)
- [ ] Error handling comprehensive (re-throw for Stripe retry)
- [ ] Observability logging comprehensive
  - [ ] All webhook events logged
  - [ ] No PII in logs (only IDs)
- [ ] Purchase service idempotency working (payment_intent_id as key)
- [ ] TypeScript types for Stripe events

### Documentation
- [ ] Handler functions documented
- [ ] Event routing documented
- [ ] Error handling behavior documented
- [ ] Stripe retry behavior explained
- [ ] Integration with P1-ECOM-001 documented

### DevOps
- [ ] CI passing (tests + typecheck + lint)
- [ ] No new ESLint warnings
- [ ] No new TypeScript errors
- [ ] Code reviewed against STANDARDS.md
- [ ] Branch deployed to staging
- [ ] Webhook endpoint configured in Stripe dashboard

---

## Interfaces & Integration Points

### Upstream Dependencies

**Stripe API** (Webhook Events):
- **Dependency**: Stripe sends webhook events when payment events occur
- **Events Handled**:
  - `checkout.session.completed` - Payment successful, create purchase
  - `checkout.session.expired` - Checkout abandoned after 24h
  - `payment_intent.succeeded` - Payment confirmed (log only, checkout.session.completed is primary)
  - `payment_intent.payment_failed` - Payment declined (log warning)
- **Webhook Signature**: HMAC-SHA256 signature in `stripe-signature` header
- **Webhook Secret**: `STRIPE_WEBHOOK_SECRET_PAYMENT` (configured in Stripe dashboard)
- **Retry Behavior**: Stripe retries on 5xx responses with exponential backoff (up to 3 days)

**P1-ECOM-001** (Purchase Service):
- **Dependency**: Webhook handler calls purchase service to create purchase records
- **Method**: `purchaseService.handleCheckoutCompleted(session)`
- **Integration**:
```typescript
const purchaseService = getPurchaseService(env);
await purchaseService.handleCheckoutCompleted(session);
```
- **Idempotency**: Service handles duplicate webhooks via `payment_intent_id` check
- **Required Metadata**: `customerId`, `contentId`, `creatorId`, `priceCents` (set by P1-ECOM-001 when creating checkout)

**Signature Verification Middleware**:
- **Dependency**: Already implemented in `workers/stripe-webhook-handler/src/middleware/verify-signature.ts`
- **Function**: `verifyStripeSignature()` middleware validates webhook signature
- **Integration**: Applied to all webhook routes
- **Security**: Rejects webhooks with invalid/missing signatures (400 response)

### Downstream Consumers

**P1-NOTIFY-001** (Email Service) - Future:
- **Consumes**: Purchase completion event (indirectly via purchase service)
- **Trigger**: After purchase record created, purchase service calls email service
- **Email**: Purchase confirmation to customer
- **TODO**: Wire up email service call in purchase service

**P1-ADMIN-001** (Admin Dashboard):
- **Consumes**: Purchase records created by webhook handler
- **Access Pattern**: Platform owners view webhook processing metrics
- **Metrics**: Success rate, failure rate, retry count
- **Use Case**: Monitoring webhook health

### Error Propagation

| Handler Error | HTTP Status | Stripe Behavior | Recovery |
|---------------|-------------|-----------------|----------|
| Signature verification failed | 400 | No retry | Fix webhook secret configuration |
| Missing signature | 400 | No retry | Configure webhook in Stripe dashboard |
| Malformed payload | 400 | No retry | Investigate Stripe event format change |
| Purchase service error | 500 | Retry with backoff | Database/service will auto-recover |
| Payment not completed | 200 | No retry | Normal flow (session processing) |
| Session expired | 200 | No retry | Normal flow (log for analytics) |

**Stripe Retry Pattern**:
- Immediate retry after failure
- Retry after 5 minutes
- Retry after 30 minutes
- Retry after 1, 2, 4, 8, 16 hours
- Continues retrying for up to 3 days
- After 3 days: Marked as failed in Stripe dashboard

### Business Rules

1. **Only Process Paid Sessions**: Handler checks `session.payment_status === 'paid'`
   - Enforced in handler: Skip if not paid
   - Reason: Sessions can be in processing state

2. **Idempotency via Service**: Duplicate webhooks handled by purchase service
   - Enforced by: `payment_intent_id` UNIQUE constraint in database
   - Handler re-throws errors → Stripe retries → Service deduplicates

3. **Error Handling for Retry**: Handlers re-throw errors on failure
   - Pattern: `throw err;` at end of catch block
   - Result: Cloudflare Worker returns 500 → Stripe retries webhook

4. **Signature Verification Required**: All webhooks must have valid signature
   - Enforced by: `verifyStripeSignature()` middleware
   - Security: Prevents malicious webhook injection

### Data Flow Examples

**Successful Purchase Flow**:
```
Stripe                Webhook Worker         Purchase Service      Database
  |                        |                       |                   |
  | webhook: checkout.     |                       |                   |
  | session.completed      |                       |                   |
  |----------------------->|                       |                   |
  |                        | verify signature      |                   |
  |                        | (middleware)          |                   |
  |                        | route to handler      |                   |
  |                        | check payment_status  |                   |
  |                        | call service          |                   |
  |                        |---------------------->|                   |
  |                        |                       | check idempotency |
  |                        |                       |------------------>|
  |                        |                       | create purchase   |
  |                        |                       |------------------>|
  |                        |<----------------------|                   |
  |<-----------------------|                       |                   |
  |    200 OK              |                       |                   |
```

**Duplicate Webhook Flow** (idempotency):
```
Stripe                Webhook Worker         Purchase Service      Database
  |                        |                       |                   |
  | webhook: checkout.     |                       |                   |
  | session.completed      |                       |                   |
  | (duplicate)            |                       |                   |
  |----------------------->|                       |                   |
  |                        | route to handler      |                   |
  |                        | call service          |                   |
  |                        |---------------------->|                   |
  |                        |                       | check payment_intent_id
  |                        |                       |------------------>|
  |                        |                       |  already exists   |
  |                        |                       |<------------------|
  |                        |<----------------------|                   |
  |<-----------------------|   (return early)       |                   |
  |    200 OK              |                       |                   |
```

**Error Retry Flow**:
```
Stripe                Webhook Worker         Purchase Service      Database
  |                        |                       |                   |
  | webhook: checkout.     |                       |                   |
  | session.completed      |                       |                   |
  |----------------------->|                       |                   |
  |                        | call service          |                   |
  |                        |---------------------->|                   |
  |                        |                       | DB error          |
  |                        |                       |------X            |
  |                        |<----------------------|                   |
  |<-----------------------|   throw error         |                   |
  |    500 ERROR           |                       |                   |
  |                        |                       |                   |
  | (5min later)           |                       |                   |
  | webhook: retry         |                       |                   |
  |----------------------->|                       |                   |
  |                        | call service          |                   |
  |                        |---------------------->|                   |
  |                        |                       | create purchase   |
  |                        |                       |------------------>|
  |                        |<----------------------|                   |
  |<-----------------------|                       |                   |
  |    200 OK              |                       |                   |
```

---

## Business Context

### Why This Matters

Webhook handling is the **fulfillment mechanism** for purchases - customers pay Stripe, webhooks create purchase records, customers get access. This work packet enables:

1. **Purchase Fulfillment**: Converts Stripe payments into platform purchases
2. **Async Processing**: Decouples payment from purchase creation (resilient to failures)
3. **Retry Resilience**: Stripe retries failed webhooks automatically
4. **Security**: Signature verification prevents malicious webhooks

### User Personas

**Customer** (indirect):
- Pays via Stripe Checkout
- Webhook creates purchase record
- Gets redirected back with success message
- Webhook failure → payment succeeds but no access (support issue)

**Creator**:
- Receives revenue when customer purchase is fulfilled
- Webhook failure → revenue delayed until retry succeeds
- Can see purchase analytics (webhook processing stats)

**Platform Owner**:
- Monitors webhook health (success rate, retry rate)
- Investigates webhook failures (logs, error tracking)
- Configures webhook endpoint in Stripe dashboard

### Business Rules (Expanded)

**Webhook Processing States**:
```
received → signature verified → routed → processed → 200 OK
                     ↓                        ↓
               400 (bad sig)            500 (error, retry)
```

**Event Priority**:
- **Primary**: `checkout.session.completed` - Creates purchase
- **Secondary**: `checkout.session.expired` - Logs expired sessions
- **Informational**: `payment_intent.succeeded` - Confirms payment (log only)
- **Warning**: `payment_intent.payment_failed` - Payment declined (log warning)

**Why checkout.session.completed vs payment_intent.succeeded?**
- `checkout.session.completed`: Includes full session metadata (customerId, contentId, etc.)
- `payment_intent.succeeded`: Only payment details (no business context)
- Phase 1: Use checkout.session.completed as primary event
- payment_intent events provide additional logging/confirmation

---

## Security Considerations

### Webhook Signature Verification

**Layer 1: Signature Verification Middleware**:
- Already implemented in `workers/stripe-webhook-handler/src/middleware/verify-signature.ts`
- Validates HMAC-SHA256 signature from Stripe
- Uses `STRIPE_WEBHOOK_SECRET_PAYMENT` secret
- Rejects invalid/missing signatures (400 response)

**Signature Construction** (Stripe's algorithm):
```
signature = HMAC-SHA256(
  timestamp + '.' + payload,
  STRIPE_WEBHOOK_SECRET_PAYMENT
)
```

**Verification Steps**:
1. Extract `stripe-signature` header
2. Parse signature components (timestamp, signatures)
3. Reconstruct expected signature
4. Compare with provided signature (constant-time comparison)
5. Check timestamp freshness (prevent replay attacks)

### Replay Attack Prevention

**Timestamp Validation**:
- Stripe includes timestamp in signature
- Middleware rejects webhooks older than 5 minutes
- Prevents replay of old webhook events

### Idempotency

**Payment Intent as Key**:
- Purchase service uses `stripe_payment_intent_id` as idempotency key
- Database UNIQUE constraint prevents duplicates
- Webhook handler doesn't track idempotency (service does)

### Threat Scenarios

| Threat | Mitigation |
|--------|------------|
| Malicious webhook injection | Signature verification (middleware) |
| Replay attack | Timestamp validation (< 5min) |
| Duplicate processing | Idempotency (payment_intent_id UNIQUE) |
| Man-in-the-middle | HTTPS + signature verification |
| Webhook secret leakage | Rotate secret in Stripe dashboard |

---

## Performance Considerations

### Expected Load (Phase 1)

- **Webhook Requests**: ~10-50 per day (same as purchases)
- **Processing Time**: ~50-200ms per webhook (database insert)
- **Retry Rate**: ~1-5% (transient failures)
- **Success Rate**: ~95-99% (first attempt)

### Webhook Processing Latency

- **Signature Verification**: ~5-10ms (HMAC computation)
- **Handler Routing**: ~1ms (switch statement)
- **Purchase Service Call**: ~50-100ms (database insert)
- **Total**: ~56-111ms (well under Stripe's timeout)

**Stripe Timeout**: 30 seconds (webhook must respond within 30s)

### Retry Impact

- Stripe retries on 500 response
- Exponential backoff (5min, 30min, 1h, 2h, 4h, 8h, 16h)
- Max retries over 3 days
- Impact: Delayed purchase fulfillment (customer support issue)

### Rate Limiting

**Cloudflare Worker**:
- Default: 100,000 requests/day per worker
- Webhook traffic: ~50 per day (Phase 1)
- Headroom: 2,000x current load

**Stripe Webhook Delivery**:
- No documented rate limit
- Sends webhooks as events occur
- Retries don't count against limits

---

## Monitoring & Observability

### Logging Strategy

**Webhook Receipt**:
```typescript
obs.info('Payment webhook received', {
  eventType: event.type,
  eventId: event.id,
});
```

**Handler Processing**:
```typescript
obs.info('Processing checkout.session.completed', {
  eventId: event.id,
  sessionId: session.id,
  paymentStatus: session.payment_status,
});
```

**Purchase Fulfillment**:
```typescript
obs.info('Purchase fulfilled successfully', {
  sessionId: session.id,
  paymentIntentId: session.payment_intent,
  customerId: session.metadata?.customerId,
  contentId: session.metadata?.contentId,
});
```

**Errors**:
```typescript
obs.trackError(err, {
  sessionId: session.id,
  eventId: event.id,
  eventType: 'checkout.session.completed',
});
```

### Metrics to Track

**Webhook Metrics**:
- `webhook.received.count` - Total webhooks received (by event type)
- `webhook.processed.count` - Successfully processed
- `webhook.failed.count` - Failed (returned 500)
- `webhook.signature_invalid.count` - Invalid signature (returned 400)
- `webhook.latency.p95` - 95th percentile processing time

**Event Type Metrics**:
- `webhook.checkout_completed.count` - Checkout sessions completed
- `webhook.checkout_expired.count` - Checkout sessions expired
- `webhook.payment_failed.count` - Payments declined

**Retry Metrics**:
- `webhook.retry.count` - Webhooks that required retry
- `webhook.retry.success.count` - Retries that eventually succeeded
- `webhook.retry.abandoned.count` - Retries that failed after 3 days

### Alerts

**Critical Alerts**:
- `webhook.failed.rate > 5%` - High failure rate (investigate database/service issues)
- `webhook.signature_invalid.rate > 1%` - Possible webhook secret mismatch
- `webhook.latency.p95 > 5000ms` - Slow processing (risk of Stripe timeout)

**Warning Alerts**:
- `webhook.retry.count > 10` in 1 hour - Unusual retry spike
- `webhook.received.count = 0` for 1 day - No webhooks (check Stripe configuration)

### Stripe Dashboard Monitoring

**Webhook Logs** (Stripe Dashboard):
- View webhook delivery attempts
- See response codes (200, 400, 500)
- Inspect retry schedule
- Manually retry failed webhooks

**Webhook Settings**:
- Endpoint URL: `https://codex.app/webhooks/stripe/payment`
- Events to send: `checkout.session.completed`, `checkout.session.expired`, etc.
- Webhook signing secret: `whsec_...`

---

## Rollout Plan

### Pre-Deployment

1. **Configure Stripe Webhook Endpoint**:
   - Go to Stripe Dashboard → Developers → Webhooks
   - Click "Add endpoint"
   - URL: `https://staging.codex.app/webhooks/stripe/payment` (staging first)
   - Events to send: `checkout.session.completed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`
   - Copy webhook signing secret: `whsec_...`

2. **Configure Cloudflare Worker Environment**:
```bash
# Set webhook secret in Cloudflare Worker environment
wrangler secret put STRIPE_WEBHOOK_SECRET_PAYMENT

# Paste webhook secret when prompted
```

3. **Verify Existing Signature Verification**:
```bash
# Check middleware exists
cat workers/stripe-webhook-handler/src/middleware/verify-signature.ts

# Run existing tests
pnpm --filter @workers/stripe-webhook-handler test
```

### Deployment Steps

1. **Deploy Code**:
   - Merge feature branch to main
   - CI builds and deploys to staging
   - Worker deployed automatically via Wrangler

2. **Test with Stripe CLI**:
```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Forward webhooks to local/staging worker
stripe listen --forward-to https://staging.codex.app/webhooks/stripe/payment

# Trigger test webhook
stripe trigger checkout.session.completed
```

3. **Verify Webhook Processing**:
   - Check logs for `Payment webhook received`
   - Check logs for `Purchase fulfilled successfully`
   - Verify purchase record created in database
   - Check Stripe dashboard for successful delivery (200)

4. **Monitor**:
   - Watch logs for errors
   - Check webhook success rate in Stripe dashboard
   - Verify purchase flow end-to-end (checkout → webhook → access)

### Rollback Plan

**If Issues Detected**:
1. **Code Rollback**: Revert deploy via CI
2. **Disable Webhook**: Disable endpoint in Stripe dashboard (stops webhook delivery)
3. **Manual Processing**: Use Stripe dashboard to manually retry failed webhooks after fix

**Rollback Criteria**:
- Webhook failure rate > 10%
- Signature verification failures
- Purchase records not being created
- Webhook processing latency > 10 seconds

---

## Known Limitations (Phase 1)

### Simplified Webhook Handling

1. **No Webhook Event Store**:
   - Phase 1: Webhooks processed immediately, not stored
   - Limitation: Cannot replay/debug historical webhooks
   - Future: Store webhook events in database for audit trail

2. **No Retry Tracking**:
   - Phase 1: Rely on Stripe retry mechanism
   - Limitation: Cannot see retry count in platform
   - Future: Track retry attempts in webhook_events table

3. **Limited Event Types**:
   - Phase 1: Only checkout and payment_intent events
   - Future: Handle refund, dispute, subscription events

### Missing Features

1. **No Webhook Dashboard**:
   - Phase 1: View webhook logs in Cloudflare/observability system
   - Future: Custom dashboard for webhook health

2. **No Manual Retry**:
   - Phase 1: Retry via Stripe dashboard only
   - Future: Platform UI to manually retry failed webhooks

3. **No Webhook Rate Limiting**:
   - Phase 1: Cloudflare's default rate limiting
   - Future: Custom rate limiting per webhook endpoint

### Technical Debt

1. **No Webhook Deduplication at Handler Level**:
   - Phase 1: Deduplication in purchase service only
   - Impact: Handler processes duplicate webhooks (service deduplicates)
   - Future: Add webhook event tracking to deduplicate at handler level

2. **No Dead Letter Queue**:
   - Phase 1: Webhooks fail after 3 days of retries
   - Impact: Manual investigation needed for permanently failed webhooks
   - Future: DLQ for webhooks that fail all retries

---

## Questions & Clarifications

### Resolved

**Q: Should we create purchase record before or after webhook?**
A: After webhook (in webhook handler). P1-ECOM-001 checkout doesn't create pending records to avoid abandoned cart clutter.

**Q: How to handle duplicate webhooks?**
A: Purchase service handles idempotency via `payment_intent_id` UNIQUE constraint. Handler doesn't track duplicates (service does).

**Q: Should handler return 500 or 200 on errors?**
A: Return 500 (re-throw error). This triggers Stripe retry with exponential backoff.

**Q: Which event is primary: checkout.session.completed or payment_intent.succeeded?**
A: `checkout.session.completed` is primary (includes full metadata). `payment_intent.succeeded` is informational (log only).

**Q: Should we store webhook events?**
A: Phase 1: No (simplicity). Rely on Stripe dashboard for webhook logs. Future: Store for audit trail.

### Open

**Q: How to handle webhooks that fail all retries (after 3 days)?**
Current: Stripe marks as failed in dashboard, no platform notification
- **Recommendation**: Phase 2 - monitor Stripe dashboard for permanently failed webhooks, manual investigation

**Q: Should we rate limit webhook endpoint?**
Current: Cloudflare default rate limiting (100k/day per worker)
- **Recommendation**: Phase 1 - default is sufficient. Phase 2 - custom rate limiting if abuse detected

**Q: How to test webhooks locally?**
Current: Stripe CLI (`stripe listen --forward-to`)
- **Recommendation**: Use Stripe CLI for local development, test webhooks in CI with mocked signatures

---

## Success Criteria

### Functional Goals

- [ ] Webhook handler processes `checkout.session.completed` events
- [ ] Handler creates purchase via purchase service
- [ ] Handler skips sessions that aren't paid yet
- [ ] Handler logs `checkout.session.expired` events
- [ ] Signature verification rejects invalid webhooks (400)
- [ ] Error handling returns 500 (Stripe retries)
- [ ] Idempotency working (duplicate webhooks handled by service)
- [ ] Event routing works (switch statement routes to handlers)

### Non-Functional Goals

- [ ] Webhook processing latency < 200ms (p95)
- [ ] Signature verification latency < 10ms
- [ ] Webhook success rate > 95% (first attempt)
- [ ] All webhook events logged to observability
- [ ] No PII in logs (only IDs)
- [ ] 100% test coverage for handlers
- [ ] Integration tests verify signature verification

### Business Goals

- [ ] Purchases fulfilled automatically after payment
- [ ] Webhook failures trigger Stripe retry (resilient)
- [ ] P1-ECOM-001 checkout flow completes end-to-end
- [ ] Platform owners can monitor webhook health
- [ ] Duplicate webhooks don't create duplicate purchases
- [ ] Expired sessions logged for analytics

---

## Related Documentation

**Existing Code** (Already Implemented):
- Webhook worker skeleton: `workers/stripe-webhook-handler/src/index.ts`
- Signature verification: `workers/stripe-webhook-handler/src/middleware/verify-signature.ts`
- Event schemas: `workers/stripe-webhook-handler/src/schemas/payment.ts`

**Architecture & Patterns**:
- [STANDARDS.md](../STANDARDS.md) - Coding patterns
  - § 3.1: Error handling (retry behavior, error codes)
  - § 4.1: Observability (logging webhook events)
- [Stripe Integration Guide](../../infrastructure/StripeIntegration.md) - Stripe patterns
  - § 4: Webhook handling (signature verification, idempotency)
  - § 5: Retry behavior (exponential backoff, timeout)
  - § 6: Test mode webhooks (Stripe CLI)

**Testing Strategy**:
- [webhook-testing-definition.md](../testing/webhook-testing-definition.md) - Test specifications
  - Lines 1-80: Unit test patterns (handler logic)
  - Lines 81-160: Integration test patterns (signature verification)
  - Lines 161-240: Replay test patterns (idempotency)
  - Lines 241-300: Common mock webhook events
- [Testing.md](../../infrastructure/Testing.md) - General testing approach
  - § 5: Mocking external APIs (Stripe signatures)

**Feature Specifications**:
- [ttd-dphase-1.md](../../features/e-commerce/ttd-dphase-1.md) - E-commerce requirements
  - § 2: Webhook fulfillment (purchase creation)
  - § 4: Error handling (retry resilience)

**Related Work Packets**:
- [P1-ECOM-001](./P1-ECOM-001-stripe-checkout.md) - Webhook calls `handleCheckoutCompleted()` (upstream)
- [P1-NOTIFY-001](./P1-NOTIFY-001-email-service.md) - Send purchase confirmation (downstream, future)
- [P1-ADMIN-001](./P1-ADMIN-001-admin-dashboard.md) - Monitor webhook health (downstream)

**Infrastructure**:
- [CI/CD Guide](../../infrastructure/CICD.md) - Deployment automation
  - § 4: Cloudflare Worker deployment (Wrangler)
  - § 7: Environment secrets (webhook secret)
- [Observability](../../infrastructure/Observability.md) - Logging and metrics
  - § 2: PII redaction patterns
  - § 3: Webhook event logging

---

## Notes for LLM Developer

### Critical Patterns

1. **Thin Wrapper Pattern**: Handlers route to purchase service, don't contain business logic
   ```typescript
   // ✅ CORRECT - handler delegates to service
   export async function handleCheckoutSessionCompleted(event, env) {
     const purchaseService = getPurchaseService(env);
     await purchaseService.handleCheckoutCompleted(session);
   }

   // ❌ WRONG - business logic in handler
   export async function handleCheckoutSessionCompleted(event, env) {
     await db.insert(purchases).values({...}); // Business logic belongs in service!
   }
   ```

2. **Error Handling for Retry**: Re-throw errors to trigger Stripe retry
   ```typescript
   try {
     await purchaseService.handleCheckoutCompleted(session);
   } catch (err) {
     obs.trackError(err, { sessionId: session.id });
     throw err; // ✅ Re-throw for Stripe retry (500 response)
   }
   ```

3. **Signature Verification**: Already implemented as middleware, don't modify
   ```typescript
   // ✅ CORRECT - middleware already applied
   app.post('/webhooks/stripe/payment', verifyStripeSignature(), async (c) => {
     const event = c.get('stripeEvent'); // Already verified by middleware
   });
   ```

4. **Payment Status Check**: Skip sessions that aren't paid yet
   ```typescript
   if (session.payment_status !== 'paid') {
     obs.warn('Checkout session not paid yet', { sessionId: session.id });
     return; // ✅ Skip, not an error
   }
   ```

5. **Event Routing**: Use switch statement to route events to handlers
   ```typescript
   switch (event.type) {
     case 'checkout.session.completed':
       await handleCheckoutSessionCompleted(event, c.env);
       break;
     // ...other cases
   }
   ```

### Common Pitfalls

1. **Returning 200 on errors** (prevents Stripe retry):
   ```typescript
   // ❌ WRONG - Stripe won't retry
   try {
     await handleCheckoutSessionCompleted(event, env);
   } catch (err) {
     obs.trackError(err);
     return c.json({ error: 'Failed' }, 200); // ❌ Stripe thinks it succeeded!
   }

   // ✅ CORRECT - Stripe retries on 500
   try {
     await handleCheckoutSessionCompleted(event, env);
   } catch (err) {
     obs.trackError(err);
     throw err; // ✅ Worker returns 500, Stripe retries
   }
   ```

2. **Treating unpaid sessions as errors**:
   ```typescript
   // ❌ WRONG - throws error for processing sessions
   if (session.payment_status !== 'paid') {
     throw new Error('Not paid'); // ❌ This is normal, not an error
   }

   // ✅ CORRECT - skip gracefully
   if (session.payment_status !== 'paid') {
     obs.warn('Not paid yet', { status: session.payment_status });
     return; // ✅ Just skip, Stripe will send another webhook when paid
   }
   ```

3. **Adding business logic to webhook handler**:
   ```typescript
   // ❌ WRONG - business logic in handler
   export async function handleCheckoutSessionCompleted(event, env) {
     const amountPaidCents = parseInt(session.metadata.priceCents);
     await db.insert(purchases).values({
       customerId: session.metadata.customerId,
       amountPaidCents,
       // ... revenue split calculations ...
     });
   }

   // ✅ CORRECT - delegate to service
   export async function handleCheckoutSessionCompleted(event, env) {
     const purchaseService = getPurchaseService(env);
     await purchaseService.handleCheckoutCompleted(session); // Service handles logic
   }
   ```

4. **Not passing DATABASE_URL to purchase service**:
   ```typescript
   // ❌ WRONG - missing DATABASE_URL
   export async function handleCheckoutSessionCompleted(
     event: Stripe.Event,
     env: { STRIPE_SECRET_KEY: string; ENVIRONMENT: string }
   ) {
     const purchaseService = getPurchaseService(env); // ❌ Missing DATABASE_URL!
   }

   // ✅ CORRECT - include DATABASE_URL
   export async function handleCheckoutSessionCompleted(
     event: Stripe.Event,
     env: { DATABASE_URL: string; STRIPE_SECRET_KEY: string; ENVIRONMENT: string }
   ) {
     const purchaseService = getPurchaseService(env); // ✅ Has all required env vars
   }
   ```

5. **Modifying signature verification middleware**:
   ```typescript
   // ❌ WRONG - modifying existing middleware
   // DO NOT EDIT: workers/stripe-webhook-handler/src/middleware/verify-signature.ts

   // ✅ CORRECT - use existing middleware as-is
   app.post('/webhooks/stripe/payment', verifyStripeSignature(), handler);
   ```

### Stripe Retry Behavior

**HTTP Status Codes**:
- `200-299`: Success - Stripe won't retry
- `400-499`: Client error - Stripe won't retry (except 409 Conflict, 429 Rate Limit)
- `500-599`: Server error - Stripe WILL retry with exponential backoff

**Retry Schedule**:
- Immediate retry after failure
- Retry after 5 minutes
- Retry after 30 minutes
- Retry after 1, 2, 4, 8, 16 hours
- Continues for up to 3 days
- After 3 days: Marked as failed in Stripe dashboard (manual investigation needed)

### Testing Checklist

- [ ] Unit tests mock purchase service (no real DB calls)
- [ ] Unit tests verify `payment_status === 'paid'` check
- [ ] Unit tests verify error re-throwing
- [ ] Integration tests use Stripe test signatures
- [ ] Integration tests verify 400 for invalid signature
- [ ] Integration tests verify 500 for handler errors
- [ ] Test with Stripe CLI locally: `stripe trigger checkout.session.completed`

### If Stuck

- **Webhook patterns**: Check existing worker `workers/stripe-webhook-handler/src/index.ts`
- **Signature verification**: Check middleware `workers/stripe-webhook-handler/src/middleware/verify-signature.ts`
- **Purchase service**: Check `P1-ECOM-001` work packet for `handleCheckoutCompleted()` method
- **Stripe events**: Check [Stripe API docs](https://stripe.com/docs/api/events/types) for event schemas
- **Testing webhooks**: Use Stripe CLI (`stripe listen --forward-to`) for local testing

**Finding Documentation**: Use Context-7 map or [CONTEXT_MAP.md](../CONTEXT_MAP.md) for architecture navigation.

---

**Last Updated**: 2025-11-05
