/**
 * Content asset cleanup helpers (extracted from the route for unit-testing,
 * mirroring the `public-cache.ts` convention).
 *
 * Codex-ko8ko: soft-deleting a content row must not strand its thumbnail's
 * R2 objects. `ImageProcessingService.deleteContentThumbnail` already deletes
 * the three deterministic variant keys and records orphans for the hourly
 * `OrphanedFileCleanupDO` sweep on R2 failure — but it was only wired to the
 * standalone "remove thumbnail" endpoint, never to content deletion. This
 * helper bridges that gap while guaranteeing a cleanup hiccup can never fail
 * the delete itself.
 */

import type { Logger } from '@codex/observability';

/** The single ImageProcessingService method this helper depends on. */
export interface ThumbnailCleaner {
  deleteContentThumbnail(contentId: string, creatorId: string): Promise<void>;
}

/**
 * Best-effort deletion of a content item's thumbnail R2 objects on content
 * delete.
 *
 * ALWAYS resolves: any error is swallowed and logged so the caller's content
 * soft-delete (the primary operation) is never rolled back by a transient
 * R2/DB failure here. On R2 failure `deleteContentThumbnail` itself records
 * orphans for the deferred `OrphanedFileCleanupDO` sweep, so nothing leaks
 * permanently even when this path hiccups.
 */
export async function cleanupContentThumbnailOnDelete(
  imageProcessing: ThumbnailCleaner,
  contentId: string,
  creatorId: string,
  obs?: Logger
): Promise<void> {
  try {
    await imageProcessing.deleteContentThumbnail(contentId, creatorId);
  } catch (error) {
    obs?.warn('Thumbnail R2 cleanup failed on content delete', {
      context: 'content-delete-thumbnail',
      contentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
