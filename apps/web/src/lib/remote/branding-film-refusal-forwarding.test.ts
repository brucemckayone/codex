// @vitest-environment node

/**
 * A refused intro-film pick reaches the studio in the worker's words
 * (Codex-376dl review).
 *
 * The worker refuses an unfinished video with a 422 and a sentence for the
 * creator ("This video is still processing. Pick it once it is ready.").
 * Before, `linkIntroVideo` let the `ApiError` escape, so kit turned it into a
 * sanitised 500 and the studio said "An unexpected error occurred". Now the
 * command forwards a 4xx through `forwardClientErrors`, and the Film control
 * reads it with `queryErrorMessage`.
 *
 * Also pinned: the commands make ONE call, the write. The studio re-reads
 * the film itself; a refresh inside the command would fail the command if it
 * failed, after the write was saved (Codex-luo5q).
 *
 * From the REAL envelope: only `fetch` is stubbed, as in
 * agreements-refusal-forwarding.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryErrorMessage } from '$lib/remote/query-result';

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

const remote = (await import('./branding.remote')) as unknown as {
  linkIntroVideo: (input: {
    orgId: string;
    mediaItemId: string;
  }) => Promise<unknown>;
  unlinkIntroVideo: (orgId: string) => Promise<unknown>;
};

const ORG_ID = '33333333-3333-4333-8333-333333333333';
const MEDIA_ID = '44444444-4444-4444-8444-444444444444';
const PROCESSING = 'This video is still processing. Pick it once it is ready.';

/** The worker's response: the envelope `mapErrorToResponse` writes. */
function workerAnswers(status: number, message: string) {
  const fetch = vi.fn(async () => {
    const body =
      status < 400
        ? { data: { introVideoMediaItemId: MEDIA_ID } }
        : {
            error: {
              code: status === 422 ? 'BUSINESS_LOGIC_ERROR' : 'INTERNAL_ERROR',
              message,
            },
          };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
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

describe('the intro film commands', () => {
  it("a refused pick keeps the worker's sentence for the studio", async () => {
    workerAnswers(422, PROCESSING);
    const err = await rejection(
      remote.linkIntroVideo({ orgId: ORG_ID, mediaItemId: MEDIA_ID })
    );
    expect(err).toMatchObject({ status: 422, body: { message: PROCESSING } });
    expect(queryErrorMessage(err, 'fallback')).toBe(PROCESSING);
  });

  it('a refused removal keeps its words too', async () => {
    workerAnswers(404, 'Organization not found');
    const err = await rejection(remote.unlinkIntroVideo(ORG_ID));
    expect(err).toMatchObject({ status: 404 });
    expect(queryErrorMessage(err, 'fallback')).toBe('Organization not found');
  });

  it('a 5xx is not forwarded: it stays an unexpected error for handleError', async () => {
    workerAnswers(500, 'connection to Neon failed');
    const err = await rejection(
      remote.linkIntroVideo({ orgId: ORG_ID, mediaItemId: MEDIA_ID })
    );
    expect(err).toMatchObject({ status: 500 });
    expect(err).not.toHaveProperty('body');
  });

  it('a pick and a removal make one call each, the write: no refresh rides along', async () => {
    const fetch = workerAnswers(200, '');
    await remote.linkIntroVideo({ orgId: ORG_ID, mediaItemId: MEDIA_ID });
    await remote.unlinkIntroVideo(ORG_ID);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
