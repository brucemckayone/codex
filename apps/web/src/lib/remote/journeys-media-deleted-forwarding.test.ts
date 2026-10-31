// @vitest-environment node

/**
 * A publish refused over deleted course media reaches the builder with its
 * code and slots (Codex-6sbn1).
 *
 * The worker refuses with a 422 whose `details` are `{ code: 'MEDIA_DELETED',
 * slots }`. `withServiceErrors` alone forwards only the message, so the
 * builder could neither tell this refusal from another 422 nor say which
 * slots to replace. Every other refusal still goes through it unchanged.
 *
 * From the REAL envelope: only `fetch` is stubbed, as in
 * branding-film-refusal-forwarding.test.ts, so the client's own mapping of
 * `details` is under test too.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryErrorMessage, remoteErrorCode } from '$lib/remote/query-result';

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
    url: new URL('http://of-blood-and-bones.lvh.me:3000/studio/journeys'),
  })),
}));

const { saveJourneyPage } = (await import('./journeys.remote')) as unknown as {
  saveJourneyPage: (record: Record<string, unknown>) => Promise<unknown>;
};

const ORG_ID = '33333333-3333-4333-8333-333333333333';
const PAGE_ID = '55555555-5555-4555-8555-555555555555';
const REFUSED =
  'Replace the deleted media on this course page before you publish it.';

/**
 * The org lookup answers; the save answers with `status` and the worker's
 * `{ error: { code, message, details } }` envelope (`mapErrorToResponse`).
 */
function workerRefusesSave(status: number, error: Record<string, unknown>) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    const [code, body] = url.includes('/public/')
      ? [200, { data: { id: ORG_ID, slug: 'of-blood-and-bones' } }]
      : [status, { error }];
    return new Response(JSON.stringify(body), {
      status: code,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetch);
}

const rejection = (attempt: Promise<unknown>) =>
  attempt.then(
    () => undefined,
    (caught: unknown) => caught
  );

const publish = () =>
  saveJourneyPage({ id: PAGE_ID, title: 'Bone deep', status: 'published' });

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('saveJourneyPage, refused over deleted course media', () => {
  it('keeps the code, the message and the slots for the builder', async () => {
    workerRefusesSave(422, {
      code: 'BUSINESS_LOGIC_ERROR',
      message: REFUSED,
      details: { code: 'MEDIA_DELETED', slots: ['reel', 'hero'] },
    });
    const err = await rejection(publish());
    expect(err).toMatchObject({
      status: 422,
      body: {
        message: REFUSED,
        code: 'MEDIA_DELETED',
        slots: ['reel', 'hero'],
      },
    });
    expect(remoteErrorCode(err)).toBe('MEDIA_DELETED');
    expect(queryErrorMessage(err, 'fallback')).toBe(REFUSED);
  });

  it('passes on only the slot names, never another detail', async () => {
    workerRefusesSave(422, {
      code: 'BUSINESS_LOGIC_ERROR',
      message: REFUSED,
      details: { code: 'MEDIA_DELETED', slots: ['intro', 7], mediaId: 'x' },
    });
    const err = (await rejection(publish())) as { body: unknown };
    expect(err.body).toEqual({
      message: REFUSED,
      code: 'MEDIA_DELETED',
      slots: ['intro'],
    });
  });

  it('another 422 keeps its words and nothing else, as before', async () => {
    const taken = 'The slug "bone-deep" is already in use';
    workerRefusesSave(422, { code: 'BUSINESS_LOGIC_ERROR', message: taken });
    const err = await rejection(publish());
    expect(err).toMatchObject({ status: 422, body: { message: taken } });
    expect(remoteErrorCode(err)).toBeUndefined();
  });

  it('a 5xx is not forwarded: it stays an unexpected error for handleError', async () => {
    workerRefusesSave(500, {
      code: 'INTERNAL_ERROR',
      message: 'connection to Neon failed',
      details: { code: 'MEDIA_DELETED', slots: ['reel'] },
    });
    const err = await rejection(publish());
    expect(err).toMatchObject({ status: 500 });
    expect(err).not.toHaveProperty('body');
  });
});
