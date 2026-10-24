/**
 * TranscodingService: the dispatch state machine (Codex-l2c48.4).
 *
 * A fake db records every write and renders its WHERE with drizzle's own
 * dialect, so these tests assert the GUARDS (the SQL that makes each write
 * conditional) and not just that a write happened. Whether the guards hold
 * under concurrency is a database question: see the DB-backed suite.
 */

import { TRANSCODING_ERROR_MAX_LENGTH } from '@codex/constants';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TranscodingService,
  type TranscodingServiceFullConfig,
} from '../services/transcoding-service';
import type { MediaStatus, MediaType, TranscodingMediaItem } from '../types';

const dialect = new PgDialect();
const render = (value: unknown) =>
  value && typeof value === 'object' && 'getSQL' in value
    ? dialect.sqlToQuery((value as { getSQL(): SQL }).getSQL()).sql
    : '';

interface Write {
  set: Record<string, unknown>;
  where: string;
  params: unknown[];
}

function makeDb() {
  const writes: Write[] = [];
  /** Rows each successive `.returning()` resolves to; default one row. */
  const returning: unknown[][] = [];
  const findFirst = vi.fn();
  const update = vi.fn(() => {
    const write: Write = { set: {}, where: '', params: [] };
    writes.push(write);
    const chain = {
      set(values: Record<string, unknown>) {
        write.set = values;
        return chain;
      },
      where(condition: SQL) {
        const query = dialect.sqlToQuery(condition);
        write.where = query.sql;
        write.params = query.params;
        // Awaitable as-is (progress updates) or via .returning().
        return Object.assign(Promise.resolve(undefined), {
          returning: async () => returning.shift() ?? [{ id: 'row' }],
        });
      },
    };
    return chain;
  });
  return {
    db: { query: { mediaItems: { findFirst } }, update },
    writes,
    returning,
    findFirst,
  };
}

const MEDIA_ID = '550e8400-e29b-41d4-a716-446655440000';
const CREATOR_ID = 'user_123';
const JOB_ID = 'runpod-job-123';

function media(
  overrides: Partial<TranscodingMediaItem> = {}
): TranscodingMediaItem {
  return {
    id: MEDIA_ID,
    creatorId: CREATOR_ID,
    mediaType: 'video' as MediaType,
    status: 'uploaded' as MediaStatus,
    r2Key: `${CREATOR_ID}/originals/${MEDIA_ID}/video.mov`,
    transcodingAttempts: 0,
    runpodJobId: null,
    transcodingError: null,
    transcodingErrorCode: null,
    transcodingPriority: 2,
    hlsMasterPlaylistKey: null,
    hlsPreviewKey: null,
    thumbnailKey: null,
    waveformKey: null,
    waveformImageKey: null,
    durationSeconds: 646,
    width: null,
    height: null,
    readyVariants: null,
    mezzanineKey: null,
    mezzanineStatus: null,
    transcodingProgress: null,
    transcodingStep: null,
    ...overrides,
  };
}

const config = (db: unknown): TranscodingServiceFullConfig =>
  ({
    db: db as TranscodingServiceFullConfig['db'],
    environment: 'test',
    runpodApiKey: 'mock-api-key',
    runpodEndpointId: 'mock-endpoint-id',
    webhookBaseUrl: 'https://api.example.com',
    runpodApiBaseUrl: 'https://api.mock',
  }) as TranscodingServiceFullConfig;

// spyOn, not `global.fetch = vi.fn()`: restoreAllMocks() undoes a spy only.
function runpodAnswers(status: number, body: unknown) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    })
  );
}

let fake: ReturnType<typeof makeDb>;
let service: TranscodingService;

beforeEach(() => {
  fake = makeDb();
  service = new TranscodingService(config(fake.db));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('claimForDispatch', () => {
  it('counts the attempt and clears the last run in the same statement', async () => {
    fake.returning.push([
      media({ status: 'transcoding', transcodingAttempts: 1 }),
    ]);

    const claimed = await service.claimForDispatch(
      MEDIA_ID,
      ['uploaded'],
      CREATOR_ID
    );

    expect(claimed?.status).toBe('transcoding');
    const [write] = fake.writes;
    expect(write?.set).toMatchObject({
      status: 'transcoding',
      transcodingError: null,
      transcodingErrorCode: null,
      runpodJobId: null,
      transcodingProgress: 0,
      transcodingStep: null,
    });
    expect(render(write?.set.transcodingAttempts)).toContain(
      '"transcoding_attempts" + 1'
    );
  });

  it("claims only the creator's undeleted row, from the allowed states, with attempts left", async () => {
    fake.returning.push([media()]);

    await service.claimForDispatch(
      MEDIA_ID,
      ['uploaded', 'failed'],
      CREATOR_ID
    );

    const where = fake.writes[0]?.where ?? '';
    expect(where).toContain('"media_items"."creator_id" = $2');
    expect(where).toContain('"media_items"."deleted_at" is null');
    expect(where).toContain('"media_items"."status" in ($3, $4)');
    expect(where).toContain('"media_items"."transcoding_attempts" < $5');
    expect(fake.writes[0]?.params.slice(0, 5)).toEqual([
      MEDIA_ID,
      CREATOR_ID,
      'uploaded',
      'failed',
      3,
    ]);
  });

  it('never claims a row stopped by its file: the WHERE is the whole guard', async () => {
    fake.returning.push([media()]);

    await service.claimForDispatch(MEDIA_ID, ['failed'], CREATOR_ID);

    const write = fake.writes[0];
    expect(write?.where).toMatch(
      /\("media_items"\."transcoding_error_code" is null or "media_items"\."transcoding_error_code" not in \(/
    );
    expect(write?.params).toEqual(
      expect.arrayContaining(['CORRUPT_INPUT', 'UPLOAD_INCOMPLETE'])
    );
    expect(write?.params).not.toContain('TIMED_OUT');
    expect(write?.params).not.toContain('TRANSCODER_PAUSED');
  });

  it('restarts the 24 h clock only for a resubmission from failed', async () => {
    fake.returning.push([media()]);

    await service.claimForDispatch(
      MEDIA_ID,
      ['uploaded', 'failed'],
      CREATOR_ID
    );

    expect(render(fake.writes[0]?.set.uploadedAt)).toMatch(
      /CASE WHEN "media_items"\."status" = \$\d+ THEN now\(\) ELSE "media_items"\."uploaded_at" END/
    );
  });

  it('returns null when nothing matched', async () => {
    fake.returning.push([]);

    expect(
      await service.claimForDispatch(MEDIA_ID, ['uploaded'], CREATOR_ID)
    ).toBeNull();
  });
});

describe('dispatch', () => {
  const claimed = media({ status: 'transcoding', transcodingAttempts: 1 });

  it('sends the job contract and a per-job policy sized from the duration', async () => {
    runpodAnswers(200, { id: JOB_ID, status: 'IN_QUEUE' });

    await service.dispatch(claimed);

    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.mock/mock-endpoint-id/run');
    const body = JSON.parse(init.body as string);
    expect(body.input).toMatchObject({
      mediaId: MEDIA_ID,
      inputKey: claimed.r2Key,
      contract: 2,
    });
    const executionTimeout = 15 * 60_000 + 5 * 646 * 1000;
    expect(body.policy).toEqual({
      executionTimeout,
      ttl: executionTimeout + 60 * 60_000,
    });
    // Storage credentials live in RunPod's secret manager, never the payload.
    expect(JSON.stringify(body)).not.toMatch(/accessKey|secret/i);
  });

  it('stores an accepted job id only while the claim still holds', async () => {
    runpodAnswers(200, { id: JOB_ID });

    const outcome = await service.dispatch(claimed);

    expect(outcome).toEqual({ kind: 'accepted', jobId: JOB_ID });
    const [write] = fake.writes;
    expect(write?.set).toMatchObject({ runpodJobId: JOB_ID });
    expect(write?.where).toContain('"media_items"."status" = $2');
    expect(write?.where).toContain('"media_items"."runpod_job_id" is null');
    expect(write?.params).toEqual([MEDIA_ID, 'transcoding']);
  });

  it('a paused endpoint leaves the item waiting and gives the attempt back', async () => {
    runpodAnswers(409, { code: 'ENDPOINT_PAUSED' });

    const outcome = await service.dispatch(claimed);

    expect(outcome).toMatchObject({
      kind: 'rejected',
      code: 'TRANSCODER_PAUSED',
    });
    const [write] = fake.writes;
    expect(write?.set).toMatchObject({
      status: 'uploaded',
      transcodingErrorCode: 'TRANSCODER_PAUSED',
      transcodingError: 'RunPod answered 409 (ENDPOINT_PAUSED)',
    });
    expect(render(write?.set.transcodingAttempts)).toContain(
      'GREATEST("media_items"."transcoding_attempts" - 1, 0)'
    );
    expect(write?.where).toContain('"media_items"."runpod_job_id" is null');
  });

  it.each([
    [429, {}, 'TRANSCODER_BUSY'],
    [401, {}, 'TRANSCODER_MISCONFIGURED'],
    [503, 'upstream down', 'TRANSCODER_UNAVAILABLE'],
  ])('a %i also leaves it waiting, as %s', async (status, body, code) => {
    runpodAnswers(status, body);

    await service.dispatch(claimed);

    expect(fake.writes[0]?.set).toMatchObject({
      status: 'uploaded',
      transcodingErrorCode: code,
    });
  });

  it('a timeout is ambiguous: the row stays transcoding, nothing is written', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new DOMException('The operation timed out.', 'TimeoutError')
    );

    const outcome = await service.dispatch(claimed);

    expect(outcome).toEqual({
      kind: 'ambiguous',
      detail: 'RunPod did not answer within 10 s',
    });
    expect(fake.writes).toHaveLength(0);
  });

  it('a network error is ambiguous too: RunPod may have the job', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('fetch failed')
    );

    expect((await service.dispatch(claimed)).kind).toBe('ambiguous');
    expect(fake.writes).toHaveLength(0);
  });

  it('never rejects, even when recording the outcome fails', async () => {
    runpodAnswers(200, { id: JOB_ID });
    fake.db.update.mockImplementationOnce(() => {
      throw new Error('connection terminated');
    });

    await expect(service.dispatch(claimed)).resolves.toEqual({
      kind: 'accepted',
      jobId: JOB_ID,
    });
  });
});

describe('retryTranscoding', () => {
  it('claims a failed item for its creator and hands back the dispatch', async () => {
    fake.findFirst.mockResolvedValue(
      media({
        status: 'failed',
        transcodingAttempts: 1,
        transcodingErrorCode: 'INFRA_ERROR',
      })
    );
    fake.returning.push([
      media({ status: 'transcoding', transcodingAttempts: 2 }),
    ]);
    runpodAnswers(200, { id: JOB_ID });

    const { dispatchPromise } = await service.retryTranscoding(
      MEDIA_ID,
      CREATOR_ID
    );

    expect(fake.writes[0]?.params).toEqual(
      expect.arrayContaining([MEDIA_ID, 'failed', 'uploaded', CREATOR_ID])
    );
    await expect(dispatchPromise).resolves.toMatchObject({ kind: 'accepted' });
  });

  it.each([
    'CORRUPT_INPUT',
    'UNSUPPORTED_CODEC',
    'INVALID_DURATION',
    'MISSING_STREAM',
  ])('refuses a %s failure: the creator re-uploads', async (code) => {
    fake.findFirst.mockResolvedValue(
      media({
        status: 'failed',
        transcodingAttempts: 1,
        transcodingErrorCode: code,
      })
    );

    await expect(
      service.retryTranscoding(MEDIA_ID, CREATOR_ID)
    ).rejects.toMatchObject({
      context: expect.objectContaining({ code: 'TRANSCODING_NOT_RETRYABLE' }),
    });
    expect(fake.writes).toHaveLength(0);
  });

  it('refuses once all 3 attempts are used', async () => {
    fake.findFirst.mockResolvedValue(
      media({
        status: 'failed',
        transcodingAttempts: 3,
        transcodingErrorCode: 'INFRA_ERROR',
      })
    );

    await expect(
      service.retryTranscoding(MEDIA_ID, CREATOR_ID)
    ).rejects.toMatchObject({
      context: expect.objectContaining({
        code: 'MAX_RETRIES_EXCEEDED',
        maxAttempts: 3,
      }),
    });
    expect(fake.writes).toHaveLength(0);
  });

  it.each([
    'transcoding',
    'ready',
    'uploading',
  ])('refuses an item that is %s', async (status) => {
    fake.findFirst.mockResolvedValue(media({ status: status as MediaStatus }));

    await expect(
      service.retryTranscoding(MEDIA_ID, CREATOR_ID)
    ).rejects.toMatchObject({
      context: expect.objectContaining({ code: 'INVALID_MEDIA_STATE' }),
    });
  });

  it('a waiting item may be retried; a pause just waits again', async () => {
    fake.findFirst.mockResolvedValue(
      media({ status: 'uploaded', transcodingErrorCode: 'TRANSCODER_PAUSED' })
    );
    fake.returning.push([
      media({ status: 'transcoding', transcodingAttempts: 1 }),
    ]);
    runpodAnswers(409, { code: 'ENDPOINT_PAUSED' });

    const { dispatchPromise } = await service.retryTranscoding(
      MEDIA_ID,
      CREATOR_ID
    );

    await expect(dispatchPromise).resolves.toMatchObject({
      code: 'TRANSCODER_PAUSED',
    });
    expect(fake.writes[1]?.set).toMatchObject({ status: 'uploaded' });
  });

  it('says what changed when the row moved between the read and the claim', async () => {
    fake.findFirst
      .mockResolvedValueOnce(
        media({ status: 'failed', transcodingErrorCode: 'INFRA_ERROR' })
      )
      .mockResolvedValueOnce(media({ status: 'transcoding' }));
    fake.returning.push([]);

    await expect(
      service.retryTranscoding(MEDIA_ID, CREATOR_ID)
    ).rejects.toMatchObject({
      context: expect.objectContaining({
        code: 'INVALID_MEDIA_STATE',
        currentStatus: 'transcoding',
      }),
    });
  });

  it('answers "not found" alike for media that is missing or another creator\'s', async () => {
    fake.findFirst.mockResolvedValue(undefined);

    await expect(
      service.retryTranscoding(MEDIA_ID, 'someone_else')
    ).rejects.toMatchObject({
      context: expect.objectContaining({ code: 'TRANSCODING_MEDIA_NOT_FOUND' }),
    });
    // One scoped read: no second, unscoped probe for whose media it is.
    expect(fake.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe('triggerJobInternal', () => {
  it('claims an uploaded item and hands back the dispatch', async () => {
    fake.returning.push([
      media({ status: 'transcoding', transcodingAttempts: 1 }),
    ]);
    runpodAnswers(200, { id: JOB_ID });

    const result = await service.triggerJobInternal(MEDIA_ID, CREATOR_ID, 1);

    expect(fake.writes[0]?.set).toMatchObject({ transcodingPriority: 1 });
    expect(result.alreadyQueued).toBe(false);
    if (result.alreadyQueued) return;
    await expect(result.dispatchPromise).resolves.toMatchObject({
      kind: 'accepted',
    });
  });

  it.each([
    'transcoding',
    'ready',
    'failed',
  ])('answers alreadyQueued for an item that is %s, and dispatches nothing', async (status) => {
    fake.returning.push([]);
    fake.findFirst.mockResolvedValue(media({ status: status as MediaStatus }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect(await service.triggerJobInternal(MEDIA_ID, CREATOR_ID)).toEqual({
      alreadyQueued: true,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses an item still uploading: not uploaded, so not queued', async () => {
    fake.returning.push([]);
    fake.findFirst.mockResolvedValue(media({ status: 'uploading' }));

    await expect(
      service.triggerJobInternal(MEDIA_ID, CREATOR_ID)
    ).rejects.toMatchObject({
      context: expect.objectContaining({ code: 'INVALID_MEDIA_STATE' }),
    });
  });

  it('throws not-found for media that does not exist', async () => {
    fake.returning.push([]);
    fake.findFirst.mockResolvedValue(undefined);

    await expect(
      service.triggerJobInternal(MEDIA_ID, CREATOR_ID)
    ).rejects.toMatchObject({
      context: expect.objectContaining({ code: 'TRANSCODING_MEDIA_NOT_FOUND' }),
    });
  });
});

describe('handleWebhook', () => {
  const completed = {
    jobId: JOB_ID,
    status: 'completed' as const,
    output: {
      mediaId: MEDIA_ID,
      type: 'video' as const,
      hlsMasterKey: 'path/to/master.m3u8',
      hlsPreviewKey: 'path/to/preview.m3u8',
      thumbnailKey: 'path/to/thumb.jpg',
      durationSeconds: 120,
      width: 1920,
      height: 1080,
      readyVariants: ['1080p', '720p'] as ('1080p' | '720p')[],
    },
  };

  beforeEach(() => {
    fake.findFirst.mockResolvedValue(
      media({ status: 'transcoding', runpodJobId: JOB_ID })
    );
  });

  it('marks the item ready and clears both error fields, for the held job only', async () => {
    await service.handleWebhook(completed);

    const [write] = fake.writes;
    expect(write?.set).toMatchObject({
      status: 'ready',
      hlsMasterPlaylistKey: 'path/to/master.m3u8',
      transcodingError: null,
      transcodingErrorCode: null,
    });
    expect(write?.where).toContain(
      '("media_items"."runpod_job_id" is null or "media_items"."runpod_job_id" = $3)'
    );
    expect(write?.params).toEqual([MEDIA_ID, 'transcoding', JOB_ID]);
  });

  it('never counts an attempt: the claim already did', async () => {
    await service.handleWebhook({
      jobId: JOB_ID,
      status: 'failed',
      error: 'x',
    });

    expect(fake.writes[0]?.set).not.toHaveProperty('transcodingAttempts');
  });

  it("records a failed job's own code, for the held job only", async () => {
    await service.handleWebhook({
      jobId: JOB_ID,
      status: 'failed',
      error: 'moov atom not found',
      errorCode: 'CORRUPT_INPUT',
    });

    const [write] = fake.writes;
    expect(write?.set).toMatchObject({
      status: 'failed',
      transcodingErrorCode: 'CORRUPT_INPUT',
      transcodingError: 'moov atom not found',
    });
    expect(write?.where).toContain(
      '("media_items"."runpod_job_id" is null or "media_items"."runpod_job_id" = $3)'
    );
    expect(write?.params).toEqual([MEDIA_ID, 'transcoding', JOB_ID]);
  });

  it('cuts the detail to the column at the write', async () => {
    await service.handleWebhook({
      jobId: JOB_ID,
      status: 'failed',
      error: 'x'.repeat(TRANSCODING_ERROR_MAX_LENGTH),
      errorCode: 'GPU_ON_FIRE',
    });

    const written = fake.writes[0]?.set.transcodingError;
    expect(String(written)).toHaveLength(TRANSCODING_ERROR_MAX_LENGTH);
    expect(String(written).startsWith('[raw:GPU_ON_FIRE] x')).toBe(true);
  });

  it('keeps an unrecognised code visible in the detail', async () => {
    await service.handleWebhook({
      jobId: JOB_ID,
      status: 'failed',
      error: 'boom',
      errorCode: 'GPU_ON_FIRE',
    });

    expect(fake.writes[0]?.set).toMatchObject({
      transcodingErrorCode: 'INFRA_ERROR',
      transcodingError: '[raw:GPU_ON_FIRE] boom',
    });
  });

  it('fails a completion with no playable variants as OUTPUT_REJECTED', async () => {
    await service.handleWebhook({
      ...completed,
      output: { ...completed.output, readyVariants: [] },
    });

    expect(fake.writes[0]?.set).toMatchObject({
      status: 'failed',
      transcodingErrorCode: 'OUTPUT_REJECTED',
    });
  });

  it('a stale job changes nothing and does not throw', async () => {
    fake.returning.push([]);

    await expect(service.handleWebhook(completed)).resolves.toBeUndefined();
  });

  it('throws for a job that matches no media', async () => {
    fake.findFirst.mockResolvedValue(undefined);

    await expect(service.handleWebhook(completed)).rejects.toMatchObject({
      context: expect.objectContaining({ jobId: JOB_ID }),
    });
  });
});

describe('handleProgressWebhook', () => {
  it('updates progress only for the job the row holds', async () => {
    await service.handleProgressWebhook({
      jobId: JOB_ID,
      status: 'progress',
      progress: 40,
      step: 'encoding_variants',
      mediaId: MEDIA_ID,
    });

    expect(fake.writes[0]?.set).toMatchObject({ transcodingProgress: 40 });
    expect(fake.writes[0]?.where).toContain(
      '"media_items"."runpod_job_id" is null or'
    );
    expect(fake.writes[0]?.where).toContain('"media_items"."status" = ');
  });
});

describe('rejectWebhookOutput', () => {
  it('fails the transcoding row that holds the job', async () => {
    const failed = await service.rejectWebhookOutput(
      { jobId: JOB_ID, mediaId: MEDIA_ID },
      'rejected'
    );

    expect(failed).toBe(true);
    const [write] = fake.writes;
    expect(write?.set).toMatchObject({
      status: 'failed',
      transcodingErrorCode: 'OUTPUT_REJECTED',
    });
    expect(write?.where).toContain('"media_items"."status" = ');
    expect(write?.where).toContain('"media_items"."runpod_job_id" is null or');
  });

  it('without a job id, fails only a row that holds no job', async () => {
    await service.rejectWebhookOutput(
      { jobId: null, mediaId: MEDIA_ID },
      'rejected'
    );

    const where = fake.writes[0]?.where ?? '';
    expect(where).toContain('"media_items"."id" = $1');
    expect(where).toContain('"media_items"."runpod_job_id" is null');
    expect(where).not.toContain(' or ');
  });

  it('with no ids at all, writes nothing: an empty match must never widen', async () => {
    expect(
      await service.rejectWebhookOutput(
        { jobId: null, mediaId: null },
        'rejected'
      )
    ).toBe(false);
    expect(fake.writes).toHaveLength(0);
  });
});

describe('recoverStuckTranscoding', () => {
  it('fails stuck rows with a code, so NULL keeps meaning "nothing went wrong"', async () => {
    fake.returning.push([]);

    await service.recoverStuckTranscoding(120);

    expect(fake.writes[0]?.set).toMatchObject({
      status: 'failed',
      transcodingErrorCode: 'TIMED_OUT',
    });
  });
});

describe('getTranscodingStatus', () => {
  it('returns the stored error code of a waiting item', async () => {
    fake.findFirst.mockResolvedValue(
      media({
        transcodingError: 'RunPod answered 409',
        transcodingErrorCode: 'TRANSCODER_PAUSED',
      })
    );

    const status = await service.getTranscodingStatus(MEDIA_ID, CREATOR_ID);

    expect(status.transcodingErrorCode).toBe('TRANSCODER_PAUSED');
    // A mock returns whatever it is given, so the select is asserted too:
    // without the column there, production reads undefined.
    expect(fake.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: expect.objectContaining({ transcodingErrorCode: true }),
      })
    );
  });
});
