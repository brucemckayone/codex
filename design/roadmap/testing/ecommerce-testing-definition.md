# E-Commerce Testing Definition

**Features**: Stripe Checkout (P1-ECOM-001), Stripe Webhooks (P1-ECOM-002)
**Last Updated**: 2025-11-05

---

## Overview

This document defines the testing strategy for e-commerce features, covering purchase flow, Stripe integration, and webhook handling.

**Key Testing Principles**:
- Mock Stripe SDK for unit tests
- Use Stripe test mode for integration tests
- Test idempotency (duplicate webhooks, duplicate purchases)
- Test webhook retry behavior (500 = retry, 200 = success)

---

## Test Categories

### 1. Validation Tests (Pure Functions)

**Location**: `packages/validation/src/schemas/purchase.test.ts`

**What to Test**:
- Purchase data validation
- Stripe session ID format
- Amount validation (cents)

**Example Tests**:

```typescript
import { describe, it, expect } from 'vitest';
import { createCheckoutSessionSchema, webhookEventSchema } from './purchase';

describe('Purchase Validation Schemas', () => {
  describe('createCheckoutSessionSchema', () => {
    it('should validate valid checkout request', () => {
      const result = createCheckoutSessionSchema.parse({
        contentId: '123e4567-e89b-12d3-a456-426614174000',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });

      expect(result.contentId).toBeDefined();
      expect(result.successUrl).toContain('https://');
    });

    it('should reject invalid content ID', () => {
      expect(() =>
        createCheckoutSessionSchema.parse({
          contentId: 'not-a-uuid',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        })
      ).toThrow();
    });

    it('should reject non-HTTPS URLs', () => {
      expect(() =>
        createCheckoutSessionSchema.parse({
          contentId: '123e4567-e89b-12d3-a456-426614174000',
          successUrl: 'http://example.com/success', // HTTP not HTTPS
          cancelUrl: 'https://example.com/cancel',
        })
      ).toThrow();
    });
  });
});
```

---

### 2. Purchase Service Tests (Mocked Stripe)

**Location**: `packages/purchases/src/service.test.ts`

**What to Test**:
- Checkout session creation
- Duplicate purchase prevention
- Free content handling (no Stripe)
- Webhook completion logic

**Example Tests**:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PurchaseService } from './service';
import Stripe from 'stripe';

describe('PurchaseService', () => {
  let mockDb: any;
  let mockStripe: any;
  let mockObs: any;
  let service: PurchaseService;

  beforeEach(() => {
    mockDb = {
      query: {
        content: { findFirst: vi.fn() },
        contentPurchases: { findFirst: vi.fn() },
      },
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: 'purchase-123' }]),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(undefined),
        })),
      })),
    };

    mockStripe = {
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({
            id: 'cs_test_123',
            url: 'https://checkout.stripe.com/pay/cs_test_123',
          }),
        },
      },
    };

    mockObs = {
      info: vi.fn(),
      warn: vi.fn(),
      trackError: vi.fn(),
    };

    service = new PurchaseService({
      db: mockDb,
      stripe: mockStripe,
      obs: mockObs,
      organizationId: 'org-123',
    });
  });

  describe('createCheckoutSession', () => {
    it('should create Stripe session for paid content', async () => {
      mockDb.query.content.findFirst.mockResolvedValue({
        id: 'content-123',
        title: 'Test Video',
        priceCents: 999,
        organizationId: 'org-123',
      });

      mockDb.query.contentPurchases.findFirst.mockResolvedValue(null); // No existing purchase

      const result = await service.createCheckoutSession(
        'customer-123',
        'content-123',
        'org-123'
      );

      expect(result.checkoutUrl).toContain('checkout.stripe.com');
      expect(result.sessionId).toBe('cs_test_123');
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalled();
    });

    it('should skip Stripe for free content', async () => {
      mockDb.query.content.findFirst.mockResolvedValue({
        id: 'content-123',
        title: 'Free Video',
        priceCents: 0, // Free
        organizationId: 'org-123',
      });

      mockDb.query.contentPurchases.findFirst.mockResolvedValue(null);

      const result = await service.createCheckoutSession(
        'customer-123',
        'content-123',
        'org-123'
      );

      expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
      expect(result.checkoutUrl).toBeNull(); // No Stripe session for free content
    });

    it('should prevent duplicate purchases', async () => {
      mockDb.query.content.findFirst.mockResolvedValue({
        id: 'content-123',
        priceCents: 999,
        organizationId: 'org-123',
      });

      mockDb.query.contentPurchases.findFirst.mockResolvedValue({
        id: 'existing-purchase',
        status: 'completed',
      });

      await expect(
        service.createCheckoutSession('customer-123', 'content-123', 'org-123')
      ).rejects.toThrow('PURCHASE_ALREADY_EXISTS');
    });

    it('should create pending purchase before Stripe session', async () => {
      mockDb.query.content.findFirst.mockResolvedValue({
        id: 'content-123',
        priceCents: 999,
        organizationId: 'org-123',
      });

      mockDb.query.contentPurchases.findFirst.mockResolvedValue(null);

      await service.createCheckoutSession('customer-123', 'content-123', 'org-123');

      // Verify pending purchase was created
      expect(mockDb.insert).toHaveBeenCalled();
      const insertCall = mockDb.insert.mock.calls[0];
      const valuesCall = insertCall[0]().values.mock.calls[0];
      expect(valuesCall[0].status).toBe('pending');
    });
  });

  describe('handleCheckoutCompleted', () => {
    it('should mark purchase as completed', async () => {
      const mockSession = {
        id: 'cs_test_123',
        payment_status: 'paid',
        payment_intent: 'pi_test_123',
        metadata: {
          purchaseId: 'purchase-123',
          customerId: 'customer-123',
          contentId: 'content-123',
        },
      } as Stripe.Checkout.Session;

      await service.handleCheckoutCompleted(mockSession);

      expect(mockDb.update).toHaveBeenCalled();
      const setCall = mockDb.update().set.mock.calls[0];
      expect(setCall[0].status).toBe('completed');
      expect(setCall[0].stripePaymentIntentId).toBe('pi_test_123');
    });

    it('should be idempotent (handle duplicate webhooks)', async () => {
      const mockSession = {
        id: 'cs_test_123',
        payment_status: 'paid',
        payment_intent: 'pi_test_123',
        metadata: {
          purchaseId: 'purchase-123',
        },
      } as Stripe.Checkout.Session;

      // First call
      await service.handleCheckoutCompleted(mockSession);

      // Second call (duplicate webhook)
      await expect(
        service.handleCheckoutCompleted(mockSession)
      ).resolves.not.toThrow();

      // Should log warning but not fail
      expect(mockObs.warn).toHaveBeenCalledWith(
        expect.stringContaining('already completed'),
        expect.anything()
      );
    });
  });
});
```

---

### 3. Webhook Handler Tests

**Location**: `workers/ecom-api/src/handlers/checkout.test.ts`

**What to Test**:
- Event routing
- Payment status checking
- Error re-throwing for retry
- Observability logging

**Example Tests**:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCheckoutSessionCompleted } from './checkout';
import type Stripe from 'stripe';

describe('Checkout Webhook Handlers', () => {
  let mockPurchaseService: any;
  let mockEnv: any;

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

  it('should handle successful payment', async () => {
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
          },
        },
      },
    } as any;

    await handleCheckoutSessionCompleted(mockEvent, mockEnv);

    expect(mockPurchaseService.handleCheckoutCompleted).toHaveBeenCalledWith(
      mockEvent.data.object
    );
  });

  it('should skip processing if payment not completed', async () => {
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

    // Should re-throw so Stripe gets 500 and retries
    await expect(
      handleCheckoutSessionCompleted(mockEvent, mockEnv)
    ).rejects.toThrow('Database error');
  });
});
```

---

### 4. Webhook Integration Tests

**Location**: `workers/ecom-api/src/index.integration.test.ts`

**What to Test**:
- Signature verification
- End-to-end webhook processing
- Error responses (400, 500)

**Example Tests**:

```typescript
import { describe, it, expect } from 'vitest';
import app from './index';
import Stripe from 'stripe';

describe('Webhook Integration', () => {
  it('should process valid webhook', async () => {
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

  it('should return 500 on handler error for retry', async () => {
    // Mock handler to throw error
    const event = { /* valid event */ };
    const signature = /* valid signature */;

    const request = new Request('http://localhost/webhooks/stripe/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': signature,
      },
      body: JSON.stringify(event),
    });

    const env = { /* ... */ };

    // Simulate database error
    const response = await app.fetch(request, env);

    expect(response.status).toBe(500); // Stripe will retry
  });
});
```

---

## Stripe Test Mode

**Use Test API Keys**:
```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET_PAYMENT=whsec_test_...
```

**Test Cards**:
- `4242 4242 4242 4242` - Success
- `4000 0000 0000 0002` - Card declined
- `4000 0000 0000 3220` - 3D Secure required

**Webhook Testing**:
```bash
# Use Stripe CLI to forward webhooks
stripe listen --forward-to http://localhost:8787/webhooks/stripe/payment

# Trigger test event
stripe trigger checkout.session.completed
```

---

## Test Data Factories

**Location**: `packages/test-utils/src/factories/purchase.ts`

```typescript
import { faker } from '@faker-js/faker';

export function createMockPurchase(overrides?: Partial<Purchase>): Purchase {
  return {
    id: faker.string.uuid(),
    customerId: faker.string.uuid(),
    contentId: faker.string.uuid(),
    organizationId: 'test-org',
    priceCents: faker.number.int({ min: 0, max: 10000 }),
    status: 'completed',
    stripeCheckoutSessionId: `cs_test_${faker.string.alphanumeric(24)}`,
    stripePaymentIntentId: `pi_test_${faker.string.alphanumeric(24)}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createMockStripeSession(overrides?: Partial<Stripe.Checkout.Session>): Stripe.Checkout.Session {
  return {
    id: `cs_test_${faker.string.alphanumeric(24)}`,
    object: 'checkout.session',
    payment_status: 'paid',
    payment_intent: `pi_test_${faker.string.alphanumeric(24)}`,
    amount_total: 999,
    currency: 'usd',
    customer: faker.string.uuid(),
    metadata: {
      purchaseId: faker.string.uuid(),
      customerId: faker.string.uuid(),
      contentId: faker.string.uuid(),
    },
    ...overrides,
  } as Stripe.Checkout.Session;
}
```

---

## Common Testing Patterns

### Pattern 1: Test Idempotency

```typescript
it('should handle duplicate webhooks gracefully', async () => {
  const session = createMockStripeSession();

  // First webhook
  await service.handleCheckoutCompleted(session);

  // Duplicate webhook (should not throw)
  await expect(
    service.handleCheckoutCompleted(session)
  ).resolves.not.toThrow();

  // Should update purchase only once
  expect(mockDb.update).toHaveBeenCalledTimes(1);
});
```

### Pattern 2: Test Free Content Path

```typescript
it('should complete free content without Stripe', async () => {
  mockDb.query.content.findFirst.mockResolvedValue({
    priceCents: 0, // Free
  });

  const result = await service.createCheckoutSession('user-123', 'content-123', 'org-123');

  expect(result.checkoutUrl).toBeNull();
  expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
});
```

### Pattern 3: Test Webhook Error Retry

```typescript
it('should return 500 to trigger Stripe retry', async () => {
  mockPurchaseService.handleCheckoutCompleted.mockRejectedValue(
    new Error('DB connection lost')
  );

  const response = await app.fetch(validWebhookRequest, env);

  expect(response.status).toBe(500); // Stripe will retry
});
```

---

## Running Tests

```bash
# Run purchase validation tests
pnpm --filter @codex/validation test

# Run purchase service tests
pnpm --filter @codex/purchases test

# Run webhook handler tests
pnpm --filter ecom-api test

# Run integration tests with test Stripe keys
STRIPE_SECRET_KEY=sk_test_... pnpm test:integration
```

---

## Troubleshooting

**Problem**: Stripe signature verification fails in tests
**Solution**: Use `stripe.webhooks.generateTestHeaderString()` to create valid signatures

**Problem**: Webhook handler not retrying on error
**Solution**: Ensure handler returns 500 status (not 400) for retryable errors

**Problem**: Duplicate purchase prevention not working
**Solution**: Check for existing purchase BEFORE creating Stripe session

---

**Last Updated**: 2025-11-05
