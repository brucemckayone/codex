/**
 * Contrast by construction (Codex-1yd58.6, Codex-t2t6o's criteria): the
 * Showreel's words sit on a scrim of the brand's own ground (`scrimTint`), and
 * this picks the scrim's least opacity under which the ink, white or the
 * brand's dark text, keeps its ratio over ANY film frame, so the floor holds
 * for every piece, preset and stack.
 *
 * A frame pixel can be any colour. Under the scrim it becomes
 * `alpha · scrim + (1 − alpha) · pixel`; the ink (itself possibly
 * translucent, as the player's secondary ink is) is drawn over that. The
 * worst pixels are the extremes and the greys between, so the check runs
 * over the black-to-white greys and the six pure hues. Composited per
 * channel in sRGB, as browsers composite.
 */

/** sRGB channels 0-255. */
export type Rgb = readonly [number, number, number];
export interface Ink {
  rgb: Rgb;
  /** 0-1; the player's secondary ink is white at 0.8. */
  alpha: number;
}

const linear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2's contrast ratio. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `top` at `alpha` over `under`. */
export function over(top: Rgb, alpha: number, under: Rgb): Rgb {
  const mix = (i: 0 | 1 | 2) => alpha * top[i] + (1 - alpha) * under[i];
  return [mix(0), mix(1), mix(2)];
}

/** The film pixels the check runs over. */
const GROUNDS: readonly Rgb[] = [
  ...Array.from({ length: 18 }, (_, i): Rgb => {
    const v = Math.min(255, i * 15);
    return [v, v, v];
  }),
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [0, 255, 255],
  [255, 0, 255],
];

/** The ink's lowest contrast over any frame pixel under the scrim. */
export function worstContrast(ink: Ink, scrim: Rgb, alpha: number): number {
  let worst = Number.POSITIVE_INFINITY;
  for (const pixel of GROUNDS) {
    const ground = over(scrim, alpha, pixel);
    const text = over(ink.rgb, ink.alpha, ground);
    worst = Math.min(worst, contrast(text, ground));
  }
  return worst;
}

/**
 * The room each floor keeps over the browser's own rounding of the paint
 * (8-bit channels): the page kit's 2%, as the page's links (4.59:1) and focus
 * (3.06:1) keep it. Solved to the floor exactly, a dark ink on a light veil
 * measured a hair under 4.5 over a black frame (2026-11-20).
 */
export const FLOOR_MARGIN = 1.02;

/**
 * The least scrim opacity, in hundredths, under which every ink keeps its
 * ratio (with `FLOOR_MARGIN`) over any frame. Null when even a solid scrim
 * cannot (the ink fails on the scrim itself): the caller then draws the
 * scrim solid.
 */
export function scrimAlpha(
  inks: readonly { ink: Ink; ratio: number }[],
  scrim: Rgb
): number | null {
  for (let step = 0; step <= 100; step++) {
    const alpha = step / 100;
    if (
      inks.every(
        ({ ink, ratio }) =>
          worstContrast(ink, scrim, alpha) >= ratio * FLOOR_MARGIN
      )
    )
      return alpha;
  }
  return null;
}

/** The most a scrim may cover the film where the words sit. */
export const MAX_SCRIM_ALPHA = 0.9;

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/**
 * Where a veil moves to carry these inks: black under light inks, white under
 * dark ones, whichever the inks stand further from (their worst decides).
 */
export function veilPole(inks: readonly { ink: Ink; ratio: number }[]): Rgb {
  const from = (pole: Rgb) =>
    Math.min(...inks.map(({ ink }) => contrast(ink.rgb, pole)));
  return from(WHITE) > from(BLACK) ? WHITE : BLACK;
}

/**
 * The scrim's colour: the brand's own ground (`--color-background`, what the
 * shader's ground and the page use), moved toward its inks' pole (`veilPole`)
 * only as far as they need to keep their ratio at no more than
 * `MAX_SCRIM_ALPHA`. A dark brand under white ink keeps its ground, or gets a
 * deeper shade of it; a light brand under its own dark text keeps its ground,
 * or gets a paler one. The pole itself when nothing nearer will do.
 *
 * Solved only from the inks a scrim of the pole can carry at all. A brand
 * colour that not even a solid one can (OBB's red, 3.82:1 on black) no tint
 * helps: counted, it drove the tint to the pole for nothing (2026-11-20). The
 * reel lifts or outlines such a colour itself, and the ground stays the
 * brand's when it is the only ink.
 */
export function scrimTint(
  ground: Rgb,
  inks: readonly { ink: Ink; ratio: number }[]
): Rgb {
  const pole = veilPole(inks);
  const carriable = inks.filter((ink) => scrimAlpha([ink], pole) !== null);
  for (let step = 0; step <= 20; step++) {
    const tint = over(pole, step / 20, ground);
    const alpha = scrimAlpha(carriable, tint);
    if (alpha !== null && alpha <= MAX_SCRIM_ALPHA) return tint;
  }
  return pole;
}

/**
 * The shadows' falloff, 1 at the anchor to 0 at the edge: the mock's foot ramp
 * (0.94, 0.72 at 34%, 0.36 at 56%, 0 at 76%) eased as
 * ((1 + cos πt) / 2) ^ 0.6 to t = 0.8, then landing on a cubic Hermite tail
 * that meets it in value and slope there and reaches 0 with no slope at 1.
 * The power alone keeps a slope almost to its end, which a no-edge probe
 * reads as a kink where an ellipse ends (5.2 on a phone, 2026-11-20). No edge
 * shows anywhere (owner, 2026-11-20: the "linear window"). These are the
 * stops CSS draws: Showreel's `--_ramp` carries the same numbers.
 */
export const RAMP: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.1, 0.9852],
  [0.2, 0.9416],
  [0.3, 0.8707],
  [0.4, 0.7754],
  [0.5, 0.6598],
  [0.6, 0.5285],
  [0.7, 0.3877],
  [0.8, 0.2443],
  [0.85, 0.1663],
  [0.9, 0.0867],
  [0.95, 0.0249],
  [0.975, 0.0066],
  [0.99, 0.0011],
  [1, 0],
];

/** The ramp at `t`, read between its stops as CSS reads them (linearly). */
export function rampAt(t: number): number {
  let [t0, f0] = [0, 1];
  for (const [t1, f1] of RAMP) {
    if (t <= t1)
      return t1 === t0 ? f1 : f0 + ((t - t0) / (t1 - t0)) * (f1 - f0);
    [t0, f0] = [t1, f1];
  }
  return 0;
}

/** An ellipse's centre and radii, as fractions of the reel's box. */
export interface Corner {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** Soft radial shadows: ellipses anchored off the box, at a peak, on `RAMP`. */
export interface Shade {
  corners: readonly Corner[];
  peak: number;
}

/**
 * The header's two soft corners, behind the org's name and behind its facts
 * and Follow (owner, 2026-11-20: no band, "a shadow coming from each side").
 * A shade, not the floor: the halos make up what the words still need.
 * Showreel's `.reel__scrim-top` draws these same ellipses.
 */
export const HEADER_SHADE: Shade = {
  corners: [
    { cx: 0.02, cy: -0.06, rx: 0.36, ry: 0.22 },
    { cx: 1, cy: -0.06, rx: 0.64, ry: 0.24 },
  ],
  peak: 0.6,
};

/**
 * The foot's two corner radials, the owner's pick (V-A, 2026-11-20): rising
 * in from off the bottom-left behind the words and off the bottom-right
 * behind the index, so the middle and the top of the footage stay clear, at
 * the mock's own peak. Showreel's `.reel__scrim-foot` draws these ellipses.
 */
export const FOOT_SHADE: Shade = {
  corners: [
    { cx: 0, cy: 1.08, rx: 0.78, ry: 0.82 },
    { cx: 1.02, cy: 1.08, rx: 0.6, ry: 0.82 },
  ],
  peak: 0.94,
};

export const SHADES: readonly Shade[] = [HEADER_SHADE, FOOT_SHADE];

/** The most a grown shade may lay at its anchor: the mock's own peak. */
export const SHADE_PEAK_MAX = 0.94;
/** The furthest a grown ellipse may reach: twice its own radii. */
export const SHADE_REACH_MAX = 2;

/**
 * The most `growShades` may draw: every shade at `SHADE_PEAK_MAX`, each
 * ellipse at `SHADE_REACH_MAX` times its radii, anchored where it is. It lays
 * at least as much as any fit grows to, at every point (a higher peak and a
 * wider reach each only raise a radial), so 'shadow' paints it first: every
 * word passes from the first paint, and the fit eases the shades back once it
 * has measured them (owner, 2026-11-21). Only their strength changes, never
 * the layout.
 */
export const SHADES_CAP: readonly Shade[] = SHADES.map((shade) => ({
  peak: SHADE_PEAK_MAX,
  corners: shade.corners.map((c) => ({
    ...c,
    rx: c.rx * SHADE_REACH_MAX,
    ry: c.ry * SHADE_REACH_MAX,
  })),
}));

/**
 * The custom properties Showreel's scrims read, for these shades (header
 * first, then foot): each one's `--_peak-*`, and each ellipse as CSS draws it,
 * `ellipse rx ry at cx cy` in % of the reel's box.
 */
export function shadeProps(shades: readonly Shade[]): Record<string, string> {
  const pc = (v: number) => `${Math.round(v * 10000) / 100}%`;
  const props: Record<string, string> = {};
  for (const [i, name] of ['top', 'foot'].entries()) {
    const shade = shades[i];
    if (!shade) continue;
    props[`--_peak-${name}`] = String(shade.peak);
    for (const [c, { cx, cy, rx, ry }] of shade.corners.entries()) {
      props[`--_${name}-${c}`] =
        `ellipse ${pc(rx)} ${pc(ry)} at ${pc(cx)} ${pc(cy)}`;
    }
  }
  return props;
}

/** A word a shade must carry: its box, and the least scrim its ink needs. */
export interface Need {
  span: Span;
  need: number;
}

/**
 * The shades grown until every word has its own need beneath it, with no
 * halo (the 'shadow' edge, owner 2026-11-20). Each word is carried by the
 * ellipse that lays the most at its centre; that ellipse's shade rises in
 * peak first (to `SHADE_PEAK_MAX`), then the ellipse grows in reach (to
 * `SHADE_REACH_MAX` its radii), anchored where it was, so it stays a soft
 * radial with no edge. A word no shade can carry (its need above the most a
 * shade may lay) is left to the caller: it is not let grow the shade for
 * nothing. `short` holds the words still short when a shade is at its most.
 */
export function growShades(
  needs: readonly Need[],
  shades: readonly Shade[] = SHADES
): { shades: Shade[]; short: Need[] } {
  const grown = shades.map((shade) => ({
    peak: shade.peak,
    corners: shade.corners.map((corner) => ({ ...corner })),
  }));
  const reach = grown.map((shade) => shade.corners.map(() => 1));
  const base = shades.map((shade) =>
    shade.corners.map((corner) => ({ ...corner }))
  );
  const centre = ({ left, top, right, bottom }: Span) =>
    [(left + right) / 2, (top + bottom) / 2] as const;
  const carry = new Map<string, Need[]>();
  for (const need of needs) {
    if (need.need > SHADE_PEAK_MAX) continue;
    const [x, y] = centre(need.span);
    let best = '';
    let most = -1;
    for (const [s, shade] of shades.entries()) {
      for (const [c, corner] of shade.corners.entries()) {
        const laid = shadeAt(x, y, [{ peak: shade.peak, corners: [corner] }]);
        if (laid > most) [most, best] = [laid, `${s}:${c}`];
      }
    }
    carry.set(best, [...(carry.get(best) ?? []), need]);
  }
  const met = (list: readonly Need[]) =>
    list.every(({ span, need }) => shadeFloor(span, grown) >= need);
  for (const [key, list] of carry) {
    const [s = 0, c = 0] = key.split(':').map(Number);
    const shade = grown[s];
    const corner = shade?.corners[c];
    const from = base[s]?.[c];
    const scale = reach[s];
    if (!shade || !corner || !from || !scale) continue;
    while (!met(list) && shade.peak < SHADE_PEAK_MAX) {
      shade.peak = Math.min(
        SHADE_PEAK_MAX,
        Math.round((shade.peak + 0.02) * 100) / 100
      );
    }
    while (!met(list) && (scale[c] ?? 1) < SHADE_REACH_MAX) {
      const next = Math.min(
        SHADE_REACH_MAX,
        Math.round(((scale[c] ?? 1) + 0.04) * 100) / 100
      );
      scale[c] = next;
      corner.rx = from.rx * next;
      corner.ry = from.ry * next;
    }
  }
  const short = needs.filter(
    ({ span, need }) => shadeFloor(span, grown) < need
  );
  return { shades: grown, short };
}

/** The shades' alpha at a point of the box (fractions), composited. */
export function shadeAt(
  x: number,
  y: number,
  shades: readonly Shade[] = SHADES
): number {
  let clear = 1;
  for (const { corners, peak } of shades) {
    for (const { cx, cy, rx, ry } of corners) {
      clear *= 1 - peak * rampAt(Math.hypot((x - cx) / rx, (y - cy) / ry));
    }
  }
  return 1 - clear;
}

/** A box, as fractions of the reel's. */
export interface Span {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The least the shades lay anywhere over a box: sampled across it. */
export function shadeFloor(
  span: Span,
  shades: readonly Shade[] = SHADES
): number {
  let least = 1;
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 2; j++) {
      const x = span.left + ((span.right - span.left) * i) / 8;
      const y = span.top + ((span.bottom - span.top) * j) / 2;
      least = Math.min(least, shadeAt(x, y, shades));
    }
  }
  return least;
}

/**
 * What a word still needs where the shades under it already lay `under`, in
 * hundredths rounded up. The scrim over the scrim is the scrim at
 * 1 − (1 − extra)(1 − under), so extra = 1 − (1 − need)/(1 − under); 0 when
 * the shades already do. Its halo draws at least this round each glyph (the
 * pixel probe proves it); the pause's own fill draws exactly this.
 */
export function haloAlpha(need: number, under: number): number {
  if (under >= need) return 0;
  return Math.min(
    1,
    Math.ceil((1 - (1 - need) / (1 - under)) * 100 - 1e-9) / 100
  );
}

/**
 * The share of its own alpha a word's soft glow (the 'shadow' edge's blurred
 * text-shadow, no ring) lays on the ground touching its glyphs, at the least:
 * measured with the 1 px ring probe at full strength over a white frame with
 * no shades (2026-11-20, OBB at 1440, 28,466 ring pixels: p1 0.192, p5 0.255,
 * median 0.471), its 5th percentile rounded down, as the sweep judges the 5th
 * percentile. A blurred stack is concave in its alpha, so a glow at `g` lays
 * at least `g` times this.
 */
export const GLOW_SHARE = 0.25;

/**
 * What the shades must still lay under a word whose glow at `glow` lays its
 * share: the scrim over the scrim, 1 − (1 − need)/(1 − share), in hundredths
 * rounded up, and 0 when the glow alone does.
 */
export function glowLeaves(need: number, glow: number): number {
  return haloAlpha(need, GLOW_SHARE * glow);
}

/**
 * A brand colour that no shade can carry (the 'shadow' edge, owner
 * 2026-11-20: OBB's red is 3.75:1 at best on its own dark): lifted toward the
 * reel's own ink, in twentieths, just far enough that `carried` accepts it.
 * The colour as it is when it already passes; the reel's ink when nothing
 * nearer does.
 */
export function liftInk(
  ink: Ink,
  toward: Rgb,
  carried: (ink: Ink) => boolean
): Ink {
  const step = liftStep(ink, toward, carried);
  return { rgb: over(toward, step / 20, ink.rgb), alpha: ink.alpha };
}

/** `liftInk`'s step, in twentieths toward `toward`: 0 when it passes as is. */
export function liftStep(
  ink: Ink,
  toward: Rgb,
  carried: (ink: Ink) => boolean
): number {
  for (let step = 0; step < 20; step++) {
    if (carried({ rgb: over(toward, step / 20, ink.rgb), alpha: ink.alpha })) {
      return step;
    }
  }
  return 20;
}

/**
 * The least outline, in hundredths, of `halo` (a word's own pole, when it is
 * not the shade's: red on a dark brand outlined pale) over a shade of
 * `shade` laying `under`, that keeps the ink's ratio (with FLOOR_MARGIN) over
 * any frame. Null when even a solid outline cannot.
 */
export function outlineAlpha(
  { ink, ratio }: { ink: Ink; ratio: number },
  under: number,
  shade: Rgb,
  halo: Rgb
): number | null {
  for (let step = 0; step <= 100; step++) {
    const alpha = step / 100;
    let worst = Number.POSITIVE_INFINITY;
    for (const pixel of GROUNDS) {
      const ground = over(halo, alpha, over(shade, under, pixel));
      worst = Math.min(
        worst,
        contrast(over(ink.rgb, ink.alpha, ground), ground)
      );
    }
    if (worst >= ratio * FLOOR_MARGIN) return alpha;
  }
  return null;
}

/** A focus ring's least ratio to what it is drawn on (WCAG 1.4.11). */
export const FOCUS_RATIO = 3;

/**
 * The reel's focus ring. `--color-focus` is judged against the PAGE's ground,
 * and the reel draws over film: the brand's focus colour, mixed toward the
 * reel's own ink only as far as it needs to keep 3:1 over any frame under the
 * scrim at `alpha` (with `FLOOR_MARGIN`). A colour that passes as it is stays
 * the brand's own. The ink is the last resort, since the scrim was solved
 * for it.
 */
export function focusInk(focus: Rgb, ink: Rgb, scrim: Rgb, alpha: number): Rgb {
  for (let step = 0; step <= 20; step++) {
    const ring = over(ink, step / 20, focus);
    const ratio = worstContrast({ rgb: ring, alpha: 1 }, scrim, alpha);
    if (ratio >= FOCUS_RATIO * FLOOR_MARGIN) {
      return ring;
    }
  }
  return ink;
}
