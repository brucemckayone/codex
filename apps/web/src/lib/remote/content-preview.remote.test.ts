// @vitest-environment node

/**
 * The studio's preview of a piece as visitors will see it (Codex-a6ofh.2.11):
 * `getContentPreview` reads the creator's own row (creator-scoped, so
 * another creator's id is a 404, kept), renders the body as the public page
 * does, never sends the raw body, and gives a piece with no cover of its own
 * its media's poster, which the public read resolves and the creator's does
 * not.
 *
 * From the REAL api client and its error mapping: only `fetch` is stubbed,
 * and the body renderer, which has its own tests.
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

const render = vi.hoisted(() => ({
  html: '<p>Body</p>' as string | null,
}));
vi.mock('$lib/editor/render', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/editor/render')>()),
  renderContentBody: vi.fn(async () => render.html),
}));

// Kit's remote-module check wants every export tagged with `__`; these
// tests call the query's function straight through.
const makeRemote = (type: string, fn: (...args: unknown[]) => unknown) =>
  Object.assign((...args: unknown[]) => fn(...args), {
    __: { type, id: '', name: '' },
  });
const lastArg = (args: unknown[]) =>
  args[args.length - 1] as (...args: unknown[]) => unknown;
vi.mock('$app/server', () => ({
  command: vi.fn((...args: unknown[]) => makeRemote('command', lastArg(args))),
  form: vi.fn((...args: unknown[]) => makeRemote('form', lastArg(args))),
  query: Object.assign(
    vi.fn((...args: unknown[]) => makeRemote('query', lastArg(args))),
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

const { logger } = await import('$lib/observability');
const { renderContentBody } = await import('$lib/editor/render');
const { getContentPreview } = (await import('./content.remote')) as unknown as {
  getContentPreview: (id: string) => Promise<{
    content: Record<string, unknown> & {
      mediaItem:
        | (Record<string, unknown> & { thumbnailUrl: string | null })
        | null;
    };
    contentBodyHtml: string | null;
    contentBodyUnavailable: boolean;
  }>;
};

const CONTENT_ID = '55555555-5555-4555-8555-555555555555';
const MEDIA_ID = '66666666-6666-4666-8666-666666666666';
const POSTER = 'https://cdn.test/media/poster.webp';

function piece(overrides: Record<string, unknown> = {}) {
  return {
    id: CONTENT_ID,
    title: 'Svelte runes deep dive',
    contentType: 'video',
    status: 'draft',
    thumbnailUrl: null,
    contentBody: null,
    contentBodyJson: { type: 'doc', content: [{ type: 'paragraph' }] },
    mediaItemId: MEDIA_ID,
    mediaItem: {
      id: MEDIA_ID,
      status: 'ready',
      thumbnailKey: 'thumbs/m/1.webp',
    },
    ...overrides,
  };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The content read answers `content`; the media read answers `media`. */
function workerAnswers(
  content: [status: number, body: unknown],
  media: [status: number, body: unknown] = [
    200,
    { data: { id: MEDIA_ID, thumbnailUrl: POSTER } },
  ]
) {
  const fetch = vi.fn(async (url: unknown) => {
    const path = new URL(String(url)).pathname;
    if (path === `/api/media/${MEDIA_ID}`) return json(...media);
    if (path === `/api/content/${CONTENT_ID}`) return json(...content);
    return json(500, {
      error: { code: 'INTERNAL_ERROR', message: `unexpected ${path}` },
    });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const mediaReads = (fetch: ReturnType<typeof workerAnswers>) =>
  fetch.mock.calls.filter(([url]) =>
    new URL(String(url)).pathname.startsWith('/api/media/')
  ).length;

beforeEach(() => {
  vi.clearAllMocks();
  render.html = '<p>Body</p>';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getContentPreview', () => {
  it('renders the body as the public page does, and never sends the raw body', async () => {
    workerAnswers([
      200,
      { data: piece({ thumbnailUrl: 'https://cdn.test/cover.webp' }) },
    ]);

    const preview = await getContentPreview(CONTENT_ID);

    expect(preview.contentBodyHtml).toBe('<p>Body</p>');
    expect(preview.contentBodyUnavailable).toBe(false);
    expect(preview.content.contentBody).toBeNull();
    expect(preview.content.contentBodyJson).toBeNull();
    expect(renderContentBody).toHaveBeenCalledWith(
      expect.objectContaining({ contentBodyJson: expect.any(Object) }),
      { contentId: CONTENT_ID, surface: 'studio-preview' }
    );
  });

  it('says stored text that rendered to nothing, never shows it as no body', async () => {
    render.html = null;
    workerAnswers([
      200,
      { data: piece({ thumbnailUrl: 'https://cdn.test/cover.webp' }) },
    ]);

    const preview = await getContentPreview(CONTENT_ID);

    expect(preview.contentBodyHtml).toBeNull();
    expect(preview.contentBodyUnavailable).toBe(true);
  });

  it('gives a piece with no cover its media’s poster, from the media read', async () => {
    const fetch = workerAnswers([200, { data: piece() }]);

    const preview = await getContentPreview(CONTENT_ID);

    expect(preview.content.mediaItem?.thumbnailUrl).toBe(POSTER);
    expect(mediaReads(fetch)).toBe(1);
  });

  it('reads no media for a piece with its own cover', async () => {
    const fetch = workerAnswers([
      200,
      { data: piece({ thumbnailUrl: 'https://cdn.test/cover.webp' }) },
    ]);

    const preview = await getContentPreview(CONTENT_ID);

    expect(mediaReads(fetch)).toBe(0);
    expect(preview.content.thumbnailUrl).toBe('https://cdn.test/cover.webp');
    expect(preview.content.mediaItem?.thumbnailUrl).toBeNull();
  });

  it('reads no media for one whose media has no poster, or no media', async () => {
    const fetch = workerAnswers([
      200,
      {
        data: piece({
          mediaItem: { id: MEDIA_ID, status: 'uploading', thumbnailKey: null },
        }),
      },
    ]);
    expect(
      (await getContentPreview(CONTENT_ID)).content.mediaItem?.thumbnailUrl
    ).toBeNull();

    workerAnswers([
      200,
      {
        data: piece({
          mediaItemId: null,
          mediaItem: null,
          contentType: 'written',
        }),
      },
    ]);
    expect((await getContentPreview(CONTENT_ID)).content.mediaItem).toBeNull();
    expect(mediaReads(fetch)).toBe(0);
  });

  it('never reads a deleted file’s poster: the preview says it was deleted', async () => {
    const fetch = workerAnswers([
      200,
      {
        data: piece({
          mediaItem: {
            id: MEDIA_ID,
            status: 'ready',
            thumbnailKey: 'thumbs/m/1.webp',
            deletedAt: '2026-11-01T00:00:00.000Z',
          },
        }),
      },
    ]);

    const preview = await getContentPreview(CONTENT_ID);

    expect(mediaReads(fetch)).toBe(0);
    expect(preview.content.mediaItem?.thumbnailUrl).toBeNull();
  });

  it('a poster read that fails is logged, and the preview shows none', async () => {
    workerAnswers(
      [200, { data: piece() }],
      [500, { error: { code: 'INTERNAL_ERROR', message: 'down' } }]
    );

    const preview = await getContentPreview(CONTENT_ID);

    expect(preview.content.mediaItem?.thumbnailUrl).toBeNull();
    expect(preview.contentBodyHtml).toBe('<p>Body</p>');
    expect(logger.warn).toHaveBeenCalledWith(
      'studio_content_preview.poster_read_failed',
      expect.objectContaining({ contentId: CONTENT_ID, mediaId: MEDIA_ID })
    );
  });

  it('keeps a 404 (another creator’s piece, or one deleted) as a 404', async () => {
    workerAnswers([
      404,
      { error: { code: 'NOT_FOUND', message: 'Content not found' } },
    ]);

    const caught = await getContentPreview(CONTENT_ID).then(
      () => undefined,
      (err: unknown) => err
    );

    expect(caught).toMatchObject({
      status: 404,
      body: { message: 'Content not found' },
    });
    expect(renderContentBody).not.toHaveBeenCalled();
  });

  it('an outage is not dressed as a 404', async () => {
    workerAnswers([
      500,
      { error: { code: 'INTERNAL_ERROR', message: 'down' } },
    ]);

    const caught = await getContentPreview(CONTENT_ID).then(
      () => undefined,
      (err: unknown) => err
    );

    expect(caught).toBeDefined();
    expect(caught).not.toMatchObject({ status: 404 });
  });
});
