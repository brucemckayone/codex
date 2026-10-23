/**
 * What `handleError` logs about a request whose load threw (Codex-osuqt
 * review). It used to log the href and hand the query string to `method`, and
 * never a worker's status, code or refused field, so an outage read the same
 * as a contract 400 or a timeout. Every unmatched route also reaches it, with a
 * 404: a crawler's miss must not log like a crash.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  trackError: vi.fn(),
}));
vi.mock('$lib/observability', () => ({ logger: mockLogger }));

import {
  clientErrorBody,
  errorLogContext,
  logUnhandledError,
} from './error-log-context';

const event = (href: string, method = 'GET') =>
  ({
    request: new Request(href, { method }),
    url: new URL(href),
    locals: { requestId: 'req-1' },
  }) as Parameters<typeof errorLogContext>[1];

describe('errorLogContext', () => {
  it("carries a worker failure's status and code, and the org's host", () => {
    expect(
      errorLogContext(
        new ApiError(503, 'API Error', 'SERVICE_UNAVAILABLE'),
        event('http://studio-alpha.lvh.me:3000/content/first'),
        500
      )
    ).toEqual({
      requestId: 'req-1',
      host: 'studio-alpha.lvh.me:3000',
      url: '/content/first',
      method: 'GET',
      responseStatus: 500,
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      details: undefined,
    });
  });

  // Neither detail page catches its by-slug read, so for a contract 400 this
  // is the only log: without the details it names no field.
  it('names the field a contract 400 refused', () => {
    const details = [{ path: 'query.creatorId', message: 'Invalid user id' }];

    expect(
      errorLogContext(
        new ApiError(400, 'Invalid request data', 'VALIDATION_ERROR', details),
        event('http://creators.lvh.me:3000/@alex/content/first'),
        500
      )
    ).toMatchObject({ status: 400, details });
  });

  it('logs the HTTP method and the path, never the query string', () => {
    const context = errorLogContext(
      new Error('boom'),
      event('http://lvh.me:3000/checkout/success?session_id=cs_secret', 'POST'),
      500
    );

    expect(context).toMatchObject({
      url: '/checkout/success',
      method: 'POST',
      status: undefined,
    });
    expect(JSON.stringify(context)).not.toContain('cs_secret');
  });
});

describe('logUnhandledError', () => {
  beforeEach(() => vi.clearAllMocks());

  it("logs an unmatched route's 404 as a warning, not a tracked error", () => {
    logUnhandledError(
      new Error('Not found: /wp-admin'),
      event('http://lvh.me:3000/wp-admin'),
      404
    );

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Not found: /wp-admin',
      expect.objectContaining({ responseStatus: 404, url: '/wp-admin' })
    );
    expect(mockLogger.trackError).not.toHaveBeenCalled();
  });

  it('tracks a 500 as an error', () => {
    const error = new Error('boom');

    logUnhandledError(error, event('http://lvh.me:3000/content/first'), 500);

    expect(mockLogger.trackError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ responseStatus: 500 })
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  // A renamed form action's 404 comes from a deploy of ours: tracked.
  it("tracks a renamed form action's 404 as an error", () => {
    logUnhandledError(
      new Error("No action with name 'purchase' found"),
      event('http://lvh.me:3000/content/first?/purchase', 'POST'),
      404
    );

    expect(mockLogger.trackError).toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  // Any POST to a page with no actions at all gets this 405: a scanner's
  // noise, so a warning.
  it('logs a POST to a page without actions as a warning', () => {
    logUnhandledError(
      new Error('POST method not allowed. No form actions exist for this page'),
      event('http://lvh.me:3000/', 'POST'),
      405
    );

    expect(mockLogger.warn).toHaveBeenCalled();
    expect(mockLogger.trackError).not.toHaveBeenCalled();
  });
});

describe('clientErrorBody', () => {
  it("shows Kit's own message for a 404, not 'An unexpected error'", () => {
    expect(clientErrorBody(404, 'Not Found')).toEqual({
      message: 'Not Found',
      code: 'NOT_FOUND',
    });
  });

  it('marks any other status below 500 a bad request', () => {
    expect(clientErrorBody(405, 'Method Not Allowed')).toEqual({
      message: 'Method Not Allowed',
      code: 'BAD_REQUEST',
    });
  });

  it('leaves a 500 to the sanitised body', () => {
    expect(clientErrorBody(500, 'Internal Error')).toBeNull();
  });
});
