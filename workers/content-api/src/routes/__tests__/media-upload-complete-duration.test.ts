/**
 * `POST /api/media/:id/upload-complete` records the CLIENT's runtime, and only
 * when it has none of its own.
 *
 * THE GAP THIS CLOSES. `media_items.duration_seconds` was written in exactly
 * one place — `MediaService.markAsReady`, from the RunPod webhook. So the column
 * stayed NULL from the moment a creator finished uploading until transcoding
 * completed, minutes later on `/runsync`. The three journey sections that show
 * a runtime badge already fall back correctly (`p.duration ??
 * formatDuration(media.durationSeconds)`) and the editor field's hint already
 * promises it — "Leave blank to use the clip's real length" — so the fallback
 * was never the bug. There was simply nothing to fall back TO during the exact
 * window in which a creator builds the page.
 *
 * WHY THE NULL GUARD IS THE POINT OF THIS FILE. This route is DELIBERATELY
 * IDEMPOTENT: it accepts `UPLOADED` as well as `UPLOADING` so a failed
 * transcoding dispatch can be re-triggered. That means it can legitimately run
 * again AFTER transcoding has finished — at which point the stored duration is
 * the transcoder's, measured off the output that actually gets streamed, and the
 * client's figure is the weaker authority. Without `media.durationSeconds ==
 * null` the retry silently downgrades a good value, and nothing would catch it:
 * both numbers are plausible, the response is identical, and the badge still
 * renders. So the third case here is the one that matters.
 *
 * SHAPE. Real `procedure()`, real Hono routing, real Zod parsing of the body.
 * `MediaItemService` is the one stubbed seam (no Neon), which is what lets the
 * assertions be about `update()` call arguments rather than about the database.
 */

import { createExecutionContext, env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER = {
  id: '7a1d0f2e-3b4c-4d5e-8f60-112233445566',
  email: 'creator@test.com',
  role: 'creator',
};
const MEDIA_ID = '4d000000-0000-4000-8000-000000000001';

/** What `media.get()` hands back — mutated per case. */
let stored: { status: string; durationSeconds: number | null } = {
  status: 'uploading',
  durationSeconds: null,
};

const mediaSpies = {
  get: vi.fn(async () => ({ id: MEDIA_ID, ...stored })),
  update: vi.fn(async () => ({ id: MEDIA_ID })),
  updateStatus: vi.fn(async () => ({ id: MEDIA_ID })),
  recordTranscodingTriggerFailure: vi.fn(async () => undefined),
  setCache: vi.fn(),
};

// The route dispatches transcoding through a real `workerFetch` inside
// `waitUntil`. Left unstubbed it attempts an actual DNS lookup of
// `media-api.test` and floods the run with workerd `DNS lookup failed` noise —
// harmless, since it is fire-and-forget, but it buries the assertions.
vi.mock('@codex/security', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/security')>();
  return {
    ...actual,
    workerFetch: vi.fn(async () => new Response('{}', { status: 200 })),
  };
});

vi.mock('@codex/content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/content')>();
  return {
    ...actual,
    MediaItemService: vi.fn(() => mediaSpies),
  };
});

// Below the mock on purpose — biome's organizeImports never moves an import
// across a statement, so the registry resolves the mocked class.
import media from '../media';

const testEnv = {
  ...env,
  ENVIRONMENT: 'development',
  // Absent MEDIA_API_URL would throw InternalServiceError before the assertions.
  MEDIA_API_URL: 'http://media-api.test',
  WORKER_SHARED_SECRET: 'test-secret',
} as unknown as typeof env;

function post(body: unknown): Promise<Response> {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('user', USER);
    c.set('session', { id: 'sess_test', userId: USER.id });
    await next();
  });
  app.route('/api/media', media);
  return app.fetch(
    new Request(
      `http://content-api.test/api/media/${MEDIA_ID}/upload-complete`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    ),
    testEnv,
    createExecutionContext()
  );
}

/** The `durationSeconds` passed to `update()`, or undefined if never called. */
const writtenDuration = (): number | undefined =>
  mediaSpies.update.mock.calls[0]?.[1]?.durationSeconds;

describe('upload-complete records the client-measured duration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = { status: 'uploading', durationSeconds: null };
  });

  it('stores it when the column is empty', async () => {
    const res = await post({ durationSeconds: 137 });
    expect(res.status).toBe(200);
    expect(mediaSpies.update).toHaveBeenCalledTimes(1);
    expect(writtenDuration()).toBe(137);
    // Scoped by creator, like every other write in this worker.
    expect(mediaSpies.update.mock.calls[0]?.[2]).toBe(USER.id);
  });

  it('writes nothing when the client sends no measurement', async () => {
    // The measurement is allowed to fail — a codec the browser cannot parse, or
    // a metadata read that timed out. That must cost the creator nothing.
    const res = await post({});
    expect(res.status).toBe(200);
    expect(mediaSpies.update).not.toHaveBeenCalled();
  });

  it('does NOT clobber a duration that is already stored', async () => {
    // The idempotent retry: transcoding already finished and wrote the figure
    // measured off the streamed output. The client's is the weaker authority.
    stored = { status: 'uploaded', durationSeconds: 1800 };
    const res = await post({ durationSeconds: 137 });
    expect(res.status).toBe(200);
    expect(mediaSpies.update).not.toHaveBeenCalled();
  });

  it('rejects a nonsense runtime by ignoring it, not by failing the upload', async () => {
    // `uploadCompleteSchema` is `.catch({})`: the bytes are already in R2, so a
    // hostile or malformed body must degrade to "no duration" and still return
    // 200. A 400 here would lose the creator's file.
    for (const bad of [
      { durationSeconds: 0 }, // a zero runtime would paint a `0:00` lie
      { durationSeconds: -5 },
      { durationSeconds: 999_999 }, // past the 24h cap
      { durationSeconds: 12.5 }, // the column is an integer
      { durationSeconds: 'twelve' },
      { durationSeconds: null },
    ]) {
      vi.clearAllMocks();
      stored = { status: 'uploading', durationSeconds: null };
      const res = await post(bad);
      expect(res.status, JSON.stringify(bad)).toBe(200);
      expect(mediaSpies.update, JSON.stringify(bad)).not.toHaveBeenCalled();
    }
  });

  it('still advances the status — the duration is a side errand', async () => {
    await post({ durationSeconds: 137 });
    expect(mediaSpies.updateStatus).toHaveBeenCalledWith(
      MEDIA_ID,
      'uploaded',
      USER.id
    );
  });
});
