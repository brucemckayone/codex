/**
 * The drawer's facts row (Codex-a6ofh.1.7, mockup M3): duration,
 * resolution, size, variants, loudness and date, each only when known.
 */

import type { MediaItemWithRelations } from '$lib/types';
import { formatDate, formatDuration, formatFileSize } from '$lib/utils/format';
import * as m from '$paraglide/messages';

export interface MediaFact {
  label: string;
  value: string;
}

export function mediaFacts(media: MediaItemWithRelations): MediaFact[] {
  const facts: MediaFact[] = [];
  const duration = formatDuration(media.durationSeconds);
  if (duration) facts.push({ label: m.media_col_duration(), value: duration });
  if (media.width && media.height) {
    facts.push({
      label: m.media_fact_resolution(),
      value: `${media.width}×${media.height}`,
    });
  }
  const size = formatFileSize(media.fileSizeBytes);
  if (size) facts.push({ label: m.media_col_size(), value: size });
  if (media.readyVariants?.length) {
    facts.push({
      label: m.media_fact_variants(),
      value: media.readyVariants.join(' · '),
    });
  }
  // Stored as LUFS × 100 (the transcoder's integer).
  if (media.loudnessIntegrated != null) {
    facts.push({
      label: m.media_fact_loudness(),
      value: m.media_fact_lufs({
        value: (media.loudnessIntegrated / 100).toFixed(1),
      }),
    });
  }
  if (media.createdAt)
    facts.push({
      label: m.media_col_added(),
      value: formatDate(media.createdAt),
    });
  return facts;
}
