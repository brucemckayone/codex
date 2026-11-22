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
import { TEXT_ON_BRAND_LUMINANCE_PIVOT } from '$lib/brand-editor/ink';

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
 * The veil's pole and the ink pole opposite it, from the GROUND alone (owner,
 * 2026-11-21): a dark brand's veil stays its own dark, moved toward black,
 * and every colour that cannot keep its floor is lifted toward white; a light
 * brand's is the mirror, a pale veil and lifts toward black. Never from the
 * inks: a player text no dark veil carries (#CB213C on #0F0000) once turned
 * the whole veil pale. The PAGE's own switch (review R2, 2026-11-21), as
 * Showreel's `--_light` and its first paint's `--_pole-ink` read it too: the
 * binding luminance (`--_gy`, `bindingLuminance`) is light AT the pivot and
 * above, since a light page whose darkest surface is mid grey binds exactly
 * there (org-brand.css's `--_gw`). Read strictly above, grey 120-135 grounds
 * got a dark veil on a light page.
 */
export function groundPoles(groundY: number): { veil: Rgb; ink: Rgb } {
  return groundY >= TEXT_ON_BRAND_LUMINANCE_PIVOT
    ? { veil: WHITE, ink: BLACK }
    : { veil: BLACK, ink: WHITE };
}

/**
 * The first paint's scrim, until the fit has read the brand's colours (and
 * with no script at all): its ground deepened toward black by `deepen` on a
 * dark brand, or paled toward white by `pale` on a light one, mixed in oklab
 * as the stylesheet mixes them (Showreel sets these on its root), held at
 * `pool` and glowing at that pool. Pale enough that every word clears
 * FLOOR_MARGIN on the darkest light ground there is, one at the pivot (review
 * R5, 2026-11-21: unpaled, a grey-140 kicker read 4.57).
 */
export const FIRST_PAINT = { deepen: 0.64, pale: 0.2, pool: 0.9 } as const;

/**
 * The pole these inks stand furthest from (their worst decides): white for a
 * dark ink, black for a light one. What 'outline' rings a word no scrim
 * carries in, so it keeps its own colour inside a ring that reads (a red's is
 * white). Never the veil's: that is the ground's (`groundPoles`).
 */
export function ownPole(inks: readonly { ink: Ink; ratio: number }[]): Rgb {
  const from = (pole: Rgb) =>
    Math.min(...inks.map(({ ink }) => contrast(ink.rgb, pole)));
  return from(WHITE) > from(BLACK) ? WHITE : BLACK;
}

/**
 * The ink that stands furthest from a veil of `scrim`: white on a dark one,
 * black on a light one. The focus ring's last resort (`focusInk`).
 */
export function inkPole(scrim: Rgb): Rgb {
  return contrast(WHITE, scrim) >= contrast(BLACK, scrim) ? WHITE : BLACK;
}

/**
 * The scrim's colour: the brand's own ground (`--color-background`, what the
 * shader's ground and the page use), moved toward the veil's pole (`veil`,
 * from `groundPoles`) only as far as its inks need. A dark brand keeps its
 * ground, or gets a deeper shade of it; a light brand keeps its ground, or
 * gets a paler one. The pole itself when nothing nearer will do.
 *
 * How far each ink may need its scrim: no more than `MAX_SCRIM_ALPHA`, and
 * for a word, no more than its own `room` (`wordRoom`): what can be drawn
 * where it sits. The cap alone let a mid grey stop at a need of 0.9 that the
 * shades can never lay mid-reel (0.62 to 0.78 there), so every word in that
 * band was short by construction, and every Outline ring there solid with no
 * headroom (review r3 n1, n3: grey 100's film label 4.04:1, its Outline 20 of
 * 27 words short). A room even the veil's pole cannot meet is held to the cap
 * alone: such a word is lifted, as before.
 *
 * Solved only from the inks a scrim of the pole can carry at all. A colour
 * that not even a solid one can (a player text the creator set, as #CB213C on
 * #0F0000: 3.82:1 even on black) no tint helps: counted, it drove the tint to
 * the pole for nothing (2026-11-20). The reel lifts or outlines such a colour
 * itself, toward the ink `pole` (required: an ink-blind tint is the R2
 * regression), so it is solved as that pole, as it will be drawn: a light
 * page held AT the pivot (a grey 120) whose light text no pale veil carries
 * keeps a tint black can still be carried on, never its mid grey with no room
 * left (review R2's probe, 2026-11-21: 24 of 27 words short over black). Over
 * a ground that already carries the pole (OBB's dark), the ground stays the
 * brand's.
 */
export function scrimTint(
  ground: Rgb,
  veil: Rgb,
  inks: readonly { ink: Ink; ratio: number; room?: number }[],
  pole: Rgb
): Rgb {
  const asDrawn = inks.flatMap((entry) => {
    if (scrimAlpha([entry], veil) !== null) return [entry];
    const lifted = { ...entry, ink: { rgb: pole, alpha: entry.ink.alpha } };
    return scrimAlpha([lifted], veil) !== null ? [lifted] : [];
  });
  const held = asDrawn.map((entry) => {
    const room = Math.min(MAX_SCRIM_ALPHA, entry.room ?? MAX_SCRIM_ALPHA);
    const atPole = scrimAlpha([entry], veil) ?? 1;
    return { entry, most: atPole <= room ? room : MAX_SCRIM_ALPHA };
  });
  for (let step = 0; step <= 20; step++) {
    const tint = over(veil, step / 20, ground);
    const fits = held.every(({ entry, most }) => {
      const need = scrimAlpha([entry], tint);
      return need !== null && need <= most;
    });
    if (fits) return tint;
  }
  return veil;
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
 * A word whose centre no drawn ellipse reaches (the reel's middle, about x
 * 0.4-0.6, y 0.2-0.45) is given the first, the header's left, by the
 * tie-break, which lays it ~0 alone: no scrimmed word sits there in any
 * layout today; a new one placed there would need its own carrier.
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
  const carry = new Map<string, Need[]>();
  for (const need of needs) {
    if (need.need > SHADE_PEAK_MAX) continue;
    const [s, c] = carrierOf(need.span, shades);
    const best = `${s}:${c}`;
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

/**
 * The ellipse that carries a word in `growShades`, as [shade, corner]: the
 * one that lays the most at the word's centre, the first on a tie.
 */
function carrierOf(
  { left, top, right, bottom }: Span,
  shades: readonly Shade[] = SHADES
): readonly [number, number] {
  const [x, y] = [(left + right) / 2, (top + bottom) / 2];
  let best: readonly [number, number] = [0, 0];
  let most = -1;
  for (const [s, shade] of shades.entries()) {
    for (const [c, corner] of shade.corners.entries()) {
      const laid = shadeAt(x, y, [{ peak: shade.peak, corners: [corner] }]);
      if (laid > most) [most, best] = [laid, [s, c]];
    }
  }
  return best;
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

/** Where over a box the shades lay the least, sampled as `shadeFloor` does. */
function weakestAt(
  span: Span,
  shades: readonly Shade[]
): readonly [number, number] {
  let least = 2;
  let at: readonly [number, number] = [span.left, span.top];
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 2; j++) {
      const x = span.left + ((span.right - span.left) * i) / 8;
      const y = span.top + ((span.bottom - span.top) * j) / 2;
      const laid = shadeAt(x, y, shades);
      if (laid < least) [least, at] = [laid, [x, y]];
    }
  }
  return at;
}

/**
 * How far out the ramp still lays `share` of its peak: `rampAt` read
 * backwards, between its stops as CSS reads them (0 at a share of 1 or more).
 */
function rampReach(share: number): number {
  if (share >= 1) return 0;
  let [t0, f0] = [0, 1];
  for (const [t1, f1] of RAMP) {
    if (f1 <= share) {
      return f0 === f1 ? t1 : t0 + ((f0 - share) / (f0 - f1)) * (t1 - t0);
    }
    [t0, f0] = [t1, f1];
  }
  return 1;
}

/**
 * The stretch of the reel's edge one ellipse lays at least half on, alone at
 * its shade's peak, in fractions of the width: the top edge for an ellipse
 * anchored above the reel (the header's), the foot for one below. Null where
 * it lays less than half all along that edge.
 */
export function halfSpan(
  { cx, cy, rx, ry }: Corner,
  peak: number
): readonly [number, number] | null {
  if (peak < 0.5) return null;
  const t = rampReach(0.5 / peak);
  const dy = ((cy < 0.5 ? 0 : 1) - cy) / ry;
  const across = t * t - dy * dy;
  if (across < 0) return null;
  const half = rx * Math.sqrt(across);
  return [cx - half, cx + half];
}

/**
 * Whether a shade still reads as a shadow from each side, the owner's rule
 * for the header (2026-11-20: "a shadow coming from each side", no band):
 * its ellipses' half-strength stretches along their edge (`halfSpan`) never
 * meet. Computed from the ellipses, never from pixels.
 */
export function readsAsTwo(shade: Shade): boolean {
  const spans = shade.corners
    .map((corner) => halfSpan(corner, shade.peak))
    .filter((span): span is readonly [number, number] => span !== null)
    .sort((a, b) => a[0] - b[0]);
  let end = Number.NEGATIVE_INFINITY;
  for (const [from, to] of spans) {
    if (from <= end) return false;
    end = to;
  }
  return true;
}

/**
 * The words `growShades` leaves short with their carrier at its most,
 * carried further by a second ellipse (a phone's top-bar name reaches past
 * the header's left corner, 2026-11-22): the other ellipse of the same shade
 * that lays the most at the word's weakest point, grown the same way (peak
 * first, then reach, to the same caps), only as far as the word needs, and
 * never so far that the shade stops reading as two (`readsAsTwo`): a word
 * that bound leaves short stays in `short`, for the caller to report. A
 * shade that already reads as one takes no second carrier. `grown` is
 * `growShades`'s output for these needs over `shades`.
 */
export function secondCarrier(
  needs: readonly Need[],
  grown: readonly Shade[],
  shades: readonly Shade[] = SHADES
): { shades: Shade[]; short: Need[] } {
  const next = grown.map((shade) => ({
    peak: shade.peak,
    corners: shade.corners.map((corner) => ({ ...corner })),
  }));
  for (const { span, need } of needs) {
    const met = () => shadeFloor(span, next) >= need;
    if (need > SHADE_PEAK_MAX || met()) continue;
    const [s, first] = carrierOf(span, shades);
    const shade = next[s];
    if (!shade || !readsAsTwo(shade)) continue;
    const [x, y] = weakestAt(span, next);
    let c = -1;
    let most = -1;
    for (const [i, corner] of shade.corners.entries()) {
      if (i === first) continue;
      const laid = shadeAt(x, y, [{ peak: shade.peak, corners: [corner] }]);
      if (laid > most) [most, c] = [laid, i];
    }
    const corner = shade.corners[c];
    const from = shades[s]?.corners[c];
    if (!corner || !from) continue;
    while (!met() && shade.peak < SHADE_PEAK_MAX) {
      const was = shade.peak;
      shade.peak = Math.min(
        SHADE_PEAK_MAX,
        Math.round((shade.peak + 0.02) * 100) / 100
      );
      if (!readsAsTwo(shade)) {
        shade.peak = was;
        break;
      }
    }
    let scale = Math.round((corner.rx / from.rx) * 100) / 100;
    while (!met() && scale < SHADE_REACH_MAX) {
      const step = Math.min(
        SHADE_REACH_MAX,
        Math.round((scale + 0.04) * 100) / 100
      );
      const [rx, ry] = [corner.rx, corner.ry];
      corner.rx = from.rx * step;
      corner.ry = from.ry * step;
      if (!readsAsTwo(shade)) {
        [corner.rx, corner.ry] = [rx, ry];
        break;
      }
      scale = step;
    }
  }
  const short = needs.filter(({ span, need }) => shadeFloor(span, next) < need);
  return { shades: next, short };
}

/**
 * The ring's strength in 'outline' (Showreel's `--_h-ring`): its group's halo
 * taken up by this, so from a halo of 1 / RING_TAKE_UP the ring is solid,
 * with no headroom left over a lighter frame (review r3 n3).
 */
export const RING_TAKE_UP = 1.6;

/**
 * Whether a word's ring in 'outline' can lay what its `need` asks where the
 * shades lay `under`: its solved halo (`haloAlpha`) taken up by RING_TAKE_UP,
 * at or under solid. Past solid even a solid ring lays less than the halo
 * asks, so the word is short where it sits. `wordRoom` bounds the tint by
 * it; the fit lifts a word it fails, as one its shades fall short under in
 * 'shadow', and reports one its pole cannot rescue either (review r5: Outline
 * had counted no word short, so with the room bounded by the drawn ring,
 * grey 110's kicker asked 1.008 of its ring, unlifted and unreported). It is
 * the model's bound only: that build's "02" asked 0.96 and still read 4.48
 * on the ring probe, a gap in the ring's calibration that no check of this
 * kind can see.
 */
export function ringCarries(need: number, under: number): boolean {
  return haloAlpha(need, under) * RING_TAKE_UP <= 1;
}

/**
 * The most a word's own scrim need may be where it sits (its glyphs' `span`)
 * for what can be drawn there to carry it, in hundredths as the needs are
 * (review r3 n1, n3). In 'shadow', what `growShades` draws at its glyphs for
 * this word alone: the ellipse that carries it at its most, the other three
 * as drawn (review r4 M1: the room had counted all four at their cap, while
 * the growth raises only the carrier, so a word held to it was still short
 * where it sat: OBB's kicker 0.645 laid against 0.71), with its own soft glow
 * counted at the least it lays (its group's is never weaker). Never every
 * ellipse grown for it: that darkens more of the film than the word needs.
 * In 'outline', a ring that carries it over the shades as drawn
 * (`ringCarries`): the solved halo's, whose drawn margin may clip at solid
 * (`RING_MARGIN`).
 */
export function wordRoom(edge: 'shadow' | 'outline', span: Span): number {
  const alone =
    edge === 'shadow'
      ? shadeFloor(span, growShades([{ span, need: SHADE_PEAK_MAX }]).shades)
      : 0;
  const fits =
    edge === 'shadow'
      ? (need: number) => glowLeaves(need, need) <= alone
      : (need: number) => ringCarries(need, shadeFloor(span, SHADES));
  let room = 0;
  for (let step = 1; step <= 100 && fits(step / 100); step++) room = step / 100;
  return room;
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
 * What 'outline' draws over a group's solved halo (review r4): the 1 px ring
 * round a small glyph's faint edge lays less than the halo asks, so OBB's
 * index "02" read 4.47 on the ring probe against 4.5 (white frame, 1440
 * Corner; grey 100 and 110 the same, 4.48). Measured over every group: +0.01
 * read 4.54, +0.02 read 4.60, the least that clears the floor with
 * FLOOR_MARGIN (4.59), for a dE2000 on the ring's pixels of 0.19 mean, 1.97
 * at most. Only the drawing takes it: `wordRoom` still bounds the tint by the
 * solved halo, so the tint is as before.
 *
 * Its clip at solid is safe by construction (review r5 L1): ringHalo is
 * min(1, halo + RING_MARGIN), never under the halo, so the drawn ring,
 * min(1, ringHalo x RING_TAKE_UP), never falls under the solved halo's own
 * share, which is at most 1 at the room. At the room's edge the ring is solid
 * and the clip eats part of the margin, never the need: at 231c269fa "02"
 * read 4.60 on grey 100, grey 110 and OBB and 4.63 on grey 135, the index
 * ring clipped from 1.024 to 1. Bounding the room by the drawn ring instead
 * put the kicker's and the index rows' rooms under the soft ink's need in its
 * pole (0.60 against 0.62), and grey 110's "02" read 4.48: the pin in
 * showreel-pure.test.ts.
 */
export const RING_MARGIN = 0.02;

/** A group's ring strength in 'outline': its solved halo and RING_MARGIN, none where the shades carry it. */
export function ringHalo(need: number, under: number): number {
  const halo = haloAlpha(need, under);
  return halo === 0
    ? 0
    : Math.min(1, Math.round((halo + RING_MARGIN) * 100) / 100);
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
 * A colour that no shade can carry (the 'shadow' edge, owner 2026-11-20: a
 * player text the creator set, as #CB213C on #0F0000, is 3.75:1 on that
 * ground and 3.82:1 even on black): lifted toward `toward` (the reel passes
 * `groundPoles`'s ink, white on a dark brand, never its own ink, which may be
 * that same colour), in twentieths, just far enough that `carried` accepts
 * it. The colour as it is when it already passes; null when not even
 * `toward` itself does, so a caller never takes an unchecked last step.
 */
export function liftInk(
  ink: Ink,
  toward: Rgb,
  carried: (ink: Ink) => boolean
): Ink | null {
  const step = liftStep(ink, toward, carried);
  return step === null
    ? null
    : { rgb: over(toward, step / 20, ink.rgb), alpha: ink.alpha };
}

/**
 * `liftInk`'s step, in twentieths toward `toward`: 0 when it passes as is, 20
 * when only `toward` itself does, and null when even that fails.
 */
export function liftStep(
  ink: Ink,
  toward: Rgb,
  carried: (ink: Ink) => boolean
): number | null {
  for (let step = 0; step <= 20; step++) {
    if (carried({ rgb: over(toward, step / 20, ink.rgb), alpha: ink.alpha })) {
      return step;
    }
  }
  return null;
}

/**
 * The nodes a short role lifts this round, in their order: those it already
 * lifts, and every other that `fails` now (review r4 LOW). Taken again each
 * round, never once at entry: as a lift lowers one node's need, its group's
 * glow can fall, and a node that passed at entry turns short. Left out, it
 * skipped the lift and wore the pole at step 20.
 */
export function liftedNodes<T extends { ink: Ink }>(
  nodes: readonly T[],
  lifted: readonly T[],
  fails: (ink: Ink) => boolean
): T[] {
  return nodes.filter((node) => lifted.includes(node) || fails(node.ink));
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
 * the brand's own. When no mix toward the ink passes (the ink is itself a
 * brand colour the scrim cannot carry), toward `inkPole` instead, and the
 * pole itself last: every ring returned is checked, never assumed.
 */
export function focusInk(focus: Rgb, ink: Rgb, scrim: Rgb, alpha: number): Rgb {
  const passes = (ring: Rgb) =>
    worstContrast({ rgb: ring, alpha: 1 }, scrim, alpha) >=
    FOCUS_RATIO * FLOOR_MARGIN;
  for (const toward of [ink, inkPole(scrim)]) {
    for (let step = 0; step <= 20; step++) {
      const ring = over(toward, step / 20, focus);
      if (passes(ring)) return ring;
    }
  }
  return inkPole(scrim);
}
