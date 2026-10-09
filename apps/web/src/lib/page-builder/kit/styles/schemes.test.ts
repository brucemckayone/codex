// @vitest-environment node
/**
 * The colour schemes' contrast floors (contract §5), measured — not asserted
 * from the stylesheet's say-so.
 *
 * jsdom evaluates neither relative colour nor `color-mix()`, so this file
 * MODELS `schemes.css` exactly (the model reproduced Chrome's computed colours
 * to two decimal places when this was written) and holds the stylesheet to the
 * model two ways:
 *
 *   1. PARITY — the generated fragments and every surface recipe below appear
 *      verbatim in `schemes.css`, so an edit to one without the other fails;
 *   2. FLOORS — every scheme token meets its floor for a named brand matrix
 *      (pale, mid, very dark, very light, and the green/teal/grey brands that
 *      break a lightness pivot) on each ground in both themes, and for a
 *      generated sweep of the sRGB cube.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'schemes.css'),
  'utf8'
);
const squash = (s: string) => s.replace(/\s+/g, ' ');
const CODE = squash(CSS.replace(/\/\*[\s\S]*?\*\//g, ''));

/** The two pole blocks (the root `.lp` rule comes first) and the exact path's root. */
const POLE = {
  light: CODE.match(/\.lp \{([^}]*)\}/)?.[1] ?? '',
  dark: CODE.match(/\.lp\[data-lp-style='cinematic'\] \{([^}]*)\}/)?.[1] ?? '',
};
const EXACT =
  CODE.match(
    /@supports \(color: rgb\(from red calc\(255 \* pow\(r \/ 255, 2\)\) 0 0\)\) \{ \.lp \{([^}]*)\}/
  )?.[1] ?? '';

// ── the parameters the stylesheet is generated from ─────────────────────────
const INK = { ink: 17, soft: 7, edge: 3.2, line: 1.45 } as const;
const TARGET = {
  accentLight: 0.105,
  accentDark: 0.3,
  buttonLight: 0.155,
  buttonDark: 0.24,
  // A mark (a route, a stop, a ring) needs 3:1, not 4.5:1, so it moves less:
  // >= 3.3:1 against the worst surface of its band, the accent's own ~10%
  // margin (§8 below measures it for any source colour).
  markLight: 0.18,
  markDark: 0.185,
  // Atmosphere's brand is moved further so its veil can be thinner (§5 below).
  atmosAccentLight: 0.06,
  atmosAccentDark: 0.41,
  atmosButtonLight: 0.115,
  atmosButtonDark: 0.26,
  // …and its mark, which also serves a decorated page (§6, §8 below).
  atmosMarkLight: 0.11,
  atmosMarkDark: 0.27,
};

// ── 1. parity ────────────────────────────────────────────────────────────────
function fragments(): string[] {
  const channels = ['r', 'g', 'b'] as const;
  const out: string[] = channels.map(
    (c) => `--_l${c}: pow((clamp(0, ${c}, 255) / 255 + 0.055) / 1.055, 2.4);`
  );
  out.push(
    '--_y: (0.2126 * var(--_lr) + 0.7152 * var(--_lg) + 0.0722 * var(--_lb));'
  );
  out.push('--_w: clamp(0, (0.1791 - var(--_y)) * 1e6, 1);');
  for (const [level, t] of Object.entries(INK)) {
    out.push(
      `--_t-${level}: (var(--_w) * min(1, ${t} * (var(--_y) + 0.05) - 0.05) + (1 - var(--_w)) * max(0, (var(--_y) + 0.05) / ${t} - 0.05));`
    );
    for (const c of channels) {
      const l = `var(--_l${c})`;
      const tt = `var(--_t-${level})`;
      out.push(
        `--_${level}-${c}: max(0, 255 * (1.055 * pow(var(--_w) * (${l} + (${tt} - var(--_y)) / max(1 - var(--_y), 1e-6) * (1 - ${l})) + (1 - var(--_w)) * ${l} * ${tt} / max(var(--_y), 1e-6), 1 / 2.4) - 0.055));`
      );
    }
  }
  const darken = (name: string, y: number) =>
    channels.map(
      (c) =>
        `--_${name}-${c}: max(0, 255 * (1.055 * pow(var(--_l${c}) * min(1, ${y} / max(var(--_y), 1e-6)), 1 / 2.4) - 0.055));`
    );
  const lighten = (name: string, y: number) => [
    `--_${name}-s: max(1, ${y} / max(var(--_y), 1e-6));`,
    ...channels.map(
      (c) => `--_${name}-1${c}: min(1, var(--_l${c}) * var(--_${name}-s));`
    ),
    `--_${name}-y1: (0.2126 * var(--_${name}-1r) + 0.7152 * var(--_${name}-1g) + 0.0722 * var(--_${name}-1b));`,
    `--_${name}-k: max(0, (${y} - var(--_${name}-y1)) / max(1 - var(--_${name}-y1), 1e-6));`,
    ...channels.map(
      (c) =>
        `--_${name}-${c}: max(0, 255 * (1.055 * pow(var(--_${name}-1${c}) + var(--_${name}-k) * (1 - var(--_${name}-1${c})), 1 / 2.4) - 0.055));`
    ),
  ];
  return [
    ...out,
    ...darken('acc-dk', TARGET.accentLight),
    ...lighten('acc-lt', TARGET.accentDark),
    ...darken('btn-dk', TARGET.buttonLight),
    ...lighten('btn-lt', TARGET.buttonDark),
    ...darken('mark-dk', TARGET.markLight),
    ...lighten('mark-lt', TARGET.markDark),
    ...darken('atm-acc-dk', TARGET.atmosAccentLight),
    ...lighten('atm-acc-lt', TARGET.atmosAccentDark),
    ...darken('atm-btn-dk', TARGET.atmosButtonLight),
    ...lighten('atm-btn-lt', TARGET.atmosButtonDark),
    ...darken('atm-mark-dk', TARGET.atmosMarkLight),
    ...lighten('atm-mark-lt', TARGET.atmosMarkDark),
  ];
}

/** The recipes the model below implements, as the stylesheet spells them. */
const RECIPES = [
  // light pole
  '--lp-ground: oklch( from var(--_ground-in) clamp(0.9, l, 1) calc(c - clamp(0, (0.9 - l) * 1e6, 1) * max(0, c - 0.046)) h );',
  '--_soft-bg: oklch( from color-mix(in oklab, var(--lp-ground), var(--lp-brand) var(--lp-tint-soft)) clamp(0.9, l - 0.025, 0.97) min(c, (1 - clamp(0.9, l - 0.025, 0.97)) * 0.46) h );',
  '--_contrast-bg: oklch(from var(--lp-brand) 0.2 min(c * 0.3, 0.033) h);',
  '--_panel-g: oklch( from color-mix(in oklab, var(--lp-ground), var(--lp-brand) var(--lp-tint-panel)) clamp(0.9, l, 0.965) min(c, (1 - clamp(0.9, l, 0.965)) * 0.46) h );',
  '--_panel-i: oklch(from var(--lp-brand) 0.265 min(c * 0.35, 0.043) h);',
  '--_scrim: oklch(from var(--lp-brand) 0.16 min(c * 0.25, 0.027) h);',
  // dark pole
  '--lp-ground: oklch( from var(--_ground-in) min(l, 0.24) calc(c - clamp(0, (l - 0.24) * 1e6, 1) * max(0, c - 0.039)) h );',
  '--_soft-bg: oklch( from color-mix(in oklab, var(--lp-ground), var(--lp-brand) calc(var(--lp-tint-soft) + 2%)) clamp(0.12, l + 0.035, 0.27) min(c, clamp(0.12, l + 0.035, 0.27) * 0.165) h );',
  '--_contrast-bg: oklch(from var(--lp-brand) 0.955 min(c * 0.12, 0.02) h);',
  '--_panel-g: oklch( from color-mix(in oklab, var(--lp-ground), var(--lp-brand) calc(var(--lp-tint-panel) + 2%)) clamp(0.2, l + 0.03, 0.28) min(c, clamp(0.2, l + 0.03, 0.28) * 0.165) h );',
  '--_panel-i: oklch(from var(--lp-brand) 0.985 min(c * 0.05, 0.0068) h);',
  // tokens
  '--lp-ink: rgb(from var(--lp-bg) var(--_ink-r) var(--_ink-g) var(--_ink-b));',
  '--lp-ink-soft: rgb(from var(--lp-bg) var(--_soft-r) var(--_soft-g) var(--_soft-b));',
  '--lp-button-line: rgb(from var(--lp-bg) var(--_edge-r) var(--_edge-g) var(--_edge-b));',
  '--lp-panel-ink: rgb(from var(--lp-panel) var(--_ink-r) var(--_ink-g) var(--_ink-b));',
  '--lp-button-ink: rgb(from var(--lp-button-bg) var(--_ink-r) var(--_ink-g) var(--_ink-b));',
  '--_btn-light: rgb(from var(--lp-brand) var(--_btn-dk-r) var(--_btn-dk-g) var(--_btn-dk-b));',
  '--_btn-dark: rgb(from var(--lp-brand) var(--_btn-lt-r) var(--_btn-lt-g) var(--_btn-lt-b));',
  // the accent and the marks, from the accent's source (the brand unless a Style says)
  '--lp-accent-source: var(--lp-brand);',
  '--_acc-light: rgb(from var(--lp-accent-source) var(--_acc-dk-r) var(--_acc-dk-g) var(--_acc-dk-b));',
  '--_acc-dark: rgb(from var(--lp-accent-source) var(--_acc-lt-r) var(--_acc-lt-g) var(--_acc-lt-b));',
  '--_mark-light: rgb(from var(--lp-accent-source) var(--_mark-dk-r) var(--_mark-dk-g) var(--_mark-dk-b));',
  '--_mark-dark: rgb(from var(--lp-accent-source) var(--_mark-lt-r) var(--_mark-lt-g) var(--_mark-lt-b));',
  // atmosphere
  '--_atm-acc-light: rgb(from var(--lp-accent-source) var(--_atm-acc-dk-r) var(--_atm-acc-dk-g) var(--_atm-acc-dk-b));',
  '--_atm-acc-dark: rgb(from var(--lp-accent-source) var(--_atm-acc-lt-r) var(--_atm-acc-lt-g) var(--_atm-acc-lt-b));',
  '--_atm-mark-light: rgb(from var(--lp-accent-source) var(--_atm-mark-dk-r) var(--_atm-mark-dk-g) var(--_atm-mark-dk-b));',
  '--_atm-mark-dark: rgb(from var(--lp-accent-source) var(--_atm-mark-lt-r) var(--_atm-mark-lt-g) var(--_atm-mark-lt-b));',
  '--_atm-btn-light: rgb(from var(--lp-brand) var(--_atm-btn-dk-r) var(--_atm-btn-dk-g) var(--_atm-btn-dk-b));',
  '--_atm-btn-dark: rgb(from var(--lp-brand) var(--_atm-btn-lt-r) var(--_atm-btn-lt-g) var(--_atm-btn-lt-b));',
  '--_atmos-s: max(var(--_atmos-min), var(--lp-atmosphere-scrim, 0));',
  '--_atmos-veil: rgb(from var(--lp-ground) r g b / var(--_atmos-s));',
];

describe('schemes.css ↔ model parity', () => {
  it('contains every generated fragment verbatim', () => {
    for (const line of fragments()) expect(CODE).toContain(squash(line));
  });

  it('spells every surface recipe the model implements', () => {
    for (const recipe of RECIPES) expect(CODE).toContain(squash(recipe));
  });

  it('routes each scheme to the treatment of its polarity', () => {
    const rule = (scheme: string) =>
      CODE.match(
        new RegExp(`\\.lp \\[data-lp-scheme='${scheme}'\\] \\{([^}]*)\\}`)
      )?.[1] ?? '';
    expect(rule('base')).toContain('--lp-accent: var(--_accent-g)');
    expect(rule('soft')).toContain('--lp-button-bg: var(--_button-g)');
    expect(rule('contrast')).toContain('--lp-accent: var(--_accent-i)');
    expect(rule('contrast')).toContain('--lp-button-bg: var(--_button-i)');
    // The mark follows the accent's polarity, and is the ink on a fill.
    expect(rule('base')).toContain('--lp-mark-ink: var(--_mark-g)');
    expect(rule('soft')).toContain('--lp-mark-ink: var(--_mark-g)');
    expect(rule('contrast')).toContain('--lp-mark-ink: var(--_mark-i)');
    expect(rule('accent')).toContain('--lp-mark-ink: var(--lp-ink)');
    expect(
      CODE.match(/\.lp \[data-lp-on-media\] \{([^}]*)\}/)?.[1] ?? ''
    ).toContain('--lp-mark-ink: var(--lp-ink)');
    // Atmosphere is measured against the ground, with its own brand moves.
    expect(rule('atmosphere')).toContain('--lp-bg: var(--lp-ground)');
    expect(rule('atmosphere')).toContain('--lp-accent: var(--_atmos-accent)');
    expect(rule('atmosphere')).toContain('--lp-mark-ink: var(--_atmos-mark)');
    expect(rule('atmosphere')).toContain(
      '--lp-button-bg: var(--_atmos-button)'
    );
    expect(rule('atmosphere')).toContain(
      '--lp-button-line: var(--lp-ink-soft)'
    );
  });

  it('routes atmosphere to each pole, and keeps the fallback path opaque', () => {
    expect(POLE.light).toContain('--_atmos-accent: var(--_atm-acc-light)');
    expect(POLE.light).toContain('--_atmos-mark: var(--_atm-mark-light)');
    expect(POLE.light).toContain('--_atmos-button: var(--_atm-btn-light)');
    expect(POLE.light).toContain('--_atmos-min: var(--_atmos-min-light)');
    expect(POLE.dark).toContain('--_atmos-accent: var(--_atm-acc-dark)');
    expect(POLE.dark).toContain('--_atmos-mark: var(--_atm-mark-dark)');
    expect(POLE.dark).toContain('--_atmos-button: var(--_atm-btn-dark)');
    expect(POLE.dark).toContain('--_atmos-min: var(--_atmos-min-dark)');
    // Without pow() the moved brand does not exist, so neither may the gap.
    expect(POLE.light).toContain('--_atmos-min-light: 1;');
    expect(POLE.light).toContain('--_atmos-min-dark: 1;');
  });

  it('routes the mark to each pole, as the accent is routed', () => {
    for (const [pole, own, other] of [
      ['light', 'light', 'dark'],
      ['dark', 'dark', 'light'],
    ] as const) {
      expect(POLE[pole]).toContain(`--_mark-g: var(--_mark-${own})`);
      expect(POLE[pole]).toContain(`--_mark-i: var(--_mark-${other})`);
      expect(POLE[pole]).toContain(
        `--_atmos-mark-i: var(--_atm-mark-${other})`
      );
    }
    // Without pow() a mark is the accent: text grade is graphic grade too.
    expect(POLE.light).toContain('--_mark-light: var(--_acc-light);');
    expect(POLE.light).toContain('--_mark-dark: var(--_acc-dark);');
  });

  it('moves the accent and the marks from the source, the buttons from the brand — on both paths', () => {
    // Every relative-colour recipe for a name, fallback and exact path alike.
    const froms = (name: string) =>
      [
        ...CODE.matchAll(
          new RegExp(
            `${name}: (?:rgb|oklch)\\(\\s?from var\\((--[\\w-]+)\\)`,
            'g'
          )
        ),
      ].map((m) => m[1]);
    for (const name of [
      '--_acc-light',
      '--_acc-dark',
      '--_mark-light',
      '--_mark-dark',
      '--_atm-acc-light',
      '--_atm-acc-dark',
      '--_atm-mark-light',
      '--_atm-mark-dark',
    ]) {
      expect(froms(name).length, name).toBeGreaterThan(0);
      for (const source of froms(name))
        expect(source, name).toBe('--lp-accent-source');
    }
    for (const name of [
      '--_btn-light',
      '--_btn-dark',
      '--_atm-btn-light',
      '--_atm-btn-dark',
    ]) {
      expect(froms(name).length, name).toBeGreaterThan(0);
      for (const source of froms(name)) expect(source, name).toBe('--lp-brand');
    }
    // The fallback path's accent reads it too (its button is the plain brand).
    expect(froms('--_acc-light')).toHaveLength(2);
  });
});

// ── 2. the model ────────────────────────────────────────────────────────────
type Rgb = readonly [number, number, number];
type Lab = readonly [number, number, number];

const srgbToLin = (c: number) =>
  Math.sign(c) *
  (Math.abs(c) <= 0.04045
    ? Math.abs(c) / 12.92
    : ((Math.abs(c) + 0.055) / 1.055) ** 2.4);
const linToSrgb = (c: number) =>
  Math.sign(c) *
  (Math.abs(c) <= 0.0031308
    ? 12.92 * Math.abs(c)
    : 1.055 * Math.abs(c) ** (1 / 2.4) - 0.055);
const kneeLin = (c: number) => ((c + 0.055) / 1.055) ** 2.4;
const kneeInv = (l: number) => 1.055 * Math.max(l, 0) ** (1 / 2.4) - 0.055;
/** A mapped triple, typed as the tuple it is. */
const triple = (f: (i: 0 | 1 | 2) => number): Rgb => [f(0), f(1), f(2)];
const clip = (rgb: Rgb): Rgb => triple((i) => Math.min(1, Math.max(0, rgb[i])));
const unit = (c: number) => Math.min(1, Math.max(0, c));

function hex(value: string): Rgb {
  const h = value.replace('#', '');
  return triple((i) => Number.parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255);
}

function toLab(rgb: Rgb): Lab {
  const [r, g, b] = rgb.map(srgbToLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function toRgb([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** `oklch(from X <L> <C> h)` with L and C computed from X's own l and c. */
function oklchFrom(
  rgb: Rgb,
  L: (l: number, c: number) => number,
  C: (l: number, c: number) => number
): Rgb {
  const [l, a, b] = toLab(rgb);
  const c = Math.hypot(a, b);
  const h = Math.atan2(b, a);
  const cc = C(l, c);
  return toRgb([L(l, c), cc * Math.cos(h), cc * Math.sin(h)]);
}

/** `color-mix(in oklab, A, B p)`. */
function mix(a: Rgb, b: Rgb, p: number): Rgb {
  const x = toLab(a);
  const y = toLab(b);
  return toRgb(triple((i) => x[i] * (1 - p) + y[i] * p));
}

const lum = (rgb: Rgb) => {
  const [r, g, b] = clip(rgb).map(srgbToLin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const inGamut = (rgb: Rgb) => rgb.every((c) => c >= -1e-6 && c <= 1 + 1e-6);

/** The ink fragment: `rgb(from BG var(--_<level>-r) …)` at target ratio T. */
function ink(bgIn: Rgb, t: number): Rgb {
  const L = clip(bgIn).map(kneeLin);
  const y = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
  const w = Math.min(1, Math.max(0, (0.1791 - y) * 1e6));
  const yt =
    w * Math.min(1, t * (y + 0.05) - 0.05) +
    (1 - w) * Math.max(0, (y + 0.05) / t - 0.05);
  const k = (yt - y) / Math.max(1 - y, 1e-6);
  const f = yt / Math.max(y, 1e-6);
  return triple((i) =>
    unit(kneeInv(w * (L[i] + k * (1 - L[i])) + (1 - w) * L[i] * f))
  );
}

function darken(rgb: Rgb, yMax: number): Rgb {
  const L = clip(rgb).map(kneeLin);
  const y = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
  const f = Math.min(1, yMax / Math.max(y, 1e-6));
  return triple((i) => unit(kneeInv(L[i] * f)));
}

function lighten(rgb: Rgb, yMin: number): Rgb {
  const L = clip(rgb).map(kneeLin);
  const y = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
  const s = Math.max(1, yMin / Math.max(y, 1e-6));
  const L1 = L.map((l) => Math.min(1, l * s));
  const y1 = 0.2126 * L1[0] + 0.7152 * L1[1] + 0.0722 * L1[2];
  const k = Math.max(0, (yMin - y1) / Math.max(1 - y1, 1e-6));
  return triple((i) => unit(kneeInv(L1[i] + k * (1 - L1[i]))));
}

type Mode = 'light' | 'dark';
type Scheme = 'base' | 'soft' | 'contrast' | 'brand' | 'accent';
interface Tint {
  soft: number;
  panel: number;
}

const DEFAULT_TINT: Tint = { soft: 0.08, panel: 0.14 };
const clampTo = (lo: number, v: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

function ground(mode: Mode, input: Rgb): Rgb {
  return mode === 'light'
    ? oklchFrom(
        input,
        (l) => clampTo(0.9, l, 1),
        (l, c) => c - (l < 0.9 ? 1 : 0) * Math.max(0, c - 0.046)
      )
    : oklchFrom(
        input,
        (l) => Math.min(l, 0.24),
        (l, c) => c - (l > 0.24 ? 1 : 0) * Math.max(0, c - 0.039)
      );
}

interface SchemeTokens {
  bg: Rgb;
  ink: Rgb;
  soft: Rgb;
  edge: Rgb;
  accent: Rgb;
  mark: Rgb;
  button: Rgb;
  buttonInk: Rgb;
  panel: Rgb;
  panelInk: Rgb;
}

/** `source` is `--lp-accent-source`: the brand, unless a Style points it elsewhere. */
function schemeTokens(
  mode: Mode,
  scheme: Scheme,
  g: Rgb,
  brand: Rgb,
  tint: Tint,
  source: Rgb = brand
): SchemeTokens {
  const light = mode === 'light';
  const onLight = {
    accent: darken(source, TARGET.accentLight),
    mark: darken(source, TARGET.markLight),
    button: darken(brand, TARGET.buttonLight),
  };
  const onDark = {
    accent: lighten(source, TARGET.accentDark),
    mark: lighten(source, TARGET.markDark),
    button: lighten(brand, TARGET.buttonDark),
  };
  const groundSide = light ? onLight : onDark;
  const inverseSide = light ? onDark : onLight;
  const softBg = light
    ? oklchFrom(
        mix(g, brand, tint.soft),
        (l) => clampTo(0.9, l - 0.025, 0.97),
        (l, c) => Math.min(c, (1 - clampTo(0.9, l - 0.025, 0.97)) * 0.46)
      )
    : oklchFrom(
        mix(g, brand, tint.soft + 0.02),
        (l) => clampTo(0.12, l + 0.035, 0.27),
        (l, c) => Math.min(c, clampTo(0.12, l + 0.035, 0.27) * 0.165)
      );
  const panelG = light
    ? oklchFrom(
        mix(g, brand, tint.panel),
        (l) => clampTo(0.9, l, 0.965),
        (l, c) => Math.min(c, (1 - clampTo(0.9, l, 0.965)) * 0.46)
      )
    : oklchFrom(
        mix(g, brand, tint.panel + 0.02),
        (l) => clampTo(0.2, l + 0.03, 0.28),
        (l, c) => Math.min(c, clampTo(0.2, l + 0.03, 0.28) * 0.165)
      );
  const contrastBg = light
    ? oklchFrom(
        brand,
        () => 0.2,
        (_, c) => Math.min(c * 0.3, 0.033)
      )
    : oklchFrom(
        brand,
        () => 0.955,
        (_, c) => Math.min(c * 0.12, 0.02)
      );
  const panelI = light
    ? oklchFrom(
        brand,
        () => 0.265,
        (_, c) => Math.min(c * 0.35, 0.043)
      )
    : oklchFrom(
        brand,
        () => 0.985,
        (_, c) => Math.min(c * 0.05, 0.0068)
      );

  let bg: Rgb;
  let panel: Rgb;
  let accent: Rgb;
  let mark: Rgb;
  let button: Rgb;
  let buttonInk: Rgb;
  if (scheme === 'base' || scheme === 'soft') {
    bg = scheme === 'base' ? g : softBg;
    panel = scheme === 'base' ? panelG : g;
    accent = groundSide.accent;
    mark = groundSide.mark;
    button = groundSide.button;
    buttonInk = ink(button, INK.ink);
  } else if (scheme === 'contrast') {
    bg = contrastBg;
    panel = panelI;
    accent = inverseSide.accent;
    mark = inverseSide.mark;
    button = inverseSide.button;
    buttonInk = ink(button, INK.ink);
  } else {
    // `accent` fills with an arbitrary second colour — the same class of fill.
    bg = brand;
    panel = g;
    accent = ink(bg, INK.ink);
    mark = accent;
    button = accent;
    buttonInk = bg;
  }
  return {
    bg,
    ink: ink(bg, INK.ink),
    soft: ink(bg, INK.soft),
    edge: ink(bg, INK.edge),
    accent,
    mark,
    button,
    buttonInk,
    panel,
    panelInk: ink(panel, INK.ink),
  };
}

const FLOORS = {
  ink: 4.5,
  soft: 4.5,
  accent: 4.5,
  // WCAG 1.4.11: a graphic a visitor needs to see, not text to read.
  mark: 3,
  button: 3,
  buttonInk: 4.5,
  edge: 3,
  panelInk: 4.5,
};

function ratios(t: SchemeTokens) {
  return {
    ink: ratio(t.ink, t.bg),
    soft: ratio(t.soft, t.bg),
    accent: ratio(t.accent, t.bg),
    mark: ratio(t.mark, t.bg),
    button: ratio(t.button, t.bg),
    buttonInk: ratio(t.buttonInk, t.button),
    edge: ratio(t.edge, t.bg),
    panelInk: ratio(t.panelInk, t.panel),
  };
}

// ── 3. the named matrix ─────────────────────────────────────────────────────
const BRANDS = {
  'pale apricot': '#F7D9B9',
  'pale butter': '#FFF3B0',
  'studio-alpha crimson': '#E11D48',
  vermilion: '#E4572E',
  'studio-beta blue': '#2563EB',
  'ink navy': '#1B2A41',
  'near black': '#111111',
  'deep plum': '#2B0A3D',
  white: '#FFFFFF',
  'very light grey': '#F4F4F0',
  teal: '#0D9488',
  emerald: '#059669',
  'mid grey': '#808080',
  'pure red': '#EC0008',
} as const;

/** Page grounds as the org layout or a page override supplies them. */
const GROUNDS: Record<Mode, Record<string, string>> = {
  light: {
    platform: '#fafafa',
    cream: '#F6EFE6',
    'mid beige': '#D9CBB8',
    'dark as light': '#1a1a2e',
  },
  dark: {
    platform: '#171717',
    'deep red': '#200000',
    navy: '#101018',
    'cream (no dark)': '#F6EFE6',
  },
};

/** Every tint a Style ships, keyed by Style id; `default` is the kit's own.
 * 'models every tint a Style ships' holds this to the stylesheets. */
const STYLE_TINTS: Record<string, Tint> = {
  default: DEFAULT_TINT,
  soft: { soft: 0.16, panel: 0.22 },
  cinematic: { soft: 0.1, panel: 0.14 },
  clean: { soft: 0.05, panel: 0.14 },
};

const SCHEMES: Scheme[] = ['base', 'soft', 'contrast', 'brand', 'accent'];

// 03 §13 X19. The brand editor's default secondary is #737373, so most orgs
// carry a grey they never chose; the second colour must skip it. Measured live
// (Chromium, studio-alpha's grey secondary + amber accent): the accent band
// paints the amber; a real secondary paints itself within 1/255.
describe('the second colour skips a neutral secondary (03 X19)', () => {
  const rule = (selector: string) =>
    CODE.slice(CODE.indexOf(selector)).match(/\{([^}]*)\}/)?.[1] ?? '';
  const PICK = (candidate: string, fallback: string) =>
    `rgb( from color-mix( in srgb, oklch(from var(${candidate}) l c h / clamp(0, (c - 0.02) * 1000, 1)) 50%, rgb(from var(${fallback}) r g b / 0.004) 50% ) r g b / 1 )`;

  it('picks the secondary if it has chroma, else the accent, else the primary turned', () => {
    expect(CODE).toContain(
      `--lp-brand-2: ${PICK('--_second-in', '--_second-or-shift')};`
    );
    expect(CODE).toContain(
      `--_second-or-shift: ${PICK('--_accent-in', '--_second-shift')};`
    );
    expect(CODE).toContain(
      '--_second-shift: oklch(from var(--lp-brand) l min(c, 0.17 * l, 0.46 * (1 - l)) calc(h + 45));'
    );
  });

  it('reads each pole’s own inputs, falling through unset ones', () => {
    const light = rule('.lp {');
    expect(light).toContain(
      '--_accent-in: var(--brand-accent, var(--_second-shift));'
    );
    expect(light).toContain(
      '--_second-in: var(--brand-secondary, var(--_accent-in));'
    );
    const dark = rule(".lp[data-lp-style='cinematic'] {");
    expect(dark).toContain(
      '--_accent-in: var(--brand-accent-dark, var(--brand-accent, var(--_second-shift)));'
    );
    expect(dark).toContain(
      '--_second-in: var(--brand-secondary-dark, var(--brand-secondary, var(--_accent-in)));'
    );
    // Only the root rule picks; the dark pole must not reintroduce a plain chain.
    expect(dark).not.toContain('--lp-brand-2');
  });

  it('keeps a real colour to within about 1/255 and takes the fallback exactly (premultiplied mix)', () => {
    // color-mix interpolates premultiplied: each colour weighs share × alpha.
    const pick = (a: Rgb, aAlpha: number, b: Rgb): number[] => {
      const wa = 0.5 * aAlpha;
      const wb = 0.5 * 0.004;
      return a.map((v, i) => (wa * v + wb * b[i]) / (wa + wb));
    };
    const blue: Rgb = [29, 78, 137];
    const amber: Rgb = [245, 158, 11];
    const kept = pick(blue, 1, amber);
    for (const [i, v] of kept.entries())
      expect(Math.abs(v - blue[i])).toBeLessThanOrEqual(1.02);
    expect(pick([115, 115, 115], 0, amber)).toEqual(amber);
  });
});

describe('the tints the model proves are the tints that ship', () => {
  // A hand-kept list drifts: Clean shipped a 5% tint while this file still
  // proved it at the default 8%. Read every Style's stylesheet (its partials
  // included, comments stripped) and hold STYLE_TINTS to what it declares.
  it('models every tint a Style ships', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const declared = new Map<string, { soft?: number; panel?: number }>();
    for (const file of readdirSync(dir)) {
      const id = file.match(/^style-([a-z]+)(?:-[a-z]+)?\.css$/)?.[1];
      if (!id) continue;
      const css = readFileSync(join(dir, file), 'utf8').replace(
        /\/\*[\s\S]*?\*\//g,
        ''
      );
      const tint = declared.get(id) ?? {};
      for (const key of ['soft', 'panel'] as const) {
        const value = css.match(
          new RegExp(`--lp-tint-${key}:\\s*([\\d.]+)%`)
        )?.[1];
        if (value !== undefined) tint[key] = Number(value) / 100;
      }
      declared.set(id, tint);
    }
    expect(declared.size).toBe(8);
    for (const [id, tint] of declared) {
      const modelled = STYLE_TINTS[id] ?? DEFAULT_TINT;
      expect(modelled.soft, `${id}: soft tint`).toBeCloseTo(
        tint.soft ?? DEFAULT_TINT.soft
      );
      expect(modelled.panel, `${id}: panel tint`).toBeCloseTo(
        tint.panel ?? DEFAULT_TINT.panel
      );
    }
  });
});

describe('the §5 floors — named brand matrix', () => {
  for (const mode of ['light', 'dark'] as const) {
    for (const [groundName, groundHex] of Object.entries(GROUNDS[mode])) {
      it(`${mode} theme on the ${groundName} ground: every brand, scheme and Style tint`, () => {
        const g = ground(mode, hex(groundHex));
        const failures: string[] = [];
        for (const [brandName, brandHex] of Object.entries(BRANDS)) {
          for (const [styleName, tint] of Object.entries(STYLE_TINTS)) {
            for (const scheme of SCHEMES) {
              const r = ratios(
                schemeTokens(mode, scheme, g, hex(brandHex), tint)
              );
              for (const [token, floor] of Object.entries(FLOORS)) {
                const value = r[token as keyof typeof r];
                if (value < floor) {
                  failures.push(
                    `${brandName}/${styleName}/${scheme} ${token} ${value.toFixed(2)}`
                  );
                }
              }
            }
          }
        }
        expect(failures).toEqual([]);
      });
    }
  }

  it('leaves a brand that already passes exactly as the creator picked it', () => {
    const g = ground('light', hex('#fafafa'));
    const t = schemeTokens('light', 'base', g, hex('#2563EB'), DEFAULT_TINT);
    expect(t.button.map((c) => Math.round(c * 255))).toEqual([
      0x25, 0x63, 0xeb,
    ]);
  });

  it('keeps every derived surface inside sRGB, so relative colour never sees a channel outside 0–255', () => {
    const outside: string[] = [];
    for (const mode of ['light', 'dark'] as const) {
      for (const groundHex of Object.values(GROUNDS[mode])) {
        const g = ground(mode, hex(groundHex));
        for (const brandHex of Object.values(BRANDS)) {
          for (const scheme of ['base', 'soft', 'contrast'] as const) {
            const t = schemeTokens(
              mode,
              scheme,
              g,
              hex(brandHex),
              STYLE_TINTS.soft
            );
            if (!inGamut(t.bg) || !inGamut(t.panel))
              outside.push(`${mode}/${groundHex}/${brandHex}/${scheme}`);
          }
        }
      }
    }
    expect(outside).toEqual([]);
  });

  it('holds text over imagery: full ink on a 72% scrim over a pure white photo', () => {
    for (const brandHex of Object.values(BRANDS)) {
      const scrim = oklchFrom(
        hex(brandHex),
        () => 0.16,
        (_, c) => Math.min(c * 0.25, 0.027)
      );
      const under = triple((i) => scrim[i] * 0.72 + (1 - 0.72));
      expect(ratio(ink(scrim, INK.ink), under)).toBeGreaterThan(4.5);
      // The button over imagery: an ink fill carrying a scrim-coloured label.
      expect(ratio(scrim, ink(scrim, INK.ink))).toBeGreaterThan(7);
    }
  });
});

// ── 4. a generated sweep, so no band of the gamut is left unmeasured ────────
describe('the §5 floors — generated sweep of the sRGB cube', () => {
  it('holds for 4 096 brands × both poles × every scheme', () => {
    const worst: Record<string, number> = {};
    const step = 17;
    for (const mode of ['light', 'dark'] as const) {
      const g = ground(mode, hex(mode === 'light' ? '#fafafa' : '#171717'));
      for (let r = 0; r < 256; r += step) {
        for (let gr = 0; gr < 256; gr += step) {
          for (let b = 0; b < 256; b += step) {
            const brand = [r / 255, gr / 255, b / 255] as const;
            for (const scheme of SCHEMES) {
              const values = ratios(
                schemeTokens(mode, scheme, g, brand, DEFAULT_TINT)
              );
              for (const [token, value] of Object.entries(values)) {
                worst[token] = Math.min(
                  worst[token] ?? Number.POSITIVE_INFINITY,
                  value
                );
              }
            }
          }
        }
      }
    }
    for (const [token, floor] of Object.entries(FLOORS)) {
      expect(worst[token], token).toBeGreaterThanOrEqual(floor);
    }
    // The brand fill's own ink is the provable 4.58:1 luminance crossover.
    expect(worst.ink).toBeGreaterThan(4.57);
  });
});

// ── 5. atmosphere: a uniform veil over ANY backdrop (03 §5.1) ───────────────
/*
 * An atmosphere section paints its pole's ground at strength `s` over whatever
 * is behind it — the org's shader, or the kit's glow — and browsers composite
 * in encoded sRGB, so the result is `s·ground + (1 − s)·backdrop` per channel.
 * Contrast against that is monotonic in the backdrop, so pure black and pure
 * white bound every shader frame and every glow. (The glow fallback paints the
 * glow at opacity `1 − s` over the opaque ground, which is the same sum.)
 */
const VEIL: Record<Mode, number> = {
  light: Number(EXACT.match(/--_atmos-min-light: ([\d.]+);/)?.[1]),
  dark: Number(EXACT.match(/--_atmos-min-dark: ([\d.]+);/)?.[1]),
};

/** What an atmosphere section's tokens are, per the scheme block. */
function atmosphereTokens(
  mode: Mode,
  g: Rgb,
  brand: Rgb,
  tint: Tint,
  moved = true
): SchemeTokens {
  const base = schemeTokens(mode, 'base', g, brand, tint);
  if (!moved) return base;
  const light = mode === 'light';
  const button = light
    ? darken(brand, TARGET.atmosButtonLight)
    : lighten(brand, TARGET.atmosButtonDark);
  return {
    ...base,
    accent: light
      ? darken(brand, TARGET.atmosAccentLight)
      : lighten(brand, TARGET.atmosAccentDark),
    mark: light
      ? darken(brand, TARGET.atmosMarkLight)
      : lighten(brand, TARGET.atmosMarkDark),
    button,
    buttonInk: ink(button, INK.ink),
    // `--lp-button-line: var(--lp-ink-soft)`.
    edge: base.soft,
  };
}

/** Floors measured against the veil over each backdrop; focus is the ink. */
const OVER_BACKDROP = {
  ink: 4.5,
  soft: 4.5,
  accent: 4.5,
  mark: 3,
  button: 3,
  edge: 3,
  focus: 3,
} as const;

function veilFailures(s: number, t: SchemeTokens): string[] {
  const out: string[] = [];
  for (const [name, backdrop] of [
    ['black', 0],
    ['white', 1],
  ] as const) {
    const seen = triple((i) => s * clip(t.bg)[i] + (1 - s) * backdrop);
    const r = {
      ink: ratio(t.ink, seen),
      soft: ratio(t.soft, seen),
      accent: ratio(t.accent, seen),
      mark: ratio(t.mark, seen),
      button: ratio(t.button, seen),
      edge: ratio(t.edge, seen),
      focus: ratio(t.ink, seen),
    };
    for (const [token, floor] of Object.entries(OVER_BACKDROP)) {
      const value = r[token as keyof typeof r];
      if (value < floor) out.push(`${token} over ${name} ${value.toFixed(2)}`);
    }
  }
  // Opaque on top of the veil, so measured against themselves.
  if (ratio(t.buttonInk, t.button) < FLOORS.buttonInk) out.push('buttonInk');
  if (ratio(t.panelInk, t.panel) < FLOORS.panelInk) out.push('panelInk');
  return out;
}

/** Named matrix, a 4 096-brand sweep, and a 216-ground sweep per pole. */
function atmosphereCases(mode: Mode): [Rgb, Rgb, Tint][] {
  const cases: [Rgb, Rgb, Tint][] = [];
  for (const groundHex of Object.values(GROUNDS[mode]))
    for (const brandHex of Object.values(BRANDS))
      for (const tint of Object.values(STYLE_TINTS))
        cases.push([ground(mode, hex(groundHex)), hex(brandHex), tint]);
  const platform = ground(mode, hex(mode === 'light' ? '#fafafa' : '#171717'));
  for (let r = 0; r < 256; r += 17)
    for (let gr = 0; gr < 256; gr += 17)
      for (let b = 0; b < 256; b += 17)
        cases.push([platform, [r / 255, gr / 255, b / 255], DEFAULT_TINT]);
  for (let r = 0; r < 256; r += 51)
    for (let gr = 0; gr < 256; gr += 51)
      for (let b = 0; b < 256; b += 51)
        for (const brandHex of Object.values(BRANDS))
          cases.push([
            ground(mode, [r / 255, gr / 255, b / 255]),
            hex(brandHex),
            DEFAULT_TINT,
          ]);
  return cases;
}

function failuresAt(mode: Mode, s: number, moved = true): string[] {
  return atmosphereCases(mode).flatMap(([g, brand, tint]) =>
    veilFailures(s, atmosphereTokens(mode, g, brand, tint, moved))
  );
}

describe('atmosphere — the veil over the worst backdrops', () => {
  it('reads a real strength for each pole from the exact path', () => {
    for (const mode of ['light', 'dark'] as const) {
      expect(VEIL[mode]).toBeGreaterThan(0.5);
      expect(VEIL[mode]).toBeLessThan(1);
    }
  });

  for (const mode of ['light', 'dark'] as const) {
    it(`${mode}: holds every floor over pure black and pure white`, () => {
      expect(failuresAt(mode, VEIL[mode])).toEqual([]);
    });

    it(`${mode}: is the thinnest such veil — 0.01 less loses the soft ink`, () => {
      const thinner = failuresAt(mode, VEIL[mode] - 0.01);
      expect(thinner.length).toBeGreaterThan(0);
      expect(thinner.some((f) => f.startsWith('soft over'))).toBe(true);
    });

    it(`${mode}: needs the moved brand — the usual accent fails at this veil`, () => {
      expect(failuresAt(mode, VEIL[mode], false).length).toBeGreaterThan(0);
    });
  }
});

/*
 * Where no shader runs, the section is its opaque ground plus a glow in the
 * brand's hues at a fixed lightness (`--_glow-l`, chroma capped `--_glow-c`),
 * at `--_glow-strength`. Its colour is known, so it is measured itself — as
 * the backdrop, at full strength under every word — for every brand as either
 * light (the primary or a second colour are both "any brand" here).
 */
const GLOW = {
  light: {
    l: Number(POLE.light.match(/--_glow-l: ([\d.]+);/)?.[1]),
    c: Number(POLE.light.match(/--_glow-c: ([\d.]+);/)?.[1]),
  },
  dark: {
    l: Number(POLE.dark.match(/--_glow-l: ([\d.]+);/)?.[1]),
    c: Number(POLE.dark.match(/--_glow-c: ([\d.]+);/)?.[1]),
  },
  strength: Number(EXACT.match(/--_glow-strength: ([\d.]+);/)?.[1]),
};

function glowFailures(
  mode: Mode,
  strength: number,
  l = GLOW[mode].l
): string[] {
  return atmosphereCases(mode).flatMap(([g, brand, tint]) => {
    const t = atmosphereTokens(mode, g, brand, tint);
    const glow = oklchFrom(
      brand,
      () => l,
      (_, c) => Math.min(c, GLOW[mode].c)
    );
    const seen = triple(
      (i) => strength * clip(glow)[i] + (1 - strength) * clip(t.bg)[i]
    );
    return Object.entries(OVER_BACKDROP)
      .filter(([token, floor]) => {
        const colour =
          token === 'focus' ? t.ink : t[token as keyof SchemeTokens];
        return ratio(colour, seen) < floor;
      })
      .map(([token]) => token);
  });
}

describe('atmosphere — the glow where no shader runs', () => {
  it('is off on the fallback path, on at a real strength on the exact one', () => {
    expect(POLE.light).toContain('--_glow-strength: 0;');
    expect(GLOW.strength).toBeGreaterThan(0.5);
    expect(GLOW.strength).toBeLessThanOrEqual(1);
    for (const mode of ['light', 'dark'] as const) {
      expect(GLOW[mode].l).toBeGreaterThan(0);
      expect(GLOW[mode].c).toBeGreaterThan(0);
    }
  });

  for (const mode of ['light', 'dark'] as const) {
    it(`${mode}: every word keeps its floor over the glow at full strength`, () => {
      expect(glowFailures(mode, GLOW.strength)).toEqual([]);
    });
  }

  it('has teeth: a glow lifted toward the ink fails', () => {
    // A light-pole glow at the ink's side of the ground, or a dark-pole one
    // lifted to mid-grey, is the brightness the recipe exists to avoid.
    expect(glowFailures('light', 1, 0.6).length).toBeGreaterThan(0);
    expect(glowFailures('dark', 1, 0.55).length).toBeGreaterThan(0);
  });
});

// ── 6. textures and shapes behind the words (03 §5.2) ───────────────────────
/*
 * A texture paints `--_tex-ink` and shapes `--_shape-ink` behind the text, so
 * every floor is measured against the section colour with that paint over
 * it. On a decorated page base / soft / contrast take atmosphere's moved
 * brand and the soft-ink ghost line; brand / accent bands paint AWAY from
 * their ink (white under dark ink, black under light), which only raises
 * every ratio.
 */
const SURFACES = squash(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'surfaces.css'),
    'utf8'
  ).replace(/\/\*[\s\S]*?\*\//g, '')
);
const SHAPE_ALPHA = Number(SURFACES.match(/--_shape-alpha: ([\d.]+);/)?.[1]);
const DECORATED =
  CODE.match(
    /@container lp-page (style\([^{]*\)) \{ \.lp :is\(\[data-lp-scheme='base'\], \[data-lp-scheme='soft'\]\) \{([^}]*)\} \.lp \[data-lp-scheme='contrast'\] \{([^}]*)\} \}/
  ) ?? [];

type Decorated = SchemeTokens & { texture: Rgb; shape: Rgb };

function decoratedTokens(
  mode: Mode,
  scheme: Scheme,
  g: Rgb,
  brand: Rgb,
  tint: Tint,
  moved = true
): Decorated {
  const t = schemeTokens(mode, scheme, g, brand, tint);
  if (scheme === 'brand' || scheme === 'accent') {
    // `oklch(from var(--lp-ink) clamp(0, (0.5 - l) * 1000, 1) 0 0)`.
    const anti: Rgb = toLab(t.ink)[0] < 0.5 ? [1, 1, 1] : [0, 0, 0];
    return { ...t, texture: mix(t.bg, anti, 0.4), shape: anti };
  }
  const line = ink(t.bg, INK.line);
  if (!moved) return { ...t, texture: line, shape: t.accent };
  // base / soft sit on the ground's polarity, contrast on the other.
  const light = (mode === 'light') !== (scheme === 'contrast');
  const accent = light
    ? darken(brand, TARGET.atmosAccentLight)
    : lighten(brand, TARGET.atmosAccentDark);
  const button = light
    ? darken(brand, TARGET.atmosButtonLight)
    : lighten(brand, TARGET.atmosButtonDark);
  return {
    ...t,
    accent,
    mark: light
      ? darken(brand, TARGET.atmosMarkLight)
      : lighten(brand, TARGET.atmosMarkDark),
    button,
    buttonInk: ink(button, INK.ink),
    edge: t.soft,
    texture: line,
    shape: accent,
  };
}

/** Floors against the section colour with `layers` painted over it, in order. */
function behindFailures(t: Decorated, layers: [Rgb, number][]): string[] {
  let seen = clip(t.bg);
  for (const [paint, alpha] of layers)
    seen = triple((i) => alpha * clip(paint)[i] + (1 - alpha) * seen[i]);
  const r = {
    ink: ratio(t.ink, seen),
    soft: ratio(t.soft, seen),
    accent: ratio(t.accent, seen),
    mark: ratio(t.mark, seen),
    button: ratio(t.button, seen),
    edge: ratio(t.edge, seen),
    focus: ratio(t.ink, seen),
  };
  return Object.entries(OVER_BACKDROP)
    .filter(([token, floor]) => r[token as keyof typeof r] < floor)
    .map(([token]) => token);
}

function decoratedCases(mode: Mode): [Rgb, Rgb, Tint][] {
  const cases: [Rgb, Rgb, Tint][] = [];
  for (const groundHex of Object.values(GROUNDS[mode]))
    for (const brandHex of Object.values(BRANDS))
      for (const tint of Object.values(STYLE_TINTS))
        cases.push([ground(mode, hex(groundHex)), hex(brandHex), tint]);
  const platform = ground(mode, hex(mode === 'light' ? '#fafafa' : '#171717'));
  for (let r = 0; r < 256; r += 17)
    for (let gr = 0; gr < 256; gr += 17)
      for (let b = 0; b < 256; b += 17)
        cases.push([platform, [r / 255, gr / 255, b / 255], DEFAULT_TINT]);
  return cases;
}

function surfaceFailures(
  mode: Mode,
  layers: (t: Decorated) => [Rgb, number][],
  moved = true
): string[] {
  const out: string[] = [];
  for (const [g, brand, tint] of decoratedCases(mode))
    for (const scheme of SCHEMES) {
      const t = decoratedTokens(mode, scheme, g, brand, tint, moved);
      for (const token of behindFailures(t, layers(t)))
        out.push(`${scheme} ${token}`);
    }
  return out;
}

describe('textures and shapes — behind the words', () => {
  it('draws them only where the decorated treatment applies', () => {
    expect(SHAPE_ALPHA).toBeGreaterThan(0);
    expect(SHAPE_ALPHA).toBeLessThan(1);
    const [, query = '', softBase = '', contrast = ''] = DECORATED;
    // Every surface `surfaces.css` can draw is one the moves cover.
    const drawn =
      SURFACES.match(/style\(--lp-(texture|shapes): [a-z]+\)/g) ?? [];
    expect(drawn.length).toBeGreaterThanOrEqual(4);
    for (const surface of new Set(drawn)) expect(query).toContain(surface);
    expect(softBase).toContain('--lp-accent: var(--_atmos-accent)');
    expect(softBase).toContain('--lp-mark-ink: var(--_atmos-mark)');
    expect(softBase).toContain('--lp-button-bg: var(--_atmos-button)');
    expect(softBase).toContain('--lp-button-line: var(--lp-ink-soft)');
    expect(contrast).toContain('--lp-accent: var(--_atmos-accent-i)');
    expect(contrast).toContain('--lp-mark-ink: var(--_atmos-mark-i)');
    expect(contrast).toContain('--lp-button-bg: var(--_atmos-button-i)');
    expect(contrast).toContain('--lp-button-line: var(--lp-ink-soft)');
    for (const recipe of [
      '--_tex-ink: var(--lp-line);',
      '--_shape-ink: var(--lp-accent);',
      '--_anti-ink: oklch(from var(--lp-ink) clamp(0, (0.5 - l) * 1000, 1) 0 0);',
      '--_tex-ink: color-mix(in oklab, var(--lp-bg), var(--_anti-ink) 40%);',
      '--_shape-ink: var(--_anti-ink);',
    ])
      expect(CODE).toContain(recipe);
  });

  // Each sweep runs the 4 096-brand cube once per strength or layering: ~8s
  // on a quiet machine, past the 15s default at a load average of 24–41
  // (S3's runs). The work is fixed and deterministic, so the limit is sized
  // to it rather than to the default; a pathological slowdown still fails.
  const SWEEP_TIMEOUT = 60_000;

  for (const mode of ['light', 'dark'] as const) {
    it(
      `${mode}: a texture at any strength holds every floor`,
      { timeout: SWEEP_TIMEOUT },
      () => {
        for (const strength of [0.25, 0.5, 0.75, 1])
          expect(surfaceFailures(mode, (t) => [[t.texture, strength]])).toEqual(
            []
          );
      }
    );

    it(
      `${mode}: shapes at their alpha, and a texture over them, hold every floor`,
      { timeout: SWEEP_TIMEOUT },
      () => {
        for (const layers of [
          (t: Decorated): [Rgb, number][] => [[t.shape, SHAPE_ALPHA / 2]],
          (t: Decorated): [Rgb, number][] => [[t.shape, SHAPE_ALPHA]],
          (t: Decorated): [Rgb, number][] => [
            [t.shape, SHAPE_ALPHA],
            [t.texture, 0.5],
          ],
          (t: Decorated): [Rgb, number][] => [
            [t.shape, SHAPE_ALPHA],
            [t.texture, 1],
          ],
        ])
          expect(surfaceFailures(mode, layers)).toEqual([]);
      }
    );
  }

  it('has teeth: shapes a little past their alpha, or on the usual brand, fail', () => {
    const past = (t: Decorated): [Rgb, number][] => [
      [t.shape, SHAPE_ALPHA + 0.04],
    ];
    const at = (t: Decorated): [Rgb, number][] => [[t.shape, SHAPE_ALPHA]];
    expect(
      [...surfaceFailures('light', past), ...surfaceFailures('dark', past)]
        .length
    ).toBeGreaterThan(0);
    expect(
      [
        ...surfaceFailures('light', at, false),
        ...surfaceFailures('dark', at, false),
      ].length
    ).toBeGreaterThan(0);
  });
});

// ── 7. the atmosphere panel (03 X9) ─────────────────────────────────────────
/*
 * `panel` moves the veil, it never removes it: the section is cleared only by
 * the selector that draws the card, and the card IS the proven veil — so the
 * §5 proof covers every word inside it. Where the words sit is a layout
 * question, checked in the browser (every hero layout and the CTA band).
 */
describe('atmosphere panel — the veil moved, never removed', () => {
  const start = SURFACES.indexOf(
    '@container lp-page style(--lp-atmosphere-veil: panel)'
  );
  const PANEL = SURFACES.slice(
    start,
    SURFACES.indexOf('@container lp-page style(--lp-texture: grain)')
  );
  const SECTION =
    ".lp-section[data-lp-scheme='atmosphere']:not([data-lp-on-media], :has(> .lp-inner > .lp-bleed))";

  it('draws the card in the veil itself', () => {
    expect(start).toBeGreaterThan(0);
    const draw = PANEL.slice(
      PANEL.indexOf(`${SECTION} > .lp-surface::after {`)
    );
    expect(draw.slice(0, draw.indexOf('}'))).toContain(
      'background: var(--_atmos-veil);'
    );
  });

  it('clears a section only where it draws the card, under the live veil gate', () => {
    // The section condition appears twice: the card, and the clear.
    expect(PANEL.split(SECTION).length - 1).toBe(2);
    const gate = PANEL.indexOf('@supports (color: rgb(from red r g b / 0.5))');
    expect(gate).toBeGreaterThan(0);
    const clear = PANEL.slice(gate);
    expect(clear).toContain(`${SECTION} { background: transparent; }`);
    // Nothing outside the panel query clears an atmosphere section's veil.
    const elsewhere =
      SURFACES.slice(0, start) + SURFACES.slice(start + PANEL.length);
    expect(elsewhere).not.toMatch(
      /\.lp-section\[data-lp-scheme='atmosphere'\][^{]*\{ background: transparent/
    );
  });
});

// ── 8. the accent's source is the Style's to choose ────────────────────────
/*
 * A Style may move the accent and the marks from a colour other than the
 * brand (`--lp-accent-source`; Path draws its route in the second colour), so
 * they no longer share a brand with the surfaces under them — which is all
 * §3–§6 sample. Every move lands on an absolute luminance and a ratio reads
 * luminance only, so it is enough that ANY source, moved, clears the worst
 * backdrop its band can hold: the darkest light one and the lightest dark one,
 * over §5's cases (every ground swept).
 */
describe('the accent source is free — any colour, on the worst backdrop of its band', () => {
  type Band = 'light' | 'dark';
  type Worst = Partial<Record<Band, Rgb>>;
  type Family = 'plain' | 'atmosphere' | 'decorated';
  const keep = (family: Worst, band: Band, seen: Rgb) => {
    const cur = family[band];
    if (
      !cur ||
      (band === 'light' ? lum(seen) < lum(cur) : lum(seen) > lum(cur))
    )
      family[band] = seen;
  };
  const over = (paint: Rgb, alpha: number, under: Rgb): Rgb =>
    triple((i) => alpha * clip(paint)[i] + (1 - alpha) * clip(under)[i]);

  // Measured once, on first use, inside a test (and its timeout).
  let measured: Record<Family, Worst> | null = null;
  function backdrops(): Record<Family, Worst> {
    if (measured) return measured;
    const worst: Record<Family, Worst> = {
      plain: {},
      atmosphere: {},
      decorated: {},
    };
    for (const mode of ['light', 'dark'] as const)
      for (const [g, brand, tint] of atmosphereCases(mode)) {
        for (const scheme of ['base', 'soft', 'contrast'] as const) {
          const bg = schemeTokens(mode, scheme, g, brand, tint).bg;
          const band: Band =
            (mode === 'light') !== (scheme === 'contrast') ? 'light' : 'dark';
          keep(worst.plain, band, bg);
          // A texture at any strength, and shapes in ANY colour — the source's
          // moved accent can be anything — at their alpha, a texture over them.
          const line = ink(bg, INK.line);
          const shape: Rgb = band === 'light' ? [0, 0, 0] : [1, 1, 1];
          for (const strength of [0.25, 0.5, 0.75, 1])
            keep(worst.decorated, band, over(line, strength, bg));
          const shaped = over(shape, SHAPE_ALPHA, bg);
          for (const seen of [
            over(shape, SHAPE_ALPHA / 2, bg),
            shaped,
            over(line, 0.5, shaped),
          ])
            keep(worst.decorated, band, seen);
        }
        keep(worst.atmosphere, mode, over(g, VEIL[mode], [0, 0, 0]));
        keep(worst.atmosphere, mode, over(g, VEIL[mode], [1, 1, 1]));
        const glow = oklchFrom(
          brand,
          () => GLOW[mode].l,
          (_, c) => Math.min(c, GLOW[mode].c)
        );
        keep(worst.atmosphere, mode, over(glow, GLOW.strength, g));
      }
    measured = worst;
    return worst;
  }

  const SOURCES: Rgb[] = Object.values(BRANDS).map(hex);
  for (let r = 0; r < 256; r += 17)
    for (let gr = 0; gr < 256; gr += 17)
      for (let b = 0; b < 256; b += 17)
        SOURCES.push([r / 255, gr / 255, b / 255]);

  /** The lowest ratio any source, moved to (yLight, yDark), makes in `family`. */
  function lowest(family: Family, yLight: number, yDark: number): number {
    const { light, dark } = backdrops()[family];
    if (!light || !dark) throw new Error(`no ${family} backdrop measured`);
    let low = Number.POSITIVE_INFINITY;
    for (const s of SOURCES)
      low = Math.min(
        low,
        ratio(darken(s, yLight), light),
        ratio(lighten(s, yDark), dark)
      );
    return low;
  }

  // The same fixed, deterministic work as §6's sweeps, sized the same way.
  const TIMEOUT = { timeout: 60_000 };

  it(
    'measures real backdrops: the bands’ own floors, darker / lighter once decorated',
    TIMEOUT,
    () => {
      const { plain, decorated } = backdrops();
      if (!plain.light || !plain.dark || !decorated.light || !decorated.dark)
        throw new Error('a band has no backdrop');
      expect(lum(plain.light)).toBeLessThan(0.75);
      expect(lum(plain.dark)).toBeGreaterThan(0.015);
      expect(lum(decorated.light)).toBeLessThan(lum(plain.light));
      expect(lum(decorated.dark)).toBeGreaterThan(lum(plain.dark));
    }
  );

  it(
    'holds the accent (4.5:1) and the mark (3.3:1, its margin) on any section surface',
    TIMEOUT,
    () => {
      expect(
        lowest('plain', TARGET.accentLight, TARGET.accentDark)
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        lowest('plain', TARGET.markLight, TARGET.markDark)
      ).toBeGreaterThanOrEqual(3.3);
    }
  );

  it(
    'holds the moved accent and mark over the veil and the glow, and the moved mark over any texture or shapes',
    TIMEOUT,
    () => {
      expect(
        lowest('atmosphere', TARGET.atmosAccentLight, TARGET.atmosAccentDark)
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        lowest('atmosphere', TARGET.atmosMarkLight, TARGET.atmosMarkDark)
      ).toBeGreaterThanOrEqual(3);
      // Not the moved ACCENT here: with every ground swept (§6 sweeps brands on
      // the platform ground only), a full-strength texture on a dark tinted
      // ground takes it to 4.47:1 even as its own brand — a text floor, and an
      // open finding, not a property of the source.
      expect(
        lowest('decorated', TARGET.atmosMarkLight, TARGET.atmosMarkDark)
      ).toBeGreaterThanOrEqual(3);
    }
  );

  it(
    'has teeth: a mark moved only as far as white asks (0.28 on light) fails a light band',
    TIMEOUT,
    () => {
      expect(lowest('plain', 0.28, TARGET.markDark)).toBeLessThan(3);
    }
  );
});

// ── 9. a mark is a graphic, never text or a button ──────────────────────────
describe('the mark is graphic grade only', () => {
  const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return /\.(css|svelte)$/.test(entry.name) ? [path] : [];
    });
  // Text colour, or a button token, taken from the mark. A colour COMPUTED
  // against it (the ink on a filled stop) is neither.
  const MISUSE = [
    /(?:^|[\s;{("'])(?:color|-webkit-text-fill-color)\s*:[^;{}]*--lp-mark-ink/,
    /--lp-button-[\w-]+\s*:[^;{}]*--lp-mark-ink/,
  ];
  const misused = (source: string) => {
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    return MISUSE.some((pattern) => pattern.test(code));
  };

  it('finds a mark used as text or as a button, and nothing else (calibration)', () => {
    for (const css of [
      '.a { color: var(--lp-mark-ink); }',
      '.a{color:var(--lp-mark-ink)}',
      '<p style="color: var(--lp-mark-ink)">',
      '.a { --lp-button-bg: var(--lp-mark-ink); }',
    ])
      expect(misused(css), css).toBe(true);
    for (const css of [
      '.a { background: var(--lp-mark-ink); }',
      '.a { border-color: var(--lp-mark-ink); stroke: var(--lp-mark-ink); }',
      '.a { --_on: oklch(from var(--lp-mark-ink) 0 0 0); color: var(--_on); }',
      '.a { /* color: var(--lp-mark-ink) */ }',
    ])
      expect(misused(css), css).toBe(false);
  });

  it('is never the colour of text or of a button anywhere in the kit', () => {
    const files = walk(KIT);
    expect(files.length).toBeGreaterThan(60);
    const users = files.filter((file) =>
      readFileSync(file, 'utf8').includes('--lp-mark-ink')
    );
    // Not vacuous: the schemes declare it and Path draws with it.
    expect(users.length).toBeGreaterThanOrEqual(2);
    expect(
      files
        .filter((file) => misused(readFileSync(file, 'utf8')))
        .map((file) => file.slice(KIT.length + 1))
    ).toEqual([]);
  });
});
