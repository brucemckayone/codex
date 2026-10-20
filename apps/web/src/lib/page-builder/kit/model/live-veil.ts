/**
 * The live veil (03 X54): how thin a Style's atmosphere veil may go over the
 * shader actually drawn behind the words.
 *
 * §5.1's veil (0.82 light / 0.86 dark) is proven over pure black and pure
 * white, so it holds over any shader. A Style that lets more of the shader
 * through (`--lp-atmosphere-show`, Studio) can only be MEASURED, and a fixed
 * multiple measured on one shader fails on another: Studio's 1.6 held every
 * line over of-blood-and-bones' 'flow' at rest, but left Studio Alpha's
 * 'glow' (near-black in the light theme) at 3.4:1 for 4.5:1 text, and 'flow'
 * itself fell short once the opening scrolled under the darker top of the
 * window. So the page measures: the org's shader reports the darkest and
 * lightest colour each part of the window has drawn (`ShaderHero`, `tone`),
 * and the veil is the thinnest between the Style's and the proven one at
 * which every ink on it holds its floor, 2% past (the kit's margin), over the
 * cells under the words.
 *
 * The veil composites in encoded sRGB, as the browser does:
 * `out = s · ground + (1 − s) · backdrop`, per channel, so a cell's darkest
 * and lightest composites are its darkest and lightest channels'.
 */

/** An sRGB colour, 0–255 per channel. */
export type Rgb = readonly [number, number, number];

/** A colour drawn on the veil and the contrast it must keep against it. */
export interface VeilInk {
  rgb: Rgb;
  /** 4.5 for text, 3 for large text, a filled control, a line or a mark. */
  floor: number;
}

/** The extremes one part of the window has drawn, per channel. */
export interface VeilBackdrop {
  lo: Rgb;
  hi: Rgb;
}

/** The kit's margin past a floor (`schemes.test.ts`: "2% past"). */
export const LIVE_VEIL_MARGIN = 1.02;

/** The step the search takes between the Style's veil and the proven one. */
export const LIVE_VEIL_STEP = 0.005;

const channel = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const ratio = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const over = (s: number, ground: Rgb, backdrop: Rgb): Rgb => [
  s * ground[0] + (1 - s) * backdrop[0],
  s * ground[1] + (1 - s) * backdrop[1],
  s * ground[2] + (1 - s) * backdrop[2],
];

/**
 * The lowest contrast an ink can meet over one cell at veil `s`. The cell's
 * composites run from its darkest to its lightest luminance; an ink whose own
 * luminance falls inside that run meets a backdrop of its own lightness.
 */
function worstOver(
  ink: number,
  s: number,
  ground: Rgb,
  cell: VeilBackdrop
): number {
  const dark = luminance(over(s, ground, cell.lo));
  const light = luminance(over(s, ground, cell.hi));
  if (ink >= dark && ink <= light) return 1;
  return Math.min(ratio(ink, dark), ratio(ink, light));
}

/**
 * The thinnest veil in [`thin`, `floor`] at which every ink holds its floor,
 * with the margin, over every cell. Nothing measured yet, or nothing to hold:
 * the proven veil, which holds over anything.
 */
export function liveVeil({
  ground,
  inks,
  backdrops,
  thin,
  floor,
}: {
  ground: Rgb;
  inks: readonly VeilInk[];
  backdrops: readonly VeilBackdrop[];
  thin: number;
  floor: number;
}): number {
  if (thin >= floor || backdrops.length === 0 || inks.length === 0)
    return floor;
  const lit = inks.map((ink) => ({
    l: luminance(ink.rgb),
    need: ink.floor * LIVE_VEIL_MARGIN,
  }));
  for (let s = thin; s < floor; s += LIVE_VEIL_STEP) {
    const holds = lit.every((ink) =>
      backdrops.every((cell) => worstOver(ink.l, s, ground, cell) >= ink.need)
    );
    if (holds) return Math.round(s * 1000) / 1000;
  }
  return floor;
}

/** WCAG's large text: 24px, or 18.66px (14pt) at a bold weight. */
export function textFloor(fontSizePx: number, fontWeight: number): number {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700)
    ? 3
    : 4.5;
}
