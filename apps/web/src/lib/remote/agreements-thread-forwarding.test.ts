// @vitest-environment node

/**
 * `getMyAgreementThread` forwards the worker's 4xx WITH its status
 * (Codex-2hxff.20 AGR-10, review N1).
 *
 * The creator thread page says "You don't have access to this agreement"
 * only on a 403 or 404, and every creator agreement email links to it. Let
 * through as an `ApiError`, the worker's 404 reached the browser as
 * `handleError`'s sanitised 500, so a stale or foreign link read as "We
 * couldn't load this negotiation." with a Retry that could never succeed.
 *
 * Starts from the wire: the REAL api client, with `fetch` answering as
 * ecom-api's `/agreements/me/threads/:id` does on a miss (the procedure
 * error envelope). Nothing here is a pre-shaped `HttpError`.
 *
 * `$app/server` is stubbed as in `ownership.remote.test.ts`.
 */

import { isHttpError } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';

const PROPOSAL_ID = '44444444-4444-4444-8444-444444444444';

vi.mock('$lib/observability', () => ({
  logger: {
    startTimer: vi.fn(() => ({ end: vi.fn() })),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// The test setup mocks `$lib/server/api` for every file; the remote needs the
// real client, so the worker's answer goes through its real error mapping.
vi.mock('$lib/server/api', async () => vi.importActual('$lib/server/api'));

type Remote = ((arg: unknown) => PromiseLike<unknown>) & {
  __: { type: string; id: string; name: string };
};

vi.mock('$app/server', () => {
  // Kit's plugin refuses a `.remote.ts` export without this metadata.
  const meta = (type: string) => ({ type, id: '', name: '' });
  return {
    query: vi.fn((schemaOrFn: unknown, maybeFn?: (arg: unknown) => unknown) => {
      const fn = (maybeFn ?? schemaOrFn) as (arg: unknown) => unknown;
      const wrapped = ((arg: unknown) =>
        Promise.resolve().then(() => fn(arg))) as unknown as Remote;
      wrapped.__ = meta('query');
      return wrapped;
    }),
    command: vi.fn((_schema: unknown, fn: (arg: unknown) => unknown) => {
      const wrapped = ((arg: unknown) => fn(arg)) as unknown as Remote;
      wrapped.__ = meta('command');
      return wrapped;
    }),
    getRequestEvent: vi.fn(() => ({
      platform: { env: {} },
      cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    })),
  };
});

/** ecom-api answers with the procedure error envelope and this status. */
function workerAnswers(status: number, code: string, message: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code, message } }), {
          status,
          headers: { 'content-type': 'application/json' },
        })
    )
  );
}

async function getMyAgreementThread(): Promise<Remote> {
  const mod = await import('./agreements.remote');
  return mod.getMyAgreementThread as unknown as Remote;
}

/** What the call rejected with. Fails the test if it resolves instead. */
async function rejectionOf(call: PromiseLike<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to reject');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getMyAgreementThread', () => {
  it('a worker 404 reaches the caller as an HttpError with status 404', async () => {
    workerAnswers(404, 'NOT_FOUND', 'Proposal thread not found');
    const remote = await getMyAgreementThread();

    const error = await rejectionOf(remote({ proposalId: PROPOSAL_ID }));

    expect(isHttpError(error)).toBe(true);
    expect((error as { status: number }).status).toBe(404);
    expect((error as { body: { code?: string } }).body.code).toBe('NOT_FOUND');
  });

  it('a worker 403 keeps its status too', async () => {
    workerAnswers(403, 'FORBIDDEN', 'Not the named creator');
    const remote = await getMyAgreementThread();

    const error = await rejectionOf(remote({ proposalId: PROPOSAL_ID }));

    expect(isHttpError(error)).toBe(true);
    expect((error as { status: number }).status).toBe(403);
  });

  it('a worker 5xx is NOT forwarded: it stays unexpected, for handleError to sanitise', async () => {
    workerAnswers(500, 'INTERNAL_ERROR', 'boom');
    const remote = await getMyAgreementThread();

    const error = await rejectionOf(remote({ proposalId: PROPOSAL_ID }));

    expect(isHttpError(error)).toBe(false);
    expect((error as { status?: number }).status).toBe(500);
  });
});
