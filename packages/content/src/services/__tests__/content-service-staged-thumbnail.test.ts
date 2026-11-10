/**
 * A cover staged for a piece that has been live (Codex-a6ofh.2.5).
 *
 * A live piece's changes wait for Update, so its cover upload must not write
 * the row. The stage route puts the new folder in place and records its four
 * keys as a stage's at once, and Update then sends the URL. Since kk9nv.5 an
 * own-folder URL that differs from the row names an upload since replaced,
 * whose files are gone, and is ignored. A stage is the exception, and Update
 * takes it: whole, undecided, not yet near the sweep, and only once, so a
 * stale form re-sending it later points nothing at a 404. A piece holds one
 * stage at a time, and one left unapplied is the sweep's after its grace.
 */

import {
  content as contentTable,
  orphanedImageFiles,
} from '@codex/database/schema';
import {
  OrphanedFileService,
  STAGED_COVER_GRACE_MS,
  stagedCoverRefusal,
} from '@codex/image-processing';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentService } from '../content-service';

const CDN = 'https://cdn.test.example';
const DAY = 24 * 60 * 60 * 1000;
const SIZES = ['sm', 'md', 'lg', 'xl'] as const;

describe('a staged cover', () => {
  let db: Database;
  let service: ContentService;
  let orphans: OrphanedFileService;
  let creatorId: string;
  // Rows these tests record feed the sweep, so they go afterwards.
  const orphanIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new ContentService({
      db,
      environment: 'test',
      r2PublicUrlBase: CDN,
    });
    orphans = new OrphanedFileService({ db, environment: 'test' });
    [creatorId] = await seedTestUsers(db, 1);
  });

  afterAll(async () => {
    if (db && orphanIds.length > 0) {
      await db
        .delete(orphanedImageFiles)
        .where(inArray(orphanedImageFiles.id, orphanIds));
    }
    await teardownTestDatabase();
  });

  const folderKey = (contentId: string, name: string) =>
    `${creatorId}/content-thumbnails/${contentId}/${name}`;
  const keysOf = (contentId: string, name: string) =>
    SIZES.map((size) => `${folderKey(contentId, name)}/${size}.webp`);
  const urlOf = (contentId: string, name: string) =>
    `${CDN}/${folderKey(contentId, name)}/lg.webp`;

  /** A piece whose cover is an earlier upload, written as an upload does. */
  async function pieceWithCover() {
    const created = await service.create(
      {
        title: 'Staged cover',
        slug: createUniqueSlug('staged-cover'),
        contentType: 'written',
        contentBody: 'Body text',
        tags: [],
      },
      creatorId
    );
    const thumbnailUrl = urlOf(created.id, '1200x800-0a1b2c3d');
    await db
      .update(contentTable)
      .set({ thumbnailUrl })
      .where(eq(contentTable.id, created.id));
    return { id: created.id, thumbnailUrl };
  }

  /** Record a stage's four keys for `entityId`, as the stage route does. */
  async function recordStage(
    contentId: string,
    name: string,
    entityId = contentId,
    stagedAt = new Date()
  ) {
    const ids = await orphans.recordStagedCover(
      entityId,
      keysOf(contentId, name),
      stagedAt
    );
    orphanIds.push(...ids);
    return ids;
  }

  const minutesAgo = (minutes: number) =>
    new Date(Date.now() - minutes * 60_000);

  /** What a stage recorded at `stagedAt` retires, as the stage route does. */
  const retireBefore = (contentId: string, stagedAt: Date) =>
    orphans.retireStagedCovers(contentId, stagedAt);

  /** Of these rows, the ones the sweep would take now, sorted. */
  const sweepable = async (ids: string[]) =>
    (await orphans.getPendingOrphans(10_000))
      .map((o) => o.id)
      .filter((id) => ids.includes(id))
      .sort();

  const statusesOf = async (ids: string[]) =>
    (
      await db
        .select({ status: orphanedImageFiles.status })
        .from(orphanedImageFiles)
        .where(inArray(orphanedImageFiles.id, ids))
    ).map((row) => row.status);

  const update = (id: string, thumbnailUrl: string, title = 'Updated') =>
    service.updateReportingDroppedThumbnail(
      id,
      { title, thumbnailUrl },
      creatorId
    );

  it('is applied by Update, which names the upload it replaced, and taken', async () => {
    const piece = await pieceWithCover();
    const ids = await recordStage(piece.id, '1600x900-abcdef01');

    const { content, droppedThumbnailUrl } = await update(
      piece.id,
      urlOf(piece.id, '1600x900-abcdef01')
    );

    expect(content.thumbnailUrl).toBe(urlOf(piece.id, '1600x900-abcdef01'));
    // The PATCH route deletes the folder this names.
    expect(droppedThumbnailUrl).toBe(piece.thumbnailUrl);
    // Taken: neither the sweep nor a later stage acts on it now.
    expect(await statusesOf(ids)).toEqual(SIZES.map(() => 'retained'));
  });

  it('applies once: re-sent after a later cover replaced it, it takes nothing and the cover stays', async () => {
    const piece = await pieceWithCover();
    await recordStage(piece.id, '1600x900-abcdef05');
    await update(piece.id, urlOf(piece.id, '1600x900-abcdef05'));
    await recordStage(piece.id, '1600x900-abcdef06');
    await update(piece.id, urlOf(piece.id, '1600x900-abcdef06'));

    // A stale form still holding the first; its files were deleted when the
    // second replaced it.
    const { content, droppedThumbnailUrl } = await update(
      piece.id,
      urlOf(piece.id, '1600x900-abcdef05'),
      'Stale form'
    );

    expect(content.title).toBe('Stale form');
    expect(content.thumbnailUrl).toBe(urlOf(piece.id, '1600x900-abcdef06'));
    expect(droppedThumbnailUrl).toBeNull();
  });

  it('is not applied once the sweep has decided it: its files are gone', async () => {
    const piece = await pieceWithCover();
    const ids = await recordStage(piece.id, '1600x900-abcdef02');
    await db
      .update(orphanedImageFiles)
      .set({ status: 'deleted' })
      .where(inArray(orphanedImageFiles.id, ids));

    const { content, droppedThumbnailUrl } = await update(
      piece.id,
      urlOf(piece.id, '1600x900-abcdef02'),
      'Updated late'
    );

    // The rest of the Update lands; the cover stays.
    expect(content.title).toBe('Updated late');
    expect(content.thumbnailUrl).toBe(piece.thumbnailUrl);
    expect(droppedThumbnailUrl).toBeNull();
  });

  it('is taken only whole: with one file left undecided, the cover stays', async () => {
    const piece = await pieceWithCover();
    const ids = await recordStage(piece.id, '1600x900-abcdef07');
    // The sweep part-way through it: every key but `sm` already decided.
    await db
      .update(orphanedImageFiles)
      .set({ status: 'deleted' })
      .where(inArray(orphanedImageFiles.id, ids.slice(1)));

    const { content } = await update(
      piece.id,
      urlOf(piece.id, '1600x900-abcdef07')
    );

    expect(content.thumbnailUrl).toBe(piece.thumbnailUrl);
  });

  it('is not taken once the sweep may be acting on it', async () => {
    const piece = await pieceWithCover();
    const ids = await recordStage(piece.id, '1600x900-abcdef08');
    // Within the last half hour of its grace.
    await db
      .update(orphanedImageFiles)
      .set({
        orphanedAt: new Date(Date.now() - STAGED_COVER_GRACE_MS + 30 * 60_000),
      })
      .where(inArray(orphanedImageFiles.id, ids));

    const { content } = await update(
      piece.id,
      urlOf(piece.id, '1600x900-abcdef08')
    );

    expect(content.thumbnailUrl).toBe(piece.thumbnailUrl);
    // Left for the sweep, not taken.
    expect(await statusesOf(ids)).toEqual(SIZES.map(() => 'pending'));
  });

  it("is this piece's own: a stage recorded for another piece does not license this piece's folder", async () => {
    const piece = await pieceWithCover();
    const other = await pieceWithCover();
    await recordStage(piece.id, '1600x900-abcdef03', other.id);

    const { content } = await update(
      piece.id,
      urlOf(piece.id, '1600x900-abcdef03')
    );

    expect(content.thumbnailUrl).toBe(piece.thumbnailUrl);
  });

  it('is a stage: a cover orphan recorded for another reason does not license its folder', async () => {
    const piece = await pieceWithCover();
    // As a failed delete records a replaced upload's files.
    const ids = await orphans.recordOrphanedFiles(
      keysOf(piece.id, '1600x900-abcdef09').map((r2Key) => ({
        r2Key,
        imageType: 'content_thumbnail',
        entityId: piece.id,
        entityType: 'content',
      }))
    );
    orphanIds.push(...ids);

    const { content } = await update(
      piece.id,
      urlOf(piece.id, '1600x900-abcdef09')
    );

    expect(content.thumbnailUrl).toBe(piece.thumbnailUrl);
  });

  it('is the only one a piece holds: a later stage hands the earlier to the sweep, and leaves the new and the taken', async () => {
    const piece = await pieceWithCover();
    const taken = await recordStage(
      piece.id,
      '1600x900-abcdef0a',
      piece.id,
      minutesAgo(3)
    );
    await update(piece.id, urlOf(piece.id, '1600x900-abcdef0a'));
    const earlier = await recordStage(
      piece.id,
      '1600x900-abcdef0b',
      piece.id,
      minutesAgo(2)
    );
    const latestAt = minutesAgo(1);
    const latest = await recordStage(
      piece.id,
      '1600x900-abcdef0c',
      piece.id,
      latestAt
    );

    const retired = await retireBefore(piece.id, latestAt);

    expect(retired.map((row) => row.r2Key).sort()).toEqual(
      keysOf(piece.id, '1600x900-abcdef0b').sort()
    );
    // Pending until its files are gone, but the sweep's at once: its grace
    // is over, and an Update can no longer take it.
    expect(await sweepable(earlier)).toEqual([...earlier].sort());
    const { content } = await update(
      piece.id,
      urlOf(piece.id, '1600x900-abcdef0b')
    );
    expect(content.thumbnailUrl).toBe(urlOf(piece.id, '1600x900-abcdef0a'));
    expect(await sweepable(latest)).toEqual([]);
    expect(await statusesOf(latest)).toEqual(SIZES.map(() => 'pending'));
    expect(await statusesOf(taken)).toEqual(SIZES.map(() => 'retained'));

    // Its rows say deleted once its files are.
    await orphans.markReplacedStagesDeleted(
      piece.id,
      retired.map((row) => row.id)
    );
    expect(await statusesOf(earlier)).toEqual(SIZES.map(() => 'deleted'));
  });

  // Two tabs, or the page's and Settings' cover lines, each record and then
  // retire: whichever retires first, the later stage is the one left.
  it('keeps the later of two stages sent together, whichever retires first', async () => {
    for (const laterRetiresFirst of [true, false]) {
      const piece = await pieceWithCover();
      const firstAt = minutesAgo(2);
      const laterAt = minutesAgo(1);
      const first = await recordStage(
        piece.id,
        '1600x900-abcdef10',
        piece.id,
        firstAt
      );
      const later = await recordStage(
        piece.id,
        '1600x900-abcdef11',
        piece.id,
        laterAt
      );

      const order = laterRetiresFirst ? [laterAt, firstAt] : [firstAt, laterAt];
      for (const at of order) await retireBefore(piece.id, at);

      expect(await sweepable(first)).toEqual([...first].sort());
      expect(await sweepable(later)).toEqual([]);
    }
  });

  it("touches only the piece's own stages: a retire, and the mark after it", async () => {
    const piece = await pieceWithCover();
    const waiting = await recordStage(
      piece.id,
      '1600x900-abcdef30',
      piece.id,
      minutesAgo(2)
    );
    const stranger = await pieceWithCover();

    // Another piece's retire changes none of them; nor does a mark, by any
    // piece, of a stage nothing replaced.
    expect(await retireBefore(stranger.id, minutesAgo(1))).toEqual([]);
    await orphans.markReplacedStagesDeleted(stranger.id, waiting);
    await orphans.markReplacedStagesDeleted(piece.id, waiting);
    expect(await statusesOf(waiting)).toEqual(SIZES.map(() => 'pending'));
    expect(await sweepable(waiting)).toEqual([]);

    const handed = await retireBefore(piece.id, minutesAgo(1));
    expect(handed.map((row) => row.id).sort()).toEqual([...waiting].sort());
    await orphans.markReplacedStagesDeleted(stranger.id, waiting);
    expect(await statusesOf(waiting)).toEqual(SIZES.map(() => 'pending'));
    await orphans.markReplacedStagesDeleted(piece.id, waiting);
    expect(await statusesOf(waiting)).toEqual(SIZES.map(() => 'deleted'));
  });

  // The reason is the PATCH's log line: which of them it was, not a guess.
  it('says why a sent folder was not a stage this piece could take', async () => {
    const piece = await pieceWithCover();
    const why = (name: string) =>
      stagedCoverRefusal(db, piece.id, folderKey(piece.id, name));

    await recordStage(piece.id, '1600x900-abcdef20', piece.id, minutesAgo(3));
    await update(piece.id, urlOf(piece.id, '1600x900-abcdef20'));
    expect(await why('1600x900-abcdef20')).toBe('applied');

    await recordStage(piece.id, '1600x900-abcdef21', piece.id, minutesAgo(2));
    const replaced = await retireBefore(piece.id, minutesAgo(1));
    expect(await why('1600x900-abcdef21')).toBe('replaced');
    // As a stale form meets it: its files gone, its rows marked.
    await orphans.markReplacedStagesDeleted(
      piece.id,
      replaced.map((row) => row.id)
    );
    expect(await why('1600x900-abcdef21')).toBe('replaced');

    const part = await recordStage(piece.id, '1600x900-abcdef22');
    await db
      .update(orphanedImageFiles)
      .set({ status: 'deleted' })
      .where(inArray(orphanedImageFiles.id, part.slice(1)));
    // The sweep part-way through it: each row is swept alone.
    expect(await why('1600x900-abcdef22')).toBe('too_old');

    await recordStage(
      piece.id,
      '1600x900-abcdef23',
      piece.id,
      new Date(Date.now() - STAGED_COVER_GRACE_MS + 30 * 60_000)
    );
    expect(await why('1600x900-abcdef23')).toBe('too_old');

    expect(await why('1600x900-abcdef24')).toBe('not_a_stage');
  });

  it('is left alone by the sweep through its grace, and offered after; another cover orphan waits for nothing', async () => {
    const piece = await pieceWithCover();
    const [stageId] = await recordStage(piece.id, '1600x900-abcdef04');
    // A failed delete's cover orphan, recorded at the same moment.
    const plainId = takeFirst(
      await orphans.recordOrphanedFiles([
        {
          r2Key: `${folderKey(piece.id, '1200x800-abcdef04')}/lg.webp`,
          imageType: 'content_thumbnail',
          entityId: piece.id,
          entityType: 'content',
        },
      ])
    );
    orphanIds.push(plainId);

    const offered = async (now: Date) =>
      (await orphans.getPendingOrphans(10_000, now))
        .map((o) => o.id)
        .filter((id) => id === stageId || id === plainId);

    const start = Date.now();
    expect(await offered(new Date(start + DAY))).toEqual([plainId]);
    expect(
      (await offered(new Date(start + STAGED_COVER_GRACE_MS + DAY))).sort()
    ).toEqual([plainId, stageId].sort());
  });
});
