/**
 * `POST /api/content/:id/categories` (Codex-a6ofh.3.3): adds categories to a
 * piece, keeping the ones it has, for the list's bulk "Add to category".
 *
 * SHAPE. Real `procedure()` resolver and Hono routing; only `ContentService`
 * and the cache bump are stubbed (no Neon, no KV), so the assertions are the
 * arguments the service receives, the envelope, and when caches are bumped.
 * The service's own rules (space, the 20 limit, idempotence) are tested
 * against a database in @codex/content's content-service-categories.test.ts.
 */

import { createExecutionContext, env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// This file's own subject: the limiter counts per subject across every file
// in this single-worker run (Codex-a6ofh.2).
const USER = {
  id: '7a1d0f2e-3b4c-4d5e-8f60-000000000033',
  email: 'creator@test.com',
  role: 'creator',
};

const CONTENT_ID = '3c111111-1111-4111-8111-111111111abc';
const ORG_ID = '3c111111-1111-4111-8111-111111111999';
const CATEGORY = '7c000000-0000-4000-8000-000000000001';

const contentSpies = {
  addCategories: vi.fn(),
  // The registry calls setCache() on the constructed instance whenever
  // CACHE_KV is bound (it is, in env=test).
  setCache: vi.fn(),
};

vi.mock('@codex/content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/content')>();
  return {
    ...actual,
    ContentService: vi.fn(() => contentSpies),
  };
});

const bumpOrgContentVersion = vi.hoisted(() => vi.fn());
vi.mock('../content-invalidation', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../content-invalidation')>();
  return { ...actual, bumpOrgContentVersion };
});

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

describe('POST /api/content/:id/categories', () => {
  beforeEach(() => {
    contentSpies.addCategories.mockReset();
    bumpOrgContentVersion.mockReset();
  });

  it('adds for the signed-in creator and answers with the set after', async () => {
    contentSpies.addCategories.mockResolvedValue({
      categoryIds: ['had', CATEGORY],
      organizationId: ORG_ID,
      hasBeenLive: false,
    });

    const res = await post(`/${CONTENT_ID}/categories`, {
      categoryIds: [CATEGORY],
    });

    expect(res.status).toBe(200);
    expect(contentSpies.addCategories).toHaveBeenCalledWith(
      CONTENT_ID,
      USER.id,
      [CATEGORY]
    );
    expect(await res.json()).toEqual({
      data: { categoryIds: ['had', CATEGORY] },
    });
  });

  it('bumps the org’s caches for a piece that has been live, and only then', async () => {
    contentSpies.addCategories.mockResolvedValue({
      categoryIds: [CATEGORY],
      organizationId: ORG_ID,
      hasBeenLive: true,
    });
    await post(`/${CONTENT_ID}/categories`, { categoryIds: [CATEGORY] });
    expect(bumpOrgContentVersion).toHaveBeenCalledTimes(1);
    expect(bumpOrgContentVersion.mock.calls[0]?.[2]).toBe(ORG_ID);

    // A never-live draft is in no cache.
    bumpOrgContentVersion.mockReset();
    contentSpies.addCategories.mockResolvedValue({
      categoryIds: [CATEGORY],
      organizationId: ORG_ID,
      hasBeenLive: false,
    });
    await post(`/${CONTENT_ID}/categories`, { categoryIds: [CATEGORY] });
    expect(bumpOrgContentVersion).not.toHaveBeenCalled();
  });

  it.each([
    ['no categories', { categoryIds: [] }],
    [
      'more than 20 at once',
      {
        categoryIds: Array.from(
          { length: 21 },
          (_, i) => `7c000000-0000-4000-8000-${String(i).padStart(12, '0')}`
        ),
      },
    ],
    ['an id that is no uuid', { categoryIds: ['tutorials'] }],
    ['no body field', {}],
  ])('refuses %s with a 400, before the service', async (_case, body) => {
    const res = await post(`/${CONTENT_ID}/categories`, body);
    expect(res.status).toBe(400);
    expect(contentSpies.addCategories).not.toHaveBeenCalled();
  });

  it('refuses a piece id that is no uuid', async () => {
    const res = await post('/not-an-id/categories', {
      categoryIds: [CATEGORY],
    });
    expect(res.status).toBe(400);
    expect(contentSpies.addCategories).not.toHaveBeenCalled();
  });
});
