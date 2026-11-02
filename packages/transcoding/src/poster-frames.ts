/**
 * Poster frames used as content thumbnails (Codex-tqvmx).
 *
 * The Studio's "use the video's frame" saves a poster's URL as the content
 * thumbnail, so a thumbnail can be a frame of one of the creator's videos,
 * whose posters the media purge deletes 30 days after the video is deleted.
 *
 * This is the ONE test of "is this URL a frame of that video". The delete
 * guard's `thumbnail` use (`@codex/content` media-usage), both publish gates
 * (`@codex/content`, `@codex/admin`) and the Studio's read all build on it,
 * so they never judge a URL differently: a gate that matched a URL the guard
 * doesn't count would let a waiting delete through once the publish
 * committed.
 */

import { CONTENT_TYPES } from '@codex/constants';
import { withCreatorScope } from '@codex/database';
import { mediaItems } from '@codex/database/schema';
import { and, type SQL, type SQLWrapper, sql } from 'drizzle-orm';
import { PATH_CONFIG } from './paths';

const POSTER_FOLDER = `/${PATH_CONFIG.MEDIA_THUMBNAILS_FOLDER}/`;

/**
 * True for the `media_items` row whose poster folder,
 * `/{creatorId}/media-thumbnails/{id}/`, occurs anywhere in `url`: once or
 * more, and only with the lower-case id Postgres prints, as the transcoder
 * writes it.
 */
export function holdsPosterFolderOf(url: SQLWrapper | string): SQL {
  return sql`strpos(${url}, '/' || ${mediaItems.creatorId} || ${POSTER_FOLDER}::text || ${mediaItems.id}::text || '/') > 0`;
}

/**
 * How many poster folders `url` names: its `/media-thumbnails/` segments.
 * Each is a frame of the creator's video only when {@link posterFramesOf}
 * finds that video, so a URL whose count exceeds the videos found names a
 * folder that isn't the creator's (Codex-p0uuc).
 */
export function posterFolderCount(url: string): number {
  return url.split(POSTER_FOLDER).length - 1;
}

/**
 * The media item a content row plays, which its publish checks as its media:
 * a video or audio item's own. Written content plays none, though it can
 * still hold a link, so a frame of that linked video is checked as a frame.
 */
export function playedMediaItemId(row: {
  contentType: string;
  mediaItemId: string | null;
}): string | null {
  return row.contentType === CONTENT_TYPES.VIDEO ||
    row.contentType === CONTENT_TYPES.AUDIO
    ? row.mediaItemId
    : null;
}

/** What the frame checks read of a content row. */
export interface PosterFrameSource {
  thumbnailUrl: string | null;
  creatorId: string;
  /**
   * Left out of the match: the media the content plays
   * ({@link playedMediaItemId}), which publish checks as its media. Null
   * matches every frame.
   */
  exceptMediaItemId: string | null;
}

/**
 * The `media_items` rows a content thumbnail is a frame of: the creator's
 * videos whose poster folder it holds, except `exceptMediaItemId`. Undefined
 * when the thumbnail holds no poster folder of the creator's, so the caller
 * skips the query; the SQL needs that substring too, so skipping never misses
 * a match. Another creator's video never matches: their posters aren't this
 * creator's to check (Codex-p0uuc).
 */
export function posterFramesOf(row: PosterFrameSource): SQL | undefined {
  const url = row.thumbnailUrl;
  if (!url?.includes(`/${row.creatorId}${POSTER_FOLDER}`)) return undefined;
  return and(
    withCreatorScope(mediaItems, row.creatorId),
    holdsPosterFolderOf(url),
    sql`${mediaItems.id} IS DISTINCT FROM ${row.exceptMediaItemId}::uuid`
  );
}
