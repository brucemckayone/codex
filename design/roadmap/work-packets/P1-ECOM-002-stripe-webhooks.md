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

**File**: `workers/stripe-webhook-handler/src/handlers/checkout.ts`

```typescript
import type Stripe from 'stripe';
import { getPurchaseService } from '@codex/purchases';
import { ObservabilityClient } from '@codex/observability';

export async function handleCheckoutSessionCompleted(
  event: Stripe.Event,
  env: { STRIPE_SECRET_KEY: string; ENVIRONMENT: string }
): Promise<void> {
  const obs = new ObservabilityClient('stripe-webhook-checkout', env.ENVIRONMENT);

  const session = event.data.object as Stripe.Checkout.Session;

  obs.info('Processing checkout.session.completed', {
    sessionId: session.id,
    paymentStatus: session.payment_status,
  });

  if (session.payment_status !== 'paid') {
    obs.warn('Checkout session not paid', {
      sessionId: session.id,
      status: session.payment_status,
    });
    return;
  }

  try {
    const purchaseService = getPurchaseService(env);
    await purchaseService.handleCheckoutCompleted(session);

    obs.info('Purchase fulfilled', {
      sessionId: session.id,
      purchaseId: session.metadata?.purchaseId,
    });
  } catch (err) {
    obs.trackError(err as Error, {
      sessionId: session.id,
      event: 'checkout.session.completed',
    });
    throw err; // Re-throw for Stripe retry
  }
}

export async function handleCheckoutSessionExpired(
  event: Stripe.Event,
  env: { STRIPE_SECRET_KEY: string; ENVIRONMENT: string }
): Promise<void> {
  const obs = new ObservabilityClient('stripe-webhook-checkout', env.ENVIRONMENT);

  const session = event.data.object as Stripe.Checkout.Session;

  obs.info('Checkout session expired', {
    sessionId: session.id,
    purchaseId: session.metadata?.purchaseId,
  });

  // TODO: Mark purchase as failed if still pending
  // await markPurchaseExpired(session.metadata?.purchaseId);
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

### Step 3: Add Webhook Tests

**File**: `workers/stripe-webhook-handler/src/handlers/checkout.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCheckoutSessionCompleted } from './checkout';
import type Stripe from 'stripe';

describe('Checkout Webhook Handlers', () => {
  let mockPurchaseService: any;
  let mockEnv: { STRIPE_SECRET_KEY: string; ENVIRONMENT: string };

  beforeEach(() => {
    mockPurchaseService = {
      handleCheckoutCompleted: vi.fn().mockResolvedValue(undefined),
    };

    mockEnv = {
      STRIPE_SECRET_KEY: 'sk_test_mock',
      ENVIRONMENT: 'test',
    };

    // Mock getPurchaseService
    vi.mock('@codex/purchases', () => ({
      getPurchaseService: () => mockPurchaseService,
    }));
  });

  it('should handle checkout.session.completed', async () => {
    const mockEvent: Stripe.Event = {
      id: 'evt_test_123',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          payment_status: 'paid',
          payment_intent: 'pi_test_123',
          metadata: {
            purchaseId: 'purchase-123',
            customerId: 'user-123',
            contentId: 'content-123',
          },
        },
      },
    } as any;

    await handleCheckoutSessionCompleted(mockEvent, mockEnv);

    expect(mockPurchaseService.handleCheckoutCompleted).toHaveBeenCalledWith(
      mockEvent.data.object
    );
  });

  it('should skip processing if not paid', async () => {
    const mockEvent: Stripe.Event = {
      id: 'evt_test_123',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          payment_status: 'unpaid', // Not paid
          metadata: {},
        },
      },
    } as any;

    await handleCheckoutSessionCompleted(mockEvent, mockEnv);

    expect(mockPurchaseService.handleCheckoutCompleted).not.toHaveBeenCalled();
  });

  it('should re-throw errors for Stripe retry', async () => {
    const mockEvent: Stripe.Event = {
      id: 'evt_test_123',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          payment_status: 'paid',
          metadata: {},
        },
      },
    } as any;

    mockPurchaseService.handleCheckoutCompleted.mockRejectedValue(
      new Error('Database error')
    );

    await expect(
      handleCheckoutSessionCompleted(mockEvent, mockEnv)
    ).rejects.toThrow('Database error');
  });
});
```

### Step 4: Integration Test with Real Webhook

**File**: `workers/stripe-webhook-handler/src/index.integration.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import app from './index';
import Stripe from 'stripe';

describe('Webhook Integration', () => {
  it('should process checkout.session.completed webhook', async () => {
    const stripe = new Stripe('sk_test_mock', { apiVersion: '2024-11-20.acacia' });

    const event = {
      id: 'evt_test_123',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          payment_status: 'paid',
          payment_intent: 'pi_test_123',
          metadata: {
            purchaseId: 'purchase-123',
            customerId: 'user-123',
            contentId: 'content-123',
          },
        },
      },
    };

    // Generate test signature
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: JSON.stringify(event),
      secret: 'whsec_test_secret',
    });

    const request = new Request('http://localhost/webhooks/stripe/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': signature,
      },
      body: JSON.stringify(event),
    });

    const env = {
      STRIPE_SECRET_KEY: 'sk_test_mock',
      STRIPE_WEBHOOK_SECRET_PAYMENT: 'whsec_test_secret',
      ENVIRONMENT: 'test',
      DATABASE_URL: process.env.DATABASE_URL,
    };

    const response = await app.fetch(request, env);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.received).toBe(true);
  });

  it('should reject invalid signature', async () => {
    const event = {
      id: 'evt_test_123',
      type: 'checkout.session.completed',
      data: { object: {} },
    };

    const request = new Request('http://localhost/webhooks/stripe/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'invalid_signature',
      },
      body: JSON.stringify(event),
    });

    const env = {
      STRIPE_SECRET_KEY: 'sk_test_mock',
      STRIPE_WEBHOOK_SECRET_PAYMENT: 'whsec_test_secret',
      ENVIRONMENT: 'test',
    };

    const response = await app.fetch(request, env);

    expect(response.status).toBe(400);
  });
});
```

---

## Test Specifications

### Unit Tests (Handlers)
- `handleCheckoutSessionCompleted` - Success case
- `handleCheckoutSessionCompleted` - Skip if not paid
- `handleCheckoutSessionCompleted` - Re-throw errors for retry
- `handleCheckoutSessionExpired` - Log and mark failed

### Integration Tests (Full Webhook Flow)
- Valid webhook with correct signature → 200
- Invalid signature → 400
- Missing signature → 400
- Malformed payload → 400
- Handler throws error → 500 (for Stripe retry)

---

## Definition of Done

- [ ] Checkout handlers implemented in `handlers/checkout.ts`
- [ ] Main worker updated to route events to handlers
- [ ] Unit tests for handlers (100% coverage)
- [ ] Integration tests for webhook flow
- [ ] Error handling returns 500 for Stripe retry
- [ ] Observability logging comprehensive
- [ ] Idempotency verified (duplicate webhooks handled)
- [ ] Signature verification working
- [ ] CI passing (tests + typecheck + lint)

---

## Integration Points

### Depends On
- **P1-ECOM-001**: Uses `purchaseService.handleCheckoutCompleted()`

### Integrates With
- Existing webhook worker: `workers/stripe-webhook-handler/src/index.ts`
- Signature verification: `workers/stripe-webhook-handler/src/middleware/verify-signature.ts`
- Purchase service: `@codex/purchases`

### Future Integration
- **P1-NOTIFY-001**: Will trigger purchase confirmation email

---

## Related Documentation

**Must Read**:
- Existing webhook handler: `workers/stripe-webhook-handler/src/index.ts`
- [STANDARDS.md](../STANDARDS.md) - § 6 Error handling
- [E-Commerce TDD](../../features/e-commerce/ttd-dphase-1.md)

**Reference**:
- [Testing Strategy](../../infrastructure/Testing.md)
- [Observability package](../../../packages/observability/src/)

**Code Examples**:
- Signature verification: `workers/stripe-webhook-handler/src/middleware/verify-signature.ts`
- Event schemas: `workers/stripe-webhook-handler/src/schemas/payment.ts`

---

## Notes for LLM Developer

1. **MUST Complete P1-ECOM-001 First**: This packet depends on purchase service
2. **Error Handling**: Return 500 on errors so Stripe retries
3. **Idempotency**: Service already handles duplicates, but log them
4. **Signature Verification**: Already implemented, don't modify
5. **Test Mode**: Use Stripe test webhook secrets
6. **Logging**: Use observability package, redact sensitive data

**Stripe Retry Behavior**:
- 200/2xx: Success, Stripe won't retry
- 500/5xx: Failure, Stripe will retry with exponential backoff
- 400/4xx: Client error, Stripe won't retry (except 409/429)

**If Stuck**: Check [CONTEXT_MAP.md](../CONTEXT_MAP.md) or existing webhook handler code.

---

**Last Updated**: 2025-11-05
