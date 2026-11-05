import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '$lib/observability';
import { logReadFailure } from './log-read-failure';

describe('logReadFailure', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs an outage as an error, and a request that never landed as one too', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    logReadFailure(
      'x.failed',
      { status: 503, body: { message: 'down' } },
      { mediaId: 'm1' }
    );
    logReadFailure('x.failed', new Error('network'));
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls[0]?.[1]).toMatchObject({
      mediaId: 'm1',
      status: 503,
    });
  });

  it('logs a timeout and a rate limit as outages: they pass, and a Try again helps', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    logReadFailure('x.failed', { status: 408 });
    logReadFailure('x.failed', { status: 429 });
    expect(error).toHaveBeenCalledTimes(2);
  });

  it('logs a refusal as a warning', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    logReadFailure('x.failed', { status: 404, body: { message: 'gone' } });
    expect(warn).toHaveBeenCalledWith(
      'x.failed',
      expect.objectContaining({ status: 404 })
    );
    expect(error).not.toHaveBeenCalled();
  });
});
