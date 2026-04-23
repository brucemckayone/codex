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
import {
  _resetStripeClientCacheForTests,
  verifyStripeSignature,
  WEBHOOK_PATHS,
} from '../verify-signature';

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
    _resetStripeClientCacheForTests();
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
    // 501 (Not Implemented), not 500, so Stripe stops retrying when a
    // webhook endpoint exists but its secret is not configured. 5xx triggers
    // an indefinite retry loop during any misconfiguration.
    it('should return 501 when webhook secret is not configured', async () => {
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

      expect(res.status).toBe(501);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Webhook secret not configured');
    });

    it('should return 501 when STRIPE_SECRET_KEY is not configured', async () => {
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

      expect(res.status).toBe(501);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Stripe not configured');
    });

    it('should return 501 when path is not in the webhook lookup table', async () => {
      // A path that previously would have matched via path.includes('/dev')
      // substring (e.g. '/webhooks/stripe/unregistered') now returns
      // undefined from the exact-path lookup and is rejected cleanly.
      const app = createTestApp(validEnv);

      const res = await app.request('/webhooks/stripe/unregistered', {
        method: 'POST',
        body: JSON.stringify({ test: true }),
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'stripe-signature': 't=123,v1=abc',
        },
      });

      expect(res.status).toBe(501);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Webhook secret not configured');
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

    it('should use STRIPE_WEBHOOK_SECRET_BOOKING for /dev path (dev catch-all)', async () => {
      const app = createTestApp(validEnv);
      app.post('/webhooks/stripe/dev', (c) => c.json({ received: true }));

      await app.request('/webhooks/stripe/dev', {
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
  });

  describe('webhook path lookup parity', () => {
    // Regression fence for S48: if a new webhook route is registered in
    // workers/ecom-api/src/index.ts without a matching lookup entry, this
    // fails loudly rather than silently returning 501 at runtime.
    it('should cover every registered Stripe webhook path', () => {
      const expected = [
        '/webhooks/stripe/payment',
        '/webhooks/stripe/subscription',
        '/webhooks/stripe/connect',
        '/webhooks/stripe/customer',
        '/webhooks/stripe/booking',
        '/webhooks/stripe/dispute',
        '/webhooks/stripe/dev',
      ];
      expect(WEBHOOK_PATHS.sort()).toEqual(expected.sort());
    });
  });

  describe('signature verification edge cases', () => {
    it('should return 401 for tampered payload (valid format, wrong body)', async () => {
      // Simulate a valid-looking signature format but mismatched body
      (
        verifyWebhookSignature as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(
        new Error('Signature verification failed: payload tampered')
      );

      const app = createTestApp(validEnv);

      const res = await app.request('/webhooks/stripe/booking', {
        method: 'POST',
        body: JSON.stringify({ tampered: true }),
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'stripe-signature': 't=1234567890,v1=valid_format_but_wrong_hmac',
        },
      });

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Invalid signature');
    });

    it('should return 401 for expired timestamp', async () => {
      // Simulate Stripe SDK rejecting due to timestamp tolerance
      (
        verifyWebhookSignature as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(
        new Error('Timestamp outside the tolerance zone')
      );

      const app = createTestApp(validEnv);

      // Use a very old timestamp
      const expiredTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const res = await app.request('/webhooks/stripe/booking', {
        method: 'POST',
        body: JSON.stringify({ test: true }),
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'stripe-signature': `t=${expiredTimestamp},v1=some_signature`,
        },
      });

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Invalid signature');
    });

    it('should rely on Stripe SDK timestamp tolerance + idempotency for replay protection', async () => {
      // Document: Replay protection is provided by:
      // 1. Stripe SDK's timestamp tolerance (default 300s / 5 min)
      //    — rejects events with timestamps outside the tolerance window
      // 2. Service-level idempotency constraints (e.g., stripePaymentIntentId unique)
      //    — even if a replay somehow passes signature check, the handler is idempotent
      //
      // There is no explicit nonce or replay counter in our middleware.
      // The Stripe SDK's constructEvent/verifyWebhookSignature handles timestamp checking.

      const app = createTestApp(validEnv);

      // First request succeeds
      const res1 = await app.request('/webhooks/stripe/booking', {
        method: 'POST',
        body: JSON.stringify({ test: true }),
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'stripe-signature': 't=1234567890,v1=valid_signature',
        },
      });
      expect(res1.status).toBe(200);

      // Same request replayed — if within timestamp tolerance, signature passes
      // but service-level idempotency prevents duplicate processing
      const res2 = await app.request('/webhooks/stripe/booking', {
        method: 'POST',
        body: JSON.stringify({ test: true }),
        headers: {
          'Content-Type': MIME_TYPES.APPLICATION.JSON,
          'stripe-signature': 't=1234567890,v1=valid_signature',
        },
      });
      // Middleware passes (signature still valid) — idempotency is at the handler level
      expect(res2.status).toBe(200);
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
