// @vitest-environment node

/**
 * The two commands a content draft saves through (Codex-a6ofh.2.2).
 *
 * `saveContent` PATCHes exactly the fields it is given and lets a refusal
 * reach the browser with its code. `createContentDraft` makes the slug from
 * the title and tries the next one while the worker says it is taken, and so
 * does `saveContent` for a slug that follows the title (Codex-a6ofh.2.4).
 *
 * From the REAL envelope, as in agreements-refusal-forwarding.test.ts: only
 * `fetch` is stubbed, so `createServerApi` parses each response and
 * `forwardClientErrors` rethrows through the real `error()`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/observability', () => ({
  logger: {
    startTimer: vi.fn(() => ({ end: vi.fn() })),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('$lib/server/api', async () => vi.importActual('$lib/server/api'));

const makeRemote = (type: string, fn: (...args: unknown[]) => unknown) =>
  Object.assign((...args: unknown[]) => fn(...args), {
    __: { type, id: '', name: '' },
  });
const lastArg = (args: unknown[]) =>
  args[args.length - 1] as (...args: unknown[]) => unknown;
vi.mock('$app/server', () => ({
  command: vi.fn((...args: unknown[]) => makeRemote('command', lastArg(args))),
  form: vi.fn((...args: unknown[]) => makeRemote('form', lastArg(args))),
  // content.remote also builds a batched query (getContentBatch).
  query: Object.assign(
    vi.fn((...args: unknown[]) => makeRemote('query', lastArg(args))),
    {
      batch: vi.fn((...args: unknown[]) =>
        makeRemote('query_batch', lastArg(args))
      ),
    }
  ),
  getRequestEvent: vi.fn(() => ({
    platform: { env: {} },
    cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
  })),
}));

const remote = (await import('./content.remote')) as unknown as {
  saveContent: (input: Record<string, unknown>) => Promise<unknown>;
  createContentDraft: (input: Record<string, unknown>) => Promise<unknown>;
  deleteContent: (id: string) => Promise<unknown>;
};

const ID = '5e000000-0000-4000-8000-000000000001';
const ORG = '6e000000-0000-4000-8000-000000000002';
const STAGED_COVER = 'https://cdn.example/stage/lg.webp';
const KEPT_COVER = 'https://cdn.example/stored/lg.webp';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const refused = (status: number, code: string, message: string) =>
  json(status, { error: { code, message } });

/** The worker answers each call in turn; every request is kept. */
function worker(...answers: Response[]) {
  const fetch = vi.fn(async () => {
    const next = answers.shift();
    if (!next) throw new Error('no answer left for this request');
    return next;
  });
  vi.stubGlobal('fetch', fetch);
  return {
    sent: () =>
      fetch.mock.calls.map((call) => {
        const [url, init] = call as unknown as [string, RequestInit];
        return {
          url: String(url),
          method: init?.method,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        };
      }),
  };
}

const rejection = (attempt: Promise<unknown>) =>
  attempt.then(
    () => undefined,
    (caught: unknown) => caught
  );

afterEach(() => vi.unstubAllGlobals());

describe('saveContent', () => {
  // No row comes back: it would carry the whole body on every save.
  it('PATCHes exactly the fields it is given, and returns no row', async () => {
    const api = worker(
      json(200, { data: { id: ID, title: 'New title', contentBody: 'Long' } })
    );
    await expect(
      remote.saveContent({ id: ID, patch: { title: 'New title' } })
    ).resolves.toEqual({});

    const [request] = api.sent();
    expect(request?.method).toBe('PATCH');
    expect(request?.url).toMatch(new RegExp(`/api/content/${ID}$`));
    expect(request?.body).toEqual({ title: 'New title' });
  });

  // The PATCH may keep the stored cover instead of a stage it cannot take;
  // only the row knows which, so a sent cover comes back as the row has it.
  it('a sent cover comes back as the row kept it', async () => {
    worker(json(200, { data: { id: ID, thumbnailUrl: KEPT_COVER } }));
    await expect(
      remote.saveContent({ id: ID, patch: { thumbnailUrl: STAGED_COVER } })
    ).resolves.toEqual({ thumbnailUrl: KEPT_COVER });
  });

  it('a refusal reaches the browser with its status, code and message', async () => {
    worker(
      refused(
        422,
        'BUSINESS_LOGIC_ERROR',
        'This article needs something to read before it can be live.'
      )
    );
    const err = await rejection(
      remote.saveContent({ id: ID, patch: { contentBody: '' } })
    );
    expect(err).toMatchObject({
      status: 422,
      body: {
        code: 'BUSINESS_LOGIC_ERROR',
        message: 'This article needs something to read before it can be live.',
      },
    });
  });
});

// A draft's autosave says so, and the server refuses it once the piece went
// live meanwhile (Codex-a6ofh.2): that refusal reaches the session by its
// own code, which is how the editor learns it is live.
describe('saveContent as a draft', () => {
  it('a draft save PATCHes with asDraft=true; an ordinary one without', async () => {
    const api = worker(
      json(200, { data: { id: ID, title: 'A' } }),
      json(200, { data: { id: ID, title: 'B' } })
    );

    await remote.saveContent({ id: ID, patch: { title: 'A' }, asDraft: true });
    await remote.saveContent({ id: ID, patch: { title: 'B' } });

    const [asDraft, plain] = api.sent();
    expect(asDraft?.url).toMatch(
      new RegExp(`/api/content/${ID}\\?asDraft=true$`)
    );
    expect(plain?.url).toMatch(new RegExp(`/api/content/${ID}$`));
  });

  it('one refused as live reaches the browser as CONTENT_ALREADY_LIVE', async () => {
    worker(
      json(409, {
        error: {
          code: 'CONFLICT',
          message: 'This went live, so a draft save can’t change it.',
          details: { contentId: ID, code: 'CONTENT_ALREADY_LIVE' },
        },
      })
    );
    const err = await rejection(
      remote.saveContent({ id: ID, patch: { title: 'A' }, asDraft: true })
    );
    expect(err).toMatchObject({
      status: 409,
      body: { code: 'CONTENT_ALREADY_LIVE' },
    });
  });
});

// The live editor's Delete reads a piece already gone as done, so the
// piece's own not-found must reach it: the class code says any 404.
describe('deleteContent (Codex-a6ofh.2.5)', () => {
  it('a piece already gone reaches the browser by its own code', async () => {
    worker(
      json(404, {
        error: {
          code: 'NOT_FOUND',
          message: 'Content not found',
          details: { contentId: ID, code: 'CONTENT_NOT_FOUND' },
        },
      })
    );
    const err = await rejection(remote.deleteContent(ID));
    expect(err).toMatchObject({
      status: 404,
      body: { code: 'CONTENT_NOT_FOUND' },
    });
  });

  it('any other 404 keeps its class code', async () => {
    worker(refused(404, 'NOT_FOUND', 'Not found'));
    const err = await rejection(remote.deleteContent(ID));
    expect(err).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } });
  });
});

describe('saveContent with a slug the title gives', () => {
  const taken = () =>
    refused(409, 'CONFLICT', 'Content with this slug already exists');

  it('a taken slug that follows the title tries -2, and says which took', async () => {
    const api = worker(taken(), json(200, { data: { id: ID } }));
    await expect(
      remote.saveContent({
        id: ID,
        patch: { title: 'Winter light', slug: 'winter-light' },
        slugFollowsTitle: true,
      })
    ).resolves.toEqual({ slug: 'winter-light-2' });
    expect(api.sent().map((request) => request.body)).toEqual([
      { title: 'Winter light', slug: 'winter-light' },
      { title: 'Winter light', slug: 'winter-light-2' },
    ]);
  });

  it('a free one goes once and says so', async () => {
    const api = worker(json(200, { data: { id: ID } }));
    await expect(
      remote.saveContent({
        id: ID,
        patch: { slug: 'winter-light' },
        slugFollowsTitle: true,
      })
    ).resolves.toEqual({ slug: 'winter-light' });
    expect(api.sent()).toHaveLength(1);
  });

  it('a sent cover comes back as the row kept it here too', async () => {
    worker(json(200, { data: { id: ID, thumbnailUrl: KEPT_COVER } }));
    await expect(
      remote.saveContent({
        id: ID,
        patch: { slug: 'winter-light', thumbnailUrl: STAGED_COVER },
        slugFollowsTitle: true,
      })
    ).resolves.toEqual({ slug: 'winter-light', thumbnailUrl: KEPT_COVER });
  });

  it('a slug the creator typed is theirs: taken, it is refused at once', async () => {
    const api = worker(taken());
    const err = await rejection(
      remote.saveContent({ id: ID, patch: { slug: 'winter-light' } })
    );
    expect(err).toMatchObject({ status: 409, body: { code: 'CONFLICT' } });
    expect(api.sent()).toHaveLength(1);
  });
});

describe('createContentDraft', () => {
  const draft = {
    contentType: 'video',
    organizationId: ORG,
    title: 'Café notes: part 1',
  };

  it('makes the slug from the title, accents folded, and returns the id and slug', async () => {
    const api = worker(
      json(200, { data: { id: ID, title: draft.title, contentBody: 'Long' } })
    );
    await expect(remote.createContentDraft(draft)).resolves.toEqual({
      id: ID,
      slug: 'cafe-notes-part-1',
    });
    expect(api.sent()[0]?.body).toEqual({
      ...draft,
      slug: 'cafe-notes-part-1',
    });
  });

  it('a title with no letters to use falls back to the type', async () => {
    const api = worker(json(200, { data: { id: ID } }));
    await remote.createContentDraft({ ...draft, title: '🎧 ✨' });
    expect(api.sent()[0]?.body.slug).toBe('video');
  });

  it('a taken slug tries -2, then -3', async () => {
    const taken = () =>
      refused(409, 'CONFLICT', 'Content with this slug already exists');
    const api = worker(taken(), taken(), json(200, { data: { id: ID } }));
    await expect(remote.createContentDraft(draft)).resolves.toEqual({
      id: ID,
      slug: 'cafe-notes-part-1-3',
    });
    expect(api.sent().map((request) => request.body.slug)).toEqual([
      'cafe-notes-part-1',
      'cafe-notes-part-1-2',
      'cafe-notes-part-1-3',
    ]);
  });

  it('gives up after six tries, the last with a random suffix, and says so', async () => {
    const answers = Array.from({ length: 6 }, () =>
      refused(409, 'CONFLICT', 'Content with this slug already exists')
    );
    const api = worker(...answers);
    const err = await rejection(remote.createContentDraft(draft));

    expect(err).toMatchObject({ status: 409, body: { code: 'CONFLICT' } });
    const slugs = api.sent().map((request) => request.body.slug as string);
    expect(slugs).toHaveLength(6);
    expect(slugs[4]).toBe('cafe-notes-part-1-5');
    expect(slugs[5]).toMatch(/^cafe-notes-part-1-[0-9a-f]{6}$/);
  });

  it('any other refusal is forwarded at once, with no retry', async () => {
    const api = worker(
      refused(
        403,
        'NOT_ON_ORG_TEAM',
        'You are not on this organization’s team.'
      )
    );
    const err = await rejection(remote.createContentDraft(draft));
    expect(err).toMatchObject({
      status: 403,
      body: { code: 'NOT_ON_ORG_TEAM' },
    });
    expect(api.sent()).toHaveLength(1);
  });
});
