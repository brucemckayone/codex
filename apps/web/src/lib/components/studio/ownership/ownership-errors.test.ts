/**
 * Every error code in the ownership API contract maps to readable copy, read
 * from where SvelteKit actually puts it: `HttpError.body.code`.
 */

import { describe, expect, it } from 'vitest';
import * as m from '$paraglide/messages';
import { ownershipErrorMessage, remoteErrorCode } from './ownership-errors';

/** The shape a forwarded 4xx has on the client: `HttpError { status, body }`. */
function httpError(status: number, code: string, message = 'worker text') {
  return { status, body: { message, code } };
}

describe('remoteErrorCode', () => {
  it('reads the code from an HttpError body', () => {
    expect(remoteErrorCode(httpError(409, 'CONFLICT'))).toBe('CONFLICT');
  });

  it('reads a top-level code too', () => {
    expect(remoteErrorCode({ code: 'NOT_FOUND', message: 'x' })).toBe(
      'NOT_FOUND'
    );
  });

  it('is undefined for anything code-less', () => {
    expect(remoteErrorCode(new Error('boom'))).toBeUndefined();
    expect(remoteErrorCode('boom')).toBeUndefined();
    expect(remoteErrorCode(null)).toBeUndefined();
    expect(remoteErrorCode(undefined)).toBeUndefined();
  });
});

describe('ownershipErrorMessage', () => {
  it.each([
    [400, 'CONFIRM_NAME_MISMATCH', m.ownership_error_confirm_name()],
    [400, 'VALIDATION_ERROR', m.ownership_error_validation()],
    [403, 'NOT_ORGANISATION_OWNER', m.ownership_error_not_owner()],
    [403, 'FORBIDDEN', m.ownership_error_forbidden()],
    [404, 'NOT_FOUND', m.ownership_error_not_found()],
    [409, 'OWNERSHIP_OFFER_NOT_OPEN', m.ownership_error_not_open()],
    [409, 'CONFLICT', m.ownership_error_conflict()],
    [409, 'OWNERSHIP_TRANSFER_REQUIRED', m.ownership_error_transfer_required()],
    [422, 'INELIGIBLE_OWNERSHIP_RECIPIENT', m.ownership_error_ineligible()],
    [429, 'RATE_LIMIT_EXCEEDED', m.ownership_error_rate_limited()],
  ])('%i %s → its own copy', (status, code, expected) => {
    expect(ownershipErrorMessage(httpError(status, code))).toBe(expected);
  });

  it('every contract code has DISTINCT copy', () => {
    const codes = [
      'CONFIRM_NAME_MISMATCH',
      'VALIDATION_ERROR',
      'NOT_ORGANISATION_OWNER',
      'FORBIDDEN',
      'NOT_FOUND',
      'OWNERSHIP_OFFER_NOT_OPEN',
      'CONFLICT',
      'OWNERSHIP_TRANSFER_REQUIRED',
      'INELIGIBLE_OWNERSHIP_RECIPIENT',
    ];
    const copy = codes.map((code) =>
      ownershipErrorMessage(httpError(400, code))
    );
    expect(new Set(copy).size).toBe(codes.length);
  });

  it('an unknown code falls back to the message SvelteKit delivered', () => {
    expect(
      ownershipErrorMessage({
        status: 500,
        body: {
          message: 'An unexpected error occurred',
          code: 'INTERNAL_ERROR',
        },
      })
    ).toBe('An unexpected error occurred');
  });

  it('a network failure (plain Error) uses its message', () => {
    expect(
      ownershipErrorMessage(new Error('Failed to execute remote function'))
    ).toBe('Failed to execute remote function');
  });

  it('never returns an empty string', () => {
    expect(ownershipErrorMessage({})).toBe(m.ownership_error_generic());
    expect(ownershipErrorMessage(undefined)).toBe(m.ownership_error_generic());
  });
});
