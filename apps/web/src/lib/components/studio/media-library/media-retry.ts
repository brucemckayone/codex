/**
 * A failed item's Try again (Codex-l2c48.7), from its tile or its list row
 * (Codex-a6ofh.1.6). A refusal (the state moved, no tries left, rate
 * limited) is a 4xx this reads; the outcome of the retry itself arrives over
 * the live socket. Never rejects: every failure is logged and told.
 */

import { mediaStatus } from '$lib/client/media-status.svelte';
import { describeThrown } from '$lib/client-log';
import { toast } from '$lib/components/ui/Toast/toast-store';
import { logger } from '$lib/observability';
import { retryTranscoding } from '$lib/remote/media.remote';
import { remoteErrorStatus } from '$lib/remote/query-result';
import * as m from '$paraglide/messages';

export async function retryMediaTranscoding(mediaId: string): Promise<void> {
  try {
    await retryTranscoding(mediaId);
    // What happens next arrives over the socket; without one, the list
    // (and its refetch drops the held `failed` the item still shows).
    // Paused, the creator's Try again asks to watch it: start again.
    if (mediaStatus.connection === 'paused') mediaStatus.resume('action');
    else if (mediaStatus.connection !== 'live') mediaStatus.refreshList();
  } catch (error) {
    const status = remoteErrorStatus(error);
    // A 4xx refused this retry (the state moved, no tries left); anything
    // else is an outage, or a network that never answered.
    if (status === undefined || status >= 500) {
      logger.error('media_tile.retry_failed', {
        mediaId,
        ...describeThrown(error),
      });
    } else if (status !== 429) {
      logger.warn('media_tile.retry_refused', {
        mediaId,
        ...describeThrown(error),
      });
    }
    toast.error(
      status === 429
        ? m.media_tile_retry_rate_limited()
        : m.media_tile_retry_failed()
    );
    // A refusal means the item is out of date (another tab, or no tries left).
    mediaStatus.refreshList();
  }
}
