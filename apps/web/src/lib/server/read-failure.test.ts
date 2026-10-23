/**
 * The shared read-failure classifier (Codex-osuqt review). A 4xx other than
 * 408 or 429 is OUR malformed request, a contract bug, so it logs as an error
 * naming the refused field. A timeout, a rate limit, a 5xx and a network
 * failure are outages and log as warnings, without details. Deleting either
 * carve-out would raise an error-level "contract bug" for a busy page's 429.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock('$lib/observability', () => ({ logger: mockLogger }));

import { apiErrorFields, logReadFailure } from './read-failure';

const details = [{ path: 'query.creatorId', message: 'Invalid user id' }];
const apiError = (status: number) =>
  new ApiError(status, 'Invalid request data', 'SOME_CODE', details);

describe('logReadFailure', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    400, 404, 422,
  ])('logs a %i as an error with the refused field', (status) => {
    logReadFailure('Read failed', { creatorId: 'u1' }, apiError(status));

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Read failed',
      expect.objectContaining({ creatorId: 'u1', status, details })
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it.each([
    ['a timeout', apiError(408)],
    ['a rate limit', apiError(429)],
    ['a 5xx', apiError(503)],
    ['a network failure', new TypeError('fetch failed')],
  ])('logs %s as a warning, without details', (_kind, error) => {
    logReadFailure('Read failed', { orgId: 'o1' }, error);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Read failed',
      expect.objectContaining({ orgId: 'o1', details: undefined })
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});

describe('apiErrorFields', () => {
  it('carries no status or code for a failure that is not a worker response', () => {
    expect(apiErrorFields(new Error('boom'))).toEqual({
      ourRequestWasWrong: false,
      fields: { status: undefined, code: undefined, details: undefined },
    });
  });
});
