/**
 * isTransientFailure — which failed checkout verifies the success pages retry
 * (Codex-o4jvw). The loads that use it are tested for what they do with the
 * answer: `checkout/success`, `_creators/checkout/success` and
 * `subscription/success`, each under `__tests__/success.test.ts`.
 *
 * completeOnArrival — what the completion on arrival comes to (Codex-2hxff.22,
 * .81): the session as read after, a `NotRecorded` for ecom-api's
 * `CHECKOUT_NOT_RECORDED`, or null for any other failure.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeOnArrival,
  isNotRecorded,
  isTransientFailure,
} from './checkout-verify';
import { ApiError } from './errors';

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));
vi.mock('$lib/observability', () => ({ logger: { warn: warnMock } }));

describe('isTransientFailure', () => {
  it.each([
    ['a 5xx', new ApiError(500, 'Internal')],
    ['a 503', new ApiError(503, 'Service unavailable')],
    ['the client timeout', new ApiError(408, 'timed out', 'REQUEST_TIMEOUT')],
    ['a rate limit', new ApiError(429, 'Too many requests')],
    ['a network failure', new TypeError('fetch failed')],
    ['a non-Error throw', 'boom'],
  ])('retries %s', (_label, err) => {
    expect(isTransientFailure(err)).toBe(true);
  });

  it.each([
    ['a 400', 400],
    ['a 401', 401],
    ['a 403', 403],
    ['a 404', 404],
    ['a 422', 422],
  ])('does not retry %s', (_label, status) => {
    expect(isTransientFailure(new ApiError(status, 'Refused'))).toBe(false);
  });
});

// Told apart by its literal, never by the field alone: a `kind` the verify
// result gains later must not read as "we're on it".
describe('isNotRecorded', () => {
  it('a NotRecorded is one', () => {
    expect(
      isNotRecorded({ kind: 'not_recorded', reference: 'cs_test_abc' })
    ).toBe(true);
  });

  it.each([
    ['null', null],
    ['a verify result', { sessionStatus: 'complete', state: 'recording' }],
    [
      'a verify result with some other kind',
      { sessionStatus: 'complete', state: 'unlocked', kind: 'content' },
    ],
  ])('%s is not', (_label, completion) => {
    expect(isNotRecorded(completion as never)).toBe(false);
  });
});

describe('completeOnArrival', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function apiAnswering(complete: () => Promise<unknown>) {
    return { checkout: { complete: vi.fn(complete) } } as unknown as Parameters<
      typeof completeOnArrival
    >[0];
  }

  it('answers the session as read after', async () => {
    const read = { sessionStatus: 'complete', state: 'unlocked' };
    const api = apiAnswering(async () => read);

    await expect(
      completeOnArrival(api, 'cs_test_abc', 'checkout-success')
    ).resolves.toBe(read);
    expect(warnMock).not.toHaveBeenCalled();
  });

  // The reference is what the buyer's support email quotes, so support can
  // match it to the alert (Codex-2hxff.81).
  it('CHECKOUT_NOT_RECORDED is NotRecorded, quoting the session id and the errorId support was alerted under', async () => {
    const api = apiAnswering(async () => {
      throw new ApiError(
        500,
        'The purchase could not be recorded',
        'CHECKOUT_NOT_RECORDED',
        {
          sessionId: 'cs_test_abc',
          errorId: '3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f',
        }
      );
    });

    await expect(
      completeOnArrival(api, 'cs_test_abc', 'checkout-success')
    ).resolves.toEqual({
      kind: 'not_recorded',
      reference: 'cs_test_abc / 3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f',
    });
    expect(warnMock).toHaveBeenCalledWith(
      'checkout-success: the purchase could not be recorded',
      {
        sessionId: 'cs_test_abc',
        errorId: '3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f',
      }
    );
  });

  it.each([
    ['no errorId', { sessionId: 'cs_test_abc' }],
    ['an errorId that is not one', { errorId: 'Your card was declined' }],
  ])('CHECKOUT_NOT_RECORDED with %s quotes the session id only', async (_label, details) => {
    const api = apiAnswering(async () => {
      throw new ApiError(
        500,
        'The purchase could not be recorded',
        'CHECKOUT_NOT_RECORDED',
        details
      );
    });

    await expect(
      completeOnArrival(api, 'cs_test_abc', 'checkout-success')
    ).resolves.toEqual({ kind: 'not_recorded', reference: 'cs_test_abc' });
  });

  it.each([
    ['a 503 (not yet)', new ApiError(503, 'Not yet', 'SERVICE_UNAVAILABLE')],
    ['a bare 500', new ApiError(500, 'Internal', 'INTERNAL_ERROR')],
    ['a 404', new ApiError(404, 'Not found', 'NOT_FOUND')],
    ['a network failure', new TypeError('fetch failed')],
  ])('%s is null: the checks carry on', async (_label, failure) => {
    const api = apiAnswering(async () => {
      throw failure;
    });

    await expect(
      completeOnArrival(api, 'cs_test_abc', 'checkout-success')
    ).resolves.toBeNull();
    expect(warnMock).toHaveBeenCalledWith(
      'checkout-success: completion on arrival failed',
      expect.objectContaining({ sessionId: 'cs_test_abc' })
    );
  });
});
