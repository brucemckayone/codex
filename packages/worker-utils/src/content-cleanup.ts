/**
 * Content asset cleanup on delete (Codex-ko8ko), shared by every worker that
 * deletes a piece: content-api's creator deletes and admin-api's org delete
 * and takedown (Codex-a6ofh.6).
 *
 * Soft-deleting a content row must not strand its thumbnail's R2 objects.
 * `ImageProcessingService.deleteContentThumbnail` deletes the folder the
 * row's thumbnail URL names and records orphans for the hourly
 * `OrphanedFileCleanupDO` sweep on an R2 failure. This helper guarantees a
 * cleanup hiccup can never fail the delete itself.
 */

import type { Logger } from '@codex/observability';

/** The single ImageProcessingService method this helper depends on. */
export interface ThumbnailCleaner {
  deleteContentThumbnail(contentId: string, creatorId: string): Promise<void>;
}

/**
 * Best-effort deletion of a content item's thumbnail R2 objects once the
 * row is deleted (never while it is leaving: its owners still see the cover).
 *
 * ALWAYS resolves: any error is swallowed and logged, so the soft-delete (the
 * primary operation, already committed) never answers 500 for it. The
 * service comes as a getter (`() => ctx.services.imageProcessing`) so one
 * that cannot be built, a worker missing its R2 config, is logged here too
 * rather than thrown at the caller. On an R2 failure `deleteContentThumbnail`
 * itself records orphans for the deferred sweep, so nothing leaks for good.
 */
export async function cleanupContentThumbnailOnDelete(
  imageProcessing: () => ThumbnailCleaner,
  contentId: string,
  creatorId: string,
  obs?: Pick<Logger, 'warn'>
): Promise<void> {
  try {
    await imageProcessing().deleteContentThumbnail(contentId, creatorId);
  } catch (error) {
    obs?.warn('Thumbnail R2 cleanup failed on content delete', {
      context: 'content-delete-thumbnail',
      contentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
