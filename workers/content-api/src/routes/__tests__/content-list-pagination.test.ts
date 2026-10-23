/**
 * The studio list (`GET /api/content`) and signed-in browse
 * (`GET /api/content/browse`) MUST page by the page and limit they were asked
 * for (Codex-uuj1g).
 *
 * THE BUG THIS LOCKS. Both routes called
 * `content.list(userId, ctx.input.query, { scope })`. `ContentService.list`
 * takes its third argument as pagination only when it has a `page` or `limit`,
 * so `{ scope }` read as options and paging fell back to page 1, limit 20. The
 * validated page and limit rode along inside the filters, which `list()` never
 * pages from. A creator with more than 20 pieces saw only the first 20 in the
 * studio whatever page they asked for; /explore's signed-in sorts showed page 1
 * on every page; the studio grant picker asked for 100 and got 20.
 *
 * SHAPE. Real `procedure()` resolver and Hono routing; only `ContentService`
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

const ORG_ID = '3c111111-1111-4111-8111-111111111999';

const contentSpies = {
  list: vi.fn(),
  // The registry calls setCache() on the constructed instance whenever CACHE_KV
  // is bound (it is, in env=test), as content-publish-invalidation.test.ts notes.
  setCache: vi.fn(),
};

vi.mock('@codex/content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/content')>();
  return {
    ...actual,
    ContentService: vi.fn(() => contentSpies),
  };
});

// Below the mock on purpose: biome's organizeImports never moves an import
// across a statement, so this stays after `vi.mock` and the real service
// registry resolves the mocked class.
import content from '../content';

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
  app.route('/api/content', content);
  return app;
}

async function get(pathAndQuery: string): Promise<Response> {
  return buildApp().fetch(
    new Request(`http://content-api.test/api/content${pathAndQuery}`),
    testEnv,
    createExecutionContext()
  );
}

/** The (creatorId, filters, pagination, options) the route handed list(). */
function listCall() {
  expect(contentSpies.list).toHaveBeenCalledTimes(1);
  const [creatorId, filters, pagination, options] =
    contentSpies.list.mock.calls[0] ?? [];
  return { creatorId, filters, pagination, options };
}

describe('content list routes page by the requested page and limit', () => {
  beforeEach(() => {
    contentSpies.list.mockReset();
    contentSpies.list.mockImplementation(
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

  it('GET /api/content passes page 2, limit 5 as pagination, studio scope', async () => {
    const res = await get('?page=2&limit=5');

    expect(res.status).toBe(200);
    const { creatorId, filters, pagination, options } = listCall();
    expect(creatorId).toBe(USER.id);
    expect(pagination).toEqual({ page: 2, limit: 5 });
    expect(options).toEqual({ scope: 'studio' });
    expect(filters).not.toHaveProperty('page');
    expect(filters).not.toHaveProperty('limit');

    const body = (await res.json()) as { pagination: { page: number } };
    expect(body.pagination.page).toBe(2);
  });

  it('GET /api/content with no paging params passes the schema defaults', async () => {
    const res = await get('');

    expect(res.status).toBe(200);
    expect(listCall().pagination).toEqual({ page: 1, limit: 20 });
  });

  it('GET /api/content/browse passes page 3, limit 7 as pagination, browse scope, org kept', async () => {
    const res = await get(`/browse?organizationId=${ORG_ID}&page=3&limit=7`);

    expect(res.status).toBe(200);
    const { filters, pagination, options } = listCall();
    expect(pagination).toEqual({ page: 3, limit: 7 });
    expect(options).toEqual({ scope: 'browse' });
    // The tenant boundary: browse filters by this org, so it must survive the
    // split that moves page and limit out.
    expect(filters).toMatchObject({ organizationId: ORG_ID });
  });

  it('GET /api/content passes a limit of 100 through (the studio grant picker)', async () => {
    const res = await get('?limit=100');

    expect(res.status).toBe(200);
    expect(listCall().pagination).toEqual({ page: 1, limit: 100 });
  });
});
