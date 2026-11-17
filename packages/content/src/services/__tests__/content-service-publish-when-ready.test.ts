/**
 * Publish when ready (Codex-a6ofh.2.7, data-design §3.7): `publish(…,
 * { whenReady })` schedules a draft whose media is still on its way, and
 * runs every other publish rule as it always has; a cancel, a save that
 * removes the media, and every successful publish clear the schedule.
 *
 * Rows are inserted directly, so each test sets its media's exact status and
 * age: the gate is under test here, not the attach rules. They are deleted
 * after: a scheduled draft left behind would feed the media-ready sweep
 * (Codex-a6ofh.2.8), which reads every scheduled row.
 */

import { MEDIA_UPLOAD_STALLED_AFTER_MS } from '@codex/constants';
import { content, mediaItems, organizations } from '@codex/database/schema';
import {
  createTestContentInput,
  createTestMediaItemInput,
  createTestOrganizationInput,
  type Database,
  joinTeam,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NewContent } from '../../types';
import { ContentService } from '../content-service';

describe('ContentService: publish when ready', () => {
  let db: Database;
  let service: ContentService;
  let creatorId: string;
  let otherCreatorId: string;
  const contentIds: string[] = [];
  const mediaIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new ContentService({ db, environment: 'test' });
    [creatorId, otherCreatorId] = await seedTestUsers(db, 2);
  });

  afterAll(async () => {
    if (contentIds.length > 0) {
      await db.delete(content).where(inArray(content.id, contentIds));
    }
    if (mediaIds.length > 0) {
      await db.delete(mediaItems).where(inArray(mediaItems.id, mediaIds));
    }
    await teardownTestDatabase();
  });

  async function media(
    status: string,
    extra: Partial<typeof mediaItems.$inferInsert> = {},
    owner = creatorId
  ) {
    const row = takeFirst(
      await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(owner, {
            mediaType: 'video',
            status,
            ...extra,
          })
        )
        .returning()
    );
    mediaIds.push(row.id);
    return row;
  }

  async function draft(overrides: Partial<NewContent> = {}) {
    const row = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            contentType: 'video',
            ...overrides,
          })
        )
        .returning()
    );
    contentIds.push(row.id);
    return row;
  }

  /**
   * What a finished video transcode writes: ready, and the keys the
   * `status_ready_requires_keys` CHECK asks a ready video for.
   */
  const readyColumns = (mediaItemId: string) => ({
    status: 'ready',
    hlsMasterPlaylistKey: `hls/${mediaItemId}/master.m3u8`,
    durationSeconds: 120,
    thumbnailKey: `thumbnails/${mediaItemId}/thumb.jpg`,
  });

  const stored = async (id: string) =>
    takeFirst(await db.select().from(content).where(eq(content.id, id)));

  /** A draft whose media is on its way: the schedulable case. */
  const onItsWay = async (overrides: Partial<NewContent> = {}) =>
    draft({ mediaItemId: (await media('transcoding')).id, ...overrides });

  /**
   * Runs `ask` while a media status write is held open (the webhook's shape)
   * and reports whether `ask` waited on it. A probe, not a timer: a wait for
   * a pool connection is not a lock wait.
   */
  async function whileMediaWriteHeld<T>(
    mediaItemId: string,
    columns: Partial<typeof mediaItems.$inferInsert>,
    ask: () => Promise<T>
  ): Promise<{ seen: string; result: Promise<T> }> {
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = (_pid: number) => {};
    const held = new Promise<number>((resolve) => {
      holding = resolve;
    });
    const writing = db.transaction(async (tx) => {
      await tx
        .update(mediaItems)
        .set(columns)
        .where(eq(mediaItems.id, mediaItemId));
      const pid = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
      holding(Number((pid.rows[0] as { pid: number }).pid));
      await released;
    });
    // A write that fails before it holds (a CHECK, say) fails the test now
    // instead of hanging it.
    const writer = await Promise.race([
      held,
      writing.then(() => {
        throw new Error('the media write ended before it was held');
      }),
    ]);

    const asking = ask();
    let settled = false;
    asking.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    let seen = 'neither after 10 s';
    for (let i = 0; i < 400 && seen === 'neither after 10 s'; i++) {
      const blocked = await db.execute(sql`
        SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE ${writer} = ANY(pg_blocking_pids(pid))`);
      if (settled) seen = 'finished';
      else if (Number((blocked.rows[0] as { n: number }).n) > 0)
        seen = 'waiting';
      else await new Promise((resolve) => setTimeout(resolve, 25));
    }
    release();
    await writing;
    return { seen, result: asking };
  }

  const MEDIA_NOT_READY = {
    statusCode: 422,
    context: { code: 'MEDIA_NOT_READY' },
  };

  /** The ask is refused as `match`, and the row stays unscheduled. */
  async function refusesUnscheduled(
    row: { id: string },
    match: object,
    options: { whenReady?: boolean } = { whenReady: true },
    asker = creatorId
  ) {
    await expect(service.publish(row.id, asker, options)).rejects.toMatchObject(
      match
    );
    expect((await stored(row.id)).publishRequestedAt).toBeNull();
  }

  describe('schedules a draft whose media is on its way', () => {
    it.each([
      'uploading',
      'uploaded',
      'transcoding',
    ])('media %s: scheduled, still a draft', async (status) => {
      const row = await draft({ mediaItemId: (await media(status)).id });

      const result = await service.publish(row.id, creatorId, {
        whenReady: true,
      });

      expect(result.status).toBe('draft');
      expect(result.publishedAt).toBeNull();
      expect(result.publishRequestedAt).toBeInstanceOf(Date);
      const saved = await stored(row.id);
      expect(saved.status).toBe('draft');
      expect(saved.publishRequestedAt).toEqual(result.publishRequestedAt);
      expect(saved.publishBlockedReason).toBeNull();
    });

    it('a second ask keeps the first request time, and clears an old blocked reason', async () => {
      const row = await onItsWay();
      const first = await service.publish(row.id, creatorId, {
        whenReady: true,
      });
      await db
        .update(content)
        .set({ publishBlockedReason: 'CREATOR_CONNECT_REQUIRED' })
        .where(eq(content.id, row.id));

      const second = await service.publish(row.id, creatorId, {
        whenReady: true,
      });

      expect(second.publishRequestedAt).toEqual(first.publishRequestedAt);
      expect(second.publishBlockedReason).toBeNull();
    });

    it('a repeat ask with nothing to clear writes nothing', async () => {
      const row = await onItsWay();
      await service.publish(row.id, creatorId, { whenReady: true });
      const scheduled = await stored(row.id);

      await service.publish(row.id, creatorId, { whenReady: true });

      expect((await stored(row.id)).updatedAt).toEqual(scheduled.updatedAt);
    });

    it('ready media goes live now, and the publish clears the schedule', async () => {
      const row = await draft({
        mediaItemId: (await media('ready')).id,
        publishRequestedAt: new Date('2026-11-01T00:00:00Z'),
        publishBlockedReason: 'CREATOR_CONNECT_REQUIRED',
      });

      const result = await service.publish(row.id, creatorId, {
        whenReady: true,
      });

      expect(result.status).toBe('published');
      expect(result.publishRequestedAt).toBeNull();
      expect(result.publishBlockedReason).toBeNull();
    });

    it('a plain publish of a scheduled draft clears the schedule too', async () => {
      const row = await draft({
        mediaItemId: (await media('ready')).id,
        publishRequestedAt: new Date('2026-11-01T00:00:00Z'),
      });

      const result = await service.publish(row.id, creatorId);

      expect(result.status).toBe('published');
      expect((await stored(row.id)).publishRequestedAt).toBeNull();
    });
  });

  describe('refuses media that will not get there on its own', () => {
    it.each([
      ['failed', () => media('failed')],
      [
        'a stalled upload',
        () =>
          media('uploading', {
            createdAt: new Date(
              Date.now() - MEDIA_UPLOAD_STALLED_AFTER_MS - 60_000
            ),
          }),
      ],
    ])('%s: MEDIA_NOT_READY, nothing scheduled', async (_case, make) => {
      const row = await draft({ mediaItemId: (await make()).id });

      await refusesUnscheduled(row, MEDIA_NOT_READY);
    });

    it('without whenReady, media on its way refuses as before', async () => {
      await refusesUnscheduled(await onItsWay(), MEDIA_NOT_READY, {});
    });
  });

  // A schedule is never a refusal postponed: every rule but the media's
  // readiness runs at the ask, and the row stays unscheduled.
  describe('every other rule still refuses, and schedules nothing', () => {
    const org = async () =>
      takeFirst(
        await db
          .insert(organizations)
          .values(createTestOrganizationInput())
          .returning()
      );

    it.each([
      [
        'payouts not set up for a piece that earns',
        () =>
          onItsWay({ isFree: false, isPurchasable: true, priceCents: 1200 }),
        { statusCode: 422, context: { code: 'CREATOR_CONNECT_REQUIRED' } },
      ],
      [
        'a price under £1',
        () => onItsWay({ isFree: false, isPurchasable: true, priceCents: 50 }),
        { statusCode: 422, context: { code: 'PRICE_REQUIRED' } },
      ],
      [
        "not on the org's team",
        async () => onItsWay({ organizationId: (await org()).id }),
        { statusCode: 403, context: { code: 'NOT_ON_ORG_TEAM' } },
      ],
      [
        'subscriber content in no plan',
        async () => {
          const team = await org();
          await joinTeam(db, team.id, creatorId);
          return onItsWay({
            organizationId: team.id,
            isFree: false,
            isTierGated: true,
          });
        },
        { statusCode: 422, context: { code: 'TIER_REQUIRED_TO_PUBLISH' } },
      ],
      [
        'deleted media',
        async () =>
          draft({
            mediaItemId: (await media('transcoding', { deletedAt: new Date() }))
              .id,
          }),
        { statusCode: 422, context: { code: 'MEDIA_DELETED' } },
      ],
      [
        "another creator's media",
        async () =>
          draft({
            mediaItemId: (await media('transcoding', {}, otherCreatorId)).id,
          }),
        { statusCode: 404 },
      ],
    ])('%s', async (_case, seed, match) => {
      await refusesUnscheduled(await seed(), match);
    });

    it('another creator cannot schedule it (not found)', async () => {
      await refusesUnscheduled(
        await onItsWay(),
        { statusCode: 404 },
        { whenReady: true },
        otherCreatorId
      );
    });
  });

  describe('cancel', () => {
    it('clears the schedule and the blocked reason; the draft stays a draft', async () => {
      const row = await onItsWay();
      await service.publish(row.id, creatorId, { whenReady: true });
      await db
        .update(content)
        .set({ publishBlockedReason: 'CREATOR_CONNECT_REQUIRED' })
        .where(eq(content.id, row.id));

      const result = await service.cancelPublishRequest(row.id, creatorId);

      expect(result.status).toBe('draft');
      expect(result.publishRequestedAt).toBeNull();
      expect(result.publishBlockedReason).toBeNull();
      expect((await stored(row.id)).publishRequestedAt).toBeNull();
    });

    it('nothing scheduled: the row comes back unchanged', async () => {
      const row = await draft({ mediaItemId: (await media('ready')).id });

      const result = await service.cancelPublishRequest(row.id, creatorId);

      expect(result.id).toBe(row.id);
      expect((await stored(row.id)).updatedAt).toEqual(row.updatedAt);
    });

    it("another creator's schedule is not theirs to cancel", async () => {
      const row = await onItsWay();
      await service.publish(row.id, creatorId, { whenReady: true });

      await expect(
        service.cancelPublishRequest(row.id, otherCreatorId)
      ).rejects.toMatchObject({ statusCode: 404 });
      expect((await stored(row.id)).publishRequestedAt).toBeInstanceOf(Date);
    });
  });

  describe('a save after scheduling', () => {
    it('that removes the media clears the schedule (owner, 2026-11-07)', async () => {
      const row = await onItsWay();
      await service.publish(row.id, creatorId, { whenReady: true });

      await service.update(row.id, { mediaItemId: null }, creatorId);

      const saved = await stored(row.id);
      expect(saved.mediaItemId).toBeNull();
      expect(saved.publishRequestedAt).toBeNull();
    });

    // An article plays no media, so nothing is left to wait for, though it
    // keeps the link (review round 2).
    it('that makes it an article clears the schedule', async () => {
      const row = await onItsWay();
      await service.publish(row.id, creatorId, { whenReady: true });

      await service.update(row.id, { contentType: 'written' }, creatorId);

      const saved = await stored(row.id);
      expect(saved.contentType).toBe('written');
      expect(saved.mediaItemId).toBe(row.mediaItemId);
      expect(saved.publishRequestedAt).toBeNull();
    });

    // Owner, 2026-11-07 (review round 1): a swap keeps the schedule unless
    // the new file can never get there. On its way, it waits; already ready,
    // Publish now or the hourly safety net (E2.8) takes it live.
    it.each([
      ['on its way', () => media('uploaded')],
      ['already ready', () => media('ready')],
    ])('that swaps onto media %s, or touches something else, keeps it', async (_case, make) => {
      const row = await onItsWay();
      const scheduled = await service.publish(row.id, creatorId, {
        whenReady: true,
      });

      await service.update(
        row.id,
        { title: 'Renamed while waiting' },
        creatorId
      );
      await service.update(
        row.id,
        { mediaItemId: (await make()).id },
        creatorId
      );

      expect((await stored(row.id)).publishRequestedAt).toEqual(
        scheduled.publishRequestedAt
      );
    });

    it.each([
      ['failed', () => media('failed')],
      [
        'a stopped upload',
        () =>
          media('uploading', {
            createdAt: new Date(
              Date.now() - MEDIA_UPLOAD_STALLED_AFTER_MS - 60_000
            ),
          }),
      ],
    ])('that swaps onto media %s clears it: nothing to wait for', async (_case, make) => {
      const row = await onItsWay();
      await service.publish(row.id, creatorId, { whenReady: true });

      await service.update(
        row.id,
        { mediaItemId: (await make()).id },
        creatorId
      );

      expect((await stored(row.id)).publishRequestedAt).toBeNull();
    });
  });

  // The epic review's critical (Codex-a6ofh.2): a piece can go live with the
  // editor still open on it (its schedule fired, an admin, another tab). A
  // draft's autosave must then never write to it: its changes wait for Update.
  describe("a draft's autosave (asDraft)", () => {
    const DRAFT_SAVE_REFUSED = {
      statusCode: 409,
      context: { code: 'CONTENT_ALREADY_LIVE' },
    };

    it('saves a draft that has never been live', async () => {
      const row = await onItsWay();
      await service.publish(row.id, creatorId, { whenReady: true });

      await service.update(row.id, { title: 'Still a draft' }, creatorId, {
        asDraft: true,
      });

      expect((await stored(row.id)).title).toBe('Still a draft');
    });

    it('is refused once it went live, and writes nothing', async () => {
      const row = await draft({ mediaItemId: (await media('ready')).id });
      await service.publish(row.id, creatorId);
      const live = await stored(row.id);

      await expect(
        service.update(row.id, { title: 'Half-typed' }, creatorId, {
          asDraft: true,
        })
      ).rejects.toMatchObject(DRAFT_SAVE_REFUSED);
      const after = await stored(row.id);
      expect(after.title).toBe(live.title);
      expect(after.updatedAt).toEqual(live.updatedAt);
    });

    // Ever live counts as live (owner, 2026-11-05: its buyers keep it).
    it('is refused on a piece unpublished since', async () => {
      const row = await draft({ mediaItemId: (await media('ready')).id });
      await service.publish(row.id, creatorId);
      await service.unpublish(row.id, creatorId);
      expect((await stored(row.id)).status).toBe('draft');

      await expect(
        service.update(row.id, { title: 'Half-typed' }, creatorId, {
          asDraft: true,
        })
      ).rejects.toMatchObject(DRAFT_SAVE_REFUSED);
    });

    it("a live piece's Update (no asDraft) still saves", async () => {
      const row = await draft({ mediaItemId: (await media('ready')).id });
      await service.publish(row.id, creatorId);

      await service.update(row.id, { title: 'Updated on purpose' }, creatorId);

      expect((await stored(row.id)).title).toBe('Updated on purpose');
    });
  });

  describe('a refusal says what to do', () => {
    it('a stopped upload is marked stalled; one still uploading is not', async () => {
      const stalled = await draft({
        mediaItemId: (
          await media('uploading', {
            createdAt: new Date(
              Date.now() - MEDIA_UPLOAD_STALLED_AFTER_MS - 60_000
            ),
          })
        ).id,
      });
      const failed = await draft({ mediaItemId: (await media('failed')).id });

      await expect(
        service.publish(stalled.id, creatorId, { whenReady: true })
      ).rejects.toMatchObject({
        context: { code: 'MEDIA_NOT_READY', stalled: true },
      });
      const refusal = await service
        .publish(failed.id, creatorId, { whenReady: true })
        .catch((error: unknown) => error);
      expect(refusal).toMatchObject({ context: { code: 'MEDIA_NOT_READY' } });
      expect((refusal as { context: object }).context).not.toHaveProperty(
        'stalled'
      );
    });

    it('so does a live piece moved onto a stopped upload', async () => {
      const row = await draft({ mediaItemId: (await media('ready')).id });
      await service.publish(row.id, creatorId);
      const stopped = await media('uploading', {
        createdAt: new Date(
          Date.now() - MEDIA_UPLOAD_STALLED_AFTER_MS - 60_000
        ),
      });

      await expect(
        service.update(row.id, { mediaItemId: stopped.id }, creatorId)
      ).rejects.toMatchObject({
        context: { code: 'MEDIA_NOT_READY', stalled: true },
      });
    });

    it('a cancel that lost to a go-live says it is live (409), never "cancelled"', async () => {
      const row = await draft({ mediaItemId: (await media('ready')).id });
      await service.publish(row.id, creatorId);

      await expect(
        service.cancelPublishRequest(row.id, creatorId)
      ).rejects.toMatchObject({
        statusCode: 409,
        context: { code: 'CONTENT_ALREADY_LIVE' },
      });
    });
  });

  // The media-ready trigger (Codex-a6ofh.2.8) publishes with fromSchedule: a
  // row only goes live if, under its lock, it is still scheduled on the media
  // that fired.
  describe('the trigger publish (fromSchedule)', () => {
    const readyNow = (mediaItemId: string) =>
      db
        .update(mediaItems)
        .set(readyColumns(mediaItemId))
        .where(eq(mediaItems.id, mediaItemId));

    it('a draft still scheduled on that media goes live, its schedule cleared', async () => {
      const film = await media('transcoding');
      const row = await draft({ mediaItemId: film.id });
      await service.publish(row.id, creatorId, { whenReady: true });
      await readyNow(film.id);

      const result = await service.publish(row.id, creatorId, {
        fromSchedule: { mediaItemId: film.id },
      });

      expect(result.status).toBe('published');
      expect(result.publishRequestedAt).toBeNull();
    });

    it('a cancel that came first wins: the draft stays a draft', async () => {
      const film = await media('transcoding');
      const row = await draft({ mediaItemId: film.id });
      await service.publish(row.id, creatorId, { whenReady: true });
      await service.cancelPublishRequest(row.id, creatorId);
      await readyNow(film.id);

      const result = await service.publish(row.id, creatorId, {
        fromSchedule: { mediaItemId: film.id },
      });

      expect(result.status).toBe('draft');
      expect((await stored(row.id)).status).toBe('draft');
    });

    it('a swap that came first wins: the schedule waits on the new media', async () => {
      const film = await media('transcoding');
      const row = await draft({ mediaItemId: film.id });
      const scheduled = await service.publish(row.id, creatorId, {
        whenReady: true,
      });
      const next = await media('transcoding');
      await service.update(row.id, { mediaItemId: next.id }, creatorId);
      await readyNow(film.id);

      const result = await service.publish(row.id, creatorId, {
        fromSchedule: { mediaItemId: film.id },
      });

      expect(result.status).toBe('draft');
      const saved = await stored(row.id);
      expect(saved.mediaItemId).toBe(next.id);
      expect(saved.publishRequestedAt).toEqual(scheduled.publishRequestedAt);
    });
  });

  // A transcode finishing while a publish-when-ready is deciding (review,
  // round 1): the publish reads its media FOR SHARE, so it waits on the
  // status UPDATE and reads the media as ready, instead of scheduling on
  // media already ready, which no trigger would ever announce.
  it('a transcode finishing mid-ask is waited for: it goes live, not scheduled', async () => {
    const film = await media('transcoding');
    const row = await draft({ mediaItemId: film.id });

    const { seen, result } = await whileMediaWriteHeld(
      film.id,
      readyColumns(film.id),
      () => service.publish(row.id, creatorId, { whenReady: true })
    );

    expect(seen).toBe('waiting');
    const published = await result;
    expect(published.status).toBe('published');
    expect(published.publishRequestedAt).toBeNull();
  });

  // The same race on a scheduled draft's swap (review round 2): the save reads
  // the new media FOR SHARE, so a transcode failing mid-save is seen and the
  // schedule cleared, instead of left waiting on failed media.
  it('a transcode failing mid-swap is waited for: the schedule is cleared', async () => {
    const row = await onItsWay();
    await service.publish(row.id, creatorId, { whenReady: true });
    const next = await media('transcoding');

    const { seen, result } = await whileMediaWriteHeld(
      next.id,
      { status: 'failed' },
      () => service.update(row.id, { mediaItemId: next.id }, creatorId)
    );

    expect(seen).toBe('waiting');
    await result;
    const saved = await stored(row.id);
    expect(saved.mediaItemId).toBe(next.id);
    expect(saved.publishRequestedAt).toBeNull();
  });
});
