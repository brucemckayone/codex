/**
 * Which film a press plays (owner P10, "Full film unless it's paid").
 *
 * The full film when the server marked the clip `fullFilm` and the page can
 * ask for one (`requestFilm`, absent on the canvas); the 30-second preview
 * otherwise, and whenever asking fails — a `null` (the film may not play in
 * full), a rejection, an empty address, or a throw. The visitor pressed
 * play: they always get a film.
 *
 * Called in the press's own tick and handed to the player as it mounts, so
 * the player's `play()` unlocks the `<video>` before anything awaits the
 * answer (`components/player/start.ts`). Nothing is asked on page load.
 *
 * A full film is its whole signed answer, `expiresAt` and all, so the
 * player can ask again before its links run out (`filmRenewal`).
 */
import type { PreviewMedia, SalesFilm } from '../../render/types';
import type { FullFilm, KitPageContext } from '../page-context';

/** The preview's address, or the full film once the page answers. */
export type FilmSource = string | Promise<string | FullFilm>;

export function filmSource(
  clip: PreviewMedia,
  film: SalesFilm | undefined,
  requestFilm: KitPageContext['requestFilm']
): FilmSource {
  const preview = clip.playlistUrl;
  if (!clip.fullFilm || !film || !requestFilm) return preview;
  try {
    return requestFilm(film).then(
      (full) => (full?.playlistUrl ? full : preview),
      () => preview
    );
  } catch {
    return preview;
  }
}

/**
 * How a playing full film asks again as its links run out (the player's
 * RENEWAL): the same question, settled, so a rejection or a throw answers
 * `null` and the film ends where it stands. `undefined` when no full film
 * can be asked for: a preview is public and never renewed.
 */
export function filmRenewal(
  clip: PreviewMedia,
  film: SalesFilm | undefined,
  requestFilm: KitPageContext['requestFilm']
): (() => Promise<FullFilm | null>) | undefined {
  if (!clip.fullFilm || !film || !requestFilm) return undefined;
  return async () => {
    try {
      return await requestFilm(film);
    } catch {
      return null;
    }
  };
}
