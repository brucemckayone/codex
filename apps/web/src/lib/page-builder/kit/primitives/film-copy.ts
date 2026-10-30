/**
 * Visitor-facing words the kit's films render themselves (`InlineFilm`).
 * They belong in `kit/model/copy.ts` (contract A1) and live here only until
 * that shared file takes them — it is outside the films' own files. The
 * theatre's are paraglide's (`player_*`): it is an app component.
 */
import type { FilmPlays } from '../model/films';

export const FILM_COPY = {
  /** The play button of a film a press plays in full (`filmPressLabel`). */
  watch: 'Watch the film',
  /** The play button of a film a press plays only the preview of. */
  preview: 'Play the preview',
  again: 'Watch again',
  /** Beside the play button when the player's code did not arrive: a press tries again. */
  failed: 'The film could not load. Try again.',
  /**
   * Beside the play button when a full film's links ran out mid-play and no
   * fresh ones came: no end, so no "Watch again". A press starts afresh.
   */
  lapsed: 'The film stopped before its end. Press play to start it again.',
  /** Over the film when the full film was asked for and the preview plays instead. */
  fellBack: 'Playing the preview: the full film could not load.',
} as const;

/**
 * A film block's play button, by what a press plays (`filmPlays`, the rule
 * its line reads): "Watch the film" for the film in full, "Play the
 * preview" for its preview, so the button never promises a film the press
 * will not play.
 */
export function filmPressLabel(plays: FilmPlays | null): string {
  return plays?.full ? FILM_COPY.watch : FILM_COPY.preview;
}
