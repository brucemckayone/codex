/**
 * The stage: where the piece's film sits on the canvas (Codex-1yd58.4; the
 * fixed stage decided by the WP-1 spike, variant C).
 *
 * A film composited at the hero box's LIVE position trails the words by a
 * frame on a phone (the page scrolls on the compositor thread; the canvas
 * draws from a frame-old rect). So the frame's place is read on layout and
 * resize only, as `r.top + scrollY` (its place in the document, which no
 * scroll lag changes), and held in WINDOW space inside the fixed page
 * canvas: the words scroll over a film that holds still and fades as the
 * hero leaves. Only the fade reads the scroll, and a fade a frame late is
 * invisible. Assumes the canvas is fixed to the window (the org layout's).
 *
 * All PURE, so the arithmetic is under test; WP-5's Showreel calls
 * `setStage` with a box from `stageBoxFrom`.
 */
import type { FilmFrameId, ReelSurface } from './effects/ids';

type Vec2 = readonly [number, number];

/** What a film frame can show: the piece's video, or its still. */
export type StageMedia = HTMLVideoElement | HTMLImageElement;

/**
 * Where the film gives way to the brand's picture (the v4 mock's bands):
 * 'under', the smoke takes its foot, the brightest smoke last; 'fade', its
 * foot fades out evenly; 'edges', 'fade' and its sides and top give way
 * through the same smoke edge, so the picture frames the film all round.
 */
export type FilmBand = 'none' | 'under' | 'fade' | 'edges';

/**
 * How far the reel has played the piece on show, in seconds, read once a
 * frame. It holds while the reel holds (paused, held, off screen), where the
 * page's own clock runs on (WP-5b review M2).
 */
export type PieceSeconds = () => number;

/**
 * How the Showreel shows its film (WP-5): which film frame (its layout's),
 * and its band. WP-5b adds what is drawn on the piece's own picture first:
 * a surface over the footage (`reel-surface`; none when absent) and the
 * stills' push-in (`reel-push`), driven by the reel's clock: off when absent
 * or null.
 */
export interface FilmLook {
  readonly frame: FilmFrameId;
  readonly band: FilmBand;
  readonly surface?: ReelSurface | 'none';
  readonly push?: PieceSeconds | null;
}

/**
 * The push-in's numbers, here with the look so the page's own copy of the
 * film (ReelStage, where the canvas cannot draw) pushes in by the very curve
 * the compositor's `media-push` does, without the compositor in the page's
 * first load (it is imported only when a canvas will draw).
 */
/** How long a picture takes to push in: one piece (`reel-clock` PIECE_MS). */
export const PUSH_SECONDS = 7;
/** How far it is drawn in by then: 8% (the v4 mock's and the 5b board's). */
export const PUSH_DEPTH = 0.08;

/** The push-in's zoom `elapsed` seconds into a piece: eased out, then held. */
export function pushZoom(elapsed: number): number {
  const t = Math.min(1, Math.max(0, elapsed / PUSH_SECONDS));
  return 1 + PUSH_DEPTH * (1 - (1 - t) * (1 - t));
}

/** The band as the film frame reads it (`u_band`). */
export const BAND_CODE: Record<FilmBand, number> = {
  none: 0,
  under: 1,
  fade: 2,
  edges: 3,
};

/**
 * Where the band gives way, down the stage, as fractions of its height from
 * the top. These are the v4 mock's ramps moved a tenth lower (owner,
 * 2026-11-20: the footage felt "cramped"), so the film keeps the open frame
 * and gives way behind the words and the index. ReelStage's stills' masks
 * use the same numbers.
 */
export function bandRamp(
  band: FilmBand,
  phone: boolean
): readonly [number, number] {
  if (band === 'under') return phone ? [0.38, 0.76] : [0.4, 0.82];
  return phone ? [0.44, 0.84] : [0.5, 0.95];
}
/** x, y, width, height in output pixels, origin bottom left (GL's). */
export type RectPx = readonly [number, number, number, number];

/** The frame's place in the document, CSS px, and how far the hero fades. */
export interface StageBox {
  readonly left: number;
  /** Document space: the frame's top with the page scrolled to the top. */
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** Scrolled this far, the film has faded out. */
  readonly fadeDistance: number;
}

/** A box from a frame's client rect, measured at `scrollY`. */
export function stageBoxFrom(
  rect: { left: number; top: number; width: number; height: number },
  scrollY: number,
  fadeDistance: number
): StageBox {
  return {
    left: rect.left,
    top: rect.top + scrollY,
    width: rect.width,
    height: rect.height,
    fadeDistance,
  };
}

/**
 * The stage in the canvas's output pixels, origin bottom left: the box held
 * where it sits with the page at the top (the spike's `rectIn`, variant C).
 */
export function stageRect(
  stage: StageBox,
  canvas: { left: number; bottom: number; width: number; height: number },
  outW: number,
  outH: number
): RectPx {
  const sx = canvas.width > 0 ? outW / canvas.width : 0;
  const sy = canvas.height > 0 ? outH / canvas.height : 0;
  return [
    (stage.left - canvas.left) * sx,
    (canvas.bottom - stage.top - stage.height) * sy,
    stage.width * sx,
    stage.height * sy,
  ];
}

/** How much of the film shows at `scrollY`: 1 at the top, 0 once faded. */
export function stageFade(scrollY: number, fadeDistance: number): number {
  if (!(fadeDistance > 0)) return scrollY > 0 ? 0 : 1;
  return Math.min(1, Math.max(0, 1 - scrollY / fadeDistance));
}

/**
 * How far a scroll takes the canvas's letters out, in CSS px (owner,
 * 2026-11-21, the scroll fix's (c)). The name mask is held in window space
 * with the stage, so a scrolled letter sits that far below the word the page
 * scrolled away: legible as a second title. Gone within this span, a letter
 * is never further off than it (plus a frame's scroll at a fling: the fade
 * reads a frame-old `scrollY`, which a fade hides), and the page's own glyphs
 * take the name back over the same span (the Showreel's ink).
 */
export const NAME_FADE_PX = 32;

/** How much of the canvas's letters show at `scrollY`: 1 at the top, 0 from `NAME_FADE_PX`. */
export function nameFade(scrollY: number): number {
  return Math.min(1, Math.max(0, 1 - scrollY / NAME_FADE_PX));
}

/**
 * Whether any of the film shows. Culling: when it does not (faded out, or
 * off the canvas), the compositor neither samples nor uploads the media.
 */
export function stageVisible(
  rect: RectPx,
  outW: number,
  outH: number,
  fade: number
): boolean {
  const [x, y, w, h] = rect;
  return (
    fade > 0 && w > 0 && h > 0 && x < outW && y < outH && x + w > 0 && y + h > 0
  );
}

/**
 * Cover-map a point inside a rect (0-1) onto media of the given size, as CSS
 * `object-fit: cover` does: the media fills the rect and its overflow is cut
 * evenly from both sides. The twin of the GLSL `coverUv` in
 * `effects/header.ts`; change them together.
 */
export function coverUv(local: Vec2, rectPx: Vec2, mediaPx: Vec2): Vec2 {
  const ra = rectPx[0] / Math.max(rectPx[1], 1);
  const ma = mediaPx[0] / Math.max(mediaPx[1], 1);
  if (ra <= 0 || ma <= 0) return local;
  if (ma > ra) return [0.5 + ((local[0] - 0.5) * ra) / ma, local[1]];
  return [local[0], 0.5 + ((local[1] - 0.5) * ma) / ra];
}
