/**
 * `GET /api/content/public/removed` (Codex-a6ofh.6.7, LN9b) through the REAL
 * route and `procedure()`: the detail pages ask it, after every lookup
 * missed, whether a once-published piece at the URL's key was removed, for
 * the 410 page.
 *
 * It is public, so what it may say is the contract: two booleans, never the
 * piece (a takedown must not show what was taken down). The key is the
 * detail URL's own, exactly one of `(orgId, slug)` or `(creatorId, slug)`.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { CACHE_PRESETS } from '@codex/constants';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const contentSpies = {
  removedPiece: vi.fn(),
  // The registry calls `setCache(...)` on the constructed instance.
  setCache: vi.fn(),
};

vi.mock('@codex/content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/content')>();
  return { ...actual, ContentService: vi.fn(() => contentSpies) };
});

// Import the route AFTER the mock so the real registry resolves the mocked class.
import publicRoutes from '../public';

const ORG_ID = '4d111111-1111-4111-8111-111111111111';
/** A BetterAuth user id: alphanumeric, never a uuid. */
const CREATOR_ID = 'creatorAda42';

const testEnv = { ...env, ENVIRONMENT: 'development' } as unknown as typeof env;

async function dispatch(query: string): Promise<Response> {
  const app = new Hono();
  app.route('/api/content/public', publicRoutes);
  const ec = createExecutionContext();
  const res = await app.fetch(
    new Request(`http://content-api.test/api/content/public/removed?${query}`),
    testEnv,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  contentSpies.removedPiece.mockResolvedValue({
    removed: true,
    leftWithNotice: true,
  });
});

describe('GET /api/content/public/removed', () => {
  it('answers the two booleans for an org key, and nothing of the piece', async () => {
    const res = await dispatch(`orgId=${ORG_ID}&slug=morning-flow`);

    expect(res.status).toBe(200);
    expect(contentSpies.removedPiece).toHaveBeenCalledWith({
      orgId: ORG_ID,
      slug: 'morning-flow',
    });
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(Object.keys(body.data).sort()).toEqual([
      'leftWithNotice',
      'removed',
    ]);
    expect(res.headers.get('Cache-Control')).toBe(CACHE_PRESETS.public);
  });

  it("takes a personal piece's creator key", async () => {
    const res = await dispatch(`creatorId=${CREATOR_ID}&slug=morning-flow`);

    expect(res.status).toBe(200);
    expect(contentSpies.removedPiece).toHaveBeenCalledWith({
      creatorId: CREATOR_ID,
      slug: 'morning-flow',
    });
  });

  it.each([
    ['both keys', `orgId=${ORG_ID}&creatorId=${CREATOR_ID}&slug=morning-flow`],
    ['neither key', 'slug=morning-flow'],
    ['no slug', `orgId=${ORG_ID}`],
  ])('refuses %s with a 400, and never reads', async (_name, query) => {
    const res = await dispatch(query);

    expect(res.status).toBe(400);
    expect(contentSpies.removedPiece).not.toHaveBeenCalled();
  });
});
