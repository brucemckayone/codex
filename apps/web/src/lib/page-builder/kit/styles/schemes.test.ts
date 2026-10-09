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
    ...darken('ot-dk', TARGET.orgTextLight),
    ...lighten('ot-lt', TARGET.orgTextDark),
    ...darken('ol-dk', TARGET.orgLargeLight),
    ...lighten('ol-lt', TARGET.orgLargeDark),
    ...darken('odt-dk', TARGET.orgDecTextLight),
    ...lighten('odt-lt', TARGET.orgDecTextDark),
    ...darken('odl-dk', TARGET.orgDecLargeLight),
    ...lighten('odl-lt', TARGET.orgDecLargeDark),
    `--_wl-f: max(min(1, ${TARGET.orgWhiteLabel} / max(var(--_y), 1e-6)), clamp(0, (var(--_y) - ${TARGET.orgWhiteLabelCut}) * 1e6, 1));`,
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
  '--lp-ground: oklch( from var(--_ground-in) clamp(0.9, l, 1) calc(c - clamp(0, (0.9 - l) * 1e6, 1) * max(0, c - 0.046)) h );',
  '--_org-soft-bg: oklch( from color-mix(in oklab, var(--_org-soft), var(--lp-brand) var(--lp-tint-soft)) clamp(0.9, l, 1) calc(c - clamp(0, (0.9 - l) * 1e6, 1) * max(0, c - 0.046)) h );',
  '--_org-panel: oklch( from var(--_org-card) clamp(0.9, l, 1) calc(c - clamp(0, (0.9 - l) * 1e6, 1) * max(0, c - 0.046)) h );',
  '--_contrast-bg: oklch(from var(--lp-brand) 0.2 min(c * 0.3, 0.033) h);',
  '--_panel-g: oklch( from color-mix(in oklab, var(--lp-ground), var(--lp-brand) var(--lp-tint-panel)) clamp(0.9, l, 0.965) min(c, (1 - clamp(0.9, l, 0.965)) * 0.46) h );',
  '--_panel-i: oklch(from var(--lp-brand) 0.265 min(c * 0.35, 0.043) h);',
  '--_scrim: oklch(from var(--lp-brand) 0.16 min(c * 0.25, 0.027) h);',
  // dark pole
  '--_ground-in: var(--lp-dark-ground-in, var(--_org-ground));',
  '--lp-ground: oklch( from var(--_ground-in) min(l, 0.24) calc(c - clamp(0, (l - 0.24) * 1e6, 1) * max(0, c - 0.039)) h );',
  '--_org-soft-bg: oklch( from color-mix(in oklab, var(--_org-soft), var(--lp-brand) var(--lp-tint-soft)) min(l, 0.24) calc(c - clamp(0, (l - 0.24) * 1e6, 1) * max(0, c - 0.039)) h );',
  '--_org-panel: oklch( from var(--_org-card) min(l, 0.24) calc(c - clamp(0, (l - 0.24) * 1e6, 1) * max(0, c - 0.039)) h );',
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
    expect(POLE.dark).toContain('min(l, 0.24)');
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
    // mid-tone (§11); the label is the step from the fill as drawn.
    expect(exact).toContain(
      '--lp-button-bg: rgb( from rgb(from var(--_org-button) var(--_ol-r) var(--_ol-g) var(--_ol-b)) var(--_wl-r) var(--_wl-g) var(--_wl-b) );'
    );
    expect(exact).toContain(
      '--lp-button-ink: rgb(from var(--lp-button-bg) calc(255 * var(--_wk)) calc(255 * var(--_wk)) calc(255 * var(--_wk)));'
    );
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
  };
}

/** The `[data-org-bg]` rule's parameters per theme: each surface's lightness
 * step and chroma share from the background, and the text's share in the
 * secondary text. §10 rebuilds the rule's text from these. */
const ORG_BG = {
  light: { soft: -0.03, card: 0.05, line: -0.12, textShare: 0.62 },
  dark: { soft: 0.04, card: 0.07, line: 0.12, textShare: 0.7 },
} as const;
const ORG_CHROMA = { soft: 0.5, card: 0.2, line: 0.3 } as const;

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
    line: at('line'),
    heading,
    focus,
    button,
  };
}

/** A base / soft section on an org's page; `null` is the kit's own inks
 * (atmosphere's ground, and Cinematic's room). */
interface Page {
  org: Org;
  decorated: boolean;
}

/** The safety net: an org colour moved toward its pole's side only as far as
 * the grade needs (`--_ot-*`, `--_ol-*`, `--_odt-*`, `--_odl-*`). */
function orgMove(
  mode: Mode,
  colour: Rgb,
  grade: 'text' | 'large',
  decorated: boolean
): Rgb {
  const [yLight, yDark] = decorated
    ? grade === 'text'
      ? [TARGET.orgDecTextLight, TARGET.orgDecTextDark]
      : [TARGET.orgDecLargeLight, TARGET.orgDecLargeDark]
    : grade === 'text'
      ? [TARGET.orgTextLight, TARGET.orgTextDark]
      : [TARGET.orgLargeLight, TARGET.orgLargeDark];
  return mode === 'light' ? darken(colour, yLight) : lighten(colour, yDark);
}

/** Keep white (owner, D8), after the grade's move: a fill the org's label
 * rule turns black, but white holds 3:1 on (0.181 < Y <= 0.30), darkens —
 * its linear channels scaled, so hue and chroma keep — to Y 0.181, and the
 * label is white up to 0.182. Off on a decorated dark page (`--_wld-*`),
 * whose grade keeps a button at Y >= 0.203, where white cannot hold. */
function keepWhite(
  mode: Mode,
  fill: Rgb,
  decorated: boolean
): { fill: Rgb; label: Rgb } {
  const kneeY = (rgb: Rgb) => {
    const [r, g, b] = clip(rgb).map(kneeLin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  let out = fill;
  if (mode === 'light' || !decorated) {
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
      bg =
        scheme === 'base'
          ? g
          : ground(mode, mix(page.org.soft, brand, tint.soft));
      panel = scheme === 'base' ? ground(mode, page.org.card) : g;
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
  const orgInk = orgMove(mode, org.ink, 'text', decorated);
  const orgButton = keepWhite(
    mode,
    orgMove(mode, org.button, 'large', decorated),
    decorated
  );
  return {
    ...kit,
    ink: orgInk,
    soft: orgMove(mode, org.inkSoft, 'text', decorated),
    panelInk: orgInk,
    heading: orgMove(mode, org.heading, 'large', decorated),
    title: orgMove(mode, org.heading, 'text', decorated),
    focus: orgMove(mode, org.focus, 'large', decorated),
    // The org's button and label rule (white kept on a mid-tone), its
    // accent text, and the marks in the colour the Style draws them in,
    // each at its grade.
    button: orgButton.fill,
    buttonInk: orgButton.label,
    accent: orgMove(mode, org.button, 'text', decorated),
    mark: orgMove(mode, source, 'large', decorated),
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
            mix(org.soft, brand, STYLE_TINTS.soft.soft),
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

/** The `[data-org-bg]` rule as `org-brand.css` spells it, from ORG_BG. */
function orgBgRecipes(theme: Mode): Record<string, string> {
  const bg =
    theme === 'light'
      ? 'var(--brand-bg, white)'
      : 'var(--brand-bg-dark, var(--brand-bg, #1a1a2e))';
  const p = ORG_BG[theme];
  const step = (d: number) => `calc(l ${d < 0 ? '-' : '+'} ${Math.abs(d)})`;
  const at = (key: keyof typeof ORG_CHROMA) =>
    `oklch(from ${bg} ${step(p[key])} calc(c * ${ORG_CHROMA[key]}) h)`;
  return {
    '--color-background': bg,
    '--color-surface-secondary': at('soft'),
    '--color-surface-card': at('card'),
    '--color-text': `oklch(from ${bg} clamp(0.05, (0.6 - l) * 1000, 0.9) 0 0)`,
    '--color-text-secondary': `color-mix(in oklab, var(--color-text) ${Math.round(p.textShare * 100)}%, var(--color-background))`,
    '--color-border': at('line'),
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
    const asHex = (org: Org) =>
      Object.fromEntries(
        Object.entries(org).map(([k, v]) => [
          k,
          `#${v
            .map((c: number) =>
              Math.round(c * 255)
                .toString(16)
                .padStart(2, '0')
            )
            .join('')}`,
        ])
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
      const fromOrg = decls(body(`${LAST[theme]}:is([data-org-bg] .lp) {`));
      for (const [name, value] of Object.entries(orgBgRecipes(theme)))
        expect(fromOrg[ORG_NAMES[name]], `${theme} ${name}`).toBe(
          asPreview(value)
            .replace(/var\(--brand-bg-dark,/g, 'var(--_org-bg-dark-in,')
            .replace(/var\(--brand-bg,/g, 'var(--_org-bg-in,')
        );
      // …and the page's own, where it sets one for this theme.
      const own = decls(
        body(
          `${LAST[theme]}:is(.lp[data-org-bg]:is([data-page-bg='${theme}'], [data-page-bg='both'])) {`
        )
      );
      for (const [name, value] of Object.entries(orgBgRecipes(theme)))
        expect(own[ORG_NAMES[name]], `${theme} ${name}`).toBe(asPreview(value));
    }
    expect(paletteHex('var(--color-neutral-0)')).toBe('#ffffff');
  });

  it('keeps the light pole where the org’s dark ground is its light one, as org-brand.css paints it', () => {
    // No dark background: the dark rule paints the light one.
    expect(orgBgRecipes('dark')['--color-background']).toContain(
      'var(--brand-bg-dark, var(--brand-bg,'
    );
    // So the dark pole excludes it on each of the dark theme's three
    // selectors, and nowhere else; Cinematic's room is dark in every theme.
    // It is the ORG's background that decides: a page's own light one with
    // no dark twin takes the org's dark mode (owner, D7), so the page
    // override is no longer an exclusion of its own.
    const org =
      "[data-org-bg]:not([style*='--brand-bg-dark:']) .lp:not([data-page-bg='dark'], [data-page-bg='both'])";
    expect(CODE.split(org).length - 1).toBe(3);
    expect(CODE).not.toContain(
      ".lp[data-org-bg]:not([style*='--brand-bg-dark:'], [style*='--brand-bg-dark:'] .lp)"
    );
    // The page's background is read from PageRenderer's `data-page-bg`,
    // never from its style text: only the org's own root is matched so.
    expect(CODE.match(/\.lp[^\s,{]*\[style\*=/g)).toBeNull();
    expect(POLE.dark).toContain('--lp-ground:');
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
              ['soft band', soft.bg, org.soft],
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
