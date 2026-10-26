/**
 * TranscodingService: the dispatch state machine (Codex-l2c48.4).
 *
 * A fake db records every write and renders its WHERE with drizzle's own
 * dialect, so these tests assert the GUARDS (the SQL that makes each write
 * conditional) and not just that a write happened. Whether the guards hold
 * under concurrency is a database question: see the DB-backed suite.
 */

import { TRANSCODING_ERROR_MAX_LENGTH } from '@codex/constants';
import type { MediaProgressTick, MediaStatusChange } from '@codex/validation';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaStatusFeed } from '../media-status';
import type { EndpointWorkersResult, RunPodApi } from '../runpod-api';
import type { TranscodingAlerts } from '../services/transcoding-alerts';
import {
  MAINTENANCE_SCOPE,
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

/** A status feed that records what the service told it. */
function recordingFeed() {
  const changes: MediaStatusChange[] = [];
  const ticks: { tick: MediaProgressTick; creatorId: string | null }[] = [];
  const feed: MediaStatusFeed = {
    changed: (change) => {
      changes.push(change);
    },
    removed: vi.fn(),
    progress: async (progressTick, creatorId) => {
      ticks.push({ tick: progressTick, creatorId });
    },
    resync: vi.fn(async () => {}),
  };
  return { feed, changes, ticks };
}

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

    const claimed = await service.claimForDispatch(MEDIA_ID, ['uploaded'], {
      creatorId: CREATOR_ID,
    });

    expect(claimed?.status).toBe('transcoding');
    const [write] = fake.writes;
    expect(write?.set).toMatchObject({
      status: 'transcoding',
      transcodingError: null,
      transcodingErrorCode: null,
      runpodJobId: null,
    });
    // Progress lives in the status object now (Codex-l2c48.9); the old
    // columns are cleared so the polling endpoint shows no stale %.
    expect(write?.set).toMatchObject({
      transcodingProgress: null,
      transcodingStep: null,
    });
    expect(render(write?.set.transcodingAttempts)).toContain(
      '"transcoding_attempts" + 1'
    );
  });

  it('publishes the claimed row, and nothing when the claim lost', async () => {
    const { feed, changes } = recordingFeed();
    const publishing = new TranscodingService({
      ...config(fake.db),
      mediaStatus: feed,
    });
    fake.returning.push(
      [
        {
          ...media({ status: 'transcoding', transcodingAttempts: 1 }),
          updatedAt: new Date(),
        },
      ],
      []
    );

    await publishing.claimForDispatch(MEDIA_ID, ['uploaded'], {
      creatorId: CREATOR_ID,
    });
    await publishing.claimForDispatch(MEDIA_ID, ['uploaded'], {
      creatorId: CREATOR_ID,
    });

    expect(changes).toEqual([
      expect.objectContaining({
        mediaId: MEDIA_ID,
        creatorId: CREATOR_ID,
        lifecycle: 'transcoding',
        attempts: 1,
      }),
    ]);
  });

  it("claims only the creator's undeleted row, from the allowed states, with attempts left", async () => {
    fake.returning.push([media()]);

    await service.claimForDispatch(MEDIA_ID, ['uploaded', 'failed'], {
      creatorId: CREATOR_ID,
    });

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

    await service.claimForDispatch(MEDIA_ID, ['failed'], {
      creatorId: CREATOR_ID,
    });

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

    await service.claimForDispatch(MEDIA_ID, ['uploaded', 'failed'], {
      creatorId: CREATOR_ID,
    });

    expect(render(fake.writes[0]?.set.uploadedAt)).toMatch(
      /CASE WHEN "media_items"\."status" = \$\d+ THEN now\(\) ELSE "media_items"\."uploaded_at" END/
    );
  });

  it('returns null when nothing matched', async () => {
    fake.returning.push([]);

    expect(
      await service.claimForDispatch(MEDIA_ID, ['uploaded'], {
        creatorId: CREATOR_ID,
      })
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

describe('publish', () => {
  it('never fails the write it reports', () => {
    const throwing: MediaStatusFeed = {
      ...recordingFeed().feed,
      changed: () => {
        throw new Error('publisher bug');
      },
    };
    const publishing = new TranscodingService({
      ...config(fake.db),
      mediaStatus: throwing,
    });
    const claimed = { ...media(), updatedAt: new Date() };
    expect(() =>
      publishing.publish(claimed as Parameters<typeof publishing.publish>[0])
    ).not.toThrow();
  });
});

describe('handleProgressWebhook', () => {
  const tick = {
    jobId: JOB_ID,
    status: 'progress' as const,
    progress: 40,
    step: 'encoding_variants' as const,
    mediaId: MEDIA_ID,
  };

  // Progress lives only in the status object (Codex-l2c48.9): ~9 Neon
  // writes a job, gone, and the object drops a stale job's tick itself.
  it('sends the tick to the status object and touches no database', async () => {
    const { feed, ticks } = recordingFeed();
    const publishing = new TranscodingService({
      ...config(fake.db),
      mediaStatus: feed,
    });

    await publishing.handleProgressWebhook({ ...tick, creatorId: CREATOR_ID });

    expect(ticks).toEqual([
      {
        tick: {
          mediaId: MEDIA_ID,
          jobId: JOB_ID,
          step: 'encoding_variants',
          progress: 40,
        },
        creatorId: CREATOR_ID,
      },
    ]);
    expect(fake.writes).toHaveLength(0);
    expect(fake.findFirst).not.toHaveBeenCalled();
  });

  it("routes an older handler's tick, which names no creator", async () => {
    const { feed, ticks } = recordingFeed();
    const publishing = new TranscodingService({
      ...config(fake.db),
      mediaStatus: feed,
    });

    await publishing.handleProgressWebhook(tick);

    expect(ticks[0]?.creatorId).toBeNull();
  });

  it('drops a tick that names no item', async () => {
    const { feed, ticks } = recordingFeed();
    const publishing = new TranscodingService({
      ...config(fake.db),
      mediaStatus: feed,
    });

    await publishing.handleProgressWebhook({ ...tick, mediaId: undefined });

    expect(ticks).toHaveLength(0);
    expect(fake.writes).toHaveLength(0);
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

describe('claimForDispatch for the maintenance run', () => {
  it('claims across creators with the package-private scope, never a deleted row', async () => {
    fake.returning.push([media()]);

    await service.claimForDispatch(MEDIA_ID, ['uploaded'], MAINTENANCE_SCOPE);

    const where = fake.writes[0]?.where ?? '';
    expect(where).toContain('"media_items"."deleted_at" is null');
    expect(where).not.toContain('creator_id');
  });

  // Fails closed: only the exact object sweeps across creators.
  it.each([
    ['a look-alike of the maintenance scope', { trusted: 'maintenance' }],
    ['an empty creator', { creatorId: '' }],
    ['no creator at all', {}],
  ])('refuses %s, writing nothing', async (_case, scope) => {
    await expect(
      service.claimForDispatch(MEDIA_ID, ['uploaded'], scope as never)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fake.writes).toHaveLength(0);
  });
});

/**
 * A spy on every service's logger at `level`. ObservabilityClient is reached
 * through an instance: this package does not depend on @codex/observability.
 */
function logSpy(level: 'error' | 'warn') {
  const prototype = Object.getPrototypeOf(
    (service as unknown as { obs: object }).obs
  ) as Record<typeof level, (...args: unknown[]) => void>;
  return vi.spyOn(prototype, level);
}

/** A RunPodApi stub: only the calls ensureEndpointAwake makes. */
function stubApi(
  workers: EndpointWorkersResult,
  raised: EndpointWorkersResult = { ok: true, max: 5 }
) {
  return {
    endpointWorkers: vi.fn(async () => workers),
    setWorkersMax: vi.fn(async () => raised),
  };
}

function serviceWith(api: ReturnType<typeof stubApi>) {
  return new TranscodingService({
    ...config(fake.db),
    runpodWorkersMax: 5,
    runpodApi: api as unknown as RunPodApi,
  });
}

describe('ensureEndpointAwake', () => {
  const deadline = () => Date.now() + 20_000;

  // At 0, a paused endpoint (max 0) would read as awake for ever.
  it.each([
    0,
    1.5,
    101,
    Number.NaN,
  ])('falls back to 5 workers from a max of %s, at error', async (max) => {
    const error = logSpy('error');
    const api = stubApi({ ok: true, max: 0 });

    const svc = new TranscodingService({
      ...config(fake.db),
      runpodWorkersMax: max,
      runpodApi: api as unknown as RunPodApi,
    });
    await svc.ensureEndpointAwake(deadline());

    expect(error).toHaveBeenCalledWith(
      'transcoding.workers_max_invalid',
      expect.objectContaining({ using: 5 })
    );
    expect(api.setWorkersMax).toHaveBeenCalledWith(5, expect.any(Number));
  });

  it('leaves an endpoint at its max workers alone: one read, no write', async () => {
    const api = stubApi({ ok: true, max: 5 });

    expect(await serviceWith(api).ensureEndpointAwake(deadline())).toEqual({
      kind: 'awake',
      max: 5,
    });
    expect(api.setWorkersMax).not.toHaveBeenCalled();
  });

  it.each([
    [0, 'paused after 7 idle days'],
    [2, 'scaled down after 3 idle days'],
  ])('raises an endpoint at %i (%s) back to the configured max', async (max) => {
    const api = stubApi({ ok: true, max });

    expect(await serviceWith(api).ensureEndpointAwake(deadline())).toEqual({
      kind: 'raised',
      from: max,
      to: 5,
    });
    expect(api.setWorkersMax).toHaveBeenCalledWith(5, expect.any(Number));
  });

  it('reports a key that may not change the endpoint', async () => {
    const api = stubApi(
      { ok: true, max: 0 },
      { ok: false, reason: 'not_permitted', status: 403 }
    );

    expect(await serviceWith(api).ensureEndpointAwake(deadline())).toEqual({
      kind: 'not_raised',
      from: 0,
      reason: 'not_permitted',
    });
  });

  it('writes nothing when the endpoint cannot be read', async () => {
    const api = stubApi({ ok: false, reason: 'unavailable', status: 502 });

    expect(await serviceWith(api).ensureEndpointAwake(deadline())).toEqual({
      kind: 'unknown',
      reason: 'unavailable',
    });
    expect(api.setWorkersMax).not.toHaveBeenCalled();
  });

  // Auto-unpause cannot work in any of these until someone fixes the key or
  // the setup, so a paused endpoint would stay paused: never just a warning.
  it.each([
    ['not_permitted', 'transcoding.auto_unpause_not_permitted'],
    ['unreadable', 'transcoding.endpoint_workers_unread'],
    ['not_found', 'transcoding.endpoint_workers_unread'],
  ] as const)('logs an endpoint it cannot read (%s) at error', async (reason, event) => {
    const error = logSpy('error');
    const api = stubApi({ ok: false, reason });

    await serviceWith(api).ensureEndpointAwake(deadline());

    expect(error).toHaveBeenCalledWith(event, expect.anything());
  });

  it('logs a passing outage only as a warning', async () => {
    const error = logSpy('error');
    const api = stubApi({ ok: false, reason: 'unavailable', status: 503 });

    await serviceWith(api).ensureEndpointAwake(deadline());

    expect(error).not.toHaveBeenCalled();
  });

  it('calls a raise RunPod did not apply not raised, at error', async () => {
    const error = logSpy('error');
    const api = stubApi({ ok: true, max: 0 }, { ok: true, max: 0 });

    expect(await serviceWith(api).ensureEndpointAwake(deadline())).toEqual({
      kind: 'not_raised',
      from: 0,
      reason: 'not_applied',
    });
    expect(error).toHaveBeenCalledWith(
      'transcoding.endpoint_workers_not_raised',
      expect.objectContaining({ confirmed: 0, wanted: 5 })
    );
  });
});

describe('dispatch wakes a paused endpoint', () => {
  const claimed = media({ status: 'transcoding', transcodingAttempts: 1 });

  it('a 409 refusal reads the endpoint and raises its max workers', async () => {
    const api = stubApi({ ok: true, max: 0 });
    runpodAnswers(409, { code: 'ENDPOINT_PAUSED' });

    const outcome = await serviceWith(api).dispatch(claimed);

    expect(outcome).toMatchObject({
      kind: 'rejected',
      code: 'TRANSCODER_PAUSED',
    });
    expect(api.setWorkersMax).toHaveBeenCalledWith(5, expect.any(Number));
  });

  it('any other refusal leaves the endpoint alone', async () => {
    const api = stubApi({ ok: true, max: 0 });
    runpodAnswers(429, {});

    await serviceWith(api).dispatch(claimed);

    expect(api.endpointWorkers).not.toHaveBeenCalled();
  });
});

/** A TranscodingAlerts stub: what the service told it, nothing sent. */
function stubAlerts() {
  return {
    mediaFailed: vi.fn(),
    dispatchRefused: vi.fn(),
    endpointStuck: vi.fn(),
  };
}

function serviceAlerting(
  alerts: ReturnType<typeof stubAlerts>,
  api?: ReturnType<typeof stubApi>
) {
  return new TranscodingService({
    ...config(fake.db),
    alerts: alerts as unknown as TranscodingAlerts,
    ...(api && { runpodApi: api as unknown as RunPodApi }),
  });
}

describe('failure emails', () => {
  const failedWebhook = {
    jobId: JOB_ID,
    status: 'failed' as const,
    error: 'moov atom not found',
    errorCode: 'CORRUPT_INPUT',
  };

  it('alerts once, with the row the failure webhook failed', async () => {
    const alerts = stubAlerts();
    const failedRow = media({ status: 'failed' });
    fake.findFirst.mockResolvedValue(media({ status: 'transcoding' }));
    fake.returning.push([failedRow]);

    await serviceAlerting(alerts).handleWebhook(failedWebhook);

    expect(alerts.mediaFailed).toHaveBeenCalledTimes(1);
    expect(alerts.mediaFailed).toHaveBeenCalledWith(failedRow);
  });

  // The read before it skips a deleted row; the write must too, or a row
  // deleted in between is failed and its creator emailed.
  it('writes the failure only to a row still undeleted', async () => {
    fake.findFirst.mockResolvedValue(media({ status: 'transcoding' }));
    fake.returning.push([media({ status: 'failed' })]);

    await serviceAlerting(stubAlerts()).handleWebhook(failedWebhook);

    expect(fake.writes[0]?.where).toContain(
      '"media_items"."deleted_at" is null'
    );
  });

  // Python delivers a webhook up to 3 times; only the first write applies.
  it('alerts nothing for a delivery whose write did not apply', async () => {
    const alerts = stubAlerts();
    fake.findFirst.mockResolvedValue(media({ status: 'failed' }));
    fake.returning.push([]);

    await serviceAlerting(alerts).handleWebhook(failedWebhook);

    expect(alerts.mediaFailed).not.toHaveBeenCalled();
  });

  it('alerts each row a rejected webhook output failed', async () => {
    const alerts = stubAlerts();
    const failedRow = media({ status: 'failed' });
    fake.returning.push([failedRow]);

    await serviceAlerting(alerts).rejectWebhookOutput(
      { jobId: JOB_ID, mediaId: MEDIA_ID },
      'unreadable output'
    );

    expect(alerts.mediaFailed).toHaveBeenCalledWith(failedRow);
  });
});

// Whether an outcome is a setup fault, and whether it was already mailed
// today, is the alerts' call (tested there). The service reports every
// dispatch's outcome, whoever started it: a fault found by the hourly retry
// alone must still reach the owner.
describe('setup-fault emails', () => {
  const claimed = media({ status: 'transcoding', transcodingAttempts: 1 });

  it('a dispatch hands its refusal to the alerts', async () => {
    const alerts = stubAlerts();
    runpodAnswers(401, { error: 'Unauthorized' });

    await serviceAlerting(alerts).dispatch(claimed);

    expect(alerts.dispatchRefused).toHaveBeenCalledWith(MEDIA_ID, {
      kind: 'rejected',
      code: 'TRANSCODER_MISCONFIGURED',
      detail: 'RunPod answered 401',
    });
    expect(alerts.endpointStuck).not.toHaveBeenCalled();
  });

  it('a 409 hands what waking the endpoint found to the alerts', async () => {
    const alerts = stubAlerts();
    const api = stubApi(
      { ok: true, max: 0 },
      { ok: false, reason: 'not_permitted', status: 403 }
    );
    runpodAnswers(409, { code: 'ENDPOINT_PAUSED' });

    await serviceAlerting(alerts, api).dispatch(claimed);

    expect(alerts.endpointStuck).toHaveBeenCalledWith({
      kind: 'not_raised',
      from: 0,
      reason: 'not_permitted',
    });
    expect(alerts.dispatchRefused).toHaveBeenCalledWith(
      MEDIA_ID,
      expect.objectContaining({ code: 'TRANSCODER_PAUSED' })
    );
  });

  it('wakes nothing, so reports no endpoint, for an accepted dispatch', async () => {
    const alerts = stubAlerts();
    fake.returning.push([claimed]);
    runpodAnswers(200, { id: JOB_ID, status: 'IN_QUEUE' });

    await serviceAlerting(alerts).dispatch(claimed);

    expect(alerts.endpointStuck).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the upload trigger',
      (svc: TranscodingService) => svc.triggerJobInternal(MEDIA_ID, CREATOR_ID),
    ],
    [
      'a creator Retry',
      (svc: TranscodingService) => svc.retryTranscoding(MEDIA_ID, CREATOR_ID),
    ],
  ])('%s reports its dispatch', async (_case, start) => {
    const alerts = stubAlerts();
    fake.findFirst.mockResolvedValue(
      media({ status: 'failed', transcodingErrorCode: 'TIMED_OUT' })
    );
    fake.returning.push([claimed]);
    runpodAnswers(401, {});

    const started = await start(serviceAlerting(alerts));
    if ('dispatchPromise' in started) await started.dispatchPromise;

    expect(alerts.dispatchRefused).toHaveBeenCalledTimes(1);
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
