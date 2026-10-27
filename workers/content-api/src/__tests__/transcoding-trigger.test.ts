import { describe, expect, it } from 'vitest';
import { triggerFailureReason } from '../transcoding-trigger';

/** procedure()'s error envelope, as mapErrorToResponse writes it. */
const envelope = (code: string, detailsCode?: string) =>
  JSON.stringify({
    error: {
      code,
      message: 'x',
      ...(detailsCode && { details: { code: detailsCode } }),
    },
  });

describe('triggerFailureReason', () => {
  it('records nothing for a 2xx', () => {
    expect(triggerFailureReason(200, '{}')).toBeNull();
  });

  it.each([
    [404, envelope('NOT_FOUND', 'TRANSCODING_MEDIA_NOT_FOUND')],
    [422, envelope('BUSINESS_LOGIC_ERROR', 'INVALID_MEDIA_STATE')],
    [422, envelope('BUSINESS_LOGIC_ERROR', 'MAX_RETRIES_EXCEEDED')],
  ])('records nothing for an answer about the item (%i)', (status, body) => {
    expect(triggerFailureReason(status, body)).toBeNull();
  });

  it.each([
    // Worker auth refused the hop: a rotated secret, clock skew, an origin.
    [401, envelope('UNAUTHORIZED')],
    [403, envelope('FORBIDDEN')],
    // A wrong MEDIA_API_URL: the router's own 404, not an envelope.
    [404, '404 Not Found'],
    // A 4xx about something else must not pass for an item answer.
    [422, envelope('VALIDATION_ERROR')],
    [503, envelope('INTERNAL_ERROR')],
    [502, '<html>bad gateway</html>'],
  ])('marks the item waiting when the hop failed (%i)', (status, body) => {
    expect(triggerFailureReason(status, body)).toBe(
      `Transcoding dispatch returned ${status}`
    );
  });

  it('reads the specific code only from details: the top-level code is generic', () => {
    expect(
      triggerFailureReason(422, envelope('MAX_RETRIES_EXCEEDED'))
    ).not.toBeNull();
  });
});
