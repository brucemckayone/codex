// @vitest-environment node
/**
 * The org's shadow strength and colour reach its shadows (Codex-hz5du).
 *
 * The brand editor's shadow controls set `--brand-shadow-scale` and
 * `--brand-shadow-color`, and `org-brand.css` turns them into
 * `--shadow-strength` / `--shadow-color` under `[data-org-brand]`. The scale
 * (`--shadow-xs` … `--shadow-xl`, `--shadow-inner`) was composed on `:root`
 * only, and a custom property substitutes its `var()`s where it is DECLARED,
 * so every org drew the platform's shadows. The scale is now composed under
 * each org's scope too, from the one recipe in `shadows.css`, and an org's
 * inputs start from the theme's own platform defaults, so an org that sets
 * nothing draws exactly the platform's shadows in either theme.
 *
 * The brand's scale multiplies each layer's WHOLE opacity (owner, D19: "Scale
 * the whole shadow (Recommended)"): it used to multiply only the 1% strength
 * under each light layer's 9% / 4% offset, so 0.5 moved 0.10 to 0.095.
 *
 * Read as text (comments out) and evaluated the way the browser resolves it:
 * which rule declares each property, and what alpha each layer ends with.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIR = dirname(fileURLToPath(import.meta.url));
const flat = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');
const SHADOWS = flat(readFileSync(join(DIR, 'shadows.css'), 'utf8'));
const ORG = flat(readFileSync(join(DIR, 'org-brand.css'), 'utf8'));

/** Every rule in a sheet whose body declares `name`, by its selector. */
function declaring(css: string, name: string): string[] {
  const out: string[] = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = rule.exec(css); m; m = rule.exec(css))
    if ((m[2] ?? '').includes(`${name}:`)) out.push((m[1] ?? '').trim());
  return out;
}
/** A property's value in the rule with this exact selector. */
function valueIn(css: string, selector: string, name: string): string {
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = rule.exec(css); m; m = rule.exec(css))
    if ((m[1] ?? '').trim() === selector) {
      const v = (m[2] ?? '').match(
        new RegExp(`(?:^|;)\\s*${name}:\\s*([^;]+);`)
      )?.[1];
      if (v) return v.trim();
    }
  throw new Error(`${name} not in ${selector}`);
}

const SCALE = [
  '--shadow-xs',
  '--shadow-sm',
  '--shadow-md',
  '--shadow-lg',
  '--shadow-xl',
  '--shadow-inner',
];
const ROOT_AND_ORG = ':root, [data-org-brand]';

/** Each layer's alpha offset over the strength, from the recipe: every layer
 * is `(strength + offset) × scale`. */
const offsets = (name: string) =>
  [
    ...valueIn(SHADOWS, ROOT_AND_ORG, name).matchAll(
      /calc\(\(var\(--shadow-strength\) \+ ([\d.]+)%\) \* var\(--shadow-scale, 1\)\)/g
    ),
  ].map((m) => Number(m[1]));
/** How many layers a token draws: its `hsl(` colours. */
const layers = (name: string) =>
  valueIn(SHADOWS, ROOT_AND_ORG, name).split('hsl(').length - 1;
const percent = (v: string) => Number(v.replace('%', ''));
const platform = () => ({
  light: {
    strength: percent(valueIn(SHADOWS, ':root', '--shadow-strength-default')),
    colour: valueIn(SHADOWS, ':root', '--shadow-color-default'),
  },
  dark: {
    strength: percent(
      valueIn(SHADOWS, "[data-theme='dark']", '--shadow-strength-default')
    ),
    colour: valueIn(SHADOWS, "[data-theme='dark']", '--shadow-color-default'),
  },
});
/** A layer's alpha in percent, as the browser computes it, for a brand scale. */
const alpha = (theme: 'light' | 'dark', offset: number, scale = 1) =>
  (platform()[theme].strength + offset) * scale;

describe('the shadow scale — one recipe, composed under every org scope (Codex-hz5du)', () => {
  it('is declared once, by `:root, [data-org-brand]`, and nowhere else in the token sheets', () => {
    const sheets = readdirSync(DIR).filter((f) => f.endsWith('.css'));
    for (const name of SCALE) {
      const where = sheets.flatMap((f) =>
        declaring(flat(readFileSync(join(DIR, f), 'utf8')), name).map(
          (sel) => `${f}: ${sel}`
        )
      );
      expect(where, name).toEqual([`shadows.css: ${ROOT_AND_ORG}`]);
    }
  });

  it('reads its inputs from the theme’s own platform defaults', () => {
    expect(valueIn(SHADOWS, ':root', '--shadow-color')).toBe(
      'var(--shadow-color-default)'
    );
    expect(valueIn(SHADOWS, ':root', '--shadow-strength')).toBe(
      'var(--shadow-strength-default)'
    );
    // The dark theme moves the defaults only, so what reads them follows.
    expect(declaring(SHADOWS, '--shadow-color')).toEqual([':root']);
    expect(declaring(SHADOWS, '--shadow-strength')).toEqual([':root']);
    // The platform sets no scale: it falls back to 1, so nothing moves.
    expect(declaring(SHADOWS, '--shadow-scale')).toEqual([]);
    expect(platform()).toEqual({
      light: { strength: 1, colour: '220 3% 15%' },
      dark: { strength: 25, colour: '220 40% 2%' },
    });
  });

  it('gives an org the brand’s scale and colour, over the theme’s own defaults', () => {
    expect(ORG).toContain('--shadow-scale: var(--brand-shadow-scale, 1);');
    // The strength is the theme's, untouched: the scale does the scaling.
    expect(declaring(ORG, '--shadow-strength')).toEqual([]);
    expect(ORG).toContain(
      '--shadow-color: var(--brand-shadow-color, var(--shadow-color-default));'
    );
    expect(ORG).toContain(
      '--shadow-color: var(--brand-shadow-color-dark, var(--brand-shadow-color, var(--shadow-color-default)));'
    );
    // No platform number is copied into the org's sheet.
    expect(ORG).not.toMatch(/--shadow-(?:strength|color):[^;]*\d+%/);
  });

  it('scales every layer of every token, none left out', () => {
    for (const name of SCALE) {
      expect(layers(name), name).toBeGreaterThan(0);
      expect(offsets(name).length, name).toBe(layers(name));
    }
  });

  it('draws the platform’s shadows for an org that sets nothing, and halves them at 0.5', () => {
    for (const theme of ['light', 'dark'] as const)
      for (const name of SCALE) {
        const drawn = offsets(name).map((o) => platform()[theme].strength + o);
        expect(
          offsets(name).map((o) => alpha(theme, o)),
          `${theme} ${name}`
        ).toEqual(drawn);
      }
    // of-blood-and-bones' seed: shadow-scale 0.5, so half of 10% / 5% (light)
    // and of 34% / 29% (dark).
    expect(offsets('--shadow-md').map((o) => alpha('light', o, 0.5))).toEqual([
      5, 2.5,
    ]);
    expect(offsets('--shadow-md').map((o) => alpha('dark', o, 0.5))).toEqual([
      17, 14.5,
    ]);
  });
});
