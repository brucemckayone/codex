/**
 * Whether a visitor's page has a film to show (Codex-61zsk.40, .57): the one
 * rule the Video and Preview sections, a Button that plays the preview, and
 * the page's fold all read, so the band rules and the block that hides itself
 * cannot disagree.
 *
 *   true       the film is here
 *   false      none is coming: the awaited view says none is attached, or the
 *              stream settled without one (or failed)
 *   undefined  one is on its way: draw its place
 *
 * A film that arrives although none was attached still shows: the awaited
 * view can lag a film the creator has just attached.
 */
import type { PreviewMedia, SellPreview } from '../../render/types';
import type { KitPageContext } from '../page-context';
import { playsInFull } from '../primitives/film-source';

/** The films a visitor's page can draw, as `SellPreview` names them. */
export type PageFilm = 'intro' | 'reel';

export function filmToShow(
  /** `course.filmsAttached[film]`: `false` when the course certainly has none. */
  attached: boolean | undefined,
  /** `settled(context.sellPreview)`: `undefined` until it settles, `null` if it failed. */
  preview: SellPreview | null | undefined,
  film: PageFilm
): boolean | undefined {
  if (preview?.[film]) return true;
  if (preview !== undefined || attached === false) return false;
  return undefined;
}

/** What a press on a clip plays: the whole film or its preview, and for how long. */
export interface FilmPlays {
  full: boolean;
  /** Seconds, or `null` when the length is not known. */
  seconds: number | null;
}

/**
 * What a press plays, as the Preview and Video lines say it (Codex-61zsk.73),
 * by the landing chip's rule: the whole film when it plays in full, else its
 * preview as the transcoder cuts it. It plays in full by the press's own rule
 * (`playsInFull`), and where the page is only looked at (`still`) as though
 * it could ask, so the canvas names the length the visitor's press will play.
 * An older payload with no `previewSeconds` knows the length only of a film
 * that plays in full.
 */
export function filmPlays(
  clip: PreviewMedia,
  page: Pick<KitPageContext, 'still' | 'requestFilm'>
): FilmPlays {
  const full = page.still
    ? clip.fullFilm === true
    : playsInFull(clip, page.requestFilm);
  const seconds = (full ? clip.durationSeconds : clip.previewSeconds) ?? null;
  return { full, seconds: seconds !== null && seconds > 0 ? seconds : null };
}
