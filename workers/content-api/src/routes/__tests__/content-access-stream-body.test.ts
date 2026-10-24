/**
 * `GET /api/access/content/:id/stream?include=body` returns the content's body
 * once access is granted, and only when asked (Codex-039vo).
 *
 * WHY. A gated piece's public row carries no body, and the detail pages used
 * to render that stripped row, so every entitled reader (a buyer, a
 * subscriber, a follower, the owner) got an empty page. The body now comes
 * from the access check: the service reads it from the row its access decision
 * loaded, after the decision granted. The player's URL refreshes call the same
 * route without the flag and must never carry a body.
 *
 * SHAPE. Real `procedure()` resolver and Hono routing; only
 * `ContentAccessService` is stubbed (no Neon), so the assertions are the option
 * the route hands the service and the fields it copies onto the response.
 */

import { createExecutionContext, env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER = {
  id: '7a1d0f2e-3b4c-4d5e-8f60-112233445566',
  email: 'reader@test.com',
  role: 'customer',
};

const CONTENT_ID = '2c000000-0000-4000-8000-000000000777';

const accessSpies = {
  getStreamingUrl: vi.fn(),
};

vi.mock('@codex/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/access')>();
  return {
    ...actual,
    ContentAccessService: vi.fn(() => accessSpies),
  };
});

// Below the mock on purpose: biome's organizeImports never moves an import
// across a statement, so this stays after `vi.mock` and the real service
// registry resolves the mocked class.
import contentAccess from '../content-access';

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
  app.route('/api/access', contentAccess);
  return app;
}

async function stream(query: string): Promise<Response> {
  return buildApp().fetch(
    new Request(
      `http://content-api.test/api/access/content/${CONTENT_ID}/stream${query}`
    ),
    testEnv,
    createExecutionContext()
  );
}

const granted = {
  streamingUrl: null,
  waveformUrl: null,
  expiresAt: new Date('2026-10-23T22:00:00.000Z'),
  contentType: 'written' as const,
};

describe('GET /api/access/content/:id/stream — the body only on request (Codex-039vo)', () => {
  beforeEach(() => {
    accessSpies.getStreamingUrl.mockReset();
  });

  it('include=body asks the service for the body and returns it', async () => {
    accessSpies.getStreamingUrl.mockResolvedValue({
      ...granted,
      body: { contentBody: null, contentBodyJson: { type: 'doc' } },
    });

    const res = await stream('?include=body');

    expect(res.status).toBe(200);
    const [userId, input, options] =
      accessSpies.getStreamingUrl.mock.calls[0] ?? [];
    expect(userId).toBe(USER.id);
    expect(input).toMatchObject({ contentId: CONTENT_ID });
    expect(options).toEqual({ includeBody: true });
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data.body).toEqual({
      contentBody: null,
      contentBodyJson: { type: 'doc' },
    });
    // A gated body (and the per-user HLS token) is never stored on any disk.
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('without the flag the service is not asked and the response has no body fields', async () => {
    accessSpies.getStreamingUrl.mockResolvedValue(granted);

    const res = await stream('');

    expect(res.status).toBe(200);
    expect(accessSpies.getStreamingUrl.mock.calls[0]?.[2]).toEqual({
      includeBody: false,
    });
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data).not.toHaveProperty('body');
  });

  it('an include value other than body is refused', async () => {
    const res = await stream('?include=everything');

    expect(res.status).toBe(400);
    expect(accessSpies.getStreamingUrl).not.toHaveBeenCalled();
  });
});
