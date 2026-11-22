/**
 * The frame rule: a PORTRAIT film or picture (taller than wide: OBB's 720x1280
 * previews and 1200x1500 stills) on a landscape-shaped stage, that filling
 * would crop by more than 40%, is placed instead: flush right at the stage's
 * full height, `PORTRAIT_MIN_WIDTH` of the stage's width (a film and a
 * picture alike), cover-cropped about its centre, so its top and bottom are
 * trimmed and it is never stretched. Its left fifth fades into the brand's
 * picture, and no band gives way at its foot (`effects/frame-film-portrait.ts`).
 *
 * The stage's shape decides, not the device: a phone held sideways places it
 * too; one held upright has a portrait stage, which crops it little, so it
 * fills. A square or landscape piece always fills: the rule is for portrait
 * pieces only. Automatic, with no setting of its own.
 *
 * `placedRect` is the one place the rect is worked out: the compositor's
 * uniforms, the size its treated picture is drawn at, and the words' fit over
 * the footage all read it, so they agree. PURE, so the rule is under test
 * without a GL context.
 */
import {
  FILM_FILL_FRAME,
  FILM_PORTRAIT_FRAME,
  type FilmFrameId,
  type FrameId,
} from './effects/ids';

type Size = readonly [number, number];

/** Filling past this share cropped, a portrait piece is placed instead. */
export const PORTRAIT_CROP = 0.4;

/**
 * The least width a placed piece is drawn at, as a share of the stage's
 * width: a film and a picture alike. Placing needs filling to crop past
 * `PORTRAIT_CROP`, so a placed piece's own width at the stage's height is
 * under 60%, and every placed piece is drawn exactly this wide.
 */
export const PORTRAIT_MIN_WIDTH = 0.62;

/** The share of a placed piece's width its left edge fades in over. */
export const PORTRAIT_LEAD = 0.2;

/**
 * Where a placed piece is drawn on the stage, as shares of the stage's width
 * and height (x from the left, y from the top), and how much of it is cut.
 */
export interface PlacedRect {
  /** Its left edge, where its fade (`PORTRAIT_LEAD` of its width) starts. */
  readonly x0: number;
  /** Its right edge: flush with the stage's. */
  readonly x1: number;
  /** Its top and bottom: the stage's full height. */
  readonly y0: number;
  readonly y1: number;
  /**
   * The share of the piece's height trimmed away, half off its top and half
   * off its bottom: a stage point at height y shows the piece's
   * `0.5 + (y - 0.5) * (1 - crop)`.
   */
  readonly crop: number;
}

/** The share of the media that covering the rect cuts away, 0-1. */
export function coverCrop(rect: Size, media: Size): number {
  const [rw, rh] = rect;
  const [mw, mh] = media;
  if (!(rw > 0 && rh > 0 && mw > 0 && mh > 0)) return 0;
  const ra = rw / rh;
  const ma = mw / mh;
  return 1 - Math.min(ra / ma, ma / ra);
}

/** Whether filling `rect` with `media` gives way to placing it: a portrait
 *  piece on a landscape stage, cropped past `PORTRAIT_CROP`. */
function places(rect: Size, media: Size): boolean {
  const portrait = media[1] > media[0];
  const landscape = rect[0] > rect[1];
  return portrait && landscape && coverCrop(rect, media) > PORTRAIT_CROP;
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
  return places(rect, media) ? FILM_PORTRAIT_FRAME : frame;
}

/**
 * Where this media is drawn in a stage of this size (any unit: only the
 * shapes count) under the frame `frame` (a look's, or the one `placedFrame`
 * chose), or null when it is not placed: `film-fill` fills the stage with
 * it, and every other frame (the name window's among them) never places.
 * Flush right at the stage's full height, `PORTRAIT_MIN_WIDTH` wide or its
 * own width if wider, and the height that width cuts trimmed about its
 * centre.
 */
export function placedRect(
  frame: FrameId,
  stage: Size,
  media: Size
): PlacedRect | null {
  const placing = frame === FILM_FILL_FRAME || frame === FILM_PORTRAIT_FRAME;
  if (!placing || !places(stage, media)) return null;
  const natural = (stage[1] * media[0]) / media[1] / stage[0];
  const width = Math.min(1, Math.max(natural, PORTRAIT_MIN_WIDTH));
  return { x0: 1 - width, x1: 1, y0: 0, y1: 1, crop: 1 - natural / width };
}
