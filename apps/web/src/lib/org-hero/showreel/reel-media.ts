/**
 * What the Showreel's stage plays for each entry: its still
 * (always, when it has one: the poster under the footage, the picture on the
 * static and Save-Data paths) and its footage (a preview, silently).
 */
import { getThumbnailUrl } from '$lib/utils/image';
import type { ReelEntry } from '../reel';
import type { ReelMode } from './playback';

export interface ReelMedia {
  still: string | null;
  /** The HLS preview to loop; null when this entry or this mode shows a still. */
  footage: string | null;
}

export function reelMedia(entry: ReelEntry, mode: ReelMode): ReelMedia {
  const plays = mode === 'footage' && entry.show === 'footage';
  if (entry.type === 'film') {
    const { posterUrl, previewUrl } = entry.film;
    return {
      still: posterUrl ? getThumbnailUrl(posterUrl, 'lg') : null,
      footage: plays ? previewUrl : null,
    };
  }
  return {
    still: entry.piece.imageUrl,
    footage: plays ? entry.piece.previewUrl : null,
  };
}
