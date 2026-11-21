/**
 * `DELETE /api/content/:id` and `POST /api/content/:id/keep` (Codex-a6ofh.6):
 * a delete of a piece people hold leaves it on a date, and Keep cancels it.
 *
 * SHAPE. Real `procedure()` resolver and Hono routing; only `ContentService`,
 * the cache work and the cover cleanup are stubbed (no Neon, no KV), so the
 * assertions are what the service receives, the envelope, and which cache
 * and file work follows. The writes themselves are tested against a database
 * in @codex/content's content-leaving.test.ts.
 */

import { createExecutionContext, env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// This file's own subject: the limiter counts per subject across every file
// in this single-worker run (Codex-a6ofh.2).
const USER = {
  id: '7a1d0f2e-3b4c-4d5e-8f60-000000000036',
  email: 'creator@test.com',
  role: 'creator',
};

const PIECE = '3c222222-2222-4222-8222-2222222220a1';
const ORG_ID = '3c222222-2222-4222-8222-222222222999';
const LEAVES_AT = new Date('2031-03-31T12:00:00.000Z');

const contentSpies = {
  delete: vi.fn(),
  keep: vi.fn(),
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
const fanContentInvalidation = vi.hoisted(() => vi.fn());
vi.mock('../content-invalidation', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../content-invalidation')>();
  return { ...actual, bumpOrgContentVersion, fanContentInvalidation };
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
import {
  ContentLeavingTooSoonError,
  ContentNotFoundError,
  LeaveNotYoursError,
} from '@codex/content';
import content from '../content';

const testEnv = {
  ...env,
  ENVIRONMENT: 'development',
} as unknown as typeof env;

async function call(
  method: 'DELETE' | 'POST',
  path: string,
  { signedIn = true } = {}
): Promise<Response> {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    if (signedIn) {
      c.set('user', USER);
      c.set('session', { id: 'sess_test', userId: USER.id });
    }
    await next();
  });
  app.route('/api/content', content);
  return await app.fetch(
    new Request(`http://content-api.test/api/content${path}`, { method }),
    testEnv,
    createExecutionContext()
  );
}

// Each spy is read by the one argument that matters: a failed assertion
// prints what it got, and the other arguments (the service registry, the
// worker env) are big enough to run workerd out of memory.

/** The reason each library refresh was given. */
const reasons = () =>
  fanContentInvalidation.mock.calls.map((args) => args[4] as string);

/** The org each org refresh was for. */
const orgsBumped = () =>
  bumpOrgContentVersion.mock.calls.map((args) => args[2] as string);

/** The piece each cover cleanup was for. */
const coversCleared = () =>
  cleanupContentThumbnailOnDelete.mock.calls.map((args) => args[1]);

describe('the leaving notice routes', () => {
  beforeEach(() => {
    for (const spy of Object.values(contentSpies)) spy.mockReset();
    bumpOrgContentVersion.mockReset();
    fanContentInvalidation.mockReset();
    cleanupContentThumbnailOnDelete.mockClear();
  });

  describe('DELETE /api/content/:id', () => {
    it('answers a held piece with its date and holders, and keeps its cover', async () => {
      contentSpies.delete.mockResolvedValue({
        organizationId: ORG_ID,
        result: {
          outcome: 'leaving',
          leavesAt: LEAVES_AT,
          holders: 2,
          started: true,
          leavingByCreator: true,
          leavingByOrg: false,
        },
      });

      const res = await call('DELETE', `/${PIECE}`);

      expect(res.status).toBe(200);
      expect(contentSpies.delete).toHaveBeenCalledWith(PIECE, USER.id);
      expect(await res.json()).toEqual({
        data: {
          outcome: 'leaving',
          leavesAt: LEAVES_AT.toISOString(),
          holders: 2,
          started: true,
          leavingByCreator: true,
          leavingByOrg: false,
        },
      });
      expect(coversCleared()).toEqual([]);
      expect(orgsBumped()).toEqual([ORG_ID]);
      expect(reasons()).toEqual(['content_leaving']);
    });

    // A delete that only added its side to a leave under way (design §4):
    // the screen words it as such, since nobody was emailed.
    it('says when a delete only added its side, starting no round', async () => {
      contentSpies.delete.mockResolvedValue({
        organizationId: ORG_ID,
        result: {
          outcome: 'leaving',
          leavesAt: LEAVES_AT,
          holders: 2,
          started: false,
          leavingByCreator: true,
          leavingByOrg: true,
        },
      });

      const res = await call('DELETE', `/${PIECE}`);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        data: {
          outcome: 'leaving',
          leavesAt: LEAVES_AT.toISOString(),
          holders: 2,
          started: false,
          leavingByCreator: true,
          leavingByOrg: true,
        },
      });
    });

    it('clears the cover of a piece deleted at once', async () => {
      contentSpies.delete.mockResolvedValue({
        organizationId: ORG_ID,
        result: { outcome: 'deleted', leavesAt: null, holders: 0 },
      });

      const res = await call('DELETE', `/${PIECE}`);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        data: { outcome: 'deleted', leavesAt: null, holders: 0 },
      });
      expect(coversCleared()).toEqual([PIECE]);
      expect(reasons()).toEqual(['content_deleted']);
    });

    it('answers a delete inside the gap 409, saying when it may, and refreshes nothing', async () => {
      const retryAt = new Date('2031-03-02T12:00:00.000Z');
      contentSpies.delete.mockRejectedValue(
        new ContentLeavingTooSoonError(PIECE, retryAt)
      );

      const res = await call('DELETE', `/${PIECE}`);

      expect(res.status).toBe(409);
      const body = (await res.json()) as {
        error: { details?: Record<string, unknown> };
      };
      expect(body.error.details).toMatchObject({
        code: 'CONTENT_LEAVING_TOO_SOON',
        retryAt: retryAt.toISOString(),
      });
      expect(reasons()).toEqual([]);
      expect(coversCleared()).toEqual([]);
    });
  });

  describe('POST /api/content/:id/keep', () => {
    it('keeps the creator’s piece and refreshes its org and its people', async () => {
      const kept = { kept: true, staying: 3, stillLeavingBy: null };
      contentSpies.keep.mockResolvedValue({
        organizationId: ORG_ID,
        result: kept,
      });

      const res = await call('POST', `/${PIECE}/keep`);

      expect(res.status).toBe(200);
      expect(contentSpies.keep).toHaveBeenCalledWith(PIECE, USER.id);
      expect(await res.json()).toEqual({ data: kept });
      expect(orgsBumped()).toEqual([ORG_ID]);
      expect(reasons()).toEqual(['content_kept']);
    });

    it('refreshes nothing for a piece that was not leaving', async () => {
      contentSpies.keep.mockResolvedValue({
        organizationId: ORG_ID,
        result: { kept: false, staying: 0, stillLeavingBy: null },
      });

      const res = await call('POST', `/${PIECE}/keep`);

      expect(res.status).toBe(200);
      expect(orgsBumped()).toEqual([]);
      expect(reasons()).toEqual([]);
    });

    it('answers a withdrawal as it is and refreshes nothing: it still leaves', async () => {
      const withdrawn = { kept: false, staying: 0, stillLeavingBy: 'org' };
      contentSpies.keep.mockResolvedValue({
        organizationId: ORG_ID,
        result: withdrawn,
      });

      const res = await call('POST', `/${PIECE}/keep`);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: withdrawn });
      expect(orgsBumped()).toEqual([]);
      expect(reasons()).toEqual([]);
    });

    it('answers 404 for a piece that is not the creator’s', async () => {
      contentSpies.keep.mockRejectedValue(new ContentNotFoundError(PIECE));

      const res = await call('POST', `/${PIECE}/keep`);

      expect(res.status).toBe(404);
      expect(reasons()).toEqual([]);
    });

    it('answers 403 for a leave an org admin’s delete started', async () => {
      contentSpies.keep.mockRejectedValue(new LeaveNotYoursError(PIECE, 'org'));

      const res = await call('POST', `/${PIECE}/keep`);

      expect(res.status).toBe(403);
      const body = (await res.json()) as {
        error: { details?: Record<string, unknown> };
      };
      expect(body.error.details).toMatchObject({
        code: 'CONTENT_LEAVE_NOT_YOURS',
        startedBy: 'org',
      });
      expect(reasons()).toEqual([]);
    });

    it('refuses a caller who is not signed in, without asking the service', async () => {
      const res = await call('POST', `/${PIECE}/keep`, { signedIn: false });

      expect(res.status).toBe(401);
      expect(contentSpies.keep.mock.calls).toEqual([]);
    });
  });
});
