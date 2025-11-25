# P1-ECOM-002: Stripe Webhook Handlers

**Priority**: P0 (Critical - purchase fulfillment)
**Status**: 🏗️ 50% Complete (Infrastructure ready, handlers needed)
**Estimated Effort**: 1-2 days (reduced from 2-3, skeleton exists)

---

## Table of Contents

- [Overview](#overview)
- [System Context](#system-context)
- [Implementation Patterns](#implementation-patterns)
- [Webhook Handler Architecture](#webhook-handler-architecture)
- [API Integration](#api-integration)
- [Available Patterns & Utilities](#available-patterns--utilities)
- [Dependencies](#dependencies)
- [Implementation Checklist](#implementation-checklist)
- [Testing Strategy](#testing-strategy)
- [Notes](#notes)

---

## Overview

Stripe Webhook Handlers receive real-time payment events from Stripe and complete the purchase flow by creating purchase records in the database. This service acts as the bridge between Stripe's payment processing and our purchase system.

The webhook infrastructure is **50% complete** - worker skeleton, signature verification, and security middleware are already implemented. What's needed is wiring the event handlers to call the PurchaseService (from P1-ECOM-001) to complete purchases.

Key capabilities:
- **Event Reception**: Receive webhook events from Stripe with signature verification
- **Purchase Fulfillment**: Complete purchase after successful payment
- **Idempotency**: Handle duplicate webhook calls safely
- **Error Handling**: Retry failed events with exponential backoff
- **Event Logging**: Track all webhook events for debugging and auditing

This service is consumed by:
- **Stripe**: Sends webhook events on payment completion
- **Purchase Service** (P1-ECOM-001): Called by webhook to create purchase records
- **Access Control** (P1-ACCESS-001): Indirectly - purchase record enables content access
- **Admin Dashboard** (P1-ADMIN-001): Webhook event logs for monitoring

---

## System Context

### Upstream Dependencies

**Stripe Webhook Service** (External):
- Sends `checkout.session.completed` event when payment succeeds
- Includes HMAC signature for verification
- Retries failed webhooks with exponential backoff

**Purchase Service** (P1-ECOM-001) (❌ Blocked):
- Provides `PurchaseService.completePurchase(paymentIntentId)` method
- Creates purchase record in database
- Handles idempotency via payment intent ID
- **Webhook handler cannot be implemented without this**

### Downstream Consumers

**Purchase Service** (P1-ECOM-001):
- Webhook calls `purchaseService.completePurchase()`
- Purchase service creates database record
- Integration: Webhook extracts payment intent ID from event, passes to service

**Observability System**:
- Logs all webhook events (success/failure)
- Tracks processing time and errors
- Integration: Used for monitoring and debugging

### External Services

**Stripe**: Sends webhook events
**Neon PostgreSQL**: Purchase records created via service
**Cloudflare Workers**: Webhook receiver

### Integration Flow

```
Stripe Payment Completes
    ↓
Stripe sends webhook (checkout.session.completed)
    ↓
Webhook Worker receives POST request
    ↓
Verify Signature Middleware (HMAC validation)
    ↓
Extract Event Data (payment intent ID, metadata)
    ↓
Call PurchaseService.completePurchase()
    ↓
Service creates purchase record (idempotent)
    ↓
Return 200 OK to Stripe
    ↓
Access Control can verify purchase exists
```

---

## Implementation Patterns

### Pattern 1: Thin Handler Pattern

**Problem**: Webhook handlers should be simple, business logic belongs in services

**Solution**: Handlers are thin wrappers that extract data and call services

```typescript
// BAD: Business logic in webhook handler
export async function handleCheckout(event: Stripe.Event, env: Env) {
  const session = event.data.object as Stripe.Checkout.Session;

  // ❌ Database queries in handler
  const existing = await db.query.purchases.findFirst({ ... });

  // ❌ Business logic in handler
  const amountPaidCents = session.amount_total!;
  const creatorPayoutCents = amountPaidCents; // Revenue split logic

  // ❌ Direct database writes in handler
  await db.insert(purchases).values({ ... });
}

// GOOD: Thin handler delegates to service
export async function handleCheckout(event: Stripe.Event, env: Env) {
  const session = event.data.object as Stripe.Checkout.Session;

  // ✅ Extract data
  const paymentIntentId = session.payment_intent as string;

  // ✅ Delegate to service (all business logic there)
  const purchaseService = createPurchaseService(env);
  await purchaseService.completePurchase(paymentIntentId);

  // ✅ Handler is <10 lines
}
```

### Pattern 2: Event Router Pattern

**Problem**: Multiple webhook events, each needs different handling

**Solution**: Router maps event types to handler functions

```typescript
// Event handler registry
const eventHandlers: Record<string, WebhookHandler> = {
  'checkout.session.completed': handleCheckoutCompleted,
  'payment_intent.succeeded': handlePaymentIntentSucceeded,
  'customer.subscription.created': handleSubscriptionCreated, // Phase 2
};

// Router dispatches to correct handler
export async function routeWebhookEvent(
  event: Stripe.Event,
  env: Env
): Promise<void> {
  const handler = eventHandlers[event.type];

  if (!handler) {
    // Unknown event type - log but don't error
    log.warn('Unknown webhook event type', { type: event.type });
    return;
  }

  await handler(event, env);
}

// Worker endpoint uses router
app.post('/webhooks/stripe/payment',
  verifyStripeSignature(), // Middleware validates HMAC
  async (c) => {
    const event = c.get('stripeEvent') as Stripe.Event;

    await routeWebhookEvent(event, c.env);

    return c.json({ received: true }, 200);
  }
);
```

### Pattern 3: Idempotency with Event ID Logging

**Problem**: Stripe may send same webhook multiple times, need to handle gracefully

**Solution**: Log event ID, service layer handles duplicate prevention

```typescript
export async function handleCheckoutCompleted(
  event: Stripe.Event,
  env: Env
): Promise<void> {
  const obs = new ObservabilityClient('webhook-handler', env.ENVIRONMENT);

  // Step 1: Log event received (with event ID for deduplication)
  obs.info('Webhook received', {
    eventId: event.id,        // Stripe's unique event ID
    eventType: event.type,
    created: event.created,
  });

  const session = event.data.object as Stripe.Checkout.Session;
  const paymentIntentId = session.payment_intent as string;

  // Step 2: Call service (service handles idempotency via payment intent ID)
  try {
    const purchaseService = createPurchaseService(env);
    const purchase = await purchaseService.completePurchase(paymentIntentId);

    // Step 3: Log success
    obs.info('Purchase completed', {
      eventId: event.id,
      purchaseId: purchase.id,
      paymentIntentId,
    });
  } catch (error) {
    // Step 4: Log error (Stripe will retry)
    obs.error('Purchase completion failed', error, {
      eventId: event.id,
      paymentIntentId,
    });

    throw error; // Rethrow so Stripe knows to retry
  }
}
```

### Pattern 4: Early Return for Invalid States

**Problem**: Webhooks may arrive for incomplete payments

**Solution**: Validate payment status before processing

```typescript
export async function handleCheckoutCompleted(
  event: Stripe.Event,
  env: Env
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;

  // Early return: Payment not completed yet
  if (session.payment_status !== 'paid') {
    log.warn('Payment not completed', {
      sessionId: session.id,
      status: session.payment_status,
    });
    return; // Not an error - just not ready yet
  }

  // Early return: Missing required metadata
  if (!session.metadata?.contentId || !session.metadata?.customerId) {
    log.error('Missing required metadata', {
      sessionId: session.id,
      metadata: session.metadata,
    });
    throw new ValidationError('Missing contentId or customerId in metadata');
  }

  // Proceed with purchase completion
  const paymentIntentId = session.payment_intent as string;
  const purchaseService = createPurchaseService(env);
  await purchaseService.completePurchase(paymentIntentId);
}
```

---

## Webhook Handler Architecture

### Handler Responsibilities

**Webhook Handlers** (thin wrappers in `workers/ecom-api/src/handlers/`):
- **Extract event data**: Payment intent ID, session ID, metadata
- **Validate event**: Check payment status, required fields
- **Call service layer**: Delegate to PurchaseService
- **Log events**: Success/failure for monitoring
- **Return 200 OK**: Signal to Stripe that webhook was received

**NOT handler responsibilities**:
- ❌ Database queries (service layer)
- ❌ Business logic (service layer)
- ❌ Revenue split calculations (service layer)
- ❌ Duplicate detection (service layer with DB constraints)

### Key Business Rules

1. **Payment Status Validation**:
   - Only process webhooks with `payment_status = 'paid'`
   - Early return for incomplete payments (not an error)

2. **Metadata Validation**:
   - Require `metadata.contentId` and `metadata.customerId`
   - These are set during checkout session creation (P1-ECOM-001)
   - Throw error if missing (indicates bug in checkout flow)

3. **Idempotency**:
   - Stripe may send same event multiple times
   - Handler calls service with payment intent ID
   - Service handles duplicate prevention via unique constraint

4. **Error Handling**:
   - Throw error if purchase fails (Stripe will retry)
   - Log all errors for debugging
   - Don't throw for incomplete payments (early return)

---

## Pseudocode: Checkout Completed Handler

```
FUNCTION handleCheckoutCompleted(event, environment):
  // Step 1: Initialize logging
  logger = CREATE ObservabilityClient('webhook-handler', environment)

  // Step 2: Log event received
  LOG.info("Webhook received", {
    eventId: event.id,
    eventType: event.type,
    created: event.created
  })

  // Step 3: Extract session data
  session = event.data.object AS Stripe.Checkout.Session

  // Step 4: Validate payment status (early return)
  IF session.payment_status != 'paid':
    LOG.warn("Payment not completed yet", {
      sessionId: session.id,
      status: session.payment_status
    })
    RETURN  // Not an error, just not ready
  END IF

  // Step 5: Validate required metadata
  IF session.metadata.contentId IS NULL OR session.metadata.customerId IS NULL:
    LOG.error("Missing required metadata", {
      sessionId: session.id,
      metadata: session.metadata
    })
    THROW ValidationError("Missing contentId or customerId")
  END IF

  // Step 6: Extract payment intent ID
  paymentIntentId = session.payment_intent AS string

  // Step 7: Call purchase service (idempotent)
  TRY:
    purchaseService = createPurchaseService(environment)
    purchase = purchaseService.completePurchase(paymentIntentId)

    // Step 8: Log success
    LOG.info("Purchase completed successfully", {
      eventId: event.id,
      purchaseId: purchase.id,
      paymentIntentId: paymentIntentId,
      customerId: session.metadata.customerId,
      contentId: session.metadata.contentId
    })
  CATCH error:
    // Step 9: Log error and rethrow (Stripe will retry)
    LOG.error("Purchase completion failed", error, {
      eventId: event.id,
      paymentIntentId: paymentIntentId
    })

    THROW error  // Stripe retries on non-200 response
  END TRY
END FUNCTION
```

---

## API Integration

### Endpoints

| Method | Path | Purpose | Security |
|--------|------|---------|----------|
| POST | `/webhooks/stripe/payment` | Receive payment webhooks | Signature verification |
| POST | `/webhooks/stripe/subscription` | Receive subscription webhooks (Phase 2) | Signature verification |

### Existing Infrastructure

**Already Implemented** (50% complete):
- Webhook worker skeleton (`workers/ecom-api/src/index.ts`)
- Signature verification middleware (`src/middleware/verify-signature.ts`)
- Security headers, rate limiting, CORS
- Observability logging

**What's Needed**:
- Handler implementations (currently return `{ received: true }`)
- Import PurchaseService from P1-ECOM-001
- Wire handlers to service calls

### Signature Verification Middleware

**Already implemented** - validates HMAC signature from Stripe:

```typescript
// workers/ecom-api/src/middleware/verify-signature.ts
export function verifyStripeSignature() {
  return async (c: Context, next: Next) => {
    const signature = c.req.header('stripe-signature');
    const webhookSecret = c.env.STRIPE_WEBHOOK_SECRET_PAYMENT;

    if (!signature || !webhookSecret) {
      return c.json({ error: 'Missing signature' }, 401);
    }

    const body = await c.req.text();

    try {
      const event = stripe.webhooks.constructEvent(
        body,
        signature,
        webhookSecret
      );

      c.set('stripeEvent', event);
      await next();
    } catch (err) {
      return c.json({ error: 'Invalid signature' }, 401);
    }
  };
}
```

### Handler Implementation Example

```typescript
// workers/ecom-api/src/handlers/checkout.ts
import type Stripe from 'stripe';
import { createPurchaseService } from '@codex/purchase';
import { ObservabilityClient } from '@codex/observability';

export async function handleCheckoutCompleted(
  event: Stripe.Event,
  env: Env
): Promise<void> {
  const obs = new ObservabilityClient('webhook-checkout', env.ENVIRONMENT);

  obs.info('Processing checkout.session.completed', {
    eventId: event.id,
  });

  const session = event.data.object as Stripe.Checkout.Session;

  // Validate payment status
  if (session.payment_status !== 'paid') {
    obs.warn('Payment not completed', { sessionId: session.id });
    return;
  }

  // Extract payment intent ID
  const paymentIntentId = session.payment_intent as string;

  // Call purchase service (idempotent)
  try {
    const purchaseService = createPurchaseService(env);
    const purchase = await purchaseService.completePurchase(paymentIntentId);

    obs.info('Purchase fulfilled', {
      eventId: event.id,
      purchaseId: purchase.id,
    });
  } catch (error) {
    obs.error('Purchase failed', error);
    throw error; // Stripe retries
  }
}
```

### Worker Route Example

```typescript
// workers/ecom-api/src/index.ts
import { createWorker } from '@codex/worker-utils';
import { verifyStripeSignature } from './middleware/verify-signature';
import { handleCheckoutCompleted } from './handlers/checkout';

const app = createWorker({
  serviceName: 'ecom-api',
  enableCors: false, // Webhooks don't need CORS
  enableSecurityHeaders: true,
});

app.post('/webhooks/stripe/payment',
  verifyStripeSignature(), // Validates HMAC signature
  async (c) => {
    const event = c.get('stripeEvent') as Stripe.Event;

    // Route to appropriate handler
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(event, c.env);
    } else {
      // Unknown event type - log but don't error
      console.warn('Unknown event type:', event.type);
    }

    return c.json({ received: true }, 200);
  }
);

export default app;
```

---

## Available Patterns & Utilities

### Foundation Packages

#### `@codex/purchase` (from P1-ECOM-001)

**PurchaseService** (to be used by webhook):
```typescript
import { createPurchaseService } from '@codex/purchase';

const purchaseService = createPurchaseService(env);

// Call from webhook handler
const purchase = await purchaseService.completePurchase(paymentIntentId);
```

**When to use**: Webhook handler calls this to create purchase record. Service handles all business logic and idempotency.

---

#### `@codex/observability`

**Logging**:
```typescript
const obs = new ObservabilityClient('webhook-handler', env.ENVIRONMENT);

// Log webhook received
obs.info('Webhook received', {
  eventId: event.id,
  eventType: event.type,
});

// Log purchase completion
obs.info('Purchase completed', {
  eventId: event.id,
  purchaseId: purchase.id,
});

// Log errors
obs.error('Purchase failed', error, {
  eventId: event.id,
  paymentIntentId,
});
```

**When to use**: Log all webhook events for monitoring and debugging. Critical for tracking payment issues.

---

#### `@codex/worker-utils`

**Worker Setup** (already done):
```typescript
import { createWorker } from '@codex/worker-utils';

const app = createWorker({
  serviceName: 'ecom-api',
  enableCors: false,
  enableSecurityHeaders: true,
});
```

**When to use**: Worker is already set up. Just add handler logic.

---

### External SDKs

#### Stripe SDK

**Signature Verification** (already implemented):
```typescript
import Stripe from 'stripe';

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

// Verify webhook signature
const event = stripe.webhooks.constructEvent(
  body,
  signature,
  webhookSecret
);
```

**When to use**: Signature verification middleware already uses this. No additional Stripe calls needed in handlers.

---

## Dependencies

### Required (Blocking)

| Dependency | Status | Description |
|------------|--------|-------------|
| Purchase Service (P1-ECOM-001) | ❌ **BLOCKED** | Need `PurchaseService.completePurchase()` method. **Webhook handler cannot be implemented without this.** |
| Stripe Account | ✅ Available | Webhook secret configured |
| Webhook Worker Skeleton | ✅ Available | Infrastructure 50% complete |

### Infrastructure Ready

- ✅ Worker skeleton (`workers/ecom-api/`)
- ✅ Signature verification middleware
- ✅ Security headers and rate limiting
- ✅ Observability logging
- ✅ Webhook event schemas

### Critical Blocker

**P1-ECOM-001 (Stripe Checkout) must be completed first**. The webhook handler needs to call `PurchaseService.completePurchase()`, which is implemented in that work packet.

**Estimated effort reduced from 2-3 days to 1-2 days** because infrastructure is already built. Implementation is just wiring handlers to service calls.

---

## Implementation Checklist

- [ ] **Handler Implementation**
  - [ ] Create `workers/ecom-api/src/handlers/checkout.ts`
  - [ ] Implement `handleCheckoutCompleted()` function
  - [ ] Extract payment intent ID from event
  - [ ] Validate payment status and metadata
  - [ ] Call `purchaseService.completePurchase()`
  - [ ] Add comprehensive logging
  - [ ] Add error handling (rethrow for Stripe retry)

- [ ] **Worker Integration**
  - [ ] Import handler in `src/index.ts`
  - [ ] Wire handler to webhook endpoint
  - [ ] Test signature verification
  - [ ] Verify 200 OK response

- [ ] **Testing**
  - [ ] Unit test handler with mocked service
  - [ ] Test signature verification (valid/invalid)
  - [ ] Test payment status validation
  - [ ] Test metadata validation
  - [ ] Test error handling (service throws)
  - [ ] Integration test with Stripe CLI

- [ ] **Deployment**
  - [ ] Configure STRIPE_WEBHOOK_SECRET_PAYMENT in Cloudflare
  - [ ] Test in preview environment with Stripe test mode
  - [ ] Set up webhook endpoint in Stripe dashboard
  - [ ] Deploy to production
  - [ ] Monitor webhook events in Stripe dashboard

---

## Testing Strategy

### Unit Tests

**Handler Tests** (`workers/ecom-api/src/handlers/__tests__/`):
- Test checkout completed handler
- Mock PurchaseService
- Test payment status validation (paid vs unpaid)
- Test metadata validation (missing contentId/customerId)
- Test error handling (service throws)

### Integration Tests

**Webhook Endpoint Tests**:
- Test signature verification (valid signature)
- Test signature verification (invalid signature → 401)
- Test unknown event type (logs warning, returns 200)
- Test successful purchase completion
- Mock Stripe events with test data

### Local Development Testing

**Tools**:
- **Stripe CLI**: `stripe listen --forward-to localhost:8787/webhooks/stripe/payment`
- **Trigger test events**: `stripe trigger checkout.session.completed`
- **View webhook logs**: Stripe dashboard

**Test Scenarios**:
1. Trigger checkout completed event
2. Verify handler logs event reception
3. Verify purchase service called with correct payment intent ID
4. Verify 200 OK response returned to Stripe

### E2E Testing

**Full Payment Flow**:
1. Create checkout session (P1-ECOM-001)
2. Complete payment in Stripe test mode
3. Stripe sends webhook to local endpoint
4. Handler processes webhook
5. Purchase record created in database
6. Access service verifies purchase exists

---

## Notes

### Infrastructure Already Built

**50% Complete**:
- ✅ Worker skeleton with all endpoints
- ✅ Signature verification middleware
- ✅ Security headers, rate limiting
- ✅ Observability logging
- ✅ Webhook event schemas

**What's Needed** (50% remaining):
- Handler implementations (~100 lines of code)
- Import PurchaseService from P1-ECOM-001
- Wire handlers to endpoints

### Reduced Effort Estimate

Original: 2-3 days
Revised: 1-2 days

**Reason**: Infrastructure is already built. Implementation is straightforward - extract data, call service, log result.

### Stripe Webhook Retry Logic

**Automatic Retries**:
- Stripe retries webhooks that don't return 200 OK
- Exponential backoff: 1min, 5min, 30min, 2hr, 5hr, 10hr, 24hr
- Retries for up to 3 days

**Our Implementation**:
- Return 200 OK for all received events (even unknown types)
- Throw error only if purchase completion fails
- Service layer handles idempotency (duplicate webhooks are safe)

### Security Considerations

**Signature Verification**:
- HMAC-SHA256 signature from Stripe
- Prevents webhook spoofing
- Already implemented in middleware

**No Authentication Required**:
- Webhooks use signature verification instead of auth tokens
- CORS disabled (only Stripe should call this endpoint)

### Performance Considerations

**Expected Load** (Phase 1):
- Webhook calls: ~10-100/day (matches purchase volume)
- Processing time: < 100ms (database insert via service)
- No rate limiting needed (Stripe controls send rate)

---

**Last Updated**: 2025-11-23
**Version**: 2.0 (Enhanced with implementation patterns and infrastructure status)
