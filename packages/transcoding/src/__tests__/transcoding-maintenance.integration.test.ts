/**
 * The hourly maintenance run against real Postgres (Codex-l2c48.5).
 *
 * The run sweeps EVERY creator's rows: that is its job. So this suite runs
 * only where it is alone with its rows. That means CI (a fresh database per
 * job), or locally TRANSCODING_SWEEP_DB=1 against a throwaway database. It
 * refuses the shared local `neondb`: a run there would retry or fail other
 * sessions' uploads. It deletes exactly the rows it made.
 */

import { MEDIA_STATUS } from '@codex/constants';
import { mediaItems, users } from '@codex/database/schema';
import {
  createTestMediaItemInput,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, sql } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import type { JobStatusResult, RunPodApi } from '../runpod-api';
import type { TranscodingAlerts } from '../services/transcoding-alerts';
import { TranscodingMaintenance } from '../services/transcoding-maintenance';
import {
  TranscodingService,
  type TranscodingServiceFullConfig,
} from '../services/transcoding-service';

const HAS_DB =
  (process.env.DB_METHOD === 'LOCAL_PROXY' &&
    Boolean(process.env.DATABASE_URL_LOCAL_PROXY)) ||
  (process.env.DB_METHOD === 'NEON_BRANCH' &&
    Boolean(process.env.DATABASE_URL));
const ALONE_WITH_ITS_ROWS =
  process.env.CI === 'true' || process.env.TRANSCODING_SWEEP_DB === '1';
const SHARED_DATABASES = new Set(['neondb', 'main', 'main_test']);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const ago = (ms: number) => new Date(Date.now() - ms);

describe.skipIf(!HAS_DB || !ALONE_WITH_ITS_ROWS)(
  'maintenance run (database)',
  () => {
    let db: ReturnType<typeof setupTestDatabase>;
    let creatorId: string;
    let api: {
      endpointWorkers: ReturnType<typeof vi.fn>;
      setWorkersMax: ReturnType<typeof vi.fn>;
      jobStatus: ReturnType<typeof vi.fn>;
      ping: ReturnType<typeof vi.fn>;
    };
    let originalExists: Mock<(r2Key: string) => Promise<boolean>>;
    let alerts: {
      mediaFailed: Mock;
      dispatchRefused: Mock;
      endpointStuck: Mock;
      pingRefused: Mock;
      uploadsIncomplete: Mock;
    };
    let maintenance: TranscodingMaintenance;

    beforeAll(async () => {
      db = setupTestDatabase();
      // The HTTP and WebSocket drivers return different shapes.
      const result = await db.execute(sql`select current_database() as name`);
      const rows = Array.isArray(result)
        ? result
        : ((result as { rows?: unknown[] }).rows ?? []);
      const name = (rows[0] as { name?: unknown } | undefined)?.name;
      // Fail closed: a name that cannot be read is not known to be safe.
      if (
        process.env.CI !== 'true' &&
        (typeof name !== 'string' || SHARED_DATABASES.has(name))
      ) {
        throw new Error(
          `refusing to sweep "${String(name)}": other sessions' uploads may ` +
            'live there. Point DATABASE_URL_LOCAL_PROXY at a throwaway database.'
        );
      }
      [creatorId] = await seedTestUsers(db, 1);
    });

    beforeEach(() => {
      api = {
        endpointWorkers: vi.fn(async () => ({ ok: true, max: 5 })),
        setWorkersMax: vi.fn(async () => ({ ok: true, max: 5 })),
        jobStatus: vi.fn(
          async (): Promise<JobStatusResult> => ({
            ok: true,
            state: 'IN_PROGRESS',
          })
        ),
        ping: vi.fn(async () => ({ ok: true })),
      };
      originalExists = vi.fn(async (_r2Key: string) => true);
      alerts = {
        mediaFailed: vi.fn(),
        dispatchRefused: vi.fn(),
        endpointStuck: vi.fn(),
        pingRefused: vi.fn(),
        uploadsIncomplete: vi.fn(),
      };
      const transcoding = new TranscodingService({
        db,
        environment: 'test',
        runpodApiKey: 'test-key',
        runpodEndpointId: 'test-endpoint',
        webhookBaseUrl: 'https://media-api.test',
        runpodApiBaseUrl: 'https://runpod.test/v2',
        runpodWorkersMax: 5,
        runpodApi: api as unknown as RunPodApi,
        alerts: alerts as unknown as TranscodingAlerts,
      } as TranscodingServiceFullConfig);
      maintenance = new TranscodingMaintenance({
        db,
        environment: 'test',
        transcoding,
        originalExists,
        alerts: alerts as unknown as TranscodingAlerts,
      });
      // The retry step's dispatch: RunPod accepts.
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
          new Response(JSON.stringify({ id: 'job-retried' }), { status: 200 })
      );
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await db.delete(mediaItems).where(eq(mediaItems.creatorId, creatorId));
    });

    afterAll(async () => {
      await db.delete(users).where(eq(users.id, creatorId));
      await teardownTestDatabase();
    });

    async function insert(
      overrides: Parameters<typeof createTestMediaItemInput>[1]
    ) {
      return takeFirst(
        await db
          .insert(mediaItems)
          .values(
            createTestMediaItemInput(creatorId, {
              durationSeconds: 120,
              ...overrides,
            })
          )
          .returning(),
        'inserted media'
      );
    }

    /** The failure emails asked for one row: other suites' rows may share the db. */
    const failureAlertsFor = (id: string) =>
      alerts.mediaFailed.mock.calls.filter(([media]) => media.id === id);

    async function read(id: string) {
      return takeFirst(
        await db.select().from(mediaItems).where(eq(mediaItems.id, id)),
        `media ${id}`
      );
    }

    const run = (now = new Date()) =>
      maintenance.run({ now, deadline: Date.now() + 60_000 });

    describe('lost jobs', () => {
      it('fails a job RunPod finished whose result never arrived', async () => {
        const media = await insert({
          status: MEDIA_STATUS.TRANSCODING,
          runpodJobId: 'job-lost',
          transcodingAttempts: 1,
          updatedAt: ago(5 * HOUR),
        });
        api.jobStatus.mockResolvedValue({ ok: true, state: 'COMPLETED' });

        const report = await run();

        expect(api.jobStatus).toHaveBeenCalledWith(
          'job-lost',
          expect.any(Number)
        );
        expect(await read(media.id)).toMatchObject({
          status: 'failed',
          transcodingErrorCode: 'WEBHOOK_LOST',
          transcodingAttempts: 1,
        });
        expect(report.reconciled.failed).toBeGreaterThanOrEqual(1);
      });

      it('leaves a job RunPod is still running', async () => {
        const media = await insert({
          status: MEDIA_STATUS.TRANSCODING,
          runpodJobId: 'job-slow',
          updatedAt: ago(5 * HOUR),
        });

        await run();

        expect((await read(media.id)).status).toBe('transcoding');
      });

      // Both rows are past the query's 45 min prefilter, so only the
      // per-row due check keeps them out.
      it('does not ask about a long video still inside its execution timeout', async () => {
        const media = await insert({
          status: MEDIA_STATUS.TRANSCODING,
          runpodJobId: 'job-long',
          durationSeconds: 3600, // 15 min + 5 h allowed
          updatedAt: ago(2 * HOUR),
        });

        await run();

        expect(api.jobStatus).not.toHaveBeenCalledWith(
          'job-long',
          expect.anything()
        );
        expect((await read(media.id)).status).toBe('transcoding');
      });

      it('leaves a row with no job id while RunPod may still have it queued', async () => {
        const media = await insert({
          status: MEDIA_STATUS.TRANSCODING,
          runpodJobId: null,
          // 120 s: 30 min run + 1 h queue + 15 min margin = due at 1 h 45
          updatedAt: ago(1 * HOUR),
        });

        await run();

        expect((await read(media.id)).status).toBe('transcoding');
      });

      it('stops asking once RunPod cannot answer: the next run asks again', async () => {
        const first = await insert({
          status: MEDIA_STATUS.TRANSCODING,
          runpodJobId: 'job-a',
          updatedAt: ago(6 * HOUR),
        });
        const second = await insert({
          status: MEDIA_STATUS.TRANSCODING,
          runpodJobId: 'job-b',
          updatedAt: ago(5 * HOUR),
        });
        api.jobStatus.mockResolvedValue({ ok: false, reason: 'unavailable' });

        const report = await run();

        expect(api.jobStatus).toHaveBeenCalledTimes(1);
        expect((await read(first.id)).status).toBe('transcoding');
        expect((await read(second.id)).status).toBe('transcoding');
        expect(report.reconciled.left).toBeGreaterThanOrEqual(2);
      });

      it('goes on to the next job when one answer cannot be read', async () => {
        const unreadable = await insert({
          status: MEDIA_STATUS.TRANSCODING,
          runpodJobId: 'job-unreadable',
          updatedAt: ago(6 * HOUR),
        });
        const lost = await insert({
          status: MEDIA_STATUS.TRANSCODING,
          runpodJobId: 'job-lost-too',
          updatedAt: ago(5 * HOUR),
        });
        api.jobStatus.mockImplementation(
          async (jobId: string): Promise<JobStatusResult> =>
            jobId === 'job-unreadable'
              ? { ok: false, reason: 'unreadable', status: 200 }
              : { ok: true, state: 'COMPLETED' }
        );

        await run();

        expect((await read(unreadable.id)).status).toBe('transcoding');
        expect(await read(lost.id)).toMatchObject({
          status: 'failed',
          transcodingErrorCode: 'WEBHOOK_LOST',
        });
      });

      it('fails a job nobody could account for a day past due', async () => {
        const media = await insert({
          status: MEDIA_STATUS.TRANSCODING,
          runpodJobId: 'job-forever',
          // 120 s: due 45 min after; 24 h past due is 24 h 45 min.
          updatedAt: ago(26 * HOUR),
        });
        api.jobStatus.mockResolvedValue({ ok: false, reason: 'unavailable' });

        await run();

        expect(await read(media.id)).toMatchObject({
          status: 'failed',
          transcodingErrorCode: 'TIMED_OUT',
        });
      });

      // Long videos are not due for hours: they must not take the slots of
      // rows that are.
      it('reconciles a due row behind a full batch of rows not yet due', async () => {
        for (let i = 0; i < 26; i++) {
          await insert({
            status: MEDIA_STATUS.TRANSCODING,
            runpodJobId: `job-long-${i}`,
            durationSeconds: 3600,
            updatedAt: ago(3 * HOUR),
          });
        }
        const due = await insert({
          status: MEDIA_STATUS.TRANSCODING,
          runpodJobId: 'job-due',
          updatedAt: ago(2 * HOUR),
        });
        api.jobStatus.mockResolvedValue({ ok: true, state: 'COMPLETED' });

        const report = await run();

        expect((await read(due.id)).status).toBe('failed');
        expect(report.reconciled.notDue).toBeGreaterThanOrEqual(26);
      });

      // A soft delete that leaves updated_at alone must still stop the write.
      it('writes nothing to a row deleted while RunPod was asked', async () => {
        const media = await insert({
          status: MEDIA_STATUS.TRANSCODING,
          runpodJobId: 'job-deleted-meanwhile',
          updatedAt: ago(5 * HOUR),
        });
        api.jobStatus.mockImplementation(async () => {
          await db
            .update(mediaItems)
            .set({ deletedAt: new Date(), updatedAt: ago(5 * HOUR) })
            .where(eq(mediaItems.id, media.id));
          return { ok: true, state: 'COMPLETED' };
        });

        const report = await run();

        expect((await read(media.id)).status).toBe('transcoding');
        expect(report.raced).toBeGreaterThanOrEqual(1);
      });

      it('puts a row RunPod never confirmed back to waiting, attempt given back', async () => {
        const media = await insert({
          status: MEDIA_STATUS.TRANSCODING,
          runpodJobId: null,
          transcodingAttempts: 2,
          updatedAt: ago(5 * HOUR),
        });

        await run();

        expect(await read(media.id)).toMatchObject({
          status: 'uploaded',
          transcodingErrorCode: 'TRANSCODER_UNAVAILABLE',
          transcodingAttempts: 1,
        });
      });
    });

    describe('waiting uploads', () => {
      it('retries a waiting upload: claimed, dispatched, the job id stored', async () => {
        const media = await insert({
          status: MEDIA_STATUS.UPLOADED,
          transcodingErrorCode: 'TRANSCODER_PAUSED',
          uploadedAt: ago(1 * HOUR),
          updatedAt: ago(30 * MINUTE),
        });

        const report = await run();

        expect(await read(media.id)).toMatchObject({
          status: 'transcoding',
          runpodJobId: 'job-retried',
          transcodingErrorCode: null,
          transcodingAttempts: 1,
        });
        expect(report.waiting.retried).toBeGreaterThanOrEqual(1);
      });

      // Each refused dispatch would also re-read (and try to raise) the
      // endpoint: one per run is enough.
      it('stops retrying at the first dispatch RunPod does not accept', async () => {
        const waiting = [
          await insert({
            status: MEDIA_STATUS.UPLOADED,
            transcodingErrorCode: 'TRANSCODER_PAUSED',
            uploadedAt: ago(1 * HOUR),
            updatedAt: ago(40 * MINUTE),
          }),
          await insert({
            status: MEDIA_STATUS.UPLOADED,
            transcodingErrorCode: 'TRANSCODER_PAUSED',
            uploadedAt: ago(1 * HOUR),
            updatedAt: ago(30 * MINUTE),
          }),
        ];
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
          async () =>
            new Response(JSON.stringify({ code: 'ENDPOINT_PAUSED' }), {
              status: 409,
            })
        );

        const report = await run();

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(report.waiting).toMatchObject({ retried: 0, notAccepted: 1 });
        expect(report.waiting.deferred).toBeGreaterThanOrEqual(1);
        for (const media of waiting) {
          expect(await read(media.id)).toMatchObject({
            status: 'uploaded',
            transcodingErrorCode: 'TRANSCODER_PAUSED',
            transcodingAttempts: 0,
          });
        }
      });

      it('leaves an upload touched in the last 10 minutes alone', async () => {
        const media = await insert({
          status: MEDIA_STATUS.UPLOADED,
          uploadedAt: ago(5 * MINUTE),
          updatedAt: ago(5 * MINUTE),
        });

        await run();

        expect((await read(media.id)).status).toBe('uploaded');
      });

      it('gives up after 24 h, keeping the reason it waited', async () => {
        const media = await insert({
          status: MEDIA_STATUS.UPLOADED,
          transcodingErrorCode: 'TRANSCODER_PAUSED',
          uploadedAt: ago(25 * HOUR),
          updatedAt: ago(30 * MINUTE),
        });

        await run();

        expect(await read(media.id)).toMatchObject({
          status: 'failed',
          transcodingErrorCode: 'TRANSCODER_PAUSED',
        });
      });
    });

    // One row per step, each one the step would act on were it not deleted.
    it('never touches deleted media in any step', async () => {
      const deletedAt = new Date();
      const lost = await insert({
        status: MEDIA_STATUS.TRANSCODING,
        runpodJobId: 'job-deleted',
        updatedAt: ago(5 * HOUR),
        deletedAt,
      });
      const waiting = await insert({
        status: MEDIA_STATUS.UPLOADED,
        uploadedAt: ago(25 * HOUR),
        updatedAt: ago(30 * MINUTE),
        deletedAt,
      });
      const stalled = await insert({
        status: MEDIA_STATUS.UPLOADING,
        uploadedAt: null,
        updatedAt: ago(25 * HOUR),
        deletedAt,
      });
      api.jobStatus.mockResolvedValue({ ok: true, state: 'COMPLETED' });

      await run();

      expect((await read(lost.id)).status).toBe('transcoding');
      expect((await read(waiting.id)).status).toBe('uploaded');
      expect((await read(stalled.id)).status).toBe('uploading');
      expect(api.jobStatus).not.toHaveBeenCalledWith(
        'job-deleted',
        expect.anything()
      );
      expect(originalExists).not.toHaveBeenCalledWith(stalled.r2Key);
    });

    describe('stalled uploads', () => {
      it('moves an upload whose file arrived on to uploaded, starting its clock', async () => {
        const media = await insert({
          status: MEDIA_STATUS.UPLOADING,
          uploadedAt: null,
          updatedAt: ago(25 * HOUR),
        });

        await run();

        const after = await read(media.id);
        expect(after.status).toBe('uploaded');
        expect(after.uploadedAt?.getTime()).toBeGreaterThan(
          Date.now() - MINUTE
        );
        expect(originalExists).toHaveBeenCalledWith(media.r2Key);
      });

      it('fails an upload whose file never arrived', async () => {
        originalExists.mockResolvedValue(false);
        const media = await insert({
          status: MEDIA_STATUS.UPLOADING,
          uploadedAt: null,
          updatedAt: ago(25 * HOUR),
        });

        await run();

        expect(await read(media.id)).toMatchObject({
          status: 'failed',
          transcodingErrorCode: 'UPLOAD_INCOMPLETE',
        });
      });

      it('writes nothing to an upload deleted while R2 was asked', async () => {
        const media = await insert({
          status: MEDIA_STATUS.UPLOADING,
          uploadedAt: null,
          updatedAt: ago(25 * HOUR),
        });
        originalExists.mockImplementation(async () => {
          await db
            .update(mediaItems)
            .set({ deletedAt: new Date(), updatedAt: ago(25 * HOUR) })
            .where(eq(mediaItems.id, media.id));
          return false;
        });

        await run();

        expect((await read(media.id)).status).toBe('uploading');
      });

      it('leaves uploads alone when R2 cannot say, and stops asking it', async () => {
        originalExists.mockRejectedValue(new Error('R2 unavailable'));
        const uploads = [
          await insert({
            status: MEDIA_STATUS.UPLOADING,
            uploadedAt: null,
            updatedAt: ago(26 * HOUR),
          }),
          await insert({
            status: MEDIA_STATUS.UPLOADING,
            uploadedAt: null,
            updatedAt: ago(25 * HOUR),
          }),
        ];

        const report = await run();

        expect(originalExists).toHaveBeenCalledTimes(1);
        for (const media of uploads) {
          expect((await read(media.id)).status).toBe('uploading');
        }
        expect(report.uploads.unknown).toBe(1);
      });
    });

    it('reports the uploads step failed when there is no R2 bucket', async () => {
      const report = await new TranscodingMaintenance({
        db,
        environment: 'test',
        transcoding: new TranscodingService({
          db,
          environment: 'test',
          runpodApiKey: 'test-key',
          runpodEndpointId: 'test-endpoint',
          webhookBaseUrl: 'https://media-api.test',
          runpodApi: api as unknown as RunPodApi,
        } as TranscodingServiceFullConfig),
      }).run({ deadline: Date.now() + 60_000 });

      expect(report.failedSteps).toContain('uploads');
    });

    describe('emails', () => {
      it('emails once for a lost job it fails, whatever later runs find', async () => {
        const media = await insert({
          status: MEDIA_STATUS.TRANSCODING,
          runpodJobId: 'job-lost-mailed',
          transcodingAttempts: 1,
          updatedAt: ago(5 * HOUR),
        });
        api.jobStatus.mockResolvedValue({ ok: true, state: 'COMPLETED' });

        await run();
        await run();

        const calls = failureAlertsFor(media.id);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.[0]).toMatchObject({
          title: media.title,
          creatorId,
          transcodingAttempts: 1,
          transcodingErrorCode: 'WEBHOOK_LOST',
        });
      });

      it('emails when it gives up on a waiting upload, keeping its code', async () => {
        const media = await insert({
          status: MEDIA_STATUS.UPLOADED,
          transcodingErrorCode: 'TRANSCODER_PAUSED',
          uploadedAt: ago(25 * HOUR),
          updatedAt: ago(30 * MINUTE),
        });

        await run();

        expect(failureAlertsFor(media.id)).toEqual([
          [
            expect.objectContaining({
              id: media.id,
              transcodingErrorCode: 'TRANSCODER_PAUSED',
            }),
          ],
        ]);
      });

      it('sends nothing for an upload it only retries, or one abandoned', async () => {
        const retried = await insert({
          status: MEDIA_STATUS.UPLOADED,
          transcodingErrorCode: 'TRANSCODER_PAUSED',
          uploadedAt: ago(1 * HOUR),
          updatedAt: ago(30 * MINUTE),
        });
        originalExists.mockResolvedValue(false);
        const abandoned = await insert({
          status: MEDIA_STATUS.UPLOADING,
          uploadedAt: null,
          updatedAt: ago(25 * HOUR),
        });

        await run();

        expect(failureAlertsFor(retried.id)).toHaveLength(0);
        expect(failureAlertsFor(abandoned.id)).toHaveLength(0);
        expect((await read(abandoned.id)).status).toBe('failed');
      });

      it('tells the owner about a burst of uploads that never finished', async () => {
        originalExists.mockResolvedValue(false);
        for (let i = 0; i < 5; i++) {
          await insert({
            status: MEDIA_STATUS.UPLOADING,
            uploadedAt: null,
            updatedAt: ago(25 * HOUR),
          });
        }

        await run();

        expect(
          alerts.uploadsIncomplete.mock.calls[0]?.[0]
        ).toBeGreaterThanOrEqual(5);
      });

      // Any run may report a fault; the alerts mail it once a UTC day.
      it('hands an endpoint it cannot wake to the alerts, every run', async () => {
        api.endpointWorkers.mockResolvedValue({
          ok: false,
          reason: 'not_permitted',
          status: 403,
        });

        await run(new Date('2026-10-24T04:00:00Z'));
        await run(new Date('2026-10-24T05:00:00Z'));

        expect(alerts.endpointStuck).toHaveBeenCalledTimes(2);
        expect(alerts.endpointStuck).toHaveBeenCalledWith({
          kind: 'unknown',
          reason: 'not_permitted',
        });
      });

      // The run is on a fixed clock, so the row is idle relative to it;
      // real-time rows from elsewhere in the db are newer and stay out.
      it('hands a retry RunPod refused as misconfigured to the alerts, any hour', async () => {
        vi.spyOn(globalThis, 'fetch').mockImplementation(
          async () => new Response('{}', { status: 401 })
        );
        const media = await insert({
          status: MEDIA_STATUS.UPLOADED,
          transcodingErrorCode: 'TRANSCODER_MISCONFIGURED',
          uploadedAt: new Date('2026-10-24T01:00:00Z'),
          updatedAt: new Date('2026-10-24T02:30:00Z'),
        });

        await run(new Date('2026-10-24T04:00:00Z'));

        expect(alerts.dispatchRefused).toHaveBeenCalledWith(media.id, {
          kind: 'rejected',
          code: 'TRANSCODER_MISCONFIGURED',
          detail: 'RunPod answered 401',
        });
      });

      it('hands a refused keep-alive ping to the alerts', async () => {
        api.ping.mockResolvedValue({
          ok: false,
          reason: 'not_permitted',
          status: 403,
        });

        await run(new Date('2026-10-24T03:00:00Z'));

        expect(alerts.pingRefused).toHaveBeenCalledWith('not_permitted');
      });
    });

    describe('the endpoint', () => {
      it('is woken before the ping, so the ping finds it awake', async () => {
        await run(new Date('2026-10-24T03:00:00Z'));

        const [woken] = api.endpointWorkers.mock.invocationCallOrder;
        const [pinged] = api.ping.mock.invocationCallOrder;
        expect(woken).toBeLessThan(pinged ?? 0);
      });

      it('pings once a day, in the 03:00 UTC run only', async () => {
        await run(new Date('2026-10-24T03:00:00Z'));
        expect(api.ping).toHaveBeenCalledTimes(1);

        await run(new Date('2026-10-24T04:00:00Z'));
        expect(api.ping).toHaveBeenCalledTimes(1);
      });

      it('raises a paused endpoint every run it finds one', async () => {
        api.endpointWorkers.mockResolvedValue({ ok: true, max: 0 });

        const report = await run();

        expect(api.setWorkersMax).toHaveBeenCalledWith(5, expect.any(Number));
        expect(report.endpoint).toEqual({ kind: 'raised', from: 0, to: 5 });
      });
    });
  }
);
