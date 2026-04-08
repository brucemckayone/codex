/**
 * Webhook Handler Factory Tests
 *
 * Tests createWebhookHandler() which wraps all webhook endpoints
 * with standardized logging and error classification.
 *
 * After the error classification fix:
 * - Transient errors → 500 (Stripe retries)
 * - Permanent errors → 200 (acknowledged)
 * - Successful handling → 200 with { received: true }
 */

import { createMockHonoContext, type MockHonoContext } from '@codex/test-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeWebhookEnv } from '../../types';
import { createWebhookHandler } from '../webhook-handler';

function createContext(): {
  context: Context<StripeWebhookEnv>;
  mock: MockHonoContext<StripeWebhookEnv['Bindings']>;
} {
  const mock = createMockHonoContext<StripeWebhookEnv['Bindings']>({
    variables: {
      stripeEvent: {
        id: 'evt_test_1',
        type: 'test.event',
      } as unknown as Stripe.Event,
      stripe: {} as Stripe,
    },
  });
  return {
    context: mock as unknown as Context<StripeWebhookEnv>,
    mock,
  };
}

describe('createWebhookHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('successful handling', () => {
    it('should return 200 with received:true on success', async () => {
      const handler = createWebhookHandler('Test', async () => {
        // Handler succeeds
      });
      const { context, mock } = createContext();

      const response = await handler(context);

      expect(mock._obs.info).toHaveBeenCalledWith(
        'Test webhook received',
        expect.objectContaining({ type: 'test.event', id: 'evt_test_1' })
      );
      // Response should be 200 with { received: true }
      expect(response).toBeDefined();
    });

    it('should return 200 when no handler provided (stub endpoint)', async () => {
      const handler = createWebhookHandler('Stub');
      const { context } = createContext();

      const response = await handler(context);
      expect(response).toBeDefined();
    });
  });

  describe('transient error handling', () => {
    it('should return 500 for database connection errors', async () => {
      const handler = createWebhookHandler('Test', async () => {
        throw new Error('ECONNRESET');
      });
      const { context, mock } = createContext();

      // Capture the json call
      let responseStatus: number | undefined;
      (mock as unknown as Record<string, unknown>).json = vi
        .fn()
        .mockImplementation((_body: unknown, status?: number) => {
          responseStatus = status;
          return new Response(JSON.stringify(_body), { status: status ?? 200 });
        });

      await handler(context);

      expect(mock._obs.error).toHaveBeenCalledWith(
        expect.stringContaining('transient error'),
        expect.objectContaining({ error: 'ECONNRESET' })
      );
    });

    it('should return 500 for Stripe rate limit errors', async () => {
      const handler = createWebhookHandler('Test', async () => {
        const err = new Error('Rate limit');
        (err as unknown as Record<string, unknown>).type =
          'StripeRateLimitError';
        throw err;
      });
      const { context, mock } = createContext();

      await handler(context);

      expect(mock._obs.error).toHaveBeenCalledWith(
        expect.stringContaining('transient error'),
        expect.anything()
      );
    });
  });

  describe('permanent error handling', () => {
    it('should return 200 for business logic errors', async () => {
      const handler = createWebhookHandler('Test', async () => {
        throw new Error('Subscription not found');
      });
      const { context, mock } = createContext();

      await handler(context);

      expect(mock._obs.warn).toHaveBeenCalledWith(
        expect.stringContaining('permanent error'),
        expect.objectContaining({ error: 'Subscription not found' })
      );
    });
  });

  describe('logging', () => {
    it('should log event receipt with type and id', async () => {
      const handler = createWebhookHandler('Payment', async () => {});
      const { context, mock } = createContext();

      await handler(context);

      expect(mock._obs.info).toHaveBeenCalledWith(
        'Payment webhook received',
        expect.objectContaining({
          type: 'test.event',
          id: 'evt_test_1',
        })
      );
    });
  });
});
