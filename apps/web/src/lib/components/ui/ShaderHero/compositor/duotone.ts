/**
 * The duotone surface's three stops: the footage's light mapped from the
 * brand's dark, through its primary, to a pale of the primary. Worked out here,
 * once a frame, so the rule is under test; the pass
 * (`effects/surface-duotone.ts`) only blends between them.
 *
 * Never literal black or white: every channel of every stop stays within
 * `DUOTONE_FLOOR` of the extremes. A primary near black or white (Mono's
 * #000 and #FFF) would make the middle stop an extreme and flatten half the
 * picture's light, so its middle is drawn to mid-grey. PURE.
 */
import { clamp01 } from '../clamp';

export type Rgb = readonly [number, number, number];

/** How near black or white any stop may come. */
export const DUOTONE_FLOOR = 0.04;
/** A ground at or under this light is dark enough to be the dark stop. */
const DARK_GROUND = 0.18;
/** How far toward white the pale stop is. */
const PALE = 0.78;

const luma = ([r, g, b]: Rgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function smoothstep(lo: number, hi: number, x: number): number {
  const t = clamp01((x - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const held = (c: Rgb): Rgb => {
  const one = (v: number) =>
    Math.min(1 - DUOTONE_FLOOR, Math.max(DUOTONE_FLOOR, v));
  return [one(c[0]), one(c[1]), one(c[2])];
};

/**
 * How near black or white a colour is, 0-1: by its brightest channel (black)
 * and its dimmest (white), so a saturated blue, low in light but bright in
 * its own channel, is neither.
 */
function extremeness(c: Rgb): number {
  const nearBlack = 1 - smoothstep(0.05, 0.2, Math.max(...c));
  const nearWhite = smoothstep(0.8, 0.95, Math.min(...c));
  return Math.max(nearBlack, nearWhite);
}

/** The dark, the middle and the pale stop, for this brand. */
export function duotoneStops(primary: Rgb, ground: Rgb): [Rgb, Rgb, Rgb] {
  const mid = mix(primary, [0.5, 0.5, 0.5], extremeness(primary));
  // The ground is the dark when it is dark; a light ground would turn the
  // picture's light over, so a deep of the middle instead.
  const deep: Rgb =
    luma(ground) <= DARK_GROUND
      ? ground
      : [
          mid[0] * mid[0] * 0.57,
          mid[1] * mid[1] * 0.57,
          mid[2] * mid[2] * 0.57,
        ];
  const pale = mix(mid, [1, 1, 1], PALE);
  return [held(deep), held(mid), held(pale)];
}
