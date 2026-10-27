/**
 * Media helpers for e2e tests
 */

import { dbHttp, schema } from '@codex/database';
import { eq } from 'drizzle-orm';

/** What a finished transcode leaves on a video's row. */
interface TranscodedVideo {
  hlsMasterPlaylistKey: string;
  thumbnailKey: string;
  durationSeconds: number;
  width?: number;
  height?: number;
}

/**
 * Mark a video ready the way the RunPod completion webhook does: by writing
 * the transcode's outputs to its row. PATCH /api/media/:id takes only the
 * creator's title and description (Codex-l2c48.9), so a test that needs
 * playable media stands in for the transcode here.
 *
 * The database refuses a ready video without HLS, a thumbnail and a duration
 * (status_ready_requires_keys), so all three are required, and an unknown id
 * throws: a setup step that did not happen must fail the test.
 */
export async function markVideoReady(
  mediaId: string,
  outputs: TranscodedVideo
) {
  const [row] = await dbHttp
    .update(schema.mediaItems)
    .set({ status: 'ready', ...outputs, updatedAt: new Date() })
    .where(eq(schema.mediaItems.id, mediaId))
    .returning();
  if (!row) throw new Error(`markVideoReady: no media item ${mediaId}`);
  return row;
}
