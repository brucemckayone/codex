/**
 * The media list (`GET /api/media`) MUST page by the page and limit it was
 * asked for (Codex-9hh1n).
 *
 * THE BUG THIS LOCKS. The route called `media.list(userId, ctx.input.query)`.
 * `MediaItemService.list` pages from its third argument only, so page and
 * limit rode along inside the filters and paging fell back to page 1, limit
 * 20. The studio media library showed the same 20 on every page; the content
 * form's picker asked for 50 and the page builder's film slots for 100, and
 * both got the newest 20. The content lists had the same bug (Codex-uuj1g;
 * content-list-pagination.test.ts).
 *
 * SHAPE. Real `procedure()` resolver and Hono routing; only `MediaItemService`
 * is stubbed (no Neon), so the assertion is the argument the service receives,
 * which is the contract the bug broke.
 */

import { createExecutionContext, env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Its own user id: the limiter counts per user, `singleWorker` shares one
// limiter across files, and ten files already spend the usual test user's
// 100 a minute.
const USER = {
  id: 'medialistpage01',
  email: 'creator@test.com',
  role: 'creator',
};

const mediaSpies = { list: vi.fn(), summary: vi.fn(), get: vi.fn() };

vi.mock('@codex/content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/content')>();
  return {
    ...actual,
    MediaItemService: vi.fn(() => mediaSpies),
  };
});

// Below the mock on purpose: biome's organizeImports never moves an import
// across a statement, so this stays after `vi.mock` and the real service
// registry resolves the mocked class.
import media from '../media';

const testEnv = {
  ...env,
  ENVIRONMENT: 'development',
} as unknown as typeof env;

function buildApp(signedIn = true) {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    if (signedIn) {
      c.set('user', USER);
      c.set('session', { id: 'sess_test', userId: USER.id });
    }
    await next();
  });
  app.route('/api/media', media);
  return app;
}

async function get(query: string, signedIn = true): Promise<Response> {
  return buildApp(signedIn).fetch(
    new Request(`http://content-api.test/api/media${query}`),
    testEnv,
    createExecutionContext()
  );
}

/** The (creatorId, filters, pagination) the route handed list(). */
function listCall() {
  expect(mediaSpies.list).toHaveBeenCalledTimes(1);
  const [creatorId, filters, pagination] = mediaSpies.list.mock.calls[0] ?? [];
  return { creatorId, filters, pagination };
}

describe('GET /api/media pages by the requested page and limit', () => {
  beforeEach(() => {
    mediaSpies.list.mockReset();
    mediaSpies.list.mockImplementation(
      async (
        _creatorId: string,
        _filters: unknown,
        pagination: { page: number; limit: number }
      ) => ({
        items: [],
        pagination: { ...pagination, total: 0, totalPages: 0 },
      })
    );
  });

  it('passes page 2, limit 5 as pagination, and answers page 2', async () => {
    const res = await get('?page=2&limit=5');

    expect(res.status).toBe(200);
    const { creatorId, filters, pagination } = listCall();
    expect(creatorId).toBe(USER.id);
    expect(pagination).toEqual({ page: 2, limit: 5 });
    expect(filters).not.toHaveProperty('page');
    expect(filters).not.toHaveProperty('limit');

    const body = (await res.json()) as { pagination: { page: number } };
    expect(body.pagination.page).toBe(2);
  });

  it('passes the schema defaults when no paging params are sent', async () => {
    const res = await get('');

    expect(res.status).toBe(200);
    expect(listCall().pagination).toEqual({ page: 1, limit: 24 });
  });

  it('passes a limit of 100 through (the page builder film slots)', async () => {
    const res = await get('?status=ready&limit=100');

    expect(res.status).toBe(200);
    expect(listCall().pagination).toEqual({ page: 1, limit: 100 });
  });

  it('keeps status and type in the filters', async () => {
    const res = await get('?status=ready&mediaType=video&page=3&limit=7');

    expect(res.status).toBe(200);
    const { filters, pagination } = listCall();
    expect(pagination).toEqual({ page: 3, limit: 7 });
    expect(filters).toMatchObject({ status: 'ready', mediaType: 'video' });
  });

  it('passes the search, a status group, the usage filter and a new sort to the service (Codex-a6ofh.1.4)', async () => {
    const res = await get(
      '?search=%2050%25%20&status=attention&usage=unused&sortBy=durationSeconds'
    );

    expect(res.status).toBe(200);
    expect(listCall().filters).toMatchObject({
      search: '50%',
      status: 'attention',
      usage: 'unused',
      sortBy: 'durationSeconds',
    });
  });

  it('refuses a usage or status the API does not know, before the service runs, naming what it takes', async () => {
    expect((await get('?usage=some')).status).toBe(400);
    const res = await get('?status=stalled');
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; details?: unknown };
    };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    // One enum, so the refusal lists the groups beside the raw statuses.
    expect(JSON.stringify(body.error.details)).toContain('attention');
    expect(mediaSpies.list).not.toHaveBeenCalled();
  });
});

describe('GET /api/media/summary (Codex-a6ofh.1.6)', () => {
  beforeEach(() => {
    mediaSpies.summary.mockReset();
    mediaSpies.summary.mockResolvedValue({
      total: 12,
      totalBytes: 6_871_947_673,
      failed: 1,
      stopped: 1,
    });
  });

  // Registered above `/:id`, which would read "summary" as an id and 400.
  it("answers the caller's own summary, never reading 'summary' as an id", async () => {
    const res = await get('/summary');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { total: 12, totalBytes: 6_871_947_673, failed: 1, stopped: 1 },
    });
    expect(mediaSpies.summary).toHaveBeenCalledWith(USER.id);
  });

  it('needs a session', async () => {
    expect((await get('/summary', false)).status).toBe(401);
    expect(mediaSpies.summary).not.toHaveBeenCalled();
  });
});

// The picker shows the chosen item from the single read alone
// (Codex-a6ofh.1.8), so it resolves the poster as the list rows do.
describe('GET /api/media/:id sends its poster', () => {
  const ID = '6b000000-0000-4000-8000-000000000001';
  const KEY = `creator-1/media-thumbnails/${ID}/md.webp`;

  beforeEach(() => mediaSpies.get.mockReset());

  async function read(cdnBase: string | undefined) {
    mediaSpies.get.mockResolvedValue({
      id: ID,
      title: 'Tour',
      thumbnailKey: KEY,
    });
    return buildApp().fetch(
      new Request(`http://content-api.test/api/media/${ID}`),
      { ...testEnv, R2_PUBLIC_URL_BASE: cdnBase } as typeof env,
      createExecutionContext()
    );
  }

  it("as the CDN URL the list rows send, for the caller's own item", async () => {
    const res = await read('https://cdn.test');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { thumbnailUrl: string | null };
    };
    expect(body.data.thumbnailUrl).toBe(`https://cdn.test/${KEY}`);
    expect(mediaSpies.get).toHaveBeenCalledWith(ID, USER.id);
  });

  it('as null when no CDN base is configured, never a relative key', async () => {
    const res = await read(undefined);
    const body = (await res.json()) as {
      data: { thumbnailUrl: string | null };
    };
    expect(body.data.thumbnailUrl).toBeNull();
  });
});
