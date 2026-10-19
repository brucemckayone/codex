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

import { BaseService, NotFoundError } from '@codex/service-errors';
import { createMockHonoContext, type MockHonoContext } from '@codex/test-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeWebhookEnv } from '../../types';
import { createWebhookHandler } from '../webhook-handler';

function createContext(object: Record<string, unknown> = {}): {
  context: Context<StripeWebhookEnv>;
  mock: MockHonoContext<StripeWebhookEnv['Bindings']>;
} {
  // createMockHonoContext's env has ENVIRONMENT: 'test'.
  const mock = createMockHonoContext<StripeWebhookEnv['Bindings']>({
    variables: {
      stripeEvent: {
        id: 'evt_test_1',
        type: 'test.event',
        data: { object },
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

      // 500 is the POINT of this branch: Stripe only retries a webhook it was
      // told failed, so a 200 here would silently drop the event.
      expect(responseStatus).toBe(500);
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

  // Codex-2hxff.5: production and local dev share one Stripe sandbox and both
  // receive every event. The guard runs before the handler, so "skipped" here
  // means the handler — and therefore every DB write — never ran.
  describe("another environment's objects", () => {
    it('an event about an object another environment created → 200, handler NOT called', async () => {
      const inner = vi.fn();
      const handler = createWebhookHandler('Test', inner);
      const { context, mock } = createContext({
        object: 'checkout.session',
        metadata: { codex_env: 'production' },
      });

      const response = await handler(context);

      expect(response.status).toBe(200);
      expect(inner).not.toHaveBeenCalled();
      expect(mock._obs.info).toHaveBeenCalledWith(
        expect.stringContaining('another environment'),
        expect.objectContaining({
          objectEnvironment: 'production',
          environment: 'test',
        })
      );
    });

    it("an invoice is judged by its subscription's snapshot, not its own metadata", async () => {
      const inner = vi.fn();
      const handler = createWebhookHandler('Test', inner);
      const { context } = createContext({
        object: 'invoice',
        metadata: {},
        parent: {
          subscription_details: { metadata: { codex_env: 'development' } },
        },
      });

      await handler(context);

      expect(inner).not.toHaveBeenCalled();
    });

    it('an object this environment created is processed', async () => {
      const inner = vi.fn();
      const handler = createWebhookHandler('Test', inner);
      const { context } = createContext({
        object: 'customer.subscription',
        metadata: { codex_env: 'test' },
      });

      await handler(context);

      expect(inner).toHaveBeenCalledTimes(1);
    });

    // Every object created before tagging began — every live subscription —
    // is untagged. Skipping these would stop production renewals.
    it('an UNTAGGED object is still processed', async () => {
      const inner = vi.fn();
      const handler = createWebhookHandler('Test', inner);
      const { context } = createContext({
        object: 'customer.subscription',
        metadata: { codex_user_id: 'u1' },
      });

      await handler(context);

      expect(inner).toHaveBeenCalledTimes(1);
    });
  });

  // Codex-2hxff.6: every webhook calls a service, and every service routes an
  // unknown error through BaseService.handleError, which wraps it as an
  // InternalServiceError — a ServiceError. The tests above throw raw errors
  // from the handler, so they never saw that wrap: in production a database
  // outage inside completePurchase was acknowledged 200 and Stripe never
  // retried, leaving a buyer charged with no purchase.
  describe('errors wrapped by a real service (Codex-2hxff.6)', () => {
    /** A real BaseService: its catch is the one every service uses. */
    class LedgerService extends BaseService {
      constructor(private readonly query: () => Promise<unknown>) {
        super({ db: {} as never, environment: 'test' });
      }
      async record(): Promise<unknown> {
        try {
          return await this.query();
        } catch (error) {
          this.handleError(error, 'record');
        }
      }
    }

    const viaService = (error: unknown) =>
      createWebhookHandler('Test', async () => {
        await new LedgerService(() => Promise.reject(error)).record();
      });

    it('a database connection lost inside a service → 500, so Stripe retries', async () => {
      const handler = viaService(
        new Error('Connection terminated unexpectedly')
      );
      const { context, mock } = createContext();

      const response = await handler(context);

      expect(response.status).toBe(500);
      // The log names the cause, not just "An unexpected error occurred".
      expect(mock._obs.error).toHaveBeenCalledWith(
        expect.stringContaining('transient error'),
        expect.objectContaining({
          cause: expect.objectContaining({
            message: 'Connection terminated unexpectedly',
          }),
        })
      );
    });

    it('logs the driver error under a drizzle query error — never its SQL or bound values', async () => {
      // drizzle 0.44 wraps the driver's error: its message is the query and
      // every bound value, so it must never reach the log.
      const pgError = Object.assign(
        new Error('duplicate key value violates unique constraint'),
        { code: '23505' }
      );
      const drizzleError = Object.assign(
        new Error(
          'Failed query: insert into "payouts" values ($1)\nparams: buyer@example.com'
        ),
        { name: 'DrizzleQueryError', cause: pgError }
      );
      const { context, mock } = createContext();

      await viaService(drizzleError)(context);

      const [, fields] = mock._obs.warn.mock.calls.at(-1) ?? [];
      expect(fields).toMatchObject({
        cause: {
          name: 'Error',
          message: 'duplicate key value violates unique constraint',
          code: '23505',
        },
      });
      expect(JSON.stringify(fields)).not.toContain('buyer@example.com');
      expect(JSON.stringify(fields)).not.toContain('Failed query');
    });

    it('a Postgres serialization failure (SQLSTATE 40001) inside a service → 500', async () => {
      const pgError = Object.assign(
        new Error('could not serialize access due to concurrent update'),
        { code: '40001' }
      );
      const response = await viaService(pgError)(createContext().context);

      expect(response.status).toBe(500);
    });

    it('a Stripe 503 inside a service → 500', async () => {
      const stripeError = Object.assign(new Error('Service unavailable'), {
        type: 'StripeAPIError',
        statusCode: 503,
      });
      const response = await viaService(stripeError)(createContext().context);

      expect(response.status).toBe(500);
    });

    it('a NotFoundError from a service → 200 (permanent: a retry finds nothing new)', async () => {
      const response = await viaService(
        new NotFoundError('Purchase not found')
      )(createContext().context);

      expect(response.status).toBe(200);
    });

    it('an unrecognised bug inside a service → 200 (permanent, never a retry storm)', async () => {
      const response = await viaService(
        new TypeError("Cannot read properties of undefined (reading 'id')")
      )(createContext().context);

      expect(response.status).toBe(200);
    });
  });
});
