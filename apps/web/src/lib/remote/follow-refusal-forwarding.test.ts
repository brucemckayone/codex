// @vitest-environment node

/**
 * A refused follow reaches the landing page with its status (Codex-1yd58 WP-0
 * review). The org hero's main button can be Follow, and a session that ran
 * out answers 401: the page sends that visitor to sign in. Before, the
 * commands let the `ApiError` escape, so kit turned every refusal into a
 * sanitised 500 and the page could only say "try again".
 *
 * From the REAL envelope: only `fetch` is stubbed, as in
 * branding-film-refusal-forwarding.test.ts.
 */

import { isHttpError } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// The global `$app/server` mock is one-arg; these remotes are (schema, fn).
// Kit's remote-module check wants every export tagged with `__`.
const makeRemote = (type: string, fn: (...args: unknown[]) => unknown) =>
  Object.assign((...args: unknown[]) => fn(...args), {
    __: { type, id: '', name: '' },
  });
const lastArg = (args: unknown[]) =>
  args[args.length - 1] as (...args: unknown[]) => unknown;
vi.mock('$app/server', () => ({
  command: vi.fn((...args: unknown[]) => makeRemote('command', lastArg(args))),
  form: vi.fn((...args: unknown[]) => makeRemote('form', lastArg(args))),
  query: vi.fn((...args: unknown[]) => makeRemote('query', lastArg(args))),
  getRequestEvent: vi.fn(() => ({
    platform: { env: {} },
    cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  })),
}));

const remote = (await import('./org.remote')) as unknown as {
  followOrganization: (orgId: string) => Promise<unknown>;
  unfollowOrganization: (orgId: string) => Promise<unknown>;
};

const ORG_ID = '33333333-3333-4333-8333-333333333333';

/** The worker's response: the envelope `mapErrorToResponse` writes. */
function workerAnswers(status: number, code: string, message: string) {
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify(
          status < 400
            ? { data: { following: true } }
            : { error: { code, message } }
        ),
        { status, headers: { 'Content-Type': 'application/json' } }
      )
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const rejection = (attempt: Promise<unknown>) =>
  attempt.then(
    () => undefined,
    (caught: unknown) => caught
  );

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the follow commands', () => {
  it('a session that ran out reaches the page as a 401', async () => {
    workerAnswers(401, 'UNAUTHORIZED', 'Authentication required');
    for (const command of [
      remote.followOrganization,
      remote.unfollowOrganization,
    ]) {
      const err = await rejection(command(ORG_ID));
      // an HttpError: the one kind kit delivers with its status. A raw
      // ApiError has a `status` too, but kit sends it on as a 500.
      expect(isHttpError(err)).toBe(true);
      expect(err).toMatchObject({
        status: 401,
        body: { message: 'Authentication required' },
      });
    }
  });

  it('a rate limit keeps its status too', async () => {
    workerAnswers(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests');
    const err = await rejection(remote.followOrganization(ORG_ID));
    expect(isHttpError(err)).toBe(true);
    expect(err).toMatchObject({ status: 429 });
  });

  it('a 5xx is not forwarded: it stays an unexpected error for handleError', async () => {
    workerAnswers(500, 'INTERNAL_ERROR', 'connection to Neon failed');
    const err = await rejection(remote.followOrganization(ORG_ID));
    expect(isHttpError(err)).toBe(false);
    expect(err).toMatchObject({ status: 500 });
    expect(err).not.toHaveProperty('body');
  });

  it('a follow that takes resolves', async () => {
    workerAnswers(200, '', '');
    await expect(remote.followOrganization(ORG_ID)).resolves.toEqual({
      success: true,
    });
  });
});
