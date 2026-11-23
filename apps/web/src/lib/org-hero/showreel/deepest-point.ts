/**
 * Where a dive into the org's name falls in: the middle of the name's thickest
 * stroke, so the view always lands inside a letter and the zoomed letter fills
 * the screen.
 *
 * Read from a small copy of the name mask on the CPU (a 2D canvas, once per
 * mask), never from the GPU. A chamfer distance transform gives each pixel
 * of the letters its distance to the nearest pixel outside them; the
 * deepest is the centre of the stroke's widest inscribed circle.
 */

/** A point of the name, in output uv (origin bottom left). */
export interface NamePoint {
  readonly x: number;
  readonly y: number;
  /** The inscribed circle's radius, as a fraction of the output's height. */
  readonly radius: number;
}

/** Chamfer weights (3-4) for a step across and a step diagonal. */
const ACROSS = 3;
const DIAGONAL = 4;

export interface MaskPixels {
  /** RGBA, row by row from the top (`ImageData.data`). */
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
}

/** A distance field over the mask: 0 outside the letters. */
interface Field {
  readonly d: Float32Array;
  readonly w: number;
  readonly h: number;
}

/** The letters as `big` and the rest 0, with the letters' centroid. */
function seed(mask: MaskPixels, threshold: number, big: number) {
  const { data, width: w, height: h } = mask;
  const d = new Float32Array(w * h);
  let inside = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < w * h; i++) {
    if ((data[i * 4] ?? 0) < threshold) continue;
    d[i] = big;
    inside++;
    cx += i % w;
    cy += Math.floor(i / w);
  }
  return { field: { d, w, h }, inside, cx: cx / inside, cy: cy / inside };
}

/** The field at (x, y); beyond the image is outside the letters. */
function at({ d, w, h }: Field, x: number, y: number): number {
  return x < 0 || y < 0 || x >= w || y >= h ? 0 : (d[y * w + x] ?? 0);
}

/** One chamfer sweep: forward (`step` 1) from the top left, or back. */
function sweep(field: Field, step: 1 | -1): number {
  const { d, w, h } = field;
  let deepest = 0;
  for (let n = 0; n < w * h; n++) {
    const i = step === 1 ? n : w * h - 1 - n;
    const now = d[i] ?? 0;
    if (now === 0) continue;
    const x = i % w;
    const y = Math.floor(i / w);
    const v = Math.min(
      now,
      at(field, x - step, y) + ACROSS,
      at(field, x, y - step) + ACROSS,
      at(field, x - step, y - step) + DIAGONAL,
      at(field, x + step, y - step) + DIAGONAL
    );
    d[i] = v;
    if (v > deepest) deepest = v;
  }
  return deepest;
}

/** The point at least 98% as deep as `deepest` that is nearest (cx, cy). */
function nearestDeep(
  { d, w }: Field,
  deepest: number,
  cx: number,
  cy: number
): number {
  let best = 0;
  let bestGap = Number.POSITIVE_INFINITY;
  for (let i = 0; i < d.length; i++) {
    if ((d[i] ?? 0) < deepest * 0.98) continue;
    const gap = Math.hypot((i % w) - cx, Math.floor(i / w) - cy);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return best;
}

/**
 * The deepest point of the letters (red at or over `threshold`), or null
 * when the mask has no letters. Near-ties go to the point nearest the
 * letters' centroid, so the dive falls into the middle of the name. PURE.
 */
export function deepestPoint(
  mask: MaskPixels,
  threshold = 128
): NamePoint | null {
  const { width: w, height: h } = mask;
  if (w <= 0 || h <= 0) return null;
  const { field, inside, cx, cy } = seed(mask, threshold, (w + h) * DIAGONAL);
  if (inside === 0) return null;
  sweep(field, 1);
  const deepest = sweep(field, -1);
  const best = nearestDeep(field, deepest, cx, cy);
  return {
    x: ((best % w) + 0.5) / w,
    y: 1 - (Math.floor(best / w) + 0.5) / h,
    radius: deepest / ACROSS / h,
  };
}

/** The deepest a dive goes, and the least. */
const MAX_DEPTH = 160;
const MIN_DEPTH = 4;

/**
 * How far a dive into `point` zooms (`u_nameZoom` at its end) so the letter
 * covers the whole output, `aspect` (width / height) wide, with a margin.
 */
export function diveDepth(point: NamePoint, aspect: number): number {
  let far = 0;
  for (const [x, y] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const)
    far = Math.max(far, Math.hypot((x - point.x) * aspect, y - point.y));
  const depth = (1.1 * far) / Math.max(point.radius, 1e-4);
  return Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, depth));
}
