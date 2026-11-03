/**
 * The sentence a media item shows under its title: why it waits, stopped or
 * failed (Codex-l2c48.7). The grid tile and the list row both say it
 * (Codex-a6ofh.1.6), so a state is explained the same way in either view.
 */

import { MAX_TRANSCODING_ATTEMPTS } from '@codex/constants';
import { formatDuration } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import type { TileFailure, TileView } from './tile-state';

const FAILURE_TEXT: Record<TileFailure, () => string> = {
  file: () => m.media_tile_failed_file(),
  upload: () => m.media_tile_stopped(),
  exhausted: () =>
    m.media_tile_failed_exhausted({ count: MAX_TRANSCODING_ATTEMPTS }),
  timeout: () => m.media_tile_failed_timeout(),
  internal: () => m.media_tile_failed_internal(),
};

export function tileReason(view: TileView): string | null {
  switch (view.kind) {
    case 'stopped':
      return m.media_tile_stopped();
    case 'waiting':
      if (view.cause === 'config') return m.media_tile_waiting_config();
      if (view.cause === 'transcoder') {
        return view.overdue
          ? m.media_tile_queued_overdue()
          : m.media_tile_queued();
      }
      return view.retryInSeconds
        ? m.media_tile_waiting_service({
            time: formatDuration(view.retryInSeconds),
          })
        : m.media_tile_waiting_service_later();
    case 'failed':
      return FAILURE_TEXT[view.reason]();
    default:
      return null;
  }
}
