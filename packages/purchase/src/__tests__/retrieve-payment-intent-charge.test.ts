/**
 * retrievePaymentIntentCharge's failures, logged by level (Codex-2hxff.80).
 *
 * The success page's completion asks for the charge up to 7 times per page
 * open, and the generic `handleError` logged every Stripe blip at error, with
 * a stack, as "Unhandled error wrapped by handleError", and with no errorId.
 * Now a Stripe failure is logged as retrieveCheckoutSession logs one: a blip
 * (no connection, a rate limit, Stripe's 5xx) at warn, anything else at
 * error, each with an errorId. It is thrown as a PaymentProcessingError with
 * the Stripe error as its cause, so ecom-api's `isTransientError` judges it
 * by that cause, exactly as before: the route and webhook tests in
 * workers/ecom-api pin the 503/200 outcome for this shape.
 *
 * No database: the method reads Stripe only.
 */

import { createTestMoneyDeps } from '@codex/test-utils';
import type Stripe from 'stripe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentProcessingError } from '../errors';
import { PurchaseService } from '../services/purchase-service';

const PAYMENT_INTENT = 'pi_charge_lookup';

function stripeError(type: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`${type} from Stripe`), { type, ...extra });
}

function serviceFailingWith(error: Error) {
  const stripe = {
    paymentIntents: { retrieve: vi.fn().mockRejectedValue(error) },
  } as unknown as Stripe;
  const service = new PurchaseService(
    { db: {} as never, environment: 'test', ...createTestMoneyDeps() },
    stripe
  );
  // biome-ignore lint/suspicious/noExplicitAny: spy on the protected obs
  const obs = (service as any).obs;
  return {
    service,
    warn: vi.spyOn(obs, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(obs, 'error').mockImplementation(() => {}),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('retrievePaymentIntentCharge: a Stripe failure (Codex-2hxff.80)', () => {
  it.each([
    ['no connection', stripeError('StripeConnectionError')],
    ['a rate limit', stripeError('StripeRateLimitError')],
    ["Stripe's own 5xx", stripeError('StripeAPIError', { statusCode: 502 })],
  ])('%s is a blip: one warn with an errorId, and no error line', async (_label, cause) => {
    const { service, warn, error } = serviceFailingWith(cause);

    const thrown = await service
      .retrievePaymentIntentCharge(PAYMENT_INTENT)
      .catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(PaymentProcessingError);
    expect((thrown as Error).cause).toBe(cause);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      'Stripe failed to retrieve a PaymentIntent charge',
      expect.objectContaining({
        errorId: expect.any(String),
        paymentIntentId: PAYMENT_INTENT,
        stripeType: cause.type,
      })
    );
    expect(error).not.toHaveBeenCalled();
    // The errorId the line carries is the one the error carries.
    expect((thrown as PaymentProcessingError).context?.errorId).toBe(
      (warn.mock.calls[0]?.[1] as { errorId: string }).errorId
    );
  });

  it.each([
    [
      'a PaymentIntent Stripe does not know',
      stripeError('StripeInvalidRequestError', { statusCode: 404 }),
    ],
    ['a wrong key', stripeError('StripeAuthenticationError')],
    ['a missing permission', stripeError('StripePermissionError')],
    ['a Stripe 4xx', stripeError('StripeAPIError', { statusCode: 400 })],
  ])('%s needs a person: one error line with an errorId, never the generic one', async (_label, cause) => {
    const { service, warn, error } = serviceFailingWith(cause);

    const thrown = await service
      .retrievePaymentIntentCharge(PAYMENT_INTENT)
      .catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(PaymentProcessingError);
    expect((thrown as Error).cause).toBe(cause);
    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(
      'Stripe failed to retrieve a PaymentIntent charge',
      expect.objectContaining({
        errorId: expect.any(String),
        paymentIntentId: PAYMENT_INTENT,
        stripeType: cause.type,
      })
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("never sends Stripe's message: the error's message and context are ours", async () => {
    const cause = stripeError('StripeInvalidRequestError');
    const { service } = serviceFailingWith(cause);

    const thrown = (await service
      .retrievePaymentIntentCharge(PAYMENT_INTENT)
      .catch((e: unknown) => e)) as PaymentProcessingError;

    expect(JSON.stringify([thrown.message, thrown.context])).not.toContain(
      cause.message
    );
  });

  it('a failure that is not Stripe is wrapped as before', async () => {
    const cause = new TypeError('boom');
    const { service, error } = serviceFailingWith(cause);

    const thrown = await service
      .retrievePaymentIntentCharge(PAYMENT_INTENT)
      .catch((e: unknown) => e);

    expect(thrown).not.toBeInstanceOf(PaymentProcessingError);
    expect((thrown as Error).cause).toBe(cause);
    expect(error).toHaveBeenCalledWith(
      'Unhandled error wrapped by handleError',
      expect.objectContaining({ context: 'retrievePaymentIntentCharge' })
    );
  });
});
