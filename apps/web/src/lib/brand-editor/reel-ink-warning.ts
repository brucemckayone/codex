/**
 * Whether the brand's ink colour can keep its floor over the Showreel's
 * footage (Codex-1yd58 WP-9): the editor's warning, judged as the reel judges
 * a word. A word the reel draws in the brand's colour (a link, an outline
 * button's label) sits on a scrim of the brand's own ground, so the best it
 * can do over any frame is its ratio on that ground. Below the floor no
 * shade carries it, and the reel's 'reel-edge' decides what happens: Shadow
 * lifts the colour just enough over footage, Outline keeps it and rings it.
 *
 * The ratio is the reel's own (`contrast` in reel-scrim.ts), never a copy, so
 * the editor and the reel agree on every colour.
 */
import { contrast, type Rgb } from '$lib/org-hero/showreel/reel-scrim';
import { hexToSrgb } from './oklch-math';

/** The floor of the reel's body-size words (its `ratioOf`: 4.5, large 3). */
export const REEL_BODY_FLOOR = 4.5;

export interface ReelInkWarning {
  /**
   * The ink's ratio on the ground, to two places as the reel's notes give it
   * (OBB's red: 3.75), but never rounded up to the floor it misses.
   */
  readonly ratio: number;
  readonly floor: number;
}

const rgbOf = (hex: string | null): Rgb | null => {
  const srgb = hex ? hexToSrgb(hex) : null;
  return srgb ? [srgb.r, srgb.g, srgb.b] : null;
};

/**
 * The warning for `ink` on `ground` (hex colours), or null when it keeps its
 * floor, or when either colour is unset (the page derives it, so there is
 * nothing of the brand's to judge).
 */
export function reelInkWarning(
  ink: string | null,
  ground: string | null
): ReelInkWarning | null {
  const inkRgb = rgbOf(ink);
  const groundRgb = rgbOf(ground);
  if (!inkRgb || !groundRgb) return null;
  const ratio = contrast(inkRgb, groundRgb);
  if (ratio >= REEL_BODY_FLOOR) return null;
  const rounded = Math.round(ratio * 100) / 100;
  return {
    ratio: rounded < REEL_BODY_FLOOR ? rounded : Math.floor(ratio * 100) / 100,
    floor: REEL_BODY_FLOOR,
  };
}
