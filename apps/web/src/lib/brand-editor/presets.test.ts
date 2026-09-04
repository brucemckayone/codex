import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  contrastRatio as railContrastRatio,
  deriveTextOnBrand as railDeriveTextOnBrand,
} from '$lib/components/brand-studio/rail/contrast';
import { DEFAULTS } from '$lib/components/ui/ShaderHero/shader-config';
import { tokenOverridesToCssVars } from './css-injection';
import { findFont } from './font-catalog';
import { HERO_FX_PRESETS } from './hero-fx-presets';
import {
  AA_TEXT_CONTRAST,
  ATMOSPHERE_AXES,
  COMPOSED_DESIGN_KEYS,
  contrast,
  DARK_CAPABLE_KEYS,
  FORM_AXES,
  inkOn,
  NO_MID_WEIGHT_FONTS,
  readableOn,
  SHADER_TEMPO,
  SINGLE_WEIGHT_FONTS,
  TYPE_AXES,
} from './preset-axes';
import {
  BRAND_PRESETS,
  type CategorizedPreset,
  PRESET_CATEGORY_ORDER,
  type PresetVariant,
} from './presets';

/**
 * Guard for the composed brand presets.
 *
 * Every assertion here corresponds to a defect that SHIPPED, and each derives
 * its expectation from source rather than from a copied list, so the guard
 * cannot silently rot when the thing it guards moves:
 *
 *   - writable keys        ← parsed out of css-injection.ts
 *   - dark-capable keys    ← parsed out of org-brand.css + the org layout
 *   - integer shader params← parsed out of shader-config.ts `Math.round(rv(…))`
 *   - shader tempo bases   ← the real exported DEFAULTS object
 *   - shader ids           ← the editor's own HERO_FX_PRESETS registry
 *   - font families        ← the real font catalog
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../..');

// ── Source-derived expectations ────────────────────────────────────────────

const injectionSrc = readFileSync(join(HERE, 'css-injection.ts'), 'utf8');
const keysStart = injectionSrc.indexOf('BRAND_PREFIX_KEYS = new Set([');
const WRITABLE_KEYS = new Set(
  [
    ...injectionSrc
      .slice(keysStart, injectionSrc.indexOf('])', keysStart))
      .matchAll(/'([\w-]+)'/g),
  ].map((m) => m[1])
);

const shaderConfigSrc = readFileSync(
  join(SRC, 'lib/components/ui/ShaderHero/shader-config.ts'),
  'utf8'
);
/** Params the config passes through `Math.round` — a fraction collapses them. */
const INTEGER_SHADER_KEYS = new Set(
  [...shaderConfigSrc.matchAll(/Math\.round\(rv\('([\w-]+)'/g)].map((m) => m[1])
);

/** Keys with a real `--brand-{key}-dark` reader somewhere in the app. */
function deriveDarkCapableKeys(): Set<string> {
  const files = [
    join(SRC, 'lib/styles/tokens/org-brand.css'),
    join(SRC, 'routes/_org/[slug]/+layout.svelte'),
  ];
  const found = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/var\(\s*--brand-([\w-]+)-dark\b/g)) {
      if (WRITABLE_KEYS.has(m[1])) found.add(m[1]);
    }
  }
  return found;
}

const SHADER_IDS = new Set(HERO_FX_PRESETS.map((p) => p.id));

/** Every preset plus every variant — 27 signatures + 81 variant entries. */
const ALL_LOOKS: (CategorizedPreset | PresetVariant)[] = BRAND_PRESETS.flatMap(
  (p) => [p as CategorizedPreset | PresetVariant, ...p.variants]
);

/**
 * The surface a look's headings actually land on, reproducing the org-brand.css
 * fallback chains verbatim:
 *   light = --brand-bg                      else themes/light.css #ffffff
 *   dark  = --brand-bg-dark → --brand-bg    else themes/dark.css neutral-800
 */
function surfaces(look: (typeof ALL_LOOKS)[number]): {
  light: string;
  dark: string;
} {
  const lightBg = look.values.backgroundColor;
  const darkBg = look.values.darkOverrides?.backgroundColor ?? null;
  return {
    light: lightBg ?? '#FFFFFF',
    dark: darkBg ?? lightBg ?? '#262626',
  };
}

// ── 0. The mechanism can fail ──────────────────────────────────────────────

describe('the contrast gate is not vacuous', () => {
  it('detects the exact pair that shipped broken (executive, dark theme)', () => {
    // #1E293B heading on the #262626 dark surface: what `executive` rendered
    // before dark heading colours existed. If this stops failing, the
    // calculator is broken and every assertion below is meaningless.
    const ratio = contrast('#1E293B', '#262626');
    expect(ratio).not.toBeNull();
    expect(ratio as number).toBeLessThan(1.1);
    expect(ratio as number).toBeLessThan(AA_TEXT_CONTRAST);
  });

  it('readableOn repairs that pair while keeping the hue', () => {
    const repaired = readableOn('#1E293B', '#262626');
    expect(contrast(repaired, '#262626') as number).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST
    );
    // Hue preserved: the repair moves lightness, it does not pick a new colour.
    expect(repaired).not.toBe('#1E293B');
  });

  it('agrees with the rail readout it duplicates', () => {
    for (const pair of [
      ['#FFFFFF', '#059669'],
      ['#000000', '#FBBF24'],
      ['#1E293B', '#262626'],
      ['#4ADE80', '#050505'],
    ] as const) {
      expect(contrast(pair[0], pair[1])).toBeCloseTo(
        railContrastRatio(pair[0], pair[1]) as number,
        6
      );
    }
    for (const brand of ['#059669', '#FBBF24', '#1E40AF', '#F5DEB3']) {
      expect(inkOn(brand)).toBe(railDeriveTextOnBrand(brand));
    }
  });
});

// ── 1. Contrast, both themes ───────────────────────────────────────────────

describe('every look is legible in both themes', () => {
  it('sets a heading colour clearing AA on the light surface', () => {
    const failures: string[] = [];
    for (const look of ALL_LOOKS) {
      const heading = look.tokenOverrides?.['heading-color'];
      const bg = surfaces(look).light;
      if (!heading) {
        failures.push(`${look.id}: no heading-color`);
        continue;
      }
      const ratio = contrast(heading, bg);
      if (ratio === null || ratio < AA_TEXT_CONTRAST) {
        failures.push(`${look.id}: ${heading} on ${bg} = ${ratio?.toFixed(2)}`);
      }
    }
    expect(failures, failures.join('\n  ')).toEqual([]);
  });

  it('sets a DARK heading colour clearing AA on the dark surface', () => {
    // The original defect: org-brand.css:433 falls back to the LIGHT value, so
    // omitting this key shipped 1.03:1 headings on 11 presets.
    const failures: string[] = [];
    for (const look of ALL_LOOKS) {
      const heading =
        look.darkTokenOverrides?.['heading-color'] ??
        look.tokenOverrides?.['heading-color'];
      const bg = surfaces(look).dark;
      if (!heading) {
        failures.push(`${look.id}: no heading-color for dark`);
        continue;
      }
      const ratio = contrast(heading, bg);
      if (ratio === null || ratio < AA_TEXT_CONTRAST) {
        failures.push(`${look.id}: ${heading} on ${bg} = ${ratio?.toFixed(2)}`);
      }
    }
    expect(failures, failures.join('\n  ')).toEqual([]);
  });

  it('labels the hero CTA against its own fill', () => {
    const failures: string[] = [];
    for (const look of ALL_LOOKS) {
      const bg = look.tokenOverrides?.['hero-cta-bg'];
      const fg = look.tokenOverrides?.['hero-cta-text'];
      if (!bg || !fg) {
        failures.push(`${look.id}: missing hero CTA tokens`);
        continue;
      }
      const ratio = contrast(fg, bg);
      if (ratio === null || ratio < AA_TEXT_CONTRAST) {
        failures.push(`${look.id}: ${fg} on ${bg} = ${ratio?.toFixed(2)}`);
      }
    }
    expect(failures, failures.join('\n  ')).toEqual([]);
  });
});

// ── 2. Coverage, so preset-to-preset bleed cannot recur ────────────────────

describe('coverage', () => {
  it('every look fills every composed design key', () => {
    // `applyPreset` MERGES token overrides, so a key one preset sets and the
    // next omits is inherited. Full coverage is what makes each preset render
    // as authored regardless of what was clicked before it.
    const failures: string[] = [];
    for (const look of ALL_LOOKS) {
      const missing = COMPOSED_DESIGN_KEYS.filter(
        (k) => !(k in (look.tokenOverrides ?? {}))
      );
      if (missing.length) failures.push(`${look.id}: ${missing.join(', ')}`);
    }
    expect(failures, failures.join('\n  ')).toEqual([]);
  });

  it('every composed design key is actually writable', () => {
    const notWritable = COMPOSED_DESIGN_KEYS.filter(
      (k) => !WRITABLE_KEYS.has(k)
    );
    expect(notWritable).toEqual([]);
  });

  it('every look names its own shader', () => {
    // `paper` used to omit `shader-preset` entirely and therefore inherited
    // whichever shader the previously-clicked preset had left behind.
    const missing = ALL_LOOKS.filter(
      (l) => !l.tokenOverrides?.['shader-preset']
    ).map((l) => l.id);
    expect(missing).toEqual([]);
  });

  it('never writes a dark key that nothing reads', () => {
    const derived = deriveDarkCapableKeys();
    // The declared list must not claim more than the source supports.
    const overclaimed = DARK_CAPABLE_KEYS.filter((k) => !derived.has(k));
    expect(
      overclaimed,
      `DARK_CAPABLE_KEYS lists keys with no --brand-{key}-dark reader: ${overclaimed.join(', ')}`
    ).toEqual([]);

    const dead: string[] = [];
    for (const look of ALL_LOOKS) {
      for (const key of Object.keys(look.darkTokenOverrides ?? {})) {
        if (!derived.has(key)) dead.push(`${look.id}: ${key}`);
      }
    }
    expect(
      dead,
      `dark overrides nothing reads (hero-* has no dark chain):\n  ${dead.join('\n  ')}`
    ).toEqual([]);
  });
});

// ── 3. Shader parameters are real and well-typed ───────────────────────────

describe('shader parameters', () => {
  it('every atmosphere names a shader the editor offers', () => {
    const unknown = Object.values(ATMOSPHERE_AXES)
      .filter((a) => !SHADER_IDS.has(a.shader))
      .map((a) => `${a.id} -> ${a.shader}`);
    expect(unknown, unknown.join(', ')).toEqual([]);
  });

  it('every shader token a look writes is a writable key', () => {
    // Ten invented param names (`shader-glow-speed`, `shader-plasma-density`,
    // `shader-spore-density`, …) were caught by exactly this check — each
    // would have been injected as a custom property no renderer reads.
    const bogus: string[] = [];
    for (const look of ALL_LOOKS) {
      for (const key of Object.keys(look.tokenOverrides ?? {})) {
        if (key.startsWith('shader-') && !WRITABLE_KEYS.has(key)) {
          bogus.push(`${look.id}: ${key}`);
        }
      }
    }
    expect(bogus, bogus.join('\n  ')).toEqual([]);
  });

  it('gives an integer to every Math.round-ed parameter', () => {
    // `nebula-depth: 0.8` rounded to 1 where the shader wants 8 layers, and
    // `vortex-density: 0.8` rounded to 1 where it wants 40 arms.
    expect(INTEGER_SHADER_KEYS.size).toBeGreaterThan(0);
    const fractional: string[] = [];
    for (const look of ALL_LOOKS) {
      for (const [key, value] of Object.entries(look.tokenOverrides ?? {})) {
        if (!INTEGER_SHADER_KEYS.has(key)) continue;
        if (!Number.isInteger(Number(value))) {
          fractional.push(`${look.id}: ${key} = ${value}`);
        }
      }
    }
    expect(fractional, fractional.join('\n  ')).toEqual([]);
  });

  it('anchors every tempo to a real DEFAULTS entry', () => {
    for (const [shader, tempo] of Object.entries(SHADER_TEMPO)) {
      if (tempo === null) continue;
      expect(
        DEFAULTS,
        `SHADER_TEMPO.${shader}.base = "${tempo.base}" is not in shader-config DEFAULTS`
      ).toHaveProperty(tempo.base);
      expect(typeof DEFAULTS[tempo.base]).toBe('number');
      expect(WRITABLE_KEYS.has(`shader-${tempo.token}`)).toBe(true);
    }
  });

  it('declares tempo 1 for shaders with no speed control', () => {
    for (const atmos of Object.values(ATMOSPHERE_AXES)) {
      if (SHADER_TEMPO[atmos.shader] === null) {
        expect(atmos.tempo, `${atmos.id} (${atmos.shader})`).toBe(1);
      }
    }
  });

  it('covers the shader of every atmosphere in SHADER_TEMPO', () => {
    const uncovered = Object.values(ATMOSPHERE_AXES)
      .filter((a) => !(a.shader in SHADER_TEMPO))
      .map((a) => `${a.id} -> ${a.shader}`);
    expect(uncovered, uncovered.join(', ')).toEqual([]);
  });
});

// ── 4. Typography constraints ──────────────────────────────────────────────

describe('typography', () => {
  it('uses only fonts the picker can offer', () => {
    // A preset selecting an off-catalog family loads fine (loadGoogleFont
    // builds its URL from the family name) but leaves the font picker unable to
    // show the org its own saved state — which is what Terminal's JetBrains
    // Mono and Blueprint's IBM Plex Sans did before the monospace category.
    const missing: string[] = [];
    for (const axis of Object.values(TYPE_AXES)) {
      for (const family of [axis.fontHeading, axis.fontBody]) {
        if (!findFont(family)) missing.push(`${axis.id}: ${family}`);
      }
    }
    expect(missing, missing.join(', ')).toEqual([]);
  });

  it('never asks a single-weight face for a synthesised weight', () => {
    // Google Fonts answers `wght@400;500;600;700` for these families with the
    // 400 face alone, so 600/700 becomes browser faux-bold on a face that is
    // already black by design.
    const bad = Object.values(TYPE_AXES)
      .filter(
        (a) => SINGLE_WEIGHT_FONTS.has(a.fontHeading) && a.headingWeight !== 400
      )
      .map((a) => `${a.id}: ${a.fontHeading} at ${a.headingWeight}`);
    expect(bad, bad.join(', ')).toEqual([]);
  });

  it('never asks a 400/700-only face for a mid weight', () => {
    const bad: string[] = [];
    for (const axis of Object.values(TYPE_AXES)) {
      if (
        NO_MID_WEIGHT_FONTS.has(axis.fontHeading) &&
        axis.headingWeight !== 400 &&
        axis.headingWeight !== 700
      ) {
        bad.push(`${axis.id}: ${axis.fontHeading} at ${axis.headingWeight}`);
      }
      if (
        NO_MID_WEIGHT_FONTS.has(axis.fontBody) &&
        axis.bodyWeight !== 400 &&
        axis.bodyWeight !== 700
      ) {
        bad.push(`${axis.id}: body ${axis.fontBody} at ${axis.bodyWeight}`);
      }
    }
    expect(bad, bad.join(', ')).toEqual([]);
  });

  it('keeps every weight inside the loaded 400-700 range', () => {
    for (const axis of Object.values(TYPE_AXES)) {
      expect(axis.headingWeight).toBeGreaterThanOrEqual(400);
      expect(axis.headingWeight).toBeLessThanOrEqual(700);
      expect(axis.bodyWeight).toBeGreaterThanOrEqual(400);
      expect(axis.bodyWeight).toBeLessThanOrEqual(700);
    }
  });

  it('varies scale and weight across the type axes', () => {
    // The original defect: NO preset set text-scale or heading-weight, so every
    // brand rendered identical typography with a different font name.
    const scales = new Set(Object.values(TYPE_AXES).map((a) => a.textScale));
    const weights = new Set(
      Object.values(TYPE_AXES).map((a) => a.headingWeight)
    );
    expect(scales.size).toBeGreaterThan(3);
    expect(weights.size).toBeGreaterThan(2);
  });
});

// ── 5. Form axis sanity ────────────────────────────────────────────────────

describe('form axes', () => {
  it('states shadow colour as a bare HSL triple, never a hex', () => {
    // org-brand.css composes it as `hsl(var(--shadow-color) / …)`, so a hex
    // silently voids every shadow on the page.
    for (const axis of Object.values(FORM_AXES)) {
      for (const value of [axis.shadowColor, axis.shadowColorDark]) {
        expect(value, `${axis.id}: ${value}`).toMatch(
          /^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/
        );
      }
    }
  });

  it('varies elevation and radius across the form axes', () => {
    const shadows = new Set(Object.values(FORM_AXES).map((a) => a.shadowScale));
    const radii = new Set(Object.values(FORM_AXES).map((a) => a.radius));
    expect(shadows.size).toBeGreaterThan(3);
    expect(radii.size).toBeGreaterThan(3);
  });
});

// ── 6. Preset + variant structure ──────────────────────────────────────────

describe('presets and their variants', () => {
  it('exposes a preset for every declared category', () => {
    for (const category of PRESET_CATEGORY_ORDER) {
      expect(
        BRAND_PRESETS.filter((p) => p.category === category).length,
        category
      ).toBeGreaterThan(0);
    }
  });

  it('has no category outside the declared order', () => {
    const declared = new Set<string>(PRESET_CATEGORY_ORDER);
    const stray = BRAND_PRESETS.filter((p) => !declared.has(p.category)).map(
      (p) => `${p.id}: ${p.category}`
    );
    expect(stray).toEqual([]);
  });

  it('gives every preset a signature plus at least two alternates', () => {
    for (const preset of BRAND_PRESETS) {
      expect(preset.variants.length, preset.id).toBeGreaterThanOrEqual(3);
      expect(preset.variants[0].label).toBe('Signature');
    }
  });

  it('makes the signature variant identical to the preset itself', () => {
    for (const preset of BRAND_PRESETS) {
      const signature = preset.variants[0];
      expect(signature.tokenOverrides, preset.id).toEqual(
        preset.tokenOverrides
      );
      expect(signature.darkTokenOverrides, preset.id).toEqual(
        preset.darkTokenOverrides
      );
      expect(signature.values, preset.id).toEqual(preset.values);
      expect(signature.axes, preset.id).toEqual(preset.axes);
    }
  });

  it('gives every alternate a genuinely different look', () => {
    for (const preset of BRAND_PRESETS) {
      const fingerprints = preset.variants.map((v) =>
        JSON.stringify(v.tokenOverrides)
      );
      expect(new Set(fingerprints).size, `${preset.id} variants`).toBe(
        preset.variants.length
      );
      for (const variant of preset.variants.slice(1)) {
        expect(variant.axes, `${preset.id}/${variant.label}`).not.toEqual(
          preset.axes
        );
      }
    }
  });

  it('keeps every id unique across presets and variants', () => {
    const ids = ALL_LOOKS.map((l) => l.id).filter(
      // Signature variants intentionally reuse their parent's id.
      (id) => id.includes('.')
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps a variant on its parent palette', () => {
    // A variant re-points type/form/atmosphere. Changing the palette would
    // make it a different brand, not a sub-preset.
    for (const preset of BRAND_PRESETS) {
      for (const variant of preset.variants) {
        expect(variant.values.primaryColor, variant.id).toBe(
          preset.values.primaryColor
        );
        expect(variant.values.backgroundColor, variant.id).toBe(
          preset.values.backgroundColor
        );
      }
    }
  });

  it('reaches a wide spread of distinct looks', () => {
    const distinct = new Set(
      ALL_LOOKS.map((l) => JSON.stringify(l.tokenOverrides))
    );
    // 27 signatures duplicate their parent entry, so the ceiling is
    // ALL_LOOKS.length - BRAND_PRESETS.length.
    expect(distinct.size).toBe(ALL_LOOKS.length - BRAND_PRESETS.length);
    expect(distinct.size).toBeGreaterThanOrEqual(60);
  });
});

// ── 7. Emitted CSS values, through the real injection path ─────────────────

describe('emitted CSS custom properties', () => {
  /**
   * An INVALID custom-property value is discarded by the CSS parser in
   * silence — no error, no warning, the declaration simply does not apply.
   * Composition interpolates strings, does OKLCH maths and calls
   * `.toFixed(4)`, so `NaN`, `undefined` and `Infinity` all have a path into a
   * value here, and none of them would announce themselves in the browser.
   * Same silent-failure class as an invented property NAME, which the shader
   * key check above covers.
   */
  const HEX = /^#[0-9A-Fa-f]{6}$/;
  const NUMBER = /^-?\d+(\.\d+)?$/;
  const HSL_TRIPLE = /^\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%$/;
  const KEYWORD = /^[a-z][a-z0-9-]*$/;

  function malformed(value: string): string | null {
    if (value.trim() === '') return 'empty';
    if (/NaN|undefined|null|Infinity/.test(value))
      return 'non-finite/undefined';
    if (
      !HEX.test(value) &&
      !NUMBER.test(value) &&
      !HSL_TRIPLE.test(value) &&
      !KEYWORD.test(value)
    ) {
      return 'unrecognised shape';
    }
    return null;
  }

  it('the malformed-value detector can actually fail', () => {
    // Without this the assertion below could be vacuous.
    expect(malformed('NaN')).toBe('non-finite/undefined');
    expect(malformed('0.30000000000000004')).toBeNull(); // ugly but valid
    expect(malformed('')).toBe('empty');
    expect(malformed('#GGGGGG')).toBe('unrecognised shape');
    expect(malformed('rgb(0 0 0)')).toBe('unrecognised shape');
    // …and passes the real shapes composition emits.
    expect(malformed('#1E3A5F')).toBeNull();
    expect(malformed('1.02')).toBeNull();
    expect(malformed('220 6% 14%')).toBeNull();
    expect(malformed('uppercase')).toBeNull();
  });

  it('emits only well-formed values, in both buckets, for every look', () => {
    const failures: string[] = [];
    for (const look of ALL_LOOKS) {
      for (const bucket of ['tokenOverrides', 'darkTokenOverrides'] as const) {
        for (const [key, value] of Object.entries(look[bucket] ?? {})) {
          const why = malformed(String(value));
          if (why) {
            failures.push(
              `${look.id} ${bucket}.${key} = ${JSON.stringify(value)} (${why})`
            );
          }
        }
      }
    }
    expect(failures, failures.join('\n  ')).toEqual([]);
  });

  it('routes every composed key to a --brand-* property, never --color-*', () => {
    // `tokenOverridesToCssVars` picks the prefix by BRAND_PREFIX_KEYS
    // membership (css-injection.ts:597). A composed key that fell out of that
    // registry would still be written — as `--color-{key}`, which org-brand.css
    // does not read. The value would look right in the saved JSON and do
    // nothing on the page.
    const misrouted: string[] = [];
    for (const look of ALL_LOOKS) {
      const vars = tokenOverridesToCssVars(look.tokenOverrides ?? {});
      for (const key of COMPOSED_DESIGN_KEYS) {
        if (!(`--brand-${key}` in vars)) {
          misrouted.push(
            `${look.id}: ${key} -> ${`--color-${key}` in vars ? '--color-* (wrong prefix)' : 'absent'}`
          );
        }
      }
    }
    expect(misrouted, misrouted.join('\n  ')).toEqual([]);
  });

  it('round-trips every shader key to --brand-shader-*', () => {
    const misrouted: string[] = [];
    for (const look of ALL_LOOKS) {
      const vars = tokenOverridesToCssVars(look.tokenOverrides ?? {});
      for (const key of Object.keys(look.tokenOverrides ?? {})) {
        if (!key.startsWith('shader-')) continue;
        if (!(`--brand-${key}` in vars)) misrouted.push(`${look.id}: ${key}`);
      }
    }
    expect(misrouted, misrouted.join('\n  ')).toEqual([]);
  });
});
