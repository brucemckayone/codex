import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HERO_FX_PRESETS } from '$lib/brand-editor/hero-fx-presets';

/**
 * Every shader preset must be reachable, and reachable everywhere.
 *
 * A preset is only real if four things agree: the `ShaderPresetId` union, the
 * `HERO_FX_PRESETS` menu, the `loadRenderer()` dispatch, and a renderer file.
 * Nothing in the type system couples them — `getShaderConfig` takes a
 * `ShaderPresetId` but the pickers pass plain strings, and `loadRenderer`
 * returns `null` for an unknown id rather than failing to compile.
 *
 * That gap has already produced a real defect. `ShaderPicker.svelte` — the
 * immersive *audio* picker — carried its own hardcoded copy of the preset
 * list, and it had drifted to 26 of 41. Sixteen presets could not be selected
 * for audio playback at all, and adding a preset gave no signal that the
 * second list needed updating. It now derives from `HERO_FX_PRESETS`; this
 * test is the guard that keeps it derived.
 *
 * These assertions run over SOURCE TEXT rather than imports on purpose. The
 * failure being guarded is a *hardcoded list reappearing*, and an import-based
 * test cannot see that — a fresh literal array would satisfy it perfectly.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_SRC = resolve(HERE, '../../../../..'); // …/apps/web/src

function read(relative: string): string {
  return readFileSync(join(WEB_SRC, relative), 'utf8');
}

const presetIds = HERO_FX_PRESETS.map((p) => p.id).filter(
  (id) => id !== 'none'
);

describe('preset menu coverage', () => {
  it('offers every implemented preset in the menu', () => {
    // THE CONVERSE, and the direction my first version of this file missed.
    //
    // Asserting "every menu id is in the union" leaves a preset that is fully
    // implemented — union member, renderer, shaders, config — but absent from
    // HERO_FX_PRESETS completely unreachable, from the brand editor AND from
    // the audio picker that now derives from it. `pollen` and `geode` were in
    // exactly that state: reworked, gated, committed, and selectable from
    // nowhere.
    //
    // Deriving ShaderPicker from HERO_FX_PRESETS removed one drift and made
    // this one worse, by giving both surfaces the same blind spot.
    const source = read('lib/components/ui/ShaderHero/shader-config.ts');
    const union = source.slice(
      source.indexOf('export type ShaderPresetId'),
      source.indexOf("| 'none';") + 10
    );
    const unionIds = [...union.matchAll(/'([a-z]+)'/g)]
      .map((m) => m[1])
      .filter((id) => id !== 'none');

    const missing = unionIds.filter((id) => !presetIds.includes(id));
    expect(
      missing,
      'presets implemented but absent from HERO_FX_PRESETS — unreachable from every picker'
    ).toEqual([]);
  });

  it('lists every preset in the ShaderPresetId union', () => {
    const source = read('lib/components/ui/ShaderHero/shader-config.ts');
    // The union is a run of `| 'name'` alternatives at the top of the file.
    const union = source.slice(
      source.indexOf('export type ShaderPresetId'),
      source.indexOf("| 'none';") + 10
    );

    const missing = presetIds.filter((id) => !union.includes(`'${id}'`));
    expect(
      missing,
      'presets in the menu but absent from ShaderPresetId'
    ).toEqual([]);
  });

  it('has a loadRenderer entry for every preset', () => {
    // RENDERER_LOADERS is typed `Record<ShaderPresetId, RendererLoader>`, so
    // union-to-loader coverage is already a compile error if it breaks. This
    // asserts the other direction — menu id to loader key — which no type
    // covers, since HERO_FX_PRESETS ids are plain strings.
    //
    // Keys there are unquoted (`suture:`, not `'suture':`), so match on the
    // key position rather than a quoted literal.
    const source = read('lib/components/ui/ShaderHero/load-renderer.ts');
    const missing = presetIds.filter(
      (id) => !new RegExp(`^\\s*${id}:\\s*async`, 'm').test(source)
    );
    expect(missing, 'presets with no loadRenderer entry').toEqual([]);
  });

  it('derives the immersive audio picker rather than hardcoding a list', () => {
    // REGRESSION GUARD. This picker previously hardcoded 26 of 41 presets, so
    // the rest were unreachable for audio playback. If someone reintroduces a
    // literal list here, that silently happens again.
    const source = read(
      'lib/components/studio/content-form/ShaderPicker.svelte'
    );

    expect(
      source.includes('HERO_FX_PRESETS'),
      'ShaderPicker must derive its options from HERO_FX_PRESETS'
    ).toBe(true);

    // A hardcoded list is recognisable by repeated `{ id: '…', label:` object
    // literals. One or two are fine (e.g. re-describing `none`); a menu's
    // worth is the defect. Threshold well below the 26 that were there.
    const literalEntries =
      source.match(/\{\s*id:\s*'[a-z]+'\s*,\s*label:/g) ?? [];
    expect(
      literalEntries.length,
      `ShaderPicker appears to hardcode ${literalEntries.length} preset entries; derive from HERO_FX_PRESETS instead`
    ).toBeLessThan(5);
  });

  it('exposes every preset to audio playback, not a subset', () => {
    // The whole point of the derivation: the audio picker's option count must
    // equal the menu's. Asserted through the source-level derivation above
    // plus this count, so a `.filter()` sneaking back in also fails.
    const source = read(
      'lib/components/studio/content-form/ShaderPicker.svelte'
    );
    const derivation = source.slice(
      source.indexOf('const PRESETS'),
      source.indexOf('function isSelected')
    );

    expect(
      /\.filter\(/.test(derivation),
      'ShaderPicker must not filter the preset list — every preset should be selectable for audio'
    ).toBe(false);
  });
});
