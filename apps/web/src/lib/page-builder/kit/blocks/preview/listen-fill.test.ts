// @vitest-environment node
/**
 * The listening card's fill (`ListenCard.svelte`, THE FILL): a light panel
 * takes the brand's tint, the atmosphere scheme's `--_panel-g`; a dark one,
 * and contrast's, are drawn as they are. Held here to the text, as
 * `styles/schemes.test.ts` holds the schemes, and measured: every ink the
 * card draws on the tint holds its floor on the darkest colour the tint's
 * recipe can make, against the grades `schemes.css` gives each light band.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GROUND_BANDS } from '../../model/resolve';

const DIR = dirname(fileURLToPath(import.meta.url));
const squash = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')');
const CARD = squash(
  readFileSync(join(DIR, 'ListenCard.svelte'), 'utf8').match(
    /<style>([\s\S]*)<\/style>/
  )?.[1] ?? ''
);
const SCHEMES = squash(
  readFileSync(join(DIR, '..', '..', 'styles', 'schemes.css'), 'utf8')
);

/** The body of the first rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at === -1) return '';
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at)).trim();
}

const SWITCH =
  /--_fill: rgb\(from color-mix\(in srgb, oklch\(from var\(--lp-panel\) l c h \/ clamp\(0, \(([\d.]+) - l\) \* 1e6, 1\)\) 50%, rgb\(from var\(--_panel-g\) r g b \/ 0\.004\) 50%\) r g b \/ 1\);/;
const PIVOT = Number(rule(CARD, '.listen').match(SWITCH)?.[1]);

// The tint's recipe on each pole, as `schemes.css` declares it on the root.
const LIGHT_TINT =
  /--_panel-g: oklch\(from color-mix\(in oklab, var\(--lp-ground\), var\(--lp-brand\) var\(--lp-tint-panel\)\) clamp\(([\d.]+), l, ([\d.]+)\) min\(c, \(1 - clamp\([\d.]+, l, [\d.]+\)\) \* ([\d.]+)\) h\);/;
const DARK_TINT =
  /--_panel-g: oklch\(from color-mix\(in oklab, var\(--lp-ground\), var\(--lp-brand\) calc\(var\(--lp-tint-panel\) \+ 2%\)\) clamp\([\d.]+, l \+ [\d.]+, ([\d.]+)\)/;
const [, tintLo, tintHi, tintChroma] = (SCHEMES.match(LIGHT_TINT) ?? []).map(
  Number
);
const darkTintHi = Number(SCHEMES.match(DARK_TINT)?.[1]);

type Rgb = [number, number, number];

/** OKLCH to linear sRGB (Ottosson's matrices). */
function linear(L: number, C: number, h: number): Rgb {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const ratio = (y1: number, y2: number) =>
  (Math.max(y1, y2) + 0.05) / (Math.min(y1, y2) + 0.05);

/** The darkest colour the light tint's recipe can make, over every hue. */
function darkestTint(): number {
  let darkest = 1;
  for (let L = tintLo; L <= tintHi + 1e-9; L += 0.005)
    for (let f = 0; f <= 1 + 1e-9; f += 0.05)
      for (let h = 0; h < 360; h += 1) {
        const rgb = linear(L, (1 - L) * tintChroma * f, h);
        if (rgb.some((c) => c < -1e-6 || c > 1 + 1e-6)) continue;
        darkest = Math.min(darkest, luminance(rgb));
      }
  return darkest;
}

/** Each light band's org grades, as `schemes.css` names them. */
const GRADES = GROUND_BANDS.filter((band) => band.pole === 'light').map(
  ({ id }) => {
    const body = rule(SCHEMES, `.lp[data-ground-light='${id}']`);
    const grade = (name: string) =>
      Number(body.match(new RegExp(`--_gl-${name}: ([\\d.]+);`))?.[1]);
    return {
      id,
      text: grade('ot'),
      large: grade('ol'),
      decoratedText: grade('odt'),
      decoratedLarge: grade('odl'),
    };
  }
);

describe('the listening card’s fill', () => {
  it('is the tint over a light panel, the panel itself over a dark one', () => {
    const card = rule(CARD, '.listen');
    expect(card).toMatch(SWITCH);
    expect(card).toContain('background: var(--_fill);');
    expect(card).toContain('color: var(--lp-panel-ink);');
    // Contrast's panel is drawn as it is, on either pole.
    expect(rule(CARD, ":global(.lp [data-lp-scheme='contrast']) .listen")).toBe(
      '--_fill: var(--lp-panel);'
    );
  });

  it('reads the light tint the atmosphere scheme draws, held light enough for dark ink', () => {
    expect([tintLo, tintHi, tintChroma]).toEqual([0.9, 0.965, 0.46]);
    expect(rule(SCHEMES, ".lp [data-lp-scheme='atmosphere']")).toContain(
      '--lp-panel: var(--_panel-g);'
    );
  });

  // The switch reads the panel's lightness: every light band's surfaces sit
  // above it and every dark band's, and the dark tint, below it.
  it('tells a light panel from a dark one in every band', () => {
    const edges = (pole: 'light' | 'dark') =>
      GROUND_BANDS.filter((band) => band.pole === pole).map((b) => b.edge);
    expect(PIVOT).toBeLessThan(Math.min(...edges('light')));
    expect(PIVOT).toBeGreaterThan(Math.max(...edges('dark'), darkTintHi));
  });

  // The kit's switch (`--lp-brand-2`): the panel at alpha 1 or 0, mixed half
  // and half, premultiplied, with the tint at alpha 0.004, then opaque. An
  // sRGB channel of a dark panel against one of the tint, at their furthest.
  it('switches to the panel within 1/255, or to the tint exactly', () => {
    const mix = (panel: number, alpha: number, tint: number) =>
      (0.5 * alpha * panel + 0.5 * 0.004 * tint) / (0.5 * alpha + 0.002);
    for (const [panel, tint] of [
      [0.03, 0.97],
      [0.45, 0.9],
      [0.97, 0.03],
    ]) {
      expect(Math.abs(mix(panel, 1, tint) - panel)).toBeLessThan(1 / 255);
      expect(mix(panel, 0, tint)).toBeCloseTo(tint, 12);
    }
  });

  describe('every ink it draws on the tint holds', () => {
    const darkest = darkestTint();

    it('measures the darkest tint (a floor, so the sweep is seen to run)', () => {
      expect(darkest).toBeGreaterThan(0.7);
      expect(darkest).toBeLessThan(0.73);
    });

    // Base and soft draw the org's ink and button, each moved to its band's
    // grade (or darker), plain or decorated.
    it.each(
      GRADES
    )('$id: the org’s text 4.5:1, its button and focus 3:1', (band) => {
      expect(ratio(darkest, band.text)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(darkest, band.decoratedText)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(darkest, band.large)).toBeGreaterThanOrEqual(3);
      expect(ratio(darkest, band.decoratedLarge)).toBeGreaterThanOrEqual(3);
    });

    // Brand, accent and atmosphere draw the kit's ink, 17:1 on the light
    // panel it was made for (`schemes.css`), so at worst this dark. Brand and
    // accent draw their button from it too, the card for its label.
    it('the kit’s ink and the brand band’s button, 4.5:1 both ways', () => {
      const ink = Math.max(0, (1 + 0.05) / 17 - 0.05);
      expect(ratio(darkest, ink)).toBeGreaterThanOrEqual(4.5);
      const inverted = rule(
        CARD,
        ":global(.lp :is([data-lp-scheme='brand'], [data-lp-scheme='accent'])) .listen"
      );
      expect(inverted).toContain('--_button: var(--lp-panel-ink);');
      expect(inverted).toContain('--_button-ink: var(--_fill);');
      expect(inverted).toContain('--_focus: var(--lp-panel-ink);');
    });
  });
});
