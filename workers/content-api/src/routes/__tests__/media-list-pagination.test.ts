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

const USER = {
  id: '7a1d0f2e-3b4c-4d5e-8f60-112233445566',
  email: 'creator@test.com',
  role: 'creator',
};

const mediaSpies = { list: vi.fn() };

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

function buildApp() {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('user', USER);
    c.set('session', { id: 'sess_test', userId: USER.id });
    await next();
  });
  app.route('/api/media', media);
  return app;
}

async function get(query: string): Promise<Response> {
  return buildApp().fetch(
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
    expect(listCall().pagination).toEqual({ page: 1, limit: 20 });
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
});
