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

// This file's own subject. The limiter counts per subject across every file
// in this single-worker run, so a shared id runs past the api preset's 100
// a minute and later files read 429 (Codex-a6ofh.2).
const USER = {
  id: '7a1d0f2e-3b4c-4d5e-8f60-000000000005',
  email: 'creator@test.com',
  role: 'creator',
};

const ORG_ID = '3c111111-1111-4111-8111-111111111999';

const contentSpies = {
  list: vi.fn(),
  whereCounts: vi.fn(),
  attentionCounts: vi.fn(),
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
    expect(options).toEqual({ scope: 'studio', withCategories: false });
    expect(filters).not.toHaveProperty('page');
    expect(filters).not.toHaveProperty('limit');

    const body = (await res.json()) as { pagination: { page: number } };
    expect(body.pagination.page).toBe(2);
  });

  it('GET /api/content?include=categories asks for the rows’ categories (Codex-a6ofh.3.3)', async () => {
    const res = await get('?include=categories');

    expect(res.status).toBe(200);
    const { filters, options } = listCall();
    expect(options).toEqual({ scope: 'studio', withCategories: true });
    expect(filters).not.toHaveProperty('include');
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

/**
 * The personal studio's "Where" (Codex-a6ofh.3.2). Its list sent no
 * organizationId, which the service reads as every org, so org pieces showed
 * under "personal". `scope=personal` is the service's `organizationId: null`.
 */
describe('GET /api/content scope (Codex-a6ofh.3.2)', () => {
  beforeEach(() => {
    contentSpies.list.mockReset();
    contentSpies.list.mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  it('scope=personal lists the content filed under no org', async () => {
    const res = await get('?scope=personal');

    expect(res.status).toBe(200);
    const { filters } = listCall();
    expect(filters).toMatchObject({ organizationId: null });
    expect(filters).not.toHaveProperty('scope');
  });

  it('no scope leaves the org open: everything', async () => {
    const res = await get('');
    expect(res.status).toBe(200);
    expect(listCall().filters).not.toHaveProperty('organizationId');
  });

  it('scope=personal beside an organizationId is refused, never one winning', async () => {
    const res = await get(`?scope=personal&organizationId=${ORG_ID}`);

    expect(res.status).toBe(400);
    expect(contentSpies.list).not.toHaveBeenCalled();
  });

  it('browse refuses a scope: it means nothing across creators', async () => {
    const res = await get(`/browse?organizationId=${ORG_ID}&scope=personal`);

    expect(res.status).toBe(400);
    expect(contentSpies.list).not.toHaveBeenCalled();
  });

  it('needs=<kind> reaches the service: a "Needs you" chip (Codex-a6ofh.3.4)', async () => {
    const res = await get('?needs=ready&scope=personal');

    expect(res.status).toBe(200);
    expect(listCall().filters).toMatchObject({
      needs: 'ready',
      organizationId: null,
    });
  });

  it('a needs that is no kind is refused', async () => {
    const res = await get('?needs=urgent');

    expect(res.status).toBe(400);
    expect(contentSpies.list).not.toHaveBeenCalled();
  });
});

describe('GET /api/content/attention (Codex-a6ofh.3.4)', () => {
  const counts = {
    'live-media-gone': 1,
    scheduled: 0,
    'didnt-go-live': 2,
    'media-gone': 0,
    processing: 3,
    ready: 4,
  };

  beforeEach(() => {
    contentSpies.attentionCounts.mockReset();
    contentSpies.attentionCounts.mockResolvedValue(counts);
  });

  it('counts the signed-in creator’s pieces in one org, in the data envelope', async () => {
    const res = await get(`/attention?organizationId=${ORG_ID}`);

    // Above /:id: read as an id, it would be a 400.
    expect(res.status).toBe(200);
    expect(contentSpies.attentionCounts).toHaveBeenCalledWith(USER.id, ORG_ID);
    expect(await res.json()).toEqual({ data: counts });
  });

  it('scope=personal counts the pieces filed under no org; neither, everywhere', async () => {
    expect((await get('/attention?scope=personal')).status).toBe(200);
    expect(contentSpies.attentionCounts).toHaveBeenLastCalledWith(
      USER.id,
      null
    );

    expect((await get('/attention')).status).toBe(200);
    expect(contentSpies.attentionCounts).toHaveBeenLastCalledWith(
      USER.id,
      undefined
    );
  });

  it('scope=personal beside an organizationId is refused, as the list refuses it', async () => {
    const res = await get(`/attention?scope=personal&organizationId=${ORG_ID}`);

    expect(res.status).toBe(400);
    expect(contentSpies.attentionCounts).not.toHaveBeenCalled();
  });
});

describe('GET /api/content/where-counts (Codex-a6ofh.3.2)', () => {
  it('counts the signed-in creator’s own content, in the data envelope', async () => {
    const counts = {
      all: 14,
      personal: 3,
      orgs: [{ id: ORG_ID, name: 'Studio Alpha', count: 11 }],
    };
    contentSpies.whereCounts.mockReset();
    contentSpies.whereCounts.mockResolvedValue(counts);

    const res = await get('/where-counts');

    // Above /:id: read as an id, it would be a 400.
    expect(res.status).toBe(200);
    expect(contentSpies.whereCounts).toHaveBeenCalledWith(USER.id);
    expect(await res.json()).toEqual({ data: counts });
  });
});

describe('GET /api/content resolves each row’s poster (Codex-a6ofh.3.1)', () => {
  it('sends mediaItem.thumbnailUrl beside the key, from the assets base', async () => {
    const THUMB = 'creator-1/media-thumbnails/m1/md.webp';
    contentSpies.list.mockReset();
    contentSpies.list.mockResolvedValue({
      items: [
        {
          id: 'c1',
          title: 'Piece',
          mediaItem: {
            id: 'm1',
            status: 'ready',
            thumbnailKey: THUMB,
            hlsPreviewKey: null,
          },
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const res = await buildApp().fetch(
      new Request('http://content-api.test/api/content'),
      { ...testEnv, R2_PUBLIC_URL_BASE: 'http://localhost:4100' } as typeof env,
      createExecutionContext()
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: {
        mediaItem: { thumbnailKey: string; thumbnailUrl: string | null };
      }[];
    };
    expect(body.items[0]?.mediaItem).toMatchObject({
      thumbnailKey: THUMB,
      thumbnailUrl: `http://localhost:4100/${THUMB}`,
    });
  });
});
