/**
 * The media delete guard's routes (Codex-6sbn1).
 *
 * - `GET /api/media/:id/usage` needs a session, answers the `{ data }`
 *   envelope, and asks the service for the CALLER's media only.
 * - `DELETE /api/media/:id?usage=` passes the fingerprint through, and its
 *   two refusals reach the client as 409s whose details are the two counts.
 *   (An org's intro video always counts as live, so the delete no longer
 *   drops any org's public cache, as it did for Codex-376dl.)
 *
 * Real `procedure()` and Hono routing; only `MediaItemService` is stubbed.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Its own user id: the limiter counts per user, and `singleWorker` shares one
// limiter across files.
const USER = {
  id: 'mediausageroutes01',
  email: 'creator@test.com',
  role: 'creator',
};

const MEDIA_ID = '4d000000-0000-4000-8000-0000000006b1';

const mediaSpies = { getUsage: vi.fn(), delete: vi.fn() };

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
import { MediaInUseError, MediaUsageChangedError } from '@codex/content';
import media from '../media';

const testEnv = {
  ...env,
  ENVIRONMENT: 'development',
} as unknown as typeof env;

async function call(
  method: 'GET' | 'DELETE',
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
  app.route('/api/media', media);
  const ec = createExecutionContext();
  const res = await app.fetch(
    new Request(`http://content-api.test/api/media${path}`, { method }),
    testEnv,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

describe('GET /api/media/:id/usage', () => {
  beforeEach(() => {
    mediaSpies.getUsage.mockReset();
  });

  it("answers the caller's usage in the { data } envelope", async () => {
    const usage = {
      total: 1,
      live: 0,
      drafts: 1,
      hidden: 0,
      uses: [],
      fingerprint: 'abc123',
    };
    mediaSpies.getUsage.mockResolvedValue(usage);

    const res = await call('GET', `/${MEDIA_ID}/usage`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: usage });
    expect(mediaSpies.getUsage).toHaveBeenCalledWith(MEDIA_ID, USER.id);
  });

  it('needs a session', async () => {
    const res = await call('GET', `/${MEDIA_ID}/usage`, { signedIn: false });
    expect(res.status).toBe(401);
    expect(mediaSpies.getUsage).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/media/:id?usage=', () => {
  beforeEach(() => {
    mediaSpies.delete.mockReset();
  });

  it('passes the fingerprint through and answers 204', async () => {
    mediaSpies.delete.mockResolvedValue({ drafts: 1 });

    const res = await call('DELETE', `/${MEDIA_ID}?usage=abc123`);

    expect(res.status).toBe(204);
    expect(mediaSpies.delete).toHaveBeenCalledWith(MEDIA_ID, USER.id, 'abc123');
  });

  it('deletes with no fingerprint (an unused item)', async () => {
    mediaSpies.delete.mockResolvedValue({ drafts: 0 });

    const res = await call('DELETE', `/${MEDIA_ID}`);

    expect(res.status).toBe(204);
    expect(mediaSpies.delete).toHaveBeenCalledWith(
      MEDIA_ID,
      USER.id,
      undefined
    );
  });

  it('refuses a malformed fingerprint before the service is asked', async () => {
    const res = await call(
      'DELETE',
      `/${MEDIA_ID}?usage=${encodeURIComponent('not a fingerprint!')}`
    );
    expect(res.status).toBe(400);
    expect(mediaSpies.delete).not.toHaveBeenCalled();
  });

  it.each([
    ['MEDIA_IN_USE', { live: 4, drafts: 1 }],
    ['MEDIA_USAGE_CHANGED', { live: 0, drafts: 2 }],
  ] as const)('answers %s as a 409 with the two counts only', async (code, details) => {
    mediaSpies.delete.mockRejectedValue(
      code === 'MEDIA_IN_USE'
        ? new MediaInUseError(details)
        : new MediaUsageChangedError(details)
    );

    const res = await call('DELETE', `/${MEDIA_ID}?usage=abc123`);

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; message: string; details: unknown };
    };
    expect(body.error.code).toBe(code);
    expect(body.error.details).toEqual(details);
  });
});
