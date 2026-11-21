/**
 * The frame rule (WP-5b, owner 2026-11-21): a portrait film or picture that
 * filling the stage would crop by more than 40% (a 9:16 preview on a desktop
 * screen; Of Blood & Bones' 720x1280 previews and 1200x1500 stills both) is
 * not cropped. It sits flush right at the stage's full height and its left
 * edge fades into the brand's picture (`effects/frame-film-portrait.ts`).
 * Desktop only: a phone's stage is portrait, so its film fills. Automatic,
 * with no setting of its own (owner, 2026-11-19, Q2).
 *
 * PURE, so the rule is under test without a GL context.
 */
import {
  FILM_FILL_FRAME,
  FILM_PORTRAIT_FRAME,
  type FilmFrameId,
} from './effects/ids';

type Size = readonly [number, number];

/** Filling past this share cropped, a portrait piece is placed instead. */
export const PORTRAIT_CROP = 0.4;

/** The share of the media that covering the rect cuts away, 0-1. */
export function coverCrop(rect: Size, media: Size): number {
  const [rw, rh] = rect;
  const [mw, mh] = media;
  if (!(rw > 0 && rh > 0 && mw > 0 && mh > 0)) return 0;
  const ra = rw / rh;
  const ma = mw / mh;
  return 1 - Math.min(ra / ma, ma / ra);
}

/**
 * The film frame drawn for the look's `frame` with this media in this
 * stage: `film-fill` gives way to `film-portrait` on a desktop for a piece
 * narrower than the stage that filling would crop past `PORTRAIT_CROP`. A
 * wide piece (a banner) always fills: placed at the stage's height it would
 * overflow it. Every other frame is kept.
 */
export function placedFrame(
  frame: FilmFrameId,
  rect: Size,
  media: Size,
  phone: boolean
): FilmFrameId {
  if (frame !== FILM_FILL_FRAME || phone) return frame;
  const narrower =
    media[0] / Math.max(media[1], 1) < rect[0] / Math.max(rect[1], 1);
  return narrower && coverCrop(rect, media) > PORTRAIT_CROP
    ? FILM_PORTRAIT_FRAME
    : frame;
}
