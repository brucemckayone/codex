/**
 * GET /:id/portals answers the portals a piece is a practice in, asked as the
 * signed-in creator (Codex-a6ofh.2.5). The scoping itself is the service's,
 * tested on a real database (`content-portal-uses.integration.test.ts`); this
 * pins that the route hands it the caller and never a client-chosen id.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// This file's own subject. The limiter counts per subject across every file
// in this single-worker run, so a shared id runs past the api preset's 100
// a minute and later files read 429 (Codex-a6ofh.2).
const USER = {
  id: '7a1d0f2e-3b4c-4d5e-8f60-000000000006',
  email: 'creator@test.com',
  role: 'creator',
};
const CONTENT_ID = '2c000000-0000-4000-8000-000000003001';

const journeySpies = { getContentPortalUses: vi.fn() };

vi.mock('@codex/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/access')>();
  return { ...actual, CourseJourneyService: vi.fn(() => journeySpies) };
});

// Below the mock on purpose: the real service registry must resolve it.
import content from '../content';

const testEnv = { ...env, ENVIRONMENT: 'development' } as unknown as typeof env;

async function get(path: string): Promise<Response> {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('user', USER);
    c.set('session', { id: 'sess_test', userId: USER.id });
    await next();
  });
  app.route('/api/content', content);
  const ec = createExecutionContext();
  const res = await app.fetch(
    new Request(`http://content-api.test${path}`),
    testEnv,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

describe('GET /:id/portals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("answers the creator's own read of the piece's portals", async () => {
    const uses = [
      {
        courseId: '3c000000-0000-4000-8000-000000003001',
        pageId: '4c000000-0000-4000-8000-000000003001',
        title: 'Svelte Mastery',
        stageNumbers: [2],
      },
    ];
    journeySpies.getContentPortalUses.mockResolvedValue({ uses });

    const res = await get(`/api/content/${CONTENT_ID}/portals`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { uses } });
    expect(journeySpies.getContentPortalUses).toHaveBeenCalledWith(
      CONTENT_ID,
      USER.id
    );
  });

  it('refuses an id that is not one, before any read', async () => {
    const res = await get('/api/content/not-a-uuid/portals');

    expect(res.status).toBe(400);
    expect(journeySpies.getContentPortalUses).not.toHaveBeenCalled();
  });
});
