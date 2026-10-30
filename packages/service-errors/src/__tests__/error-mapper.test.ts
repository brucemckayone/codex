/**
 * mapErrorToResponse — a 5xx ServiceError's context (Codex-adcgb)
 *
 * Every ServiceError, 5xx included, was mapped with `details: error.context`.
 * A 5xx's context names internals: an R2SigningError sent the R2 object key
 * and its serialised cause, and every wrapped unexpected error sent the
 * service class and environment, to anonymous callers on public routes too.
 *
 * Now a 5xx sends code and message only, unless the error set
 * `publicContext` (a context written for the client to act on, such as
 * CHECKOUT_NOT_RECORDED's errorId). The withheld context goes to the log,
 * because nothing else logs a ServiceError on this path. A 4xx is unchanged.
 */

import { ObservabilityClient } from '@codex/observability';
import { describe, expect, it, vi } from 'vitest';
import {
  ConflictError,
  InternalServiceError,
  ServiceError,
  ServiceUnavailableError,
  StripeNotConfiguredError,
  ValidationError,
} from '../base-errors';
import { mapErrorToResponse } from '../error-mapper';

const R2_KEY = 'creator-1/hls/media-1/master.m3u8';

function stubObs() {
  const error = vi.fn();
  const warn = vi.fn();
  return {
    error,
    warn,
    obs: { error, warn } as unknown as ObservabilityClient,
  };
}

describe('mapErrorToResponse: a 5xx ServiceError', () => {
  it('sends code and message with no details key', () => {
    const { obs } = stubObs();
    const { statusCode, response } = mapErrorToResponse(
      new InternalServiceError('Failed to generate R2 signed URL', {
        r2Key: R2_KEY,
      }),
      { obs }
    );

    expect(statusCode).toBe(500);
    // Absent, not merely undefined: the body is exactly code and message.
    expect(response).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to generate R2 signed URL',
      },
    });
    expect(response.error).not.toHaveProperty('details');
    expect(JSON.stringify(response)).not.toContain(R2_KEY);
  });

  it('withholds a 503 context the same way, logged at warn', () => {
    const { error, warn, obs } = stubObs();
    const { statusCode, response } = mapErrorToResponse(
      new ServiceUnavailableError('Try again', { subscriptionId: 'sub-1' }),
      { obs }
    );

    expect(statusCode).toBe(503);
    expect(response.error).not.toHaveProperty('details');
    // A 503 is a "try again" its throw site expects, not a fault.
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'Server error context withheld from response',
      expect.objectContaining({
        message: 'Try again',
        context: { subscriptionId: 'sub-1' },
      })
    );
  });

  it('keeps the code of a typed 500, which the client acts on', () => {
    const { obs } = stubObs();
    const { response } = mapErrorToResponse(
      new StripeNotConfiguredError({ operation: 'createTier' }),
      { obs }
    );

    expect(response.error.code).toBe('STRIPE_NOT_CONFIGURED');
    expect(response.error).not.toHaveProperty('details');
  });

  it('logs the withheld context once, through the obs it was given', () => {
    const { error, obs } = stubObs();

    mapErrorToResponse(
      new InternalServiceError('Failed to generate R2 signed URL', {
        r2Key: R2_KEY,
      }),
      { obs }
    );

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      'Server error context withheld from response',
      expect.objectContaining({
        source: 'mapErrorToResponse',
        errorName: 'InternalServiceError',
        code: 'INTERNAL_ERROR',
        statusCode: 500,
        // Most 500s share INTERNAL_ERROR: the message tells them apart.
        message: 'Failed to generate R2 signed URL',
        context: { r2Key: R2_KEY },
      })
    );
  });

  it('names its cause on the withheld line, when the error has one', () => {
    const { error, obs } = stubObs();

    mapErrorToResponse(
      new InternalServiceError(
        'The payee credit could not be settled',
        { creditId: 'credit-1' },
        { cause: new TypeError('connection refused') }
      ),
      { obs }
    );

    expect(error).toHaveBeenCalledWith(
      'Server error context withheld from response',
      expect.objectContaining({ cause: 'TypeError: connection refused' })
    );
  });

  it('names a cause that is not an Error too', () => {
    const { error, obs } = stubObs();

    mapErrorToResponse(
      new InternalServiceError(
        'Email send failed',
        { attempt: 3 },
        { cause: { statusCode: 500 } }
      ),
      { obs }
    );

    expect(error).toHaveBeenCalledWith(
      'Server error context withheld from response',
      expect.objectContaining({ cause: '{"statusCode":500}' })
    );
  });

  it('logs through the fallback client when the caller passed no obs', () => {
    const error = vi
      .spyOn(ObservabilityClient.prototype, 'error')
      .mockImplementation(() => {});

    mapErrorToResponse(new InternalServiceError('x', { r2Key: R2_KEY }));

    expect(error).toHaveBeenCalledWith(
      'Server error context withheld from response',
      expect.objectContaining({ context: { r2Key: R2_KEY } })
    );
    error.mockRestore();
  });

  it('logs nothing for a 5xx with no context: there is nothing withheld', () => {
    const { error, obs } = stubObs();

    mapErrorToResponse(new InternalServiceError('An unexpected error'), {
      obs,
    });

    expect(error).not.toHaveBeenCalled();
  });

  it('logs nothing when the caller turned logging off', () => {
    const { error, obs } = stubObs();

    mapErrorToResponse(new InternalServiceError('x', { r2Key: R2_KEY }), {
      obs,
      logError: false,
    });

    expect(error).not.toHaveBeenCalled();
  });
});

describe('mapErrorToResponse: a 5xx ServiceError with publicContext', () => {
  class NotRecordedError extends ServiceError {
    constructor(context: Record<string, unknown>) {
      super(
        'The purchase could not be recorded',
        'NOT_RECORDED',
        500,
        context,
        {
          publicContext: true,
        }
      );
    }
  }

  it('sends its context as details, and logs nothing', () => {
    const { error, obs } = stubObs();
    const { statusCode, response } = mapErrorToResponse(
      new NotRecordedError({ sessionId: 'cs_1', errorId: 'err-1' }),
      { obs }
    );

    expect(statusCode).toBe(500);
    expect(response.error.details).toEqual({
      sessionId: 'cs_1',
      errorId: 'err-1',
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('is opted into through the 503 constructor too', () => {
    const { response } = mapErrorToResponse(
      new ServiceUnavailableError(
        'Stripe could not create the tier',
        { code: 'STRIPE_UNAVAILABLE', retryAfter: '2026-10-29T15:00:00.000Z' },
        { publicContext: true }
      )
    );

    expect(response.error.details).toEqual({
      code: 'STRIPE_UNAVAILABLE',
      retryAfter: '2026-10-29T15:00:00.000Z',
    });
  });
});

describe('mapErrorToResponse: a 4xx ServiceError is unchanged', () => {
  it('sends its context as details', () => {
    const { error, obs } = stubObs();
    const { statusCode, response } = mapErrorToResponse(
      new ConflictError('Slug already exists', { slug: 'taken' }),
      { obs }
    );

    expect(statusCode).toBe(409);
    expect(response).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Slug already exists',
        details: { slug: 'taken' },
      },
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('sends validation issues as details', () => {
    const issues = [{ path: 'title', message: 'Required' }];
    const { response } = mapErrorToResponse(
      new ValidationError('Invalid request data', { issues })
    );

    expect(response.error.details).toEqual({ issues });
  });
});
