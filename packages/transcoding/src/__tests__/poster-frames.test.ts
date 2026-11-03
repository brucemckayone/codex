/**
 * The cheap side of the poster-frame test (Codex-tqvmx): when the SQL match
 * is skipped, and which media a content row plays. What the SQL matches is
 * proven against Postgres in `@codex/content`'s media-usage integration
 * tests, beside the delete guard that shares it.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  playedMediaItemId,
  posterFolderCount,
  posterFramesOf,
} from '../poster-frames';

const id = '550e8400-e29b-41d4-a716-446655440000';
const cdn = 'https://cdn-assets.revelations.studio';

describe('posterFramesOf', () => {
  it('matches in SQL a URL holding the creator’s poster folder, scoped to the creator and leaving out the played media', () => {
    const where = posterFramesOf({
      thumbnailUrl: `${cdn}/user_1/media-thumbnails/${id}/1920x1080-0a1b2c3d/md.webp`,
      creatorId: 'user_1',
      exceptMediaItemId: id,
    });
    expect(where).toBeDefined();
    const query = new PgDialect().sqlToQuery(where!);
    expect(query.sql).toContain('strpos(');
    expect(query.sql).toContain('"media_items"."creator_id" = $');
    expect(query.params).toContain('user_1');
    expect(query.params).toContain(id);
  });

  it('skips the query when the URL holds no poster folder of the creator’s', () => {
    for (const thumbnailUrl of [
      null,
      `${cdn}/user_2/media-thumbnails/${id}/lg.webp`,
      `${cdn}/xuser_1/media-thumbnails/${id}/lg.webp`,
      `${cdn}/user_1/content-thumbnails/c1/1920x1080-0a1b2c3d/lg.webp`,
    ]) {
      expect(
        posterFramesOf({
          thumbnailUrl,
          creatorId: 'user_1',
          exceptMediaItemId: null,
        })
      ).toBeUndefined();
    }
  });
});

describe('posterFolderCount', () => {
  it('counts the poster folders a URL names', () => {
    expect(
      posterFolderCount(`${cdn}/user_1/content-thumbnails/c1/lg.webp`)
    ).toBe(0);
    expect(
      posterFolderCount(`${cdn}/user_1/media-thumbnails/${id}/lg.webp`)
    ).toBe(1);
    expect(
      posterFolderCount(
        `${cdn}/user_1/media-thumbnails/${id}/user_2/media-thumbnails/${id}/lg.webp`
      )
    ).toBe(2);
  });
});

describe('playedMediaItemId', () => {
  it('is a video’s or audio’s own media, and none for written content holding a link', () => {
    expect(playedMediaItemId({ contentType: 'video', mediaItemId: id })).toBe(
      id
    );
    expect(playedMediaItemId({ contentType: 'audio', mediaItemId: id })).toBe(
      id
    );
    expect(
      playedMediaItemId({ contentType: 'written', mediaItemId: id })
    ).toBeNull();
  });
});
