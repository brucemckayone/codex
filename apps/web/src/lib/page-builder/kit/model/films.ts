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
import type { SellPreview } from '../../render/types';

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
