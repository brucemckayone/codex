/**
 * Visitor-facing words the video block renders itself. They belong in
 * `kit/model/copy.ts` (contract A1) and live here only until that shared file
 * takes them — it is outside this block's folder.
 */
import { clock } from '$lib/components/player/timeline';
import type { FilmPlays } from '../../model/films';

export const VIDEO_COPY = {
  watch: 'Watch the film',
} as const;

/**
 * The film's length, as its line says it (Codex-61zsk.73): "2:04" for a
 * film that plays in full, "0:30 preview" for one that plays its preview, so
 * the line never promises a film the press will not play. `undefined` when
 * the length is not known.
 */
export function filmLength(plays: FilmPlays | null): string | undefined {
  if (!plays?.seconds) return undefined;
  const time = clock(plays.seconds);
  return plays.full ? time : `${time} preview`;
}
