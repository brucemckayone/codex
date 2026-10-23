/**
 * isTransientFailure — which failed checkout verifies the success pages retry
 * (Codex-o4jvw). The loads that use it are tested for what they do with the
 * answer: `checkout/success`, `_creators/checkout/success` and
 * `subscription/success`, each under `__tests__/success.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { isTransientFailure } from './checkout-verify';
import { ApiError } from './errors';

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
