/**
 * Stripe Signature Verification Middleware Tests
 *
 * Tests the verifyStripeSignature middleware which validates Stripe
 * webhook signatures using HMAC-SHA256.
 *
 * Key test scenarios:
 * - Missing signature header returns 400
 * - Invalid signature returns 401
 * - Missing webhook secret returns 500
 * - Valid signature sets stripeEvent in context
 * - Correct secret is selected based on path
 */

import { Hono } from 'hono';
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @codex/purchase module
vi.mock('@codex/purchase', () => ({
  createStripeClient: vi.fn(() => ({
    webhooks: {
      constructEvent: vi.fn(),
    },
  })),
  verifyWebhookSignature: vi.fn(),
}));

import { MIME_TYPES, STRIPE_EVENTS } from '@codex/constants';
import { createStripeClient, verifyWebhookSignature } from '@codex/purchase';
import { verifyStripeSignature } from '../verify-signature';

// Mock observability client
const createMockObs = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

// Create test app with middleware
function createTestApp(env: Record<string, string | undefined>) {
  const app = new Hono();

  // Add observability middleware mock
  app.use('*', async (c, next) => {
    c.env = env as never;
    // @ts-expect-error - test context type does not know about 'obs'
    c.set('obs', createMockObs());
    await next();
  });

  // Apply signature verification
  app.use('/webhooks/*', verifyStripeSignature());

  // Test endpoints for different webhook types
  app.post('/webhooks/stripe/booking', (c) => {
    // @ts-expect-error - test context type does not know about 'stripeEvent'
    const event = c.get('stripeEvent') as Stripe.Event;
    return c.json({ received: true, eventType: event?.type });
  });

  app.post('/webhooks/stripe/payment', (c) => {
    // @ts-expect-error - test context type does not know about 'stripeEvent'
    const event = c.get('stripeEvent') as Stripe.Event;
    return c.json({ received: true, eventType: event?.type });
  });

  app.post('/webhooks/stripe/subscription', (c) => {
    // @ts-expect-error - test context type does not know about 'stripeEvent'
    const event = c.get('stripeEvent') as Stripe.Event;
    return c.json({ received: true, eventType: event?.type });
  });

  app.post('/webhooks/stripe/customer', (c) => {
    // @ts-expect-error - test context type does not know about 'stripeEvent'
    const event = c.get('stripeEvent') as Stripe.Event;
    return c.json({ received: true, eventType: event?.type });
  });

  app.post('/webhooks/stripe/connect', (c) => {
    // @ts-expect-error - test context type does not know about 'stripeEvent'
    const event = c.get('stripeEvent') as Stripe.Event;
    return c.json({ received: true, eventType: event?.type });
  });

  app.post('/webhooks/stripe/dispute', (c) => {
    // @ts-expect-error - test context type does not know about 'stripeEvent'
    const event = c.get('stripeEvent') as Stripe.Event;
    return c.json({ received: true, eventType: event?.type });
  });

  return app;
}

describe('verifyStripeSignature middleware', () => {
  const mockEvent: Stripe.Event = {
    id: 'evt_test_123',
    object: 'event',
    type: STRIPE_EVENTS.CHECKOUT_COMPLETED,
    api_version: '2025-10-29.clover',
    created: Date.now() / 1000,
    data: {
      object: {
        id: 'cs_test_123',
      } as Stripe.Checkout.Session,
    },
    livemode: false,
    pending_webhooks: 0,
    request: null,
  } as Stripe.Event;

  const validEnv = {
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET_BOOKING: 'whsec_booking_123',
    STRIPE_WEBHOOK_SECRET_PAYMENT: 'whsec_payment_456',
    STRIPE_WEBHOOK_SECRET_SUBSCRIPTION: 'whsec_subscription_789',
    STRIPE_WEBHOOK_SECRET_CUSTOMER: 'whsec_customer_abc',
    STRIPE_WEBHOOK_SECRET_CONNECT: 'whsec_connect_def',
    STRIPE_WEBHOOK_SECRET_DISPUTE: 'whsec_dispute_ghi',
    ENVIRONMENT: 'test',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (verifyWebhookSignature as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockEvent
    );
  });

  describe('missing signature header', () => {
    it('should return 400 when stripe-signature header is missing', async () => {
      const app = createTestApp(validEnv);

      const res = await app.request('/webhooks/stripe/booking', {
        method: 'POST',
        body: JSON.stringify({ test: true }),
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          // No stripe-signature header
        },
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Missing signature');
    });
  });

  describe('missing webhook secret', () => {
    it('should return 500 when webhook secret is not configured', async () => {
      const envWithoutSecret = {
        ...validEnv,
        STRIPE_WEBHOOK_SECRET_BOOKING: undefined,
      };
      const app = createTestApp(envWithoutSecret);

      const res = await app.request('/webhooks/stripe/booking', {
        method: 'POST',
        body: JSON.stringify({ test: true }),
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 't=123,v1=abc',
        },
      });

      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Webhook secret not configured');
    });

    it('should return 500 when STRIPE_SECRET_KEY is not configured', async () => {
      const envWithoutKey = {
        ...validEnv,
        STRIPE_SECRET_KEY: undefined,
      };
      const app = createTestApp(envWithoutKey);

      const res = await app.request('/webhooks/stripe/booking', {
        method: 'POST',
        body: JSON.stringify({ test: true }),
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 't=123,v1=abc',
        },
      });

      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Stripe not configured');
    });
  });

  describe('invalid signature', () => {
    it('should return 401 when signature verification fails', async () => {
      (
        verifyWebhookSignature as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(new Error('Signature verification failed'));

      const app = createTestApp(validEnv);

      const res = await app.request('/webhooks/stripe/booking', {
        method: 'POST',
        body: JSON.stringify({ test: true }),
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'stripe-signature': 't=invalid,v1=tampered',
        },
      });

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Invalid signature');
    });
  });

  describe('valid signature', () => {
    it('should pass through and set stripeEvent in context', async () => {
      const app = createTestApp(validEnv);

      const res = await app.request('/webhooks/stripe/booking', {
        method: 'POST',
        body: JSON.stringify({ test: true }),
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'stripe-signature': 't=1234567890,v1=valid_signature',
        },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        received: boolean;
        eventType: string;
      };
      expect(body.received).toBe(true);
      expect(body.eventType).toBe(STRIPE_EVENTS.CHECKOUT_COMPLETED);
    });

    it('should call verifyWebhookSignature with correct parameters', async () => {
      const app = createTestApp(validEnv);

      await app.request('/webhooks/stripe/booking', {
        method: 'POST',
        body: JSON.stringify({ test: 'body' }),
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'stripe-signature': 't=123,v1=sig',
        },
      });

      expect(verifyWebhookSignature).toHaveBeenCalledWith(
        JSON.stringify({ test: 'body' }), // raw body
        't=123,v1=sig', // signature header
        'whsec_booking_123', // webhook secret
        expect.anything() // stripe client
      );
    });
  });

  describe('webhook secret selection by path', () => {
    it('should use STRIPE_WEBHOOK_SECRET_BOOKING for /booking path', async () => {
      const app = createTestApp(validEnv);

      await app.request('/webhooks/stripe/booking', {
        method: 'POST',
        body: '{}',
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'stripe-signature': 't=1,v1=sig',
        },
      });

      expect(verifyWebhookSignature).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'whsec_booking_123',
        expect.anything()
      );
    });

    it('should use STRIPE_WEBHOOK_SECRET_PAYMENT for /payment path', async () => {
      const app = createTestApp(validEnv);

      await app.request('/webhooks/stripe/payment', {
        method: 'POST',
        body: '{}',
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'stripe-signature': 't=1,v1=sig',
        },
      });

      expect(verifyWebhookSignature).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'whsec_payment_456',
        expect.anything()
      );
    });

    it('should use STRIPE_WEBHOOK_SECRET_SUBSCRIPTION for /subscription path', async () => {
      const app = createTestApp(validEnv);

      await app.request('/webhooks/stripe/subscription', {
        method: 'POST',
        body: '{}',
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'stripe-signature': 't=1,v1=sig',
        },
      });

      expect(verifyWebhookSignature).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'whsec_subscription_789',
        expect.anything()
      );
    });

    it('should use STRIPE_WEBHOOK_SECRET_CUSTOMER for /customer path', async () => {
      const app = createTestApp(validEnv);

      await app.request('/webhooks/stripe/customer', {
        method: 'POST',
        body: '{}',
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'stripe-signature': 't=1,v1=sig',
        },
      });

      expect(verifyWebhookSignature).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'whsec_customer_abc',
        expect.anything()
      );
    });

    it('should use STRIPE_WEBHOOK_SECRET_CONNECT for /connect path', async () => {
      const app = createTestApp(validEnv);

      await app.request('/webhooks/stripe/connect', {
        method: 'POST',
        body: '{}',
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'stripe-signature': 't=1,v1=sig',
        },
      });

      expect(verifyWebhookSignature).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'whsec_connect_def',
        expect.anything()
      );
    });

    it('should use STRIPE_WEBHOOK_SECRET_DISPUTE for /dispute path', async () => {
      const app = createTestApp(validEnv);

      await app.request('/webhooks/stripe/dispute', {
        method: 'POST',
        body: '{}',
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'stripe-signature': 't=1,v1=sig',
        },
      });

      expect(verifyWebhookSignature).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'whsec_dispute_ghi',
        expect.anything()
      );
    });
  });

  describe('Stripe client initialization', () => {
    it('should create Stripe client with STRIPE_SECRET_KEY', async () => {
      const app = createTestApp(validEnv);

      await app.request('/webhooks/stripe/booking', {
        method: 'POST',
        body: '{}',
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'stripe-signature': 't=1,v1=sig',
        },
      });

      expect(createStripeClient).toHaveBeenCalledWith('sk_test_123');
    });
  });
});
