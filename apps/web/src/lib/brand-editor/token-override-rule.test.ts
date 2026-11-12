/**
 * Everything the brand editor can write passes its own save rule
 * (Codex-403d3).
 *
 * The worker refuses an override map that breaks the rule, so an editor
 * value that broke it would leave a brand its own Save can't keep. Applying
 * a preset merges its keys in, a guided mix composes a whole map, and the
 * shader sliders and fine-tune colours write one key each. This walks all of
 * them. It also pins every key the editor can write under the entry limit:
 * a map only grows as presets are browsed, since applyPreset never removes
 * a key (Codex-oqv3r), and a map past the limit could never be saved.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TOKEN_OVERRIDE_KEY,
  TOKEN_OVERRIDE_MAX_ENTRIES,
  tokenOverrideEntryProblem,
  tokenOverridesJsonSchema,
} from '@codex/validation';
import { describe, expect, it } from 'vitest';
import { BRAND_PREFIX_KEYS } from './css-injection';
import { ALL_HERO_FX_SHADER_KEYS, HERO_FX_DEFAULTS } from './hero-fx-presets';
import {
  ATMOSPHERE_AXES,
  type AtmosphereAxisId,
  composePreset,
  FORM_AXES,
  type FormAxisId,
  type PresetPalette,
  TYPE_AXES,
  type TypeAxisId,
} from './preset-axes';
import { BRAND_PRESETS } from './presets';
import type { BrandPreset } from './types';

/** Two palettes the guided mixer can start from: no background, and one. */
const PALETTES: PresetPalette[] = [
  {
    primary: '#C24129',
    secondary: '#4B5563',
    accent: '#F59E0B',
    background: null,
    darkPrimary: '#E0735E',
    darkBackground: '#0A0A0A',
    headingIntent: '#C24129',
  },
  {
    primary: '#1D4ED8',
    secondary: '#0F766E',
    accent: null,
    background: '#FAF7F2',
    darkPrimary: '#93C5FD',
    darkBackground: '#111827',
    headingIntent: 'auto',
  },
];

/** Every guided mix: each type, form and atmosphere, on each palette. */
function guidedMixes(): BrandPreset[] {
  const mixes: BrandPreset[] = [];
  for (const palette of PALETTES) {
    for (const type of Object.keys(TYPE_AXES) as TypeAxisId[]) {
      for (const form of Object.keys(FORM_AXES) as FormAxisId[]) {
        for (const atmosphere of Object.keys(
          ATMOSPHERE_AXES
        ) as AtmosphereAxisId[]) {
          mixes.push(
            composePreset({
              id: `mix.${type}.${form}.${atmosphere}`,
              name: 'Custom mix',
              description: 'Mixed in the guided editor',
              palette,
              type,
              form,
              atmosphere,
            })
          );
        }
      }
    }
  }
  return mixes;
}

/** Each entry the rule refuses in `map`, and whether the save would refuse it whole. */
function refusals(source: string, map: Record<string, unknown> | undefined) {
  if (!map) return [];
  const found = Object.entries(map).flatMap(([key, value]) => {
    const problem = tokenOverrideEntryProblem(key, value);
    return problem
      ? [`${source} ${key}=${JSON.stringify(value)}: ${problem}`]
      : [];
  });
  if (!tokenOverridesJsonSchema.safeParse(JSON.stringify(map)).success) {
    found.push(`${source}: the save refuses the map`);
  }
  return found;
}

/**
 * The fine-tune colour panel's keys. They are declared inside the component
 * (`{ key: '…' }` rows), so they are read from its source.
 */
function fineTuneColourKeys(): string[] {
  const source = readFileSync(
    join(
      import.meta.dirname,
      '../components/brand-editor/levels/BrandEditorFineTuneColors.svelte'
    ),
    'utf8'
  );
  return [...source.matchAll(/\bkey: '([^']+)'/g)].map(
    (match) => match[1] ?? ''
  );
}

describe('what the brand editor writes passes its own save rule (Codex-403d3)', () => {
  it('every brand preset, light and dark', () => {
    expect(BRAND_PRESETS.length).toBeGreaterThan(0);
    expect(
      BRAND_PRESETS.flatMap((preset) => [
        ...refusals(`${preset.id} light`, preset.tokenOverrides),
        ...refusals(`${preset.id} dark`, preset.darkTokenOverrides),
      ])
    ).toEqual([]);
  });

  it('every guided mix, on each palette', () => {
    const mixes = guidedMixes();
    expect(mixes.length).toBeGreaterThan(100);
    expect(
      mixes.flatMap((mix) => [
        ...refusals(`${mix.id} light`, mix.tokenOverrides),
        ...refusals(`${mix.id} dark`, mix.darkTokenOverrides),
      ])
    ).toEqual([]);
  });

  it("every shader setting's default", () => {
    expect(ALL_HERO_FX_SHADER_KEYS.length).toBeGreaterThan(0);
    expect(refusals('shader defaults', HERO_FX_DEFAULTS)).toEqual([]);
    expect(
      ALL_HERO_FX_SHADER_KEYS.filter((key) => !TOKEN_OVERRIDE_KEY.test(key))
    ).toEqual([]);
  });

  it('every key it can write fits under the entry limit, with room', () => {
    const colourKeys = fineTuneColourKeys();
    expect(colourKeys.length).toBeGreaterThan(20);
    const keys = new Set<string>([
      ...ALL_HERO_FX_SHADER_KEYS,
      ...BRAND_PREFIX_KEYS,
      ...colourKeys,
      ...[...BRAND_PRESETS, ...guidedMixes()].flatMap((preset) => [
        ...Object.keys(preset.tokenOverrides ?? {}),
        ...Object.keys(preset.darkTokenOverrides ?? {}),
      ]),
    ]);
    expect([...keys].filter((key) => !TOKEN_OVERRIDE_KEY.test(key))).toEqual(
      []
    );
    // Every key at once must still save, with half the limit to spare.
    expect(keys.size).toBeLessThanOrEqual(TOKEN_OVERRIDE_MAX_ENTRIES / 2);
  });
});
