/**
 * `POST /api/media/:id/upload-complete` records the CLIENT's runtime, and only
 * when it has none of its own.
 *
 * THE GAP THIS CLOSES. `media_items.duration_seconds` was written in exactly
 * one place — the RunPod completion webhook (TranscodingService). So the column
 * stayed NULL from the moment a creator finished uploading until transcoding
 * completed, minutes later on `/runsync`. The three journey sections that show
 * a runtime badge already fall back correctly (`p.duration ??
 * formatDuration(media.durationSeconds)`) and the editor field's hint already
 * promises it — "Leave blank to use the clip's real length" — so the fallback
 * was never the bug. There was simply nothing to fall back TO during the exact
 * window in which a creator builds the page.
 *
 * THE NULL GUARD. This route is DELIBERATELY IDEMPOTENT: it accepts
 * `UPLOADED` as well as `UPLOADING` so a failed transcoding dispatch can be
 * re-triggered. That means it can legitimately run again AFTER transcoding has
 * finished — at which point the stored duration is the transcoder's, measured
 * off the output that actually gets streamed, and the client's figure is the
 * weaker authority. The guard lives in the write itself
 * (`recordClientDuration`: `WHERE duration_seconds IS NULL`, Codex-l2c48.9), so
 * a retry racing the completion webhook cannot downgrade it either; the
 * service's own suite proves the guard against a real row.
 *
 * SHAPE. Real `procedure()`, real Hono routing, real Zod parsing of the body.
 * `MediaItemService` is the one stubbed seam (no Neon), which is what lets the
 * assertions be about the call arguments rather than about the database.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import type { MediaItemService } from '@codex/content';
import { workerFetch } from '@codex/security';
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

/**
 * The rest parameters are load-bearing, not decoration. `vi.fn(async () => …)`
 * infers a ZERO-LENGTH call tuple, so `update.mock.calls[0][2]` is
 * `TS2493: tuple type '[]' of length '0' has no element at index '2'` and the
 * creator-scope assertion below cannot be written at all. Deriving each tuple
 * from the real `MediaItemService` method — rather than hand-writing
 * `(_id: string, _input: unknown, _creatorId: string)` — also means a
 * signature change in the service breaks THIS FILE instead of quietly leaving
 * a stale stub passing.
 */
type Svc = MediaItemService;

const mediaSpies = {
  get: vi.fn(async (..._args: Parameters<Svc['get']>) => ({
    id: MEDIA_ID,
    ...stored,
  })),
  recordClientDuration: vi.fn(
    async (..._args: Parameters<Svc['recordClientDuration']>) => undefined
  ),
  markUploaded: vi.fn(
    async (..._args: Parameters<Svc['markUploaded']>) => undefined
  ),
  recordTranscodingTriggerFailure: vi.fn(
    async (..._args: Parameters<Svc['recordTranscodingTriggerFailure']>) =>
      undefined
  ),
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

async function post(body: unknown): Promise<Response> {
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

/** The duration handed to the write, or undefined if it was never called. */
const writtenDuration = (): number | undefined =>
  mediaSpies.recordClientDuration.mock.calls[0]?.[2];

describe('upload-complete records the client-measured duration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = { status: 'uploading', durationSeconds: null };
  });

  it('stores it when the column is empty', async () => {
    const res = await post({ durationSeconds: 137 });
    expect(res.status).toBe(200);
    expect(mediaSpies.recordClientDuration).toHaveBeenCalledTimes(1);
    expect(writtenDuration()).toBe(137);
    // Scoped by creator, like every other write in this worker.
    expect(mediaSpies.recordClientDuration.mock.calls[0]?.[1]).toBe(USER.id);
  });

  it('writes nothing when the client sends no measurement', async () => {
    // The measurement is allowed to fail — a codec the browser cannot parse, or
    // a metadata read that timed out. That must cost the creator nothing.
    const res = await post({});
    expect(res.status).toBe(200);
    expect(mediaSpies.recordClientDuration).not.toHaveBeenCalled();
  });

  it('leaves a stored duration to the guarded write, not a read here', async () => {
    // The idempotent retry: transcoding already finished and wrote the figure
    // measured off the streamed output. A check against the row read above
    // would race the completion webhook; the write's own WHERE cannot.
    stored = { status: 'uploaded', durationSeconds: 1800 };
    const res = await post({ durationSeconds: 137 });
    expect(res.status).toBe(200);
    expect(mediaSpies.recordClientDuration).toHaveBeenCalledWith(
      MEDIA_ID,
      USER.id,
      137
    );
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
      expect(
        mediaSpies.recordClientDuration,
        JSON.stringify(bad)
      ).not.toHaveBeenCalled();
    }
  });

  it('accepts a request with NO BODY AT ALL (Codex-bk37r)', async () => {
    // THE REGRESSION THIS FILE MISSED. `input: { body: uploadCompleteSchema }`
    // made a JSON body mandatory regardless of the schema, because
    // `c.req.json()` throws for an absent body exactly as for malformed JSON —
    // above Zod, so `.catch({})` never ran. This endpoint's prior contract took
    // no body, and it is idempotent by design so a failed transcode can be
    // re-triggered; a body-less retry 400'd. E2E API caught it, this suite did
    // not, because every case here sent a body.
    const app = new Hono<{ Variables: Record<string, unknown> }>();
    app.use('*', async (c, next) => {
      c.set('user', USER);
      c.set('session', { id: 'sess_test', userId: USER.id });
      await next();
    });
    app.route('/api/media', media);
    const res = await app.fetch(
      new Request(
        `http://content-api.test/api/media/${MEDIA_ID}/upload-complete`,
        { method: 'POST' } // no body, no Content-Type
      ),
      testEnv,
      createExecutionContext()
    );

    expect(res.status).toBe(200);
    // No measurement was sent, so nothing is written — but the upload still
    // completes, which is the whole point.
    expect(mediaSpies.recordClientDuration).not.toHaveBeenCalled();
    // markUploaded, not updateStatus: it also stamps uploaded_at, the
    // maintenance cron's 24 h clock.
    expect(mediaSpies.markUploaded).toHaveBeenCalledWith(MEDIA_ID, USER.id);
  });

  it('still advances the status — the duration is a side errand', async () => {
    await post({ durationSeconds: 137 });
    // markUploaded, not updateStatus: it also stamps uploaded_at, the
    // maintenance cron's 24 h clock.
    expect(mediaSpies.markUploaded).toHaveBeenCalledWith(MEDIA_ID, USER.id);
  });
});

describe('upload-complete records a failed trigger hop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = { status: 'uploading', durationSeconds: null };
  });

  /** POST, then wait for the background hop the route registered. */
  async function postAndSettle(): Promise<Response> {
    const app = new Hono<{ Variables: Record<string, unknown> }>();
    app.use('*', async (c, next) => {
      c.set('user', USER);
      c.set('session', { id: 'sess_test', userId: USER.id });
      await next();
    });
    app.route('/api/media', media);
    const executionCtx = createExecutionContext();
    const res = await app.fetch(
      new Request(
        `http://content-api.test/api/media/${MEDIA_ID}/upload-complete`,
        { method: 'POST' }
      ),
      testEnv,
      executionCtx
    );
    await waitOnExecutionContext(executionCtx);
    return res;
  }

  it('marks the item waiting on a 5xx, with the status and never the body', async () => {
    vi.mocked(workerFetch).mockResolvedValueOnce(
      new Response('{"error":{"message":"pool exhausted at 10.0.0.7"}}', {
        status: 503,
      })
    );

    expect((await postAndSettle()).status).toBe(200);
    expect(mediaSpies.recordTranscodingTriggerFailure).toHaveBeenCalledWith(
      MEDIA_ID,
      USER.id,
      'Transcoding dispatch returned 503'
    );
  });

  it("records nothing for media-api's answer about the item", async () => {
    vi.mocked(workerFetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'BUSINESS_LOGIC_ERROR',
            message: 'Maximum transcoding attempts exceeded',
            details: { code: 'MAX_RETRIES_EXCEEDED' },
          },
        }),
        { status: 422 }
      )
    );

    expect((await postAndSettle()).status).toBe(200);
    expect(mediaSpies.recordTranscodingTriggerFailure).not.toHaveBeenCalled();
  });

  it('marks the item waiting when worker auth refuses the hop', async () => {
    vi.mocked(workerFetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: 'UNAUTHORIZED', message: 'Invalid signature' },
        }),
        { status: 401 }
      )
    );

    expect((await postAndSettle()).status).toBe(200);
    expect(mediaSpies.recordTranscodingTriggerFailure).toHaveBeenCalledWith(
      MEDIA_ID,
      USER.id,
      'Transcoding dispatch returned 401'
    );
  });

  it('marks the item waiting when media-api cannot be reached', async () => {
    vi.mocked(workerFetch).mockRejectedValueOnce(
      new TypeError('Network connection lost')
    );

    expect((await postAndSettle()).status).toBe(200);
    expect(mediaSpies.recordTranscodingTriggerFailure).toHaveBeenCalledWith(
      MEDIA_ID,
      USER.id,
      'Transcoding dispatch could not reach the media service'
    );
  });
});
