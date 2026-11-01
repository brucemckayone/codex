/**
 * A focal point on a course still (Codex-61zsk.73): the hero's course still
 * or clip poster, the guide's portrait and the intro film's poster. These
 * are the journey's media, not page images, so there is no `ImageRef` to
 * carry the point (`page-images.ts`); it is kept in the section's own props
 * as `stillFocus`, saved with the page like an upload's.
 *
 * A point belongs to the still it was set on: `of` names that still, and a
 * section that now draws a different one is drawn from the centre until a
 * new point is set, so a point never steers the wrong picture. Like an
 * upload's, the centre is never stored. Practice thumbnails stay centred:
 * they are small, and there are many of them.
 */
import { storedFocus } from '../../page-images';
import type { PageStyleId } from './ids';
import type { StillCrop } from './types';

/** The prop every section that draws a still keeps its point under. */
export const STILL_FOCUS_KEY = 'stillFocus';

/** A point in whole percent across and down, and the still it was set on. */
export interface StillFocus {
  x: number;
  y: number;
  /** The still's key ({@link stillKey}). */
  of: string;
}

/** Longer than any media key the platform writes; a pasted document is not one. */
const MAX_KEY = 500;

/**
 * A still's identity: its key, the URL's path without the CDN's origin or
 * its size file (`/{sm|md|lg|xl}.webp`). Every size of one still, and every
 * read that resolves it (the awaited view, the streamed preview, the editor),
 * is then the same picture. `null` for no URL.
 */
export function stillKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const key = url
    .replace(/[?#].*$/, '')
    .replace(/^(?:[a-z][a-z\d+.-]*:)?\/\/[^/]*/i, '')
    .replace(/^\/+/, '')
    .replace(/\/(?:sm|md|lg|xl)\.webp$/, '');
  return key || null;
}

/**
 * The stored point, read tolerantly (the props are creator-authored jsonb,
 * never trusted): rounded to whole percent and clamped to the frame, as an
 * upload's is. Absent for anything malformed, for a point with no still to
 * belong to, and for the centre, which a picture with no point gets anyway.
 */
export function readStillFocus(raw: unknown): StillFocus | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { x, y, of } = raw as Record<string, unknown>;
  if (typeof of !== 'string' || !of || of.length > MAX_KEY) return undefined;
  // The same rounding and clamping as an upload's point: `of` is a key too.
  const point = storedFocus({ key: of, focus: { x, y } });
  return point ? { ...point, of } : undefined;
}

/**
 * The point to crop `still` around, for `Media`'s `focus`: the stored one
 * when it was set on this still, otherwise `undefined`, the centre, which
 * draws exactly as a still did before points.
 */
export function stillFocusFor(
  stored: StillFocus | undefined,
  still: string | null | undefined
): { x: number; y: number } | undefined {
  if (!stored || stillKey(still) !== stored.of) return undefined;
  return { x: stored.x, y: stored.y };
}

/**
 * What to store for a point placed on `still`: the point and the still's
 * key, or `undefined` for the centre (and for no still), which removes it.
 */
export function placeStillFocus(
  still: string | null | undefined,
  point: { x: number; y: number } | undefined
): StillFocus | undefined {
  const of = stillKey(still);
  return point && of ? { x: point.x, y: point.y, of } : undefined;
}

/**
 * The shapes `layout` cuts the still to in `style`: a crop one Style alone
 * cuts (Bold's wide theatre) is left out of the others, where the layout
 * shows the still whole and the control explains itself instead.
 */
export function stillCrops(
  focalLayouts: Readonly<Record<string, readonly StillCrop[]>>,
  layout: string,
  style: PageStyleId
): StillCrop[] {
  return (focalLayouts[layout] ?? []).filter(
    (crop) => !crop.styles || crop.styles.includes(style)
  );
}
