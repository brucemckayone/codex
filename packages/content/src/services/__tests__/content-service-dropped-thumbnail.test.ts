/**
 * ContentService.updateReportingDroppedThumbnail (Codex-kk9nv.5)
 *
 * Since kk9nv.5 every thumbnail upload writes a new folder,
 * `{creatorId}/content-thumbnails/{contentId}/{w}x{h}-{8 hex}/`, so nothing
 * overwrites a folder the row stops pointing at. The studio form re-sends
 * `thumbnailUrl` on every save, and its "use media thumbnail" button moves the
 * row onto a poster frame without the DELETE route, so the update itself must
 * name the URL it dropped for the PATCH route to delete.
 *
 * A stale form is the other half: one opened before a re-upload still holds
 * the replaced URL, whose files the upload deleted. Re-sending it would point
 * the row at a 404, so an own-folder URL that differs from the row is ignored.
 */

import { content as contentTable } from '@codex/database/schema';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentService } from '../content-service';

const CDN = 'https://cdn.test.example';

describe('ContentService.updateReportingDroppedThumbnail', () => {
  let db: Database;
  let service: ContentService;
  let creatorId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new ContentService({
      db,
      environment: 'test',
      r2PublicUrlBase: CDN,
    });
    [creatorId] = await seedTestUsers(db, 1);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  /** Written content whose thumbnail is `url`, made by `url(contentId)`. */
  async function contentWithThumbnail(
    url: (contentId: string) => string | null
  ) {
    const created = await service.create(
      {
        title: 'Thumbnail drop',
        slug: createUniqueSlug('thumb-drop'),
        contentType: 'written',
        contentBody: 'Body text',
        tags: [],
      },
      creatorId
    );
    const thumbnailUrl = url(created.id);
    // Written straight to the row, as an upload does: `update` itself would
    // ignore an own-folder URL the row does not already hold.
    await db
      .update(contentTable)
      .set({ thumbnailUrl })
      .where(eq(contentTable.id, created.id));
    return { id: created.id, thumbnailUrl };
  }

  const ownFolderUrl = (contentId: string, name: string) =>
    `${CDN}/${creatorId}/content-thumbnails/${contentId}/${name}/lg.webp`;

  it('names the upload a move to a poster frame dropped', async () => {
    const row = await contentWithThumbnail((id) =>
      ownFolderUrl(id, '1200x800-0a1b2c3d')
    );
    const poster = `${CDN}/${creatorId}/media-thumbnails/m-1/lg.webp`;

    const { content, droppedThumbnailUrl } =
      await service.updateReportingDroppedThumbnail(
        row.id,
        { thumbnailUrl: poster },
        creatorId
      );

    expect(content.thumbnailUrl).toBe(poster);
    expect(droppedThumbnailUrl).toBe(row.thumbnailUrl);
  });

  it('names the upload an explicit null dropped', async () => {
    const row = await contentWithThumbnail((id) =>
      ownFolderUrl(id, '1200x800-0a1b2c3d')
    );

    const { content, droppedThumbnailUrl } =
      await service.updateReportingDroppedThumbnail(
        row.id,
        { thumbnailUrl: null },
        creatorId
      );

    expect(content.thumbnailUrl).toBeNull();
    expect(droppedThumbnailUrl).toBe(row.thumbnailUrl);
  });

  it('drops nothing when the form re-sends the same URL or omits it', async () => {
    const row = await contentWithThumbnail((id) =>
      ownFolderUrl(id, '1200x800-0a1b2c3d')
    );

    const resent = await service.updateReportingDroppedThumbnail(
      row.id,
      { title: 'Renamed', thumbnailUrl: row.thumbnailUrl },
      creatorId
    );
    const omitted = await service.updateReportingDroppedThumbnail(
      row.id,
      { title: 'Renamed again' },
      creatorId
    );

    expect(resent.droppedThumbnailUrl).toBeNull();
    expect(omitted.droppedThumbnailUrl).toBeNull();
    expect(omitted.content.thumbnailUrl).toBe(row.thumbnailUrl);
  });

  it("keeps the stored thumbnail when a stale form re-sends a replaced upload's URL", async () => {
    const row = await contentWithThumbnail((id) =>
      ownFolderUrl(id, '1600x900-ffffffff')
    );
    // The upload this replaced: same content's folder, different name.
    const replaced = ownFolderUrl(row.id, '1200x800-0a1b2c3d');

    const { content, droppedThumbnailUrl } =
      await service.updateReportingDroppedThumbnail(
        row.id,
        { title: 'Edited in a stale tab', thumbnailUrl: replaced },
        creatorId
      );

    // The rest of the edit lands; the thumbnail does not move.
    expect(content.title).toBe('Edited in a stale tab');
    expect(content.thumbnailUrl).toBe(row.thumbnailUrl);
    expect(droppedThumbnailUrl).toBeNull();
  });

  it('a first thumbnail drops nothing', async () => {
    const row = await contentWithThumbnail(() => null);

    const { droppedThumbnailUrl } =
      await service.updateReportingDroppedThumbnail(
        row.id,
        {
          thumbnailUrl: `${CDN}/${creatorId}/media-thumbnails/m-1/lg.webp`,
        },
        creatorId
      );

    expect(droppedThumbnailUrl).toBeNull();
  });
});
