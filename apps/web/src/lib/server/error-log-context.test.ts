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
  logRefusedRemoteInput,
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

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.not.objectContaining({ staleRemoteForm: true })
    );
    expect(mockLogger.trackError).not.toHaveBeenCalled();
  });

  // Kit refuses a native POST to a renamed or moved remote form() with the
  // same 405 text. Its `?/remote=` param is the client's to choose, so
  // tracking it would let any script raise error-level alarms: a warning,
  // flagged so a deploy's stale forms can be counted.
  it("flags a stale remote form's 405 on a warning, never tracks it", () => {
    logUnhandledError(
      new Error('POST method not allowed. No form actions exist for this page'),
      event(
        'http://lvh.me:3000/forgot-password?/remote=a1b2c3/requestReset',
        'POST'
      ),
      405
    );

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ staleRemoteForm: true })
    );
    expect(mockLogger.trackError).not.toHaveBeenCalled();
  });

  // Kit takes a POST as a remote-form submit only when the param has a value.
  it('does not flag an empty ?/remote= as a remote form', () => {
    logUnhandledError(
      new Error('POST method not allowed. No form actions exist for this page'),
      event('http://lvh.me:3000/?/remote=', 'POST'),
      405
    );

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.not.objectContaining({ staleRemoteForm: true })
    );
  });
});

describe('logRefusedRemoteInput', () => {
  beforeEach(() => vi.clearAllMocks());

  // Kit refuses a remote function's input with an HttpError that never
  // reaches handleError: without this a page of ours sending what a schema
  // refuses left no trace. For a remote call Kit sets `event.url` to the
  // calling page; the request keeps the function's own URL and payload.
  it('names the page, the function and the refused fields, never their values', () => {
    logRefusedRemoteInput(
      [
        { message: 'Slug must not contain NUL', path: ['slug'] },
        { message: 'Too big', path: [{ key: 'page' }] },
      ],
      {
        request: new Request(
          'http://studio-alpha.lvh.me:3000/_app/remote/1wvwy0x/getPublicContent?payload=c2VjcmV0'
        ),
        url: new URL('http://studio-alpha.lvh.me:3000/explore'),
        locals: { requestId: 'req-1' },
      } as Parameters<typeof logRefusedRemoteInput>[1]
    );

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Remote function input refused',
      expect.objectContaining({
        url: '/explore',
        remote: '/_app/remote/1wvwy0x/getPublicContent',
        issues: ['slug', 'page'],
      })
    );
    expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain(
      'c2VjcmV0'
    );
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
