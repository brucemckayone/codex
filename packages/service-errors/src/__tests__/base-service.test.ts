/**
 * BaseService.handleError (Codex-adcgb)
 *
 * `handleError` wrapped every unexpected error with
 * `{ service, environment, context }` as its context, and a ServiceError's
 * context is client-facing: `mapErrorToResponse` sent it as `details`, so
 * every service method's unexpected 500 named the service class and the
 * environment to the caller, anonymous callers on public routes included. A
 * unique-constraint failure is wrapped as a 409 ConflictError, whose details
 * still reach the client, so the wrap itself must carry nothing.
 *
 * The facts are not lost: the log line `handleError` writes records them.
 */

import { describe, expect, it, vi } from 'vitest';
import { ConflictError, InternalServiceError } from '../base-errors';
import { BaseService } from '../base-service';
import { mapErrorToResponse } from '../error-mapper';

class ProbeService extends BaseService {
  constructor() {
    super({ db: {} as never, environment: 'production' });
  }

  fail(error: unknown, context?: string): never {
    this.handleError(error, context);
  }

  get logger() {
    return this.obs;
  }
}

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

describe('BaseService.handleError', () => {
  it('wraps an unknown error with no context, keeping it on cause', () => {
    const service = new ProbeService();
    vi.spyOn(service.logger, 'error').mockImplementation(() => {});
    const original = new Error('connection refused');

    const wrapped = thrownBy(() => service.fail(original, 'getThing'));

    expect(wrapped).toBeInstanceOf(InternalServiceError);
    expect((wrapped as InternalServiceError).context).toBeUndefined();
    expect((wrapped as InternalServiceError).cause).toBe(original);
  });

  it('wraps a unique-constraint failure as a 409 with no context, since a 4xx sends its details', () => {
    const service = new ProbeService();
    vi.spyOn(service.logger, 'error').mockImplementation(() => {});

    const wrapped = thrownBy(() =>
      service.fail(
        new Error('duplicate key value violates unique constraint "x"'),
        'createThing'
      )
    );

    expect(wrapped).toBeInstanceOf(ConflictError);
    const { statusCode, response } = mapErrorToResponse(wrapped);
    expect(statusCode).toBe(409);
    expect(response.error.details).toBeUndefined();
    expect(JSON.stringify(response)).not.toContain('ProbeService');
    expect(JSON.stringify(response)).not.toContain('production');
  });

  it('logs what the wrap no longer carries: the operation and the underlying error', () => {
    const service = new ProbeService();
    const error = vi
      .spyOn(service.logger, 'error')
      .mockImplementation(() => {});

    thrownBy(() => service.fail(new Error('connection refused'), 'getThing'));

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      'Unhandled error wrapped by handleError',
      expect.objectContaining({
        context: 'getThing',
        errorMessage: 'connection refused',
      })
    );
  });

  it('re-throws a ServiceError unchanged, context and all', () => {
    const service = new ProbeService();
    const original = new ConflictError('Slug already exists', { slug: 'x' });

    expect(thrownBy(() => service.fail(original))).toBe(original);
  });
});
