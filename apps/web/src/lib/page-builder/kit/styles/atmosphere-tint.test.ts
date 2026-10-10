// @vitest-environment node
/**
 * The atmosphere veil in the Style's tint (`--lp-atmosphere-ground: tint`,
 * `surfaces.css`; 03 §5.1, Codex-61zsk.25).
 *
 * The plain veil is the pole's ground at the proven strength. Over an org
 * shader that is dark (Bloom: a near-black field of coloured lights) a light
 * ground reads as a grey band: measured on studio-alpha, rgb(216 212 211) at
 * chroma 0.004 under a ground of rgb(250 250 250). The tint paints the
 * Style's panel ground instead (the ground moved toward the brand by
 * `--lp-tint-panel`) and makes it the section's own ground, so every word is
 * computed against it. Measured after: rgb(218 191 191), chroma 0.031, with
 * the shader's share unchanged (0.17–0.18 light, 0.13 dark).
 *
 * WHAT IS PROVEN HERE. §5.1's floors over the two worst backdrops, pure black
 * and pure white, at the SAME strength the kit proves for the plain veil,
 * for every ground `schemes.test.ts` sweeps × every brand it sweeps × the
 * panel tint of each Style that opts in. The model is a copy of that file's
 * (it keeps its own private), so it is calibrated against that file's two
 * known results before it is believed: the plain veil passes at the proven
 * strength and loses the soft ink 0.01 below it. The dark panel ground
 * reaches L 0.28, outside the band the proof holds for (L <= 0.24): without
 * the cap it fails, which is what the cap is for.
 *
 * Every number the model uses is read from the stylesheets or pinned to
 * them, so the model is the CSS that ships.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PAGE_STYLE_IDS } from '../model/ids';

const DIR = dirname(fileURLToPath(import.meta.url));
const uncomment = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
/** Comments out, whitespace squashed, none inside brackets. */
const flat = (s: string) =>
  uncomment(s)
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');
const read = (file: string) => flat(readFileSync(join(DIR, file), 'utf8'));
const SURFACES = read('surfaces.css');
const SCHEMES = read('schemes.css');
const EXACT = SCHEMES.slice(
  SCHEMES.indexOf(
    '@supports (color: rgb(from red calc(255 * pow(r / 255, 2)) 0 0))'
  )
);

const num = (source: string, pattern: RegExp, what: string) => {
  const m = source.match(pattern);
  if (!m) throw new Error(`not found in the CSS: ${what}`);
  return Number(m[1]);
};

// ── what ships ──────────────────────────────────────────────────────────────
const TINT_QUERY = '@container lp-page style(--lp-atmosphere-ground: tint)';
const TINT = SURFACES.slice(
  SURFACES.indexOf(TINT_QUERY),
  SURFACES.indexOf('@container lp-page style(--lp-atmosphere-veil: panel)')
);
const RECIPE =
  /--lp-bg: oklch\(from var\(--_panel-g\) min\(l, calc\(([\d.]+) \+ clamp\(0, \(l - ([\d.]+)\) \* 1e6, 1\)\)\) min\(c, calc\(([\d.]+) \+ clamp\(0, \(l - ([\d.]+)\) \* 1e6, 1\)\)\) h\);/;
const recipe = TINT.match(RECIPE);
const CAP_L = Number(recipe?.[1]);
const CAP_C = Number(recipe?.[3]);
const STEP = Number(recipe?.[2]);

/** The dark ground's own clamp: the band §5.1's proof sweeps. The ground's
 * band is the org's (03 X48), and atmosphere is drawn only on the first one
 * (`atmosphereProven`; PageRenderer draws it as base on any other), so the
 * edge is the dark theme's first-band fallback. */
const DARK_BAND_L = num(
  SCHEMES,
  /--_band-edge: var\(--_gd-edge, ([\d.]+)\);/,
  'dark ground L'
);
const DARK_BAND_C = num(
  SCHEMES,
  /\(l - var\(--_band-edge\)\) \* 1e6, 1\) \* max\(0, c - ([\d.]+)\)\) h\);/,
  'dark ground chroma'
);

/** The bands a Moving background is drawn on, per pole (`ATMOSPHERE_BANDS`
 * in `model/resolve.ts`, 03 X50): the first and the next, each band's edge
 * read from its rule. The panel ground clamps itself into the first band
 * whatever ground it starts from, so a tinted section on the second band is
 * proven at the first band's veil, the thinnest any band draws. */
const edgeOf = (band: string) =>
  num(
    SCHEMES,
    new RegExp(
      `\\.lp\\[data-ground-light='${band}'\\] \\{ --_gl-edge: ([\\d.]+);`
    ),
    `${band} edge`
  );
const FIRST_EDGE: Record<'light' | 'dark', number> = {
  light: edgeOf('l90'),
  dark: edgeOf('d24'),
};
const DRAWN_EDGES: Record<'light' | 'dark', number[]> = {
  light: [FIRST_EDGE.light, edgeOf('l85')],
  dark: [FIRST_EDGE.dark, edgeOf('d30')],
};

const VEIL = {
  light: num(EXACT, /--_atmos-min-light: ([\d.]+);/, 'light veil'),
  dark: num(EXACT, /--_atmos-min-dark: ([\d.]+);/, 'dark veil'),
};
const GLOW = {
  light: num(SCHEMES, /--_glow-l: ([\d.]+);/, 'light glow L'),
  dark: num(
    SCHEMES.slice(SCHEMES.indexOf('.lp[data-lp-style=')),
    /--_glow-l: ([\d.]+);/,
    'dark glow L'
  ),
  c: num(SCHEMES, /--_glow-c: ([\d.]+);/, 'glow chroma'),
  strength: num(EXACT, /--_glow-strength: ([\d.]+);/, 'glow strength'),
};
/** Ink targets and the atmosphere moves, from the generated fragments. */
const INK = {
  ink: num(
    EXACT,
    /--_t-ink: \(var\(--_w\) \* min\(1, ([\d.]+) \*/,
    'ink target'
  ),
  soft: num(
    EXACT,
    /--_t-soft: \(var\(--_w\) \* min\(1, ([\d.]+) \*/,
    'soft target'
  ),
};
const MOVE = {
  accentLight: num(
    EXACT,
    /--_atm-acc-dk-r: .*?min\(1, ([\d.]+) \//,
    'atmos accent (light)'
  ),
  accentDark: num(
    EXACT,
    /--_atm-acc-lt-s: max\(1, ([\d.]+) \//,
    'atmos accent (dark)'
  ),
  buttonLight: num(
    EXACT,
    /--_atm-btn-dk-r: .*?min\(1, ([\d.]+) \//,
    'atmos button (light)'
  ),
  buttonDark: num(
    EXACT,
    /--_atm-btn-lt-s: max\(1, ([\d.]+) \//,
    'atmos button (dark)'
  ),
  markLight: num(
    EXACT,
    /--_atm-mark-dk-r: .*?min\(1, ([\d.]+) \//,
    'atmos mark (light)'
  ),
  markDark: num(
    EXACT,
    /--_atm-mark-lt-s: max\(1, ([\d.]+) \//,
    'atmos mark (dark)'
  ),
};
const KIT_PANEL_TINT =
  num(SCHEMES, /--lp-tint-panel: ([\d.]+)%;/, 'kit panel tint') / 100;

/** The Styles that opt in, each with the panel tint its sheet ships. */
const OPTED = PAGE_STYLE_IDS.filter((id) =>
  read(`style-${id}.css`).includes('--lp-atmosphere-ground: tint;')
);
const panelTintOf = (id: string) => {
  const m = read(`style-${id}.css`).match(/--lp-tint-panel: ([\d.]+)%;/);
  return m ? Number(m[1]) / 100 : KIT_PANEL_TINT;
};

// ── the colour model (schemes.test.ts's, copied) ────────────────────────────
type Rgb = readonly [number, number, number];
type Mode = 'light' | 'dark';
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
const triple = (f: (i: 0 | 1 | 2) => number): Rgb => [f(0), f(1), f(2)];
const clip = (rgb: Rgb): Rgb => triple((i) => Math.min(1, Math.max(0, rgb[i])));
const unit = (c: number) => Math.min(1, Math.max(0, c));
const clampTo = (lo: number, v: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const hex = (value: string): Rgb => {
  const h = value.replace('#', '');
  return triple((i) => Number.parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255);
};
function toLab(rgb: Rgb): Rgb {
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
function toRgb([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
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
/** The ground held in its band: [edge, 1] light, [0, edge] dark. */
function ground(mode: Mode, input: Rgb, edge = FIRST_EDGE[mode]): Rgb {
  return mode === 'light'
    ? oklchFrom(
        input,
        (l) => clampTo(edge, l, 1),
        (l, c) => c - (l < edge ? 1 : 0) * Math.max(0, c - 0.046)
      )
    : oklchFrom(
        input,
        (l) => Math.min(l, edge),
        (l, c) => c - (l > edge ? 1 : 0) * Math.max(0, c - 0.039)
      );
}
/** `--_panel-g`, per pole (pinned to schemes.css below). */
function panelGround(mode: Mode, g: Rgb, brand: Rgb, tint: number): Rgb {
  return mode === 'light'
    ? oklchFrom(
        mix(g, brand, tint),
        (l) => clampTo(0.9, l, 0.965),
        (l, c) => Math.min(c, (1 - clampTo(0.9, l, 0.965)) * 0.46)
      )
    : oklchFrom(
        mix(g, brand, tint + 0.02),
        (l) => clampTo(0.2, l + 0.03, 0.28),
        (l, c) => Math.min(c, clampTo(0.2, l + 0.03, 0.28) * 0.165)
      );
}
/** The shipped recipe: the panel ground, brought into the dark band. */
const step = (l: number) => (l > STEP ? 1 : 0);
const tinted = (panel: Rgb, cap = true): Rgb =>
  cap
    ? oklchFrom(
        panel,
        (l) => Math.min(l, CAP_L + step(l)),
        (l, c) => Math.min(c, CAP_C + step(l))
      )
    : panel;

interface Tokens {
  bg: Rgb;
  ink: Rgb;
  soft: Rgb;
  accent: Rgb;
  mark: Rgb;
  button: Rgb;
  buttonInk: Rgb;
  panel: Rgb;
  panelInk: Rgb;
}
/** An atmosphere section's tokens on the ground `bg` (schemes.css). */
function tokens(mode: Mode, bg: Rgb, brand: Rgb, panel: Rgb): Tokens {
  const light = mode === 'light';
  const button = light
    ? darken(brand, MOVE.buttonLight)
    : lighten(brand, MOVE.buttonDark);
  return {
    bg,
    ink: ink(bg, INK.ink),
    soft: ink(bg, INK.soft),
    accent: light
      ? darken(brand, MOVE.accentLight)
      : lighten(brand, MOVE.accentDark),
    mark: light ? darken(brand, MOVE.markLight) : lighten(brand, MOVE.markDark),
    button,
    buttonInk: ink(button, INK.ink),
    panel,
    panelInk: ink(panel, INK.ink),
  };
}
/** 01 §5 over each backdrop; the ghost line is the soft ink, focus the ink. */
const OVER = {
  ink: 4.5,
  soft: 4.5,
  accent: 4.5,
  mark: 3,
  button: 3,
  edge: 3,
  focus: 3,
} as const;
function failures(t: Tokens, seens: [string, Rgb][]): string[] {
  const out: string[] = [];
  for (const [name, seen] of seens) {
    const r = {
      ink: ratio(t.ink, seen),
      soft: ratio(t.soft, seen),
      accent: ratio(t.accent, seen),
      mark: ratio(t.mark, seen),
      button: ratio(t.button, seen),
      edge: ratio(t.soft, seen),
      focus: ratio(t.ink, seen),
    };
    for (const [token, floor] of Object.entries(OVER)) {
      const value = r[token as keyof typeof r];
      // A NaN (a recipe the model failed to read) is a failure, never a pass.
      if (!(value >= floor)) out.push(`${token} over ${name}`);
    }
  }
  if (!(ratio(t.buttonInk, t.button) >= 4.5)) out.push('buttonInk');
  if (!(ratio(t.panelInk, t.panel) >= 4.5)) out.push('panelInk');
  return out;
}
const veiled = (t: Tokens, s: number) =>
  failures(t, [
    ['black', triple((i) => s * clip(t.bg)[i])],
    ['white', triple((i) => s * clip(t.bg)[i] + (1 - s))],
  ]);

// ── the cases: schemes.test.ts's §5 sweep ───────────────────────────────────
const BRANDS = [
  '#F7D9B9',
  '#FFF3B0',
  '#E11D48',
  '#E4572E',
  '#2563EB',
  '#1B2A41',
  '#111111',
  '#2B0A3D',
  '#FFFFFF',
  '#F4F4F0',
  '#0D9488',
  '#059669',
  '#808080',
  '#EC0008',
];
const GROUNDS: Record<Mode, string[]> = {
  light: ['#fafafa', '#F6EFE6', '#D9CBB8', '#1a1a2e'],
  dark: ['#171717', '#200000', '#101018', '#F6EFE6'],
};
function cases(mode: Mode, edge = FIRST_EDGE[mode]): [Rgb, Rgb][] {
  const out: [Rgb, Rgb][] = [];
  for (const g of GROUNDS[mode])
    for (const b of BRANDS) out.push([ground(mode, hex(g), edge), hex(b)]);
  const platform = ground(
    mode,
    hex(mode === 'light' ? '#fafafa' : '#171717'),
    edge
  );
  for (let r = 0; r < 256; r += 17)
    for (let gr = 0; gr < 256; gr += 17)
      for (let b = 0; b < 256; b += 17)
        out.push([platform, [r / 255, gr / 255, b / 255]]);
  for (let r = 0; r < 256; r += 51)
    for (let gr = 0; gr < 256; gr += 51)
      for (let b = 0; b < 256; b += 51)
        for (const brand of BRANDS)
          out.push([
            ground(mode, [r / 255, gr / 255, b / 255], edge),
            hex(brand),
          ]);
  return out;
}
const MODES: Mode[] = ['light', 'dark'];
const plainFailures = (mode: Mode, s: number, edge = FIRST_EDGE[mode]) =>
  cases(mode, edge).flatMap(([g, brand]) =>
    veiled(
      tokens(mode, g, brand, panelGround(mode, g, brand, KIT_PANEL_TINT)),
      s
    )
  );
const tintFailures = (
  mode: Mode,
  s: number,
  tint: number,
  cap = true,
  edge = FIRST_EDGE[mode]
) =>
  cases(mode, edge).flatMap(([g, brand]) => {
    const panel = panelGround(mode, g, brand, tint);
    return veiled(tokens(mode, tinted(panel, cap), brand, panel), s);
  });

describe('the tinted atmosphere veil — what ships', () => {
  it('re-points the section’s own ground and paints it at the proven strength', () => {
    expect(SURFACES.indexOf(TINT_QUERY)).toBeGreaterThan(0);
    expect(recipe, 'the tint recipe').not.toBeNull();
    expect(TINT).toContain(
      ".lp-section[data-lp-scheme='atmosphere']:not([data-lp-on-media]) {"
    );
    expect(TINT).toContain(
      ".org-layout[data-hero-shader-active] .lp[data-lp-atmosphere]:not([data-lp-still]) .lp-section[data-lp-scheme='atmosphere']:not([data-lp-on-media]) { background: rgb(from var(--lp-bg) r g b / var(--_atmos-s)); }"
    );
    // The plain veil stays the default for every Style that does not opt in.
    expect(SURFACES).toContain('background: var(--_atmos-veil);');
  });

  it('caps the dark panel ground at the edge of the band the proof holds for', () => {
    expect(CAP_L).toBe(DARK_BAND_L);
    expect(CAP_C).toBe(DARK_BAND_C);
    expect(Number(recipe?.[4])).toBe(STEP);
    // The step tells the poles apart: every light panel ground is >= 0.9,
    // every dark one <= 0.28 (the recipes pinned below).
    expect(STEP).toBeGreaterThan(0.28);
    expect(STEP).toBeLessThan(0.9);
  });

  it('models the panel ground schemes.css ships', () => {
    expect(SCHEMES).toContain(
      '--_panel-g: oklch(from color-mix(in oklab, var(--lp-ground), var(--lp-brand) var(--lp-tint-panel)) clamp(0.9, l, 0.965) min(c, (1 - clamp(0.9, l, 0.965)) * 0.46) h);'
    );
    expect(SCHEMES).toContain(
      '--_panel-g: oklch(from color-mix(in oklab, var(--lp-ground), var(--lp-brand) calc(var(--lp-tint-panel) + 2%)) clamp(0.2, l + 0.03, 0.28) min(c, clamp(0.2, l + 0.03, 0.28) * 0.165) h);'
    );
  });

  it('is chosen by every Style with a plain veil: Bold, Clean, Path, Quiet, Soft and Studio (Codex-61zsk.35)', () => {
    expect([...OPTED].sort()).toEqual([
      'bold',
      'clean',
      'path',
      'quiet',
      'soft',
      'studio',
    ]);
    const declared = readdirSync(DIR)
      .filter((f) => f.endsWith('.css'))
      .filter((f) => read(f).includes('--lp-atmosphere-ground:'));
    expect(declared.sort()).toEqual([
      'style-bold.css',
      'style-clean.css',
      'style-path.css',
      'style-quiet.css',
      'style-soft.css',
      'style-studio.css',
      'surfaces.css',
    ]);
  });
});

describe('the tinted atmosphere veil — only where it changes nothing it should not', () => {
  // Bold, Path and Studio took the tint with B2 (03 X50). Their plain veil
  // was already on any page that set a Moving background itself (of Blood &
  // Bones' Tending the Grief, a Path page, sets one and has no shader), so
  // they take it only where the org's shader runs: an org without one keeps
  // every pixel. The org layout carries the flag in the studio too, so the
  // canvas shows what the page will.
  const LATE = ['bold', 'path', 'studio'];
  const DECL = '--lp-atmosphere-ground: tint;';
  const blockAt = (sheet: string, at: number) =>
    sheet.slice(sheet.lastIndexOf('}', at) + 1, sheet.indexOf('}', at));

  it('Bold, Path and Studio declare it only under a running shader', () => {
    for (const id of LATE) {
      const sheet = read(`style-${id}.css`);
      expect(sheet.split(DECL).length - 1, id).toBe(1);
      expect(blockAt(sheet, sheet.indexOf(DECL)).trim(), id).toBe(
        `.org-layout[data-hero-shader-active] .lp[data-lp-style='${id}'] { ${DECL}`
      );
    }
  });

  it('Clean, Quiet and Soft keep it wherever they draw a Moving background', () => {
    for (const id of OPTED.filter((s) => !LATE.includes(s))) {
      const sheet = read(`style-${id}.css`);
      expect(blockAt(sheet, sheet.indexOf(DECL)), id).not.toContain(
        'hero-shader-active'
      );
    }
  });
});

describe('the tinted atmosphere veil — the §5.1 floors', () => {
  // The glow sweep runs every case on both drawn bands for six Styles: ~11s
  // alone, past the 15s default beside the rest of the kit's suites. The work
  // is fixed and deterministic, so the limit is sized to it (as schemes.test's
  // sweeps are); a pathological slowdown still fails.
  const SWEEP_TIMEOUT = 60_000;

  for (const mode of MODES) {
    it(`${mode}: the model is the kit's — the plain veil passes at the proven strength and loses the soft ink 0.01 below`, () => {
      expect(plainFailures(mode, VEIL[mode])).toEqual([]);
      const thinner = plainFailures(mode, VEIL[mode] - 0.01);
      expect(thinner.some((f) => f.startsWith('soft over'))).toBe(true);
    });

    it(
      `${mode}: holds every floor over pure black and pure white, for each Style that opts in, on every band it is drawn on`,
      { timeout: SWEEP_TIMEOUT },
      () => {
        expect(DRAWN_EDGES[mode]).toEqual(
          mode === 'light' ? [0.9, 0.85] : [0.24, 0.3]
        );
        for (const edge of DRAWN_EDGES[mode])
          for (const id of OPTED)
            expect(
              tintFailures(mode, VEIL[mode], panelTintOf(id), true, edge),
              `${id} ${edge}`
            ).toEqual([]);
      }
    );

    it(
      `${mode}: holds under the glow where no shader runs, on every band it is drawn on`,
      { timeout: SWEEP_TIMEOUT },
      () => {
        const out = DRAWN_EDGES[mode].flatMap((edge) =>
          cases(mode, edge).flatMap(([g, brand]) =>
            OPTED.flatMap((id) => {
              const panel = panelGround(mode, g, brand, panelTintOf(id));
              const t = tokens(mode, tinted(panel), brand, panel);
              const glow = oklchFrom(
                brand,
                () => GLOW[mode],
                (_, c) => Math.min(c, GLOW.c)
              );
              const seen = triple(
                (i) =>
                  GLOW.strength * clip(glow)[i] +
                  (1 - GLOW.strength) * clip(t.bg)[i]
              );
              return failures(t, [['the glow', seen]]);
            })
          )
        );
        expect(out).toEqual([]);
      }
    );
  }

  it('has teeth: the dark panel ground without the cap fails at the proven veil', () => {
    const uncapped = OPTED.flatMap((id) =>
      tintFailures('dark', VEIL.dark, panelTintOf(id), false)
    );
    expect(uncapped.length).toBeGreaterThan(0);
  });

  it('has teeth: on the second band the plain veil fails at the first band’s strength, where the tint holds', () => {
    for (const mode of MODES)
      expect(
        plainFailures(mode, VEIL[mode], DRAWN_EDGES[mode][1]).length,
        mode
      ).toBeGreaterThan(0);
  });
});
