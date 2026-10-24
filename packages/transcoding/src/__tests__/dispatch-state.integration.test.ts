/**
 * The dispatch state machine against real Postgres (Codex-l2c48.4).
 *
 * The unit tests prove each write carries its guard; this proves the guards
 * HOLD: two concurrent claims dispatch once, attempts never pass the bound,
 * a stale webhook changes nothing, and every RunPod answer leaves the row in
 * the state the state machine promises.
 *
 * The local database is shared with other sessions, so this suite creates
 * its own user and media rows and deletes exactly those. It never calls
 * cleanupDatabase, which wipes every user. Skips without a database URL.
 */

import { MAX_TRANSCODING_ATTEMPTS, MEDIA_STATUS } from '@codex/constants';
import { mediaItems, users } from '@codex/database/schema';
import {
  createTestMediaItemInput,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  TranscodingService,
  type TranscodingServiceFullConfig,
} from '../services/transcoding-service';
import type { MediaStatus } from '../types';

// The URL, not DB_METHOD: vitest.setup.ts defaults DB_METHOD to LOCAL_PROXY,
// so it is always set. This package's suite needed no database before this
// file, and must stay green without one.
const HAS_DB =
  (process.env.DB_METHOD === 'LOCAL_PROXY' &&
    Boolean(process.env.DATABASE_URL_LOCAL_PROXY)) ||
  (process.env.DB_METHOD === 'NEON_BRANCH' &&
    Boolean(process.env.DATABASE_URL));
const HOUR = 60 * 60 * 1000;

describe.skipIf(!HAS_DB)('dispatch state machine (database)', () => {
  let db: ReturnType<typeof setupTestDatabase>;
  let service: TranscodingService;
  let creatorId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    [creatorId] = await seedTestUsers(db, 1);
    service = new TranscodingService({
      db,
      environment: 'test',
      runpodApiKey: 'test-key',
      runpodEndpointId: 'test-endpoint',
      webhookBaseUrl: 'https://media-api.test',
      runpodApiBaseUrl: 'https://runpod.test/v2',
    } as TranscodingServiceFullConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    // Only this suite's rows. media_items references users, so media first.
    await db.delete(mediaItems).where(eq(mediaItems.creatorId, creatorId));
    await db.delete(users).where(eq(users.id, creatorId));
    await teardownTestDatabase();
  });

  async function insertMedia(
    overrides: Parameters<typeof createTestMediaItemInput>[1] = {}
  ) {
    return takeFirst(
      await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(creatorId, {
            status: MEDIA_STATUS.UPLOADED,
            durationSeconds: 120,
            ...overrides,
          })
        )
        .returning(),
      'inserted media'
    );
  }

  async function read(id: string) {
    return takeFirst(
      await db.select().from(mediaItems).where(eq(mediaItems.id, id)),
      `media ${id}`
    );
  }

  function runpodAnswers(status: number, body: unknown) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        })
    );
  }

  describe('every RunPod answer, from a fresh upload', () => {
    it.each([
      [200, { id: 'job-accepted' }, 'transcoding', 1, null, 'job-accepted'],
      [
        409,
        { code: 'ENDPOINT_PAUSED' },
        'uploaded',
        0,
        'TRANSCODER_PAUSED',
        null,
      ],
      [429, {}, 'uploaded', 0, 'TRANSCODER_BUSY', null],
      [401, {}, 'uploaded', 0, 'TRANSCODER_MISCONFIGURED', null],
      [503, {}, 'uploaded', 0, 'TRANSCODER_UNAVAILABLE', null],
      [200, { status: 'IN_QUEUE' }, 'transcoding', 1, null, null],
    ])('a %i %j leaves status %s, attempts %i, code %s, job %s', async (httpStatus, body, status, attempts, code, jobId) => {
      const media = await insertMedia();
      runpodAnswers(httpStatus, body);

      const result = await service.triggerJobInternal(media.id, creatorId);
      expect(result.alreadyQueued).toBe(false);
      if (!result.alreadyQueued) await result.dispatchPromise;

      const row = await read(media.id);
      expect({
        status: row.status,
        attempts: row.transcodingAttempts,
        code: row.transcodingErrorCode,
        jobId: row.runpodJobId,
      }).toEqual({ status, attempts, code, jobId });
    });

    it('a timeout leaves the item transcoding with the attempt counted', async () => {
      const media = await insertMedia();
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new DOMException('The operation timed out.', 'TimeoutError')
      );

      const result = await service.triggerJobInternal(media.id, creatorId);
      if (!result.alreadyQueued) await result.dispatchPromise;

      const row = await read(media.id);
      expect(row.status).toBe('transcoding');
      expect(row.transcodingAttempts).toBe(1);
      expect(row.runpodJobId).toBeNull();
    });
  });

  describe('claims', () => {
    it('two concurrent claims dispatch once', async () => {
      const media = await insertMedia();

      const claims = await Promise.all([
        service.claimForDispatch(media.id, [MEDIA_STATUS.UPLOADED], creatorId),
        service.claimForDispatch(media.id, [MEDIA_STATUS.UPLOADED], creatorId),
        service.claimForDispatch(media.id, [MEDIA_STATUS.UPLOADED], creatorId),
      ]);

      expect(claims.filter(Boolean)).toHaveLength(1);
      expect((await read(media.id)).transcodingAttempts).toBe(1);
    });

    it(`never takes an item past ${MAX_TRANSCODING_ATTEMPTS} attempts`, async () => {
      const media = await insertMedia({
        transcodingAttempts: MAX_TRANSCODING_ATTEMPTS,
      });

      expect(
        await service.claimForDispatch(
          media.id,
          [MEDIA_STATUS.UPLOADED],
          creatorId
        )
      ).toBeNull();
      expect((await read(media.id)).status).toBe('uploaded');
    });

    it.each([
      'transcoding',
      'ready',
      'failed',
    ] as MediaStatus[])('the upload trigger answers alreadyQueued for an item that is %s', async (status) => {
      const media = await insertMedia({ status });
      vi.spyOn(globalThis, 'fetch');

      expect(await service.triggerJobInternal(media.id, creatorId)).toEqual({
        alreadyQueued: true,
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect((await read(media.id)).status).toBe(status);
    });

    it('the upload trigger refuses an item still uploading', async () => {
      const media = await insertMedia({ status: MEDIA_STATUS.UPLOADING });

      await expect(
        service.triggerJobInternal(media.id, creatorId)
      ).rejects.toMatchObject({
        context: expect.objectContaining({ code: 'INVALID_MEDIA_STATE' }),
      });
      expect((await read(media.id)).status).toBe('uploading');
    });

    it('a deleted item is never claimed', async () => {
      const media = await insertMedia({ deletedAt: new Date() });

      await expect(
        service.triggerJobInternal(media.id, creatorId)
      ).rejects.toMatchObject({
        context: expect.objectContaining({
          code: 'TRANSCODING_MEDIA_NOT_FOUND',
        }),
      });
    });

    it("never claims another creator's media, and answers as if it did not exist", async () => {
      const media = await insertMedia();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      await expect(
        service.triggerJobInternal(media.id, 'someoneElse0000000000000000000')
      ).rejects.toMatchObject({
        context: expect.objectContaining({
          code: 'TRANSCODING_MEDIA_NOT_FOUND',
        }),
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect((await read(media.id)).status).toBe('uploaded');
    });

    it('never claims an item stopped by its file, whatever the caller allows', async () => {
      const media = await insertMedia({
        status: MEDIA_STATUS.FAILED,
        transcodingAttempts: 1,
        transcodingErrorCode: 'CORRUPT_INPUT',
      });

      expect(
        await service.claimForDispatch(
          media.id,
          [MEDIA_STATUS.FAILED],
          creatorId
        )
      ).toBeNull();
      expect(await read(media.id)).toMatchObject({
        status: 'failed',
        transcodingAttempts: 1,
      });
    });
  });

  describe('retry and the 24 h clock', () => {
    it('a retry of an old failure restarts the clock, and a pause then waits', async () => {
      const longAgo = new Date(Date.now() - 48 * HOUR);
      const media = await insertMedia({
        status: MEDIA_STATUS.FAILED,
        transcodingAttempts: 1,
        transcodingErrorCode: 'INFRA_ERROR',
        createdAt: longAgo,
        uploadedAt: longAgo,
      });
      runpodAnswers(409, { code: 'ENDPOINT_PAUSED' });

      const { dispatchPromise } = await service.retryTranscoding(
        media.id,
        creatorId
      );
      await dispatchPromise;

      const row = await read(media.id);
      expect(row.status).toBe('uploaded');
      expect(row.transcodingErrorCode).toBe('TRANSCODER_PAUSED');
      // The refusal gave the retry's attempt back.
      expect(row.transcodingAttempts).toBe(1);
      expect(row.uploadedAt?.getTime()).toBeGreaterThan(Date.now() - HOUR);
    });

    it('a waiting item keeps its clock when it is dispatched again', async () => {
      const fiveHoursAgo = new Date(Date.now() - 5 * HOUR);
      const media = await insertMedia({
        transcodingErrorCode: 'TRANSCODER_PAUSED',
        uploadedAt: fiveHoursAgo,
      });
      runpodAnswers(409, { code: 'ENDPOINT_PAUSED' });

      const result = await service.triggerJobInternal(media.id, creatorId);
      if (!result.alreadyQueued) await result.dispatchPromise;

      expect((await read(media.id)).uploadedAt?.getTime()).toBe(
        fiveHoursAgo.getTime()
      );
    });

    it('refuses to retry a file the transcoder could not read', async () => {
      const media = await insertMedia({
        status: MEDIA_STATUS.FAILED,
        transcodingAttempts: 1,
        transcodingErrorCode: 'CORRUPT_INPUT',
      });

      await expect(
        service.retryTranscoding(media.id, creatorId)
      ).rejects.toMatchObject({
        context: expect.objectContaining({ code: 'TRANSCODING_NOT_RETRYABLE' }),
      });
      expect((await read(media.id)).status).toBe('failed');
    });
  });

  describe('webhooks', () => {
    const output = (mediaId: string) => ({
      mediaId,
      type: 'video' as const,
      hlsMasterKey: `${creatorId}/hls/${mediaId}/master.m3u8`,
      hlsPreviewKey: `${creatorId}/hls/${mediaId}/preview/preview.m3u8`,
      thumbnailKey: `media-thumbnails/${mediaId}/lg.webp`,
      durationSeconds: 120,
      width: 1920,
      height: 1080,
      readyVariants: ['1080p', '720p'] as ('1080p' | '720p')[],
    });

    it('ignores a completion from a job the row no longer holds', async () => {
      const media = await insertMedia({
        status: MEDIA_STATUS.TRANSCODING,
        transcodingAttempts: 2,
        runpodJobId: 'job-current',
      });

      await service.handleWebhook({
        jobId: 'job-stale',
        status: 'completed',
        output: output(media.id),
      });
      expect((await read(media.id)).status).toBe('transcoding');

      await service.handleWebhook({
        jobId: 'job-current',
        status: 'completed',
        output: output(media.id),
      });
      const row = await read(media.id);
      expect(row.status).toBe('ready');
      expect(row.transcodingErrorCode).toBeNull();
    });

    it("records a failed job's code without counting another attempt", async () => {
      const media = await insertMedia({
        status: MEDIA_STATUS.TRANSCODING,
        transcodingAttempts: 1,
        runpodJobId: 'job-1',
      });

      await service.handleWebhook({
        jobId: 'job-1',
        status: 'failed',
        error: 'moov atom not found',
        errorCode: 'CORRUPT_INPUT',
      });

      const row = await read(media.id);
      expect(row.status).toBe('failed');
      expect(row.transcodingErrorCode).toBe('CORRUPT_INPUT');
      expect(row.transcodingAttempts).toBe(1);
    });

    it('fails a rejected completion, but only for the held job', async () => {
      const media = await insertMedia({
        status: MEDIA_STATUS.TRANSCODING,
        transcodingAttempts: 1,
        runpodJobId: 'job-1',
      });

      expect(
        await service.rejectWebhookOutput(
          { jobId: 'job-0', mediaId: media.id },
          'rejected'
        )
      ).toBe(false);
      expect((await read(media.id)).status).toBe('transcoding');

      expect(
        await service.rejectWebhookOutput(
          { jobId: 'job-1', mediaId: media.id },
          'rejected'
        )
      ).toBe(true);
      expect((await read(media.id)).transcodingErrorCode).toBe(
        'OUTPUT_REJECTED'
      );
    });

    it('a refusal answered late never overwrites a completion that landed first', async () => {
      const media = await insertMedia();
      const claimed = await service.claimForDispatch(
        media.id,
        [MEDIA_STATUS.UPLOADED],
        creatorId
      );
      if (!claimed) throw new Error('claim failed');

      // The webhook wins the race: the job id was never stored.
      await service.handleWebhook({
        jobId: 'job-fast',
        status: 'completed',
        output: output(media.id),
      });
      runpodAnswers(503, {});
      await service.dispatch(claimed);

      expect((await read(media.id)).status).toBe('ready');
    });
  });
});
