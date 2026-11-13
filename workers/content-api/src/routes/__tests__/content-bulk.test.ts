/**
 * `POST /api/content/bulk/<action>` (Codex-a6ofh.3.5, owner 2026-11-12:
 * "Bulk endpoints, one bump"): one request for the content list's selection,
 * a result per piece.
 *
 * SHAPE. Real `procedure()` resolver and Hono routing; only `ContentService`,
 * the cache work and the cover cleanup are stubbed (no Neon, no KV), so the
 * assertions are what the service receives, the envelope, and which cache
 * work follows. Each piece's rules are tested against a database in
 * @codex/content's content-service-bulk.test.ts.
 */

import { createExecutionContext, env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// This file's own subject: the limiter counts per subject across every file
// in this single-worker run (Codex-a6ofh.2).
const USER = {
  id: '7a1d0f2e-3b4c-4d5e-8f60-000000000035',
  email: 'creator@test.com',
  role: 'creator',
};

const A = '3c111111-1111-4111-8111-1111111110a1';
const B = '3c111111-1111-4111-8111-1111111110b2';
const ORG_ID = '3c111111-1111-4111-8111-111111111999';
const CATEGORY = '7c000000-0000-4000-8000-000000000001';

const RESULTS = [
  { id: A, outcome: 'done' },
  {
    id: B,
    outcome: 'refused',
    error: { code: 'CONFLICT', message: 'Bought by 2 people.' },
  },
];
const TOUCHED = [{ id: A, organizationId: ORG_ID }];

const contentSpies = {
  publishMany: vi.fn(),
  unpublishMany: vi.fn(),
  deleteMany: vi.fn(),
  addCategoriesMany: vi.fn(),
  accessMany: vi.fn(),
  setCache: vi.fn(),
};

vi.mock('@codex/content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/content')>();
  return {
    ...actual,
    ContentService: vi.fn(() => contentSpies),
  };
});

const afterBulkChange = vi.hoisted(() => vi.fn());
vi.mock('../content-invalidation', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../content-invalidation')>();
  return { ...actual, afterBulkChange };
});

const cleanupContentThumbnailOnDelete = vi.hoisted(() =>
  vi.fn(
    (_images: unknown, _contentId: string, _userId: string, _obs?: unknown) =>
      Promise.resolve()
  )
);
vi.mock('../content-cleanup', () => ({ cleanupContentThumbnailOnDelete }));

// Below the mocks on purpose: biome's organizeImports never moves an import
// across a statement, so the real routes resolve the mocked modules.
import content from '../content';

const testEnv = {
  ...env,
  ENVIRONMENT: 'development',
} as unknown as typeof env;

async function post(path: string, body: unknown): Promise<Response> {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('user', USER);
    c.set('session', { id: 'sess_test', userId: USER.id });
    await next();
  });
  app.route('/api/content', content);
  return await app.fetch(
    new Request(`http://content-api.test/api/content${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    testEnv,
    createExecutionContext()
  );
}

const ids = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => `3c111111-1111-4111-8111-${String(i).padStart(12, '0')}`
  );

describe('POST /api/content/bulk/*', () => {
  beforeEach(() => {
    for (const spy of Object.values(contentSpies)) spy.mockReset();
    for (const many of [
      contentSpies.publishMany,
      contentSpies.unpublishMany,
      contentSpies.deleteMany,
      contentSpies.addCategoriesMany,
      contentSpies.accessMany,
    ]) {
      many.mockResolvedValue({ results: RESULTS, touched: TOUCHED });
    }
    afterBulkChange.mockReset();
    cleanupContentThumbnailOnDelete.mockClear();
  });

  it.each([
    ['publish', 'publishMany', 'content_published'],
    ['unpublish', 'unpublishMany', 'content_unpublished'],
    ['delete', 'deleteMany', 'content_deleted'],
  ] as const)('%s: each piece for the signed-in creator, its result back, one refresh', async (action, method, reason) => {
    const res = await post(`/bulk/${action}`, { ids: [A, B] });

    expect(res.status).toBe(200);
    expect(contentSpies[method]).toHaveBeenCalledWith([A, B], USER.id);
    expect(await res.json()).toEqual({ data: { results: RESULTS } });
    expect(afterBulkChange).toHaveBeenCalledTimes(1);
    expect(afterBulkChange.mock.calls[0]?.[2]).toEqual(TOUCHED);
    expect(afterBulkChange.mock.calls[0]?.[3]).toBe(reason);
  });

  it('delete clears each deleted cover, in the background', async () => {
    await post('/bulk/delete', { ids: [A, B] });

    expect(cleanupContentThumbnailOnDelete).toHaveBeenCalledTimes(1);
    expect(cleanupContentThumbnailOnDelete.mock.calls[0]?.[1]).toBe(A);
    expect(cleanupContentThumbnailOnDelete.mock.calls[0]?.[2]).toBe(USER.id);
  });

  it('categories: the categories to each piece, the org caches only', async () => {
    const res = await post('/bulk/categories', {
      ids: [A, B],
      categoryIds: [CATEGORY],
    });

    expect(res.status).toBe(200);
    expect(contentSpies.addCategoriesMany).toHaveBeenCalledWith(
      [A, B],
      USER.id,
      [CATEGORY]
    );
    expect(afterBulkChange.mock.calls[0]?.[3]).toBeNull();
  });

  it('access: the access group alone reaches the service', async () => {
    const access = {
      isFree: false,
      isPurchasable: true,
      priceCents: 1200,
      isFollowerGated: false,
      isTeamOnly: false,
    };
    const res = await post('/bulk/access', { ids: [A], access });

    expect(res.status).toBe(200);
    expect(contentSpies.accessMany).toHaveBeenCalledWith([A], USER.id, access);
    expect(afterBulkChange.mock.calls[0]?.[3]).toBe('content_updated');
  });

  it.each([
    ['no pieces', '/bulk/publish', { ids: [] }],
    ['a sixteenth piece', '/bulk/unpublish', { ids: ids(16) }],
    ['a repeated piece', '/bulk/delete', { ids: [A, A] }],
    ['an id that is no uuid', '/bulk/publish', { ids: ['draft-video'] }],
    ['no categories', '/bulk/categories', { ids: [A], categoryIds: [] }],
    [
      'a title riding along with the access',
      '/bulk/access',
      { ids: [A], access: { isFree: true, title: 'Renamed' } },
    ],
    [
      'access an update refuses',
      '/bulk/access',
      { ids: [A], access: { isFree: true, priceCents: 500 } },
    ],
  ])('refuses %s with a 400, before the service', async (_case, path, body) => {
    const res = await post(path, body);

    expect(res.status).toBe(400);
    for (const many of [
      contentSpies.publishMany,
      contentSpies.unpublishMany,
      contentSpies.deleteMany,
      contentSpies.addCategoriesMany,
      contentSpies.accessMany,
    ]) {
      expect(many).not.toHaveBeenCalled();
    }
    expect(afterBulkChange).not.toHaveBeenCalled();
  });

  it('every bulk path is its own route, never read as a piece called "bulk"', () => {
    const posts = content.routes
      .filter((route) => route.method === 'POST')
      .map((route) => route.path);
    for (const action of [
      'publish',
      'unpublish',
      'delete',
      'categories',
      'access',
    ]) {
      const bulk = posts.indexOf(`/bulk/${action}`);
      expect(bulk).toBeGreaterThanOrEqual(0);
      const perPiece = posts.indexOf(`/:id/${action}`);
      if (perPiece >= 0) expect(bulk).toBeLessThan(perPiece);
    }
  });
});
