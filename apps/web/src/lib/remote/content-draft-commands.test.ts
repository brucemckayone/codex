// @vitest-environment node

/**
 * The two commands a content draft saves through (Codex-a6ofh.2.2).
 *
 * `saveContent` PATCHes exactly the fields it is given and lets a refusal
 * reach the browser with its code. `createContentDraft` makes the slug from
 * the title and tries the next one while the worker says it is taken.
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
};

const ID = '5e000000-0000-4000-8000-000000000001';
const ORG = '6e000000-0000-4000-8000-000000000002';

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
  // Nothing comes back: the row would carry the whole body on every save.
  it('PATCHes exactly the fields it is given, and returns nothing', async () => {
    const api = worker(
      json(200, { data: { id: ID, title: 'New title', contentBody: 'Long' } })
    );
    await expect(
      remote.saveContent({ id: ID, patch: { title: 'New title' } })
    ).resolves.toBeUndefined();

    const [request] = api.sent();
    expect(request?.method).toBe('PATCH');
    expect(request?.url).toMatch(new RegExp(`/api/content/${ID}$`));
    expect(request?.body).toEqual({ title: 'New title' });
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

describe('createContentDraft', () => {
  const draft = {
    contentType: 'video',
    organizationId: ORG,
    title: 'Café notes: part 1',
  };

  it('makes the slug from the title, accents folded, and returns only the id', async () => {
    const api = worker(
      json(200, { data: { id: ID, title: draft.title, contentBody: 'Long' } })
    );
    await expect(remote.createContentDraft(draft)).resolves.toEqual({ id: ID });
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
    await expect(remote.createContentDraft(draft)).resolves.toEqual({ id: ID });
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
