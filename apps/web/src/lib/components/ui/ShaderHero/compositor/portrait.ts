/**
 * The frame rule (WP-5b, owner 2026-11-21): a PORTRAIT film or picture
 * (taller than wide: OBB's 720x1280 previews and 1200x1500 stills) on a
 * landscape-shaped stage, that filling would crop by more than 40%, is not
 * cropped. It sits flush right at the stage's full height and its left edge
 * fades into the brand's picture (`effects/frame-film-portrait.ts`).
 *
 * The stage's shape decides, not the device (review L4): a phone held
 * sideways places it too; one held upright has a portrait stage, which
 * crops it little, so it fills. A square or landscape piece always fills
 * (review M3: the owner said portrait). Automatic, with no setting of its
 * own (owner, 2026-11-19, Q2).
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
 * stage: `film-fill` gives way to `film-portrait` for a portrait piece on a
 * landscape stage that filling would crop past `PORTRAIT_CROP`. Every other
 * frame is kept.
 */
export function placedFrame(
  frame: FilmFrameId,
  rect: Size,
  media: Size
): FilmFrameId {
  if (frame !== FILM_FILL_FRAME) return frame;
  const portrait = media[1] > media[0];
  const landscape = rect[0] > rect[1];
  return portrait && landscape && coverCrop(rect, media) > PORTRAIT_CROP
    ? FILM_PORTRAIT_FRAME
    : frame;
}
