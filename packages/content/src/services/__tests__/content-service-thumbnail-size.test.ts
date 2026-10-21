/**
 * A content thumbnail's recorded size (Codex-kk9nv.5) describes the upload
 * that made it. The upload route writes it beside the URL. A URL the client
 * sets through `update` was never measured, so a CHANGED URL must clear the
 * old size, or the web would draw the new picture in the old one's shape.
 * Re-sending the same URL, as an edit form does, must leave it alone.
 */
import { content, mediaItems } from '@codex/database/schema';
import {
  createTestMediaItemInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import type { CreateContentInput } from '@codex/validation';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentService } from '../content-service';

const CDN = 'https://cdn.test.example';

describe("ContentService.update — the thumbnail's recorded size", () => {
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
    const [creator] = await seedTestUsers(db, 1);
    if (!creator) throw new Error('failed to seed creator');
    creatorId = creator;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  /** A content row whose thumbnail an upload measured at 2400x1600. */
  async function measured(): Promise<{ id: string; url: string }> {
    const [media] = await db
      .insert(mediaItems)
      .values(
        createTestMediaItemInput(creatorId, {
          mediaType: 'audio',
          status: 'ready',
        })
      )
      .returning();
    if (!media) throw new Error('failed to seed media');
    const created = await service.create(
      {
        title: 'Sized',
        slug: createUniqueSlug('thumb-size'),
        contentType: 'audio',
        mediaItemId: media.id,
        tags: [],
      } as CreateContentInput,
      creatorId
    );
    const url = `${CDN}/${creatorId}/content-thumbnails/${created.id}/lg.webp`;
    // What processContentThumbnail writes.
    await db
      .update(content)
      .set({ thumbnailUrl: url, thumbnailWidth: 2400, thumbnailHeight: 1600 })
      .where(eq(content.id, created.id));
    return { id: created.id, url };
  }

  async function sizeOf(id: string) {
    const [row] = await db
      .select({
        width: content.thumbnailWidth,
        height: content.thumbnailHeight,
      })
      .from(content)
      .where(eq(content.id, id));
    return row;
  }

  it('clears the size when the client points the thumbnail somewhere else', async () => {
    const { id } = await measured();

    await service.update(
      id,
      { thumbnailUrl: `${CDN}/${creatorId}/media-thumbnails/m1/lg.webp` },
      creatorId
    );

    expect(await sizeOf(id)).toEqual({ width: null, height: null });
  });

  it('clears the size when the client removes the thumbnail', async () => {
    const { id } = await measured();

    await service.update(id, { thumbnailUrl: null }, creatorId);

    expect(await sizeOf(id)).toEqual({ width: null, height: null });
  });

  it('keeps the size when an edit re-sends the same thumbnail, or leaves it out', async () => {
    const { id, url } = await measured();

    await service.update(id, { thumbnailUrl: url, title: 'Edited' }, creatorId);
    expect(await sizeOf(id)).toEqual({ width: 2400, height: 1600 });

    await service.update(id, { title: 'Edited again' }, creatorId);
    expect(await sizeOf(id)).toEqual({ width: 2400, height: 1600 });
  });
});
