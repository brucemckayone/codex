// @vitest-environment node

/**
 * The studio editor tells a refusal from an outage (Codex-a6ofh.2.3 review).
 *
 * `getContent` let the worker's `ApiError` escape, so kit turned a 404 (a
 * piece deleted, or not the creator's) into a sanitised 500: the edit page's
 * "not found" line could never show, and a Try again that could never work
 * was offered instead, logged as an outage. It now forwards a 4xx through
 * `forwardClientErrors`; a 5xx stays kit's 500.
 *
 * The cover upload answers in its result, never by throwing. A refusal keeps
 * the worker's words, written for the creator; an outage says a fixed
 * sentence (its message can be a fetch error) and carries its status, so
 * the studio logs it as one.
 *
 * From the REAL envelope: only `fetch` is stubbed, as in
 * branding-film-refusal-forwarding.test.ts.
 */

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
// What kit sends back with a form's answer: each `set` or `refresh` a
// handler made parks its promise here, and kit awaits them all for the
// response, so one that rejects fails the whole answer.
const refreshes = vi.hoisted(() => new Map<string, Promise<unknown>>());
// What this request has read or set, per query and argument (kit's cache).
const cache = vi.hoisted(() => new Map<string, Promise<unknown>>());
let queries = 0;
// A query, as a handler holds it: awaitable, with kit's `set` and `refresh`.
// As kit's does, it starts its own read a beat after it is called, unless a
// `set` or `refresh` came first (`get_response`: `await 0`, then the cache).
const makeQuery = (fn: (...args: unknown[]) => unknown) => {
  const query = queries++;
  return Object.assign(
    (...args: unknown[]) => {
      const key = `${query}:${JSON.stringify(args)}`;
      const ownRead = () => Promise.resolve().then(() => fn(...args));
      const read = Promise.resolve().then(() => {
        const cached = cache.get(key) ?? ownRead();
        cache.set(key, cached);
        return cached;
      });
      read.catch(() => {});
      return {
        // biome-ignore lint/suspicious/noThenProperty: a thenable stands in for kit's query
        then: (
          ok: (value: unknown) => unknown,
          fail: (r: unknown) => unknown
        ) => read.then(ok, fail),
        set: (value: unknown) => {
          const parked = Promise.resolve(value);
          cache.set(key, parked);
          refreshes.set(key, parked);
          return parked.then(() => {});
        },
        refresh: () => {
          const parked = ownRead();
          cache.set(key, parked);
          refreshes.set(key, parked);
          parked.catch(() => {});
          return parked.then(() => {});
        },
      };
    },
    { __: { type: 'query', id: '', name: '' } }
  );
};
vi.mock('$app/server', () => ({
  command: vi.fn((...args: unknown[]) => makeRemote('command', lastArg(args))),
  form: vi.fn((...args: unknown[]) => makeRemote('form', lastArg(args))),
  query: Object.assign(
    vi.fn((...args: unknown[]) => makeQuery(lastArg(args))),
    {
      batch: vi.fn((...args: unknown[]) =>
        makeRemote('query_batch', lastArg(args))
      ),
    }
  ),
  prerender: vi.fn((...args: unknown[]) =>
    makeRemote('prerender', lastArg(args))
  ),
  getRequestEvent: vi.fn(() => ({
    platform: { env: {} },
    cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  })),
}));

type CoverForm = (input: {
  contentId: string;
  thumbnail: File;
}) => Promise<
  | { success: true; thumbnailUrl: string }
  | { success: false; status: number; error: string }
>;

const { logger } = await import('$lib/observability');
const remote = (await import('./content.remote')) as unknown as {
  getContent: (id: string) => Promise<unknown>;
  publishContent: (id: string) => Promise<unknown>;
  saveContent: (input: {
    id: string;
    patch: Record<string, unknown>;
  }) => Promise<unknown>;
  uploadThumbnailForm: CoverForm;
  stageThumbnailForm: CoverForm;
};

const CONTENT_ID = '55555555-5555-4555-8555-555555555555';
const NOT_YOURS = 'Content not found';

/** One worker answer: the envelope `mapErrorToResponse` writes. */
function envelope(status: number, message: string) {
  const body =
    status < 400
      ? { data: { id: CONTENT_ID, thumbnailUrl: 'https://cdn.test/c.webp' } }
      : {
          error: {
            code:
              status === 404
                ? 'NOT_FOUND'
                : status === 403
                  ? 'FORBIDDEN'
                  : 'INTERNAL_ERROR',
            message,
          },
        };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * The worker answers every call with `status`; a read of the piece (a GET)
 * answers with `read` when given, so an upload and the read after it can
 * answer differently.
 */
function workerAnswers(
  status: number,
  message: string,
  read?: [status: number, message: string]
) {
  const fetch = vi.fn(async (_url: unknown, init?: { method?: string }) => {
    const isRead = (init?.method ?? 'GET').toUpperCase() === 'GET';
    return read && isRead ? envelope(...read) : envelope(status, message);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** How many reads of the piece reached the worker. */
const reads = (fetch: ReturnType<typeof workerAnswers>) =>
  fetch.mock.calls.filter(
    ([, init]) => (init?.method ?? 'GET').toUpperCase() === 'GET'
  ).length;

/** What kit would send back: fails as kit's answer would if any parked promise rejects. */
const sentBack = () => Promise.all(refreshes.values());

const rejection = (attempt: Promise<unknown>) =>
  attempt.then(
    () => undefined,
    (caught: unknown) => caught
  );

const cover = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'cover.png', {
    type: 'image/png',
  });

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  refreshes.clear();
  cache.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getContent', () => {
  // Kit's HttpError (it has a `body`), never the worker's bare ApiError: kit
  // sanitises anything else to a 500 at the remote boundary.
  it('a piece deleted, or not theirs, keeps its 404', async () => {
    workerAnswers(404, NOT_YOURS);
    const err = await rejection(remote.getContent(CONTENT_ID));
    expect(err).toMatchObject({ status: 404, body: { message: NOT_YOURS } });
  });

  it('a 403 keeps its status too', async () => {
    workerAnswers(403, 'Forbidden');
    const err = await rejection(remote.getContent(CONTENT_ID));
    expect(err).toMatchObject({ status: 403, body: { message: 'Forbidden' } });
  });

  it('a 5xx is not forwarded: it stays an unexpected error for handleError', async () => {
    workerAnswers(500, 'connection to Neon failed');
    const err = await rejection(remote.getContent(CONTENT_ID));
    expect(err).not.toHaveProperty('body');
    expect(err).not.toMatchObject({ status: 404 });
  });
});

/**
 * Both cover forms answer alike: the upload a draft's cover takes, and the
 * stage a live piece's waits in for Update (Codex-a6ofh.2.5). Each posts to
 * its own route.
 */
describe.each([
  ['uploadThumbnailForm', '/thumbnail'],
  ['stageThumbnailForm', '/thumbnail/stage'],
] as const)('%s', (name, route) => {
  const send = (input: Parameters<CoverForm>[0]) => remote[name](input);

  it('posts the file to its own route', async () => {
    const fetch = workerAnswers(200, '');
    await send({ contentId: CONTENT_ID, thumbnail: cover() });
    const posts = fetch.mock.calls
      .filter(([, init]) => (init?.method ?? 'GET').toUpperCase() === 'POST')
      .map(([url]) => String(url));
    expect(posts).toEqual([
      expect.stringMatching(new RegExp(`/api/content/${CONTENT_ID}${route}$`)),
    ]);
  });

  it("a refusal keeps the worker's words and its status", async () => {
    workerAnswers(422, 'This image is too large to process.');
    const result = await send({
      contentId: CONTENT_ID,
      thumbnail: cover(),
    });
    expect(result).toEqual({
      success: false,
      status: 422,
      error: 'This image is too large to process.',
    });
  });

  it('an outage never shows its message, and says it was one', async () => {
    workerAnswers(500, 'R2 put failed: socket hang up');
    const result = await send({
      contentId: CONTENT_ID,
      thumbnail: cover(),
    });
    expect(result).toMatchObject({ success: false, status: 500 });
    expect(result).not.toMatchObject({ error: expect.stringContaining('R2') });
    // Hidden from the creator, never from the logs.
    expect(logger.error).toHaveBeenCalledWith(
      'content.thumbnail_upload_failed',
      expect.objectContaining({ contentId: CONTENT_ID, status: 500 })
    );
  });

  it('a refusal is the creator’s to read, not an outage to log', async () => {
    workerAnswers(422, 'This image is too large to process.');
    await send({
      contentId: CONTENT_ID,
      thumbnail: cover(),
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  // The studio's one rule (`isReadOutage`), as the cover line reads it.
  it('a timeout is an outage, not a refusal', async () => {
    workerAnswers(408, 'Request to content timed out', [200, '']);
    const result = await send({
      contentId: CONTENT_ID,
      thumbnail: cover(),
    });
    expect(result).toEqual({
      success: false,
      status: 408,
      error: 'Failed to upload thumbnail',
    });
    expect(logger.error).toHaveBeenCalledWith(
      'content.thumbnail_upload_failed',
      expect.objectContaining({ status: 408 })
    );
  });

  describe('what goes back with the answer', () => {
    it('a saved cover is never failed by the read after it', async () => {
      workerAnswers(200, '', [500, 'connection to Neon failed']);
      const result = await send({
        contentId: CONTENT_ID,
        thumbnail: cover(),
      });
      expect(result).toEqual({
        success: true,
        thumbnailUrl: 'https://cdn.test/c.webp',
      });
      await expect(sentBack()).resolves.toBeDefined();
      expect(refreshes.size).toBe(0);
      // The warning that kit will re-run the page's loads instead.
      expect(logger.error).toHaveBeenCalledWith(
        'content.thumbnail_reread_failed',
        expect.objectContaining({ status: 500 })
      );
    });

    it('a read refused after the upload is a warning, not an outage', async () => {
      workerAnswers(200, '', [404, NOT_YOURS]);
      await send({
        contentId: CONTENT_ID,
        thumbnail: cover(),
      });
      expect(logger.warn).toHaveBeenCalledWith(
        'content.thumbnail_reread_failed',
        expect.objectContaining({ status: 404 })
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('the piece goes back with a saved cover, read once, so kit re-runs no loads', async () => {
      const fetch = workerAnswers(200, '');
      await send({
        contentId: CONTENT_ID,
        thumbnail: cover(),
      });
      expect(refreshes.size).toBe(1);
      await expect(sentBack()).resolves.toEqual([
        expect.objectContaining({ id: CONTENT_ID }),
      ]);
      // Settle kit's beat: a query called before its read would read again.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(reads(fetch)).toBe(1);
    });

    it('and with a failed one too', async () => {
      const fetch = workerAnswers(500, 'R2 put failed', [200, '']);
      const result = await send({
        contentId: CONTENT_ID,
        thumbnail: cover(),
      });
      expect(result).toMatchObject({ success: false, status: 500 });
      expect(refreshes.size).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(reads(fetch)).toBe(1);
    });

    it('a read that hangs holds the answer back 5s at most, not a page read’s 10', async () => {
      vi.useFakeTimers();
      try {
        const hangs = (init?: RequestInit) =>
          new Promise<Response>((_, reject) =>
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            )
          );
        vi.stubGlobal(
          'fetch',
          vi.fn(async (_url: unknown, init?: RequestInit) =>
            (init?.method ?? 'GET').toUpperCase() === 'GET'
              ? hangs(init)
              : envelope(200, '')
          )
        );
        let answered = false;
        const upload = send({ contentId: CONTENT_ID, thumbnail: cover() }).then(
          (result) => {
            answered = true;
            return result;
          }
        );
        await vi.advanceTimersByTimeAsync(5000);
        expect(answered).toBe(true);
        await expect(upload).resolves.toMatchObject({ success: true });
        expect(logger.error).toHaveBeenCalledWith(
          'content.thumbnail_reread_failed',
          expect.objectContaining({ status: 408 })
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

/**
 * The worker refuses as the publish gate does: the class code on top, the
 * refusal's own in `details`, beside context that must not reach the page.
 */
function refusesWith(code: string, top = 'BUSINESS_LOGIC_ERROR', status = 422) {
  const body = {
    error: {
      code: top,
      message: 'Refused.',
      details: { code, contentId: CONTENT_ID, accessType: 'paid' },
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
    )
  );
}

// The checklist names its row by the refusal's own code (Codex-a6ofh.2.4):
// the class alone could not tell "no media" from "no plan ticked".
describe('a publish refusal keeps its own code', () => {
  it.each([
    'MEDIA_REQUIRED',
    'MEDIA_NOT_READY',
    'TIER_REQUIRED_TO_PUBLISH',
    'CREATOR_CONNECT_REQUIRED',
  ])('publishContent forwards %s', async (code) => {
    refusesWith(code);
    const err = await rejection(remote.publishContent(CONTENT_ID));
    expect(err).toMatchObject({
      status: 422,
      body: { code, message: 'Refused.' },
    });
  });

  it('a creator off the org’s team keeps the 403', async () => {
    refusesWith('NOT_ON_ORG_TEAM', 'FORBIDDEN', 403);
    const err = await rejection(remote.publishContent(CONTENT_ID));
    expect(err).toMatchObject({
      status: 403,
      body: { code: 'NOT_ON_ORG_TEAM' },
    });
  });

  it('a code it does not expect stays the class, and the rest of details stays behind', async () => {
    refusesWith('SOMETHING_ELSE');
    const err = await rejection(remote.publishContent(CONTENT_ID));
    expect(err).toMatchObject({ body: { code: 'BUSINESS_LOGIC_ERROR' } });
    expect((err as { body: object }).body).not.toHaveProperty('contentId');
    expect((err as { body: object }).body).not.toHaveProperty('accessType');
  });

  it('a save to live content carries the rule’s code too', async () => {
    refusesWith('THUMBNAIL_MEDIA_DELETED');
    const err = await rejection(
      remote.saveContent({ id: CONTENT_ID, patch: { title: 'Winter light' } })
    );
    expect(err).toMatchObject({ body: { code: 'THUMBNAIL_MEDIA_DELETED' } });
  });
});
