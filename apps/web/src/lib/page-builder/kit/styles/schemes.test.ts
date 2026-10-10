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
import {
  atmosphereProven,
  GROUND_BANDS,
  type GroundBandId,
  groundBand,
  INK_CROSSOVER,
  resolveGroundBands,
} from '../model/resolve';

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'schemes.css'),
  'utf8'
);
const squash = (s: string) => s.replace(/\s+/g, ' ');
const CODE = squash(CSS.replace(/\/\*[\s\S]*?\*\//g, ''));

/**
 * The two pole blocks (the root `.lp` rule comes first) and the exact path's
 * root. The dark THEME (the brand's dark inputs) and the dark POLE (the bands
 * and routing) are separate rules since the ground's polarity follows the
 * org: the theme's selector list ends `.lp[data-lp-theme='dark'], .lp[…
 * cinematic]`, the pole's `…), .lp[…cinematic]`, after its exclusions.
 */
const POLE = {
  light: CODE.match(/\.lp \{([^}]*)\}/)?.[1] ?? '',
  dark:
    CODE.match(/\), \.lp\[data-lp-style='cinematic'\] \{([^}]*)\}/)?.[1] ?? '',
};
const DARK_THEME =
  CODE.match(
    /\.lp\[data-lp-theme='dark'\], \.lp\[data-lp-style='cinematic'\] \{([^}]*)\}/
  )?.[1] ?? '';
const EXACT =
  CODE.match(
    /@supports \(color: rgb\(from red calc\(255 \* pow\(r \/ 255, 2\)\) 0 0\)\) \{ \.lp \{([^}]*)\}/
  )?.[1] ?? '';

/** The org's button: one rule, for the org's surfaces and the hero's main
 * button over a photo (§13). Empty when that rule is not written so. */
const ORG_SURFACES =
  ".lp:not([data-lp-style='cinematic']) :is([data-lp-scheme='base'], [data-lp-scheme='soft']):not([data-lp-on-media])";
const HERO_OVER_PHOTO =
  ".lp .lp-section[data-lp-type='hero'] [data-lp-on-media] .lp-button[data-variant='primary']";
const ORG_BUTTON_RULE = () => {
  const head = `${ORG_SURFACES}, ${HERO_OVER_PHOTO} {`;
  if (!CODE.includes(head)) return '';
  return (
    CODE.slice(CODE.indexOf(head) + head.length).match(/^([^}]*)\}/)?.[1] ?? ''
  );
};

// ── the parameters the stylesheet is generated from ─────────────────────────
const INK = { ink: 17, soft: 7, edge: 3.2, line: 1.45 } as const;
const TARGET = {
  accentLight: 0.105,
  accentDark: 0.3,
  // A button on a kit band (contrast, Cinematic's room) needs 3:1 against
  // it, and its label is whichever side of the 0.1791 crossover it lands
  // on, so it moves only to 2% past the worst surface a kit band can hold
  // (§4 measures both): a rust lightened onto a dark band keeps white.
  buttonLight: 0.248,
  buttonDark: 0.175,
  // A mark (a route, a stop, a ring) needs 3:1, not 4.5:1, so it moves less:
  // >= 3.3:1 against the worst kit surface of its band, the accent's own
  // ~10% margin (§8 below measures it for any source colour). On the org's
  // surfaces a mark takes the org's large grade instead (§10).
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
  // The org's inks (§10): text grade 4.5:1 and large grade 3:1 against the
  // worst surface of the band, plain or under the decorations that ship —
  // each 2% past what that surface needs, which §10 measures.
  orgTextLight: 0.114,
  orgTextDark: 0.25,
  orgLargeLight: 0.196,
  orgLargeDark: 0.15,
  orgDecTextLight: 0.086,
  orgDecTextDark: 0.33,
  orgDecLargeLight: 0.155,
  orgDecLargeDark: 0.203,
  // Keep white (owner, D8): a mid-tone button the org's label rule turns
  // black darkens to Y 0.181, just inside white's 4.5:1 (Y 0.1833) with
  // room for the 8-bit rounding of the fill as painted (§11 measures it).
  // Only a fill white already holds 3:1 on moves (Y <= 0.30). The label is
  // white up to 0.182: past the target by the knee-less curve's floor (a
  // channel darkened to 0 still reads 0.0008), which 0.1811 missed — a
  // pure red took a grey label (§4's sweep caught it).
  orgWhiteLabel: 0.181,
  orgWhiteLabelCut: 0.3,
  orgWhiteLabelInk: 0.182,
};

/**
 * THE GROUND'S BANDS (Codex-61zsk.42, 03 X48): the org's grades on each, as
 * `schemes.css` names them per band (`.lp[data-ground-*='<id>']`). The first
 * band of each pole is the one the kit always had (the TARGETs above); a
 * wider band holds a darker (lighter) worst surface, so its inks move
 * further. Each is 2% past what its worst surface needs, rounded toward the
 * ink. Keep white (D8) is off where the large grade lifts a button past
 * white's 4.5:1 (`kw`). §16 proves every one.
 */
const BAND_GRADES: Record<
  GroundBandId,
  { ot: number; ol: number; odt: number; odl: number; kw: 0 | 1 }
> = {
  l90: {
    ot: TARGET.orgTextLight,
    ol: TARGET.orgLargeLight,
    odt: TARGET.orgDecTextLight,
    odl: TARGET.orgDecLargeLight,
    kw: 1,
  },
  l85: { ot: 0.086, ol: 0.155, odt: 0.064, odl: 0.121, kw: 1 },
  l80: { ot: 0.062, ol: 0.118, odt: 0.044, odl: 0.091, kw: 1 },
  l75: { ot: 0.041, ol: 0.086, odt: 0.026, odl: 0.065, kw: 1 },
  l70: { ot: 0.022, ol: 0.058, odt: 0.011, odl: 0.042, kw: 1 },
  l65: { ot: 0.009, ol: 0.039, odt: 0.0009, odl: 0.026, kw: 1 },
  d24: {
    ot: TARGET.orgTextDark,
    ol: TARGET.orgLargeDark,
    odt: TARGET.orgDecTextDark,
    odl: TARGET.orgDecLargeDark,
    kw: 1,
  },
  d30: { ot: 0.316, ol: 0.194, odt: 0.417, odl: 0.261, kw: 0 },
  d36: { ot: 0.414, ol: 0.26, odt: 0.535, odl: 0.34, kw: 0 },
  d42: { ot: 0.552, ol: 0.352, odt: 0.69, odl: 0.443, kw: 0 },
  d48: { ot: 0.737, ol: 0.475, odt: 0.885, odl: 0.574, kw: 0 },
};
type Band = (typeof GROUND_BANDS)[number] & (typeof BAND_GRADES)[GroundBandId];
const BAND = Object.fromEntries(
  GROUND_BANDS.map((b) => [b.id, { ...b, ...BAND_GRADES[b.id] }])
) as Record<GroundBandId, Band>;
/** The band each pole draws when no ground names one: its first. */
const FIRST = { light: BAND.l90, dark: BAND.d24 } as const;

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
  const darken = (name: string, y: number | string) =>
    channels.map(
      (c) =>
        `--_${name}-${c}: max(0, 255 * (1.055 * pow(var(--_l${c}) * min(1, ${y} / max(var(--_y), 1e-6)), 1 / 2.4) - 0.055));`
    );
  const lighten = (name: string, y: number | string) => [
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
    // The org's grades are the ground's band's (§16): one band at a time.
    ...darken('ot-dk', 'var(--_g-ot)'),
    ...lighten('ot-lt', 'var(--_g-ot)'),
    ...darken('ol-dk', 'var(--_g-ol)'),
    ...lighten('ol-lt', 'var(--_g-ol)'),
    ...darken('odt-dk', 'var(--_g-odt)'),
    ...lighten('odt-lt', 'var(--_g-odt)'),
    ...darken('odl-dk', 'var(--_g-odl)'),
    ...lighten('odl-lt', 'var(--_g-odl)'),
    `--_wl-f: max(min(1, ${TARGET.orgWhiteLabel} / max(var(--_y), 1e-6)), clamp(0, (var(--_y) - ${TARGET.orgWhiteLabelCut}) * 1e6, 1), 1 - var(--_band-kw));`,
    ...channels.map(
      (c) =>
        `--_wlm-${c}: max(0, 255 * (1.055 * pow(var(--_l${c}) * var(--_wl-f), 1 / 2.4) - 0.055));`
    ),
    `--_wk: clamp(0, (${TARGET.orgWhiteLabelInk} - var(--_y)) * 1e6, 1);`,
  ];
}

/** The recipes the model below implements, as the stylesheet spells them. */
const RECIPES = [
  // light pole
  '--_ground-in: var(--_org-ground);',
  '--lp-ground: oklch( from var(--_ground-in) clamp(var(--_band-edge), l, 1) calc(c - clamp(0, (var(--_band-edge) - l) * 1e6, 1) * max(0, c - 0.046)) h );',
  '--_org-soft-bg: oklch( from color-mix(in oklab, var(--_org-soft), var(--lp-brand) var(--lp-tint-soft)) clamp(var(--_band-edge), l, 1) calc(c - clamp(0, (var(--_band-edge) - l) * 1e6, 1) * max(0, c - 0.046)) h );',
  '--_org-panel: oklch( from var(--_org-card) clamp(var(--_band-edge), l, 1) calc(c - clamp(0, (var(--_band-edge) - l) * 1e6, 1) * max(0, c - 0.046)) h );',
  '--_contrast-bg: oklch(from var(--lp-brand) 0.2 min(c * 0.3, 0.033) h);',
  '--_panel-g: oklch( from color-mix(in oklab, var(--lp-ground), var(--lp-brand) var(--lp-tint-panel)) clamp(0.9, l, 0.965) min(c, (1 - clamp(0.9, l, 0.965)) * 0.46) h );',
  '--_panel-i: oklch(from var(--lp-brand) 0.265 min(c * 0.35, 0.043) h);',
  '--_scrim: oklch(from var(--lp-brand) 0.16 min(c * 0.25, 0.027) h);',
  // dark pole
  '--_ground-in: var(--lp-dark-ground-in, var(--_org-ground));',
  '--lp-ground: oklch( from var(--_ground-in) min(l, var(--_band-edge)) calc(c - clamp(0, (l - var(--_band-edge)) * 1e6, 1) * max(0, c - 0.039)) h );',
  '--_org-soft-bg: oklch( from color-mix(in oklab, var(--_org-soft), var(--lp-brand) var(--lp-tint-soft)) min(l, var(--_band-edge)) calc(c - clamp(0, (l - var(--_band-edge)) * 1e6, 1) * max(0, c - 0.039)) h );',
  '--_org-panel: oklch( from var(--_org-card) min(l, var(--_band-edge)) calc(c - clamp(0, (l - var(--_band-edge)) * 1e6, 1) * max(0, c - 0.039)) h );',
  // Cinematic's room (the only dark-pole soft band and panel a base / soft
  // section draws that is not the org's)
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
  // the org's tokens and inks (§10)
  '--_org-ground: var(--color-background);',
  '--_org-soft: var(--color-surface-secondary);',
  '--_org-card: var(--color-surface-card);',
  '--_org-ink: var(--color-text);',
  '--_org-ink-soft: var(--color-text-secondary);',
  '--_org-line: var(--color-border);',
  '--_org-heading: var(--color-heading, var(--color-text));',
  '--_org-focus: var(--color-focus);',
  '--_org-button: var(--color-interactive);',
  '--lp-ink: rgb(from var(--_org-ink) var(--_ot-r) var(--_ot-g) var(--_ot-b));',
  '--lp-ink-soft: rgb(from var(--_org-ink-soft) var(--_ot-r) var(--_ot-g) var(--_ot-b));',
  '--lp-title-ink: rgb(from var(--_org-heading) var(--_ot-r) var(--_ot-g) var(--_ot-b));',
  '--lp-heading-ink: rgb(from var(--_org-heading) var(--_ol-r) var(--_ol-g) var(--_ol-b));',
  '--lp-focus: rgb(from var(--_org-focus) var(--_ol-r) var(--_ol-g) var(--_ol-b));',
  // the org's button, its label rule, its accent text, and the marks (§10)
  '--lp-button-bg: rgb( from rgb(from var(--_org-button) var(--_ol-r) var(--_ol-g) var(--_ol-b)) var(--_wl-r) var(--_wl-g) var(--_wl-b) );',
  '--lp-button-ink: rgb(from var(--lp-button-bg) calc(255 * var(--_wk)) calc(255 * var(--_wk)) calc(255 * var(--_wk)));',
  '--lp-accent: rgb(from var(--_org-button) var(--_ot-r) var(--_ot-g) var(--_ot-b));',
  '--lp-mark-ink: rgb(from var(--lp-accent-source) var(--_ol-r) var(--_ol-g) var(--_ol-b));',
  '--lp-panel-ink: var(--lp-ink);',
  '--lp-line: var(--_org-line);',
  '--_tex-ink: rgb(from var(--lp-bg) var(--_line-r) var(--_line-g) var(--_line-b));',
  '--_btn-light: rgb(from var(--lp-brand) var(--_btn-dk-r) var(--_btn-dk-g) var(--_btn-dk-b));',
  '--_btn-dark: rgb(from var(--lp-brand) var(--_btn-lt-r) var(--_btn-lt-g) var(--_btn-lt-b));',
  // the accent from the brand; the marks from their source (the brand
  // unless a Style says)
  '--lp-accent-source: var(--lp-brand);',
  '--_acc-light: rgb(from var(--lp-brand) var(--_acc-dk-r) var(--_acc-dk-g) var(--_acc-dk-b));',
  '--_acc-dark: rgb(from var(--lp-brand) var(--_acc-lt-r) var(--_acc-lt-g) var(--_acc-lt-b));',
  '--_mark-light: rgb(from var(--lp-accent-source) var(--_mark-dk-r) var(--_mark-dk-g) var(--_mark-dk-b));',
  '--_mark-dark: rgb(from var(--lp-accent-source) var(--_mark-lt-r) var(--_mark-lt-g) var(--_mark-lt-b));',
  // atmosphere
  '--_atm-acc-light: rgb(from var(--lp-brand) var(--_atm-acc-dk-r) var(--_atm-acc-dk-g) var(--_atm-acc-dk-b));',
  '--_atm-acc-dark: rgb(from var(--lp-brand) var(--_atm-acc-lt-r) var(--_atm-acc-lt-g) var(--_atm-acc-lt-b));',
  '--_atm-mark-light: rgb(from var(--lp-accent-source) var(--_atm-mark-dk-r) var(--_atm-mark-dk-g) var(--_atm-mark-dk-b));',
  '--_atm-mark-dark: rgb(from var(--lp-accent-source) var(--_atm-mark-lt-r) var(--_atm-mark-lt-g) var(--_atm-mark-lt-b));',
  '--_atm-btn-light: rgb(from var(--lp-brand) var(--_atm-btn-dk-r) var(--_atm-btn-dk-g) var(--_atm-btn-dk-b));',
  '--_atm-btn-dark: rgb(from var(--lp-brand) var(--_atm-btn-lt-r) var(--_atm-btn-lt-g) var(--_atm-btn-lt-b));',
  '--_atmos-s: max(var(--_atmos-min), var(--_band-veil), var(--lp-atmosphere-scrim, 0));',
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
    // Without pow() a mark takes the accent's mix (text grade is graphic
    // grade too), from the marks' own source.
    expect(POLE.light).toContain(
      '--_mark-light: oklch(from var(--lp-accent-source) calc(l * 0.55) calc(c * 0.55) h);'
    );
    expect(POLE.light).toContain(
      '--_mark-dark: oklch(from var(--lp-accent-source) calc(l * 0.55 + 0.45) calc(c * 0.55) h);'
    );
  });

  it('draws the org on base and soft — its surfaces, and its inks moved toward the side the ground is on', () => {
    const rule = (selector: string) =>
      CODE.match(
        new RegExp(`${selector.replace(/[[\]().*]/g, '\\$&')} \\{([^}]*)\\}`)
      )?.[1] ?? '';
    expect(rule(".lp [data-lp-scheme='base']")).toContain(
      '--lp-panel: var(--_base-panel)'
    );
    expect(rule(".lp [data-lp-scheme='soft']")).toContain(
      '--lp-bg: var(--_soft-ground)'
    );
    expect(POLE.light).toContain('--_soft-ground: var(--_org-soft-bg);');
    expect(POLE.light).toContain('--_base-panel: var(--_org-panel);');
    // Each grade, each channel, to its own pole's move.
    for (const grade of ['ot', 'ol', 'odt', 'odl'])
      for (const c of ['r', 'g', 'b']) {
        expect(POLE.light).toContain(
          `--_${grade}-${c}: var(--_${grade}-dk-${c});`
        );
        expect(POLE.dark).toContain(
          `--_${grade}-${c}: var(--_${grade}-lt-${c});`
        );
      }
    // Only base and soft, never on imagery, and never in Cinematic's room —
    // on both paths.
    const ORG =
      ".lp:not([data-lp-style='cinematic']) :is([data-lp-scheme='base'], [data-lp-scheme='soft']):not([data-lp-on-media]) {";
    expect(CODE.split(ORG).length - 1).toBe(2);
    // Its own rule, not the end of the dark theme's selector list.
    const room =
      CODE.match(/\} \.lp\[data-lp-style='cinematic'\] \{([^}]*)\}/)?.[1] ?? '';
    expect(room).toContain('--_soft-ground: var(--_soft-bg);');
    expect(room).toContain('--_base-panel: var(--_panel-g);');
    // The tint default is the kit's: none, so the soft band is the org's own.
    expect(POLE.light).toContain(
      `--lp-tint-soft: ${DEFAULT_TINT.soft * 100}%;`
    );
  });

  it('takes the brand’s dark inputs in the dark theme, and the dark bands only on the dark pole', () => {
    expect(DARK_THEME).toContain(
      '--lp-brand: var(--brand-color-dark, var(--brand-color, var(--color-brand-primary)));'
    );
    expect(DARK_THEME).not.toContain('--lp-ground');
    expect(POLE.dark).toContain('min(l, var(--_band-edge))');
    expect(POLE.dark).not.toContain('--lp-brand:');
  });

  it('draws the org’s button, accent text and marks on base and soft — on both paths', () => {
    const ORG =
      ".lp:not([data-lp-style='cinematic']) :is([data-lp-scheme='base'], [data-lp-scheme='soft']):not([data-lp-on-media]) {";
    const [, fallback = '', exact = ''] = CODE.split(ORG).map(
      (rest) => rest.match(/^([^}]*)\}/)?.[1] ?? ''
    );
    // Without pow(), exactly the org's (the label is the generic step, the
    // platform's own `--color-on-interactive` on this path).
    expect(fallback).toContain('--lp-button-bg: var(--_org-button);');
    expect(fallback).toContain('--lp-accent: var(--_org-button);');
    expect(fallback).toContain('--lp-mark-ink: var(--lp-accent-source);');
    expect(fallback).not.toContain('--lp-button-ink');
    // With it, moved only as far as each grade needs, then kept white on a
    // mid-tone (§11); the label is the step from the fill as drawn. The
    // button is written once, shared with the hero over a photo (§13).
    const button = ORG_BUTTON_RULE();
    expect(button).toContain(
      '--lp-button-bg: rgb( from rgb(from var(--_org-button) var(--_ol-r) var(--_ol-g) var(--_ol-b)) var(--_wl-r) var(--_wl-g) var(--_wl-b) );'
    );
    expect(button).toContain(
      '--lp-button-ink: rgb(from var(--lp-button-bg) calc(255 * var(--_wk)) calc(255 * var(--_wk)) calc(255 * var(--_wk)));'
    );
    expect(exact).not.toContain('--lp-button-bg');
    expect(exact).toContain(
      '--lp-accent: rgb(from var(--_org-button) var(--_ot-r) var(--_ot-g) var(--_ot-b));'
    );
    expect(exact).toContain(
      '--lp-mark-ink: rgb(from var(--lp-accent-source) var(--_ol-r) var(--_ol-g) var(--_ol-b));'
    );
    const step =
      'calc(255 * clamp(0, (0.1791 - (0.2126 * pow((r / 255 + 0.055) / 1.055, 2.4) + 0.7152 * pow((g / 255 + 0.055) / 1.055, 2.4) + 0.0722 * pow((b / 255 + 0.055) / 1.055, 2.4))) * 1e6, 1))';
    expect(ORG_BRAND).toContain(
      `--color-on-interactive: rgb( from var(--color-interactive) ${step} ${step} ${step} );`
    );
    // The kit's `--_w` is that step, written once from the same fragments.
    expect(EXACT).toContain('--_w: clamp(0, (0.1791 - var(--_y)) * 1e6, 1);');
    expect(EXACT).toContain(
      '--_lr: pow((clamp(0, r, 255) / 255 + 0.055) / 1.055, 2.4);'
    );
  });

  it('moves the accent and the buttons from the brand, the marks from their source — on both paths', () => {
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
      '--_mark-light',
      '--_mark-dark',
      '--_atm-mark-light',
      '--_atm-mark-dark',
    ]) {
      expect(froms(name).length, name).toBeGreaterThan(0);
      for (const source of froms(name))
        expect(source, name).toBe('--lp-accent-source');
    }
    for (const name of [
      '--_acc-light',
      '--_acc-dark',
      '--_atm-acc-light',
      '--_atm-acc-dark',
      '--_btn-light',
      '--_btn-dark',
      '--_atm-btn-light',
      '--_atm-btn-dark',
    ]) {
      expect(froms(name).length, name).toBeGreaterThan(0);
      for (const source of froms(name)) expect(source, name).toBe('--lp-brand');
    }
    // The fallback path's accent and marks read theirs too (its button is
    // the plain brand).
    expect(froms('--_acc-light')).toHaveLength(2);
    expect(froms('--_mark-light')).toHaveLength(2);
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

/** A button's label: `org-brand.css`'s step for `--color-on-interactive`
 * (the kit's `--_w`), white below luminance 0.1791 and black above, in the
 * same knee-less curve — so >= 4.58:1 on any fill. */
function pivot(fill: Rgb): Rgb {
  const L = clip(fill).map(kneeLin);
  const y = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
  const w = Math.min(1, Math.max(0, (0.1791 - y) * 1e6));
  return [w, w, w];
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

// The soft band is the org's own surface unless a Style tints it (§10).
const DEFAULT_TINT: Tint = { soft: 0, panel: 0.14 };
const clampTo = (lo: number, v: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** A colour held inside the band (`--_band-edge`): moved to its edge,
 * chroma capped, only when outside it. */
function ground(mode: Mode, input: Rgb, edge: number = FIRST[mode].edge): Rgb {
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

/*
 * THE ORG'S TOKENS, as the CONSUMER reads them: base and soft draw
 * `--color-*` (§10), so the model derives them the way the org's site does —
 * the platform theme (`themes/*.css`) for an org with no background, else
 * `org-brand.css`'s `[data-org-bg]` rule for the theme, from the background
 * that rule reads. §10 holds every line of both to the text it mirrors.
 */
interface Org {
  ground: Rgb;
  soft: Rgb;
  card: Rgb;
  ink: Rgb;
  inkSoft: Rgb;
  line: Rgb;
  heading: Rgb;
  focus: Rgb;
  /** `--color-interactive`: the org's button fill and accent text. */
  button: Rgb;
  /** `data-org-bg`: the org set a background (`org-brand.css` derives its
   * surfaces from it), rather than drawing the platform theme. */
  background: boolean;
}

const LIB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sheet = (path: string) =>
  squash(
    readFileSync(join(LIB, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  );
const PALETTE = sheet('styles/tokens/colors.css');
const THEMES: Record<Mode, string> = {
  light: sheet('styles/themes/light.css'),
  dark: sheet('styles/themes/dark.css'),
};

/** A palette reference (or a literal) as the hex it resolves to. */
function paletteHex(value: string): string {
  const name = value.trim().match(/^var\((--color-[\w-]+)\)$/)?.[1];
  if (!name) return value.trim().toLowerCase();
  const found = PALETTE.match(new RegExp(`${name}: (#[0-9a-fA-F]{6});`))?.[1];
  if (!found) throw new Error(`${name} is not in the palette`);
  return found.toLowerCase();
}

/** A platform theme token's declared value (its first declaration). */
function themeValue(theme: Mode, name: string): string {
  const value = THEMES[theme].match(new RegExp(`${name}: ([^;]+);`))?.[1];
  if (!value) throw new Error(`${name} is not in themes/${theme}.css`);
  return value.trim();
}

const PLATFORM_TOKENS = {
  ground: '--color-background',
  soft: '--color-surface-secondary',
  card: '--color-surface-card',
  ink: '--color-text',
  inkSoft: '--color-text-secondary',
  line: '--color-border',
  focus: '--color-focus',
  button: '--color-interactive',
} as const;

/** An org with no background: the platform theme. It sets no heading colour.
 * A brand sets its focus ring and interactive colour (`org-brand.css`). */
function platformOrg(
  theme: Mode,
  heading?: Rgb,
  focus?: Rgb,
  button?: Rgb
): Org {
  const t = (key: keyof typeof PLATFORM_TOKENS) =>
    hex(paletteHex(themeValue(theme, PLATFORM_TOKENS[key])));
  const ink = t('ink');
  return {
    ground: t('ground'),
    soft: t('soft'),
    card: t('card'),
    ink,
    inkSoft: t('inkSoft'),
    line: t('line'),
    heading: heading ?? ink,
    focus: focus ?? t('focus'),
    button: button ?? t('button'),
    background: false,
  };
}

/** The `[data-org-bg]` rule's parameters per theme: each surface's lightness
 * step and chroma share from the background, and the text's share in the
 * secondary text. §10 rebuilds the rule's text from these. */
const ORG_BG = {
  light: { soft: -0.03, card: 0.05, textShare: 0.62 },
  dark: { soft: 0.04, card: 0.07, textShare: 0.7 },
} as const;
const ORG_CHROMA = { soft: 0.5, card: 0.2, line: 0.3 } as const;

/**
 * The org's borders (owner, D12, "Fix it on the org's site (Recommended)"):
 * each steps AWAY from the background by its whole step, on the side the
 * background's luminance puts it — darker on a light ground, lighter on a
 * dark one, in either theme — at the kit's pole crossover (Y 0.1791). They
 * used to step by THEME, so a light ground in dark mode clamped every level
 * to white. `org-brand.css` computes the side in relative colour (§17).
 */
const ORG_BORDERS = {
  '--color-border-subtle': { step: 0.06, chroma: 0.2 },
  '--color-border': { step: 0.12, chroma: ORG_CHROMA.line },
  '--color-border-hover': { step: 0.15, chroma: 0.3 },
  '--color-border-strong': { step: 0.18, chroma: 0.3 },
} as const;
/** -1 on a light ground (the border darkens), +1 on a dark one. */
const awayFrom = (bg: Rgb) => (lum(bg) > INK_CROSSOVER ? -1 : 1);

/** `org-brand.css`'s `[data-org-bg]` rule for `theme`, from the background it
 * reads (the dark rule reads `--brand-bg-dark`, else the light one). A
 * branded org's interactive colour is its focus ring's chain
 * (`--brand-color`, else the platform primary). */
function orgFromBg(
  theme: Mode,
  bg: Rgb,
  heading: Rgb,
  focus: Rgb,
  button: Rgb = focus
): Org {
  const p = ORG_BG[theme];
  // oklch() clamps its lightness to 0–1.
  const at = (key: keyof typeof ORG_CHROMA) =>
    oklchFrom(
      bg,
      (l) => clampTo(0, l + p[key], 1),
      (_, c) => c * ORG_CHROMA[key]
    );
  const ink = oklchFrom(
    bg,
    (l) => clampTo(0.05, (0.6 - l) * 1000, 0.9),
    () => 0
  );
  return {
    ground: bg,
    soft: at('soft'),
    card: at('card'),
    ink,
    // `color-mix(in oklab, var(--color-text) <share>, var(--color-background))`.
    inkSoft: mix(ink, bg, 1 - p.textShare),
    line: oklchFrom(
      bg,
      (l) =>
        clampTo(0, l + ORG_BORDERS['--color-border'].step * awayFrom(bg), 1),
      (_, c) => c * ORG_CHROMA.line
    ),
    heading,
    focus,
    button,
    background: true,
  };
}

/** The surface the kit's soft band is drawn from, before a Style's tint and
 * the band (`--_org-soft`; owner, D14). On an org's background, the ground
 * as the band draws it, a step toward its ink with its chroma kept: the step
 * `org-brand.css` takes for its secondary surface, by POLE (`--_soft-step`),
 * not by theme. Where that step would leave the band it is taken the other
 * way (Codex-61zsk.42), so the band never collapses onto the ground. On the
 * platform's neutral ground, the platform's own secondary surface. */
function kitSoft(mode: Mode, org: Org, edge: number = FIRST[mode].edge): Rgb {
  if (!org.background) return org.soft;
  const step = ORG_BG[mode].soft;
  return oklchFrom(
    ground(mode, org.ground, edge),
    (l) => {
      const leaves = mode === 'light' ? l + step < edge : l + step > edge;
      return clampTo(0, l + (leaves ? -step : step), 1);
    },
    (_, c) => c
  );
}

/** A base / soft section on an org's page; `null` is the kit's own inks
 * (atmosphere's ground, and Cinematic's room). */
interface Page {
  org: Org;
  decorated: boolean;
  /** The ground's band (§16); its pole's first when the page names none. */
  band?: Band;
}

/** The safety net: an org colour moved toward its pole's side only as far as
 * the grade needs (`--_ot-*`, `--_ol-*`, `--_odt-*`, `--_odl-*`). */
function orgMove(
  mode: Mode,
  colour: Rgb,
  grade: 'text' | 'large',
  decorated: boolean,
  band: Band = FIRST[mode]
): Rgb {
  const y = decorated
    ? grade === 'text'
      ? band.odt
      : band.odl
    : grade === 'text'
      ? band.ot
      : band.ol;
  return mode === 'light' ? darken(colour, y) : lighten(colour, y);
}

/** Keep white (owner, D8), after the grade's move: a fill the org's label
 * rule turns black, but white holds 3:1 on (0.181 < Y <= 0.30), darkens —
 * its linear channels scaled, so hue and chroma keep — to Y 0.181, and the
 * label is white up to 0.182. Off on a decorated dark page (`--_wld-*`),
 * whose grade keeps a button at Y >= 0.203, where white cannot hold. */
function keepWhite(
  mode: Mode,
  fill: Rgb,
  decorated: boolean,
  kw: 0 | 1 = 1
): { fill: Rgb; label: Rgb } {
  const kneeY = (rgb: Rgb) => {
    const [r, g, b] = clip(rgb).map(kneeLin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  let out = fill;
  // Off on a band whose large grade white cannot hold (`--_band-kw`).
  if ((mode === 'light' || !decorated) && kw) {
    const L = clip(fill).map(kneeLin);
    const y = kneeY(fill);
    const f = Math.max(
      Math.min(1, TARGET.orgWhiteLabel / Math.max(y, 1e-6)),
      clampTo(0, (y - TARGET.orgWhiteLabelCut) * 1e6, 1)
    );
    out = triple((i) => unit(kneeInv(L[i] * f)));
  }
  const w = clampTo(0, (TARGET.orgWhiteLabelInk - kneeY(out)) * 1e6, 1);
  return { fill: out, label: [w, w, w] };
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
  /** Heading ink at display / heading size (large text) and at title size. */
  heading: Rgb;
  title: Rgb;
  focus: Rgb;
}

/** `source` is `--lp-accent-source`, the marks' source: the brand, unless a
 * Style points it elsewhere. `page` is the org's page a base / soft section
 * draws; without one they are the kit's (atmosphere's ground; Cinematic's
 * room, dark only). */
function schemeTokens(
  mode: Mode,
  scheme: Scheme,
  g: Rgb,
  brand: Rgb,
  tint: Tint,
  source: Rgb = brand,
  page: Page | null = null
): SchemeTokens {
  const light = mode === 'light';
  // The accent and the button from the brand, the mark from its source.
  const onLight = {
    accent: darken(brand, TARGET.accentLight),
    mark: darken(source, TARGET.markLight),
    button: darken(brand, TARGET.buttonLight),
  };
  const onDark = {
    accent: lighten(brand, TARGET.accentDark),
    mark: lighten(source, TARGET.markDark),
    button: lighten(brand, TARGET.buttonDark),
  };
  const groundSide = light ? onLight : onDark;
  const inverseSide = light ? onDark : onLight;
  // The kit's own soft band exists only in Cinematic's room, on the dark pole.
  const roomSoft = oklchFrom(
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
    if (page) {
      // The org's surfaces, banded as the ground is (`--_org-soft-bg`,
      // `--_org-panel`): `ground()` is that recipe.
      const edge = (page.band ?? FIRST[mode]).edge;
      bg =
        scheme === 'base'
          ? g
          : ground(
              mode,
              mix(kitSoft(mode, page.org, edge), brand, tint.soft),
              edge
            );
      panel = scheme === 'base' ? ground(mode, page.org.card, edge) : g;
    } else {
      if (light && scheme === 'soft')
        throw new Error('the light pole has no kit soft band: it is the org’s');
      bg = scheme === 'base' ? g : roomSoft;
      panel = scheme === 'base' ? panelG : g;
    }
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
  const kit = {
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
  if (!page || (scheme !== 'base' && scheme !== 'soft'))
    // A heading is the section's ink (`currentColor`), as is the focus ring.
    return { ...kit, heading: kit.ink, title: kit.ink, focus: kit.ink };
  const { org, decorated } = page;
  const band = page.band ?? FIRST[mode];
  const move = (colour: Rgb, grade: 'text' | 'large') =>
    orgMove(mode, colour, grade, decorated, band);
  const orgInk = move(org.ink, 'text');
  const orgButton = keepWhite(
    mode,
    move(org.button, 'large'),
    decorated,
    band.kw
  );
  return {
    ...kit,
    ink: orgInk,
    soft: move(org.inkSoft, 'text'),
    panelInk: orgInk,
    heading: move(org.heading, 'large'),
    title: move(org.heading, 'text'),
    focus: move(org.focus, 'large'),
    // The org's button and label rule (white kept on a mid-tone), its
    // accent text, and the marks in the colour the Style draws them in,
    // each at its grade.
    button: orgButton.fill,
    buttonInk: orgButton.label,
    accent: move(org.button, 'text'),
    mark: move(source, 'large'),
  };
}

/** A base / soft section's ground on an org's page. */
const orgGround = (mode: Mode, org: Org) => ground(mode, org.ground);

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
  // Display and heading size are large text; a title is not.
  heading: 3,
  title: 4.5,
  // WCAG 1.4.11, like the mark.
  focus: 3,
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
    heading: ratio(t.heading, t.bg),
    title: ratio(t.title, t.bg),
    focus: ratio(t.focus, t.bg),
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

/** Page grounds on each POLE as the org layout or a page override supplies
 * them: `platform` is an org with no background, the rest the background
 * `org-brand.css` derives from on that pole. (A cream with no dark value is on
 * the LIGHT pole in dark mode — §10; on the dark pole it is a cream set as
 * the dark background, which the band moves.) */
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
    'cream as dark': '#F6EFE6',
  },
};

/** The org whose page draws a GROUNDS entry, with `brand` as its heading
 * colour, focus ring and interactive colour — any colour, as the brand is. */
function orgFor(
  mode: Mode,
  groundName: string,
  groundHex: string,
  brand: Rgb
): Org {
  return groundName === 'platform'
    ? platformOrg(mode, brand, brand, brand)
    : orgFromBg(mode, hex(groundHex), brand, brand);
}

/** The base / soft sections a pole ships: the org's page, and on the dark
 * pole Cinematic's room as well (the kit's inks). */
function pagesOn(mode: Mode, org: Org): (Page | null)[] {
  const own: Page = { org, decorated: false };
  return mode === 'dark' ? [own, null] : [own];
}

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

  it('picks the secondary if it has chroma, else the accent, else a tone of the primary', () => {
    expect(CODE).toContain(
      `--lp-brand-2: ${PICK('--_second-in', '--_second-or-tone')};`
    );
    expect(CODE).toContain(
      `--_second-or-tone: ${PICK('--_accent-in', '--_second-tone')};`
    );
    expect(CODE).toContain(
      '--_second-tone: oklch( from var(--lp-brand) calc(var(--_tone-l)) min(c, 0.17 * var(--_tone-l), 0.46 * (1 - var(--_tone-l))) h );'
    );
    // No hue is invented any more (owner, D11).
    expect(CODE).not.toContain('calc(h + 45)');
  });

  it('reads each pole’s own inputs, falling through unset ones', () => {
    const light = rule('.lp {');
    expect(light).toContain(
      '--_accent-in: var(--brand-accent, var(--_second-tone));'
    );
    expect(light).toContain(
      '--_second-in: var(--brand-secondary, var(--_accent-in));'
    );
    const dark = rule(".lp[data-lp-style='cinematic'] {");
    expect(dark).toContain(
      '--_accent-in: var(--brand-accent-dark, var(--brand-accent, var(--_second-tone)));'
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
          const brand = hex(brandHex);
          const org = orgFor(mode, groundName, groundHex, brand);
          for (const page of pagesOn(mode, org)) {
            for (const [styleName, tint] of Object.entries(STYLE_TINTS)) {
              for (const scheme of SCHEMES) {
                const r = ratios(
                  schemeTokens(mode, scheme, g, brand, tint, brand, page)
                );
                for (const [token, floor] of Object.entries(FLOORS)) {
                  const value = r[token as keyof typeof r];
                  if (value < floor) {
                    failures.push(
                      `${brandName}/${styleName}/${page ? 'org' : 'room'}/${scheme} ${token} ${value.toFixed(2)}`
                    );
                  }
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
    const blue = hex('#2563EB');
    const bytes = (rgb: Rgb) => rgb.map((c) => Math.round(c * 255));
    // On the org's ground, as the org's own button…
    const t = schemeTokens(
      'light',
      'base',
      ground('light', hex('#fafafa')),
      blue,
      DEFAULT_TINT,
      blue,
      { org: platformOrg('light', undefined, blue, blue), decorated: false }
    );
    expect(bytes(t.button)).toEqual([0x25, 0x63, 0xeb]);
    expect(bytes(t.buttonInk)).toEqual([255, 255, 255]);
    // …and on a light kit band (the dark pole's contrast), where the old
    // white-label grade (Y <= 0.155) needed no move either but a rose did.
    const band = schemeTokens(
      'dark',
      'contrast',
      ground('dark', hex('#171717')),
      blue,
      DEFAULT_TINT
    );
    expect(bytes(band.button)).toEqual([0x25, 0x63, 0xeb]);
    const rose = hex('#E11D48');
    expect(
      bytes(
        schemeTokens(
          'dark',
          'contrast',
          ground('dark', hex('#171717')),
          rose,
          DEFAULT_TINT
        ).button
      )
    ).toEqual([0xe1, 0x1d, 0x48]);
  });

  it('keeps every surface the kit derives or moves inside sRGB, so relative colour never sees a channel outside 0–255', () => {
    // On the org's page base / soft draw the org's own surfaces as its site
    // paints them (a card at L 1 with a trace of chroma is the org's, and the
    // ink fragments clamp a channel anyway); a surface the BAND moved is the
    // kit's, and must be inside sRGB like every surface the kit derives.
    const outside: string[] = [];
    for (const mode of ['light', 'dark'] as const) {
      for (const [groundName, groundHex] of Object.entries(GROUNDS[mode])) {
        const g = ground(mode, hex(groundHex));
        for (const brandHex of Object.values(BRANDS)) {
          const brand = hex(brandHex);
          const org = orgFor(mode, groundName, groundHex, brand);
          for (const from of [
            org.ground,
            org.card,
            mix(kitSoft(mode, org), brand, STYLE_TINTS.soft.soft),
          ]) {
            const banded = ground(mode, from);
            const moved = banded.some((c, i) => Math.abs(c - from[i]) > 1e-6);
            if (moved && !inGamut(banded))
              outside.push(`${mode}/${groundHex}/${brandHex}/org band`);
          }
          const kit: [Scheme, Page | null][] = [['contrast', null]];
          if (mode === 'dark') kit.push(['base', null], ['soft', null]);
          for (const [scheme, page] of kit) {
            const t = schemeTokens(
              mode,
              scheme,
              g,
              brand,
              STYLE_TINTS.soft,
              brand,
              page
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
            // The brand as the org's heading colour and focus ring too.
            const org = platformOrg(mode, brand, brand, brand);
            for (const page of pagesOn(mode, org))
              for (const scheme of SCHEMES) {
                const values = ratios(
                  schemeTokens(
                    mode,
                    scheme,
                    g,
                    brand,
                    DEFAULT_TINT,
                    brand,
                    page
                  )
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

// ── 4b. a button on a kit band moves only as far as 3:1 needs ───────────────
/*
 * A kit band (contrast, Cinematic's room) is drawn from the brand at a fixed
 * lightness with its chroma capped, so every colour it can be is a hue ring
 * at each lightness its recipe reaches. Its button needs 3:1 against the
 * worst of them, cards included, and its label is whichever side of the
 * 0.1791 crossover it lands on — so the move needs no margin for the label,
 * and goes 2% past the floor, as the org's grades do (§10).
 */
describe('a button on a kit band — 3:1 on the worst surface it can sit on, and no further', () => {
  const ring = (L: number, cap: number): Rgb[] => {
    const out: Rgb[] = [];
    for (let h = 0; h < 360; h += 2)
      for (let k = 0; k <= 8; k++) {
        const c = (cap * k) / 8;
        const a = (h * Math.PI) / 180;
        out.push(clip(toRgb([L, c * Math.cos(a), c * Math.sin(a)])));
      }
    return out;
  };
  const span = (lo: number, hi: number, capPerL: number): Rgb[] => {
    const out: Rgb[] = [];
    for (let L = lo; L <= hi + 1e-9; L += 0.01)
      out.push(...ring(L, L * capPerL));
    return out;
  };
  const KIT_BANDS: Record<Mode, Rgb[]> = {
    // The dark pole's contrast band and its panel.
    light: [...ring(0.955, 0.02), ...ring(0.985, 0.0068)],
    // The light pole's contrast band and its panel; Cinematic's soft band
    // and panel over their lightness range.
    dark: [
      ...ring(0.2, 0.033),
      ...ring(0.265, 0.043),
      ...span(0.12, 0.27, 0.165),
      ...span(0.2, 0.28, 0.165),
    ],
  };
  const worst = (band: Mode) => {
    const ys = KIT_BANDS[band].map(lum);
    // Cinematic's ground is any colour the dark band can hold.
    return band === 'light'
      ? Math.min(...ys)
      : Math.max(...ys, lum(worstOf('dark')));
  };

  it(
    'holds 3:1 on the worst kit band surface, within 3% of what it needs',
    { timeout: 60_000 },
    () => {
      const light = (worst('light') + 0.05) / (TARGET.buttonLight + 0.05);
      const dark = (TARGET.buttonDark + 0.05) / (worst('dark') + 0.05);
      for (const [name, at] of [
        ['light', light],
        ['dark', dark],
      ] as const) {
        expect(at / 3, name).toBeGreaterThanOrEqual(1);
        expect(at / 3, name).toBeLessThanOrEqual(1.03);
      }
    }
  );

  it('has teeth: the rings hold every band the recipes draw, for every brand', () => {
    const lightY = worst('light');
    const darkY = Math.max(...KIT_BANDS.dark.map(lum));
    for (const brandHex of Object.values(BRANDS)) {
      const brand = hex(brandHex);
      const onDark = schemeTokens(
        'dark',
        'contrast',
        ground('dark', hex('#171717')),
        brand,
        DEFAULT_TINT
      );
      expect(lum(onDark.bg)).toBeGreaterThanOrEqual(lightY - 1e-9);
      expect(lum(onDark.panel)).toBeGreaterThanOrEqual(lightY - 1e-9);
      for (const tint of Object.values(STYLE_TINTS)) {
        const room = schemeTokens(
          'dark',
          'soft',
          ground('dark', hex('#171717')),
          brand,
          tint
        );
        expect(lum(room.bg)).toBeLessThanOrEqual(darkY + 1e-9);
      }
    }
  });

  it('keeps a rust’s white label on a dark band, where the old grade turned it black', () => {
    const rust = hex('#A62B0C');
    const t = schemeTokens(
      'light',
      'contrast',
      ground('light', hex('#F3F0E7')),
      rust,
      DEFAULT_TINT
    );
    expect(ratio(t.button, t.bg)).toBeGreaterThanOrEqual(3);
    expect(lum(t.button)).toBeLessThan(0.1791);
    expect(lum(t.buttonInk)).toBeGreaterThan(0.99);
    // At the old 0.24 the same rust needed a black label.
    expect(lum(lighten(rust, 0.24))).toBeGreaterThan(0.1791);
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

function failuresAt(
  mode: Mode,
  s: number,
  moved = true,
  cases: [Rgb, Rgb, Tint][] = atmosphereCases(mode)
): string[] {
  return cases.flatMap(([g, brand, tint]) =>
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
  l = GLOW[mode].l,
  cases: [Rgb, Rgb, Tint][] = atmosphereCases(mode)
): string[] {
  return cases.flatMap(([g, brand, tint]) => {
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
 * every ratio. The kit's inks hold at ANY strength; the org's colours on
 * base / soft (inks, button, accent, marks) take a decorated grade proven at
 * the strengths the Styles ship.
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
  moved = true,
  page: Page | null = null
): Decorated {
  const t = schemeTokens(mode, scheme, g, brand, tint, brand, page);
  if (scheme === 'brand' || scheme === 'accent') {
    // `oklch(from var(--lp-ink) clamp(0, (0.5 - l) * 1000, 1) 0 0)`.
    const anti: Rgb = toLab(t.ink)[0] < 0.5 ? [1, 1, 1] : [0, 0, 0];
    return { ...t, texture: mix(t.bg, anti, 0.4), shape: anti };
  }
  // The kit's own line, on the org's surfaces too (`--_tex-ink`).
  const line = ink(t.bg, INK.line);
  if (!moved) return { ...t, texture: line, shape: t.accent };
  // On the org's page base / soft keep the org's button, accent and marks at
  // their decorated grade (`schemeTokens`); only the ghost line is the
  // container query's, the soft ink.
  if (page && (scheme === 'base' || scheme === 'soft'))
    return { ...t, edge: t.soft, texture: line, shape: t.accent };
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

/** Floors over a decorated surface: atmosphere's, and the headings'. */
const BEHIND = { ...OVER_BACKDROP, heading: 3, title: 4.5 } as const;

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
    focus: ratio(t.focus, seen),
    heading: ratio(t.heading, seen),
    title: ratio(t.title, seen),
  };
  return Object.entries(BEHIND)
    .filter(([token, floor]) => r[token as keyof typeof r] < floor)
    .map(([token]) => token);
}

/** [ground, brand, tint, the org whose page it is]. */
function decoratedCases(mode: Mode): [Rgb, Rgb, Tint, Org][] {
  const cases: [Rgb, Rgb, Tint, Org][] = [];
  for (const [groundName, groundHex] of Object.entries(GROUNDS[mode]))
    for (const brandHex of Object.values(BRANDS))
      for (const tint of Object.values(STYLE_TINTS)) {
        const brand = hex(brandHex);
        cases.push([
          ground(mode, hex(groundHex)),
          brand,
          tint,
          orgFor(mode, groundName, groundHex, brand),
        ]);
      }
  const platform = ground(mode, hex(mode === 'light' ? '#fafafa' : '#171717'));
  for (let r = 0; r < 256; r += 17)
    for (let gr = 0; gr < 256; gr += 17)
      for (let b = 0; b < 256; b += 17) {
        const brand: Rgb = [r / 255, gr / 255, b / 255];
        cases.push([
          platform,
          brand,
          DEFAULT_TINT,
          platformOrg(mode, brand, brand, brand),
        ]);
      }
  return cases;
}

/**
 * `kit`: the sections drawn in the kit's own inks — contrast, brand and
 * accent everywhere, and on the dark pole Cinematic's room. `org`: base and
 * soft on the org's page, in the org's inks at their decorated grade.
 */
type DecoratedSet = 'kit' | 'org';

function surfaceFailures(
  mode: Mode,
  layers: (t: Decorated) => [Rgb, number][],
  moved = true,
  set: DecoratedSet = 'kit'
): string[] {
  const out: string[] = [];
  for (const [g, brand, tint, org] of decoratedCases(mode))
    for (const scheme of SCHEMES) {
      const own = scheme === 'base' || scheme === 'soft';
      if (set === 'org' && !own) continue;
      if (set === 'kit' && own && mode === 'light') continue;
      const page = set === 'org' ? { org, decorated: true } : null;
      const t = decoratedTokens(mode, scheme, g, brand, tint, moved, page);
      for (const token of behindFailures(t, layers(t)))
        out.push(`${set} ${scheme} ${token}`);
    }
  return out;
}

/**
 * Each Style's decorations as it SHIPS them: its texture at its own
 * strength (else the texture's), its shapes at their share of the proven
 * alpha. The org's decorated grade is proven at these, not at any strength.
 */
interface Shipped {
  id: string;
  texture: number;
  shapes: number;
}
const SHIPPED: Shipped[] = (() => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const byId = new Map<string, string>();
  for (const file of readdirSync(dir)) {
    const id = file.match(/^style-([a-z]+)(?:-[a-z]+)?\.css$/)?.[1];
    if (!id) continue;
    const css = squash(
      readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    );
    byId.set(id, `${byId.get(id) ?? ''} ${css}`);
  }
  return [...byId].flatMap(([id, css]) => {
    const texture = css.match(/--lp-texture: ([a-z]+);/)?.[1];
    const shapes = css.match(/--lp-shapes: ([a-z]+);/)?.[1];
    if (!texture && !shapes) return [];
    const own = (name: string) =>
      css.match(new RegExp(`${name}: ([\\d.]+);`))?.[1];
    const intrinsic = texture
      ? SURFACES.match(
          new RegExp(
            `style\\(--lp-texture: ${texture}\\) \\{ \\.lp-surface \\{[^}]*--_texture-strength: ([\\d.]+);`
          )
        )?.[1]
      : undefined;
    return [
      {
        id,
        texture: texture
          ? Number(own('--lp-texture-strength') ?? intrinsic)
          : 0,
        shapes: shapes
          ? Number(own('--lp-shapes-strength') ?? 1) * SHAPE_ALPHA
          : 0,
      },
    ];
  });
})();

/** A Style's layers: the texture (`::before`), then the shapes over it. */
const shippedLayers =
  (style: Shipped) =>
  (t: Decorated): [Rgb, number][] => [
    ...(style.texture ? ([[t.texture, style.texture]] as [Rgb, number][]) : []),
    ...(style.shapes ? ([[t.shape, style.shapes]] as [Rgb, number][]) : []),
  ];

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
    // The org's inks take their decorated grade on the same sections.
    for (const c of ['r', 'g', 'b']) {
      expect(softBase).toContain(`--_ot-${c}: var(--_odt-${c})`);
      expect(softBase).toContain(`--_ol-${c}: var(--_odl-${c})`);
      expect(softBase).toContain(`--_wl-${c}: var(--_wld-${c})`);
    }
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

  it('reads the decorations each Style ships', () => {
    // Studio's paper and Soft's shapes, today; a Style that adds one is
    // proven at its strength below without an edit here.
    const ids = SHIPPED.map((s) => s.id).sort();
    expect(ids).toEqual(['soft', 'studio']);
    for (const style of SHIPPED) {
      expect(style.texture + style.shapes, style.id).toBeGreaterThan(0);
      expect(style.texture, style.id).toBeLessThanOrEqual(1);
      expect(style.shapes, style.id).toBeLessThanOrEqual(SHAPE_ALPHA);
    }
  });

  // Each sweep runs the 4 096-brand cube once per strength or layering: ~8s
  // on a quiet machine, past the 15s default at a load average of 24–41
  // (S3's runs). The work is fixed and deterministic, so the limit is sized
  // to it rather than to the default; a pathological slowdown still fails.
  const SWEEP_TIMEOUT = 60_000;

  for (const mode of ['light', 'dark'] as const) {
    it(
      `${mode}: a texture at any strength holds every floor in the kit's inks`,
      { timeout: SWEEP_TIMEOUT },
      () => {
        for (const strength of [0.25, 0.5, 0.75, 1])
          expect(surfaceFailures(mode, (t) => [[t.texture, strength]])).toEqual(
            []
          );
      }
    );

    it(
      `${mode}: shapes at their alpha, and a texture over them, hold every floor in the kit's inks`,
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

    it(
      `${mode}: the org's inks hold every floor over each decoration a Style ships, at its strength`,
      { timeout: SWEEP_TIMEOUT },
      () => {
        for (const style of SHIPPED)
          expect(
            surfaceFailures(mode, shippedLayers(style), true, 'org'),
            style.id
          ).toEqual([]);
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

  it(
    'has teeth: the org’s decorated grade holds at the strength a Style ships, not at full strength',
    { timeout: SWEEP_TIMEOUT },
    () => {
      const full = (t: Decorated): [Rgb, number][] => [[t.texture, 1]];
      expect(
        surfaceFailures('light', full, true, 'org').length
      ).toBeGreaterThan(0);
    }
  );
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
          // The light pole's base and soft are the org's, whose accent and
          // marks take the org's grades (§10): the kit's sit only on its
          // own bands — contrast, and on the dark pole Cinematic's room.
          if (scheme !== 'contrast' && mode === 'light') continue;
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
    // Cinematic's room is the org's dark background, else the brand taken
    // down, moved into the dark band: any colour the band can hold.
    for (const band of ['dark'] as const)
      for (const bg of bandSurfaces()[band]) {
        keep(worst.plain, band, bg);
        const line = ink(bg, INK.line);
        // The room is only ever dark, so its shapes are drawn light.
        const shape: Rgb = [1, 1, 1];
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
      // The light kit band is the dark pole's contrast (L 0.955, a trace of
      // chroma); the dark one reaches the room's soft band and the band's
      // saturated edge.
      expect(lum(plain.light)).toBeLessThan(0.87);
      expect(lum(plain.dark)).toBeGreaterThan(0.015);
      expect(lum(decorated.light)).toBeLessThan(lum(plain.light));
      expect(lum(decorated.dark)).toBeGreaterThan(lum(plain.dark));
    }
  );

  it(
    'holds the accent (4.5:1) and the mark (3.3:1, its margin) on any kit surface',
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

// ── 10. the org is the source (phase 3a, findings §6) ───────────────────────
/*
 * Base and soft draw the org's own tokens (`--_org-*` ← `--color-*`). The
 * model computes them as the CONSUMER does — through `org-brand.css`'s
 * derivation, or the platform theme for an org with no background — so those
 * are held to their text first. Then the bands and the safety-net moves are
 * measured against EVERY colour a band can hold, not a sample: an org's
 * background, and so its surfaces, can be any colour.
 */
const ORG_BRAND = sheet('styles/tokens/org-brand.css');

/** Every 8-bit sRGB colour inside each band, and each band's moved edge. */
let bandCache: Record<Mode, Rgb[]> | null = null;
function bandSurfaces(): Record<Mode, Rgb[]> {
  if (bandCache) return bandCache;
  const lin = Float64Array.from({ length: 256 }, (_, i) => srgbToLin(i / 255));
  const out: Record<Mode, Rgb[]> = { light: [], dark: [] };
  for (let r = 0; r < 256; r++)
    for (let g = 0; g < 256; g++)
      for (let b = 0; b < 256; b++) {
        const [R, G, B] = [lin[r], lin[g], lin[b]];
        const L =
          0.2104542553 *
            Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B) +
          0.793617785 *
            Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B) -
          0.0040720468 *
            Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
        if (L >= 0.9) out.light.push([r / 255, g / 255, b / 255]);
        else if (L <= 0.24) out.dark.push([r / 255, g / 255, b / 255]);
      }
  // A colour moved into a band lands on its edge, chroma capped (`ground()`).
  for (const [band, L, cap] of [
    ['light', 0.9, 0.046],
    ['dark', 0.24, 0.039],
  ] as const)
    for (let h = 0; h < 360; h += 2)
      for (let k = 0; k <= 8; k++) {
        const c = (cap * k) / 8;
        const a = (h * Math.PI) / 180;
        out[band].push(clip(toRgb([L, c * Math.cos(a), c * Math.sin(a)])));
      }
  bandCache = out;
  return out;
}

const towardInk = (band: Mode, y: number, than: number) =>
  band === 'light' ? y < than : y > than;

/** The surface `band` can hold that is nearest its ink, as `seen` paints it. */
function worstOf(band: Mode, seen: (s: Rgb) => Rgb[] = (s) => [s]): Rgb {
  let worst: Rgb = band === 'light' ? [1, 1, 1] : [0, 0, 0];
  let wy = lum(worst);
  for (const s of bandSurfaces()[band])
    for (const v of seen(s)) {
      const y = lum(v);
      if (towardInk(band, y, wy)) {
        worst = v;
        wy = y;
      }
    }
  return worst;
}

/** Under each Style's shipped decorations: its texture in the kit's line,
 * then its shapes in any colour (a moved accent can be black or white). */
function decoratedSeen(band: Mode, s: Rgb): Rgb[] {
  const shape: Rgb = band === 'light' ? [0, 0, 0] : [1, 1, 1];
  const over = (paint: Rgb, alpha: number, under: Rgb): Rgb =>
    triple((i) => alpha * clip(paint)[i] + (1 - alpha) * clip(under)[i]);
  return SHIPPED.map((style) => {
    let seen = s;
    if (style.texture) seen = over(ink(s, INK.line), style.texture, seen);
    if (style.shapes) seen = over(shape, style.shapes, seen);
    return seen;
  });
}

const worstCache = new Map<string, Rgb>();
function worstSurface(band: Mode, decorated: boolean): Rgb {
  const key = `${band}/${decorated}`;
  let worst = worstCache.get(key);
  if (!worst) {
    worst = decorated
      ? worstOf(band, (s) => decoratedSeen(band, s))
      : worstOf(band);
    worstCache.set(key, worst);
  }
  return worst;
}

/** The next edge past each pole's last band: §16 shows it holds no
 * decorated text, whatever the ink. */
const PAST = { light: 0.64, dark: 0.54 } as const;
const edgesOf = (pole: Mode) => [
  ...GROUND_BANDS.filter((b) => b.pole === pole).map((b) => b.edge),
  PAST[pole],
];

/**
 * The luminance of the worst surface of EVERY band (§16), plain and under
 * the decorations that ship, in one pass over the sRGB cube and each edge's
 * ring: a pole's bands nest, so a colour counts toward each band that holds
 * it. `worstSurface` above is the first bands' (§16 holds the two equal).
 */
interface BandWorst {
  plain: number;
  decorated: number;
  /** The plain worst surface itself. */
  plainAt: Rgb;
}
let bandWorstCache: Record<string, BandWorst> | null = null;
function bandWorsts(): Record<string, BandWorst> {
  if (bandWorstCache) return bandWorstCache;
  const edges = { light: edgesOf('light'), dark: edgesOf('dark') };
  const out: Record<string, BandWorst> = {};
  for (const pole of ['light', 'dark'] as const)
    for (const e of edges[pole]) {
      const far = pole === 'light' ? 2 : -1;
      out[`${pole}/${e}`] = { plain: far, decorated: far, plainAt: [0, 0, 0] };
    }
  const over = (paint: Rgb, alpha: number, under: Rgb): Rgb =>
    triple((i) => alpha * paint[i] + (1 - alpha) * under[i]);
  const hold = (pole: Mode, L: number, s: Rgb, y: number) => {
    const shape: Rgb = pole === 'light' ? [0, 0, 0] : [1, 1, 1];
    const line = clip(ink(s, INK.line));
    let dy = pole === 'light' ? 2 : -1;
    for (const style of SHIPPED) {
      let seen = s;
      if (style.texture) seen = over(line, style.texture, seen);
      if (style.shapes) seen = over(shape, style.shapes, seen);
      const v = lum(seen);
      if (towardInk(pole, v, dy)) dy = v;
    }
    for (const e of edges[pole]) {
      if (pole === 'light' ? L < e : L > e) continue;
      const w = out[`${pole}/${e}`];
      if (towardInk(pole, y, w.plain)) {
        w.plain = y;
        w.plainAt = s;
      }
      if (towardInk(pole, dy, w.decorated)) w.decorated = dy;
    }
  };
  const lin = Float64Array.from({ length: 256 }, (_, i) => srgbToLin(i / 255));
  const lightFrom = Math.min(...edges.light);
  const darkTo = Math.max(...edges.dark);
  for (let r = 0; r < 256; r++)
    for (let g = 0; g < 256; g++)
      for (let b = 0; b < 256; b++) {
        const [R, G, B] = [lin[r], lin[g], lin[b]];
        const L =
          0.2104542553 *
            Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B) +
          0.793617785 *
            Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B) -
          0.0040720468 *
            Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
        const pole = L >= lightFrom ? 'light' : L <= darkTo ? 'dark' : null;
        if (!pole) continue;
        const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        hold(pole, L, [r / 255, g / 255, b / 255], y);
      }
  // A colour moved into a band lands on its edge, chroma capped (`ground()`).
  for (const [pole, cap] of [
    ['light', 0.046],
    ['dark', 0.039],
  ] as const)
    for (const e of edges[pole])
      for (let h = 0; h < 360; h += 2)
        for (let k = 0; k <= 8; k++) {
          const c = (cap * k) / 8;
          const a = (h * Math.PI) / 180;
          const s = clip(toRgb([e, c * Math.cos(a), c * Math.sin(a)]));
          hold(pole, e, s, lum(s));
        }
  bandWorstCache = out;
  return out;
}

const GRADES = [
  { name: 'text', grade: 'text', floor: 4.5, decorated: false },
  { name: 'large', grade: 'large', floor: 3, decorated: false },
  { name: 'decorated text', grade: 'text', floor: 4.5, decorated: true },
  { name: 'decorated large', grade: 'large', floor: 3, decorated: true },
] as const;
const target = (band: Mode, g: (typeof GRADES)[number]) => {
  const light = band === 'light';
  if (g.decorated)
    return g.grade === 'text'
      ? light
        ? TARGET.orgDecTextLight
        : TARGET.orgDecTextDark
      : light
        ? TARGET.orgDecLargeLight
        : TARGET.orgDecLargeDark;
  return g.grade === 'text'
    ? light
      ? TARGET.orgTextLight
      : TARGET.orgTextDark
    : light
      ? TARGET.orgLargeLight
      : TARGET.orgLargeDark;
};

/** The kit's soft surface on an org's background (owner, D14): the ground
 * as its band draws it, a step toward its ink (`--_soft-step`), or the other
 * way where that step would leave the band (`--_band-side`; §16). */
const SOFT_STEP_EXPR =
  'oklch(from var(--lp-ground) calc(l + var(--_soft-step) * (1 - 2 * clamp(0, (var(--_band-edge) - l - var(--_soft-step)) * var(--_band-side) * 1e6, 1))) c h)';

/** The `[data-org-bg]` rule as `org-brand.css` spells it, from ORG_BG. */
function orgBgRecipes(theme: Mode): Record<string, string> {
  const bg =
    theme === 'light'
      ? 'var(--brand-bg, white)'
      : 'var(--brand-bg-dark, var(--brand-bg, #1a1a2e))';
  const p = ORG_BG[theme];
  const step = (d: number) => `calc(l ${d < 0 ? '-' : '+'} ${Math.abs(d)})`;
  const at = (key: 'soft' | 'card') =>
    `oklch(from ${bg} ${step(p[key])} calc(c * ${ORG_CHROMA[key]}) h)`;
  const border = (name: keyof typeof ORG_BORDERS) =>
    `oklch(from ${bg} calc(l + ${ORG_BORDERS[name].step} * var(--_bg-away)) calc(c * ${ORG_BORDERS[name].chroma}) h)`;
  return {
    '--color-background': bg,
    '--color-surface-secondary': at('soft'),
    '--color-surface-card': at('card'),
    '--color-text': `oklch(from ${bg} clamp(0.05, (0.6 - l) * 1000, 0.9) 0 0)`,
    '--color-text-secondary': `color-mix(in oklab, var(--color-text) ${Math.round(p.textShare * 100)}%, var(--color-background))`,
    '--color-border': border('--color-border'),
    '--color-border-subtle': border('--color-border-subtle'),
    '--color-border-hover': border('--color-border-hover'),
    '--color-border-strong': border('--color-border-strong'),
  };
}

/** The `--_org-*` name each `--color-*` the kit reads is re-stated as. */
const ORG_NAMES: Record<string, string> = {
  '--color-background': '--_org-ground',
  '--color-surface-secondary': '--_org-soft',
  '--color-surface-card': '--_org-card',
  '--color-text': '--_org-ink',
  '--color-text-secondary': '--_org-ink-soft',
  '--color-border': '--_org-line',
  '--color-heading': '--_org-heading',
  '--color-focus': '--_org-focus',
  '--color-interactive': '--_org-button',
};

/** `org-brand.css` text as a scoped preview re-states it: the kit's names,
 * and palette tokens for its literals (the kit takes no literal colour;
 * `#1a1a2e` is the fallback for a `data-org-bg` with no background, which
 * the org layout never renders). */
const asPreview = (value: string) =>
  value
    .replace(/\bwhite\b/g, 'var(--color-neutral-0)')
    .replace(/#1a1a2e/g, 'var(--color-neutral-900)')
    .replace(/var\(--color-text-secondary\)/g, 'var(--_org-ink-soft)')
    .replace(/var\(--color-text(?:-primary)?\)/g, 'var(--_org-ink)')
    .replace(/var\(--color-background\)/g, 'var(--_org-ground)');

/** The org's tokens on the seeded dev orgs, as measured on their explore
 * pages (`scratchpad/3a/before`, 2026-10-09). */
const SEEDED = {
  'of-blood-and-bones': { bg: '#F3F0E7', brand: '#A62B0C', heading: '#A62B0C' },
  'studio-alpha': {
    bg: null,
    brand: '#E11D48',
    heading: '#E11D48',
    headingDark: '#FF4C64',
  },
  'studio-beta': { bg: null, brand: '#2563EB' },
} as const;

describe('the org is the source — its tokens, drawn exactly unless a floor fails (phase 3a)', () => {
  const block = (pattern: RegExp) => ORG_BRAND.match(pattern)?.[1] ?? '';
  const ORG_BG_RULE = {
    light: block(/\} \[data-org-bg\] \{([^}]*)\}/),
    dark: block(/\[data-editing-theme='dark'\]\[data-org-bg\] \{([^}]*)\}/),
  };

  it('models org-brand.css: the surfaces, text and border it derives from the background', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(ORG_BG_RULE[theme].length, theme).toBeGreaterThan(0);
      for (const [name, value] of Object.entries(orgBgRecipes(theme)))
        expect(ORG_BG_RULE[theme], `${theme} ${name}`).toContain(
          `${name}: ${value};`
        );
      // A heading with no colour of its own is the text (`--color-text-primary`).
      expect(ORG_BG_RULE[theme]).toContain(
        `--color-text-primary: ${orgBgRecipes(theme)['--color-text']};`
      );
    }
    for (const chain of [
      '--color-heading: var(--brand-heading-color, var(--color-text-primary));',
      '--color-heading: var(--brand-heading-color-dark, var(--brand-heading-color, var(--color-text-primary)));',
      '--color-focus: var(--brand-color, var(--color-primary-500));',
      '--color-focus: var(--brand-color-dark, var(--brand-color, var(--color-primary-400)));',
    ])
      expect(ORG_BRAND).toContain(chain);
  });

  it('models the platform theme for an org with no background (calibrated against the dev stack)', () => {
    // The colours; `background` is checked on its own below.
    const asHex = (org: Org) =>
      Object.fromEntries(
        Object.entries(org).flatMap(([k, v]) =>
          Array.isArray(v)
            ? [
                [
                  k,
                  `#${v
                    .map((c: number) =>
                      Math.round(c * 255)
                        .toString(16)
                        .padStart(2, '0')
                    )
                    .join('')}`,
                ],
              ]
            : []
        )
      );
    expect(asHex(platformOrg('light'))).toEqual({
      ground: '#fafafa',
      soft: '#f5f5f5',
      card: '#ffffff',
      ink: '#171717',
      inkSoft: '#525252',
      line: '#e5e5e5',
      heading: '#171717',
      focus: '#c24129',
      button: '#c24129',
    });
    expect(asHex(platformOrg('dark'))).toEqual({
      ground: '#171717',
      soft: '#404040',
      card: '#404040',
      ink: '#fafafa',
      inkSoft: '#d4d4d4',
      line: '#404040',
      heading: '#fafafa',
      focus: '#f47d67',
      button: '#f47d67',
    });
    for (const theme of ['light', 'dark'] as const) {
      expect(platformOrg(theme).background).toBe(false);
      // No platform heading colour: a heading is the text, as `--color-text-primary`.
      expect(THEMES[theme]).not.toContain('--color-heading:');
      expect(paletteHex(themeValue(theme, '--color-text-primary'))).toBe(
        paletteHex(themeValue(theme, '--color-text'))
      );
    }
  });

  it('reads exactly the nine tokens the org’s site paints with', () => {
    for (const [name, own] of Object.entries(ORG_NAMES)) {
      const fallback = name === '--color-heading' ? ', var(--color-text)' : '';
      expect(POLE.light).toContain(`${own}: var(${name}${fallback});`);
    }
  });

  it('re-states them for a scoped preview exactly as the previewed theme derives them', () => {
    const LAST = {
      dark: ".lp:not([data-lp-theme='light']) )",
      light: "[data-editing-theme='dark'] .lp[data-lp-theme='light'] )",
    };
    const body = (head: string) => {
      expect(CODE.split(head).length - 1, head).toBe(1);
      return (
        CODE.slice(CODE.indexOf(head) + head.length).match(/^([^}]*)\}/)?.[1] ??
        ''
      );
    };
    const decls = (text: string) =>
      Object.fromEntries(
        [...text.matchAll(/(--_org-[\w-]+): ([^;]+);/g)].map((m) => [
          m[1],
          m[2].trim(),
        ])
      );
    for (const theme of ['light', 'dark'] as const) {
      // No background: the platform theme.
      const platform = decls(body(`${LAST[theme]} {`));
      for (const name of Object.values(PLATFORM_TOKENS)) {
        if (name === '--color-focus') continue;
        expect(paletteHex(platform[ORG_NAMES[name]]), `${theme} ${name}`).toBe(
          paletteHex(themeValue(theme, name))
        );
      }
      expect(platform['--_org-heading']).toBe('var(--_org-ink)');
      expect(platform['--_org-focus']).toBe(themeValue(theme, '--color-focus'));
      // A branded org: its heading colour and focus ring, by the theme's chain.
      const branded = decls(
        body(`${LAST[theme]}:is([data-org-brand] .lp, [data-org-brand]) {`)
      );
      const chain = (name: string) =>
        [
          ...ORG_BRAND.matchAll(
            new RegExp(`${name}: (var\\(--brand-[^;]+);`, 'g')
          ),
        ]
          .map((m) => m[1])
          .find((v) => (theme === 'dark') === v.includes('-dark,')) ?? '';
      expect(branded['--_org-heading']).toBe(
        asPreview(chain('--color-heading'))
      );
      expect(branded['--_org-focus']).toBe(asPreview(chain('--color-focus')));
      expect(branded['--_org-button']).toBe(
        asPreview(chain('--color-interactive'))
      );
      // The org's background: `org-brand.css`'s rule for the theme, from
      // the org's own inputs, so a page background with no twin for this
      // theme does not shadow them (owner, D7)…
      // The soft surface on a background is the kit's own (owner, D14):
      // the previewed ground as its band draws it, by the pole's step (the
      // other way at the band's edge, §16), with its chroma.
      const recipes = Object.entries(orgBgRecipes(theme)).filter(
        ([name]) => name !== '--color-surface-secondary' && name in ORG_NAMES
      );
      const SOFT = SOFT_STEP_EXPR;
      const fromOrg = decls(body(`${LAST[theme]}:is([data-org-bg] .lp) {`));
      for (const [name, value] of recipes)
        expect(fromOrg[ORG_NAMES[name]], `${theme} ${name}`).toBe(
          asPreview(value)
            .replace(/var\(--brand-bg-dark,/g, 'var(--_org-bg-dark-in,')
            .replace(/var\(--brand-bg,/g, 'var(--_org-bg-in,')
        );
      expect(fromOrg['--_org-soft'], theme).toBe(SOFT);
      // …and the page's own, where it sets one for this theme.
      const own = decls(
        body(
          `${LAST[theme]}:is(.lp[data-org-bg]:is([data-page-bg='${theme}'], [data-page-bg='both'])) {`
        )
      );
      for (const [name, value] of recipes)
        expect(own[ORG_NAMES[name]], `${theme} ${name}`).toBe(asPreview(value));
      expect(own['--_org-soft'], theme).toBe(SOFT);
    }
    expect(paletteHex('var(--color-neutral-0)')).toBe('#ffffff');
  });

  it('puts the ground on the pole of its own lightness, as PageRenderer names its band (Codex-61zsk.42)', () => {
    // No dark background: the dark rule paints the light one, so the dark
    // theme's band is the light background's (`resolveGroundBands`).
    expect(orgBgRecipes('dark')['--color-background']).toContain(
      'var(--brand-bg-dark, var(--brand-bg,'
    );
    // The dark pole is each theme's selectors, less a dark theme whose
    // ground is on a light band, plus a light theme whose ground is on a
    // dark band. Cinematic's room is dark in every theme.
    const head = [
      ":is(.dark, [data-theme='dark']) .lp:not([data-lp-theme='light'], [data-editing-theme='light'] .lp, [data-ground-dark^='l'])",
      "[data-editing-theme='dark'] .lp:not([data-lp-theme='light'], [data-ground-dark^='l'])",
      ":root:not(.dark, [data-theme='dark']) .lp[data-ground-light^='d']:not([data-lp-theme='dark'], [data-editing-theme='dark'] .lp)",
      "[data-editing-theme='light'] .lp[data-ground-light^='d']:not([data-lp-theme='dark'])",
      ".lp[data-lp-theme='light'][data-ground-light^='d']",
      ".lp[data-lp-theme='dark']:not([data-ground-dark^='l'])",
      ".lp[data-lp-style='cinematic'] {",
    ].join(', ');
    expect(CODE.split(head).length - 1).toBe(1);
    expect(CODE.slice(CODE.indexOf(head) + head.length)).toMatch(
      /^ [^}]*--lp-ground:/
    );
    // The org's background is no longer read from its style text, nor the
    // page's: the band attributes are the only thing the pole selects on.
    expect(CODE).not.toContain('[style*=');
    // Every band id starts with its pole's letter, which the selectors read.
    for (const band of GROUND_BANDS)
      expect(band.id[0], band.id).toBe(band.pole === 'light' ? 'l' : 'd');
  });

  it('gives a page background with no twin back to the org in the other theme (owner, D7)', () => {
    // Every token org-brand.css's background rules set, light and dark.
    const names = (rule: string) => [
      ...new Set([...rule.matchAll(/(--[\w-]+):/g)].map((m) => m[1])),
    ];
    const union = [
      ...new Set([...names(ORG_BG_RULE.light), ...names(ORG_BG_RULE.dark)]),
    ];
    expect(union.length).toBeGreaterThan(15);
    const head =
      ":is(.dark, [data-theme='dark']) .lp[data-page-bg='light']:not([data-lp-theme='light'], [data-editing-theme='light'] .lp), " +
      ":root:not(.dark, [data-theme='dark']) .lp[data-page-bg='dark']:not([data-lp-theme='dark'], [data-editing-theme='dark'] .lp) {";
    expect(CODE.split(head).length - 1).toBe(1);
    const rule =
      CODE.slice(CODE.indexOf(head) + head.length).match(/^([^}]*)\}/)?.[1] ??
      '';
    expect(rule.trim()).toBe(
      union.map((name) => `${name}: inherit;`).join(' ')
    );
    // Beats org-brand.css's rules on the carrier whatever the order: (0,6,0)
    // and up, against its `.dark [data-org-bg]` (0,2,0); no @layer here.
    expect(CSS).not.toContain('@layer');
    // A preview of that theme reads the org's own inputs, captured above
    // the carrier.
    expect(CODE).toContain(
      '[data-org-bg]:not(.lp) { --_org-bg-in: var(--brand-bg); --_org-bg-dark-in: var(--brand-bg-dark); }'
    );
  });

  it(
    'draws the seeded orgs exactly, light and dark, and moves only what fails',
    { timeout: 60_000 },
    () => {
      const byte = (rgb: Rgb) => clip(rgb).map((c) => Math.round(c * 255));
      const moved = (a: Rgb, b: Rgb) =>
        byte(a).some((v, i) => Math.abs(v - byte(b)[i]) > 1);
      const report: Record<string, string[]> = {};
      for (const [name, seed] of Object.entries(SEEDED))
        for (const theme of ['light', 'dark'] as const) {
          const brand = hex(seed.brand);
          const heading =
            'heading' in seed
              ? hex(
                  theme === 'dark' && 'headingDark' in seed
                    ? seed.headingDark
                    : seed.heading
                )
              : undefined;
          const org = seed.bg
            ? orgFromBg(theme, hex(seed.bg), heading ?? brand, brand)
            : platformOrg(theme, heading, brand, brand);
          // An org background with no dark one stays light in dark mode.
          const pole: Mode = seed.bg ? 'light' : theme;
          for (const decorated of [false, true]) {
            const page = { org, decorated };
            const g = orgGround(pole, org);
            const base = schemeTokens(
              pole,
              'base',
              g,
              brand,
              DEFAULT_TINT,
              brand,
              page
            );
            const soft = schemeTokens(
              pole,
              'soft',
              g,
              brand,
              DEFAULT_TINT,
              brand,
              page
            );
            const drawn: [string, Rgb, Rgb][] = [
              ['ground', base.bg, org.ground],
              // The surface the kit draws its soft band from (owner, D14).
              ['soft band', soft.bg, kitSoft(pole, org)],
              ['panel', base.panel, org.card],
              ['ink', base.ink, org.ink],
              ['soft ink', base.soft, org.inkSoft],
              ['heading', base.heading, org.heading],
              ['title', base.title, org.heading],
              ['focus', base.focus, org.focus],
              ['button', base.button, org.button],
              ['button label', base.buttonInk, pivot(org.button)],
              ['accent', base.accent, org.button],
              ['mark', base.mark, brand],
            ];
            report[`${name} ${theme}${decorated ? ' decorated' : ''}`] = drawn
              .filter(([, kit, own]) => moved(kit, own))
              .map(([token]) => token);
          }
        }
      // Every button, label and mark is the org's own on its plain pages.
      // The accent is text, so an interactive colour that is only large-text
      // safe moves for it (rose and blue, both themes); the rust holds.
      expect(report).toEqual({
        'of-blood-and-bones light': [],
        'of-blood-and-bones dark': [],
        // Studio's paper: a title or accent in #A62B0C (Y 0.099) is text,
        // not large.
        'of-blood-and-bones light decorated': ['title', 'accent'],
        'of-blood-and-bones dark decorated': ['title', 'accent'],
        // #E11D48 is large text on #fafafa (4.47:1), but a title is not.
        'studio-alpha light': ['title', 'accent'],
        // The platform's dark surfaces (#404040, L 0.37) sit above the dark band.
        'studio-alpha dark': ['soft band', 'panel', 'accent'],
        // Under paper, a rose fill needs the decorated large grade: it
        // darkens (light) or lightens past the crossover to a black label.
        'studio-alpha light decorated': [
          'heading',
          'title',
          'focus',
          'button',
          'accent',
          'mark',
        ],
        'studio-alpha dark decorated': [
          'soft band',
          'panel',
          'title',
          'focus',
          'button',
          'button label',
          'accent',
          'mark',
        ],
        'studio-beta light': ['accent'],
        'studio-beta dark': ['soft band', 'panel', 'accent'],
        'studio-beta light decorated': ['accent'],
        'studio-beta dark decorated': [
          'soft band',
          'panel',
          'focus',
          'button',
          'button label',
          'accent',
          'mark',
        ],
      });
    }
  );

  it('never moves an org colour that already holds', () => {
    const kneeY = (rgb: Rgb) => {
      const [r, g, b] = clip(rgb).map(kneeLin);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let kept = 0;
    let movedCount = 0;
    for (let r = 0; r < 256; r += 15)
      for (let g = 0; g < 256; g += 15)
        for (let b = 0; b < 256; b += 15) {
          const c: Rgb = [r / 255, g / 255, b / 255];
          for (const band of ['light', 'dark'] as const)
            for (const grade of GRADES) {
              const t = target(band, grade);
              const holds = band === 'light' ? kneeY(c) <= t : kneeY(c) >= t;
              const out = orgMove(band, c, grade.grade, grade.decorated);
              if (holds) {
                kept++;
                for (const i of [0, 1, 2] as const)
                  expect(Math.abs(out[i] - c[i])).toBeLessThan(1e-9);
              } else movedCount++;
            }
        }
    expect(kept).toBeGreaterThan(1000);
    expect(movedCount).toBeGreaterThan(1000);
  });

  it(
    'holds every floor for ANY org colour, on the worst surface its band can hold',
    { timeout: 60_000 },
    () => {
      const sources: Rgb[] = Object.values(BRANDS).map(hex);
      for (let r = 0; r < 256; r += 17)
        for (let g = 0; g < 256; g += 17)
          for (let b = 0; b < 256; b += 17)
            sources.push([r / 255, g / 255, b / 255]);
      const lowest: Record<string, number> = {};
      for (const band of ['light', 'dark'] as const)
        for (const grade of GRADES) {
          const worst = worstSurface(band, grade.decorated);
          let low = Number.POSITIVE_INFINITY;
          for (const s of sources)
            low = Math.min(
              low,
              ratio(orgMove(band, s, grade.grade, grade.decorated), worst)
            );
          lowest[`${band} ${grade.name}`] = low;
          expect(low, `${band} ${grade.name}`).toBeGreaterThanOrEqual(
            grade.floor
          );
        }
      expect(Object.keys(lowest)).toHaveLength(8);
    }
  );

  it(
    'moves no further than that: each target within 3% of what the worst surface needs',
    { timeout: 60_000 },
    () => {
      for (const band of ['light', 'dark'] as const)
        for (const grade of GRADES) {
          const yw = lum(worstSurface(band, grade.decorated));
          const t = target(band, grade);
          const at =
            band === 'light'
              ? (yw + 0.05) / (t + 0.05)
              : (t + 0.05) / (yw + 0.05);
          expect(
            at / grade.floor,
            `${band} ${grade.name}`
          ).toBeGreaterThanOrEqual(1);
          expect(at / grade.floor, `${band} ${grade.name}`).toBeLessThanOrEqual(
            1.03
          );
        }
    }
  );

  it(
    'has teeth: the band holds surfaces darker / lighter than any sampled ground, and a looser move fails them',
    { timeout: 60_000 },
    () => {
      // The darkest light surface and the lightest dark one: a saturated
      // colour at the band's edge, which no grey or sampled ground reaches.
      expect(lum(worstSurface('light', false))).toBeLessThan(0.71);
      expect(lum(worstSurface('dark', false))).toBeGreaterThan(0.015);
      expect(lum(worstSurface('light', true))).toBeLessThan(
        lum(worstSurface('light', false))
      );
      // 3% looser than the text grade fails the worst surface.
      const looser = darken(
        [1, 1, 1],
        (TARGET.orgTextLight + 0.05) * 1.03 - 0.05
      );
      expect(ratio(looser, worstSurface('light', false))).toBeLessThan(4.5);
    }
  );
});

// ── 11. keep white (owner, D8) ──────────────────────────────────────────────
describe('keep white — a mid-tone button darkens a little rather than take a black label (owner, D8)', () => {
  const WHITE: Rgb = [1, 1, 1];
  const kneeY = (rgb: Rgb) => {
    const [r, g, b] = clip(rgb).map(kneeLin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  /** The fill as painted: each channel rounded to a byte. */
  const painted = (rgb: Rgb): Rgb =>
    triple((i) => Math.round(unit(rgb[i]) * 255) / 255);
  const same = (a: Rgb, b: Rgb) =>
    [0, 1, 2].every(
      (i) => Math.abs(a[i as 0 | 1 | 2] - b[i as 0 | 1 | 2]) < 1e-9
    );
  const hueOf = (rgb: Rgb) => {
    const [, a, b] = toLab(rgb);
    return { h: Math.atan2(b, a), c: Math.hypot(a, b) };
  };
  const cube = (step: number) => {
    const out: Rgb[] = [];
    for (let r = 0; r < 256; r += step)
      for (let g = 0; g < 256; g += step)
        for (let b = 0; b < 256; b += step)
          out.push([r / 255, g / 255, b / 255]);
    return out;
  };

  it('routes the move on, and switches it off on a decorated dark page', () => {
    expect(CODE).toContain(
      squash(
        '--_wl-r: var(--_wlm-r); --_wl-g: var(--_wlm-g); --_wl-b: var(--_wlm-b); --_wld-r: var(--_wlm-r); --_wld-g: var(--_wlm-g); --_wld-b: var(--_wlm-b);'
      )
    );
    expect(POLE.dark).toContain(
      squash('--_wld-r: r; --_wld-g: g; --_wld-b: b;')
    );
    expect(POLE.light).not.toContain('--_wld-r: r;');
    // White cannot reach 4.5:1 above Y 0.1833, and the decorated dark grade
    // holds a button at or above 0.203 — so that move would break its 3:1.
    expect(1.05 / (TARGET.orgDecLargeDark + 0.05)).toBeLessThan(4.5);
  });

  it(
    'every mid-tone ends white at >= 4.5:1 as painted, by the kit’s own darken, hue kept and its grade held; every other fill keeps the org’s rule; nothing that holds moves',
    { timeout: 60_000 },
    () => {
      const counts = { whitened: 0, alreadyWhite: 0, orgRule: 0 };
      let lowest = Number.POSITIVE_INFINITY;
      let hueShift = 0;
      for (const c of cube(15))
        for (const band of ['light', 'dark'] as const)
          for (const decorated of [false, true]) {
            const before = orgMove(band, c, 'large', decorated);
            const y0 = kneeY(before);
            const { fill, label } = keepWhite(band, before, decorated);
            const on = band === 'light' || !decorated;
            if (on && y0 > 0.1791 && y0 <= TARGET.orgWhiteLabelCut) {
              // The range: the org's rule gives black, white holds 3:1.
              expect(label).toEqual(WHITE);
              const drawn = ratio(WHITE, painted(fill));
              lowest = Math.min(lowest, drawn);
              expect(drawn, `${band} ${c}`).toBeGreaterThanOrEqual(4.5);
              // Only as far as white needs, by the kit's own darken (linear
              // channels scaled): a fill white already holds stays put.
              expect(same(fill, darken(before, TARGET.orgWhiteLabel))).toBe(
                true
              );
              if (y0 <= TARGET.orgWhiteLabel)
                expect(same(fill, before)).toBe(true);
              else {
                // At the target, give or take a channel clipped at 0.
                expect(kneeY(fill)).toBeGreaterThan(
                  TARGET.orgWhiteLabel - 1e-9
                );
                expect(kneeY(fill)).toBeLessThan(
                  TARGET.orgWhiteLabel + kneeLin(0)
                );
              }
              const [h0, h1] = [hueOf(before), hueOf(fill)];
              // The move scales the curve's linear channels; oklab reads the
              // true curve, which differs below its knee, so a hair moves.
              if (h0.c > 0.02)
                hueShift = Math.max(
                  hueShift,
                  (Math.abs(h1.h - h0.h) * 180) / Math.PI
                );
              // The grade still holds: a darker fill only helps on a light
              // band, and on a dark one 0.181 sits above the 3:1 target.
              if (band === 'dark')
                expect(kneeY(fill)).toBeGreaterThanOrEqual(TARGET.orgLargeDark);
              if (y0 <= TARGET.orgWhiteLabel) counts.alreadyWhite++;
              else counts.whitened++;
            } else {
              // Outside it, the org's rule on the org's fill, unmoved.
              expect(same(fill, before)).toBe(true);
              expect(label).toEqual(pivot(before));
              counts.orgRule++;
            }
          }
      // Painted white never drops below 4.5:1; at the 0.1833 limit itself the
      // rounding would (next test).
      expect(lowest).toBeGreaterThanOrEqual(4.5);
      expect(hueShift).toBeLessThan(0.05);
      expect(counts.whitened).toBeGreaterThan(500);
      expect(counts.orgRule).toBeGreaterThan(500);
    }
  );

  it('has teeth: darkened only to white’s 4.5:1 limit, the painted fill falls short', () => {
    let short = 0;
    for (const c of cube(15)) {
      const y = kneeY(c);
      if (y <= 0.1833 || y > TARGET.orgWhiteLabelCut) continue;
      if (ratio(WHITE, painted(darken(c, 0.1833))) < 4.5) short++;
    }
    expect(short).toBeGreaterThan(0);
  });

  it('draws Tending the Grief’s own brand a little darker, with a white label', () => {
    // of-blood-and-bones' page sets only its brand, #EF3D0B (Y 0.217): its
    // interactive colour and focus ring; the ground and heading stay the
    // org's, light in both themes (the org's background has no dark one).
    const brand = hex('#EF3D0B');
    const outcome: Record<string, string> = {};
    const bytes = (rgb: Rgb) =>
      `#${clip(rgb)
        .map((v) =>
          Math.round(v * 255)
            .toString(16)
            .padStart(2, '0')
        )
        .join('')}`;
    for (const theme of ['light', 'dark'] as const) {
      const org = orgFromBg(theme, hex('#F3F0E7'), hex('#A62B0C'), brand);
      const t = schemeTokens(
        'light',
        'base',
        orgGround('light', org),
        brand,
        DEFAULT_TINT,
        brand,
        { org, decorated: false }
      );
      outcome[theme] = `${bytes(t.button)} ${bytes(t.buttonInk)}`;
      expect(ratio(t.buttonInk, painted(t.button))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t.button, t.bg)).toBeGreaterThanOrEqual(3);
    }
    // Was #e43a0a with a black label (the org's rule after the large grade).
    expect(outcome).toEqual({
      light: '#dd3809 #ffffff',
      dark: '#dd3809 #ffffff',
    });
  });
});

// ── 12. the second colour's tone (owner, D11) ───────────────────────────────
// An org that set no second colour used to get its primary turned 45° (of-
// blood-and-bones' rust became an ochre, #765821). It gets a TONE now: the
// primary's hue, its lightness moved 0.2 toward the ground, or the other way
// where there is no room, its chroma capped for the gamut there.
const TONE = { step: 0.2, lightRoom: 0.78, darkRoom: 0.25 } as const;

function toneL(pole: Mode, l: number): number {
  return pole === 'light'
    ? l + TONE.step - 2 * TONE.step * clampTo(0, (l - TONE.lightRoom) * 1e6, 1)
    : l - TONE.step + 2 * TONE.step * clampTo(0, (TONE.darkRoom - l) * 1e6, 1);
}

/** `--_second-tone` on a pole: Chrome clips what the cap leaves out of gamut
 * (calibrated live: #a62b0c → #d67d68, #2563eb → #293958 on the dark pole). */
function secondTone(pole: Mode, brand: Rgb): Rgb {
  return clip(
    oklchFrom(
      brand,
      (l) => toneL(pole, l),
      (l, c) => {
        const t = toneL(pole, l);
        return Math.min(c, 0.17 * t, 0.46 * (1 - t));
      }
    )
  );
}

describe('the second colour’s tone — the org’s own hue, apart from it (owner, D11)', () => {
  const dE = (a: Rgb, b: Rgb) => {
    const [x, y] = [toLab(a), toLab(b)];
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  };
  const chroma = (rgb: Rgb) => {
    const [, a, b] = toLab(rgb);
    return Math.hypot(a, b);
  };
  const hueGap = (a: Rgb, b: Rgb) => {
    const [, a1, b1] = toLab(a);
    const [, a2, b2] = toLab(b);
    const d = Math.abs(Math.atan2(b1, a1) - Math.atan2(b2, a2));
    return (Math.min(d, 2 * Math.PI - d) * 180) / Math.PI;
  };
  const bytes = (rgb: Rgb) =>
    `#${clip(rgb)
      .map((v) =>
        Math.round(v * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')}`;
  /** Every primary with a hue to give (a grey has none: X19 skips it). */
  const PRIMARIES: Rgb[] = [];
  for (let r = 0; r < 256; r += 17)
    for (let g = 0; g < 256; g += 17)
      for (let b = 0; b < 256; b += 17) {
        const c: Rgb = [r / 255, g / 255, b / 255];
        if (chroma(c) >= 0.03) PRIMARIES.push(c);
      }

  it('is written per pole, toward its ground', () => {
    expect(POLE.light).toContain(
      `--_tone-l: (l + ${TONE.step} - ${2 * TONE.step} * clamp(0, (l - ${TONE.lightRoom}) * 1e6, 1));`
    );
    expect(POLE.dark).toContain(
      `--_tone-l: (l - ${TONE.step} + ${2 * TONE.step} * clamp(0, (${TONE.darkRoom} - l) * 1e6, 1));`
    );
  });

  it(
    'keeps the hue, and stays apart from the primary: by 0.19 as fills side by side, by 0.08 as drawn on the org’s surfaces',
    { timeout: 60_000 },
    () => {
      const lowest: Record<string, number> = {};
      const low = (key: string, value: number) => {
        lowest[key] = Math.min(lowest[key] ?? Number.POSITIVE_INFINITY, value);
      };
      for (const pole of ['light', 'dark'] as const)
        for (const brand of PRIMARIES) {
          const tone = secondTone(pole, brand);
          // Fills that touch: Poster's primary and accent fields, the block
          // under a photo on its field, an accent band beside a brand band.
          low(`${pole} fills`, dE(tone, brand));
          if (chroma(tone) > 0.02)
            low(`${pole} hue kept`, -hueGap(tone, brand));
          // Path's route beside the words' accent, each moved by its grade.
          for (const decorated of [false, true])
            low(
              `${pole} drawn${decorated ? ' decorated' : ''}`,
              dE(
                orgMove(pole, tone, 'large', decorated),
                orgMove(pole, brand, 'text', decorated)
              )
            );
        }
      for (const pole of ['light', 'dark'] as const) {
        expect(lowest[`${pole} fills`], pole).toBeGreaterThanOrEqual(0.19);
        expect(-lowest[`${pole} hue kept`], pole).toBeLessThan(2);
        expect(lowest[`${pole} drawn`], pole).toBeGreaterThanOrEqual(0.08);
        expect(lowest[`${pole} drawn decorated`], pole).toBeGreaterThanOrEqual(
          0.08
        );
      }
    }
  );

  it('has teeth: a tone moved AWAY from the ground merges with the primary once drawn', () => {
    let lowest = Number.POSITIVE_INFINITY;
    for (const brand of PRIMARIES) {
      const away = clip(
        oklchFrom(
          brand,
          (l) => toneL('dark', l),
          (l, c) => {
            const t = toneL('dark', l);
            return Math.min(c, 0.17 * t, 0.46 * (1 - t));
          }
        )
      );
      lowest = Math.min(
        lowest,
        dE(
          orgMove('light', away, 'large', false),
          orgMove('light', brand, 'text', false)
        )
      );
    }
    expect(lowest).toBeLessThan(0.02);
  });

  it('draws the seeded orgs’ tones, and an org’s own second colour is untouched', () => {
    // of-blood-and-bones' rust, on the light pole in both themes (its
    // background has no dark one); studio-beta's blue on each pole.
    expect({
      'of-blood-and-bones': bytes(secondTone('light', hex('#A62B0C'))),
      'studio-beta light': bytes(secondTone('light', hex('#2563EB'))),
      'studio-beta dark': bytes(secondTone('dark', hex('#2563EB'))),
    }).toEqual({
      'of-blood-and-bones': '#d67d68',
      'studio-beta light': '#85acf7',
      'studio-beta dark': '#293958',
    });
    // The tone is only the last fallback: a chromatic secondary or accent
    // is the pick (the X19 switch above).
    expect(CODE).toContain(
      '--_second-in: var(--brand-secondary, var(--_accent-in));'
    );
  });
});

// ── 13. the hero's main button over a photo (owner, D10) ────────────────────
// It used to be the on-media ink (#efefef on Tending the Grief). The owner
// chose the org's own button there, exactly as the page's own sections draw
// it and with nothing added: WCAG 1.4.11 asks a control with visible text for
// no contrasting edge, only a legible label and a focus ring that holds where
// it sits (https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
// #boundaries). So the fill and label are not proven against the photo; they
// are the org's, proven on its surfaces (§10, §11).
describe('the hero’s main button over a photo is the org’s own button (owner, D10)', () => {
  it('shares the org’s surfaces’ one definition: a fill or label edited for one is edited for both', () => {
    // One rule, both selectors, exactly the two declarations…
    expect(ORG_BUTTON_RULE().trim()).toBe(
      squash(
        '--lp-button-bg: rgb( from rgb(from var(--_org-button) var(--_ol-r) var(--_ol-g) var(--_ol-b)) var(--_wl-r) var(--_wl-g) var(--_wl-b) ); --lp-button-ink: rgb(from var(--lp-button-bg) calc(255 * var(--_wk)) calc(255 * var(--_wk)) calc(255 * var(--_wk)));'
      )
    );
    // …the hero's selector named nowhere else, so no second copy can drift…
    expect(CODE.split(HERO_OVER_PHOTO).length - 1).toBe(1);
    // …and the org's button fill written once in the whole stylesheet.
    expect(
      CODE.match(/--lp-button-bg: rgb\( from rgb\(from var\(--_org-button\)/g)
    ).toHaveLength(1);
    // No floor of its own against the scrim any more.
    expect(CODE).not.toContain('--_omb-');
  });

  it('keeps its focus ring the on-media ink, which holds 3:1 on the lightest surface any brand’s scrim allows', () => {
    // The shared rule sets no ring, so the button takes the hero copy's.
    expect(ORG_BUTTON_RULE()).not.toContain('--lp-focus');
    let lowest = Number.POSITIVE_INFINITY;
    const brands: Rgb[] = Object.values(BRANDS).map(hex);
    for (let r = 0; r < 256; r += 51)
      for (let g = 0; g < 256; g += 51)
        for (let b = 0; b < 256; b += 51)
          brands.push([r / 255, g / 255, b / 255]);
    for (const brand of brands) {
      const scrim = oklchFrom(
        brand,
        () => 0.16,
        (_, c) => Math.min(c * 0.25, 0.027)
      );
      // 72% of the scrim over a pure white photo: its lightest surface.
      const lightest = triple((i) => scrim[i] * 0.72 + (1 - 0.72));
      lowest = Math.min(lowest, ratio(ink(scrim, INK.ink), lightest));
    }
    expect(lowest).toBeGreaterThanOrEqual(3);
  });
});

// ── 14. the floating bar is a raised card (owner, D9) ───────────────────────
describe('the floating bar is a raised card in the org’s card colour (owner, D9)', () => {
  const KIT = join(LIB, 'page-builder', 'kit');
  const read = (path: string) =>
    squash(
      readFileSync(join(KIT, path), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
    );
  const STICKY = read('StickyCta.svelte');
  const KIT_CSS = read('styles/kit.css');
  const QUIET = read('styles/style-quiet.css');

  it('draws the bar on the org’s surfaces in its scheme’s card colour, on the org’s floating shadow', () => {
    expect(STICKY).toContain(
      ".lp-sticky[data-lp-scheme='base'] { background: var(--lp-panel); }"
    );
    expect(STICKY).toMatch(
      /\.lp-sticky \{[^}]*box-shadow: var\(--lp-shadow-raised\);/
    );
    expect(KIT_CSS).toContain('--lp-shadow-raised: var(--shadow-xl);');
    // Quiet keeps its rim, over the same shadow.
    expect(QUIET).toMatch(
      /\.lp-sticky\[data-lp-scheme\] \{ box-shadow: 0 0 0 var\(--border-width\) var\(--lp-line\), var\(--lp-shadow-raised\); \}/
    );
    // On base, the card colour is the org's card.
    expect(CODE).toContain(
      ".lp [data-lp-scheme='base'] { --lp-bg: var(--lp-ground); --lp-panel: var(--_base-panel);"
    );
    expect(POLE.light).toContain('--_base-panel: var(--_org-panel);');
  });

  it('holds the org’s card in the ground’s own band in each pole, so the floors proven on that band are the bar’s', () => {
    for (const pole of ['light', 'dark'] as const) {
      const band = (name: string, from: string) =>
        POLE[pole].match(
          new RegExp(`${name}: oklch\\( from var\\(${from}\\) ([^;]*);`)
        )?.[1];
      const ground = band('--lp-ground', '--_ground-in');
      expect(ground, pole).toBeTruthy();
      expect(band('--_org-panel', '--_org-card'), pole).toBe(ground);
    }
  });

  it(
    'holds the bar’s words and button on its card for any brand and org ground, in both poles',
    { timeout: 60_000 },
    () => {
      const brands: Rgb[] = Object.values(BRANDS).map(hex);
      for (let r = 0; r < 256; r += 51)
        for (let g = 0; g < 256; g += 51)
          for (let b = 0; b < 256; b += 51)
            brands.push([r / 255, g / 255, b / 255]);
      const grounds = [null, '#F3F0E7', '#FFFFFF', '#E9F1EA', '#F7D9B9'];
      const lowest = { ink: 9, soft: 9, button: 9, label: 9 };
      let cases = 0;
      for (const brand of brands)
        for (const bg of grounds)
          for (const theme of ['light', 'dark'] as const) {
            const org = bg
              ? orgFromBg(theme, hex(bg), brand, brand)
              : platformOrg(theme, undefined, brand, brand);
            const pole: Mode = bg ? 'light' : theme;
            const t = schemeTokens(
              pole,
              'base',
              orgGround(pole, org),
              brand,
              DEFAULT_TINT,
              brand,
              { org, decorated: false }
            );
            lowest.ink = Math.min(lowest.ink, ratio(t.ink, t.panel));
            lowest.soft = Math.min(lowest.soft, ratio(t.soft, t.panel));
            lowest.button = Math.min(lowest.button, ratio(t.button, t.panel));
            lowest.label = Math.min(lowest.label, ratio(t.buttonInk, t.button));
            cases++;
          }
      expect(cases).toBe(brands.length * grounds.length * 2);
      expect(lowest.ink).toBeGreaterThanOrEqual(FLOORS.ink);
      expect(lowest.soft).toBeGreaterThanOrEqual(FLOORS.soft);
      expect(lowest.button).toBeGreaterThanOrEqual(FLOORS.button);
      expect(lowest.label).toBeGreaterThanOrEqual(FLOORS.buttonInk);
    }
  );

  it('names the seeded orgs whose card is their ground, where the shadow alone carries the bar', () => {
    const byte = (rgb: Rgb) => clip(rgb).map((c) => Math.round(c * 255));
    const same: string[] = [];
    const lift: Record<string, string> = {};
    for (const [name, seed] of Object.entries(SEEDED))
      for (const theme of ['light', 'dark'] as const) {
        const brand = hex(seed.brand);
        const org = seed.bg
          ? orgFromBg(theme, hex(seed.bg), brand, brand)
          : platformOrg(theme, undefined, brand, brand);
        const pole: Mode = seed.bg ? 'light' : theme;
        const t = schemeTokens(
          pole,
          'base',
          orgGround(pole, org),
          brand,
          DEFAULT_TINT,
          brand,
          { org, decorated: false }
        );
        const [a, b] = [byte(t.panel), byte(t.bg)];
        if (a.every((v, i) => Math.abs(v - (b[i] ?? -9)) <= 1))
          same.push(`${name} ${theme}`);
        lift[`${name} ${theme}`] = ratio(t.panel, t.bg).toFixed(2);
      }
    // Every seeded org's card stands off its ground in both themes.
    expect(same, JSON.stringify(lift)).toEqual([]);
  });
});

// ── 15. the soft band keeps the ground's warmth (owner, D14) ────────────────
/*
 * The soft band was the org's secondary surface, which `org-brand.css` makes
 * for small controls at half the ground's chroma: on parchment, a full-width
 * band of it read grey. The owner chose "Warm step of the parchment
 * (Recommended)": on an org's background the band is that ground a step
 * toward its ink, by the step `org-brand.css` takes for its secondary
 * surface, with the ground's chroma kept. The step follows the POLE, not the
 * theme: an org whose ground stays light in dark mode steps darker there
 * too. On the platform's neutral ground there is no chroma to keep, and the
 * band stays the platform's own secondary surface.
 */
describe('the soft band keeps the ground’s warmth (owner, D14)', () => {
  const lch = (rgb: Rgb) => {
    const [l, a, b] = toLab(rgb);
    return { l, c: Math.hypot(a, b) };
  };
  const D14 = `:is([data-org-bg] .lp, .lp[data-org-bg]) { --_org-soft: ${SOFT_STEP_EXPR}; }`;
  /** The D7 hand-back to an org with no background (§10's selectors). */
  const PLATFORM_HAND_BACK =
    ":is(.dark, [data-theme='dark']) .lp[data-page-bg='light']:not([data-lp-theme='light'], [data-editing-theme='light'] .lp, [data-org-bg] .lp), " +
    ":root:not(.dark, [data-theme='dark']) .lp[data-page-bg='dark']:not([data-lp-theme='dark'], [data-editing-theme='dark'] .lp, [data-org-bg] .lp) { --_org-soft: var(--color-surface-secondary); }";

  it('spells it in schemes.css: the step by pole, the org’s ground with its chroma, and the platform’s own where a page hands back', () => {
    expect(POLE.light).toContain(`--_soft-step: ${ORG_BG.light.soft};`);
    expect(POLE.dark).toContain(`--_soft-step: ${ORG_BG.dark.soft};`);
    expect(CODE.split(D14).length - 1).toBe(1);
    expect(CODE.split(PLATFORM_HAND_BACK).length - 1).toBe(1);
    // The org's secondary surface is still the root's, for the platform.
    expect(POLE.light).toContain(
      '--_org-soft: var(--color-surface-secondary);'
    );
  });

  // Grounds on each pole: the matrix's, the seeded, the bar's, and the cube.
  const groundsOn = (mode: Mode): Rgb[] => {
    const out: Rgb[] = [
      ...Object.entries(GROUNDS[mode])
        .filter(([name]) => name !== 'platform')
        .map(([, value]) => hex(value)),
      ...['#F3F0E7', '#FFFFFF', '#E9F1EA', '#F7D9B9', '#10202a'].map(hex),
    ];
    for (let r = 0; r < 256; r += 51)
      for (let g = 0; g < 256; g += 51)
        for (let b = 0; b < 256; b += 51) out.push([r / 255, g / 255, b / 255]);
    return out;
  };

  it(
    'is the org’s ground, as its band draws it, a step toward its ink with its chroma, in both poles, for any org ground, and inside the band',
    { timeout: 60_000 },
    () => {
      const brand = hex('#A62B0C');
      let cases = 0;
      let unmoved = 0;
      const outside: string[] = [];
      for (const mode of ['light', 'dark'] as const) {
        const worst = lum(worstSurface(mode, false));
        for (const bg of groundsOn(mode))
          for (const theme of ['light', 'dark'] as const) {
            const org = orgFromBg(theme, bg, brand, brand);
            const soft = kitSoft(mode, org);
            const from = lch(ground(mode, org.ground));
            const to = lch(soft);
            // Toward the ink, or away where that would leave the band (§16).
            const s = ORG_BG[mode].soft;
            const edge = FIRST[mode].edge;
            const leaves =
              mode === 'light' ? from.l + s < edge : from.l + s > edge;
            const step = clampTo(0, from.l + (leaves ? -s : s), 1);
            expect(to.l, `${mode} ${bg}`).toBeCloseTo(step, 6);
            expect(to.c, `${mode} ${bg}: the ground's chroma`).toBeCloseTo(
              from.c,
              6
            );
            // Drawn, at every tint a Style ships, it is a surface of the
            // band, so every ink and button proven on the band holds on it.
            for (const tint of Object.values(STYLE_TINTS)) {
              const band = schemeTokens(
                mode,
                'soft',
                ground(mode, org.ground),
                brand,
                tint,
                brand,
                { org, decorated: false }
              ).bg;
              if (towardInk(mode, lum(band), worst))
                outside.push(`${mode} ${bg} ${JSON.stringify(tint)}`);
              cases++;
            }
            // Where the org's ground is in the band, the kit's own band
            // draws the step exactly: the ground's chroma, within 0.002.
            const inBand =
              mode === 'light'
                ? lch(org.ground).l >= edge
                : lch(org.ground).l <= edge;
            if (inBand) {
              const drawn = lch(
                schemeTokens(
                  mode,
                  'soft',
                  ground(mode, org.ground),
                  brand,
                  DEFAULT_TINT,
                  brand,
                  { org, decorated: false }
                ).bg
              );
              expect(Math.abs(drawn.c - from.c), `${mode} ${bg}`).toBeLessThan(
                0.002
              );
              unmoved++;
            }
          }
      }
      expect(outside).toEqual([]);
      expect(cases).toBeGreaterThan(1500);
      expect(unmoved).toBeGreaterThan(20);
    }
  );

  it('keeps the platform’s own secondary surface on its neutral ground, in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const org = platformOrg(theme);
      expect(kitSoft(theme, org)).toEqual(org.soft);
    }
  });

  it('draws the same soft band for an org that keeps its light ground, in either theme (its pole’s step)', () => {
    const bg = hex(SEEDED['of-blood-and-bones'].bg);
    const brand = hex(SEEDED['of-blood-and-bones'].brand);
    const [light, dark] = (['light', 'dark'] as const).map((theme) =>
      kitSoft('light', orgFromBg(theme, bg, brand, brand))
    );
    expect(dark).toEqual(light);
    // The org's own secondary surface is not: a step LIGHTER in dark mode.
    expect(lch(orgFromBg('dark', bg, brand, brand).soft).l).toBeGreaterThan(
      lch(bg).l
    );
    expect(lch(light).l).toBeLessThan(lch(bg).l);
  });
});

// ── 16. the org's real ground (Codex-61zsk.42, 03 X48) ──────────────────────
/*
 * The kit drew every org ground in one band per pole (L >= 0.9, L <= 0.24),
 * by the viewer's theme: a dark org ground was lifted to pale mint, and a
 * sand at L 0.887 drawn at 0.9, its soft band equal to the ground. The owner
 * chose "Fix it next (Recommended)" under D1, "Follow the org (Recommended)".
 * The POLE is now the ground's own (white and black ink cross at its
 * luminance), and the ground is drawn in the narrowest band of its pole that
 * holds it, so it moves only past the pole's last band. Every band's grades
 * are proven here on the worst surface it can hold.
 */

/** The owner's review brands ("Sample brands for reviews (Recommended)",
 * D15), as `docs/handover/phase3-sources/review-brands/brands.json` sets
 * them (outside the repo, so its colours are copied here), and the seeded
 * orgs. `bg` is the background, `dark` its dark twin; none is the platform. */
const GROUND_ORGS = {
  'review seed (of-blood-and-bones)': {
    brand: '#A62B0C',
    bg: '#F3F0E7',
    dark: null,
  },
  'review night': { brand: '#C9A54C', bg: '#15211C', dark: null },
  'review sand': { brand: '#1F3A5F', bg: '#E9D8B4', dark: null },
  'review lilac': { brand: '#8B5CF6', bg: '#F3EEFD', dark: '#17112A' },
  'review red': { brand: '#E0402A', bg: null, dark: null },
  'review plain': { brand: '#0F766E', bg: null, dark: null },
  'seed studio-alpha': { brand: '#E11D48', bg: null, dark: null },
  'seed studio-beta': { brand: '#2563EB', bg: null, dark: null },
} as const;

/** The least the soft band stands apart from the ground, in OKLCH
 * lightness: the org's step on a background (the dark pole's is 0.04), and
 * the platform's own secondary surface on its neutral ground (0.0150 on
 * #fafafa). The e2e (`brand-fidelity.spec.ts`) checks the same numbers on
 * the painted page. */
const SOFT_MIN = { background: 0.03, platform: 0.014 } as const;

const toHex = (rgb: Rgb) =>
  `#${clip(rgb)
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
const lightnessOf = (rgb: Rgb) => toLab(rgb)[0];
const poleOf = (id: GroundBandId): Mode => BAND[id].pole;
const gradeOf = (band: Band, g: (typeof GRADES)[number]) =>
  g.decorated
    ? g.grade === 'text'
      ? band.odt
      : band.odl
    : g.grade === 'text'
      ? band.ot
      : band.ol;
/** Contrast against a surface known by its luminance alone. */
const ratioY = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

describe('the org’s real ground — its pole, its band, and a soft band that stands apart (Codex-61zsk.42)', () => {
  const cube: Rgb[] = [];
  for (let r = 0; r < 256; r += 15)
    for (let g = 0; g < 256; g += 15)
      for (let b = 0; b < 256; b += 15) cube.push([r / 255, g / 255, b / 255]);

  it('puts the pole where black and white ink cross, by the ground’s luminance', () => {
    // White on Y and black on Y are equal at sqrt(1.05 * 0.05) - 0.05.
    expect(INK_CROSSOVER).toBeCloseTo(Math.sqrt(1.05 * 0.05) - 0.05, 4);
    // The kit's inks switch at the same point.
    expect(CODE).toContain(
      `--_w: clamp(0, (${INK_CROSSOVER} - var(--_y)) * 1e6, 1);`
    );
    let light = 0;
    let dark = 0;
    for (const g of cube) {
      const id = groundBand(toHex(g));
      expect(id).toBeDefined();
      const pole = poleOf(id as GroundBandId);
      // A mid-tone ground is either pole: the ink that holds more contrast
      // on it decides, black on the light pole and white on the dark.
      const black = ratio([0, 0, 0], g);
      const white = ratio([1, 1, 1], g);
      expect(pole, toHex(g)).toBe(lum(g) > INK_CROSSOVER ? 'light' : 'dark');
      if (pole === 'light') {
        expect(black, toHex(g)).toBeGreaterThanOrEqual(white);
        light++;
      } else {
        expect(white, toHex(g)).toBeGreaterThanOrEqual(black);
        dark++;
      }
    }
    expect(light).toBeGreaterThan(1000);
    expect(dark).toBeGreaterThan(1000);
    // A 3-digit hex is read; anything else names no band.
    expect(groundBand('#15211c')).toBe(groundBand('#15211C'));
    expect(groundBand('#fff')).toBe('l90');
    for (const bad of [null, undefined, '', 'red', '#12345', 'rgb(0 0 0)'])
      expect(groundBand(bad)).toBeUndefined();
  });

  it('draws a ground in the narrowest band of its pole that holds it, and moves it only past the last', () => {
    let held = 0;
    let moved = 0;
    for (const g of cube) {
      const band = BAND[groundBand(toHex(g)) as GroundBandId];
      const L = lightnessOf(g);
      const ownPole = GROUND_BANDS.filter((b) => b.pole === band.pole);
      const inBand = band.pole === 'light' ? L >= band.edge : L <= band.edge;
      const drawn = ground(band.pole, g, band.edge);
      if (inBand) {
        // No narrower band of the pole holds it…
        const narrower = ownPole.slice(
          0,
          ownPole.findIndex((b) => b.id === band.id)
        );
        for (const b of narrower)
          expect(
            band.pole === 'light' ? L < b.edge : L > b.edge,
            `${toHex(g)} ${b.id}`
          ).toBe(true);
        // …and it is drawn as itself.
        for (const i of [0, 1, 2] as const)
          expect(Math.abs(drawn[i] - g[i]), toHex(g)).toBeLessThan(0.5 / 255);
        held++;
      } else {
        // Past the last band: it moves to that band's edge.
        expect(band.id, toHex(g)).toBe(ownPole[ownPole.length - 1].id);
        expect(lightnessOf(drawn)).toBeCloseTo(band.edge, 6);
        moved++;
      }
    }
    // Of the 5,832 sampled, 3,991 are drawn as themselves; the rest are the
    // saturated mid-tones between the poles' last bands (L 0.48 to 0.65).
    expect(held).toBeGreaterThan(3900);
    expect(moved).toBeGreaterThan(1000);
  });

  it(
    'holds every floor on the worst surface of every band, for ANY org colour, and moves 2% past it, rounded toward the ink',
    { timeout: 120_000 },
    () => {
      const worsts = bandWorsts();
      // The first bands' worst surfaces are the ones §10 proves on.
      for (const pole of ['light', 'dark'] as const)
        for (const decorated of [false, true])
          expect(
            worsts[`${pole}/${FIRST[pole].edge}`][
              decorated ? 'decorated' : 'plain'
            ]
          ).toBeCloseTo(lum(worstSurface(pole, decorated)), 12);
      const sources: Rgb[] = Object.values(BRANDS).map(hex);
      for (let r = 0; r < 256; r += 51)
        for (let g = 0; g < 256; g += 51)
          for (let b = 0; b < 256; b += 51)
            sources.push([r / 255, g / 255, b / 255]);
      let checked = 0;
      for (const band of Object.values(BAND))
        for (const grade of GRADES) {
          const label = `${band.id} ${grade.name}`;
          const w =
            worsts[`${band.pole}/${band.edge}`][
              grade.decorated ? 'decorated' : 'plain'
            ];
          const t = gradeOf(band, grade);
          expect(ratioY(t, w) / grade.floor, label).toBeGreaterThanOrEqual(
            1.02 - 1e-9
          );
          // The grade 2% past what the worst surface needs, rounded toward
          // the ink — and by less than 0.001.
          const exact =
            band.pole === 'light'
              ? (w + 0.05) / (grade.floor * 1.02) - 0.05
              : (w + 0.05) * grade.floor * 1.02 - 0.05;
          const past = band.pole === 'light' ? exact - t : t - exact;
          expect(past, label).toBeGreaterThanOrEqual(0);
          expect(past, label).toBeLessThan(0.001);
          for (const s of sources)
            expect(
              ratioY(
                lum(orgMove(band.pole, s, grade.grade, grade.decorated, band)),
                w
              ),
              `${label} ${toHex(s)}`
            ).toBeGreaterThanOrEqual(grade.floor);
          checked++;
        }
      expect(checked).toBe(GROUND_BANDS.length * GRADES.length);
      // A wider band holds a darker (lighter) worst surface: its inks move
      // further, never less far.
      for (const pole of ['light', 'dark'] as const) {
        const bands = Object.values(BAND).filter((b) => b.pole === pole);
        for (let i = 1; i < bands.length; i++)
          for (const key of ['ot', 'ol', 'odt', 'odl'] as const)
            expect(
              towardInk(pole, bands[i][key], bands[i - 1][key]),
              `${bands[i].id} ${key}`
            ).toBe(true);
      }
    }
  );

  it(
    'reaches no further: past the last band of each pole, no ink holds decorated text',
    { timeout: 120_000 },
    () => {
      const worsts = bandWorsts();
      const at = (pole: Mode, edge: number) =>
        worsts[`${pole}/${edge}`].decorated;
      // The last bands hold it with pure black / pure white ink…
      expect(ratioY(0, at('light', BAND.l65.edge))).toBeGreaterThanOrEqual(
        4.5 * 1.02
      );
      expect(ratioY(1, at('dark', BAND.d48.edge))).toBeGreaterThanOrEqual(
        4.5 * 1.02
      );
      // …and one step past them, not even those can.
      expect(ratioY(0, at('light', PAST.light))).toBeLessThan(4.5 * 1.02);
      expect(ratioY(1, at('dark', PAST.dark))).toBeLessThan(4.5 * 1.02);
    }
  );

  it('keeps white (D8) only on a band whose large grade white can hold', () => {
    for (const band of Object.values(BAND))
      expect(band.kw, band.id).toBe(
        band.pole === 'light' || band.ol <= TARGET.orgWhiteLabel ? 1 : 0
      );
    // Where it is off, the large grade lifts the button past white's 4.5:1,
    // so its label is black, and holds.
    for (const band of Object.values(BAND).filter((b) => !b.kw)) {
      expect(ratioY(1, band.ol), band.id).toBeLessThan(4.5);
      expect(ratioY(0, band.ol), band.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('names every band in schemes.css, for each theme’s ground, and falls back to the first bands', () => {
    for (const [theme, key] of [
      ['light', 'gl'],
      ['dark', 'gd'],
    ] as const) {
      for (const band of Object.values(BAND))
        expect(CODE, `${theme} ${band.id}`).toContain(
          `.lp[data-ground-${theme}='${band.id}'] { --_${key}-edge: ${band.edge}; --_${key}-ot: ${band.ot}; --_${key}-ol: ${band.ol}; --_${key}-odt: ${band.odt}; --_${key}-odl: ${band.odl}; --_${key}-kw: ${band.kw}; --_${key}-veil: ${BAND_VEIL[band.id]}; }`
        );
      expect(
        CODE.match(
          new RegExp(`\\.lp\\[data-ground-${theme}='[a-z0-9]+'\\] \\{`, 'g')
        )
      ).toHaveLength(GROUND_BANDS.length);
      const first = FIRST[theme];
      const fallback = `--_band-edge: var(--_${key}-edge, ${first.edge}); --_g-ot: var(--_${key}-ot, ${first.ot}); --_g-ol: var(--_${key}-ol, ${first.ol}); --_g-odt: var(--_${key}-odt, ${first.odt}); --_g-odl: var(--_${key}-odl, ${first.odl}); --_band-kw: var(--_${key}-kw, ${first.kw});`;
      expect(CODE, theme).toContain(fallback);
    }
    // Cinematic's room is the first dark band in every theme.
    const d24 = BAND.d24;
    expect(CODE).toContain(
      `--_band-edge: ${d24.edge}; --_g-ot: ${d24.ot}; --_g-ol: ${d24.ol}; --_g-odt: ${d24.odt}; --_g-odl: ${d24.odl}; --_band-kw: ${d24.kw};`
    );
  });

  it('steps the soft band the other way where its step would leave the band, so it always stands apart', () => {
    const brand = hex('#A62B0C');
    const flipped: Record<Mode, number> = { light: 0, dark: 0 };
    let cases = 0;
    for (const g of cube)
      for (const theme of ['light', 'dark'] as const) {
        const band = BAND[groundBand(toHex(g)) as GroundBandId];
        const pole = band.pole;
        const org = orgFromBg(theme, g, brand, brand);
        const drawn = ground(pole, org.ground, band.edge);
        const soft = kitSoft(pole, org, band.edge);
        const [l0, l1] = [lightnessOf(drawn), lightnessOf(soft)];
        const step = ORG_BG[pole].soft;
        // Exactly the pole's step, one way or the other…
        expect(Math.abs(l1 - l0), toHex(g)).toBeCloseTo(Math.abs(step), 6);
        // …inside the band…
        expect(
          pole === 'light' ? l1 >= band.edge - 1e-9 : l1 <= band.edge + 1e-9,
          `${toHex(g)} ${band.id}`
        ).toBe(true);
        // …turned only where the step toward the ink would leave it.
        if (Math.sign(l1 - l0) !== Math.sign(step)) flipped[pole]++;
        cases++;
      }
    expect(cases).toBe(cube.length * 2);
    expect(flipped.light).toBeGreaterThan(50);
    expect(flipped.dark).toBeGreaterThan(50);
    expect(Math.abs(ORG_BG.light.soft)).toBeGreaterThanOrEqual(
      SOFT_MIN.background
    );
    expect(Math.abs(ORG_BG.dark.soft)).toBeGreaterThanOrEqual(
      SOFT_MIN.background
    );
    // The CSS turns it at the same point: `--_band-side` is the pole's
    // direction into its band.
    expect(POLE.light).toContain('--_soft-step: -0.03; --_band-side: 1;');
    expect(POLE.dark).toContain('--_soft-step: 0.04; --_band-side: -1;');
    expect(CODE.split(`--_org-soft: ${SOFT_STEP_EXPR};`).length - 1).toBe(5);
  });

  it(
    'draws every review brand and seed on its own ground, in both themes: the pole follows it, every floor holds, and the soft band stands apart',
    { timeout: 60_000 },
    () => {
      const report: string[] = [];
      for (const [name, o] of Object.entries(GROUND_ORGS)) {
        const brand = hex(o.brand);
        const bands = resolveGroundBands({ light: o.bg, dark: o.dark });
        for (const theme of ['light', 'dark'] as const) {
          const own = theme === 'light' ? o.bg : (o.dark ?? o.bg);
          const org = own
            ? orgFromBg(theme, hex(own), brand, brand)
            : platformOrg(theme, brand, brand, brand);
          const id = bands[theme];
          // A platform ground names no band: its theme's first.
          const band = id ? BAND[id] : FIRST[theme];
          const pole = band.pole;
          const label = `${name} ${theme} ${band.id}`;
          expect(id === undefined, label).toBe(!own);
          // The pole follows the ground, and the ground is the org's own.
          expect(pole, label).toBe(
            lum(org.ground) > INK_CROSSOVER ? 'light' : 'dark'
          );
          const g = ground(pole, org.ground, band.edge);
          for (const i of [0, 1, 2] as const)
            expect(Math.abs(g[i] - org.ground[i]), label).toBeLessThan(
              0.5 / 255
            );
          for (const decorated of [false, true]) {
            const page: Page = { org, decorated, band };
            for (const [tintName, tint] of Object.entries(STYLE_TINTS))
              for (const scheme of SCHEMES) {
                const t = schemeTokens(
                  pole,
                  scheme,
                  g,
                  brand,
                  tint,
                  brand,
                  page
                );
                for (const [token, value] of Object.entries(ratios(t)))
                  if (value < FLOORS[token as keyof typeof FLOORS])
                    report.push(
                      `${label} ${decorated ? 'decorated ' : ''}${tintName} ${scheme} ${token} ${value.toFixed(2)}`
                    );
              }
            // The soft band, as the default Style draws it.
            const soft = schemeTokens(
              pole,
              'soft',
              g,
              brand,
              DEFAULT_TINT,
              brand,
              page
            ).bg;
            const apart = Math.abs(lightnessOf(soft) - lightnessOf(g));
            expect(apart, `${label} soft`).toBeGreaterThanOrEqual(
              (org.background ? SOFT_MIN.background : SOFT_MIN.platform) - 1e-6
            );
          }
        }
      }
      expect(report).toEqual([]);
      // The review brands that motivated this: night on the dark pole in
      // both themes, sand on the light pole's second band.
      const night = resolveGroundBands({ light: '#15211C' });
      expect(night).toEqual({ light: 'd24', dark: 'd24' });
      expect(resolveGroundBands({ light: '#E9D8B4' })).toEqual({
        light: 'l85',
        dark: 'l85',
      });
      expect(resolveGroundBands({ light: '#F3EEFD', dark: '#17112A' })).toEqual(
        { light: 'l90', dark: 'd24' }
      );
    }
  );
});

// ── 17. the org's borders step away from its ground (owner, D12) ────────────
/*
 * `org-brand.css` stepped its borders by THEME: darker in light mode, lighter
 * in dark. of-blood-and-bones' parchment stays light in dark mode, so every
 * border level clamped to #fffffc (1.1:1); night's forest ground in light
 * mode drew them darker still, toward black. The owner chose "Fix it on the
 * org's site (Recommended)" (D12, Codex-j4ioe): each border steps away from
 * the ground on the side its luminance puts it, at the kit's crossover.
 *
 * Relative colour gives the ground's OKLCH l, c, h, not its luminance, so the
 * stylesheet rebuilds it: a = c·cos h, b = c·sin h; OKLab's LMS' rows of
 * (l, a, b), each cubed, are linear LMS; and the luminance is one row of
 * LMS → linear sRGB → Y. That is exact, not a lightness proxy: Y 0.1791 has
 * no single OKLab L (a grey crosses at L 0.5637, a saturated blue lower).
 */
describe('the org’s borders step away from its ground, on either side (owner, D12)', () => {
  /** OKLab → linear LMS' rows, and Y's row of LMS → linear sRGB → Y. */
  const LMS = {
    l: [0.3963377774, 0.2158037573],
    m: [-0.1055613458, -0.0638541728],
    s: [-0.0894841775, -1.291485548],
  } as const;
  const Y_ROW = { l: -0.040774541, m: 1.112492185, s: -0.071717644 } as const;
  const term = (k: number) =>
    `${k < 0 ? '-' : '+'} ${Math.abs(k)} * var(--_bg-b)`;
  const row = (name: 'l' | 'm' | 's') => {
    const [ka, kb] = LMS[name];
    return `--_bg-${name}: (l ${ka < 0 ? '-' : '+'} ${Math.abs(ka)} * var(--_bg-a) ${term(kb)});`;
  };
  const cube = (name: 'l' | 'm' | 's') =>
    `var(--_bg-${name}) * var(--_bg-${name}) * var(--_bg-${name})`;
  const HELPERS = [
    '--_bg-a: (c * cos(h * 1deg));',
    '--_bg-b: (c * sin(h * 1deg));',
    row('l'),
    row('m'),
    row('s'),
    `--_bg-y: (${Y_ROW.l} * ${cube('l')} + ${Y_ROW.m} * ${cube('m')} - ${Math.abs(Y_ROW.s)} * ${cube('s')});`,
    `--_bg-away: (1 - 2 * clamp(0, (var(--_bg-y) - ${INK_CROSSOVER}) * 1e6, 1));`,
  ].join(' ');

  /** The helpers as the browser evaluates them, from the ground's l, c, h. */
  const cssAway = (g: Rgb) => {
    const [l, A, B] = toLab(g);
    const c = Math.hypot(A, B);
    const h = Math.atan2(B, A);
    const [a, b] = [c * Math.cos(h), c * Math.sin(h)];
    const lms = (name: 'l' | 'm' | 's') =>
      (l + LMS[name][0] * a + LMS[name][1] * b) ** 3;
    const y = Y_ROW.l * lms('l') + Y_ROW.m * lms('m') + Y_ROW.s * lms('s');
    return { y, away: 1 - 2 * clampTo(0, (y - INK_CROSSOVER) * 1e6, 1) };
  };
  const sample: Rgb[] = [];
  for (let r = 0; r < 256; r += 15)
    for (let g = 0; g < 256; g += 15)
      for (let b = 0; b < 256; b += 15)
        sample.push([r / 255, g / 255, b / 255]);
  const L = (rgb: Rgb) => toLab(rgb)[0];
  const draw = (g: Rgb, name: keyof typeof ORG_BORDERS) =>
    oklchFrom(
      g,
      (l) => clampTo(0, l + ORG_BORDERS[name].step * cssAway(g).away, 1),
      (_, c) => c * ORG_BORDERS[name].chroma
    );

  it('finds the ground’s side from its luminance, in relative colour — the kit’s pole exactly', () => {
    expect(ORG_BRAND).toContain(`[data-org-bg] { ${HELPERS} }`);
    for (const g of sample) {
      const { y, away } = cssAway(g);
      // To the coefficients' 10 digits.
      expect(y, toHex(g)).toBeCloseTo(lum(g), 7);
      expect(away, toHex(g)).toBe(awayFrom(g));
      // …which is the kit's pole for that ground.
      const pole = BAND[groundBand(toHex(g)) as GroundBandId].pole;
      expect(away, toHex(g)).toBe(pole === 'light' ? -1 : 1);
    }
    // No single lightness is the crossover: a grey crosses at 0.5637, and
    // a ground of lower L can still be light.
    expect(INK_CROSSOVER ** (1 / 3)).toBeCloseTo(0.5637, 4);
    expect(
      sample.some((g) => awayFrom(g) === -1 && L(g) < 0.5637) &&
        sample.some((g) => awayFrom(g) === 1 && L(g) > 0.5637)
    ).toBe(true);
  });

  it('spells every border level with that side, in both themes, and no fixed step remains', () => {
    for (const theme of ['light', 'dark'] as const) {
      const rule =
        theme === 'light'
          ? (ORG_BRAND.match(/\} \[data-org-bg\] \{([^}]*)\}/)?.[1] ?? '')
          : (ORG_BRAND.match(
              /\[data-editing-theme='dark'\]\[data-org-bg\] \{([^}]*)\}/
            )?.[1] ?? '');
      for (const name of Object.keys(
        ORG_BORDERS
      ) as (keyof typeof ORG_BORDERS)[])
        expect(rule, `${theme} ${name}`).toContain(
          `${name}: ${orgBgRecipes(theme)[name]};`
        );
      expect(rule, theme).not.toMatch(
        /--color-border[\w-]*: oklch\(from [^;]* calc\(l [+-] [\d.]+\) /
      );
    }
  });

  it('never loses a border: every level stands its whole step from any ground, in either theme', () => {
    let lighter = 0;
    let darker = 0;
    for (const g of sample)
      for (const name of Object.keys(
        ORG_BORDERS
      ) as (keyof typeof ORG_BORDERS)[]) {
        const delta = L(draw(g, name)) - L(g);
        expect(Math.abs(delta), `${toHex(g)} ${name}`).toBeCloseTo(
          ORG_BORDERS[name].step,
          6
        );
        if (delta > 0) lighter++;
        else darker++;
      }
    expect(lighter).toBeGreaterThan(1000);
    expect(darker).toBeGreaterThan(1000);
    // The two that lost them: the parchment in dark mode now darkens…
    const parchment = hex('#F3F0E7');
    expect(L(draw(parchment, '--color-border'))).toBeCloseTo(
      L(parchment) - 0.12,
      6
    );
    // …where the theme's step clamped it to white.
    expect(clampTo(0, L(parchment) + 0.12, 1)).toBe(1);
    // Night in light mode now lightens, where the theme's step went darker.
    const night = hex('#15211C');
    expect(L(draw(night, '--color-border-strong'))).toBeCloseTo(
      L(night) + 0.18,
      6
    );
  });
});

// ── 18. atmosphere on every band (owner, D4; 03 X50) ────────────────────────
/*
 * With an org shader the hero and the closing ask default to `atmosphere`
 * (owner, D4: "On by default (Recommended)"), so a page on a wider band (X48)
 * draws one too. The veil (§5) is proven over pure black and pure white for
 * the first bands only, so each band gets the thinnest veil that holds every
 * floor over both backdrops for every ground the band can draw, and the glow
 * (where no shader runs) is measured on the same grounds. A band whose
 * thinnest veil is opaque cannot show a shader: PageRenderer draws its
 * atmosphere as base (`atmosphereProven`).
 */
function atmosphereBandCases(band: Band): [Rgb, Rgb, Tint][] {
  const pole = band.pole;
  const worst = bandWorsts()[`${pole}/${band.edge}`].plainAt;
  const cases: [Rgb, Rgb, Tint][] = [];
  for (const brandHex of Object.values(BRANDS)) {
    for (const tint of Object.values(STYLE_TINTS))
      cases.push([worst, hex(brandHex), tint]);
    for (let r = 0; r < 256; r += 51)
      for (let g = 0; g < 256; g += 51)
        for (let b = 0; b < 256; b += 51)
          cases.push([
            ground(pole, [r / 255, g / 255, b / 255], band.edge),
            hex(brandHex),
            DEFAULT_TINT,
          ]);
  }
  for (let r = 0; r < 256; r += 17)
    for (let g = 0; g < 256; g += 17)
      for (let b = 0; b < 256; b += 17)
        cases.push([worst, [r / 255, g / 255, b / 255], DEFAULT_TINT]);
  return cases;
}

/** The thinnest veil, in hundredths, that holds on `band`; 1 is opaque. */
function thinnestVeil(band: Band): number {
  const cases = atmosphereBandCases(band);
  let lo = Math.round(VEIL[band.pole] * 100) - 1;
  let hi = 100;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (failuresAt(band.pole, mid / 100, true, cases).length === 0) hi = mid;
    else lo = mid;
  }
  return hi / 100;
}

/** Each band's thinnest veil (§18 measures it), and so the bands an
 * atmosphere section is drawn on: where the shader still shows at least half
 * as much as on the pole's first band (light 18%, dark 14%). */
const BAND_VEIL: Record<GroundBandId, number> = {
  l90: 0.82,
  l85: 0.89,
  l80: 0.98,
  l75: 1,
  l70: 1,
  l65: 1,
  d24: 0.86,
  d30: 0.92,
  d36: 1,
  d42: 1,
  d48: 1,
};
const shows = (band: Band) =>
  1 - BAND_VEIL[band.id] >= (1 - BAND_VEIL[FIRST[band.pole].id]) / 2;

describe('atmosphere on every band — the thinnest veil that holds, or none (03 X50)', () => {
  it(
    'measures each band’s thinnest veil, and the first bands’ is the poles’ own',
    { timeout: 120_000 },
    () => {
      const veils = Object.fromEntries(
        Object.values(BAND).map((band) => [band.id, thinnestVeil(band)])
      );
      expect(veils).toEqual(BAND_VEIL);
      expect(BAND_VEIL.l90).toBe(VEIL.light);
      expect(BAND_VEIL.d24).toBe(VEIL.dark);
    }
  );

  it(
    'draws it only where the shader shows: l90, l85, d24 and d30',
    { timeout: 120_000 },
    () => {
      const drawn = Object.values(BAND)
        .filter(shows)
        .map((b) => b.id);
      expect(drawn).toEqual(['l90', 'l85', 'd24', 'd30']);
      // atmosphereProven agrees, in both themes.
      for (const band of Object.values(BAND))
        for (const other of ['l90', 'd24'] as const) {
          expect(atmosphereProven({ light: band.id, dark: other })).toBe(
            shows(band)
          );
          expect(atmosphereProven({ light: other, dark: band.id })).toBe(
            shows(band)
          );
        }
      // On each, 0.01 thinner fails, and the glow (no shader) holds.
      for (const band of Object.values(BAND).filter(shows)) {
        const cases = atmosphereBandCases(band);
        expect(
          failuresAt(band.pole, BAND_VEIL[band.id] - 0.01, true, cases).length,
          band.id
        ).toBeGreaterThan(0);
        expect(
          glowFailures(band.pole, GLOW.strength, GLOW[band.pole].l, cases),
          band.id
        ).toEqual([]);
      }
    }
  );

  it('names each band’s veil in schemes.css, and the section draws the stronger of it and the pole’s', () => {
    expect(CODE).toContain(
      '--_atmos-s: max(var(--_atmos-min), var(--_band-veil), var(--lp-atmosphere-scrim, 0));'
    );
    expect(CODE).toContain('--_band-veil: var(--_gl-veil, 0);');
    expect(CODE).toContain('--_band-veil: var(--_gd-veil, 0);');
    // Cinematic's room is the first dark band's, at the pole's own veil.
    expect(CODE).toMatch(
      /\.lp\[data-lp-style='cinematic'\] \{[^}]*--_band-veil: 0;/
    );
  });
});
