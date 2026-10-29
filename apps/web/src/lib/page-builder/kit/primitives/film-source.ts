/**
 * Which film a press plays (owner P10, "Full film unless it's paid").
 *
 * The full film when the server marked the clip `fullFilm` and the page can
 * ask for one (`requestFilm`, absent on the canvas); the 30-second preview
 * otherwise, and whenever asking fails. The rule itself is the player's
 * (`components/player/press-source.ts`), shared with the org landing's
 * intro film; this says when a sales page's clip may ask.
 *
 * A full film is its whole signed answer, `expiresAt` and all, so the
 * player can ask again before its links run out (`filmRenewal`).
 */
import {
  type AskForFull,
  type PressSource,
  pressRenewal,
  pressSource,
} from '$lib/components/player/press-source';
import type { PreviewMedia, SalesFilm } from '../../render/types';
import type { FullFilm, KitPageContext } from '../page-context';

/** The preview's address, or the full film once the page answers. */
export type FilmSource = PressSource;

/** How this clip asks for its full film, or `undefined` when it may not. */
function askFor(
  clip: PreviewMedia,
  film: SalesFilm | undefined,
  requestFilm: KitPageContext['requestFilm']
): AskForFull | undefined {
  if (!clip.fullFilm || !film || !requestFilm) return undefined;
  return () => requestFilm(film);
}

export function filmSource(
  clip: PreviewMedia,
  film: SalesFilm | undefined,
  requestFilm: KitPageContext['requestFilm']
): FilmSource {
  return pressSource(clip.playlistUrl, askFor(clip, film, requestFilm));
}

/**
 * How a playing full film asks again as its links run out (the player's
 * RENEWAL). `undefined` when no full film can be asked for: a preview is
 * public and never renewed.
 */
export function filmRenewal(
  clip: PreviewMedia,
  film: SalesFilm | undefined,
  requestFilm: KitPageContext['requestFilm']
): (() => Promise<FullFilm | null>) | undefined {
  return pressRenewal(askFor(clip, film, requestFilm));
}
